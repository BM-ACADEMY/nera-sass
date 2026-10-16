require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { connectMongo, mongoose } = require('../db/connection');
const { AllianceReplies, AllianceEmailInbound, AllianceEmailAttachments } = require('../models');

(async () => {
  try {
    await connectMongo();
    const replies = await AllianceReplies.find({ channel: 'email' }, { _id: 0, prospect_id: 1, email_inbound_id: 1, created_at: 1 }).lean();
    const inboundDates = new Map((await AllianceEmailInbound.find(
      { id: { $in: replies.map((r) => r.email_inbound_id).filter((id) => id != null) } }, { id: 1, received_at: 1 }
    ).lean()).map((i) => [i.id, i.received_at]));
    const lastActivity = new Map();
    for (const reply of replies) {
      const at = new Date(inboundDates.get(reply.email_inbound_id) || reply.created_at || 0).getTime();
      if (!lastActivity.has(reply.prospect_id) || lastActivity.get(reply.prospect_id) < at) lastActivity.set(reply.prospect_id, at);
    }
    const list = [...lastActivity.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const prospectId = list[0]?.[0];
    let timeline = [];
    if (prospectId) {
      const inbound = await AllianceEmailInbound.find({ prospect_id: prospectId }, { _id: 0, id: 1, text_body: 1, received_at: 1 }).lean();
      const attachments = await AllianceEmailAttachments.find({ inbound_id: { $in: inbound.map((i) => i.id) } }, { _id: 0, id: 1, filename: 1, inbound_id: 1 }).lean();
      timeline = inbound.map((i) => ({ direction: 'inbound', ...i, attachments: attachments.filter((a) => a.inbound_id === i.id) }));
    }
    console.log(JSON.stringify({ conversation_count: list.length, first_prospect_id: prospectId || null, inbound_count: timeline.length }, null, 2));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { await mongoose.disconnect(); }
})();
