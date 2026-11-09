/**
 * LeadOS routes: Manual WhatsApp send from the CRM.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
module.exports = function registerWhatsappRoutes(app, ctx) {
const {
  Clients,
  Conversations,
  Leads,
  Messages,
  NO_ID,
  aiReplyQueue,
  auth,
  axios,
  fs,
  io,
  path,
  phoneTailRegex,
  upsertOne,
  SERVER_ROOT,
} = ctx;
const mediaStore = require('../../services/mediaStore');
const tenantUploads = require('../../services/tenantUploads');
const { currentTenantId } = require('../../services/tenantContext');
const sendPolicy = require('../../services/sendPolicy');
const numberHealth = require('../../services/numberHealth');
const WAKEUP_TEMPLATE = process.env.WA_WAKEUP_TEMPLATE || 'common_welcome_message';
const erasure = require('../../services/erasure');
// ══════════════════════════════════════════════════════════
// WHATSAPP ROUTES
// ══════════════════════════════════════════════════════════

// POST /api/whatsapp/send — manual send from CRM portal
app.post('/api/whatsapp/send', auth, async (req, res) => {
  try {
    const { lead_id, message, media_url, msg_type, reply_to_wa_id, is_forwarded } = req.body;

    // Admin manually intervened: cancel any pending AI reply for this lead
    if (aiReplyQueue.has(lead_id)) {
      clearTimeout(aiReplyQueue.get(lead_id));
      aiReplyQueue.delete(lead_id);
      io.emit('ai_typing', { lead_id: String(lead_id), typing: false });
      console.log(`[AI Queue] Cancelled AI reply for lead ${lead_id} due to manual admin message.`);
    }

    const sendLead = await Leads.findOne({ id: lead_id }, NO_ID).lean();
    if (!sendLead) return res.status(404).json({ error: 'Lead not found.' });
    if (await erasure.isErased(sendLead.phone)) return res.status(409).json({ error: erasure.ERASED_MESSAGE, code: 'CONTACT_ERASED' });
    const sendClient = sendLead.client_id != null ? await Clients.findOne({ id: sendLead.client_id }, { phone_number_id: 1, wa_access_token: 1, whatsapp_status: 1 }).lean() : null;
    const lead = {
      ...sendLead,
      phone_number_id: sendClient?.phone_number_id ?? null,
      wa_access_token: sendClient?.wa_access_token ?? null,
      whatsapp_status: sendClient?.whatsapp_status ?? null,
    };

    if (lead.client_id && lead.whatsapp_status !== 'verified') {
      return res.status(403).json({ error: 'WhatsApp is disabled for this brand until verification succeeds' });
    }

    const phoneNumberId = lead.phone_number_id;
    const waAccessToken = lead.wa_access_token;

    if (!phoneNumberId || !waAccessToken) {
      return res.status(409).json({ error: 'WhatsApp is not connected for this workspace. Connect WhatsApp in Settings first.', code: 'WHATSAPP_NOT_CONNECTED' });
    }

    // --- Check 24-hour window ---
    const windowConversationFilter = [{ lead_id }];
    if (lead.phone != null) windowConversationFilter.push({ phone: phoneTailRegex(lead.phone) });
    const windowConversationIds = await Conversations.distinct('id', { $or: windowConversationFilter });
    const isWindowOpen = Boolean(await Messages.exists({
      conversation_id: { $in: windowConversationIds }, direction: 'inbound', sent_at: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    }));

    if (!isWindowOpen) {
      // Check if we already sent a wakeup template in the last 30 minutes to avoid spamming
      const recentTemplate = await Messages.exists({
        conversation_id: { $in: await Conversations.distinct('id', { lead_id }) },
        direction: 'outbound', msg_type: 'template', sent_at: { $gt: new Date(Date.now() - 30 * 60 * 1000) },
      });

      if (!recentTemplate) {
        // The wake-up template is a business-initiated message: it needs the
        // contact's consent when Meta classes it as marketing, is never sent
        // to a contact who said STOP, and counts against the number's cap.
        const wakeupKind = await sendPolicy.templateKind(WAKEUP_TEMPLATE);
        const wakeupCheck = await sendPolicy.checkSend({ lead, kind: wakeupKind, messageType: 'template', phoneNumberId });
        if (!wakeupCheck.ok) {
          return res.status(200).json({ window_closed: true, blocked: true, code: wakeupCheck.code, message: wakeupCheck.message });
        }
        const slot = await numberHealth.reserveSlot(phoneNumberId, { countsTowardDailyCap: true });
        if (!slot.ok) {
          return res.status(200).json({ window_closed: true, blocked: true, code: slot.reason === 'daily_cap' ? 'DAILY_CAP_REACHED' : 'RATE_LIMITED', message: slot.message });
        }
        // Send the wake-up template to reopen the 24-hour window
        try {
          const templateRes = await axios.post(
            `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
            {
              messaging_product: 'whatsapp',
              to: (lead.phone || '').replace(/\D/g, ''),
              type: 'template',
              template: {
                name: WAKEUP_TEMPLATE,
                language: { code: 'en' }
              }
            },
            { headers: { Authorization: `Bearer ${waAccessToken}`, 'Content-Type': 'application/json' } }
          );
          const waMsgId = templateRes.data?.messages?.[0]?.id;
          console.log(`[Template Wakeup] Sent ${WAKEUP_TEMPLATE} for lead ${lead_id}`);

          // Save template message to DB so it appears in inbox
          const convCheck = await Conversations.findOne({ lead_id }, { id: 1 }).lean();
          if (convCheck) {
            const convId = convCheck.id;
            const existingTemplateMsg = waMsgId ? await Messages.exists({ wa_msg_id: waMsgId }) : null;
            if (!existingTemplateMsg) {
              await Messages.create({
                conversation_id: convId, direction: 'outbound', content: WAKEUP_TEMPLATE, msg_type: 'template',
                wa_msg_id: waMsgId, status: 'sent', is_ai: false, sent_at: new Date(),
              });
            }
            // Push to inbox in real-time
            io.emit('outgoing_message', { lead_id: String(lead.id), message: { direction: 'outbound', content: `[Template] ${WAKEUP_TEMPLATE}`, msg_type: 'template', sent_at: new Date() } });
          }
        } catch (err) {
          console.error('[Template Wakeup Error]', JSON.stringify(err.response?.data) || err.message);
        }
      } else {
        console.log('[Template Wakeup] Skipped — already sent in last 30 min for lead', lead_id);
      }

      // Return 200 OK so the frontend stays silent — the template was already sent
      return res.status(200).json({ 
        window_closed: true,
        message: 'Template sent to reopen chat window. Please wait for the customer to reply.'
      });
    }
    // ----------------------------

    const type = msg_type && msg_type !== 'text' ? msg_type : 'text';
    // Same send policy as every other path: workspace allowed to send, valid
    // number, and (free text / media) the 24-hour window.
    const sendCheck = await sendPolicy.checkSend({ lead, kind: 'service', messageType: type, phoneNumberId });
    if (!sendCheck.ok) return sendPolicy.respondBlocked(res, sendCheck);
    const payload = {
      messaging_product: 'whatsapp',
      to: (lead.phone || '').replace(/\D/g, ''),
      type: type,
    };

    if (reply_to_wa_id) {
      payload.context = { message_id: reply_to_wa_id };
    }

    // A file on the media server must belong to this workspace (throws 403).
    const storedMedia = type !== 'text' ? await mediaStore.resolveOwned(media_url) : null;
    // Any other local path must be a regular file inside this workspace's own
    // upload folder (no "..", absolute paths, symlinks, odd types or sizes).
    // Checked before anything is sent or stored.
    let localUpload = null;
    if (type !== 'text' && (!media_url || typeof media_url !== 'string')) return res.status(400).json({ error: 'Attach a file to send.', code: 'MEDIA_REQUIRED' });
    if (type !== 'text' && !storedMedia && typeof media_url === 'string' && !/^https?:\/\//i.test(media_url)) {
      localUpload = await tenantUploads.resolveTenantUpload(media_url, currentTenantId(), type);
    }

    let waMediaId = null;
    if (type !== 'text' && (storedMedia || localUpload)) {
      try {
        const fileName = storedMedia ? (storedMedia.filename || storedMedia.id) : localUpload.filename;
        const fileBuffer = storedMedia ? await mediaStore.read(storedMedia.ref) : await tenantUploads.readValidated(localUpload);
        const fd = new FormData();
        fd.append('messaging_product', 'whatsapp');
        const ext = path.extname(fileName).toLowerCase();
        let mimeType = 'application/octet-stream';
        // WhatsApp explicitly rejects bare "audio/ogg" for voice notes — it requires the
        // codecs parameter or the upload is rejected during processing (error 131053).
        if (ext === '.ogg' || /^audio\/ogg/i.test(storedMedia?.mime || '')) mimeType = 'audio/ogg; codecs=opus';
        else if (storedMedia?.mime) mimeType = storedMedia.mime;
        else if (localUpload) mimeType = localUpload.mime;

        fd.append('file', new Blob([fileBuffer], { type: mimeType }), fileName);
        const uploadRes = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/media`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${waAccessToken}` },
          body: fd,
        });
        const uploadData = await uploadRes.json();
        if (uploadRes.ok && uploadData.id) {
          waMediaId = uploadData.id;
        } else {
          console.warn('[WhatsApp Send] Direct media upload failed:', uploadRes.status);
        }
      } catch (e) {
        if (e instanceof tenantUploads.TenantUploadError) throw e;
        console.warn('[WhatsApp Send] Failed to upload media directly:', e.message);
      }
    }

    if (type === 'text') {
      payload.text = { body: message };
    } else {
      if (waMediaId) {
        payload[type] = { id: waMediaId };
      } else {
        // Meta fetches the link itself, possibly with retries: give it hours, not minutes.
        const fullMediaUrl = storedMedia ? mediaStore.signedUrl(storedMedia.ref, { ttl: 6 * 3600 })
          : localUpload ? `${process.env.PUBLIC_API_URL || ''}${localUpload.publicPath}`
          : media_url;
        payload[type] = { link: fullMediaUrl };
        if (type === 'document' && storedMedia?.filename) payload[type].filename = storedMedia.filename;
      }
      if (message && type !== 'audio') payload[type].caption = message; // Audio doesn't support caption
    }

    let waRes;
    try {
      waRes = await axios.post(
        `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
        payload,
        { headers: { Authorization: `Bearer ${waAccessToken}`, 'Content-Type': 'application/json' } }
      );
    } catch (err) {
      // Tell the agent why Meta refused it; nothing was sent or stored.
      const metaError = err.response?.data?.error;
      console.error('WA send refused:', err.response?.data || err.message);
      const reason = metaError?.error_data?.details || metaError?.message || 'WhatsApp refused the message';
      return res.status(502).json({ error: metaError?.code ? `${reason} (Meta error ${metaError.code})` : reason, code: 'WHATSAPP_SEND_FAILED' });
    }

    const waMessageId = waRes.data.messages?.[0]?.id;
    // Same normalization the inbound webhook uses (server.js ~2991) — conversations.phone
    // must always be the last 10 digits, or a lead whose phone has a country-code prefix
    // gets a second, orphaned conversations row the next time they message in.
    const phone = lead.phone?.replace(/\D/g, '').slice(-10);

    // Upsert the conversation thread (unique per phone+tenant)
    const conversation = await upsertOne(
      Conversations,
      { phone },
      { $set: { lead_id, last_message: message, last_message_at: new Date() } },
      { lead_id, status: 'open', last_message: message, last_message_at: new Date(), created_at: new Date() }
    );
    const conversationId = conversation.id;

    // Insert message into messages table
    const sentMessage = await Messages.create({
      conversation_id: conversationId, direction: 'outbound', content: message, msg_type: type, media_url: storedMedia?.ref || localUpload?.publicPath || media_url || null,
      wa_msg_id: waMessageId, status: 'sent', sent_at: new Date(), reply_to_wa_id: reply_to_wa_id || null, is_forwarded: is_forwarded || false,
    });
    const savedRows = [{
      id: sentMessage.id, direction: sentMessage.direction, content: sentMessage.content, type: sentMessage.msg_type,
      media_url: mediaStore.presentUrl(sentMessage.media_url), wa_msg_id: sentMessage.wa_msg_id, status: sentMessage.status, timestamp: sentMessage.sent_at,
      is_deleted: sentMessage.is_deleted, reply_to_wa_id: sentMessage.reply_to_wa_id, is_forwarded: sentMessage.is_forwarded,
    }];

    // Emit real-time event to all CRM clients
    io.emit('outgoing_message', { lead_id: Number(lead_id), message: savedRows[0] });

    res.json({ success: true, message: savedRows[0] });
  } catch (err) {
    if (err instanceof tenantUploads.TenantUploadError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err instanceof mediaStore.MediaStoreError && err.status === 403) return res.status(403).json({ error: err.message });
    console.error('WA send error:', err.message);

    res.status(500).json({ error: 'Failed to send message' });
  }
});
};
