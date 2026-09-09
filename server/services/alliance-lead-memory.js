const db = require('../db/connection');

const emptyMemory = (prospectId) => ({
  lead_key: `prospect:${prospectId}`,
  summary: '',
  requirements: [],
  interests: [],
  objections: [],
  commitments: [],
  next_step: '',
  relationship_stage: 'new',
});

const cleanList = (value) => [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 30);

function normalizeMemory(prospectId, value = {}) {
  return {
    lead_key: `prospect:${prospectId}`,
    summary: String(value.summary || '').trim().slice(0, 4000),
    requirements: cleanList(value.requirements),
    interests: cleanList(value.interests),
    objections: cleanList(value.objections),
    commitments: cleanList(value.commitments),
    next_step: String(value.next_step || '').trim().slice(0, 1000),
    relationship_stage: String(value.relationship_stage || 'new').trim().slice(0, 80),
  };
}

async function getAllianceLeadMemory(prospectId) {
  if (!prospectId) return emptyMemory('unknown');
  const result = await db.query(`SELECT lead_key,summary,memory,last_channel,last_message_at,updated_at FROM alliance_lead_ai_memory WHERE prospect_id=$1`, [prospectId]);
  if (!result.rowCount) return emptyMemory(prospectId);
  return normalizeMemory(prospectId, { ...result.rows[0].memory, summary: result.rows[0].summary });
}

async function saveAllianceLeadMemory(prospectId, value, channel, messageTime = new Date()) {
  if (!prospectId) return null;
  const memory = normalizeMemory(prospectId, value);
  const result = await db.query(
    `INSERT INTO alliance_lead_ai_memory (prospect_id,lead_key,summary,memory,last_channel,last_message_at)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6)
     ON CONFLICT (prospect_id) DO UPDATE SET summary=EXCLUDED.summary,memory=EXCLUDED.memory,
       last_channel=EXCLUDED.last_channel,last_message_at=EXCLUDED.last_message_at,updated_at=NOW()
     RETURNING *`,
    [prospectId, memory.lead_key, memory.summary, JSON.stringify(memory), channel || null, messageTime]
  );
  return result.rows[0];
}

module.exports = { getAllianceLeadMemory, saveAllianceLeadMemory, normalizeMemory };
