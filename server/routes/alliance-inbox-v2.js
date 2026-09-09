const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(require('@ffmpeg-installer/ffmpeg').path);
const { convertToWhatsAppVoiceNote } = require('../services/voice-note-encoder');
const db = require('../db/connection');
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
    const result = await db.query(`SELECT * FROM alliance_inbox_settings WHERE active = TRUE ORDER BY id LIMIT 1`);
    return result.rows[0] || (process.env.ALLIANCE_WA_PHONE_NUMBER_ID ? {
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
  const syncImportedProspects = async () => {
    const settings = await configuredPhoneId();
    const phoneNumberId = settings?.phone_number_id || process.env.ALLIANCE_WA_PHONE_NUMBER_ID || 'unconfigured';
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE alliance_inbox_contacts c
         SET name = COALESCE(p.name, p.business_name, c.name),
             profile_name = COALESCE(p.name, p.business_name, c.profile_name),
             phone = CASE WHEN NOT EXISTS (
               SELECT 1 FROM alliance_inbox_contacts other
               WHERE other.id <> c.id AND other.phone = p.phone
             ) THEN p.phone ELSE c.phone END,
             wa_id = CASE WHEN NOT EXISTS (
               SELECT 1 FROM alliance_inbox_contacts other
               WHERE other.id <> c.id AND other.wa_id = p.phone
             ) THEN p.phone ELSE c.wa_id END,
             source = COALESCE(p.source, c.source, 'file_upload'),
             custom_fields = c.custom_fields || jsonb_build_object(
               'business_name', p.business_name, 'audience', p.audience,
               'email', p.email, 'industry', p.industry, 'location', p.location
             ),
             updated_at = NOW()
         FROM alliance_prospects p
         WHERE c.prospect_id = p.id`
      );
      await client.query(
        `UPDATE alliance_inbox_contacts c
         SET prospect_id = p.id, name = COALESCE(p.name, p.business_name, c.name),
             source = COALESCE(c.source, p.source, 'file_upload'),
             custom_fields = c.custom_fields || jsonb_build_object(
               'business_name', p.business_name, 'audience', p.audience, 'email', p.email
             ), updated_at = NOW()
         FROM alliance_prospects p
         WHERE c.prospect_id IS NULL AND c.phone IS NOT NULL AND p.phone = c.phone
           AND NOT EXISTS (SELECT 1 FROM alliance_inbox_contacts linked WHERE linked.prospect_id = p.id)`
      );
      await client.query(
        `INSERT INTO alliance_inbox_contacts
          (prospect_id, wa_id, phone, name, profile_name, source, custom_fields)
         SELECT p.id, p.phone, p.phone, COALESCE(p.name, p.business_name),
                COALESCE(p.name, p.business_name), COALESCE(p.source, 'file_upload'),
                jsonb_build_object('business_name', p.business_name, 'audience', p.audience, 'email', p.email)
         FROM alliance_prospects p
         WHERE NOT EXISTS (SELECT 1 FROM alliance_inbox_contacts c WHERE c.prospect_id = p.id)
           AND NOT EXISTS (SELECT 1 FROM alliance_inbox_contacts c WHERE p.phone IS NOT NULL AND c.phone = p.phone)`
      );
      await client.query(
        `INSERT INTO alliance_inbox_conversations (contact_id, phone_number_id, welcome_status)
         SELECT c.id, $1,
                CASE WHEN p.phone IS NOT NULL AND p.consent = TRUE THEN 'not_queued' ELSE 'not_eligible' END
         FROM alliance_inbox_contacts c
         LEFT JOIN alliance_prospects p ON p.id = c.prospect_id
         WHERE NOT EXISTS (SELECT 1 FROM alliance_inbox_conversations cv WHERE cv.contact_id = c.id)`,
        [phoneNumberId]
      );
      await client.query(
        `INSERT INTO alliance_inbox_messages
          (conversation_id, contact_id, direction, msg_type, content, status, raw_payload)
         SELECT cv.id, c.id, 'outbound', 'template', t.body, 'queued',
                jsonb_build_object(
                  'purpose', 'welcome', 'template_name', t.template_name,
                  'language', COALESCE(t.language, 'en'), 'prospect_id', p.id
                )
         FROM alliance_inbox_contacts c
         JOIN alliance_prospects p ON p.id = c.prospect_id
         JOIN alliance_inbox_conversations cv ON cv.contact_id = c.id
         JOIN alliance_templates t ON t.audience = p.audience
           AND t.channel = 'whatsapp' AND t.touch_no = 1 AND t.active = TRUE
           AND t.template_name IS NOT NULL
           AND LOWER(COALESCE(t.provider_status, 'approved')) = 'approved'
         WHERE cv.welcome_status = 'not_queued'
           AND NOT EXISTS (
             SELECT 1 FROM alliance_inbox_messages m
             WHERE m.conversation_id = cv.id AND m.msg_type = 'template'
               AND m.raw_payload->>'purpose' = 'welcome'
           )`
      );
      await client.query(
        `UPDATE alliance_inbox_conversations cv
         SET welcome_status = 'queued', welcome_template_name = t.template_name,
             welcome_error = NULL, updated_at = NOW()
         FROM alliance_inbox_contacts c
         JOIN alliance_prospects p ON p.id = c.prospect_id
         JOIN alliance_templates t ON t.audience = p.audience
           AND t.channel = 'whatsapp' AND t.touch_no = 1 AND t.active = TRUE
           AND t.template_name IS NOT NULL
           AND LOWER(COALESCE(t.provider_status, 'approved')) = 'approved'
         WHERE cv.contact_id = c.id AND cv.welcome_status = 'not_queued'`
      );
      await client.query(
        `UPDATE alliance_inbox_conversations cv
         SET welcome_status = 'missing_template',
             welcome_error = 'No approved WhatsApp touch-1 template is configured for this audience.',
             updated_at = NOW()
         FROM alliance_inbox_contacts c
         WHERE cv.contact_id = c.id AND cv.welcome_status = 'not_queued'
           AND NOT EXISTS (
             SELECT 1 FROM alliance_prospects p
             JOIN alliance_templates t ON t.audience = p.audience
               AND t.channel = 'whatsapp' AND t.touch_no = 1 AND t.active = TRUE
               AND t.template_name IS NOT NULL
               AND LOWER(COALESCE(t.provider_status, 'approved')) = 'approved'
             WHERE p.id = c.prospect_id
           )`
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
  const messageSelect = `
    SELECT m.id, m.wa_msg_id, m.direction, m.msg_type, m.msg_type AS type,
           CASE WHEN m.msg_type='unsupported' AND m.content='[unsupported]'
             THEN 'This WhatsApp message type is not available through Meta. Ask the sender to resend it as text, image, audio, or document.'
             ELSE m.content END AS content,
           m.media_id, m.media_url, m.mime_type, m.filename, m.status, m.reactions,
           m.is_starred, m.is_deleted, m.pinned_until, m.sent_at, m.sent_at AS timestamp,
           COALESCE(m.raw_payload->'buttons',template.buttons,'[]'::jsonb) AS template_buttons,
           (m.raw_payload->>'sender_type' = 'ai') AS is_ai,
           COALESCE(m.raw_payload->>'sender_type', CASE WHEN m.raw_payload->>'purpose'='automated_followup' THEN 'automation' END) AS sender_type,
           CASE WHEN parent.id IS NULL THEN NULL ELSE json_build_object(
             'id', parent.id, 'wa_msg_id', parent.wa_msg_id, 'content', parent.content,
             'media_url', parent.media_url, 'type', parent.msg_type
           ) END AS reply_to
    FROM alliance_inbox_messages m
    LEFT JOIN templates template ON template.name=m.raw_payload->>'template_name'
    LEFT JOIN alliance_inbox_messages parent ON parent.wa_msg_id = m.reply_to_wa_msg_id`;

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
            const updated = await db.query(
              `UPDATE alliance_inbox_messages SET status = $1, raw_payload = raw_payload || $2::jsonb WHERE wa_msg_id = $3 RETURNING *`,
              [statusEvent.status, JSON.stringify({ status_event: statusEvent }), statusEvent.id]
            );
            if (updated.rowCount) io.emit('alliance_message_status', { wa_message_id: statusEvent.id, status: statusEvent.status });
            await db.query(
              `UPDATE alliance_whatsapp_campaign_recipients
               SET status=$1,error_message=CASE WHEN $1='failed' THEN $3 ELSE error_message END
               WHERE wa_msg_id=$2 AND status IN ('sent','delivered','read','failed')`,
              [statusEvent.status, statusEvent.id, failureReason]
            ).catch(() => {});
            if (statusEvent.status === 'failed') {
              await db.query(
                `UPDATE alliance_whatsapp_followup_jobs job
                 SET status='cancelled',error_message=$2
                 FROM alliance_whatsapp_campaign_recipients recipient
                 WHERE recipient.campaign_id=job.campaign_id AND recipient.prospect_id=job.prospect_id
                   AND recipient.wa_msg_id=$1 AND job.status IN ('pending','claimed')`,
                [statusEvent.id, `Initial WhatsApp delivery failed: ${failureReason}`.slice(0, 2000)]
              ).catch(() => {});
            }
          }

          for (const incoming of value.messages || []) {
            const phone = normalizePhone(incoming.from);
            const profileName = value.contacts?.find((item) => normalizePhone(item.wa_id) === phone)?.profile?.name || phone;
            const client = await db.connect();
            try {
              await client.query('BEGIN');
              const contactResult = await client.query(
                `INSERT INTO alliance_inbox_contacts (wa_id, phone, name, profile_name)
                 VALUES ($1,$1,$2,$2)
                 ON CONFLICT (wa_id) DO UPDATE SET profile_name = EXCLUDED.profile_name, updated_at = NOW()
                 RETURNING *`, [phone, profileName]
              );
              const contact = contactResult.rows[0];
              const conversationResult = await client.query(
                `INSERT INTO alliance_inbox_conversations (contact_id, phone_number_id)
                 VALUES ($1,$2) ON CONFLICT (contact_id) DO UPDATE SET updated_at = NOW() RETURNING *`,
                [contact.id, settings.phone_number_id]
              );
              const conversation = conversationResult.rows[0];
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
              const saved = await client.query(
                `INSERT INTO alliance_inbox_messages
                  (conversation_id, contact_id, wa_msg_id, direction, msg_type, content, media_id, media_url, mime_type, filename, status, reply_to_wa_msg_id, raw_payload, sent_at)
                 VALUES ($1,$2,$3,'inbound',$4,$5,$6,$7,$8,$9,'received',$10,$11,to_timestamp($12))
                 ON CONFLICT (wa_msg_id) DO NOTHING RETURNING *`,
                [conversation.id, contact.id, incoming.id, type, content, mediaId, mediaUrl, typedPayload.mime_type || null,
                  typedPayload.filename || null, replyToId, JSON.stringify(incoming), Number(incoming.timestamp || Math.floor(Date.now() / 1000))]
              );
              if (saved.rowCount) {
                await client.query(
                  `UPDATE alliance_inbox_conversations SET unread_count = unread_count + 1, last_message = $1,
                   last_message_at = $2, last_inbound_at = $2, ai_nudge_count = 0, updated_at = NOW() WHERE id = $3`,
                  [content, saved.rows[0].sent_at, conversation.id]
                );
                if (contact.prospect_id) {
                  await client.query(`UPDATE alliance_prospects SET status='replied',updated_at=NOW() WHERE id=$1 AND status NOT IN ('converted','closed','not_interested','unsubscribed')`,[contact.prospect_id]);
                  await client.query(
                    `UPDATE alliance_whatsapp_campaign_recipients SET status='cancelled',error_message='Recipient replied.'
                     WHERE prospect_id=$1 AND status='queued'`,
                    [contact.prospect_id]
                  );
                  await client.query(
                    `UPDATE alliance_whatsapp_followup_jobs SET status='cancelled',error_message='Recipient replied.'
                     WHERE prospect_id=$1 AND status IN ('pending','claimed')`,
                    [contact.prospect_id]
                  );
                  await scoreAllianceProspect(contact.prospect_id, {
                    message: content,
                    channel: 'whatsapp',
                    eventKey: incoming.id,
                  }, client);
                }
              }
              await client.query('COMMIT');
              if (saved.rowCount) io.emit('alliance_incoming_message', { lead_id: String(contact.id), message: { ...saved.rows[0], type, timestamp: saved.rows[0].sent_at } });
            } catch (error) {
              await client.query('ROLLBACK');
              console.error('Alliance inbound message failed:', error);
            } finally { client.release(); }
          }
        }
      }
    } catch (error) { console.error('Alliance webhook processing failed:', error); }
  });

  router.get('/media/:mediaId', async (req, res) => {
    try {
      const referenced = await db.query(`SELECT 1 FROM alliance_inbox_messages WHERE media_id = $1 LIMIT 1`, [req.params.mediaId]);
      if (!referenced.rowCount) return res.sendStatus(404);
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
      const result = await db.query(`SELECT id, name, color FROM alliance_inbox_tags ORDER BY name ASC`);
      res.json(result.rows);
    } catch (e) {
      res.status(500).json({ error: 'Failed to fetch tags' });
    }
  });

  router.post('/tags', async (req, res) => {
    try {
      const { name, color } = req.body;
      if (!name) return res.status(400).json({ error: 'Tag name is required.' });
      const result = await db.query(
        `INSERT INTO alliance_inbox_tags (name, color) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET color = EXCLUDED.color RETURNING *`,
        [name.trim(), color || '#00a884']
      );
      res.json(result.rows[0]);
    } catch (e) {
      res.status(500).json({ error: 'Failed to create tag' });
    }
  });

  router.delete('/tags/:id', async (req, res) => {
    try {
      await db.query(`DELETE FROM alliance_inbox_tags WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to delete tag' });
    }
  });

  router.post('/contacts/:id/tags', async (req, res) => {
    try {
      const { tagId } = req.body;
      await db.query(`INSERT INTO alliance_contact_tags (contact_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [req.params.id, tagId]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to assign tag' });
    }
  });

  router.delete('/contacts/:id/tags/:tagId', async (req, res) => {
    try {
      await db.query(`DELETE FROM alliance_contact_tags WHERE contact_id = $1 AND tag_id = $2`, [req.params.id, req.params.tagId]);
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
    const result = await db.query(
      `SELECT c.id, c.name, c.profile_name, c.phone, c.status, c.interest, c.source, c.prospect_id,
              COALESCE(p.ai_score,10) AS score,
              cv.last_message AS last, cv.last_message AS last_msg, cv.last_message_at AS time,
              cv.unread_count AS unread, cv.last_inbound_at, cv.welcome_status,
              cv.welcome_template_name, cv.welcome_wa_msg_id, cv.welcome_sent_at, cv.welcome_error,
              (
                SELECT COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color)), '[]')
                FROM alliance_contact_tags ct
                JOIN alliance_inbox_tags t ON t.id = ct.tag_id
                WHERE ct.contact_id = c.id
              ) AS tags
       FROM alliance_inbox_contacts c
       JOIN alliance_inbox_conversations cv ON cv.contact_id = c.id
       LEFT JOIN alliance_prospects p ON p.id = c.prospect_id
       WHERE ($1 = '' OR c.name ILIKE '%' || $1 || '%' OR c.phone ILIKE '%' || $1 || '%')
       ORDER BY cv.last_message_at DESC NULLS LAST LIMIT $2 OFFSET $3`,
      [search, limit, offset]
    );
    const count = await db.query(`SELECT COUNT(*)::int AS total FROM alliance_inbox_contacts`);
    res.json({ leads: result.rows, total: count.rows[0].total });
  });

  router.get('/contacts/:id', async (req, res) => {
    const result = await db.query(
      `SELECT c.*, COALESCE(p.ai_score,10) AS score, cv.last_inbound_at, cv.welcome_status, cv.welcome_template_name,
              cv.welcome_wa_msg_id, cv.welcome_sent_at, cv.welcome_error,
              (
                SELECT COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color)), '[]')
                FROM alliance_contact_tags ct
                JOIN alliance_inbox_tags t ON t.id = ct.tag_id
                WHERE ct.contact_id = c.id
              ) AS tags
       FROM alliance_inbox_contacts c
       JOIN alliance_inbox_conversations cv ON cv.contact_id = c.id
       LEFT JOIN alliance_prospects p ON p.id = c.prospect_id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Alliance contact not found.' });
    res.json({ lead: result.rows[0] });
  });

  router.patch('/contacts/:id', async (req, res) => {
    const result = await db.query(
      `UPDATE alliance_inbox_contacts SET name = COALESCE($1,name), status = COALESCE($2,status),
       interest = COALESCE($3,interest), updated_at = NOW() WHERE id = $4 RETURNING *`,
      [req.body.name || null, req.body.status || null, req.body.interest || null, req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Alliance contact not found.' });
    if (result.rows[0].prospect_id && req.body.status) {
      const status = String(req.body.status).toLowerCase();
      const allowed = ['pending','in_process','interested','converted','closed','complete','completed','not_interested','unsubscribed'];
      if (allowed.includes(status)) await db.query(`UPDATE alliance_prospects SET status=$1,updated_at=NOW() WHERE id=$2`,[status,result.rows[0].prospect_id]);
      if (['converted','closed','complete','completed','not_interested','unsubscribed'].includes(status)) {
        await db.query(`UPDATE alliance_whatsapp_followup_jobs SET status='cancelled',error_message=$1 WHERE prospect_id=$2 AND status IN ('pending','claimed')`,[`Prospect ${status}.`,result.rows[0].prospect_id]);
      }
    }
    res.json({ lead: result.rows[0] });
  });

  router.get('/contacts/:id/messages', async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const result = await db.query(
      `${messageSelect} WHERE m.contact_id = $1 ORDER BY m.sent_at DESC LIMIT $2 OFFSET $3`,
      [req.params.id, limit, offset]
    );
    res.json({ messages: result.rows.reverse() });
  });

  router.put('/conversations/:contactId/read', async (req, res) => {
    await db.query(`UPDATE alliance_inbox_conversations SET unread_count = 0 WHERE contact_id = $1`, [req.params.contactId]);
    res.json({ success: true });
  });

  router.post('/contacts/:id/ai-suggestion', async (req, res) => {
    try {
      if (!openRouter.isConfigured) return res.status(503).json({ error: 'OpenRouter is not configured on the API server.' });
      const contact = await db.query(
        `SELECT c.id,c.name,c.phone,c.prospect_id,p.business_name,p.audience,p.industry,p.location,p.status,a.brand
         FROM alliance_inbox_contacts c
         LEFT JOIN alliance_prospects p ON p.id=c.prospect_id
         LEFT JOIN alliance_audiences a ON a.code=p.audience
         WHERE c.id=$1`, [req.params.id]
      );
      if (!contact.rowCount) return res.status(404).json({ error: 'Alliance contact not found.' });
      const history = await db.query(
        `SELECT direction,content,msg_type,sent_at FROM alliance_inbox_messages
         WHERE contact_id=$1 AND is_deleted=FALSE ORDER BY sent_at DESC LIMIT 30`, [req.params.id]
      );
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
    await db.query(
      `INSERT INTO alliance_inbox_media (storage_path, public_url, mime_type, filename, file_size, direction)
       VALUES ($1,$2,$3,$4,$5,'outbound')`,
      [uploaded.path, fileUrl, uploaded.mimetype, req.file.originalname, req.file.size]
    );

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
    const contactResult = await db.query(
      `SELECT c.*, cv.id AS conversation_id, cv.last_inbound_at FROM alliance_inbox_contacts c
       JOIN alliance_inbox_conversations cv ON cv.contact_id = c.id WHERE c.id = $1`, [req.params.id]
    );
    if (!contactResult.rowCount) return res.status(404).json({ error: 'Alliance contact not found.' });
    const contact = contactResult.rows[0];
    const settings = await configuredPhoneId();
    const token = accessToken(settings);
    if (!settings?.phone_number_id || !token) return res.status(503).json({ error: 'Alliance WhatsApp Phone Number ID or access token is not configured.' });
    if (!contact.last_inbound_at || Date.now() - new Date(contact.last_inbound_at).getTime() > 24 * 60 * 60 * 1000) {
      try {
        const recent = await db.query(
          `SELECT id FROM alliance_inbox_messages
           WHERE contact_id=$1 AND direction='outbound' AND msg_type='template'
             AND raw_payload->>'purpose'='window_reopen'
             AND sent_at>NOW()-INTERVAL '6 hours' LIMIT 1`,
          [contact.id]
        );
        if (recent.rowCount) return res.json({
          success: true, window_closed: true, template_sent: false,
          message: 'The service window is closed. A reopen template was already sent recently; wait for the recipient to reply.',
        });
        const preferred = String(process.env.ALLIANCE_WA_REOPEN_TEMPLATE || 'common_welcome_message');
        const templateResult = await db.query(
          `SELECT id,name,language,body,status FROM templates
           WHERE LOWER(status)='approved' AND name=ANY($1::text[])
           ORDER BY CASE WHEN name=$2 THEN 0 WHEN name='common_welcome_message' THEN 1 ELSE 2 END`,
          [[preferred,'common_welcome_message','new_lead_welcome'],preferred]
        );
        const reopenTemplate = templateResult.rows.find((item) => !/\{\{\d+\}\}/.test(String(item.body || '')));
        if (!reopenTemplate) return res.status(409).json({
          error: 'The 24-hour window is closed and no approved zero-variable reopen template is configured.',
          reason: 'window_closed', template_sent: false,
        });
        const meta = await axios.post(`https://graph.facebook.com/v19.0/${settings.phone_number_id}/messages`, {
          messaging_product: 'whatsapp', recipient_type: 'individual', to: contact.phone, type: 'template',
          template: { name: reopenTemplate.name, language: { code: reopenTemplate.language || 'en' } },
        }, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 20000 });
        const waMessageId = meta.data?.messages?.[0]?.id || null;
        const saved = await db.query(
          `INSERT INTO alliance_inbox_messages
            (conversation_id,contact_id,wa_msg_id,direction,msg_type,content,status,raw_payload,sent_at)
           VALUES($1,$2,$3,'outbound','template',$4,'sent',$5::jsonb,NOW()) RETURNING *`,
          [contact.conversation_id,contact.id,waMessageId,reopenTemplate.body,JSON.stringify({ purpose:'window_reopen',template_name:reopenTemplate.name,attempted_message:String(req.body.message||'') })]
        );
        await db.query(`UPDATE alliance_inbox_conversations SET last_message=$1,last_message_at=NOW(),updated_at=NOW() WHERE id=$2`,[reopenTemplate.body,contact.conversation_id]);
        const message = { ...saved.rows[0], type: 'template', timestamp: saved.rows[0].sent_at };
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
      const saved = await db.query(
        `INSERT INTO alliance_inbox_messages
          (conversation_id, contact_id, wa_msg_id, direction, msg_type, content, media_url, status, reply_to_wa_msg_id, raw_payload)
         VALUES ($1,$2,$3,'outbound',$4,$5,$6,'sent',$7,$8) RETURNING *`,
        [contact.conversation_id, contact.id, waMessageId, type, content, req.body.mediaUrl || null,
          req.body.replyToMessageId || null, JSON.stringify({ ...meta.data, sender_type: req.body.senderType === 'ai' ? 'ai' : 'human' })]
      );
      await db.query(`UPDATE alliance_inbox_conversations SET last_message = $1, last_message_at = NOW(), updated_at = NOW() WHERE id = $2`, [content || `[${type}]`, contact.conversation_id]);
      if (contact.prospect_id) {
        scheduleAllianceInactivityReminder(contact.prospect_id, saved.rows[0].sent_at).catch((error) => {
          console.error('Alliance inactivity reminder scheduling failed:', error.message);
        });
      }
      const senderType = req.body.senderType === 'ai' ? 'ai' : 'human';
      const message = { ...saved.rows[0], type, timestamp: saved.rows[0].sent_at, sender_type: senderType, is_ai: senderType === 'ai' };
      io.emit('alliance_outgoing_message', { lead_id: String(contact.id), message });
      res.json({ success: true, message });
    } catch (error) {
      console.error('Alliance WhatsApp send failed:', error.response?.data || error.message);
      res.status(502).json({ error: error.response?.data?.error?.message || 'Alliance WhatsApp send failed.' });
    }
  });

  const updateMessage = (suffix, build) => router.put(`/messages/:id/${suffix}`, async (req, res) => {
    const { sql, params } = build(req);
    const result = await db.query(`${sql} RETURNING *`, params);
    if (!result.rowCount) return res.status(404).json({ error: 'Message not found.' });
    io.emit('alliance_message_edited', result.rows[0]);
    res.json({ success: true, message: result.rows[0] });
  });
  updateMessage('edit', (req) => ({ sql: `UPDATE alliance_inbox_messages SET content = $1 WHERE id = $2`, params: [req.body.content, req.params.id] }));
  updateMessage('delete', (req) => ({ sql: `UPDATE alliance_inbox_messages SET is_deleted = TRUE WHERE id = $1`, params: [req.params.id] }));
  updateMessage('star', (req) => ({ sql: `UPDATE alliance_inbox_messages SET is_starred = $1 WHERE id = $2`, params: [Boolean(req.body.is_starred), req.params.id] }));
  updateMessage('pin', (req) => req.body.unpin
    ? ({ sql: `UPDATE alliance_inbox_messages SET pinned_until = NULL WHERE id = $1`, params: [req.params.id] })
    : ({ sql: `UPDATE alliance_inbox_messages SET pinned_until = NOW() + ($1 * INTERVAL '1 hour') WHERE id = $2`, params: [Number(req.body.duration) || 24, req.params.id] }));
  updateMessage('react', (req) => ({
    sql: req.body.action === 'remove'
      ? `UPDATE alliance_inbox_messages SET reactions = reactions - $1 WHERE id = $2`
      : `UPDATE alliance_inbox_messages SET reactions = jsonb_set(reactions, ARRAY[$1], to_jsonb(COALESCE((reactions->>$1)::int,0)+1)) WHERE id = $2`,
    params: [req.body.emoji, req.params.id],
  }));

  return router;
}

module.exports = createAllianceInboxRouter;
