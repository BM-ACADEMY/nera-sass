/**
 * The setup checklist (N5): six steps, each Done, In review, To do or Locked.
 * Pure functions over a snapshot of the workspace (see index.js), so the same
 * rules decide what the customer sees and what Go live re-checks on the server.
 *
 *   1 business   name, website and address of the brand
 *   2 whatsapp   a verified WhatsApp number (Embedded Signup or staff-assisted)
 *   3 services   at least one service with a price and a duration
 *   4 templates  at least one Meta-approved template (status shown per template)
 *   5 test       a test message reached the customer's own phone
 *   6 go_live    locked until 1 to 5 are Done; turns on AI replies and campaigns
 */
const STATUS = Object.freeze({ DONE: 'done', IN_REVIEW: 'in_review', TODO: 'todo', LOCKED: 'locked' });
const STEP_KEYS = Object.freeze(['business', 'whatsapp', 'services', 'templates', 'test', 'go_live']);

const filled = (value) => String(value ?? '').trim().length > 0;

// ── Templates ───────────────────────────────────────────────
const TEMPLATE_LABELS = {
  approved: 'Approved',
  in_review: 'In review',
  rejected: 'Rejected',
  paused: 'Paused by Meta',
  unknown: 'Unknown',
};

/** Meta's template status as the customer sees it. */
function templateState(metaStatus) {
  const value = String(metaStatus || '').toUpperCase();
  if (value === 'APPROVED') return 'approved';
  if (value === 'PENDING' || value === 'IN_APPEAL') return 'in_review';
  if (value === 'REJECTED') return 'rejected';
  if (value === 'PAUSED' || value === 'DISABLED' || value === 'FLAGGED') return 'paused';
  return 'unknown';
}

/** A template with no variables, no media header and no code button can be sent as is. */
function isSendableAsIs(template) {
  const components = Array.isArray(template?.components) ? template.components : [];
  if (String(template?.category || '').toUpperCase() === 'AUTHENTICATION') return false;
  for (const component of components) {
    if (String(component?.type || '').toUpperCase() === 'HEADER' && String(component?.format || 'TEXT').toUpperCase() !== 'TEXT') return false;
  }
  return !JSON.stringify(components).includes('{{');
}

/** What the customer sees for one template row of the Meta cache. */
function presentTemplate(row) {
  const state = templateState(row.status);
  return {
    template_id: row.template_id,
    name: row.name,
    language: row.language || null,
    category: row.category || null,
    status: state,
    status_label: TEMPLATE_LABELS[state],
    meta_status: row.status || null,
    sendable_as_is: state === 'approved' && isSendableAsIs(row),
  };
}

// ── Steps ───────────────────────────────────────────────────
const result = (key, title, status, detail, extra = {}) => ({ key, title, status, detail, ...extra });

function businessStep({ brand }) {
  const missing = [];
  if (!filled(brand?.name)) missing.push('business name');
  if (!filled(brand?.wa_website)) missing.push('website');
  if (!filled(brand?.wa_address)) missing.push('address');
  return result('business', 'Business details', missing.length ? STATUS.TODO : STATUS.DONE,
    missing.length ? `Add your ${missing.join(', ')}.` : 'Name, website and address are saved.', { missing });
}

function whatsappStep({ brand, state, embeddedSignup }) {
  const connected = Boolean(brand?.phone_number_id && brand?.token_configured);
  const verified = connected && brand.whatsapp_status === 'verified';
  const extra = { embedded_signup: Boolean(embeddedSignup), requested_at: state?.wa_connect_requested_at || null };
  if (verified) return result('whatsapp', 'Connect WhatsApp', STATUS.DONE, 'Your WhatsApp number is connected.', extra);
  const waiting = brand?.whatsapp_status === 'verification_pending' || Boolean(state?.wa_connect_requested_at);
  if (waiting) {
    return result('whatsapp', 'Connect WhatsApp', STATUS.IN_REVIEW,
      'Our team is connecting your WhatsApp number. We will tell you here when it is ready.', extra);
  }
  return result('whatsapp', 'Connect WhatsApp', STATUS.TODO,
    embeddedSignup ? 'Connect your WhatsApp Business account, or ask our team to do it for you.' : 'Ask our team to connect your WhatsApp Business account.', extra);
}

