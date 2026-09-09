const db = require('../db/connection');

const CONDITION_STOPWORDS = new Set([
  'the','a','an','lead','recipient','customer','user','message','reply','email','whatsapp',
  'asks','ask','asking','about','mentions','mention','contains','when','where','if','is','are',
  'does','do','their','they','for','of','to','and','or','question','questions',
]);
const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const stem = (word) => word.replace(/(?:ing|ed|es|s)$/i, '');
const meaningfulTerms = (value) => normalize(value).split(/\s+/).filter((word) => word.length >= 3 && !CONDITION_STOPWORDS.has(word)).map(stem);

function conditionMatches(condition, contextText) {
  if (!String(condition || '').trim()) return true;
  const context = normalize(contextText);
  if (!context) return false;
  const contextTerms = new Set(meaningfulTerms(context));
  const alternatives = String(condition).split(/,|\bor\b|;|\n/i).map((part) => meaningfulTerms(part)).filter((terms) => terms.length);
  return alternatives.some((terms) => {
    const matches = terms.filter((term) => contextTerms.has(term)).length;
    return matches >= Math.min(2, terms.length);
  });
}

async function getAlliancePromptRules(job, channel, audience, contextText = '') {
  const result = await db.query(
    `SELECT id,name,job,channel,audience,condition_text,instruction_text,priority
     FROM alliance_prompt_rules
     WHERE active=TRUE AND job IN ('all',$1) AND channel IN ('all',$2)
       AND (audience IS NULL OR audience=$3)
     ORDER BY priority,id`,
    [job, channel, audience || null]
  );
  const applicable = result.rows.filter((rule) => conditionMatches(rule.condition_text, contextText));
  if (!applicable.length) return 'No administrator rules matched the current message or campaign context.';
  return applicable.map((rule, index) => {
    const matchedBecause = rule.condition_text ? ` Matched condition: ${rule.condition_text}` : ' General rule.';
    return `${index + 1}. [Priority ${rule.priority}] ${rule.name}:${matchedBecause} Mandatory instruction: ${rule.instruction_text}`;
  }).join('\n');
}

module.exports = { getAlliancePromptRules, conditionMatches };
