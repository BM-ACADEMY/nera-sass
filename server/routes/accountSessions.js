/**
 * My sessions: where this account is signed in (customer users and staff).
 *
 *   GET    /api/account/sessions               the caller's live sessions
 *   DELETE /api/account/sessions/:id           sign one of them out
 *   POST   /api/account/sessions/revoke-others sign out every other device
 *          (password, plus a two-step code when that is on)
 *   POST   /api/account/sessions/revoke-others/code  email that code
 *
 * Signing out other devices needs the password (and two-step code) again, so
 * a stolen token alone cannot lock the owner out. The re-issued token ends
 * when this session already ended: it never gets a fresh lifetime.
 *
 * Every query is limited to req.user.id (from the verified token and the
 * database), so nobody can see or end another user's sessions; a session id
 * that is not the caller's answers 404 like one that does not exist.
 */
const express = require('express');
const { Users } = require('../models');
const { requireAuth, issueAccessToken } = require('../middleware/authMiddleware');
const { runAsSystem } = require('../services/tenantContext');
const { hasMfa, methodsOf } = require('../services/mfa');
const emailOtp = require('../services/emailOtp');
const { confirmIdentity } = require('../services/stepUp');
const sessions = require('../services/sessions');
const audit = require('../services/audit');
const { rateLimit } = require('../utils/rateLimit');

const router = express.Router();
const sys = (fn) => runAsSystem(fn, 'account-sessions');
const writeLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, key: (req) => `sessions:${req.user?.id ?? req.ip}` });
// Password / code tries for "sign out all other devices".
const confirmLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, key: (req) => `sessions-confirm:${req.user?.id ?? req.ip}`, message: 'Too many attempts. Wait a few minutes and try again.' });

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
    // mfa_methods: what "sign out all other devices" will ask for besides the password.
    return res.json({ sessions: list, current_session_tracked: Boolean(req.authSessionId), mfa_methods: methodsOf(user) });
  } catch (error) {
    return fail(res, error);
  }
});

// Emails a code for confirming "sign out all other devices" (email two-step).
router.post('/revoke-others/code', writeLimit, async (req, res) => {
  try {
    const user = await loadUser(req.user.id);
    if (!methodsOf(user).includes('email')) return res.status(400).json({ error: 'Email codes are not turned on for this account' });
    return res.json(await emailOtp.sendCode(user, 'confirm'));
  } catch (error) {
    if (error instanceof emailOtp.EmailOtpError) return res.status(error.status).json({ error: error.message, code: error.code });
    console.error('[account-sessions] code not sent:', error.message);
    return res.status(502).json({ error: 'The code could not be emailed. Try again in a minute.' });
  }
});

router.post('/revoke-others', writeLimit, confirmLimit, async (req, res) => {
  try {
    const user = await loadUser(req.user.id);
    const refused = await confirmIdentity(user, req.body || {}, 'confirm');
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
    // The new token ends no later than the current one (and its session row):
    // signing out others never extends this session.
    let expiresAt = req.authTokenExpiresAt;
    let sid = req.authSessionId;
    if (sid) {
      const rowExpires = await sessions.keepSession(sid, updated);
      if (rowExpires && (!expiresAt || rowExpires < expiresAt)) expiresAt = rowExpires;
    } else {
      sid = await sessions.createSession(updated, sessions.clientInfo(req), { expiresAt });
    }
    await audit.record(audit.EVENTS.SESSIONS_REVOKED, { tenantId: req.user.tenant_id ?? null, req, targetType: 'user', targetId: req.user.id, meta: { self: true, scope: 'others', count: revoked } });
    const token = issueAccessToken(updated, { mfa: hasMfa(updated) || Boolean(req.sessionMfa), sid, expiresAt });
    return res.json({ success: true, revoked, token });
  } catch (error) {
    return fail(res, error);
  }
});

router.delete('/:id', writeLimit, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' });
    if (req.authSession && req.authSession.id === id) {
      return res.status(400).json({ error: 'This is the device you are using. Use Log out instead.', code: 'CURRENT_SESSION' });
    }
    const user = await loadUser(req.user.id);
    const ok = await sessions.revokeOne(user, id, 'signed_out_by_user');
    if (!ok) return res.status(404).json({ error: 'This session has already ended or does not exist', code: 'SESSION_NOT_FOUND' });
    await audit.record(audit.EVENTS.SESSION_REVOKED, { tenantId: req.user.tenant_id ?? null, req, targetType: 'user_session', targetId: id, meta: { self: true } });
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error);
  }
});

module.exports = router;
