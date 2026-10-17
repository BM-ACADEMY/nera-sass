// Which API errors mean the stored admin session is unusable.
//
// 401: the session itself is invalid (no/invalid token, revoked, deactivated,
// MFA required). 403 normally means "signed in, but not allowed to do this"
// and must not sign the user out; only the two 403 codes that say this
// account cannot use the admin panel at all end the session.
const SESSION_ENDING_403_CODES = new Set(['STAFF_ONLY', 'NO_WORKSPACE']);

export function shouldEndSession(status, body) {
  if (status === 401) return true;
  return status === 403 && SESSION_ENDING_403_CODES.has(body?.code);
}
