// Pure rules for the two-step setup panels in Settings (TwoStepMethods.jsx):
// which step the indicator shows, which current code is asked for first, and
// whether that code is sent by itself when the panel opens. The server still
// checks the password and the current code on every change.

export const CODE_CHANNELS = ['email', 'whatsapp'];
export const DEFAULT_RESEND_SECONDS = 45;

// The three steps shown while turning a method on.
export function setupSteps(method) {
  return ["Confirm it's you", method === 'totp' ? 'Scan the QR code' : 'Get a code', 'Enter the code'];
}

// Only turning a method on has more than one step; turning off and new
// recovery codes are a single confirm step.
export const showsSteps = (action) => action === 'enable';

// 1, 2 or 3. On the QR screen step 2 stays current until a digit is typed;
// for email / WhatsApp the code was already sent, so the finish screen is 3.
export function currentStep({ step, method, codeLength = 0 }) {
  if (step !== 'finish') return 1;
  if (method === 'totp') return codeLength > 0 ? 3 : 2;
  return 3;
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
// cooldown (reopening the panel shows the code already sent).
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
