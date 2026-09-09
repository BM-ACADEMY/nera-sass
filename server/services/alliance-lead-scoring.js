const db = require('../db/connection');

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

async function scoreAllianceProspect(prospectId, { message, intent, channel, eventKey }, queryable = db) {
  if (!prospectId || !eventKey) return null;
  const delta = scoreDelta(message, intent);
  const inserted = await queryable.query(
    `INSERT INTO alliance_prospect_score_events(prospect_id,channel,event_key,intent,score_delta)
     VALUES($1,$2,$3,$4,$5) ON CONFLICT(channel,event_key) DO NOTHING RETURNING id`,
    [prospectId, channel || 'unknown', String(eventKey), intent || null, delta]
  );
  if (!inserted.rowCount) {
    const existing = await queryable.query(`SELECT ai_score FROM alliance_prospects WHERE id=$1`, [prospectId]);
    return existing.rows[0]?.ai_score ?? null;
  }
  const updated = await queryable.query(
    `UPDATE alliance_prospects
     SET ai_score=LEAST(100,GREATEST(0,COALESCE(ai_score,10)+$1)),updated_at=NOW()
     WHERE id=$2 RETURNING ai_score`,
    [delta, prospectId]
  );
  return clamp(updated.rows[0]?.ai_score);
}

module.exports = { scoreAllianceProspect, scoreDelta };
