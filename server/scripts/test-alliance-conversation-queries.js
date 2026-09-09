require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db/connection');

(async () => {
  try {
    const list = await db.query(
      `SELECT p.id AS prospect_id,p.name,p.business_name,p.email,p.phone,p.audience,
              latest.reply_status,latest.ai_intent,latest.last_reply_received,sent.last_email_sent,
              GREATEST(COALESCE(latest.last_reply_received,'epoch'),COALESCE(sent.last_email_sent,'epoch')) AS last_activity
       FROM alliance_prospects p
       LEFT JOIN LATERAL (SELECT r.status AS reply_status,r.ai_intent,ei.received_at AS last_reply_received
         FROM alliance_replies r LEFT JOIN alliance_email_inbound ei ON ei.id=r.email_inbound_id
         WHERE r.prospect_id=p.id AND r.channel='email' ORDER BY COALESCE(ei.received_at,r.created_at) DESC LIMIT 1) latest ON TRUE
       LEFT JOIN LATERAL (SELECT MAX(t.sent_at) AS last_email_sent FROM alliance_touches t
         WHERE t.prospect_id=p.id AND t.channel='email' AND t.status='sent') sent ON TRUE
       WHERE EXISTS (SELECT 1 FROM alliance_replies r2 WHERE r2.prospect_id=p.id AND r2.channel='email')
       ORDER BY last_activity DESC LIMIT 10`
    );
    const prospectId = list.rows[0]?.prospect_id;
    let timeline = [];
    if (prospectId) {
      const messages = await db.query(
        `SELECT 'inbound' AS direction,ei.id,COALESCE(r.body,ei.text_body) AS body,ei.received_at,
                COALESCE((SELECT JSON_AGG(JSON_BUILD_OBJECT('id',att.id,'filename',att.filename)) FROM alliance_email_attachments att WHERE att.inbound_id=ei.id),'[]'::json) AS attachments
         FROM alliance_email_inbound ei LEFT JOIN alliance_replies r ON r.email_inbound_id=ei.id WHERE ei.prospect_id=$1`,
        [prospectId]
      );
      timeline = messages.rows;
    }
    console.log(JSON.stringify({ conversation_count: list.rowCount, first_prospect_id: prospectId || null, inbound_count: timeline.length }, null, 2));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { await db.end(); }
})();
