require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db/connection');

(async () => {
  try {
    const inbound = await db.query(
      `SELECT id,message_id,in_reply_to,message_references,from_email,subject,received_at,
              prospect_id,campaign_id,touch_id,processing_status,processing_error
       FROM alliance_email_inbound ORDER BY received_at DESC LIMIT 20`
    );
    const sent = await db.query(
      `SELECT t.id,t.campaign_id,t.prospect_id,t.provider_message_id,t.status,t.sent_at,p.email
       FROM alliance_touches t JOIN alliance_prospects p ON p.id=t.prospect_id
       WHERE t.channel='email' ORDER BY t.sent_at DESC NULLS LAST LIMIT 20`
    );
    console.log(JSON.stringify({ inbound: inbound.rows, sent: sent.rows }, null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
