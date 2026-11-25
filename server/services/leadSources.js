/**
 * Lead sources as the customer app shows them.
 *
 * Every lead falls into exactly one kind:
 *   whatsapp_ad  came in from a click-to-WhatsApp ad (has an ad_id from the
 *                message referral, and no lead form id)
 *   facebook     a Facebook / Instagram lead form (leadgen / form id, or an
 *                old "facebook" / "Meta Ads" source without an ad_id)
 *   whatsapp     wrote to the WhatsApp number
 *   import       added from an Excel / CSV sheet
 *   manual       everything else: added by hand, and old "website" leads
 *
 * Stored `source` values are never rewritten; the kind is worked out when
 * reading. `sourceFilter(kind)` (Mongo) and `leadSourceKind(lead)` (JS) must
 * agree; test/leads-page.test.js checks that they do.
 */

const FACEBOOK_SOURCE = /(facebook|instagram|meta[_ ]?ads)/i;
const WHATSAPP_SOURCE = /whatsapp/i;
// "XLS Sheet" (Leads page import), "csv_<batch>" (campaign lists), and older
// spellings.
const IMPORT_SOURCE = /^\s*((xls|xlsx|excel|csv)(\s+(sheet|import|upload))?|import(ed)?|csv_.*)\s*$/i;

const SOURCE_KINDS = ['whatsapp', 'whatsapp_ad', 'import', 'manual', 'facebook'];
const SOURCE_LABELS = {
  whatsapp: 'WhatsApp',
  whatsapp_ad: 'WhatsApp ad',
  import: 'Import',
  manual: 'Manual',
  facebook: 'Facebook lead form',
};

// Names saved in export jobs before this change.
const LEGACY_KINDS = { website: 'manual', xls_sheet: 'import', xls: 'import', excel: 'import', csv: 'import' };

/**
 * A source kind from a request value, or null when it is not one. Requests
 * only take the kinds above; `legacy: true` also reads the old names, for
 * export jobs saved before this change.
 */
function normalizeSourceKind(value, { legacy = false } = {}) {
  const key = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (SOURCE_KINDS.includes(key)) return key;
  return legacy ? LEGACY_KINDS[key] || null : null;
}

const PRESENT = { $nin: [null, ''] };
const ABSENT = { $in: [null, ''] };
const FORM_FIELDS = ['leadgen_id', 'meta_lead_id', 'lead_ad_form_id'];
const hasForm = () => ({ $or: FORM_FIELDS.map((field) => ({ [field]: PRESENT })) });
const noForm = () => FORM_FIELDS.map((field) => ({ [field]: ABSENT }));

/** Mongo filter for one source kind. */
function sourceFilter(kind) {
  const plain = [{ ad_id: ABSENT }, ...noForm(), { source: { $not: FACEBOOK_SOURCE } }];
  switch (kind) {
    case 'whatsapp_ad':
      return { $and: [{ ad_id: PRESENT }, ...noForm()] };
    case 'facebook':
      return { $or: [hasForm(), { $and: [{ ad_id: ABSENT }, { source: FACEBOOK_SOURCE }] }] };
    case 'whatsapp':
      return { $and: [...plain, { source: WHATSAPP_SOURCE }] };
    case 'import':
      return { $and: [...plain, { source: { $not: WHATSAPP_SOURCE } }, { source: IMPORT_SOURCE }] };
    case 'manual':
      return { $and: [...plain, { source: { $not: WHATSAPP_SOURCE } }, { source: { $not: IMPORT_SOURCE } }] };
    default:
      throw new Error(`Unknown lead source: ${kind}`);
  }
}

const present = (value) => value != null && value !== '';

/** The source kind of one lead document. */
function leadSourceKind(lead = {}) {
  const form = FORM_FIELDS.some((field) => present(lead[field]));
  if (present(lead.ad_id) && !form) return 'whatsapp_ad';
  const source = lead.source == null ? '' : String(lead.source);
  if (form || FACEBOOK_SOURCE.test(source)) return 'facebook';
  if (WHATSAPP_SOURCE.test(source)) return 'whatsapp';
  if (IMPORT_SOURCE.test(source)) return 'import';
  return 'manual';
}

module.exports = {
  FACEBOOK_SOURCE,
  WHATSAPP_SOURCE,
  IMPORT_SOURCE,
  SOURCE_KINDS,
  SOURCE_LABELS,
  normalizeSourceKind,
  sourceFilter,
  leadSourceKind,
};
