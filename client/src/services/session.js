// Customer-app session helpers. The server stays the authority: these only
// decide what the browser shows and when it must ask the user to sign in.

export const TOKEN_KEY = 'leados_token';
export const USER_KEY = 'leados_user';
export const NOTICE_KEY = 'leados_login_notice';
export const USER_UPDATED_EVENT = 'leados:user-updated';

export const NOTICES = {
  sessionEnded: 'Your session has ended. Please sign in again.',
  signInStepExpired: 'This sign-in step has expired. Please sign in again.',
  signedOutEverywhere: 'You have been signed out of all devices. Please sign in again.',
};

// The stored session, read synchronously so a page refresh or bookmark keeps
// the user on the page they opened instead of bouncing through /login.
export function readStoredSession(storage) {
  try {
    const token = storage.getItem(TOKEN_KEY);
    const raw = storage.getItem(USER_KEY);
    if (!token || token === 'undefined' || !raw) return null;
    const user = JSON.parse(raw);
    return user && typeof user === 'object' && user.id != null ? { token, user } : null;
  } catch {
    return null;
  }
}

const PROFILE_FIELDS = ['name', 'email', 'phone', 'role', 'tenant_id', 'tenant_name', 'mfa_enabled'];

// Applies the current /api/auth/me answer to the stored user (display only).
export function mergeProfile(stored, me) {
  if (!stored || !me || me.id !== stored.id) return { user: stored, changed: false };
  let changed = false;
  const user = { ...stored };
  for (const field of PROFILE_FIELDS) {
    if (me[field] !== undefined && me[field] !== stored[field]) {
      user[field] = me[field];
      changed = true;
    }
  }
  return { user, changed };
}

// A wrong two-factor code keeps the session; any other 401 means the session
// (or the sign-in step) has ended.
export const isInvalidMfaCode = (status, body) => status === 401 && body?.code === 'INVALID_MFA_CODE';

export function mfaErrorKind(error) {
  if (isInvalidMfaCode(error?.status, { code: error?.code })) return 'invalid_code';
  if (error?.status === 401) return 'expired';
  return 'other';
}
