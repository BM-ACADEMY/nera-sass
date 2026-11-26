// Pure rules for two-step verification in Settings (TwoStepMethods.jsx and
// TwoStepDialogs.jsx): which methods are shown, what the switch at the top
// does, which step the indicator shows, when a current code is asked for (not
// for adding a method), which one first, and whether it is sent by itself. The
// server checks every change again.

import { codeDeadline } from '../../utils/otpTimer.js';

export const CODE_CHANNELS = ['email', 'whatsapp'];
export const DEFAULT_RESEND_SECONDS = 45;
// The methods that can turn two-step verification on. WhatsApp codes are an
// extra method on top of one of these.
export const PRIMARY_METHODS = ['totp', 'email'];
// Headings for turning a method on or off.
export const TITLES = {
  enable: { totp: 'Set up the authenticator app', email: 'Set up email codes', whatsapp: 'Set up WhatsApp codes' },
  disable: { totp: 'Turn off the authenticator app', email: 'Turn off email codes', whatsapp: 'Turn off WhatsApp codes' },
};

export const enrolledMethods = (me) => me?.mfa_methods_enrolled || me?.mfa_methods || [];
const hasPrimary = (methods) => PRIMARY_METHODS.some((m) => methods.includes(m));

// The method cards Settings shows. The authenticator app always; email and
// WhatsApp codes only while the server allows new ones
// (me.mfa_extra_methods_enabled, MFA_EXTRA_METHODS_ENABLED), or when this
// person already has them on (so they can still turn them off).
export function shownMethods(me) {
  const extra = me?.mfa_extra_methods_enabled === true;
  const enrolled = enrolledMethods(me);
  return ['totp', 'email', 'whatsapp'].filter((method) => method === 'totp' || extra || enrolled.includes(method));
}

// Methods offered when the switch is turned on.
export const setupChoices = (me) => shownMethods(me).filter((m) => PRIMARY_METHODS.includes(m) && !enrolledMethods(me).includes(m));

// The switch: on while any method is on; locked when the account must keep
// two-step verification.
export function switchState(me) {
  const on = Boolean(me?.mfa_enabled);
  const locked = on && Boolean(me?.mfa_required_by_policy);
  return {
    on,
    locked,
    reason: locked ? 'Your account must keep two-step verification on, so it cannot be turned off.' : '',
  };
}

// Why a method that is off cannot be set up, or ''.
export function setupBlocker(me, method) {
  if (method !== 'whatsapp') return '';
  if (!me?.whatsapp_otp_available) return 'Not available yet.';
  if (!hasPrimary(enrolledMethods(me))) {
    return setupChoices(me).includes('email') ? 'Turn on the authenticator app or email codes first.' : 'Turn on the authenticator app first.';
  }
  return '';
}

// Why a method that is on cannot be turned off on its own, or ''.
export function removeBlocker(me, method) {
  const rest = enrolledMethods(me).filter((m) => m !== method);
  if (!rest.length) return me?.mfa_required_by_policy ? 'Your account must keep one method on.' : '';
  if (rest.length === 1 && rest[0] === 'whatsapp') return 'Turn off WhatsApp codes first, or use the switch above to turn everything off.';
  return '';
}

// An older account whose only method is WhatsApp.
export const whatsappOnly = (me) => {
  const enrolled = enrolledMethods(me);
  return enrolled.length === 1 && enrolled[0] === 'whatsapp';
};

// The three steps shown while turning a method on.
export function setupSteps(method) {
  return ["Confirm it's you", method === 'totp' ? 'Scan the QR code' : 'Get a code', 'Enter the code'];
}

// Only turning a method on has more than one step; turning off and new
// recovery codes are a single confirm step.
export const showsSteps = (action) => action === 'enable';

// 1 confirm (the pop-up), 2 the QR code or getting a code (also while the
// setup is starting), 3 entering the code.
export const currentStep = (step) => ({ confirm: 1, code: 3 }[step] || 2);

// The server wants "confirm it's you" (again).
export const needsConfirmation = (error) => ['PASSWORD_REQUIRED', 'MFA_CODE_REQUIRED'].includes(error?.code);

// Adding a method takes the password only. Everything else asks for a current
// code as well while two-step verification is on.
export const needsCodeFor = (action, me) => action.kind !== 'enable' && Boolean(me?.mfa_enabled);

// Whether the confirmation the server reported still covers `action` (a few
// seconds of margin): { until, full }. One made with the password only covers
// adding a method, nothing else. The password itself is never kept.
export function isConfirmed(confirmation, action, now = Date.now()) {
  if (!confirmation?.until || confirmation.until - now <= 5000) return false;
  return action.kind === 'enable' || confirmation.full === true;
}

