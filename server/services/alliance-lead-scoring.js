const { AllianceProspects, AllianceProspectScoreEvents } = require('../models');

const clamp = (value) => Math.max(0, Math.min(100, Number(value) || 0));

function scoreDelta(message, intent = '') {
  const text = String(message || '').toLowerCase();
  const normalizedIntent = String(intent || '').toLowerCase();
  let delta = ({ interested: 20, question: 12, objection: -5, not_interested: -30, ooo: 0, other: 5 })[normalizedIntent] ?? 5;

  if (/price|pricing|fee|cost|quotation|quote|budget/.test(text)) delta += 8;
  if (/call|meeting|demo|appointment|schedule|visit/.test(text)) delta += 12;
  if (/interested|send details|share details|syllabus|brochure|proposal/.test(text)) delta += 10;
  if (/yes|okay|ok|proceed|confirm|register|enroll|buy/.test(text)) delta += 8;
  if (/not interested|do not contact|don't contact|stop|unsubscribe|remove me/.test(text)) delta = Math.min(delta, -35);
  if (/too expensive|no budget|not now|later/.test(text)) delta -= 8;
  return Math.max(-40, Math.min(35, delta));
}

async function scoreAllianceProspect(prospectId, { message, intent, channel, eventKey }) {
  if (!prospectId || !eventKey) return null;
  const delta = scoreDelta(message, intent);
  try {
    await AllianceProspectScoreEvents.create({
      prospect_id: prospectId,
      channel: channel || 'unknown',
      event_key: String(eventKey),
      intent: intent || null,
      score_delta: delta,
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    // Event already scored (ON CONFLICT DO NOTHING) — report the current score.
    const existing = await AllianceProspects.findOne({ id: prospectId }, { ai_score: 1 }).lean();
    return existing?.ai_score ?? null;
  }
  const updated = await AllianceProspects.findOneAndUpdate(
    { id: prospectId },
    [{
      $set: {
        ai_score: { $min: [100, { $max: [0, { $add: [{ $ifNull: ['$ai_score', 10] }, delta] }] }] },
        updated_at: '$$NOW',
      },
    }],
    { new: true, projection: { ai_score: 1 } }
  ).lean();
  return clamp(updated?.ai_score);
}

module.exports = { scoreAllianceProspect, scoreDelta };
