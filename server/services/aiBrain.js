const openRouter = require('./openrouter');
const { Leads, Conversations, Messages } = require('../models');
const { getLeadOSBrand } = require('./leadosBrand');
require('dotenv').config();


/**
 * AI Brain function to evaluate a lead, assign it to a brand, 
 * and set the initial next_follow_up date.
 */
async function evaluateLeadBrandAndSchedule(leadId) {
  try {
    const brand = await getLeadOSBrand();
    await Leads.updateOne({ id: leadId }, [{ $set: {
      client_id: brand.id,
      next_follow_up: { $ifNull: ['$next_follow_up', { $add: ['$$NOW', 15 * 60 * 1000] }] },
      updated_at: '$$NOW',
    } }]);
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
    const stuckLeads = await Leads.find(
      {
        status: { $nin: ['lost', 'converted', null] },
        client_id: { $ne: null },
        $or: [{ next_follow_up: null }, { next_follow_up: { $lt: new Date() } }],
      },
      { _id: 0, id: 1, name: 1, source: 1, status: 1, touch_count: 1, client_id: 1, next_follow_up: 1 }
    ).sort({ created_at: 1 }).limit(50).lean();

    for (const lead of stuckLeads) {
      // Get conversation history (last 5 messages)
      const conversationIds = await Conversations.distinct('id', { lead_id: lead.id });
      const msgs = await Messages.find(
        { conversation_id: { $in: conversationIds } },
        { _id: 0, content: 1, direction: 1, sent_at: 1 }
      ).sort({ sent_at: -1 }).limit(5).lean();
      
      const history = msgs.reverse().map(m => `[${m.direction.toUpperCase()}]: ${m.content}`).join('\n');
      
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

      await Leads.updateOne(
        { id: lead.id },
        { $set: { next_follow_up: new Date(Date.now() + delayHours * 3600 * 1000), updated_at: new Date() } }
      );
      
      if (result.internal_note) {
        // Fallback: append note directly to lead notes if history table doesn't exist.
        await Leads.updateOne({ id: lead.id }, [{ $set: {
          notes: { $concat: [{ $ifNull: ['$notes', ''] }, `\n[${new Date().toISOString()}] AI Brain: `, String(result.internal_note)] },
        } }]).catch(e => console.error("Could not save note", e));
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
