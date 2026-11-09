/**
 * "Delete on request" for one contact (a LeadOS lead), inside the caller's
 * tenant context (the tenant-scope plugin limits every query to that tenant).
 *
 * eraseContact():
 *   1. writes the minimal erasure record first, which stops all sends at once;
 *   2. deletes the contact's stored files (media server and legacy uploads);
 *      if a file cannot be removed it stops there and the call can be repeated;
 *   3. deletes messages, conversations, notes, tags, tasks, queued and logged
 *      sends, reminders, AI traces and webhook delivery rows of that contact;
 *   4. deletes the contact row itself;
 *   5. completes the record: that a deletion happened, when, by whom, counts.
 *
 * Kept on purpose: the audit event and the erasure record (no name, number or
 * text) and payment rows, which are financial records (see the PR notes).
 *
 * Sends are stopped by isErased()/assertCanSendTo(): a keyed hash of the phone
 * number is all that is stored, so the number itself is not kept.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const models = require('../models');
const { phoneTailRegex } = require('../db/mongo');
const { requireTenantId } = require('./tenantContext');
const mediaStore = require('./mediaStore');

const UPLOADS_DIR = path.resolve(__dirname, '..', 'uploads');

class ErasureError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const ERASED_MESSAGE = 'This contact asked for their data to be deleted, so no messages can be sent to them.';

// Last 10 digits, the same normalisation the inbox uses to match a phone number.
function phoneKey(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-10) : null;
}

function hashKey() {
  const secret = process.env.TOKEN_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error('TOKEN_ENCRYPTION_KEY is not configured');
  return crypto.createHash('sha256').update(`contact-erasure-v1:${secret}`).digest();
}

// Keyed per tenant: the same number in two workspaces gives two different hashes.
function phoneHash(tenantId, phone) {
  const key = phoneKey(phone);
  if (!key) return null;
  return crypto.createHmac('sha256', hashKey()).update(`${Number(tenantId)}:${key}`).digest('hex');
}

/** True when the current workspace deleted a contact with this number on request. */
async function isErased(phone) {
  const hash = phoneHash(requireTenantId(), phone);
  if (!hash) return false;
  return Boolean(await models.ContactErasures.exists({ phone_hash: hash }));
}

/** Throws ErasureError(409) when sending to this number must not happen. */
async function assertCanSendTo(phone) {
  if (await isErased(phone)) throw new ErasureError(409, ERASED_MESSAGE, 'CONTACT_ERASED');
}

function removeLegacyUpload(url) {
  const match = /^\/?(?:api\/)?uploads\/(.+)$/.exec(String(url || '').split(/[?#]/)[0]);
  if (!match) return false;
  const target = path.resolve(UPLOADS_DIR, decodeURIComponent(match[1]));
  if (!target.startsWith(UPLOADS_DIR + path.sep)) return false; // never leave uploads/
  try {
    fs.unlinkSync(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function removeAttachments(messageRows) {
  const refs = new Set();
  const legacy = new Set();
  for (const row of messageRows) {
    if (mediaStore.isRef(row.media_url)) refs.add(mediaStore.parse(row.media_url)?.ref);
    else if (row.media_url) legacy.add(row.media_url);
  }
  refs.delete(undefined);
  let removed = 0;
  for (const ref of refs) {
    const parsed = mediaStore.parse(ref);
    if (mediaStore.enabled()) await mediaStore.remove(ref); // throws when the media server fails
    else await models.MediaFiles.deleteMany({ file_id: parsed.id, scope: parsed.scope });
    removed += 1;
  }
  for (const url of legacy) if (removeLegacyUpload(url)) removed += 1;
  return removed;
}

async function eraseContact(leadId, { userId = null } = {}) {
  const tenantId = requireTenantId();
  const id = Number(leadId);
  if (!Number.isInteger(id) || id <= 0) throw new ErasureError(400, 'Contact id is not valid');
  const { Leads, Conversations, Messages } = models;

  let record = await models.ContactErasures.findOne({ lead_id: id }).lean();
  const lead = await Leads.findOne({ id }, { _id: 0, id: 1, phone: 1 }).lean();
  if (!lead && !record) throw new ErasureError(404, 'Contact not found');
  if (record?.status === 'completed') return { already_erased: true, counts: record.counts || {} };

  // 1. Stop all sends before anything is deleted.
  if (!record) {
    record = (await models.ContactErasures.create({
      lead_id: id,
      phone_hash: phoneHash(tenantId, lead.phone),
      status: 'in_progress',
      erased_by_user_id: userId,
      requested_at: new Date(),
    })).toObject();
  }

  const conversationFilter = [{ lead_id: id }];
  if (lead?.phone) conversationFilter.push({ lead_id: null, phone: phoneTailRegex(lead.phone) });
  const conversationIds = await Conversations.distinct('id', { $or: conversationFilter });
  const messageRows = conversationIds.length
    ? await Messages.find({ conversation_id: { $in: conversationIds } }, { _id: 0, id: 1, media_url: 1 }).lean()
    : [];

  // 2. Files first: a failure here leaves the rows in place, so a retry can find them.
  const counts = { attachments: await removeAttachments(messageRows) };

  // 3. Data of this contact only.
  const byLead = { lead_id: id };
  const del = async (key, model, filter) => { counts[key] = (await model.deleteMany(filter)).deletedCount || 0; };
  await del('messages', Messages, { conversation_id: { $in: conversationIds } });
  await del('conversations', Conversations, { id: { $in: conversationIds } });
  await del('notes', models.LeadNotes, byLead);
  await del('sales_notes', models.SalesLeadNotes, byLead);
  await del('tags', models.LeadTags, byLead);
  await del('tasks', models.SalesTasks, byLead);
  await del('queued_sends', models.CampaignMessageQueue, byLead);
  await del('campaign_logs', models.CampaignLogs, byLead);
  await del('campaign_recipients', models.CampaignImportRecipients, byLead);
  await del('reminders', models.DemoCallReminders, byLead);
  await del('ai_traces', models.AiReplyLogs, byLead);
  await del('ai_decisions', models.AiDecisions, { lead_id: String(id) });
  await del('webhook_deliveries', models.WebhookDeliveries, byLead);

  // 4. The contact row (name, phone, email, notes, summaries). Payments stay.
  counts.contact = lead ? (await Leads.deleteOne({ id })).deletedCount || 0 : 0;

  // 5. Minimal record of the deletion.
  await models.ContactErasures.updateOne({ lead_id: id }, { $set: { status: 'completed', counts, completed_at: new Date() } });
  return { already_erased: false, counts };
}

module.exports = { ErasureError, ERASED_MESSAGE, phoneKey, phoneHash, isErased, assertCanSendTo, eraseContact };
