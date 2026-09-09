require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const db = require('../db/connection');
const ensureAllianceSchema = require('../db/alliance-schema');
const { pollAllianceEmailReplies } = require('../services/alliance-email-replies');

(async () => {
  try {
    await ensureAllianceSchema();
    await pollAllianceEmailReplies();
    await db.query(
      `UPDATE alliance_email_inbound i
       SET processing_error=NULL
       WHERE i.processing_status='processed' AND i.processing_error IS NOT NULL
         AND EXISTS (SELECT 1 FROM alliance_replies r WHERE r.email_inbound_id=i.id)`
    );
    const result = await db.query(
      `SELECT i.id, i.from_email, i.subject, i.processing_status, i.processing_error,
              i.prospect_id, i.campaign_id, r.id AS reply_id, r.status AS reply_status
       FROM alliance_email_inbound i
       LEFT JOIN alliance_replies r ON r.email_inbound_id = i.id
       ORDER BY i.received_at DESC LIMIT 10`
    );
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
