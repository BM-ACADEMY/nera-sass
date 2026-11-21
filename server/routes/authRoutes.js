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
router.post('/mfa/whatsapp/send', loginLimit, authController.sendMfaWhatsapp);
router.post('/password/forgot', resetLimit, authController.forgotPassword);
router.post('/password/reset', resetLimit, authController.resetPassword);
router.get('/invitations/:token', tokenLimit, authController.previewInvitation);
router.post('/invitations/accept', tokenLimit, authController.acceptInvitation);

// Password and code guesses on the re-authenticated endpoints, per account
// (after authentication) so one stolen session cannot keep guessing from
// many addresses.
const reauthLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.REAUTH_RATE_LIMIT || 20),
  key: (req) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`),
});

// MFA enrolment: with the mfa_token from login (mandatory enrolment) or a
// session, which must also send the current password (and a current code when
// two-step verification is already on).
const sessionOrMfaToken = (req, res, next) => (req.body?.mfa_token ? next() : requireAuth(req, res, next));
router.post('/mfa/setup', loginLimit, sessionOrMfaToken, reauthLimit, authController.startMfaSetup);
router.post('/mfa/setup/confirm', loginLimit, sessionOrMfaToken, reauthLimit, authController.confirmMfaSetup);
router.post('/mfa/email/setup', loginLimit, sessionOrMfaToken, reauthLimit, authController.startEmailSetup);
router.post('/mfa/email/setup/confirm', loginLimit, sessionOrMfaToken, reauthLimit, authController.confirmEmailSetup);
router.post('/mfa/whatsapp/setup', loginLimit, sessionOrMfaToken, reauthLimit, authController.startWhatsappSetup);
router.post('/mfa/whatsapp/setup/confirm', loginLimit, sessionOrMfaToken, reauthLimit, authController.confirmWhatsappSetup);

// Signed in (customer users and platform staff)
router.get('/me', requireAuth, authController.me);
router.post('/change-password', requireAuth, reauthLimit, authController.changePassword);
router.post('/logout-all', requireAuth, authController.logoutAll);
router.patch('/profile', requireAuth, authController.updateProfile);
router.post('/mfa/disable', loginLimit, requireAuth, reauthLimit, authController.disableMfaMethod);
router.post('/mfa/recovery-codes', loginLimit, requireAuth, reauthLimit, authController.regenerateRecoveryCodes);
// Code for confirming a security change: /mfa/reauth/email/send or /mfa/reauth/whatsapp/send.
router.post('/mfa/reauth/:channel/send', loginLimit, requireAuth, reauthLimit, authController.sendReauthCode);
router.post('/mfa/default', requireAuth, authController.setDefaultMfaMethod);

// Users are never created here: customer users join by invitation
// (/api/team/invitations, /api/admin/users) and set their own password.

module.exports = router;
