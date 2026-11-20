/**
 * My sessions: where this account is signed in (customer users and staff).
 *
 *   GET    /api/account/sessions               the caller's live sessions
 *   DELETE /api/account/sessions/:id           sign one of them out
 *   POST   /api/account/sessions/revoke-others sign out every other device
 *
 * Every query is limited to req.user.id (from the verified token and the
 * database), so nobody can see or end another user's sessions; a session id
 * that is not the caller's answers 404 like one that does not exist.
 */
const express = require('express');
const { Users } = require('../models');
const { requireAuth, issueAccessToken } = require('../middleware/authMiddleware');
const { runAsSystem } = require('../services/tenantContext');
const { hasMfa } = require('../services/mfa');
const sessions = require('../services/sessions');
const audit = require('../services/audit');
const { rateLimit } = require('../utils/rateLimit');

const router = express.Router();
const sys = (fn) => runAsSystem(fn, 'account-sessions');
const writeLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, key: (req) => `sessions:${req.user?.id ?? req.ip}` });

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
    return res.json({ sessions: list, current_session_tracked: Boolean(req.authSessionId) });
  } catch (error) {
    return fail(res, error);
  }
});

router.post('/revoke-others', writeLimit, async (req, res) => {
  try {
    // token_version + 1 also ends tokens from before sessions were tracked;
    // this session gets a fresh token with the same session id (or a new
    // tracked session if it had none), keeping its two-factor state.
    const updated = await sys(() => Users.findOneAndUpdate(
      { id: req.user.id },
      { $inc: { token_version: 1 } },
      { new: true, projection: { _id: 0 } },
    ).lean());
    const revoked = await sessions.revokeOthers(updated.id, req.authSessionId, 'signed_out_by_user');
    let sid = req.authSessionId;
    if (sid) await sessions.renewSession(sid, updated);
    else sid = await sessions.createSession(updated, sessions.clientInfo(req));
    await audit.record(audit.EVENTS.SESSIONS_REVOKED, { tenantId: req.user.tenant_id ?? null, req, targetType: 'user', targetId: req.user.id, meta: { self: true, scope: 'others', count: revoked } });
    const token = issueAccessToken(updated, { mfa: hasMfa(updated) || Boolean(req.sessionMfa), sid });
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
