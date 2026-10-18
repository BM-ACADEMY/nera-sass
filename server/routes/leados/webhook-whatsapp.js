/**
 * LeadOS routes: WhatsApp Cloud API webhook.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
module.exports = function registerWebhookWhatsappRoutes(app, ctx) {
const {
  CampaignLogs,
  Clients,
  Conversations,
  Leads,
  Messages,
  NO_ID,
  Templates,
  aiReplyQueue,
  axios: ctxAxios,
  fs: ctxFs,
  getLeadOSBrand,
  io,
  openRouter,
  phoneTailRegex,
  upsertOne,
} = ctx;
const path = ctx.path || require('path');
const fs = ctxFs || require('fs');
const axios = ctxAxios || require('axios');
const SERVER_ROOT = ctx.SERVER_ROOT || path.resolve(__dirname, '../../');
const { runAsSystem, runAsTenant } = require('../../services/tenantContext');
 // Store timeouts for delayed AI replies

// GET — Meta webhook verification
app.get('/webhook/whatsapp', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
    console.log('WhatsApp webhook verified');
    return res.send(challenge);
  }
  res.sendStatus(403);
});

// POST — incoming WhatsApp messages + template status updates
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const body = req.body;
    try {
      if (fs && fs.appendFileSync) {
        fs.appendFileSync(path.join(SERVER_ROOT, 'uploads', 'incoming_payloads.log'), `[${new Date().toISOString()}] ${JSON.stringify(body, null, 2)}\n\n`);
      }
    } catch (_) {}
    
    if (!body.object || body.object !== 'whatsapp_business_account') {
      return res.sendStatus(200);
    }

    // n8n may relay every Meta callback through this legacy LeadOS endpoint.
    // Route Alliance events into the isolated Alliance webhook before any
    // LeadOS contacts, conversations, messages, or campaign logs are touched.
    const alliancePhoneNumberId = String(process.env.ALLIANCE_WA_PHONE_NUMBER_ID || '');
    const isAllianceEvent = alliancePhoneNumberId && (body.entry || []).some((entry) =>
      (entry.changes || []).some((change) =>
        String(change.value?.metadata?.phone_number_id || '') === alliancePhoneNumberId
      )
    );
    if (isAllianceEvent) {
      const localPort = Number(process.env.PORT) || 3600;
      await axios.post(
        `http://127.0.0.1:${localPort}/api/alliance-inbox/webhook`,
        body,
        {
          headers: {
            'Content-Type': 'application/json',
            'x-internal-key': process.env.INTERNAL_API_KEY || '',
          },
          timeout: 10000,
        }
      );
      console.log('[Alliance Webhook] Routed n8n callback to isolated Alliance Inbox');
      return res.sendStatus(200);
    }

    // ── FILTER UNMANAGED PHONE NUMBERS ─────────────────────
    let hasValidPhoneNumber = true; // Default true for non-message events
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === 'messages') {
          hasValidPhoneNumber = false;
          const phoneNumberId = change.value?.metadata?.phone_number_id;
          if (phoneNumberId) {
            if (phoneNumberId === process.env.WA_PHONE_NUMBER_ID) {
              hasValidPhoneNumber = true;
            } else {
              if (await runAsSystem(() => Clients.exists({ phone_number_id: String(phoneNumberId) }), 'webhook-wa-check')) {
                hasValidPhoneNumber = true;
              }
            }
          }
        } else {
          hasValidPhoneNumber = true; // Let template updates pass
        }
      }
    }

    if (!hasValidPhoneNumber) {
      console.log('🚫 Ignored webhook for unmanaged phone_number_id');
      return res.sendStatus(200);
    }

    // FORWARD TO N8N WEBHOOK
    // This allows the Node server to act as a proxy if needed.
    // If the request is already coming from n8n (source=n8n), we SKIP forwarding to prevent an infinite loop.
    if (req.query.source !== 'n8n' && process.env.NODE_ENV !== 'test') {
      try {
        const n8nUrl = process.env.N8N_WHATSAPP_INBOUND_WEBHOOK_URL;
        await axios.post(n8nUrl, body);
        console.log('✅ Successfully forwarded payload to n8n Lead Integrator (WF00)');
      } catch (n8nErr) {
        console.error('⚠️ Failed to forward payload to n8n:', n8nErr.message);
      }
    }

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {

        // ── TEMPLATE STATUS UPDATES ──────────────────────────
        if (change.field === 'message_template_status_update') {
          const { event, message_template_id, message_template_name } = change.value || {};
          console.log(`📋 Template status update: ${message_template_name} → ${event}`);

          const template = await runAsSystem(() => Templates.findOne(
            { $or: [{ meta_template_id: String(message_template_id) }, { name: message_template_name }] },
            { id: 1, tenant_id: 1, name: 1 }
          ).lean(), 'webhook-wa-template-lookup');

          if (!template || !template.tenant_id) {
            console.warn(`[WA Webhook] Template "${message_template_name}" (${message_template_id}) not found or unassigned to a tenant`);
            continue;
          }

          let newStatus = null;
          if (event === 'APPROVED') newStatus = 'approved';
          else if (['REJECTED', 'PAUSED', 'DISABLED'].includes(event)) newStatus = 'rejected';
          else if (event === 'PENDING_DELETION') newStatus = 'draft';

          if (newStatus) {
            await runAsTenant(template.tenant_id, async () => {
              const templateStatusUpdate = { status: newStatus };
              if (newStatus === 'approved') templateStatusUpdate.approved_at = new Date();
              const updateResult = await Templates.updateOne(
                { id: template.id },
                { $set: templateStatusUpdate }
              );
              if (updateResult.matchedCount) {
                console.log(`✅ Template "${message_template_name}" updated to ${newStatus} (tenant ${template.tenant_id})`);
              }
            });
          }
          continue;
        }

        // ── INCOMING MESSAGES & DELIVERY STATUSES ────────────
        if (change.field !== 'messages') continue;
        const value = change.value || {};
        const phoneNumberId = value.metadata?.phone_number_id;

        if (!phoneNumberId) {
          console.warn('[WA Webhook] Missing phone_number_id in metadata');
          continue;
        }

        // Trusted tenant resolution via phone_number_id
        const client = await runAsSystem(() => Clients.findOne(
          { phone_number_id: String(phoneNumberId) },
          { id: 1, tenant_id: 1, name: 1, phone_number_id: 1, wa_access_token: 1 }
        ).lean(), 'webhook-wa-client-lookup');

        if (!client || !client.tenant_id) {
          console.warn(`[WA Webhook] Unmanaged or unmapped phone_number_id: ${phoneNumberId}`);
          continue;
        }

        // Run all message and status processing in the resolved tenant context
        await runAsTenant(client.tenant_id, async () => {
          // Handle delivery/read status receipts
          if (value.statuses) {
            for (const s of value.statuses) {
              const wamid = s.id;
              const newStatus = s.status; // 'sent', 'delivered', 'read', 'failed'
              const errorMsg = s.errors ? s.errors[0].title : null;
              if (!wamid) continue;

              await Messages.updateMany({ wa_msg_id: wamid }, { $set: { status: newStatus } });
              if (newStatus === 'failed' && errorMsg) {
                await CampaignLogs.updateMany({ wa_message_id: wamid }, { $set: { status: newStatus, error_message: errorMsg } });
              } else {
                await CampaignLogs.updateMany({ wa_message_id: wamid }, { $set: { status: newStatus } });
              }

              // Emit real-time status update to CRM (scoped to tenant room)
              io.emit('message_status', { wa_message_id: wamid, status: newStatus });
              if (newStatus === 'failed') {
                console.log(`[Webhook Status] ${wamid} → ${newStatus} (Error: ${errorMsg})`);
              } else {
                console.log(`[Webhook Status] ${wamid} → ${newStatus}`);
              }
            }
          }

          // Handle ALL incoming messages from customers (text, image, audio, video, document)
          for (const msg of value.messages || []) {
            const phone = msg.from;       // e.g. '919876543210'
            const isForwarded = msg.context?.forwarded || msg.context?.frequently_forwarded || false;
            const waMessageId = msg.id;
            const referralAdId = msg.referral?.source_id ? String(msg.referral.source_id) : null;
            let referralCampaign = null;

            if (referralAdId) {
              referralCampaign = (await Leads.find({ ad_id: referralAdId }, { _id: 0, campaign_id: 1, campaign_name: 1, ad_id: 1, ad_name: 1, client_id: 1, updated_at: 1 }).lean())
                .sort((a, b) => Number(a.campaign_name == null) - Number(b.campaign_name == null) || new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
                .map(({ updated_at, ...row }) => row)[0] || null;
            }

            // Extract text and media info based on message type
            let text = '';
            let mediaUrl = null;
            let msgType = msg.type || 'text';

            if (msg.type === 'text') {
              text = msg.text?.body || '';
            } else if (msg.type === 'image') {
              text = msg.image?.caption || '[Image]';
              mediaUrl = msg.image?.id ? `https://graph.facebook.com/v18.0/${msg.image.id}` : null;
            } else if (msg.type === 'audio') {
              text = '[Voice Message]';
              mediaUrl = msg.audio?.id ? `https://graph.facebook.com/v18.0/${msg.audio.id}` : null;
            } else if (msg.video) {
              text = msg.video?.caption || '[Video]';
              mediaUrl = msg.video?.id ? `https://graph.facebook.com/v18.0/${msg.video.id}` : null;
            } else if (msg.document) {
              text = msg.document?.filename || '[Document]';
              mediaUrl = msg.document?.id ? `https://graph.facebook.com/v18.0/${msg.document.id}` : null;
            } else if (msg.type === 'button') {
              text = msg.button?.text || '[Button Reply]';
            } else if (msg.type === 'interactive') {
              text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '[Interactive Reply]';
            } else {
              console.log(`[Webhook] Message type: ${msg.type} from ${phone}`);
              text = `[${msg.type}]`;
            }

            // Find or auto-create lead by phone number within this tenant
            const phoneDigits = phone.replace(/\D/g, '');
            let lead = await Leads.findOne({ phone: phoneTailRegex(phoneDigits) }, NO_ID).sort({ created_at: -1 }).lean();
            if (lead) {
              const leadClient = lead.client_id != null ? await Clients.findOne({ id: lead.client_id }, { wa_access_token: 1, phone_number_id: 1 }).lean() : null;
              lead = { ...lead, client_wa_token: leadClient?.wa_access_token ?? null, client_phone_number_id: leadClient?.phone_number_id ?? null };
            }

            if (!lead) {
              const newLead = await Leads.create({
                name: value.contacts?.[0]?.profile?.name || phone,
                phone,
                source: referralAdId ? 'facebook' : 'WhatsApp',
                client_id: client.id,
                status: 'new', score: 10, flow_step: 'welcome', created_at: new Date(),
                campaign_id: referralCampaign?.campaign_id || null,
                campaign_name: referralCampaign?.campaign_name || null,
                ad_id: referralAdId,
                ad_name: referralCampaign?.ad_name || msg.referral?.headline || null,
              });
              lead = newLead.toObject();
              lead.client_wa_token = client?.wa_access_token;
              lead.client_phone_number_id = client?.phone_number_id;
              console.log(`[Webhook] Auto-created lead for phone: ${phone} (tenant ${client.tenant_id})`);
            } else {
              if (lead.phone !== phone) {
                await Leads.updateOne({ id: lead.id }, { $set: { phone } });
                lead.phone = phone;
              }
              if (referralAdId) {
                const referralUpdate = { source: 'facebook', ad_id: referralAdId, updated_at: new Date(), client_id: client.id };
                if (referralCampaign?.campaign_id) referralUpdate.campaign_id = referralCampaign.campaign_id;
                if (referralCampaign?.campaign_name) referralUpdate.campaign_name = referralCampaign.campaign_name;
                if (referralCampaign?.ad_name || msg.referral?.headline) referralUpdate.ad_name = referralCampaign?.ad_name || msg.referral?.headline;
                const updatedLead = await Leads.findOneAndUpdate({ id: lead.id }, { $set: referralUpdate }, { new: true, projection: NO_ID }).lean();
                lead = { ...lead, ...(updatedLead || {}) };
              }
            }

            // Audio transcription
            if (msg.type === 'audio' && msg.audio?.id && openRouter.isConfigured) {
              try {
                const waToken = lead.client_wa_token || client?.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN;
                if (waToken) {
                  console.log(`[Audio] Fetching media URL for ${msg.audio.id}`);
                  const mediaRes = await axios.get(`https://graph.facebook.com/v18.0/${msg.audio.id}`, {
                    headers: { Authorization: `Bearer ${waToken}` }
                  });

                  if (mediaRes.data && mediaRes.data.url) {
                    console.log(`[Audio] Downloading audio from WhatsApp...`);
                    const audioRes = await axios.get(mediaRes.data.url, {
                      headers: { Authorization: `Bearer ${waToken}` },
                      responseType: 'arraybuffer'
                    });

                    const mimeType = mediaRes.data.mime_type || msg.audio?.mime_type || 'audio/ogg';
                    console.log('[Audio] Transcribing with OpenRouter...');
                    const transcription = await openRouter.models.generateContent({
                      model: openRouter.AUDIO_MODEL,
                      contents: [
                        {
                          text: 'Transcribe this WhatsApp voice note precisely in its original language. Return only the spoken words, without commentary or formatting.',
                        },
                        {
                          inlineData: {
                            mimeType,
                            data: Buffer.from(audioRes.data).toString('base64'),
                          },
                        },
                      ],
                    });
                    const transcriptionText = transcription?.text;

                    if (transcriptionText) {
                      console.log(`[Audio] Transcription success: ${transcriptionText}`);
                      text = transcriptionText.trim();
                    }
                  }
                }
              } catch (err) {
                console.error('[Audio Transcription Error]', err.response?.data || err.message);
                fs.appendFileSync(path.join(SERVER_ROOT, 'uploads', 'audio_error.txt'), `[${new Date().toISOString()}] ${err.message}\n${err.stack}\n`);
              }
            }

            // Normalize phone to 10 digits
            const normalizedPhone = phoneDigits.slice(-10);

            // Upsert conversation thread within tenant
            const conversation = await upsertOne(
              Conversations,
              { phone: normalizedPhone },
              { $set: { lead_id: lead.id, last_message: text, last_message_at: new Date() } },
              { lead_id: lead.id, status: 'open', last_message: text, last_message_at: new Date(), created_at: new Date() }
            );
            const conversationId = conversation.id;

            // Save incoming message to messages table (avoid duplicate wa_msg_id)
            const existingMsg = waMessageId ? await Messages.exists({ wa_msg_id: waMessageId }) : null;

            if (existingMsg) {
              console.log(`[Webhook] Duplicate message skipped (wa_msg_id: ${waMessageId})`);
            } else {
              const inbound = await Messages.create({
                conversation_id: conversationId, direction: 'inbound', content: text, msg_type: msgType, media_url: mediaUrl,
                wa_msg_id: waMessageId, status: 'delivered', is_ai: false, sent_at: new Date(), is_forwarded: isForwarded,
              });
              const savedRows = [{
                id: inbound.id, direction: inbound.direction, content: inbound.content, type: inbound.msg_type, media_url: inbound.media_url,
                wa_msg_id: inbound.wa_msg_id, status: inbound.status, timestamp: inbound.sent_at, is_forwarded: inbound.is_forwarded,
              }];

              await Conversations.updateOne({ id: conversationId }, [{ $set: { unread_count: { $add: [{ $ifNull: ['$unread_count', 0] }, 1] } } }]);

              io.emit('incoming_message', { lead_id: String(lead.id), message: savedRows[0] });
              console.log(`[Webhook] ✅ Saved inbound ${msgType} from ${phone} → lead ${lead.id}, msg_id ${savedRows[0].id} (tenant ${client.tenant_id})`);

              const shouldTriggerAI = ['text', 'button', 'interactive', 'audio'].includes(msg.type);
              if (shouldTriggerAI && process.env.N8N_WEBHOOK_URL && req.query.source !== 'n8n' && process.env.NODE_ENV !== 'test') {
                if (aiReplyQueue.has(lead.id)) {
                  clearTimeout(aiReplyQueue.get(lead.id));
                }

                io.emit('ai_typing', { lead_id: String(lead.id), typing: true, status: 'waiting' });

                const timer = setTimeout(() => {
                  aiReplyQueue.delete(lead.id);
                  io.emit('ai_typing', { lead_id: String(lead.id), typing: true, status: 'composing' });

                  axios.post(process.env.N8N_WEBHOOK_URL, {
                    lead_id: lead.id,
                    phone,
                    message: text,
                    phone_number_id: lead.client_phone_number_id || phoneNumberId,
                    wa_access_token: lead.client_wa_token || process.env.META_PAGE_ACCESS_TOKEN
                  }).catch(e => console.error('[n8n forward error]', e.message));
                }, 60000);

                if (typeof timer.unref === 'function') timer.unref();
                aiReplyQueue.set(lead.id, timer);
              }
            }
          }
        });
      }
    }
    return res.sendStatus(200);
  } catch (err) {
    console.error('WA webhook error:', err);
    return res.sendStatus(200);
  }
});
};
