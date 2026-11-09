/**
 * Customer-facing data exports (CSV), always inside the signed-in workspace's
 * tenant context: the tenant-scope plugin limits every query to that tenant.
 *
 *   contact export    one contact's messages and notes
 *   workspace export  every message (part=messages) or contact (part=contacts)
 *
 * Rows are read in id order in batches, so large workspaces stream without
 * being held in memory. Staff-run JSON exports of a whole tenant (and their
 * secret removal) are a separate feature: services/tenantData.js.
 */
const models = require('../models');
const { phoneTailRegex } = require('../db/mongo');

const BATCH = 1000;

const MESSAGE_COLUMNS = ['kind', 'time', 'direction', 'sender', 'type', 'text', 'status', 'attachment'];
const WORKSPACE_MESSAGE_COLUMNS = ['contact_id', 'contact_name', 'contact_phone', ...MESSAGE_COLUMNS];
const CONTACT_COLUMNS = ['contact_id', 'name', 'phone', 'email', 'status', 'source', 'location', 'created_at', 'last_inbound_at'];

const senderOf = (m) => (m.direction === 'inbound' ? 'customer' : m.is_ai ? 'ai' : 'team');
const attachmentOf = (m) => (m.media_url ? (/[^/]+$/.exec(String(m.media_url).split(/[?#]/)[0])?.[0] || 'yes') : '');

function messageRow(m) {
  return ['message', m.sent_at, m.direction, senderOf(m), m.msg_type || 'text', m.content || '', m.status || '', attachmentOf(m)];
}

/** Conversation ids of a lead: by lead id, or by phone for older rows without one. */
async function conversationIdsOf(lead) {
  const filter = [{ lead_id: lead.id }];
  if (lead.phone) filter.push({ lead_id: null, phone: phoneTailRegex(lead.phone) });
  return models.Conversations.distinct('id', { $or: filter });
}

async function findContact(leadId) {
  const id = Number(leadId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return models.Leads.findOne({ id }, { _id: 0, id: 1, name: 1, phone: 1 }).lean();
}

async function countContactRows(lead) {
  const ids = await conversationIdsOf(lead);
  const [messages, notes, salesNotes] = await Promise.all([
    ids.length ? models.Messages.countDocuments({ conversation_id: { $in: ids } }) : 0,
    models.LeadNotes.countDocuments({ lead_id: lead.id }),
    models.SalesLeadNotes.countDocuments({ lead_id: lead.id }),
  ]);
  return { messages, notes: notes + salesNotes, conversationIds: ids };
}

/** Yields arrays of CSV rows for one contact: messages by time, then notes. */
async function* contactRows(lead, conversationIds) {
  let lastId = 0;
  while (conversationIds.length) {
    const batch = await models.Messages.find(
      { conversation_id: { $in: conversationIds }, id: { $gt: lastId } },
      { _id: 0, id: 1, sent_at: 1, direction: 1, is_ai: 1, msg_type: 1, content: 1, status: 1, media_url: 1 },
    ).sort({ id: 1 }).limit(BATCH).lean();
    if (!batch.length) break;
    yield batch.sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at)).map(messageRow);
    lastId = batch[batch.length - 1].id;
  }
  const notes = await models.LeadNotes.find({ lead_id: lead.id }, { _id: 0, note: 1, created_at: 1 }).sort({ id: 1 }).lean();
  const salesNotes = await models.SalesLeadNotes.find({ lead_id: lead.id }, { _id: 0, note: 1, created_at: 1 }).sort({ id: 1 }).lean();
  const all = [...notes, ...salesNotes].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  if (all.length) yield all.map((n) => ['note', n.created_at, '', 'team', 'note', n.note || '', '', '']);
}

async function countWorkspace(part) {
  return part === 'contacts' ? models.Leads.countDocuments({}) : models.Messages.countDocuments({});
}

async function* workspaceContactRows() {
  let lastId = 0;
  for (;;) {
    const batch = await models.Leads.find({ id: { $gt: lastId } }, { _id: 0, id: 1, name: 1, phone: 1, email: 1, status: 1, source: 1, location: 1, created_at: 1, last_inbound_at: 1 })
      .sort({ id: 1 }).limit(BATCH).lean();
    if (!batch.length) return;
    yield batch.map((l) => [l.id, l.name, l.phone, l.email, l.status, l.source, l.location, l.created_at, l.last_inbound_at]);
    lastId = batch[batch.length - 1].id;
  }
}

async function* workspaceMessageRows() {
  let lastId = 0;
  for (;;) {
    const batch = await models.Messages.find({ id: { $gt: lastId } }, { _id: 0, id: 1, conversation_id: 1, sent_at: 1, direction: 1, is_ai: 1, msg_type: 1, content: 1, status: 1, media_url: 1 })
      .sort({ id: 1 }).limit(BATCH).lean();
    if (!batch.length) return;
    const conversations = await models.Conversations.find({ id: { $in: [...new Set(batch.map((m) => m.conversation_id))] } }, { _id: 0, id: 1, lead_id: 1, phone: 1 }).lean();
    const byConversation = new Map(conversations.map((c) => [c.id, c]));
    const leadIds = [...new Set(conversations.map((c) => c.lead_id).filter((v) => v != null))];
    const leads = new Map((await models.Leads.find({ id: { $in: leadIds } }, { _id: 0, id: 1, name: 1, phone: 1 }).lean()).map((l) => [l.id, l]));
    yield batch.map((m) => {
      const conversation = byConversation.get(m.conversation_id);
      const lead = conversation?.lead_id != null ? leads.get(conversation.lead_id) : null;
      return [lead?.id ?? '', lead?.name ?? '', lead?.phone ?? conversation?.phone ?? '', ...messageRow(m)];
    });
    lastId = batch[batch.length - 1].id;
  }
}

module.exports = {
  MESSAGE_COLUMNS, WORKSPACE_MESSAGE_COLUMNS, CONTACT_COLUMNS,
  findContact, countContactRows, contactRows, countWorkspace, workspaceContactRows, workspaceMessageRows,
};
