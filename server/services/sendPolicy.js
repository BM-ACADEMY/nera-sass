/**
 * The one place that decides whether a WhatsApp message may go to a contact
 * right now (plan N1). Every send path (manual inbox, AI reply, n8n internal
 * routes, campaign queue) asks here first.
 *
 * Kinds:
 *   marketing  promotions, campaigns, follow-up nudges: needs opt-in, stops on
 *              STOP, paused when the number's quality drops
 *   utility    transactional (payment confirmation, booking): keeps flowing
 *              after a STOP, which only ends marketing
 *   service    a reply inside the conversation the customer started
 *
 * The 24-hour window: free text and media only while the customer wrote in
 * the last 24 hours; outside it only an approved template may be sent.
 */
const { Messages, Conversations, Templates, MetaWhatsappTemplates } = require('../models');
const { phoneTailRegex } = require('../db/mongo');
const { tenantCanSend, tenantLifecycle } = require('./lifecycle');
const { currentTenantId, runAsSystem } = require('./tenantContext');
const consent = require('./consent');
const numberHealth = require('./numberHealth');
const erasure = require('./erasure');

const KINDS = Object.freeze(['marketing', 'utility', 'service']);
const DAY_MS = 24 * 60 * 60 * 1000;
const TEMPLATE_TYPES = new Set(['template']);

class SendBlocked extends Error {
  constructor({ status, code, message, retryable = false, retryAt = null }) {
    super(message);
    this.name = 'SendBlocked';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.retryAt = retryAt;
  }
}

const normaliseKind = (kind) => (KINDS.includes(kind) ? kind : 'marketing');

/** Unknown templates are treated as marketing unless WA_UNKNOWN_TEMPLATE_KIND says otherwise. */
const unknownTemplateKind = () => normaliseKind(String(process.env.WA_UNKNOWN_TEMPLATE_KIND || 'marketing').toLowerCase());

function kindForCategory(category) {
  const value = String(category || '').toUpperCase();
  if (value === 'MARKETING') return 'marketing';
  if (value === 'UTILITY' || value === 'AUTHENTICATION' || value === 'TRANSACTIONAL') return 'utility';
  return null;
}

/**
 * The kind a named template counts as: from the tenant's own template row,
 * then from the Meta inventory cache, else the configured default.
 */
async function templateKind(templateName) {
  const name = String(templateName || '').trim();
  if (!name) return unknownTemplateKind();
  // Templates created in LeadOS default to UTILITY in the schema; only trust
  // a category once Meta has the template (meta_template_id set), else the
  // Meta inventory cache.
  const own = await Templates.findOne({ name, meta_template_id: { $nin: [null, ''] } }, { _id: 0, category: 1 }).lean();
  const fromOwn = kindForCategory(own?.category);
  if (fromOwn) return fromOwn;
  const cached = await runAsSystem(() => MetaWhatsappTemplates.findOne({ name }, { _id: 0, category: 1 }).lean(), 'send-policy-template');
  const fromCache = kindForCategory(cached?.category);
  if (fromCache) return fromCache;
  return unknownTemplateKind();
}

/** True while the customer wrote within the last 24 hours. */
async function windowOpen(lead, now = new Date()) {
  if (!lead) return false;
  const since = new Date(now.getTime() - DAY_MS);
  if (lead.last_inbound_at && new Date(lead.last_inbound_at) > since) return true;
  const filter = [];
  if (lead.id != null) filter.push({ lead_id: lead.id });
  if (lead.phone) filter.push({ phone: phoneTailRegex(lead.phone) });
  if (!filter.length) return false;
  const conversationIds = await Conversations.distinct('id', { $or: filter });
  if (!conversationIds.length) return false;
  return Boolean(await Messages.exists({ conversation_id: { $in: conversationIds }, direction: 'inbound', sent_at: { $gt: since } }));
}

