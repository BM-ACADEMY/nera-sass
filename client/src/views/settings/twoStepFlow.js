// Pure rules for two-step verification in Settings (TwoStepMethods.jsx and
// TwoStepDialogs.jsx): which methods are shown, what the switch at the top
// does, which step the indicator shows, which current code is asked for first,
// and whether that code is sent by itself. The server still checks the
// password and the current code on every change.

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

// Whether the confirmation the server reported is still good for a request
// (a few seconds of margin). The password itself is never kept.
export const isConfirmed = (until, now = Date.now()) => Boolean(until) && until - now > 5000;

// What the confirm pop-up sends.
export function confirmationProof({ hasMfa, password, method, code }) {
  if (!hasMfa) return { password };
  return method === 'recovery' ? { password, recovery_code: code.trim() } : { password, code_method: method, code };
}

// The current code asked for first: the default method when it can be used,
// then the authenticator app, then any other method, then a recovery code.
// null when two-step verification is off (only the password is needed).
export function firstCodeMethod(me) {
  if (!me?.mfa_enabled) return null;
  const usable = me.mfa_methods || [];
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
