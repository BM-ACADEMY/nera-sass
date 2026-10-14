require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { mongoose } = require('../db/connection');
const ensureAllianceSchema = require('../db/alliance-schema');
const { AllianceEmailInbound, AllianceReplies } = require('../models');
const { NO_ID } = require('../db/mongo');
const { pollAllianceEmailReplies } = require('../services/alliance-email-replies');

(async () => {
  try {
    await ensureAllianceSchema();
    await pollAllianceEmailReplies();
    const repliedInboundIds = await AllianceReplies.distinct('email_inbound_id', { email_inbound_id: { $ne: null } });
    await AllianceEmailInbound.updateMany(
      { processing_status: 'processed', processing_error: { $ne: null }, id: { $in: repliedInboundIds } },
      { $set: { processing_error: null } }
    );
    const inbound = await AllianceEmailInbound.find({}, NO_ID).sort({ received_at: -1 }).limit(10).lean();
    const replies = await AllianceReplies.find({ email_inbound_id: { $in: inbound.map((i) => i.id) } }, { _id: 0, id: 1, status: 1, email_inbound_id: 1 }).lean();
    const rows = inbound.map((i) => {
      const reply = replies.find((r) => r.email_inbound_id === i.id);
      return {
        id: i.id, from_email: i.from_email, subject: i.subject, processing_status: i.processing_status,
        processing_error: i.processing_error, prospect_id: i.prospect_id, campaign_id: i.campaign_id,
        reply_id: reply?.id ?? null, reply_status: reply?.status ?? null,
      };
    });
    console.log(JSON.stringify(rows, null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
