/**
 * "Send to client": staff send a new workspace's owner a WhatsApp message from
 * the platform number with what they need to start, in order:
 *   1. a one-time link to set their password (valid 72 hours, works once),
 *   2. where to sign in (app.getnera.in) and with which email.
 *
 * Rules, all enforced here:
 *   - The password is never sent. The owner gets a single-use link instead:
 *     an existing login gets a password-set token (users.reset_token_hash,
 *     the same mechanism as "Forgot password", used at /reset-password/:token);
 *     an owner still invited gets a fresh invitation token (/invite/:token).
 *     Only the SHA-256 hash is stored; issuing a new link kills the old one.
 *   - Only an approved UTILITY template of the platform's WhatsApp account,
 *     named in WORKSPACE_READY_TEMPLATE (default workspace_ready) and
 *     WORKSPACE_READY_TEMPLATE_LANG (default en), with exactly four body
 *     variables: {{1}} owner name, {{2}} workspace, {{3}} link, {{4}} email.
 *   - Always a deliberate staff action; never sent on provisioning.
 *   - At most WORKSPACE_READY_MAX_PER_HOUR (default 3) sends per workspace per hour.
 *   - Every attempt that reaches WhatsApp is audit-logged with the staff
 *     member, time and a masked number. The link is never logged or stored
 *     in the admin inbox history.
 */
const crypto = require('crypto');
const { Tenants, Users, Invitations, AuditEvents, MetaWhatsappTemplates } = require('../models');
const { runAsSystem, runAsTenant } = require('./tenantContext');
const inbox = require('./platformInbox');
const notify = require('./notify');
const audit = require('./audit');

const LINK_TTL_HOURS = 72; // the template text says 72 hours
const EVENT = audit.EVENTS.WORKSPACE_LOGIN_LINK_SENT;
const LINK_PLACEHOLDER = '[one-time set-password link]';

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const maxPerHour = () => Math.max(1, Number(process.env.WORKSPACE_READY_MAX_PER_HOUR) || 3);
const templateConfig = () => ({
  name: String(process.env.WORKSPACE_READY_TEMPLATE || '').trim() || 'workspace_ready',
  language: String(process.env.WORKSPACE_READY_TEMPLATE_LANG || '').trim() || 'en',
});
const sys = (fn) => runAsSystem(fn, 'workspace-welcome');

class WelcomeError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * A WhatsApp number in international (E.164) form, as digits without "+".
 * "+91 98765 43210", "0091-98765-43210" and "919876543210" all work; a bare
 * 10-digit number is refused because its country is unknown.
 */
function normalizeNumber(input) {
  let value = String(input || '').trim().replace(/[\s().-]/g, '');
  if (value.startsWith('00')) value = `+${value.slice(2)}`;
  const plus = value.startsWith('+');
  const digits = value.replace(/^\+/, '');
  if (!/^\d+$/.test(digits)) throw new WelcomeError(400, 'Enter the WhatsApp number with digits only, for example +91 98765 43210', 'BAD_NUMBER');
  if (!plus && digits.length === 10) throw new WelcomeError(400, 'Add the country code, for example +91 98765 43210', 'BAD_NUMBER');
  if (digits.startsWith('0') || digits.length < 11 || digits.length > 15) {
    throw new WelcomeError(400, 'That does not look like a WhatsApp number. Use the full number with country code, for example +91 98765 43210', 'BAD_NUMBER');
  }
  return digits;
}

// "+91******3210": enough to recognise, not enough to reuse.
function maskNumber(digits) {
  const d = String(digits || '');
  if (d.length < 7) return '***';
  return `+${d.slice(0, 2)}${'*'.repeat(d.length - 6)}${d.slice(-4)}`;
}

/**
 * Whether the configured template can be sent. Resolves to
 * { ok: true, template } or { ok: false, code, message } with a message staff
 * can act on.
 */
