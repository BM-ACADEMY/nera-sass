const axios = require('axios');
const db = require('../db/connection');

let processing = false;

function tokenFor(settings) {
  return process.env[settings?.access_token_env || 'ALLIANCE_WA_ACCESS_TOKEN'];
}

function templateParameters(body, contact) {
  const numbers = [...String(body || '').matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
  const count = numbers.length ? Math.max(...numbers) : 0;
  const values = [contact.name || contact.profile_name || 'there', contact.business_name || '', contact.brand || 'AllianceOS'];
  return Array.from({ length: count }, (_, index) => String(values[index] || contact.name || 'there'));
}

async function processQueuedAllianceWelcomes(io) {
  if (processing) return;
  processing = true;
  try {
    while (true) {
      const client = await db.connect();
      let job;
      try {
        await client.query('BEGIN');
        const result = await client.query(
          `SELECT m.id, m.contact_id, m.conversation_id, m.content, m.raw_payload,
                  c.phone, c.name, c.profile_name, p.business_name, a.brand,
                  cv.phone_number_id
           FROM alliance_inbox_messages m
           JOIN alliance_inbox_contacts c ON c.id = m.contact_id
           JOIN alliance_inbox_conversations cv ON cv.id = m.conversation_id
           LEFT JOIN alliance_prospects p ON p.id = c.prospect_id
           LEFT JOIN alliance_audiences a ON a.code = p.audience
           WHERE m.direction = 'outbound' AND m.msg_type = 'template' AND m.status = 'queued'
             AND m.raw_payload->>'purpose' = 'welcome'
           ORDER BY m.created_at
           FOR UPDATE OF m SKIP LOCKED LIMIT 1`
        );
        if (!result.rowCount) {
          await client.query('COMMIT');
          client.release();
          break;
        }
        job = result.rows[0];
        await client.query(`UPDATE alliance_inbox_messages SET status = 'sending' WHERE id = $1`, [job.id]);
        await client.query(`UPDATE alliance_inbox_conversations SET welcome_status = 'sending', welcome_error = NULL WHERE id = $1`, [job.conversation_id]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        client.release();
        throw error;
      }
      client.release();

      const settingsResult = await db.query(
        `SELECT * FROM alliance_inbox_settings WHERE active = TRUE AND phone_number_id = $1 LIMIT 1`,
        [job.phone_number_id]
      );
      const settings = settingsResult.rows[0] || {
        phone_number_id: process.env.ALLIANCE_WA_PHONE_NUMBER_ID,
        access_token_env: 'ALLIANCE_WA_ACCESS_TOKEN',
      };
      const token = tokenFor(settings);
      const templateName = job.raw_payload?.template_name;
      const language = job.raw_payload?.language || 'en';

      try {
        if (!settings.phone_number_id || settings.phone_number_id === 'unconfigured' || !token) {
          throw new Error('Alliance WhatsApp Phone Number ID or access token is not configured.');
        }
        const parameters = templateParameters(job.content, job);
        const payload = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: job.phone,
          type: 'template',
          template: {
            name: templateName,
            language: { code: language },
            ...(parameters.length ? { components: [{ type: 'body', parameters: parameters.map((text) => ({ type: 'text', text })) }] } : {}),
          },
        };
        const response = await axios.post(
          `https://graph.facebook.com/v19.0/${settings.phone_number_id}/messages`,
          payload,
          { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
        );
        const waMessageId = response.data?.messages?.[0]?.id || null;
        const saved = await db.query(
          `UPDATE alliance_inbox_messages
           SET status = 'sent', wa_msg_id = $1, raw_payload = raw_payload || $2::jsonb, sent_at = NOW()
           WHERE id = $3 RETURNING *`,
          [waMessageId, JSON.stringify({ meta_response: response.data }), job.id]
        );
        await db.query(
          `UPDATE alliance_inbox_conversations
           SET welcome_status = 'sent', welcome_wa_msg_id = $1, welcome_sent_at = NOW(),
               welcome_error = NULL, last_message = $2, last_message_at = NOW(), updated_at = NOW()
           WHERE id = $3`,
          [waMessageId, job.content || `[Template: ${templateName}]`, job.conversation_id]
        );
        io?.emit('alliance_outgoing_message', {
          lead_id: String(job.contact_id),
          message: { ...saved.rows[0], type: 'template', timestamp: saved.rows[0].sent_at },
        });
      } catch (error) {
        const reason = error.response?.data?.error?.message || error.message || 'Welcome template send failed.';
        await db.query(`UPDATE alliance_inbox_messages SET status = 'failed', error_message = $1 WHERE id = $2`, [reason, job.id]);
        await db.query(`UPDATE alliance_inbox_conversations SET welcome_status = 'failed', welcome_error = $1 WHERE id = $2`, [reason, job.conversation_id]);
        console.error('[Alliance welcome template]', reason);
      }
    }
  } finally {
    processing = false;
  }
}

module.exports = { processQueuedAllianceWelcomes };
