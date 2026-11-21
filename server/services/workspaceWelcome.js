/**
 * "Send to client": staff send a new workspace's owner a WhatsApp message from
 * the platform number with what they need to start, in order:
 *   1. a one-time link to set their password (works once),
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
 *   - Staff type the number twice; both must match.
 *   - An owner who has already signed in keeps control of their account:
 *     only the founder (Admin (Owner)) can send them a link, it lasts as long
 *     as a "Forgot password" link (PASSWORD_RESET_TTL_MINUTES, default 60),
 *     and the owner is emailed that a link went to the masked number.
 *     First-time owners (never signed in) get a 72-hour link, as the template
 *     text says.
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

const LINK_TTL_HOURS = 72; // first-time owners; the template text says 72 hours
// An owner who already signed in: the same life as a "Forgot password" link (authController).
const resetTtlMinutes = () => Number(process.env.PASSWORD_RESET_TTL_MINUTES || 60);
const linkTtlMinutes = (owner) => (owner?.signed_in || owner?.has_users ? resetTtlMinutes() : LINK_TTL_HOURS * 60);
const canReachSignedInOwner = (staffRole) => staffRole === 'founder';
const SIGNED_IN_MESSAGE = 'This owner already signs in to Getnera. Only the Admin (Owner) can send them a new set-password link. If they forgot their password, ask them to use "Forgot password" on the sign-in page.';
const HAS_USERS_MESSAGE = 'This workspace already has users but no owner login on record. Only the Admin (Owner) can send an owner invitation link here.';
// Why this staff member may not send, or null.
function refusal(owner, staffRole) {
  if (!owner || canReachSignedInOwner(staffRole)) return null;
  if (owner.signed_in) return { code: 'OWNER_ALREADY_SIGNED_IN', message: SIGNED_IN_MESSAGE };
  if (owner.has_users) return { code: 'WORKSPACE_HAS_USERS', message: HAS_USERS_MESSAGE };
  return null;
}
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

// The owner's login, or their still-pending invitation. `signed_in`: the owner
// has taken control (signed in, or chose their own password through a link).
async function ownerOf(tenant) {
  const user = tenant.owner_user_id
    ? await sys(() => Users.findOne({ id: tenant.owner_user_id, tenant_id: tenant.id }, { _id: 0, id: 1, name: 1, email: 1, phone: 1, is_active: 1, last_login: 1, password_claimed_at: 1 }).lean())
    : null;
  if (user) {
    return {
      kind: 'user', id: user.id, name: user.name, email: user.email, phone: user.phone || null, active: user.is_active !== false,
      signed_in: Boolean(user.last_login || user.password_claimed_at),
    };
  }
  const invite = await runAsTenant(tenant.id, () => Invitations.findOne(
    { role: 'owner', accepted_at: null, revoked_at: null },
    { _id: 0, id: 1, name: 1, email: 1 },
  ).sort({ created_at: -1 }).lean());
  if (invite) {
    // Logins already in the workspace: the invitation path is then founder-only.
    const hasUsers = Boolean(await sys(() => Users.exists({ tenant_id: tenant.id })));
    return { kind: 'invitation', id: invite.id, name: invite.name, email: invite.email, phone: null, active: true, signed_in: false, has_users: hasUsers };
  }
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
async function preview(tenantId, { staffRole = null } = {}) {
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
    link_valid_minutes: linkTtlMinutes(owner),
    // false: only the founder may send here (the owner already took control, or
    // the workspace already has users).
    can_send: !refusal(owner, staffRole),
    blocked_message: refusal(owner, staffRole)?.message || null,
    rate: { limit: maxPerHour(), used, remaining: Math.max(0, maxPerHour() - used) },
  };
}

// Issues the one-time link and returns { url, revoke } (revoke kills it again).
async function issueLink(tenant, owner) {
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = sha256(token);
  const expires = new Date(Date.now() + linkTtlMinutes(owner) * 60000);
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
 * Sends the "workspace ready" message.
 * { tenantId, phone, phoneConfirm, confirmOptIn, staff: { id, name, role }, req }
 * Resolves to { sent: true, to (masked), expires_at, link_kind }.
 */
