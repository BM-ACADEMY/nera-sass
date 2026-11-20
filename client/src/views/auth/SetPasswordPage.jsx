import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Lock, Eye, EyeOff, User, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import leadosLogo from '../../assets/getnera-logo.png';
import { api } from '../../services/api.js';

// The same rules the server checks (server/utils/passwordPolicy.js).
const passwordProblem = (password, email = '') => {
  if (!password) return 'Choose a password';
  if (password.length < 10) return 'Use at least 10 characters';
  if (password.length > 128) return 'Use at most 128 characters';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Use at least one letter and one number';
  if (email && password.toLowerCase() === email.toLowerCase()) return 'Your password cannot be your email address';
  return null;
};

const inputClass = 'h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-10 text-[15px] text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10';

const post = (endpoint, body) => api.request(endpoint, { method: 'POST', body: JSON.stringify(body) });

/**
 * Public page for one-time links:
 *   /reset-password/:token  set or reset the password of an existing login
 *                           ("Forgot password" email, or the WhatsApp message
 *                           staff send when a workspace is ready);
 *   /invite/:token          accept an invitation and choose a password.
 * The link works once; an expired or used link shows what to do next.
 */
export function SetPasswordPage({ mode = 'reset' }) {
  const { token } = useParams();
  const navigate = useNavigate();
  const invite = mode === 'invite';
  const [invitation, setInvitation] = useState(null);
  const [linkError, setLinkError] = useState('');
  const [loading, setLoading] = useState(invite);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => { document.title = invite ? 'Join your workspace · Getnera' : 'Set your password · Getnera'; }, [invite]);

  useEffect(() => {
    if (!invite) return;
    api.request(`/api/auth/invitations/${encodeURIComponent(token)}`)
      .then((data) => { setInvitation(data.invitation); setName(data.invitation?.name || ''); })
      .catch((err) => setLinkError(err.message || 'This link is not valid'))
      .finally(() => setLoading(false));
  }, [invite, token]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (invite && !name.trim()) return setError('Enter your name');
    const problem = passwordProblem(password, invitation?.email);
    if (problem) return setError(problem);
    if (password !== confirm) return setError('The two passwords do not match');
    setBusy(true);
    try {
      if (invite) await post('/api/auth/invitations/accept', { token, name: name.trim(), password });
      else await post('/api/auth/password/reset', { token, password });
      setDone(true);
    } catch (err) {
      if (err.status === 410) setLinkError(err.message || 'This link has expired or was already used');
      else setError(err.message || 'Your password could not be saved. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  let content;
  if (loading) {
    content = <div className="flex justify-center py-10 text-slate-400"><Loader2 className="animate-spin" /></div>;
  } else if (linkError) {
    content = (
      <div className="text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-amber-50 text-amber-600"><AlertTriangle /></div>
        <h1 className="text-xl font-bold text-slate-900">This link cannot be used</h1>
        <p className="mt-2 text-sm text-slate-500">{linkError}. Links work once and expire. Ask the Getnera team for a new one, or use “Forgot password” on the sign-in page.</p>
        <Link to="/login" className="mt-6 inline-block text-sm font-semibold text-blue-600 hover:underline">Go to sign in</Link>
      </div>
    );
  } else if (done) {
    content = (
      <div className="text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-green-50 text-green-600"><CheckCircle2 /></div>
        <h1 className="text-xl font-bold text-slate-900">Your password is set</h1>
        <p className="mt-2 text-sm text-slate-500">Sign in with your email and the password you just chose.</p>
        <button type="button" onClick={() => navigate('/login', { replace: true })} className="mt-6 flex h-11 w-full cursor-pointer items-center justify-center rounded-xl bg-blue-600 text-[15px] font-semibold text-white hover:bg-blue-700">
          Sign in
        </button>
      </div>
    );
  } else {
    content = (
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{invite ? 'Join your workspace' : 'Set your password'}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {invite && invitation ? `${invitation.email}${invitation.workspace_name ? ` · ${invitation.workspace_name}` : ''}` : 'Choose a password for your Getnera login. This link works once.'}
          </p>
        </div>
        {invite && (
          <label className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold text-slate-700">Your name</span>
            <span className="relative">
              <User size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-400" />
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </span>
          </label>
        )}
        <label className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold text-slate-700">New password</span>
          <span className="relative">
            <Lock size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-400" />
            <input type={show ? 'text' : 'password'} className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus />
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer text-slate-400 hover:text-slate-700">
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
          <span className="text-xs text-slate-500">At least 10 characters, with a letter and a number.</span>
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold text-slate-700">Confirm password</span>
          <span className="relative">
            <Lock size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-400" />
            <input type={show ? 'text' : 'password'} className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </span>
        </label>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <button type="submit" disabled={busy} className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-blue-600 text-[15px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
          {busy && <Loader2 size={16} className="animate-spin" />} {invite ? 'Join and set password' : 'Save password'}
        </button>
      </form>
    );
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <img src={leadosLogo} alt="Getnera" className="mb-6 h-8 w-auto" />
        {content}
      </div>
    </div>
  );
}

export default SetPasswordPage;
