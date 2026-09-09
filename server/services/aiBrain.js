const openRouter = require('./openrouter');
const db = require('../db/connection');
const { getLeadOSBrand } = require('./leadosBrand');
require('dotenv').config();


/**
 * AI Brain function to evaluate a lead, assign it to a brand, 
 * and set the initial next_follow_up date.
 */
async function evaluateLeadBrandAndSchedule(leadId) {
  try {
    const brand = await getLeadOSBrand();
    await db.query(`UPDATE leads
      SET client_id=$1,
          next_follow_up=COALESCE(next_follow_up, NOW() + INTERVAL '15 minutes'),
          updated_at=NOW()
      WHERE id=$2`, [brand.id, leadId]);
    console.log(`[AI Brain] Locked LeadOS lead ${leadId} to ${brand.name}.`);

  } catch (err) {
    console.error(`[AI Brain] Error evaluating new lead ${leadId}:`, err);
  }
}

/**
 * Scans for stuck leads every hour and determines next follow up
 */
async function evaluateStuckLeads() {
  if (!openRouter.isConfigured) return;

  try {
    const stuckLeads = await db.query(`
      SELECT l.id, l.name, l.source, l.status, l.touch_count, l.client_id, l.next_follow_up
      FROM leads l
      WHERE l.status NOT IN ('lost', 'converted')
        AND l.client_id IS NOT NULL
        AND (l.next_follow_up IS NULL OR l.next_follow_up < NOW())
      ORDER BY l.created_at ASC
      LIMIT 50
    `);

    for (const lead of stuckLeads.rows) {
      // Get conversation history (last 5 messages)
      const msgs = await db.query(`
        SELECT content, direction, sent_at
        FROM messages
        WHERE conversation_id IN (SELECT id FROM conversations WHERE lead_id = $1)
        ORDER BY sent_at DESC
        LIMIT 5
      `, [lead.id]);
      
      const history = msgs.rows.reverse().map(m => `[${m.direction.toUpperCase()}]: ${m.content}`).join('\n');
      
      const prompt = `
You are the AI Follow-Up Manager for a CRM.
This lead seems to be stuck or idle.
Name: ${lead.name}
Status: ${lead.status}
Past Touches: ${lead.touch_count || 0}
Last Contact Date: N/A

RECENT CONVERSATION HISTORY:
${history || '(No messages sent or received yet)'}

INSTRUCTIONS:
1. Determine how many hours from now the next follow-up attempt should happen. If they are totally unresponsive after many touches, you might want to wait a few days (e.g., 72 hours). If they just haven't been contacted yet, do it soon (e.g., 2 hours).
2. Propose a short internal note explaining your decision.
3. Respond ONLY in valid JSON.

FORMAT:
{
  "delay_hours": 24,
  "internal_note": "Lead hasn't replied to last 2 texts. Wait 24 hours for next touch."
}
`;

      const response = await openRouter.models.generateContent({
        model: openRouter.DEFAULT_MODEL,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        }
      });

      let aiText = response.text.trim();
      const match = aiText.match(/\{[\s\S]*\}/);
      if (match) aiText = match[0];
      const result = JSON.parse(aiText);
      const delayHours = parseInt(result.delay_hours) || 24;

      await db.query(`
        UPDATE leads 
        SET 
          next_follow_up = NOW() + INTERVAL '${delayHours} hours',
          updated_at = NOW()
        WHERE id = $1
      `, [lead.id]);
      
      if (result.internal_note) {
        // Fallback: append note directly to lead notes if history table doesn't exist.
        await db.query(`
          UPDATE leads SET notes = COALESCE(notes, '') || '\n[' || NOW() || '] AI Brain: ' || $1
          WHERE id = $2
        `, [result.internal_note, lead.id]).catch(e => console.error("Could not save note", e));
      }

      console.log(`[AI Brain] Processed stuck lead ${lead.id}, next follow-up in ${delayHours} hours.`);
      
      // Delay for 2 seconds to avoid hitting Gemini API rate limits
      await new Promise(r => setTimeout(r, 2000));
    }

  } catch (err) {
    console.error('[AI Brain] Error evaluating stuck leads:', err);
  }
}

module.exports = {
  evaluateLeadBrandAndSchedule,
  evaluateStuckLeads
};
