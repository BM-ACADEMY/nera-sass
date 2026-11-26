// Where the two-step setup pop-up was, so a reloaded page can reopen it. Only
// the position is kept: the signed-in user's id, the method and the step.
// Never a password, a code, the authenticator key or recovery codes: what a
// step shows is asked from the server again (POST /api/auth/mfa/setup/resume).
// Kept for this browser tab only (sessionStorage), and removed on cancel, on
// success and on sign-out.
export const WIZARD_KEY = 'getnera_2step_wizard';
const METHODS = ['totp', 'email', 'whatsapp'];
// 'codes': new recovery codes are on screen.
const STEPS = ['confirm', 'scan', 'phone', 'code', 'codes'];

const tabStorage = () => {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null; // storage turned off in the browser
  }
};

export function clearWizard(storage = tabStorage()) {
  try {
    storage?.removeItem(WIZARD_KEY);
  } catch {
    // nothing to clear
  }
}

const valid = ({ method, step }) => STEPS.includes(step) && (METHODS.includes(method) || (step === 'codes' && method == null));

export function saveWizard(userId, position, storage = tabStorage()) {
  if (!userId || !position || !valid(position)) return clearWizard(storage);
  try {
    // Only these three fields, whatever else the caller holds.
    storage?.setItem(WIZARD_KEY, JSON.stringify({ user: userId, method: position.method ?? null, step: position.step }));
  } catch {
    // the pop-up then does not come back after a reload
  }
}

// The saved position of this user, or null. Anything else found (another
// user's, unreadable, unknown) is removed.
export function readWizard(userId, storage = tabStorage()) {
  try {
    const raw = storage?.getItem(WIZARD_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (userId && saved?.user === userId && valid(saved)) return { method: saved.method ?? null, step: saved.step };
  } catch {
    // unreadable: removed below
  }
  clearWizard(storage);
  return null;
}
