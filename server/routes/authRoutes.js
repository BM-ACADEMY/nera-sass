const express = require('express');
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/authMiddleware');
const { rateLimit } = require('../utils/rateLimit');

const router = express.Router();

const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: Number(process.env.LOGIN_RATE_LIMIT || 30) });
const resetLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
const tokenLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });

// Public
router.post('/login', loginLimit, authController.login);
router.post('/mfa/verify', loginLimit, authController.verifyMfa);
router.post('/mfa/email/send', loginLimit, authController.sendMfaEmail);
router.post('/password/forgot', resetLimit, authController.forgotPassword);
router.post('/password/reset', resetLimit, authController.resetPassword);
router.get('/invitations/:token', tokenLimit, authController.previewInvitation);
router.post('/invitations/accept', tokenLimit, authController.acceptInvitation);

// MFA enrolment: with the mfa_token from login (mandatory enrolment) or a session.
const sessionOrMfaToken = (req, res, next) => (req.body?.mfa_token ? next() : requireAuth(req, res, next));
router.post('/mfa/setup', loginLimit, sessionOrMfaToken, authController.startMfaSetup);
router.post('/mfa/setup/confirm', loginLimit, sessionOrMfaToken, authController.confirmMfaSetup);
router.post('/mfa/email/setup', loginLimit, sessionOrMfaToken, authController.startEmailSetup);
router.post('/mfa/email/setup/confirm', loginLimit, sessionOrMfaToken, authController.confirmEmailSetup);

// Signed in (customer users and platform staff)
router.get('/me', requireAuth, authController.me);
router.post('/change-password', requireAuth, authController.changePassword);
router.post('/logout-all', requireAuth, authController.logoutAll);
router.patch('/profile', requireAuth, authController.updateProfile);
router.post('/mfa/disable', loginLimit, requireAuth, authController.disableMfaMethod);
router.post('/mfa/recovery-codes', loginLimit, requireAuth, authController.regenerateRecoveryCodes);

// Users are never created here: customer users join by invitation
// (/api/team/invitations, /api/admin/users) and set their own password.

module.exports = router;
