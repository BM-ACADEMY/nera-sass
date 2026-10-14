const axios = require('axios');
const {
  AllianceInboxMessages,
  AllianceInboxContacts,
  AllianceInboxConversations,
  AllianceInboxSettings,
  AllianceProspects,
  AllianceAudiences,
} = require('../models');

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
      // Atomically claim the oldest queued welcome template (replaces FOR UPDATE SKIP LOCKED).
      const message = await AllianceInboxMessages.findOneAndUpdate(
        { direction: 'outbound', msg_type: 'template', status: 'queued', 'raw_payload.purpose': 'welcome' },
        { $set: { status: 'sending' } },
        { sort: { created_at: 1 }, projection: { id: 1, contact_id: 1, conversation_id: 1, content: 1, raw_payload: 1 } }
      ).lean();
      if (!message) break;

      const [contact, conversation] = await Promise.all([
        AllianceInboxContacts.findOne({ id: message.contact_id }).lean(),
        AllianceInboxConversations.findOne({ id: message.conversation_id }, { phone_number_id: 1 }).lean(),
      ]);
      if (!contact || !conversation) {
        await AllianceInboxMessages.updateOne({ id: message.id }, { $set: { status: 'failed', error_message: 'Contact or conversation no longer exists.' } });
        continue;
      }
      const prospect = contact.prospect_id ? await AllianceProspects.findOne({ id: contact.prospect_id }, { business_name: 1, audience: 1 }).lean() : null;
      const audience = prospect?.audience ? await AllianceAudiences.findOne({ code: prospect.audience }, { brand: 1 }).lean() : null;
      const job = {
        id: message.id,
        contact_id: message.contact_id,
        conversation_id: message.conversation_id,
        content: message.content,
        raw_payload: message.raw_payload,
        phone: contact.phone,
        name: contact.name,
        profile_name: contact.profile_name,
        business_name: prospect?.business_name ?? null,
        brand: audience?.brand ?? null,
        phone_number_id: conversation.phone_number_id,
      };
      await AllianceInboxConversations.updateOne({ id: job.conversation_id }, { $set: { welcome_status: 'sending', welcome_error: null } });

      const settings = await AllianceInboxSettings.findOne({ active: true, phone_number_id: job.phone_number_id }).lean() || {
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
        const saved = await AllianceInboxMessages.findOneAndUpdate(
          { id: job.id },
          { $set: { status: 'sent', wa_msg_id: waMessageId, 'raw_payload.meta_response': response.data, sent_at: new Date() } },
          { new: true, projection: { _id: 0 } }
        ).lean();
        await AllianceInboxConversations.updateOne(
          { id: job.conversation_id },
          { $set: {
            welcome_status: 'sent', welcome_wa_msg_id: waMessageId, welcome_sent_at: new Date(),
            welcome_error: null, last_message: job.content || `[Template: ${templateName}]`, last_message_at: new Date(), updated_at: new Date(),
          } }
        );
        io?.emit('alliance_outgoing_message', {
          lead_id: String(job.contact_id),
          message: { ...saved, type: 'template', timestamp: saved.sent_at },
        });
      } catch (error) {
        const reason = error.response?.data?.error?.message || error.message || 'Welcome template send failed.';
        await AllianceInboxMessages.updateOne({ id: job.id }, { $set: { status: 'failed', error_message: reason } });
        await AllianceInboxConversations.updateOne({ id: job.conversation_id }, { $set: { welcome_status: 'failed', welcome_error: reason } });
        console.error('[Alliance welcome template]', reason);
      }
    }
  } finally {
    processing = false;
  }
}

module.exports = { processQueuedAllianceWelcomes };
