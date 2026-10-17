import { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import { readStoredSession, mergeProfile, USER_KEY, USER_UPDATED_EVENT } from '../services/session.js';

const storedUser = () => readStoredSession(localStorage)?.user ?? null;

// Updates the stored user from GET /api/auth/me (name, role…) and tells every
// useAuth instance. Display only: the server checks the role on every request.
export function syncCurrentUser(me) {
  const { user, changed } = mergeProfile(storedUser(), me);
  if (!changed) return;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  window.dispatchEvent(new Event(USER_UPDATED_EVENT));
}

export const useAuth = () => {
  // Read synchronously: a refresh or bookmarked URL keeps a signed-in user on
  // that page instead of redirecting before the session has been read.
  const [user, setUser] = useState(storedUser);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const refresh = () => setUser(storedUser());
    window.addEventListener(USER_UPDATED_EVENT, refresh);
    window.addEventListener('storage', refresh); // sign-in / sign-out in another tab
    return () => {
      window.removeEventListener(USER_UPDATED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // Stores a completed session (login, MFA verification or MFA enrolment).
  const completeSession = (data) => {
    if (!data?.token || !data?.user) return false;
    setUser(data.user);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    window.dispatchEvent(new Event(USER_UPDATED_EVENT));
    return true;
  };

  // Returns { ok } for a full session, or { mfa: 'verify' | 'setup', mfaToken }
  // when the account still has to pass (or enrol in) two-factor authentication.
  const login = async (email, password) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.login(email, password);
      if (data.mfa_required) return { ok: false, mfa: 'verify', mfaToken: data.mfa_token };
      if (data.mfa_setup_required) return { ok: false, mfa: 'setup', mfaToken: data.mfa_token };
      return { ok: completeSession(data) };
    } catch (err) {
      setError(err.message);
      return { ok: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    api.clearToken();
    localStorage.removeItem(USER_KEY);
    window.dispatchEvent(new Event(USER_UPDATED_EVENT));
  };

  return { user, loading, error, login, logout, completeSession };
};
