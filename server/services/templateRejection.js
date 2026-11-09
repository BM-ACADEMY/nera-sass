/**
 * Meta's template rejection reasons in plain words, so a customer can fix the
 * template and send it again. Unknown codes get a generic message: the raw
 * text Meta returns is never shown.
 */
const REASONS = Object.freeze({
  INVALID_FORMAT: { message: 'The template format is not valid.', fix: 'Check the variables ({{1}}, {{2}}...) are numbered in order, not next to each other, and the text has no line breaks or tabs inside variables.' },
  ABUSIVE_CONTENT: { message: 'Meta found language it considers abusive or threatening.', fix: 'Rewrite the message in a neutral, respectful tone.' },
  INCORRECT_CATEGORY: { message: 'The category does not match what the message says.', fix: 'Pick Marketing if the message promotes anything, otherwise Utility.' },
  TAG_CONTENT_MISMATCH: { message: 'The category does not match what the message says.', fix: 'Pick Marketing if the message promotes anything, otherwise Utility.' },
  SCAM: { message: 'Meta thinks the message may be a scam or ask for sensitive details.', fix: 'Remove requests for passwords, card numbers or one-time codes, and avoid urgent or too-good-to-be-true wording.' },
  PROMOTIONAL: { message: 'A utility template contained promotional wording.', fix: 'Remove offers and promotions, or change the category to Marketing.' },
  PAUSED: { message: 'Meta paused this template because customers reported it or rated it poorly.', fix: 'Improve the wording, then send it for review again.' },
  DISABLED: { message: 'Meta disabled this template after repeated low ratings.', fix: 'Create a new template with clearer wording.' },
});

const GENERIC = { message: 'Meta did not approve this template.', fix: 'Open the template, adjust the wording and send it for review again.' };

const normalise = (code) => String(code || '').trim().toUpperCase().replace(/[^A-Z_]/g, '');

/** The reason code Meta gave, or null for "NONE"/empty. */
function cleanReasonCode(code) {
  const value = normalise(code);
  return value && value !== 'NONE' ? value : null;
}

/** { code, message, fix } for a Meta rejection code (never the raw provider text). */
function explainRejection(code) {
  const value = cleanReasonCode(code);
  const known = value ? REASONS[value] : null;
  return { code: value, ...(known || GENERIC) };
}

module.exports = { REASONS, cleanReasonCode, explainRejection };