function servicesStep({ services }) {
  const count = services.length;
  return result('services', 'Add services', count ? STATUS.DONE : STATUS.TODO,
    count ? `${count} ${count === 1 ? 'service' : 'services'} added with price and timing.` : 'Add what you sell, with prices, timings and answers the AI may use.', { count });
}

function templatesStep({ templates }, whatsappDone) {
  const counts = { approved: 0, in_review: 0, rejected: 0, paused: 0, unknown: 0 };
  for (const template of templates) counts[template.status] += 1;
  const extra = { templates, counts };
  if (!whatsappDone) return result('templates', 'Message templates', STATUS.LOCKED, 'Connect WhatsApp first.', extra);
  if (counts.approved) return result('templates', 'Message templates', STATUS.DONE, `${counts.approved} approved by Meta.`, extra);
  if (counts.in_review) return result('templates', 'Message templates', STATUS.IN_REVIEW, 'Meta is reviewing your templates. This usually takes a few hours to two days.', extra);
  return result('templates', 'Message templates', STATUS.TODO,
    counts.rejected ? 'Meta rejected your templates. Edit and send them again.' : 'Create a message template and send it to Meta for approval.', extra);
}

function testStep({ state, templates }, whatsappDone) {
  if (!whatsappDone) return result('test', 'Send a test message', STATUS.LOCKED, 'Connect WhatsApp first.');
  if (state?.test_message_sent_at) return result('test', 'Send a test message', STATUS.DONE, 'The test message was sent to your phone.', { sent_at: state.test_message_sent_at });
  if (!templates.some((template) => template.status === 'approved')) {
    return result('test', 'Send a test message', STATUS.LOCKED, 'Get a message template approved first.');
  }
  if (!templates.some((template) => template.sendable_as_is)) {
    return result('test', 'Send a test message', STATUS.TODO, 'Your approved templates need details filled in. Add a simple template with no variables to test with.');
  }
  return result('test', 'Send a test message', STATUS.TODO, 'Send a message to your own phone to see it arrive.');
}

/**
 * snapshot = {
 *   brand: { name, wa_website, wa_address, phone_number_id, token_configured, whatsapp_status },
 *   state: onboarding_states row or null,
 *   services: complete services, templates: presentTemplate() rows,
 *   live: boolean, embeddedSignup: boolean
 * }
 */
function buildChecklist(snapshot) {
  const business = businessStep(snapshot);
  const whatsapp = whatsappStep(snapshot);
  const services = servicesStep(snapshot);
  const waDone = whatsapp.status === STATUS.DONE;
  const templates = templatesStep(snapshot, waDone);
  const test = testStep(snapshot, waDone);
  const before = [business, whatsapp, services, templates, test];
  const ready = before.every((step) => step.status === STATUS.DONE);
  let goLive;
  if (snapshot.live) goLive = result('go_live', 'Go live', STATUS.DONE, 'AI replies and campaigns are on.');
  else if (ready) goLive = result('go_live', 'Go live', STATUS.TODO, 'Everything is ready. Turn on AI replies and campaigns.');
  else {
    const left = before.filter((step) => step.status !== STATUS.DONE).map((step) => step.title);
    goLive = result('go_live', 'Go live', STATUS.LOCKED, `Finish these first: ${left.join(', ')}.`, { blocked_by: before.filter((step) => step.status !== STATUS.DONE).map((step) => step.key) });
  }
  const steps = [...before, goLive];
  return {
    steps,
    ready_to_go_live: ready,
    done_count: steps.filter((step) => step.status === STATUS.DONE).length,
    total: steps.length,
  };
}

module.exports = { STATUS, STEP_KEYS, TEMPLATE_LABELS, templateState, isSendableAsIs, presentTemplate, buildChecklist };
