const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(require('@ffmpeg-installer/ffmpeg').path);
const { convertToWhatsAppVoiceNote } = require('../services/voice-note-encoder');
const {
  AllianceInboxSettings,
  AllianceInboxContacts,
  AllianceInboxConversations,
  AllianceInboxMessages,
  AllianceInboxMedia,
  AllianceInboxTags,
  AllianceContactTags,
  AllianceProspects,
  AllianceAudiences,
  AllianceTemplates,
  AllianceWhatsappCampaignRecipients,
  AllianceWhatsappFollowupJobs,
  Templates,
} = require('../models');
const { NO_ID, escapeRegex, upsertOne, insertIgnore } = require('../db/mongo');
const { deleteCascade, assertReferenceExists } = require('../db/cascade');
const ensureAllianceSchema = require('../db/alliance-schema');
const openRouter = require('../services/openrouter');
const { processQueuedAllianceWelcomes } = require('../services/alliance-welcome');
const { scheduleAllianceInactivityReminder } = require('../services/alliance-whatsapp-campaign-worker');
const { getAllianceBrainContext } = require('../services/alliance-brain-context');
const { getAlliancePromptRules } = require('../services/alliance-prompt-rules');
const { getAllianceLeadMemory, saveAllianceLeadMemory } = require('../services/alliance-lead-memory');
const { scoreAllianceProspect } = require('../services/alliance-lead-scoring');