async function templateStatus() {
  const { name, language } = templateConfig();
  if (!inbox.platformPhoneId() || !inbox.platformToken()) {
    return { ok: false, name, language, code: 'PLATFORM_NOT_CONFIGURED', message: 'The platform WhatsApp number is not set up. Pick it in WhatsApp Numbers ("Use for admin WhatsApp") first.' };
  }
  const wabaId = await inbox.platformWabaId();
  const row = wabaId
    ? await sys(() => MetaWhatsappTemplates.findOne({ waba_id: wabaId, name, language }, { _id: 0, status: 1, category: 1 }).lean())
    : null;
  const label = `"${name}" (${language})`;
  if (!row) {
    return { ok: false, name, language, code: 'TEMPLATE_MISSING', message: `The WhatsApp template ${label} is not in the platform's WhatsApp account yet. Create it in Templates (category Utility), wait for Meta to approve it, then try again.` };
  }
  const status = String(row.status || '').toUpperCase();
  if (status !== 'APPROVED') {
    return { ok: false, name, language, code: 'TEMPLATE_NOT_APPROVED', message: `The WhatsApp template ${label} is ${status.toLowerCase() || 'not approved'} at Meta. It can be sent once Meta approves it.` };
  }
  if (String(row.category || '').toUpperCase() !== 'UTILITY') {
    return { ok: false, name, language, code: 'TEMPLATE_NOT_UTILITY', message: `The WhatsApp template ${label} is in the ${String(row.category || 'unknown').toLowerCase()} category. It must be a Utility template.` };
  }
  const template = (await inbox.listTemplates()).find((t) => t.name === name && t.language === language);
  const fields = template?.fields;
  if (!template || fields.header || fields.buttons.length || fields.body.length !== 4) {
    return { ok: false, name, language, code: 'TEMPLATE_MISMATCH', message: `The WhatsApp template ${label} must have exactly four body values (name, workspace, link, email) and no header or button values.` };
  }
  return { ok: true, name, language, template };
}

async function loadTenant(tenantId) {
  const tenant = await sys(() => Tenants.findOne({ id: Number(tenantId) }, { _id: 0 }).lean());
  if (!tenant || tenant.status === 'deleted') throw new WelcomeError(404, 'Workspace not found');
  return tenant;
}

// The owner's login, or their still-pending invitation.
async function ownerOf(tenant) {
  const user = tenant.owner_user_id
    ? await sys(() => Users.findOne({ id: tenant.owner_user_id, tenant_id: tenant.id }, { _id: 0, id: 1, name: 1, email: 1, phone: 1, is_active: 1, last_login: 1 }).lean())
    : null;
  if (user) return { kind: 'user', id: user.id, name: user.name, email: user.email, phone: user.phone || null, active: user.is_active !== false, signed_in: Boolean(user.last_login) };
  const invite = await runAsTenant(tenant.id, () => Invitations.findOne(
    { role: 'owner', accepted_at: null, revoked_at: null },
    { _id: 0, id: 1, name: 1, email: 1 },
  ).sort({ created_at: -1 }).lean());
  if (invite) return { kind: 'invitation', id: invite.id, name: invite.name, email: invite.email, phone: null, active: true, signed_in: false };
  return null;
}

async function sendsInLastHour(tenantId) {
  return sys(() => AuditEvents.countDocuments({ tenant_id: Number(tenantId), event: EVENT, created_at: { $gt: new Date(Date.now() - 3600 * 1000) } }));
}

const firstName = (owner) => String(owner.name || '').trim() || 'there';
const suggestedNumber = (tenant, owner) => {
  const raw = tenant.alerts_whatsapp?.number || owner?.phone || '';
  const d = String(raw).replace(/\D/g, '');
  return d.length >= 11 && d.length <= 15 ? `+${d}` : '';
};

function bodyValues(template, { name, workspace, link, email }) {
  // {{1}}..{{4}} by number, whatever order the wording uses; named values in order of appearance.
  const names = template.fields.body.map((v) => v.name);
  const [a, b, c, d] = template.fields.named ? names : [...names].sort((x, y) => Number(x) - Number(y));
  return { [a]: name, [b]: workspace, [c]: link, [d]: email };
}

/** What the dialog shows before sending. Never creates a link. */
async function preview(tenantId) {
  const tenant = await loadTenant(tenantId);
  const owner = await ownerOf(tenant);
  const status = await templateStatus();
  const used = await sendsInLastHour(tenant.id);
  const values = owner ? { name: firstName(owner), workspace: tenant.name, link: LINK_PLACEHOLDER, email: owner.email } : null;
  let text = null;
  if (status.ok && values) {
    text = status.template.body.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, key) => bodyValues(status.template, values)[key] ?? '');
  }
  return {
    workspace: { id: tenant.id, name: tenant.name, status: tenant.status },
    owner: owner ? { name: owner.name || null, email: owner.email, kind: owner.kind, active: owner.active, signed_in: owner.signed_in } : null,
    suggested_number: suggestedNumber(tenant, owner),
    template: { ok: status.ok, name: status.name, language: status.language, code: status.code || null, message: status.message || null },
    preview_text: text,
    login_url: notify.appUrl(),
    link_valid_hours: LINK_TTL_HOURS,
    rate: { limit: maxPerHour(), used, remaining: Math.max(0, maxPerHour() - used) },
  };
}