// What the confirm pop-up sends.
export function confirmationProof({ action, needsCode, password, method, code }) {
  if (action.kind === 'enable') return { password, purpose: 'add' };
  if (!needsCode) return { password };
  return method === 'recovery' ? { password, recovery_code: code.trim() } : { password, code_method: method, code };
}

// Methods added in the last day: their codes cannot confirm changes yet.
export const holdOf = (me, method) => (me?.mfa_methods_on_hold || []).find((h) => h.method === method) || null;
// The methods whose current code confirms a change.
export const confirmMethods = (me) => (me?.mfa_methods || []).filter((m) => !holdOf(me, m));

// The current code asked for first: the default method when it can be used,
// then the authenticator app, then any other method, then a recovery code.
// null when two-step verification is off (only the password is needed).
export function firstCodeMethod(me) {
  if (!me?.mfa_enabled) return null;
  const usable = confirmMethods(me);
  if (usable.includes(me.mfa_default_method)) return me.mfa_default_method;
  if (usable.includes('totp')) return 'totp';
  return usable[0] || 'recovery';
}

// Seconds until another code may be asked for (0 = now).
export function secondsLeft(lastSent, now = Date.now()) {
  if (!lastSent?.at) return 0;
  const seconds = lastSent.resend_after || DEFAULT_RESEND_SECONDS;
  // Never more than the full wait (a clock read before the send).
  return Math.min(seconds, Math.max(0, Math.ceil((lastSent.at + seconds * 1000 - now) / 1000)));
}

// Send the current code by itself only for an email / WhatsApp code, only
// when two-step is on, and not again while the last one is still in its
// cooldown (reopening the pop-up shows the code already sent).
export function shouldAutoSend({ hasMfa, method, lastSent, now = Date.now() }) {
  if (!hasMfa || !CODE_CHANNELS.includes(method)) return false;
  return secondsLeft(lastSent, now) === 0;
}

// The wait the server gave for "Please wait 30 seconds before asking for a
// new code" (OTP_RESEND_WAIT), or null for any other error.
export function waitFromError(err) {
  if (err?.code !== 'OTP_RESEND_WAIT') return null;
  const match = /(\d+)\s*second/.exec(String(err.detail || err.message || ''));
  return match ? Number(match[1]) : DEFAULT_RESEND_SECONDS;
}

// The small "Use ... instead" links under the current code.
export function otherCodeMethods(usable = [], current) {
  return [...usable, 'recovery'].filter((m) => m !== current);
}

// What a reloaded page shows for the saved position (utils/twoStepWizard.js):
// { wizard, dialog, lost }. `confirmed`: the server still holds a confirmation
// for adding a method; without it the password is asked first, then the same
// step carries on. `lost`: recovery codes were on screen (or about to be) and
// cannot be shown again.
export function restoreWizard(saved, me, confirmed) {
  const none = { wizard: null, dialog: null, lost: false };
  if (!saved) return none;
  const { method, step } = saved;
  if (step === 'codes') return { ...none, lost: Boolean(me?.mfa_enabled) };
  const enrolled = enrolledMethods(me);
  // Turned on while the page was reloading: with a first method the codes were never seen.
  if (enrolled.includes(method)) return { ...none, lost: step === 'code' && enrolled.length === 1 };
  if (!shownMethods(me).includes(method) || setupBlocker(me, method)) return none;
  if (step === 'confirm') return { ...none, wizard: { method, step: 'confirm' } };
  // 'starting' until the server answered what is still waiting.
  const wizard = step === 'phone' ? { method, step: 'phone' } : { method, step: 'starting', target: step };
  if (confirmed) return { ...none, wizard };
  return { ...none, wizard, dialog: { type: 'confirm', action: { kind: 'enable', method, resume: true }, notice: 'Please confirm it’s you again to continue.' } };
}

// The step to show after the server's answer to "resume". With nothing waiting,
// the screen says so and offers a new QR code or code; nothing is sent by itself.
export function resumedWizard({ method, phone }, target, res, now = Date.now()) {
  if (method === 'totp') {
    return res.pending
      ? { method, step: target === 'code' ? 'code' : 'scan', setup: { secret: res.secret, otpauth_url: res.otpauth_url } }
      : { method, step: 'scan', missing: true };
  }
  const info = res.pending
    ? { sentTo: res.sent_to, deadline: codeDeadline(res, now), resendAt: res.resend_after ? now + res.resend_after * 1000 : 0 }
    : { sentTo: '', deadline: 0, resendAt: 0, missing: true };
  return { method, step: 'code', phone, info };
}