function createAllianceInboxRouter({ auth, io }) {
  const router = express.Router();
  const mediaDirectory = path.join(__dirname, '..', 'uploads', 'alliance-media');
  fs.mkdirSync(mediaDirectory, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, callback) => callback(null, mediaDirectory),
      filename: (_req, file, callback) => callback(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
    }),
    limits: { fileSize: 25 * 1024 * 1024 },
  });

  const configuredPhoneId = async () => {
    const settings = await AllianceInboxSettings.findOne({ active: true }, NO_ID).sort({ id: 1 }).lean();
    return settings || (process.env.ALLIANCE_WA_PHONE_NUMBER_ID ? {
      phone_number_id: process.env.ALLIANCE_WA_PHONE_NUMBER_ID,
      access_token_env: 'ALLIANCE_WA_ACCESS_TOKEN',
    } : null);
  };
  const accessToken = (settings) => process.env[settings?.access_token_env || 'ALLIANCE_WA_ACCESS_TOKEN'];
  const normalizePhone = (value) => String(value || '').replace(/\D/g, '');
  const relayAuthorized = (req) => {
    const expected = String(process.env.INTERNAL_API_KEY || '');
    return !expected || String(req.get('x-internal-key') || '') === expected;
  };
  // Keeps the inbox contacts/conversations in step with imported prospects and
  // queues the welcome template for newly eligible conversations.
  const syncImportedProspects = async () => {
    const settings = await configuredPhoneId();
    const phoneNumberId = settings?.phone_number_id || process.env.ALLIANCE_WA_PHONE_NUMBER_ID || 'unconfigured';
    const prospects = await AllianceProspects.find({}, {
      id: 1, name: 1, business_name: 1, phone: 1, source: 1, audience: 1, email: 1, industry: 1, location: 1, consent: 1,
    }).lean();
    const prospectById = new Map(prospects.map((p) => [p.id, p]));
    let contacts = await AllianceInboxContacts.find({}).lean();
    const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

    // 1. Refresh contacts already linked to a prospect
    const refreshOps = [];
    for (const c of contacts) {
      const p = c.prospect_id != null ? prospectById.get(c.prospect_id) : null;
      if (!p) continue;
      const phoneTaken = contacts.some((other) => other.id !== c.id && other.phone === p.phone && p.phone != null);
      const waIdTaken = contacts.some((other) => other.id !== c.id && other.wa_id === p.phone && p.phone != null);
      const next = {
        name: p.name ?? p.business_name ?? c.name ?? null,
        profile_name: p.name ?? p.business_name ?? c.profile_name ?? null,
        phone: phoneTaken ? c.phone : (p.phone ?? null),
        wa_id: waIdTaken ? c.wa_id : (p.phone ?? null),
        source: p.source ?? c.source ?? 'file_upload',
        custom_fields: {
          ...(c.custom_fields || {}),
          business_name: p.business_name ?? null, audience: p.audience ?? null,
          email: p.email ?? null, industry: p.industry ?? null, location: p.location ?? null,
        },
      };
      if (Object.keys(next).every((key) => sameJson(next[key], c[key]))) continue;
      refreshOps.push({ updateOne: { filter: { _id: c._id }, update: { $set: { ...next, updated_at: new Date() } } } });
    }
    if (refreshOps.length) await AllianceInboxContacts.bulkWrite(refreshOps);

    // 2. Link unlinked contacts to the prospect that has the same phone
    contacts = await AllianceInboxContacts.find({}).lean();
    const linkedProspects = new Set(contacts.filter((c) => c.prospect_id != null).map((c) => c.prospect_id));
    for (const c of contacts) {
      if (c.prospect_id != null || c.phone == null) continue;
      const p = prospects.find((candidate) => candidate.phone === c.phone && !linkedProspects.has(candidate.id));
      if (!p) continue;
      await AllianceInboxContacts.updateOne({ _id: c._id }, { $set: {
        prospect_id: p.id,
        name: p.name ?? p.business_name ?? c.name ?? null,
        source: c.source ?? p.source ?? 'file_upload',
        custom_fields: { ...(c.custom_fields || {}), business_name: p.business_name ?? null, audience: p.audience ?? null, email: p.email ?? null },
        updated_at: new Date(),
      } });
      linkedProspects.add(p.id);
    }

    // 3. Create contacts for prospects that have none
    contacts = await AllianceInboxContacts.find({}, { id: 1, prospect_id: 1, phone: 1 }).lean();
    const contactPhones = new Set(contacts.map((c) => c.phone).filter((phone) => phone != null));
    const contactProspects = new Set(contacts.map((c) => c.prospect_id).filter((id) => id != null));
    for (const p of prospects) {
      if (contactProspects.has(p.id) || (p.phone != null && contactPhones.has(p.phone))) continue;
      await AllianceInboxContacts.create({
        prospect_id: p.id, wa_id: p.phone ?? null, phone: p.phone ?? null,
        name: p.name ?? p.business_name ?? null, profile_name: p.name ?? p.business_name ?? null,
        source: p.source ?? 'file_upload',
        custom_fields: { business_name: p.business_name ?? null, audience: p.audience ?? null, email: p.email ?? null },
      });
      if (p.phone != null) contactPhones.add(p.phone);
      contactProspects.add(p.id);
    }

    // 4. Create a conversation for every contact without one
    contacts = await AllianceInboxContacts.find({}, { id: 1, prospect_id: 1 }).lean();
    const withConversation = new Set(await AllianceInboxConversations.distinct('contact_id'));
    for (const c of contacts) {
      if (withConversation.has(c.id)) continue;
      const p = c.prospect_id != null ? prospectById.get(c.prospect_id) : null;
      await AllianceInboxConversations.create({
        contact_id: c.id,
        phone_number_id: phoneNumberId,
        welcome_status: p && p.phone != null && p.consent === true ? 'not_queued' : 'not_eligible',
      }).catch((error) => { if (error.code !== 11000) throw error; });
    }

    // 5-7. Queue the welcome template (or flag a missing template) for not_queued conversations
    const pending = await AllianceInboxConversations.find({ welcome_status: 'not_queued' }, { id: 1, contact_id: 1 }).lean();
    if (pending.length) {
      const pendingContacts = new Map((await AllianceInboxContacts.find(
        { id: { $in: pending.map((cv) => cv.contact_id) } },
        { id: 1, prospect_id: 1 }
      ).lean()).map((c) => [c.id, c]));
      const welcomeTemplates = (await AllianceTemplates.find({
        channel: 'whatsapp', touch_no: 1, active: true, template_name: { $ne: null },
      }).lean()).filter((t) => String(t.provider_status ?? 'approved').toLowerCase() === 'approved');
      for (const cv of pending) {
        const c = pendingContacts.get(cv.contact_id);
        if (!c) continue;
        const p = c.prospect_id != null ? prospectById.get(c.prospect_id) : null;
        const template = p ? welcomeTemplates.find((t) => t.audience === p.audience) : null;
        if (!template) {
          await AllianceInboxConversations.updateOne({ id: cv.id }, { $set: {
            welcome_status: 'missing_template',
            welcome_error: 'No approved WhatsApp touch-1 template is configured for this audience.',
            updated_at: new Date(),
          } });
          continue;
        }
        const alreadyQueued = await AllianceInboxMessages.exists({
          conversation_id: cv.id, msg_type: 'template', 'raw_payload.purpose': 'welcome',
        });
        if (!alreadyQueued) {
          await AllianceInboxMessages.create({
            conversation_id: cv.id, contact_id: c.id, direction: 'outbound', msg_type: 'template',
            content: template.body, status: 'queued',
            raw_payload: { purpose: 'welcome', template_name: template.template_name, language: template.language ?? 'en', prospect_id: p.id },
          });
        }
        await AllianceInboxConversations.updateOne({ id: cv.id }, { $set: {
          welcome_status: 'queued', welcome_template_name: template.template_name, welcome_error: null, updated_at: new Date(),
        } });
      }
    }
  };

  // Tags of each contact: Map(contact_id -> [{ id, name, color }])
  const loadContactTags = async (contactIds) => {
    const links = await AllianceContactTags.find({ contact_id: { $in: contactIds } }, { contact_id: 1, tag_id: 1 }).lean();
    const tags = new Map((await AllianceInboxTags.find(
      { id: { $in: [...new Set(links.map((l) => l.tag_id))] } },
      { _id: 0, id: 1, name: 1, color: 1 }
    ).lean()).map((t) => [t.id, t]));
    const byContact = new Map();
    for (const link of links) {
      const tag = tags.get(link.tag_id);
      if (!tag) continue;
      if (!byContact.has(link.contact_id)) byContact.set(link.contact_id, []);
      byContact.get(link.contact_id).push({ id: tag.id, name: tag.name, color: tag.color });
    }
    return byContact;
  };

  // Messages shaped for the inbox UI (newest first), with reply previews and template buttons.
  const loadMessages = async (filter, skip, limit) => {
    const rows = await AllianceInboxMessages.find(filter).sort({ sent_at: -1 }).skip(skip).limit(limit).lean();
    const parentIds = [...new Set(rows.map((m) => m.reply_to_wa_msg_id).filter(Boolean))];
    const parents = new Map((parentIds.length ? await AllianceInboxMessages.find(
      { wa_msg_id: { $in: parentIds } },
      { id: 1, wa_msg_id: 1, content: 1, media_url: 1, msg_type: 1 }
    ).lean() : []).map((p) => [p.wa_msg_id, p]));
    const templateNames = [...new Set(rows.map((m) => m.raw_payload?.template_name).filter(Boolean))];
    const templates = new Map((templateNames.length ? await Templates.find({ name: { $in: templateNames } }, { name: 1, buttons: 1 }).lean() : [])
      .map((t) => [t.name, t]));
    return rows.map((m) => {
      const payload = m.raw_payload || {};
      const parent = m.reply_to_wa_msg_id ? parents.get(m.reply_to_wa_msg_id) : null;
      const senderType = payload.sender_type ?? (payload.purpose === 'automated_followup' ? 'automation' : null);
      return {
        id: m.id,
        wa_msg_id: m.wa_msg_id,
        direction: m.direction,
        msg_type: m.msg_type,
        type: m.msg_type,
        content: m.msg_type === 'unsupported' && m.content === '[unsupported]'
          ? 'This WhatsApp message type is not available through Meta. Ask the sender to resend it as text, image, audio, or document.'
          : m.content,
        media_id: m.media_id,
        media_url: m.media_url,
        mime_type: m.mime_type,
        filename: m.filename,
        status: m.status,
        reactions: m.reactions,
        is_starred: m.is_starred,
        is_deleted: m.is_deleted,
        pinned_until: m.pinned_until,
        sent_at: m.sent_at,
        timestamp: m.sent_at,
        template_buttons: payload.buttons ?? templates.get(payload.template_name)?.buttons ?? [],
        is_ai: payload.sender_type == null ? null : payload.sender_type === 'ai',
        sender_type: senderType,
        reply_to: parent ? { id: parent.id, wa_msg_id: parent.wa_msg_id, content: parent.content, media_url: parent.media_url, type: parent.msg_type } : null,
      };
    });
  };

  router.use(async (_req, res, next) => {
    try { await ensureAllianceSchema(); next(); }
    catch (error) { console.error('Alliance inbox schema failed:', error); res.status(500).json({ error: 'Alliance inbox database is not ready.' }); }
  });

  // Public Meta verification and event endpoints. Only events for the configured
  // Alliance phone_number_id are accepted; LeadOS webhook data never enters here.
  router.get('/webhook', (req, res) => {
    if (!relayAuthorized(req)) return res.sendStatus(401);
    const expected = process.env.ALLIANCE_WA_VERIFY_TOKEN;
    if (req.query['hub.mode'] === 'subscribe' && expected && req.query['hub.verify_token'] === expected) return res.status(200).send(req.query['hub.challenge']);
    return res.sendStatus(403);
  });

  router.post('/webhook', async (req, res) => {
    if (!relayAuthorized(req)) return res.sendStatus(401);
    res.sendStatus(200);
    try {
      const settings = await configuredPhoneId();
      if (!settings) return;
      for (const entry of req.body?.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value || {};
          if (String(value.metadata?.phone_number_id || '') !== String(settings.phone_number_id)) continue;

          for (const statusEvent of value.statuses || []) {
            const failureReason = (statusEvent.errors || []).map((error) => [
              error.code ? `Meta ${error.code}` : '',
              error.title,
              error.message,
              error.error_data?.details,
            ].filter(Boolean).join(': ')).filter(Boolean).join(' | ')
              || (statusEvent.status === 'failed' ? 'Meta reported message delivery failed without additional details.' : null);
            const updated = await AllianceInboxMessages.updateMany(
              { wa_msg_id: statusEvent.id },
              { $set: { status: statusEvent.status, 'raw_payload.status_event': statusEvent } }
            );
            if (updated.matchedCount) io.emit('alliance_message_status', { wa_message_id: statusEvent.id, status: statusEvent.status });
            await AllianceWhatsappCampaignRecipients.updateMany(
              { wa_msg_id: statusEvent.id, status: { $in: ['sent', 'delivered', 'read', 'failed'] } },
              { $set: statusEvent.status === 'failed'
                ? { status: statusEvent.status, error_message: failureReason }
                : { status: statusEvent.status } }
            ).catch(() => {});
            if (statusEvent.status === 'failed') {
              try {
                const failedRecipients = await AllianceWhatsappCampaignRecipients.find({ wa_msg_id: statusEvent.id }, { campaign_id: 1, prospect_id: 1 }).lean();
                for (const recipient of failedRecipients) {
                  await AllianceWhatsappFollowupJobs.updateMany(
                    { campaign_id: recipient.campaign_id, prospect_id: recipient.prospect_id, status: { $in: ['pending', 'claimed'] } },
                    { $set: { status: 'cancelled', error_message: `Initial WhatsApp delivery failed: ${failureReason}`.slice(0, 2000) } }
                  );
                }
              } catch (_error) { /* best effort, as before */ }
            }
          }

          for (const incoming of value.messages || []) {
            const phone = normalizePhone(incoming.from);
            const profileName = value.contacts?.find((item) => normalizePhone(item.wa_id) === phone)?.profile?.name || phone;
            try {
              const contact = await upsertOne(
                AllianceInboxContacts,
                { wa_id: phone },
                { $set: { profile_name: profileName, updated_at: new Date() } },
                { phone, name: profileName, profile_name: profileName }
              );
              const conversation = await upsertOne(
                AllianceInboxConversations,
                { contact_id: contact.id },
                { $set: { updated_at: new Date() } },
                { phone_number_id: settings.phone_number_id }
              );
              const type = incoming.type || 'text';
              const typedPayload = incoming[type] || {};
              const interactiveReply = incoming.interactive?.button_reply || incoming.interactive?.list_reply;
              const contactText = (incoming.contacts || []).map((item) => {
                const name = item.name?.formatted_name || [item.name?.first_name, item.name?.last_name].filter(Boolean).join(' ') || 'Shared contact';
                const phones = (item.phones || []).map((phoneItem) => phoneItem.phone || phoneItem.wa_id).filter(Boolean).join(', ');
                return phones ? `${name}: ${phones}` : name;
              }).join('\n');
              const locationText = incoming.location
                ? [incoming.location.name, incoming.location.address, incoming.location.latitude != null && incoming.location.longitude != null ? `${incoming.location.latitude}, ${incoming.location.longitude}` : ''].filter(Boolean).join(' — ')
                : '';
              const unsupportedDetail = incoming.errors?.[0]?.error_data?.details || incoming.errors?.[0]?.message;
              const contentByType = {
                text: incoming.text?.body,
                button: incoming.button?.text || incoming.button?.payload,
                interactive: interactiveReply?.title || interactiveReply?.description || interactiveReply?.id || incoming.interactive?.nfm_reply?.body,
                contacts: contactText,
                location: locationText,
                reaction: incoming.reaction?.emoji ? `Reacted ${incoming.reaction.emoji}` : 'Reaction removed',
                system: incoming.system?.body || incoming.system?.identity,
                order: incoming.order?.product_items?.length ? `Order shared with ${incoming.order.product_items.length} item(s)` : 'Order shared',
                unsupported: unsupportedDetail ? `This WhatsApp message type is unavailable: ${unsupportedDetail}` : 'This WhatsApp message type is not available through Meta. Ask the sender to resend it as text, image, audio, or document.',
              };
              const content = contentByType[type] || typedPayload.caption || typedPayload.filename || `[${type}]`;
              const mediaId = ['image', 'video', 'audio', 'document', 'sticker'].includes(type) ? typedPayload.id : null;
              const mediaUrl = mediaId ? `/api/alliance-inbox/media/${mediaId}` : null;
              const replyToId = incoming.context?.id || null;
              const saved = await AllianceInboxMessages.exists({ wa_msg_id: incoming.id }) ? null : await insertIgnore(AllianceInboxMessages, {
                conversation_id: conversation.id,
                contact_id: contact.id,
                wa_msg_id: incoming.id,
                direction: 'inbound',
                msg_type: type,
                content,
                media_id: mediaId,
                media_url: mediaUrl,
                mime_type: typedPayload.mime_type || null,
                filename: typedPayload.filename || null,
                status: 'received',
                reply_to_wa_msg_id: replyToId,
                raw_payload: incoming,
                sent_at: new Date(Number(incoming.timestamp || Math.floor(Date.now() / 1000)) * 1000),
              });
              if (saved) {
                await AllianceInboxConversations.updateOne(
                  { id: conversation.id },
                  { $inc: { unread_count: 1 }, $set: { last_message: content, last_message_at: saved.sent_at, last_inbound_at: saved.sent_at, ai_nudge_count: 0, updated_at: new Date() } }
                );
                if (contact.prospect_id) {
                  await AllianceProspects.updateOne(
                    { id: contact.prospect_id, status: { $nin: ['converted', 'closed', 'not_interested', 'unsubscribed', null] } },
                    { $set: { status: 'replied', updated_at: new Date() } }
                  );
                  await AllianceWhatsappCampaignRecipients.updateMany(
                    { prospect_id: contact.prospect_id, status: 'queued' },
                    { $set: { status: 'cancelled', error_message: 'Recipient replied.' } }
                  );
                  await AllianceWhatsappFollowupJobs.updateMany(
                    { prospect_id: contact.prospect_id, status: { $in: ['pending', 'claimed'] } },
                    { $set: { status: 'cancelled', error_message: 'Recipient replied.' } }
                  );
                  await scoreAllianceProspect(contact.prospect_id, {
                    message: content,
                    channel: 'whatsapp',
                    eventKey: incoming.id,
                  });
                }
              }
              if (saved) io.emit('alliance_incoming_message', { lead_id: String(contact.id), message: { ...saved, type, timestamp: saved.sent_at } });
            } catch (error) {
              console.error('Alliance inbound message failed:', error);
            }
          }
        }
      }
    } catch (error) { console.error('Alliance webhook processing failed:', error); }
  });

  router.get('/media/:mediaId', async (req, res) => {
    try {
      const referenced = await AllianceInboxMessages.exists({ media_id: req.params.mediaId });
      if (!referenced) return res.sendStatus(404);
      const settings = await configuredPhoneId();
      const token = accessToken(settings);
      if (!token) return res.status(503).json({ error: 'Alliance WhatsApp token is not configured.' });
      const metadata = await axios.get(`https://graph.facebook.com/v19.0/${req.params.mediaId}`, { headers: { Authorization: `Bearer ${token}` } });
      const media = await axios.get(metadata.data.url, { headers: { Authorization: `Bearer ${token}` }, responseType: 'arraybuffer' });
      res.setHeader('Content-Type', metadata.data.mime_type || media.headers['content-type'] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(Buffer.from(media.data));
    } catch (error) { res.status(502).json({ error: 'Unable to fetch Alliance media.' }); }
  });

  router.use(auth);

  router.get('/tags', async (req, res) => {
    try {
      const tags = await AllianceInboxTags.find({}, { _id: 0, id: 1, name: 1, color: 1 }).sort({ name: 1 }).lean();
      res.json(tags);
    } catch (e) {
      res.status(500).json({ error: 'Failed to fetch tags' });
    }
  });

  router.post('/tags', async (req, res) => {
    try {
      const { name, color } = req.body;
      if (!name) return res.status(400).json({ error: 'Tag name is required.' });
      const tag = await upsertOne(AllianceInboxTags, { name: name.trim() }, { $set: { color: color || '#00a884' } }, { color: color || '#00a884' });
      res.json(tag);
    } catch (e) {
      res.status(500).json({ error: 'Failed to create tag' });
    }
  });

  router.delete('/tags/:id', async (req, res) => {
    try {
      await deleteCascade('alliance_inbox_tags', { id: req.params.id });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to delete tag' });
    }
  });

  router.post('/contacts/:id/tags', async (req, res) => {
    try {
      const { tagId } = req.body;
      await assertReferenceExists('alliance_inbox_contacts', 'id', req.params.id, 'alliance_contact_tags');
      await assertReferenceExists('alliance_inbox_tags', 'id', tagId, 'alliance_contact_tags');
      await insertIgnore(AllianceContactTags, { contact_id: req.params.id, tag_id: tagId, created_at: new Date() });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to assign tag' });
    }
  });

  router.delete('/contacts/:id/tags/:tagId', async (req, res) => {
    try {
      await AllianceContactTags.deleteMany({ contact_id: req.params.id, tag_id: req.params.tagId });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to remove tag' });
    }
  });

  router.get('/contacts', async (req, res) => {
    await syncImportedProspects();
    setImmediate(() => processQueuedAllianceWelcomes(io).catch((error) => {
      console.error('[Alliance welcome queue]', error);
    }));
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const search = String(req.query.search || '').trim();
    const searchPattern = search ? new RegExp(escapeRegex(search), 'i') : null;
    const page = await AllianceInboxConversations.aggregate([
      { $lookup: { from: 'alliance_inbox_contacts', localField: 'contact_id', foreignField: 'id', as: 'c' } },
      { $unwind: '$c' },
      ...(searchPattern ? [{ $match: { $or: [{ 'c.name': searchPattern }, { 'c.phone': searchPattern }] } }] : []),
      { $sort: { last_message_at: -1, id: -1 } },
      { $skip: offset },
      { $limit: limit },
    ]);
    const prospects = await AllianceProspects.find(
      { id: { $in: page.map((row) => row.c.prospect_id).filter((id) => id != null) } },
      { id: 1, ai_score: 1 }
    ).lean();
    const scoreByProspect = new Map(prospects.map((p) => [p.id, p.ai_score]));
    const tagsByContact = await loadContactTags(page.map((row) => row.c.id));
    const leads = page.map(({ c, ...cv }) => ({
      id: c.id, name: c.name, profile_name: c.profile_name, phone: c.phone, status: c.status, interest: c.interest,
      source: c.source, prospect_id: c.prospect_id,
      score: scoreByProspect.get(c.prospect_id) ?? 10,
      last: cv.last_message, last_msg: cv.last_message, time: cv.last_message_at,
      unread: cv.unread_count, last_inbound_at: cv.last_inbound_at, welcome_status: cv.welcome_status,
      welcome_template_name: cv.welcome_template_name, welcome_wa_msg_id: cv.welcome_wa_msg_id,
      welcome_sent_at: cv.welcome_sent_at, welcome_error: cv.welcome_error,
      tags: tagsByContact.get(c.id) || [],
    }));
    const total = await AllianceInboxContacts.countDocuments();
    res.json({ leads, total });
  });

  router.get('/contacts/:id', async (req, res) => {
    const contact = await AllianceInboxContacts.findOne({ id: req.params.id }, NO_ID).lean();
    const cv = contact ? await AllianceInboxConversations.findOne({ contact_id: contact.id }).lean() : null;
    if (!contact || !cv) return res.status(404).json({ error: 'Alliance contact not found.' });
    const prospect = contact.prospect_id != null ? await AllianceProspects.findOne({ id: contact.prospect_id }, { ai_score: 1 }).lean() : null;
    const tagsByContact = await loadContactTags([contact.id]);
    res.json({ lead: {
      ...contact,
      score: prospect?.ai_score ?? 10,
      last_inbound_at: cv.last_inbound_at, welcome_status: cv.welcome_status, welcome_template_name: cv.welcome_template_name,
      welcome_wa_msg_id: cv.welcome_wa_msg_id, welcome_sent_at: cv.welcome_sent_at, welcome_error: cv.welcome_error,
      tags: tagsByContact.get(contact.id) || [],
    } });
  });

  router.patch('/contacts/:id', async (req, res) => {
    const changes = { updated_at: new Date() };
    if (req.body.name) changes.name = req.body.name;
    if (req.body.status) changes.status = req.body.status;
    if (req.body.interest) changes.interest = req.body.interest;
    const updated = await AllianceInboxContacts.findOneAndUpdate({ id: req.params.id }, { $set: changes }, { new: true, projection: NO_ID }).lean();
    if (!updated) return res.status(404).json({ error: 'Alliance contact not found.' });
    if (updated.prospect_id && req.body.status) {
      const status = String(req.body.status).toLowerCase();
      const allowed = ['pending','in_process','interested','converted','closed','complete','completed','not_interested','unsubscribed'];
      if (allowed.includes(status)) await AllianceProspects.updateOne({ id: updated.prospect_id }, { $set: { status, updated_at: new Date() } });
      if (['converted','closed','complete','completed','not_interested','unsubscribed'].includes(status)) {
        await AllianceWhatsappFollowupJobs.updateMany(
          { prospect_id: updated.prospect_id, status: { $in: ['pending', 'claimed'] } },
          { $set: { status: 'cancelled', error_message: `Prospect ${status}.` } }
        );
      }
    }
    res.json({ lead: updated });
  });

  router.get('/contacts/:id/messages', async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const messages = await loadMessages({ contact_id: req.params.id }, offset, limit);
    res.json({ messages: messages.reverse() });
  });

  router.put('/conversations/:contactId/read', async (req, res) => {
    await AllianceInboxConversations.updateMany({ contact_id: req.params.contactId }, { $set: { unread_count: 0 } });
    res.json({ success: true });
  });

  router.post('/contacts/:id/ai-suggestion', async (req, res) => {
    try {
      if (!openRouter.isConfigured) return res.status(503).json({ error: 'OpenRouter is not configured on the API server.' });
      const contactRow = await AllianceInboxContacts.findOne({ id: req.params.id }, { _id: 0, id: 1, name: 1, phone: 1, prospect_id: 1 }).lean();
      if (!contactRow) return res.status(404).json({ error: 'Alliance contact not found.' });
      const prospectRow = contactRow.prospect_id != null
        ? await AllianceProspects.findOne({ id: contactRow.prospect_id }, { business_name: 1, audience: 1, industry: 1, location: 1, status: 1 }).lean()
        : null;
      const audienceRow = prospectRow?.audience ? await AllianceAudiences.findOne({ code: prospectRow.audience }, { brand: 1 }).lean() : null;
      const contact = { rows: [{
        ...contactRow,
        business_name: prospectRow?.business_name ?? null,
        audience: prospectRow?.audience ?? null,
        industry: prospectRow?.industry ?? null,
        location: prospectRow?.location ?? null,
        status: prospectRow?.status ?? null,
        brand: audienceRow?.brand ?? null,
      }] };
      const history = { rows: await AllianceInboxMessages.find(
        { contact_id: req.params.id, is_deleted: false },
        { _id: 0, direction: 1, content: 1, msg_type: 1, sent_at: 1 }
      ).sort({ sent_at: -1 }).limit(30).lean() };
      const latestInbound = history.rows.find((message) => message.direction === 'inbound');
      const brain = await getAllianceBrainContext(contact.rows[0].audience, latestInbound?.content);
      const durableLeadMemory = contact.rows[0].prospect_id ? await getAllianceLeadMemory(contact.rows[0].prospect_id) : null;
      const promptRules = await getAlliancePromptRules('reply_suggestion', 'whatsapp', contact.rows[0].audience, latestInbound?.content || '');
      const prompt = `Write one concise WhatsApp reply suggestion for HUMAN REVIEW. Never claim it was sent.
Lead context: ${JSON.stringify(contact.rows[0])}
AUTHORITATIVE AI BRAIN (the only source for brand, course, service, price, duration, policy, and contact facts): ${brain ? JSON.stringify(brain) : 'Not configured for this audience yet — do not state any brand facts.'}
Pre-matched administrator rules (mandatory; lower priority number wins if instructions conflict): ${promptRules}
This contact's separate conversation memory, oldest to newest: ${JSON.stringify(history.rows.reverse())}
Durable lead memory${durableLeadMemory ? ` keyed by ${durableLeadMemory.lead_key}` : ''}: ${JSON.stringify(durableLeadMemory || {})}
Directly answer the latest inbound message using the detected brand only and continue naturally from this contact's own raw history and durable memory. Never restart the introduction when this is an ongoing conversation. End with at most one useful question. If question_scope is "broad_catalog", list EVERY active entry in exact_catalog exactly once without renaming or omitting entries; include stored duration and fee when present. If suggested_questions is non-empty, use at most one question from that list. For a specific-offering match, answer only with relevant_offerings.${brain ? ` ${brain.instructions}` : ''}
Merge the latest exchange into durable memory while preserving relevant prior facts. Return JSON only: {"suggestion":"message text","memory":{"summary":"concise cumulative conversation summary","requirements":[],"interests":[],"objections":[],"commitments":[],"next_step":"","relationship_stage":"new|engaged|evaluating|ready|closed"}}.`;
      const generated = await openRouter.generateContent({ contents: prompt, config: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 2000 } });
      let parsed;
      try { parsed = JSON.parse(String(generated.text || '').replace(/^```json\s*|\s*```$/g, '')); }
      catch { parsed = { suggestion: String(generated.text || '').trim(), memory: durableLeadMemory }; }
      let suggestion = String(parsed.suggestion || '').trim();
      if (!suggestion) return res.status(502).json({ error: 'AI returned an empty suggestion.' });
      if (brain?.internal?.escalation_phone && brain.internal.public_contact_phone) {
        suggestion = suggestion.replaceAll(brain.internal.escalation_phone, brain.internal.public_contact_phone);
      }
      if (brain?.question_scope === 'broad_catalog' && brain.exact_catalog?.length) {
        const normalizeCatalogText = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const normalizedSuggestion = normalizeCatalogText(suggestion);
        const missingOfferings = brain.exact_catalog.filter((offering) => !normalizedSuggestion.includes(normalizeCatalogText(offering.name)));
        if (missingOfferings.length) {
          const catalogLines = brain.exact_catalog.map((offering) => {
            const facts = [offering.duration, offering.fee ? `₹${offering.fee}` : ''].filter(Boolean).join(', ');
            return `• ${offering.name}${facts ? ` — ${facts}` : ''}`;
          });
          suggestion = `Thank you for your interest in ${brain.brand.name}. Here is our complete current catalog:\n\n${catalogLines.join('\n')}\n\n${brain.suggested_questions?.[0] || 'Which course would you like to explore in detail?'}`;
        }
      }
      if (brain?.internal?.escalation_phone && brain.internal.public_contact_phone) {
        suggestion = suggestion.replaceAll(brain.internal.escalation_phone, brain.internal.public_contact_phone);
      }
      if (contact.rows[0].prospect_id) {
        const memoryUpdate = parsed.memory || { ...durableLeadMemory, summary: `${durableLeadMemory?.summary ? `${durableLeadMemory.summary}\n` : ''}Latest inbound message: ${latestInbound?.content || ''}` };
        await saveAllianceLeadMemory(contact.rows[0].prospect_id, memoryUpdate, 'whatsapp', latestInbound?.sent_at || new Date());
      }
      res.json({ success: true, suggestion });
    } catch (error) {
      console.error('Alliance WhatsApp AI suggestion failed:', error.message);
      res.status(502).json({ error: error.message || 'Unable to generate suggestion.' });
    }
  });

  router.post('/media/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    let uploaded = req.file;

    // Convert webm to ogg (Opus) for WhatsApp voice messages
    const isWebm = req.file.mimetype?.toLowerCase().includes('webm') || req.file.originalname.toLowerCase().endsWith('.webm');
    if (isWebm) {
      const convertedName = `${path.parse(req.file.filename).name}.ogg`;
      const convertedPath = path.join(mediaDirectory, convertedName);
      try {
        await convertToWhatsAppVoiceNote(req.file.path, convertedPath);
        await fs.promises.unlink(req.file.path).catch(() => {});
        uploaded = { ...req.file, filename: convertedName, path: convertedPath, mimetype: 'audio/ogg; codecs=opus' };
      } catch (error) {
        await fs.promises.unlink(req.file.path).catch(() => {});
        await fs.promises.unlink(convertedPath).catch(() => {});
        return res.status(500).json({ error: 'Unable to prepare this voice note for WhatsApp.' });
      }
    }
    const fileUrl = `/uploads/alliance-media/${uploaded.filename}`;
    await AllianceInboxMedia.create({
      storage_path: uploaded.path, public_url: fileUrl, mime_type: uploaded.mimetype,
      filename: req.file.originalname, file_size: req.file.size, direction: 'outbound',
    });

    // Upload the file directly to Meta's media API so the send step can use
    // a stable media_id instead of a URL. This works even when the server is
    // not publicly reachable (local dev, private network, etc.).
    // Uses manual multipart/form-data — no external 'form-data' package needed.
    let waMediaId = null;
    try {
      const settings = await configuredPhoneId();
      const token = accessToken(settings);
      if (settings?.phone_number_id && token) {
        const fileBuffer = fs.readFileSync(uploaded.path);
        const fd = new FormData();
        fd.append('messaging_product', 'whatsapp');
        // WhatsApp requires the full "audio/ogg; codecs=opus" mime type for voice notes —
        // stripping the codecs parameter ("audio/ogg" alone) is explicitly unsupported and
        // makes Meta's server reject the upload during processing (error 131053).
        const cleanMimeType = (uploaded.mimetype || 'application/octet-stream').trim();
        fd.append('file', new Blob([fileBuffer], { type: cleanMimeType }), uploaded.filename);

        const response = await fetch(`https://graph.facebook.com/v19.0/${settings.phone_number_id}/media`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
          signal: AbortSignal.timeout(30000)
        });
        
        const data = await response.json();
        if (!response.ok) {
          throw new Error(JSON.stringify(data));
        }
        waMediaId = data?.id || null;
        console.log(`[Alliance Media] Uploaded to Meta. media_id=${waMediaId}`);
      }
    } catch (uploadError) {
      // Non-fatal: fall back to URL-based send at message send time.
      console.warn('[Alliance media upload to Meta failed]', uploadError.response?.data || uploadError.message);
    }

    res.json({ success: true, fileUrl, mimeType: uploaded.mimetype, waMediaId });
  });

  router.post('/contacts/:id/messages', async (req, res) => {
    const contactRow = await AllianceInboxContacts.findOne({ id: req.params.id }, NO_ID).lean();
    const contactConversation = contactRow ? await AllianceInboxConversations.findOne({ contact_id: contactRow.id }, { id: 1, last_inbound_at: 1 }).lean() : null;
    if (!contactRow || !contactConversation) return res.status(404).json({ error: 'Alliance contact not found.' });
    const contact = { ...contactRow, conversation_id: contactConversation.id, last_inbound_at: contactConversation.last_inbound_at };
    const settings = await configuredPhoneId();
    const token = accessToken(settings);
    if (!settings?.phone_number_id || !token) return res.status(503).json({ error: 'Alliance WhatsApp Phone Number ID or access token is not configured.' });
    if (!contact.last_inbound_at || Date.now() - new Date(contact.last_inbound_at).getTime() > 24 * 60 * 60 * 1000) {
      try {
        const recent = await AllianceInboxMessages.exists({
          contact_id: contact.id, direction: 'outbound', msg_type: 'template',
          'raw_payload.purpose': 'window_reopen', sent_at: { $gt: new Date(Date.now() - 6 * 60 * 60 * 1000) },
        });
        if (recent) return res.json({
          success: true, window_closed: true, template_sent: false,
          message: 'The service window is closed. A reopen template was already sent recently; wait for the recipient to reply.',
        });
        const preferred = String(process.env.ALLIANCE_WA_REOPEN_TEMPLATE || 'common_welcome_message');
        const rank = (name) => (name === preferred ? 0 : name === 'common_welcome_message' ? 1 : 2);
        const templateRows = (await Templates.find(
          { status: /^approved$/i, name: { $in: [preferred, 'common_welcome_message', 'new_lead_welcome'] } },
          { _id: 0, id: 1, name: 1, language: 1, body: 1, status: 1 }
        ).lean()).sort((a, b) => rank(a.name) - rank(b.name));
        const reopenTemplate = templateRows.find((item) => !/\{\{\d+\}\}/.test(String(item.body || '')));
        if (!reopenTemplate) return res.status(409).json({
          error: 'The 24-hour window is closed and no approved zero-variable reopen template is configured.',
          reason: 'window_closed', template_sent: false,
        });
        const meta = await axios.post(`https://graph.facebook.com/v19.0/${settings.phone_number_id}/messages`, {
          messaging_product: 'whatsapp', recipient_type: 'individual', to: contact.phone, type: 'template',
          template: { name: reopenTemplate.name, language: { code: reopenTemplate.language || 'en' } },
        }, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 20000 });
        const waMessageId = meta.data?.messages?.[0]?.id || null;
        const saved = (await AllianceInboxMessages.create({
          conversation_id: contact.conversation_id, contact_id: contact.id, wa_msg_id: waMessageId,
          direction: 'outbound', msg_type: 'template', content: reopenTemplate.body, status: 'sent',
          raw_payload: { purpose: 'window_reopen', template_name: reopenTemplate.name, attempted_message: String(req.body.message || '') },
          sent_at: new Date(),
        })).toObject();
        await AllianceInboxConversations.updateOne(
          { id: contact.conversation_id },
          { $set: { last_message: reopenTemplate.body, last_message_at: new Date(), updated_at: new Date() } }
        );
        const message = { ...saved, type: 'template', timestamp: saved.sent_at };
        io.emit('alliance_outgoing_message',{lead_id:String(contact.id),message});
        return res.json({
          success: true, window_closed: true, template_sent: true, message,
          notice: `Normal message was not sent. The approved ${reopenTemplate.name} template was sent; wait for the recipient to reply.`,
        });
      } catch (error) {
        console.error('Alliance reopen template send failed:', error.response?.data || error.message);
        return res.status(409).json({
          error: error.response?.data?.error?.message || 'The 24-hour window is closed and the reopen template could not be sent.',
          reason: 'window_closed', template_sent: false,
        });
      }
    }
    const type = req.body.msgType || req.body.type || 'text';
    const content = String(req.body.message || req.body.content || '');
    const payload = { messaging_product: 'whatsapp', recipient_type: 'individual', to: contact.phone, type };
    if (type === 'text') payload.text = { body: content };
    else {
      const waMediaId = req.body.waMediaId ? String(req.body.waMediaId) : null;
      const mediaLink = String(req.body.mediaUrl || '');
      if (!waMediaId && !mediaLink) return res.status(400).json({ error: 'Media URL or media ID is required.' });
      if (waMediaId) {
        // Preferred: use the Meta media_id obtained at upload time — no public URL needed.
        payload[type] = { id: waMediaId };
      } else {
        // Fallback: URL-based send. Requires the server to be publicly reachable.
        const baseUrl = process.env.PUBLIC_API_URL || '';
        const link = mediaLink.startsWith('http') ? mediaLink : `${baseUrl}${mediaLink}`;
        if (!link.startsWith('http')) {
          return res.status(500).json({
            error: 'Voice/media message could not be sent: no Meta media ID was returned at upload time and PUBLIC_API_URL is not configured. Please restart the server after setting PUBLIC_API_URL in server/.env.',
          });
        }
        payload[type] = { link };
      }
      if (content && ['image', 'video', 'document'].includes(type)) payload[type].caption = content;
      if (type === 'document' && mediaLink) payload.document.filename = path.basename(mediaLink);
    }
    if (req.body.replyToMessageId) payload.context = { message_id: req.body.replyToMessageId };
    try {
      const meta = await axios.post(`https://graph.facebook.com/v19.0/${settings.phone_number_id}/messages`, payload, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const waMessageId = meta.data.messages?.[0]?.id;
      const saved = (await AllianceInboxMessages.create({
        conversation_id: contact.conversation_id, contact_id: contact.id, wa_msg_id: waMessageId,
        direction: 'outbound', msg_type: type, content, media_url: req.body.mediaUrl || null, status: 'sent',
        reply_to_wa_msg_id: req.body.replyToMessageId || null,
        raw_payload: { ...meta.data, sender_type: req.body.senderType === 'ai' ? 'ai' : 'human' },
      })).toObject();
      await AllianceInboxConversations.updateOne(
        { id: contact.conversation_id },
        { $set: { last_message: content || `[${type}]`, last_message_at: new Date(), updated_at: new Date() } }
      );
      if (contact.prospect_id) {
        scheduleAllianceInactivityReminder(contact.prospect_id, saved.sent_at).catch((error) => {
          console.error('Alliance inactivity reminder scheduling failed:', error.message);
        });
      }
      const senderType = req.body.senderType === 'ai' ? 'ai' : 'human';
      const message = { ...saved, type, timestamp: saved.sent_at, sender_type: senderType, is_ai: senderType === 'ai' };
      io.emit('alliance_outgoing_message', { lead_id: String(contact.id), message });
      res.json({ success: true, message });
    } catch (error) {
      console.error('Alliance WhatsApp send failed:', error.response?.data || error.message);
      res.status(502).json({ error: error.response?.data?.error?.message || 'Alliance WhatsApp send failed.' });
    }
  });

  const updateMessage = (suffix, build) => router.put(`/messages/:id/${suffix}`, async (req, res) => {
    const updated = await AllianceInboxMessages.findOneAndUpdate({ id: req.params.id }, build(req), { new: true, projection: NO_ID }).lean();
    if (!updated) return res.status(404).json({ error: 'Message not found.' });
    io.emit('alliance_message_edited', updated);
    res.json({ success: true, message: updated });
  });
  updateMessage('edit', (req) => ({ $set: { content: req.body.content } }));
  updateMessage('delete', () => ({ $set: { is_deleted: true } }));
  updateMessage('star', (req) => ({ $set: { is_starred: Boolean(req.body.is_starred) } }));
  updateMessage('pin', (req) => req.body.unpin
    ? ({ $set: { pinned_until: null } })
    : ({ $set: { pinned_until: new Date(Date.now() + (Number(req.body.duration) || 24) * 60 * 60 * 1000) } }));
  updateMessage('react', (req) => (req.body.action === 'remove'
    ? { $unset: { [`reactions.${req.body.emoji}`]: '' } }
    : { $inc: { [`reactions.${req.body.emoji}`]: 1 } }));

  return router;
}

module.exports = createAllianceInboxRouter;