// Issues the one-time link and returns { url, revoke } (revoke kills it again).
async function issueLink(tenant, owner) {
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = sha256(token);
  const expires = new Date(Date.now() + LINK_TTL_HOURS * 3600 * 1000);
  if (owner.kind === 'user') {
    await sys(() => Users.updateOne({ id: owner.id }, { $set: { reset_token_hash: hash, reset_token_expires_at: expires } }));
    return {
      url: `${notify.appUrl()}/reset-password/${token}`,
      expires,
      revoke: () => sys(() => Users.updateOne({ id: owner.id, reset_token_hash: hash }, { $unset: { reset_token_hash: '', reset_token_expires_at: '' } })),
    };
  }
  await runAsTenant(tenant.id, () => Invitations.updateOne({ id: owner.id }, { $set: { token_hash: hash, expires_at: expires } }));
  return {
    url: `${notify.appUrl()}/invite/${token}`,
    expires,
    // An invitation stays pending; only this link stops working.
    revoke: () => runAsTenant(tenant.id, () => Invitations.updateOne({ id: owner.id, token_hash: hash }, { $set: { token_hash: sha256(crypto.randomBytes(32)) } })),
  };
}

const inFlight = new Set();

/**
 * Sends the "workspace ready" message. { tenantId, phone, confirmOptIn, staff: { id, name }, req }
 * Resolves to { sent: true, to (masked), expires_at, link_kind }.
 */
async function send({ tenantId, phone, confirmOptIn, staff = {}, req = null }) {
  const tenant = await loadTenant(tenantId);
  if (tenant.status === 'suspended') throw new WelcomeError(409, 'This workspace is suspended. Reinstate it before sending sign-in details.', 'WORKSPACE_SUSPENDED');
  const number = normalizeNumber(phone);
  if (confirmOptIn !== true) throw new WelcomeError(400, 'Confirm that the client agreed to get this message on WhatsApp.', 'OPT_IN_REQUIRED');
  const owner = await ownerOf(tenant);
  if (!owner) throw new WelcomeError(409, 'This workspace has no owner login yet, so there is nothing to send.', 'NO_OWNER');
  if (!owner.active) throw new WelcomeError(409, 'The owner login is deactivated. Reactivate it first.', 'OWNER_INACTIVE');

  const status = await templateStatus();
  if (!status.ok) throw new WelcomeError(409, status.message, status.code);

  if (inFlight.has(tenant.id)) throw new WelcomeError(409, 'A message to this client is already being sent. Wait a moment.', 'SEND_IN_PROGRESS');
  inFlight.add(tenant.id);
  try {
    const used = await sendsInLastHour(tenant.id);
    if (used >= maxPerHour()) {
      throw new WelcomeError(429, `Sign-in details were already sent ${used} times in the last hour. Try again later.`, 'RATE_LIMITED');
    }

    const link = await issueLink(tenant, owner);
    const built = inbox.buildTemplateMessage(status.template, {
      body: bodyValues(status.template, { name: firstName(owner), workspace: tenant.name, link: link.url, email: owner.email }),
    });
    const storedText = built.text.split(link.url).join(LINK_PLACEHOLDER);
    const meta = {
      to: maskNumber(number), email: owner.email, template: status.name, language: status.language,
      link_kind: owner.kind === 'user' ? 'set_password' : 'invitation', expires_at: link.expires, opt_in_confirmed: true,
    };
    const actor = req ? null : { actor_type: 'staff', actor_user_id: staff.id ?? null };

    let result;
    try {
      result = await inbox.sendBuiltTemplate({ phone: number, template: status.template, built, storedText, staff });
    } catch (error) {
      await link.revoke().catch(() => {});
      const reason = error.message || 'WhatsApp did not accept the message';
      await audit.record(EVENT, { tenantId: tenant.id, req, actor, targetType: 'user', targetId: owner.id, meta: { ...meta, status: 'failed', error: reason.slice(0, 300) } });
      if (error instanceof inbox.InboxError && error.code === 'INBOX_NOT_CONFIGURED') throw new WelcomeError(409, status.message || error.message, 'PLATFORM_NOT_CONFIGURED');
      throw new WelcomeError(502, `${reason.replace(/^Not sent: /, 'WhatsApp did not send the message: ')}. The link was cancelled; you can try again.`, 'SEND_FAILED');
    }
    await audit.record(EVENT, {
      tenantId: tenant.id, req, actor, targetType: 'user', targetId: owner.id,
      meta: { ...meta, status: 'sent', wa_message_id: result.message?.wa_message_id || null },
    });
    return { sent: true, to: meta.to, expires_at: link.expires, link_kind: meta.link_kind, contact_id: result.contact_id };
  } finally {
    inFlight.delete(tenant.id);
  }
}

module.exports = {
  WelcomeError, EVENT, LINK_TTL_HOURS, LINK_PLACEHOLDER,
  normalizeNumber, maskNumber, templateConfig, templateStatus, preview, send,
};
