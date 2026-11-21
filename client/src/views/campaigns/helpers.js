// Pure helpers for the Campaigns page (no React).

export const DEFAULT_TZ = 'Asia/Kolkata';

export const getTemplateVariables = (value) => [...new Set(
  [...String(value || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => Number(match[1]))
)].sort((a, b) => a - b);

export const getCampaignTemplateError = (template) => {
  if (!template) return '';
  const bodyVariables = getTemplateVariables(template.body);
  const headerVariables = getTemplateVariables(template.header);
  if (bodyVariables.some((value, index) => value !== index + 1)) return 'This template\'s variables are not numbered {{1}}, {{2}}… in order, so it cannot be used for campaigns.';
  if (headerVariables.some((value, index) => value !== index + 1)) return 'This template\'s header variables are not numbered {{1}}, {{2}}… in order, so it cannot be used for campaigns.';
  return '';
};

export const createDefaultParameterMappings = (template) => ({
  body: Object.fromEntries(getTemplateVariables(template?.body).map((number, index) => [
    String(number), {
      source: template?.parameter_definitions?.body?.[String(number)]?.default_source || (index === 0 ? 'recipient_name' : 'custom'),
      value: '', section: 'body', number,
    },
  ])),
  header: Object.fromEntries(getTemplateVariables(template?.header).map((number) => [
    String(number), { source: 'custom', value: '', section: 'header', number },
  ])),
});

export const SOURCE_LABELS = {
  recipient_name: 'Recipient name',
  recipient_phone: 'Recipient phone',
  recipient_email: 'Recipient email',
  lead_status: 'Lead status',
  lead_source: 'Lead source',
  lead_interest: 'Lead interest',
  lead_score: 'Lead score',
  campaign_name: 'Campaign name',
  brand_name: 'Brand name',
  excel_parameter: 'From my uploaded list',
  custom: 'Same text for everyone',
};

/** Template text with each {{n}} shown as its value or a readable placeholder. */
export const renderPreview = (text, section, mappings = {}, context = {}) => String(text || '').replace(/\{\{\s*(\d+)\s*\}\}/g, (match, number) => {
  const mapping = mappings?.[section]?.[String(number)];
  if (!mapping) return `[${match}]`;
  if (mapping.source === 'custom') return mapping.value?.trim() || `[${match}]`;
  if (mapping.source === 'campaign_name' && context.campaignName) return context.campaignName;
  if (mapping.source === 'brand_name' && context.brandName) return context.brandName;
  if (mapping.source === 'excel_parameter') return `[${section === 'header' ? 'Header' : 'Body'} {{${number}}} from list]`;
  return `[${SOURCE_LABELS[mapping.source] || match}]`;
});

export const isMarketing = (template) => String(template?.category || '').toUpperCase() === 'MARKETING';

/** The wall-clock "now" in a time zone, as a datetime-local value. */
export function nowInZone(tz = DEFAULT_TZ, plusMinutes = 0) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(Date.now() + plusMinutes * 60000)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** A UTC instant as a datetime-local value in the zone (for editing a schedule). */
export function toZoneInput(value, tz = DEFAULT_TZ) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function formatInZone(value, tz = DEFAULT_TZ, { withZone = false } = {}) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const text = date.toLocaleString('en-IN', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  return withZone ? `${text} (${tz === 'Asia/Kolkata' ? 'IST' : tz})` : text;
}

/** A datetime-local value ("2026-11-21T10:00") as "21 Nov 2026, 10:00 am", as typed. */
export function formatLocalInput(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return '—';
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]));
  return date.toLocaleString('en-IN', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

export const formatNumber = (n) => Number(n || 0).toLocaleString('en-IN');

export const TIER_TEXT = {
  TIER_50: '50 people a day', TIER_250: '250 people a day', TIER_1K: '1,000 people a day', TIER_10K: '10,000 people a day',
  TIER_100K: '1,00,000 people a day', TIER_UNLIMITED: 'no daily limit',
};

// Words that only make sense to developers; such messages are never shown.
const TECHNICAL = /(axios|status code|ECONN|ETIMEDOUT|TypeError|ReferenceError|SyntaxError|Failed to fetch|NetworkError|invalid data from server|Unexpected token|undefined|null|stack|\bat [\w.]+ \(|graph\.facebook|OAuthException|\(#\d+\)|mongo|E11000|Cannot read|JSON)/i;

/** A message safe to show: the server's plain message, or the fallback. */
export function friendlyError(err, fallback = 'Something went wrong. Please try again.') {
  const message = String(err?.message || '').trim();
  if (!err?.status || err.status >= 500 || !message || message.length > 300 || TECHNICAL.test(message)) {
    if (!err?.status && /fetch|network/i.test(message)) return 'Could not reach the server. Check your internet connection and try again.';
    return fallback;
  }
  return message;
}

/** A delivery log's reason in plain words. */
export function plainReason(text) {
  const reason = String(text || '');
  if (!reason) return '';
  if (/not opted in|consent/i.test(reason)) return 'Has not agreed to receive marketing messages';
  if (/opted out|asked us to stop|stop/i.test(reason)) return 'Asked not to receive messages';
  if (/duplicate/i.test(reason)) return 'Already in this campaign';
  if (/daily limit/i.test(reason)) return 'Daily sending limit reached; sends on the next day';
  if (/per minute|rate/i.test(reason)) return 'Sending slowly to protect your number';
  if (/paused/i.test(reason)) return 'Marketing is paused on your number';
  if (/131026|undeliverable|not a valid whatsapp|not on whatsapp/i.test(reason)) return 'This number cannot receive WhatsApp messages';
  if (/131047|24 hours|re-engagement/i.test(reason)) return 'The contact has not messaged you recently';
  if (/131049|ecosystem|healthy/i.test(reason)) return 'Meta held this message back to protect engagement';
  if (/132\d{3}|template/i.test(reason)) return 'There is a problem with the template';
  if (/deleted|erasure/i.test(reason)) return 'Contact was deleted on request';
  if (/phone|number/i.test(reason)) return 'Phone number is not valid';
  return TECHNICAL.test(reason) || reason.length > 120 ? 'Could not be delivered' : reason;
}

export const STATUS_META = {
  scheduled: { label: 'Scheduled', tone: 'blue' },
  starting: { label: 'Starting', tone: 'blue' },
  running: { label: 'Sending', tone: 'amber' },
  completed: { label: 'Completed', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'grey' },
};

export const statusOf = (campaign) => (campaign.status === 'scheduled' && !campaign.scheduled_at ? 'starting' : campaign.status);
