import { useEffect, useState } from 'react';
import { Lock, Eye, EyeOff, Loader2, LogOut } from 'lucide-react';
import leadosLogo from '../../assets/getnera-logo.png';
import { api } from '../../services/api.js';
import { passwordProblem } from '../settings/teamPolicy.js';

const inputClass = 'h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-10 text-[15px] text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10';

/**
 * Shown instead of the app while the account is on a temporary password that
 * an Owner or Admin set (Settings > Team). The server refuses every other
 * request until the password is changed (PASSWORD_CHANGE_REQUIRED).
 */
export function ChangePasswordRequired({ user, onSignOut }) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { document.title = 'Choose your password · Getnera'; }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!current) return setError('Enter the temporary password you were given');
    const problem = passwordProblem(password, user?.email);
    if (problem) return setError(problem);
    if (password === current) return setError('Choose a password that is different from the temporary one');
    if (password !== confirm) return setError('The two passwords do not match');
    setBusy(true);
    try {
      // Stores the fresh token and clears the flag, which opens the app.
      await api.changePassword(current, password);
    } catch (err) {
      setError(err.message || 'Your password could not be saved. Please try again.');
      setBusy(false);
    }
  };

  const field = (label, value, setValue, autoComplete, extra) => (
    <label className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold text-slate-700">{label}</span>
      <span className="relative">
        <Lock size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-400" />
        <input type={show ? 'text' : 'password'} className={inputClass} value={value} onChange={(e) => setValue(e.target.value)} autoComplete={autoComplete} />
        {extra}
      </span>
    </label>
  );

  return (
    <div className="flex min-h-svh items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <img src={leadosLogo} alt="Getnera" className="mb-6 h-8 w-auto" />
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Choose your own password</h1>
            <p className="mt-1 text-sm text-slate-500">
              You signed in with a temporary password{user?.email ? ` for ${user.email}` : ''}. Choose a new one to continue.
            </p>
          </div>
          {field('Temporary password', current, setCurrent, 'current-password', (
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide passwords' : 'Show passwords'} className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer text-slate-400 hover:text-slate-700">
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          ))}
          {field('New password', password, setPassword, 'new-password')}
          <span className="-mt-2 text-xs text-slate-500">At least 10 characters, with a letter and a number.</span>
          {field('Confirm new password', confirm, setConfirm, 'new-password')}
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          <button type="submit" disabled={busy} className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-blue-600 text-[15px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
            {busy && <Loader2 size={16} className="animate-spin" />} Save and continue
          </button>
          <button type="button" onClick={onSignOut} className="flex cursor-pointer items-center justify-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
            <LogOut size={14} /> Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
