/**
 * My sessions: where this account is signed in (customer users and staff).
 *
 *   GET    /api/account/sessions               the caller's live sessions
 *   DELETE /api/account/sessions/:id           sign one of them out
 *   POST   /api/account/sessions/revoke-others sign out every other device
 *   POST   /api/account/sessions/confirm-code  send a two-step code (email or WhatsApp) for those
 *   PUT    /api/account/sessions/current/hints  device details from the app
 *   PATCH  /api/account/sessions/:id           rename one of them ({ name })
 *
 * Signing a device out (one or all others) needs the password again, plus a
 * two-step code when that is on, so a stolen token alone cannot keep the
 * owner signed out. Wrong passwords count toward the login lockout. The
 * token re-issued by revoke-others ends when this session already ended: it
 * never gets a fresh lifetime.
 *
 * Every query is limited to req.user.id (from the verified token and the
 * database), so nobody can see or end another user's sessions; a session id
 * that is not the caller's answers 404 like one that does not exist.
 */
const express = require('express');
const { Users } = require('../models');
const { requireAuth, issueAccessToken } = require('../middleware/authMiddleware');
const { runAsSystem } = require('../services/tenantContext');
const { hasMfa, methodsOf, onHold } = require('../services/mfa');
const emailOtp = require('../services/emailOtp');
const whatsappOtp = require('../services/whatsappOtp');
const { confirmIdentity, confirmPassword } = require('../services/stepUp');
const sessions = require('../services/sessions');
const audit = require('../services/audit');
const { rateLimit } = require('../utils/rateLimit');

const router = express.Router();
const sys = (fn) => runAsSystem(fn, 'account-sessions');
const writeLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, key: (req) => `sessions:${req.user?.id ?? req.ip}` });
// Password / code tries for signing devices out.
const confirmLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, key: (req) => `sessions-confirm:${req.user?.id ?? req.ip}`, message: 'Too many attempts. Wait a few minutes and try again.' });

// Device details and names: cheap writes, own sessions only.
const detailsLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, key: (req) => `sessions-details:${req.user?.id ?? req.ip}`, message: 'Too many changes. Wait a few minutes and try again.' });

const loadUser = (id) => sys(() => Users.findOne({ id }, { _id: 0 }).lean());

function fail(res, error) {
  console.error('[account-sessions]', error.message);
  return res.status(500).json({ error: 'Could not load your sessions. Try again in a moment.' });
}

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const user = await loadUser(req.user.id);
    const list = await sessions.listForUser(user, req.authSessionId);
    // A token from before sessions were tracked has no row: say so, so the page
    // can explain why "This device" is missing.
    // mfa_methods: what signing a device out will ask for besides the password
    // (a just-added method cannot confirm it while an older one can).
    const methods = methodsOf(user);
    const older = methods.filter((m) => !onHold(user, m));
    return res.json({ sessions: list, current_session_tracked: Boolean(req.authSessionId), mfa_methods: older.length ? older : methods });
  } catch (error) {
    return fail(res, error);
  }
});

