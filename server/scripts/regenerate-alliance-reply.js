require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const db = require('../db/connection');
const { regenerateReplySuggestion } = require('../services/alliance-email-replies');

(async () => {
  try {
    const replyId = process.argv[2];
    if (!replyId) throw new Error('Reply ID is required.');
    const result = await regenerateReplySuggestion(replyId);
    console.log(JSON.stringify({ id: result.id, intent: result.ai_intent, has_draft: Boolean(result.ai_draft), draft_length: result.ai_draft?.length || 0 }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