async function send({ tenantId, phone, phoneConfirm, confirmOptIn, staff = {}, req = null }) {
  const tenant = await loadTenant(tenantId);
  if (tenant.status === 'suspended') throw new WelcomeError(409, 'This workspace is suspended. Reinstate it before sending sign-in details.', 'WORKSPACE_SUSPENDED');
  const number = normalizeNumber(phone);
  let confirmed = null;
  try { confirmed = normalizeNumber(phoneConfirm); } catch { /* reported as a mismatch below */ }
  if (confirmed !== number) throw new WelcomeError(400, 'The two WhatsApp numbers do not match. Type the client\'s number again in both boxes.', 'NUMBER_MISMATCH');
  if (confirmOptIn !== true) throw new WelcomeError(400, 'Confirm that the client agreed to get this message on WhatsApp.', 'OPT_IN_REQUIRED');
  const owner = await ownerOf(tenant);
  if (!owner) throw new WelcomeError(409, 'This workspace has no owner login yet, so there is nothing to send.', 'NO_OWNER');
  if (!owner.active) throw new WelcomeError(409, 'The owner login is deactivated. Reactivate it first.', 'OWNER_INACTIVE');
  const refused = refusal(owner, staff.role);
  if (refused) throw new WelcomeError(403, refused.message, refused.code);

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
      owner_signed_in: owner.signed_in, workspace_has_users: Boolean(owner.has_users),
    };
    const actor = req ? null : { actor_type: 'staff', actor_user_id: staff.id ?? null };

    let result;
    try {
      result = await inbox.sendBuiltTemplate({ phone: number, template: status.template, built, storedText, staff });
    } catch (error) {
      await link.revoke().catch(() => {});
      const reason = error.message || 'WhatsApp did not accept the message';
      // strict: these events are the hourly rate-limit counter, so a lost one must not pass silently.
      await audit.record(EVENT, { tenantId: tenant.id, req, actor, targetType: 'user', targetId: owner.id, meta: { ...meta, status: 'failed', error: reason.slice(0, 300) }, strict: true });
      if (error instanceof inbox.InboxError && error.code === 'INBOX_NOT_CONFIGURED') throw new WelcomeError(409, status.message || error.message, 'PLATFORM_NOT_CONFIGURED');
      throw new WelcomeError(502, `${reason.replace(/^Not sent: /, 'WhatsApp did not send the message: ')}. The link was cancelled; you can try again.`, 'SEND_FAILED');
    }
    await audit.record(EVENT, {
      tenantId: tenant.id, req, actor, targetType: 'user', targetId: owner.id,
      meta: { ...meta, status: 'sent', wa_message_id: result.message?.wa_message_id || null },
      strict: true,
    });
    if (owner.kind === 'user') {
      // The owner hears about every set-password link for their login, by email, so a
      // link sent to the wrong number does not go unnoticed. Never the link itself.
      await notify.signInLinkSentEmail({
        to: owner.email, name: owner.name, workspaceName: tenant.name, maskedNumber: meta.to, expiresAt: link.expires,
      }).catch((error) => console.warn(`[workspace-welcome] notice email to the owner failed: ${error.message}`));
    }
    return { sent: true, to: meta.to, expires_at: link.expires, link_kind: meta.link_kind, contact_id: result.contact_id };
  } finally {
    inFlight.delete(tenant.id);
  }
}

module.exports = {
  WelcomeError, EVENT, LINK_TTL_HOURS, LINK_PLACEHOLDER, resetTtlMinutes,
  normalizeNumber, maskNumber, templateConfig, templateStatus, preview, send,
};
