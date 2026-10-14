const { AlliancePromptRules } = require('../models');

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
  const rules = await AlliancePromptRules.find(
    {
      active: true,
      job: { $in: ['all', job] },
      channel: { $in: ['all', channel] },
      audience: { $in: [null, audience || null] },
    },
    { _id: 0, id: 1, name: 1, job: 1, channel: 1, audience: 1, condition_text: 1, instruction_text: 1, priority: 1 }
  ).sort({ priority: 1, id: 1 }).lean();
  const applicable = rules.filter((rule) => conditionMatches(rule.condition_text, contextText));
  if (!applicable.length) return 'No administrator rules matched the current message or campaign context.';
  return applicable.map((rule, index) => {
    const matchedBecause = rule.condition_text ? ` Matched condition: ${rule.condition_text}` : ' General rule.';
    return `${index + 1}. [Priority ${rule.priority}] ${rule.name}:${matchedBecause} Mandatory instruction: ${rule.instruction_text}`;
  }).join('\n');
}

module.exports = { getAlliancePromptRules, conditionMatches };