/**
 * Checks one send. Resolves to { ok: true, kind } or throws SendBlocked.
 *   lead           the lead row (id, phone, opt-out flags, last_inbound_at)
 *   kind           marketing | utility | service
 *   messageType    text | image | audio | video | document | template | reaction
 *   phoneNumberId  the sender number (for the marketing pause)
 *   onboardingTest true only for the owner's setup test to their own phone (N5)
 */
async function assertCanSend({ lead, kind, messageType = 'text', phoneNumberId = null, now = new Date(), onboardingTest = false }) {
  const resolvedKind = normaliseKind(kind);
  const tenantId = currentTenantId();
  if (tenantId && !(await tenantCanSend(tenantId))) {
    throw new SendBlocked({ status: 403, code: 'SEND_BLOCKED', message: 'This workspace cannot send messages', retryable: true, retryAt: new Date(now.getTime() + 15 * 60 * 1000) });
  }
  if (!lead?.phone || consent.digitsOf(lead.phone).length < 10) {
    throw new SendBlocked({ status: 400, code: 'INVALID_PHONE', message: 'The contact has no valid WhatsApp number' });
  }
  // A contact deleted on request gets nothing, of any kind (N6). Separate from
  // consent: it does not read or change opt-in / opt-out.
  if (tenantId && await erasure.isErased(lead.phone)) {
    throw new SendBlocked({ status: 409, code: 'CONTACT_ERASED', message: erasure.ERASED_MESSAGE });
  }
  // Campaigns and marketing nudges start when the workspace goes live (N5).
  // Only the owner's own onboarding test message to their own phone is exempt;
  // every other check below still applies to it. Workspaces that predate
  // onboarding have no flag and are unaffected.
  if (resolvedKind === 'marketing' && tenantId && !onboardingTest) {
    const { tenant } = await tenantLifecycle(tenantId);
    if (tenant?.campaigns_enabled === false) {
      throw new SendBlocked({ status: 403, code: 'NOT_LIVE', message: 'Marketing messages start when you go live. Finish the setup on your Home screen first.', retryable: true, retryAt: new Date(now.getTime() + 15 * 60 * 1000) });
    }
  }
  if (resolvedKind === 'marketing') {
    const allowed = await consent.marketingAllowed({ lead });
    if (!allowed.allowed) throw new SendBlocked({ status: 403, code: allowed.code, message: allowed.message });
    if (phoneNumberId) {
      const block = await numberHealth.marketingBlock(phoneNumberId);
      if (block) throw new SendBlocked({ status: 423, code: block.code, message: block.message, retryable: true, retryAt: new Date(now.getTime() + 15 * 60 * 1000) });
    }
  }
  if (!TEMPLATE_TYPES.has(messageType) && messageType !== 'reaction' && !(await windowOpen(lead, now))) {
    throw new SendBlocked({ status: 409, code: 'WINDOW_CLOSED', message: 'The 24-hour window is closed. Send an approved template to reopen the conversation.' });
  }
  return { ok: true, kind: resolvedKind };
}

/** Same as assertCanSend but returns { ok: false, ...error } instead of throwing. */
async function checkSend(options) {
  try {
    return await assertCanSend(options);
  } catch (error) {
    if (error instanceof SendBlocked) {
      return { ok: false, status: error.status, code: error.code, message: error.message, retryable: error.retryable, retryAt: error.retryAt };
    }
    throw error;
  }
}

/** Writes a SendBlocked (or any error with a status) as the JSON response, never a stack. */
function respondBlocked(res, error) {
  const status = Number(error?.status) || 500;
  const body = { error: status < 500 ? error.message : 'Server error' };
  if (error?.code) body.code = error.code;
  if (error?.retryAt) body.retry_at = error.retryAt;
  return res.status(status).json(body);
}

module.exports = {
  KINDS,
  DAY_MS,
  SendBlocked,
  normaliseKind,
  kindForCategory,
  templateKind,
  windowOpen,
  assertCanSend,
  checkSend,
  respondBlocked,
};