// Sends a two-step code for signing devices out, by email (default) or
// WhatsApp (body.channel). Needs the password first, so a token alone cannot
// overwrite a pending sign-in code. Same code rules as every other code
// (otpStore.js, purpose 'confirm').
const CONFIRM_CHANNELS = { email: emailOtp, whatsapp: whatsappOtp };
router.post('/confirm-code', writeLimit, confirmLimit, async (req, res) => {
  try {
    const channel = req.body?.channel === 'whatsapp' ? 'whatsapp' : 'email';
    const user = await loadUser(req.user.id);
    if (!methodsOf(user).includes(channel)) {
      return res.status(400).json({ error: channel === 'whatsapp' ? 'WhatsApp codes are not turned on for this account' : 'Email codes are not turned on for this account' });
    }
    const refused = await confirmPassword(user, req.body || {}, req);
    if (refused) return res.status(refused.status).json(refused.body);
    return res.json(await CONFIRM_CHANNELS[channel].sendCode(user, 'confirm'));
  } catch (error) {
    if (error instanceof emailOtp.EmailOtpError || error instanceof whatsappOtp.WhatsappOtpError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    console.error('[account-sessions] code not sent:', error.message);
    return res.status(502).json({ error: 'The code could not be sent. Try again in a minute.' });
  }
});

router.post('/revoke-others', writeLimit, confirmLimit, async (req, res) => {
  try {
    const user = await loadUser(req.user.id);
    const refused = await confirmIdentity(user, req.body || {}, 'confirm', req);
    if (refused) return res.status(refused.status).json(refused.body);

    // token_version + 1 also ends tokens from before sessions were tracked;
    // this session gets a new token with the same session id (or a new
    // tracked session if it had none), keeping its two-factor state.
    const updated = await sys(() => Users.findOneAndUpdate(
      { id: req.user.id },
      { $inc: { token_version: 1 } },
      { new: true, projection: { _id: 0 } },
    ).lean());
    const revoked = await sessions.revokeOthers(updated.id, req.authSessionId, 'signed_out_by_user');
    // The new token ends no later than the current one: never extended.
    const { sid, expiresAt } = await sessions.continueSession(updated, req);
    await audit.record(audit.EVENTS.SESSIONS_REVOKED, { tenantId: req.user.tenant_id ?? null, req, targetType: 'user', targetId: req.user.id, meta: { self: true, scope: 'others', count: revoked } });
    const token = issueAccessToken(updated, { mfa: hasMfa(updated) || Boolean(req.sessionMfa), sid, expiresAt });
    return res.json({ success: true, revoked, token });
  } catch (error) {
    return fail(res, error);
  }
});

// The app's User-Agent Client Hints for this device (model, platform,
// version); only the caller's own current session is updated.
router.put('/current/hints', detailsLimit, async (req, res) => {
  try {
    if (!req.authSessionId) return res.json({ success: true, stored: false });
    const user = await loadUser(req.user.id);
    const stored = await sessions.setHints(user, req.authSessionId, req.body?.client_hints);
    return res.json({ success: true, stored });
  } catch (error) {
    return fail(res, error);
  }
});

router.patch('/:id', detailsLimit, async (req, res) => {
  try {
    const name = req.body?.name;
    if (name != null && typeof name !== 'string') return res.status(400).json({ error: 'The name must be text.' });
    if (typeof name === 'string' && Array.from(name.trim()).length > 40) return res.status(400).json({ error: 'Use 40 characters or fewer.', code: 'NAME_TOO_LONG' });
    const user = await loadUser(req.user.id);
    const ok = await sessions.rename(user, req.params.id, name);
    if (!ok) return res.status(404).json({ error: 'This session has already ended or does not exist', code: 'SESSION_NOT_FOUND' });
    return res.json({ success: true, name: sessions.sanitizeName(name) });
  } catch (error) {
    return fail(res, error);
  }
});

router.delete('/:id', writeLimit, confirmLimit, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' });
    if (req.authSession && req.authSession.id === id) {
      return res.status(400).json({ error: 'This is the device you are using. Use Log out instead.', code: 'CURRENT_SESSION' });
    }
    const user = await loadUser(req.user.id);
    const refused = await confirmIdentity(user, req.body || {}, 'confirm', req);
    if (refused) return res.status(refused.status).json(refused.body);
    const ok = await sessions.revokeOne(user, id, 'signed_out_by_user');
    if (!ok) return res.status(404).json({ error: 'This session has already ended or does not exist', code: 'SESSION_NOT_FOUND' });
    await audit.record(audit.EVENTS.SESSION_REVOKED, { tenantId: req.user.tenant_id ?? null, req, targetType: 'user_session', targetId: id, meta: { self: true } });
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error);
  }
});

module.exports = router;
