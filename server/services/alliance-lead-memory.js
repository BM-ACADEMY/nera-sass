const { AllianceLeadAiMemory } = require('../models');

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
  const row = await AllianceLeadAiMemory.findOne({ prospect_id: prospectId }).lean();
  if (!row) return emptyMemory(prospectId);
  return normalizeMemory(prospectId, { ...row.memory, summary: row.summary });
}

async function saveAllianceLeadMemory(prospectId, value, channel, messageTime = new Date()) {
  if (!prospectId) return null;
  const memory = normalizeMemory(prospectId, value);
  return AllianceLeadAiMemory.findOneAndUpdate(
    { prospect_id: prospectId },
    {
      $set: {
        summary: memory.summary,
        memory,
        last_channel: channel || null,
        last_message_at: messageTime,
        updated_at: new Date(),
      },
      $setOnInsert: { lead_key: memory.lead_key, created_at: new Date() },
    },
    { upsert: true, new: true, lean: true }
  );
}

module.exports = { getAllianceLeadMemory, saveAllianceLeadMemory, normalizeMemory };
