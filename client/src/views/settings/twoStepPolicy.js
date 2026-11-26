// Pure rules for Settings > Two-step verification: which methods are shown,
// what the switch at the top does and why something cannot be changed. The
// server checks every change again.

export const CODE_CHANNELS = ['email', 'whatsapp'];
// The methods that can turn two-step verification on. WhatsApp codes are an
// extra method on top of one of these.
export const PRIMARY_METHODS = ['totp', 'email'];

export const enrolledMethods = (me) => me?.mfa_methods_enrolled || me?.mfa_methods || [];
const hasPrimary = (methods) => PRIMARY_METHODS.some((m) => methods.includes(m));

// Method cards. The authenticator app always. When the server holds the newer
// methods back (mfa_extra_methods_enabled: false) email and WhatsApp are shown
// only to people who already have them on.
export function shownMethods(me) {
  const enrolled = enrolledMethods(me);
  const extra = me?.mfa_extra_methods_enabled !== false;
  return ['totp', 'email', 'whatsapp'].filter((m) => m === 'totp' || extra || enrolled.includes(m));
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
  if (!hasPrimary(enrolledMethods(me))) return 'Turn on the authenticator app or email codes first.';
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

// The current code asked for first: the default method when usable, then the
// authenticator app, then any other, then a recovery code.
export function firstCodeMethod(me) {
  const usable = me?.mfa_methods || [];
  if (usable.includes(me?.mfa_default_method)) return me.mfa_default_method;
  if (usable.includes('totp')) return 'totp';
  return usable[0] || 'recovery';
}
