/**
 * LeadOS routes: Legacy Meta webhook (campaign status).
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
module.exports = function registerWebhookMetaRoutes(app, ctx) {
const {
  CampaignLogs,
  Conversations,
  Leads,
  Messages,
  escapeRegex,
} = ctx;
// ══════════════════════════════════════════════════════════
// META WHATSAPP WEBHOOKS
// ══════════════════════════════════════════════════════════

// Verification Challenge
app.get('/api/webhooks/meta', (req, res) => {
  const verify_token = process.env.WA_VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === verify_token) {
      console.log('Meta Webhook Verified!');
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }
  res.sendStatus(400);
});

// Receive Live Status Updates
app.post('/api/webhooks/meta', async (req, res) => {
  try {
    const { object, entry } = req.body;

    if (object === 'whatsapp_business_account' && entry && entry[0].changes) {
      const value = entry[0].changes[0].value;

      // Handle message statuses (Delivered, Read, Failed)
      if (value.statuses && value.statuses.length > 0) {
        const statusObj = value.statuses[0];
        const wamid = statusObj.id;
        const newStatus = statusObj.status; // 'delivered', 'read', 'failed'
        const error = statusObj.errors ? statusObj.errors[0].title : null;

        console.log(`[Webhook] Update: ${wamid} -> ${newStatus}`);

        // Update campaign_logs directly
        await CampaignLogs.updateMany({ wa_message_id: wamid }, { $set: { status: newStatus, error_message: error } });
      }

      // Handle incoming replied messages
      if (value.messages && value.messages.length > 0) {
        const msg = value.messages[0];
        const incomingPhone = msg.from;
        const msgId = msg.id;
        const text = msg.text ? msg.text.body : '';

        // Find if this user was part of a campaign
        const repliedLead = await Leads.findOne(
          { phone: new RegExp(`${escapeRegex(incomingPhone.substring(incomingPhone.length - 10))}$`) },
          { _id: 0, id: 1, phone: 1 }
        ).lean();
        if (repliedLead) {
          await CampaignLogs.updateMany({ lead_id: repliedLead.id }, { $set: { status: 'replied' } });

          // Insert into messages table
          const repliedConversation = await Conversations.findOne({ lead_id: repliedLead.id }, { id: 1 }).sort({ last_message_at: -1 }).lean();
          if (repliedConversation && !(msgId && await Messages.exists({ wa_msg_id: msgId }))) {
            await Messages.create({
              conversation_id: repliedConversation.id, direction: 'inbound', content: text, msg_type: 'text',
              wa_msg_id: msgId, status: 'delivered', is_ai: false, sent_at: new Date(),
            });
          }
        }
      }
    }

    // Always return 200 OK to Meta
    res.status(200).send('EVENT_RECEIVED');
  } catch (err) {
    console.error('Webhook processing error:', err);
    res.sendStatus(500);
  }
});
};
