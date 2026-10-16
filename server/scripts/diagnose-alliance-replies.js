require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { connectMongo, mongoose } = require('../db/connection');
const { AllianceEmailInbound, AllianceTouches, AllianceProspects } = require('../models');

(async () => {
  try {
    await connectMongo();
    const inbound = await AllianceEmailInbound.find({}, {
      _id: 0, id: 1, message_id: 1, in_reply_to: 1, message_references: 1, from_email: 1, subject: 1, received_at: 1,
      prospect_id: 1, campaign_id: 1, touch_id: 1, processing_status: 1, processing_error: 1,
    }).sort({ received_at: -1 }).limit(20).lean();
    const touches = await AllianceTouches.find({ channel: 'email' }, {
      _id: 0, id: 1, campaign_id: 1, prospect_id: 1, provider_message_id: 1, status: 1, sent_at: 1,
    }).lean();
    const prospects = new Map((await AllianceProspects.find({ id: { $in: touches.map((t) => t.prospect_id) } }, { id: 1, email: 1 }).lean()).map((p) => [p.id, p.email]));
    const sent = touches
      .filter((t) => prospects.has(t.prospect_id))
      .sort((a, b) => (b.sent_at ? new Date(b.sent_at).getTime() : -Infinity) - (a.sent_at ? new Date(a.sent_at).getTime() : -Infinity))
      .slice(0, 20)
      .map((t) => ({ ...t, email: prospects.get(t.prospect_id) }));
    console.log(JSON.stringify({ inbound, sent }, null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
