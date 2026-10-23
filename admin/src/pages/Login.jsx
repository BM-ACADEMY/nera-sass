import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FiMail, FiShield, FiCopy, FiArrowLeft, FiSmartphone, FiChevronRight, FiKey, FiCheckCircle, FiDownload } from 'react-icons/fi';
import { MdOutlineSpaceDashboard } from 'react-icons/md';
import { useLocation, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import axiosClient from '../api/axiosClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import OtpInput from '@/components/security/OtpInput';
import PasswordInput from '@/components/security/PasswordInput';
import { AuthenticatorArt, EmailCodeArt, ShieldArt } from '@/components/security/Art';
import { cn } from '@/lib/utils';

const YEAR = new Date().getFullYear();

// Counts down the seconds until another email code may be requested.
const useCountdown = () => {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return undefined;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft];
};

const MethodCard = ({ icon: Icon, tone, title, text, onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="group flex w-full cursor-pointer items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md disabled:pointer-events-none disabled:opacity-60"
  >
    <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-xl', tone)}><Icon size={22} /></span>
    <span className="min-w-0 flex-1">
      <span className="block font-semibold text-slate-900">{title}</span>
      <span className="block text-[13px] text-slate-500">{text}</span>
    </span>
    <FiChevronRight className="text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
  </button>
);

// Sign-in: password, then the second step (pick a method when both are on,
// enter an email or authenticator code, or a recovery code). Admins without
// a method set one up here before the first session.
const Login = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [values, setValues] = useState({ email: location.state?.email || '', password: '' });
  const [step, setStep] = useState('password'); // password | choose | verify | setup-choose | setup-email | setup-totp | codes
  const [loading, setLoading] = useState(false);
  const [mfaToken, setMfaToken] = useState('');
  const [methods, setMethods] = useState([]);
  const [method, setMethod] = useState('totp');
  const [emailHint, setEmailHint] = useState('');
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [pending, setPending] = useState(null);
  const [resendIn, setResendIn] = useCountdown();

  useEffect(() => { document.title = 'Sign in · Getnera Admin'; }, []);

  const handleChange = (e) => setValues((v) => ({ ...v, [e.target.name]: e.target.value }));

  const finish = (data) => {
    if (!(data.user?.is_platform_staff || data.user?.staff_role)) {
      toast.error('Access restricted to platform staff. Customer accounts sign in at app.getnera.in.');
      restart();
      return;
    }
    localStorage.setItem('adminToken', data.token);
    navigate('/dashboard');
  };

  function restart() {
    setStep('password');
    setMfaToken('');
    setSetup(null);
    setCode('');
    setUseRecovery(false);
    setMethods([]);
  }

  const expired = (err) => err.response?.status === 401 && err.response?.data?.code !== 'INVALID_MFA_CODE';
  const onError = (err, fallback) => {
    if (expired(err)) {
      toast.error('This sign-in expired. Enter your password again.');
      restart();
      return;
    }
    if (err.response?.data?.code === 'INVALID_MFA_CODE') {
      setInvalid(true);
      setCode('');
      setTimeout(() => setInvalid(false), 400);
    }
    toast.error(err.response?.data?.error || fallback);
  };

  const sendEmailCode = async (token = mfaToken, purpose = 'login') => {
    setLoading(true);
    try {
      const res = purpose === 'setup'
        ? await axiosClient.post('/auth/mfa/email/setup', { mfa_token: token })
        : await axiosClient.post('/auth/mfa/email/send', { mfa_token: token });
      setEmailHint(res.data.sent_to || emailHint);
      setResendIn(res.data.resend_after || 45);
      toast.success(`Code sent to ${res.data.sent_to}`);
      return true;
    } catch (err) {
      if (err.response?.data?.code === 'OTP_RESEND_WAIT') {
        toast.info(err.response.data.error);
        return true;
      }
      onError(err, 'The code could not be sent');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await axiosClient.post('/auth/login', values);
      const data = res.data;
      if (data.token) {
        finish(data);
      } else if (data.mfa_required) {
        setMfaToken(data.mfa_token);
        setMethods(data.methods || ['totp']);
        setEmailHint(data.email_hint || '');
        setCode('');
        if ((data.methods || []).length > 1) {
          setStep('choose');
        } else {
          const only = (data.methods || ['totp'])[0];
          setMethod(only);
          setStep('verify');
          if (only === 'email') {
            if (data.email) setResendIn(data.email.resend_after || 45);
            if (data.email_error) toast.error(data.email_error);
          }
        }
      } else if (data.mfa_setup_required) {
        setMfaToken(data.mfa_token);
        setEmailHint(data.email_hint || '');
        setStep('setup-choose');
      } else {
        toast.error('Authentication response missing session token');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  };

  const chooseMethod = async (picked) => {
    setMethod(picked);
    setCode('');
    setUseRecovery(false);
    if (picked === 'email' && !(await sendEmailCode())) return;
    setStep('verify');
  };

  const verify = async (value = code) => {
    if (loading) return;
    setLoading(true);
    try {
      const body = useRecovery
        ? { mfa_token: mfaToken, recovery_code: value.trim() }
        : { mfa_token: mfaToken, method, code: value.replace(/\s/g, '') };
      const res = await axiosClient.post('/auth/mfa/verify', body);
      finish(res.data);
    } catch (err) {
      onError(err, 'Invalid verification code');
    } finally {
      setLoading(false);
    }
  };

  const startSetup = async (picked) => {
    setCode('');
    if (picked === 'email') {
      if (await sendEmailCode(mfaToken, 'setup')) setStep('setup-email');
      return;
    }
    setLoading(true);
    try {
      const s = await axiosClient.post('/auth/mfa/setup', { mfa_token: mfaToken });
      setSetup(s.data);
      setStep('setup-totp');
    } catch (err) {
      onError(err, 'Could not start the setup');
    } finally {
      setLoading(false);
    }
  };

  const confirmSetup = async (value = code) => {
    if (loading) return;
    setLoading(true);
    try {
      const url = step === 'setup-email' ? '/auth/mfa/email/setup/confirm' : '/auth/mfa/setup/confirm';
      const res = await axiosClient.post(url, { mfa_token: mfaToken, code: value.replace(/\s/g, '') });
      if (res.data.recovery_codes?.length) {
        setRecoveryCodes(res.data.recovery_codes);
        setPending(res.data);
        setStep('codes');
      } else {
        finish(res.data);
      }
    } catch (err) {
      onError(err, 'Invalid verification code');
    } finally {
      setLoading(false);
    }
  };

  const copy = (text, label) => {
    navigator.clipboard?.writeText(text).then(() => toast.success(`${label} copied`)).catch(() => {});
  };
  const download = () => {
    const blob = new Blob([`Getnera Admin recovery codes (${values.email})\nEach code works once.\n\n${recoveryCodes.join('\n')}\n`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'getnera-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const art = {
    password: null,
    choose: <ShieldArt />,
    verify: useRecovery ? <ShieldArt /> : method === 'email' ? <EmailCodeArt /> : <AuthenticatorArt />,
    'setup-choose': <ShieldArt />,
    'setup-email': <EmailCodeArt />,
    'setup-totp': null,
    codes: <ShieldArt />,
  }[step];

  const heading = {
    password: ['Welcome back', 'Sign in to the Getnera admin panel.'],
    choose: ['Verify it’s you', 'Choose how you want to get your sign-in code.'],
    verify: useRecovery
      ? ['Use a recovery code', 'Enter one of the recovery codes you saved when you set up two-step verification.']
      : method === 'email'
        ? ['Check your email', `We sent a 6-digit code to ${emailHint || 'your email'}.`]
        : ['Authenticator code', 'Open Google Authenticator (or your authenticator app) and enter the 6-digit code for Getnera.'],
    'setup-choose': ['Protect your account', 'Admin accounts need two-step verification. Pick a method to finish signing in.'],
    'setup-email': ['Check your email', `Enter the 6-digit code we sent to ${emailHint || 'your email'} to turn on email verification.`],
    'setup-totp': ['Set up the authenticator app', 'Scan the QR code with Google Authenticator, Microsoft Authenticator or Authy.'],
    codes: ['Save your recovery codes', 'If you lose your phone or email access, each code lets you sign in once.'],
  }[step];

  const back = (
    <Button type="button" variant="ghost" size="sm" className="text-slate-500" onClick={restart}><FiArrowLeft /> Back to sign in</Button>
  );

  return (
    <div className="flex min-h-screen w-full bg-slate-50">
      {/* Brand panel (large screens) */}
      <aside className="relative hidden w-[44%] max-w-[620px] flex-col justify-between overflow-hidden bg-gradient-to-br from-[#0b1b4d] via-[#14307a] to-[#1d4ed8] p-10 text-white lg:flex">
        <div className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 size-96 rounded-full bg-sky-400/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-white text-[#1d4ed8] shadow-lg"><MdOutlineSpaceDashboard size={22} /></span>
          <div>
            <div className="text-lg font-extrabold tracking-tight">Getnera</div>
            <div className="text-xs text-blue-200">Admin panel</div>
          </div>
        </div>
        <div className="relative">
          <div className="mx-auto mb-8 w-fit rounded-3xl bg-white/95 p-6 shadow-2xl shadow-blue-950/40">
            <ShieldArt className="h-44 w-auto" />
          </div>
          <h2 className="text-3xl leading-tight font-extrabold">Run every workspace from one secure place.</h2>
          <p className="mt-3 max-w-md text-sm text-blue-100">Workspaces, WhatsApp numbers, customers and the platform inbox, protected by two-step verification.</p>
          <ul className="mt-6 flex flex-col gap-2.5 text-sm text-blue-50">
            {['Two-step sign-in by email or authenticator app', 'Every admin action recorded in the audit log', 'Live updates across the team'].map((t) => (
              <li key={t} className="flex items-center gap-2.5"><FiCheckCircle className="shrink-0 text-emerald-300" /> {t}</li>
            ))}
          </ul>
        </div>
        <div className="relative text-xs text-blue-200">© {YEAR} Afra Ventures Private Limited</div>
      </aside>

      {/* Form */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="mb-8 flex items-center gap-2.5 lg:hidden">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-white"><MdOutlineSpaceDashboard size={20} /></span>
          <span className="text-lg font-extrabold">Getnera <span className="font-medium text-slate-400">Admin</span></span>
        </div>

        <div className="w-full max-w-[430px] rounded-3xl border border-slate-200/80 bg-white p-7 shadow-xl shadow-slate-200/60 sm:p-9">
          {art && <div className="mb-4 flex justify-center">{art}</div>}
          {step === 'password' && (
            <span className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><FiShield size={22} /></span>
          )}
          <h1 className={cn('text-2xl font-extrabold tracking-tight text-slate-900', art && 'text-center')}>{heading[0]}</h1>
          <p className={cn('mt-1.5 text-sm text-slate-500', art && 'text-center')}>{heading[1]}</p>

          <div className="mt-7">
            {step === 'password' && (
              <form onSubmit={onSubmit} className="flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <FiMail className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
                    <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@company.com" value={values.email} onChange={handleChange} className="h-11 pl-9" />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="password">Password</Label>
                  <PasswordInput id="password" name="password" autoComplete="current-password" required placeholder="Enter your password" value={values.password} onChange={handleChange} className="h-11" />
                </div>
                <Button type="submit" size="lg" disabled={loading} className="mt-2 h-11 w-full font-semibold">
                  {loading ? <><Spinner /> Signing in…</> : 'Sign in'}
                </Button>
              </form>
            )}

            {step === 'choose' && (
              <div className="flex flex-col gap-3">
                <MethodCard icon={FiMail} tone="bg-blue-50 text-blue-600" title="Email code" text={`Send a code to ${emailHint}`} onClick={() => chooseMethod('email')} disabled={loading} />
                <MethodCard icon={FiSmartphone} tone="bg-emerald-50 text-emerald-600" title="Authenticator app" text="Use the code from Google Authenticator" onClick={() => chooseMethod('totp')} disabled={loading} />
                <div className="mt-2 flex justify-center">{back}</div>
              </div>
            )}

            {step === 'verify' && (
              <form onSubmit={(e) => { e.preventDefault(); verify(); }} className="flex flex-col gap-5">
                {useRecovery ? (
                  <Input autoFocus placeholder="XXXXX-XXXXX" value={code} onChange={(e) => setCode(e.target.value)} className="h-12 text-center font-mono text-lg tracking-widest" />
                ) : (
                  <OtpInput value={code} onChange={setCode} onComplete={verify} invalid={invalid} disabled={loading} />
                )}
                <Button type="submit" size="lg" disabled={loading || (useRecovery ? !code.trim() : code.length !== 6)} className="h-11 w-full font-semibold">
                  {loading ? <><Spinner /> Checking…</> : 'Verify and sign in'}
                </Button>
                <div className="flex flex-col items-center gap-2 text-[13px]">
                  {method === 'email' && !useRecovery && (
                    <button type="button" disabled={resendIn > 0 || loading} onClick={() => sendEmailCode()} className="cursor-pointer text-primary hover:underline disabled:cursor-default disabled:text-slate-400 disabled:no-underline">
                      {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Didn’t get it? Resend code'}
                    </button>
                  )}
                  {methods.length > 1 && !useRecovery && (
                    <button type="button" onClick={() => { setStep('choose'); setCode(''); }} className="cursor-pointer text-slate-600 hover:underline">
                      Use {method === 'email' ? 'the authenticator app' : 'an email code'} instead
                    </button>
                  )}
                  <button type="button" onClick={() => { setUseRecovery((v) => !v); setCode(''); }} className="inline-flex cursor-pointer items-center gap-1.5 text-slate-500 hover:underline">
                    <FiKey className="size-3.5" /> {useRecovery ? 'Use a verification code instead' : 'Lost access? Use a recovery code'}
                  </button>
                  {back}
                </div>
              </form>
            )}

            {step === 'setup-choose' && (
              <div className="flex flex-col gap-3">
                <MethodCard icon={FiMail} tone="bg-blue-50 text-blue-600" title="Email code" text={`Get a code at ${emailHint} each sign-in`} onClick={() => startSetup('email')} disabled={loading} />
                <MethodCard icon={FiSmartphone} tone="bg-emerald-50 text-emerald-600" title="Authenticator app (recommended)" text="Google Authenticator, Microsoft Authenticator or Authy" onClick={() => startSetup('totp')} disabled={loading} />
                <p className="mt-1 text-center text-xs text-slate-400">You can add the other method later in Settings → Two-step verification.</p>
                <div className="flex justify-center">{back}</div>
              </div>
            )}

            {step === 'setup-email' && (
              <form onSubmit={(e) => { e.preventDefault(); confirmSetup(); }} className="flex flex-col gap-5">
                <OtpInput value={code} onChange={setCode} onComplete={confirmSetup} invalid={invalid} disabled={loading} />
                <Button type="submit" size="lg" disabled={loading || code.length !== 6} className="h-11 w-full font-semibold">
                  {loading ? <><Spinner /> Checking…</> : 'Turn on and sign in'}
                </Button>
                <div className="flex flex-col items-center gap-2 text-[13px]">
                  <button type="button" disabled={resendIn > 0 || loading} onClick={() => sendEmailCode(mfaToken, 'setup')} className="cursor-pointer text-primary hover:underline disabled:cursor-default disabled:text-slate-400 disabled:no-underline">
                    {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Didn’t get it? Resend code'}
                  </button>
                  <button type="button" onClick={() => { setStep('setup-choose'); setCode(''); }} className="cursor-pointer text-slate-600 hover:underline">Choose another method</button>
                </div>
              </form>
            )}

            {step === 'setup-totp' && setup && (
              <form onSubmit={(e) => { e.preventDefault(); confirmSetup(); }} className="flex flex-col gap-5">
                <ol className="flex flex-col gap-2 text-[13px] text-slate-600">
                  {['Open the app and tap + (add an account).', 'Scan this QR code, or type the key below.', 'Enter the 6-digit code the app shows.'].map((t, i) => (
                    <li key={t} className="flex items-start gap-2.5">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{i + 1}</span>{t}
                    </li>
                  ))}
                </ol>
                <div className="flex justify-center">
                  <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"><QRCodeSVG value={setup.otpauth_url} size={168} /></div>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2">
                  <code className="min-w-0 flex-1 truncate text-xs">{setup.secret}</code>
                  <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => copy(setup.secret, 'Key')} aria-label="Copy key"><FiCopy /></Button>
                </div>
                <OtpInput value={code} onChange={setCode} onComplete={confirmSetup} invalid={invalid} disabled={loading} autoFocus={false} />
                <Button type="submit" size="lg" disabled={loading || code.length !== 6} className="h-11 w-full font-semibold">
                  {loading ? <><Spinner /> Checking…</> : 'Turn on and sign in'}
                </Button>
                <div className="flex justify-center">
                  <button type="button" onClick={() => { setStep('setup-choose'); setCode(''); }} className="cursor-pointer text-[13px] text-slate-600 hover:underline">Choose another method</button>
                </div>
              </form>
            )}

            {step === 'codes' && (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 font-mono text-sm">
                  {recoveryCodes.map((c) => <span key={c} className="text-center">{c}</span>)}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="outline" onClick={() => copy(recoveryCodes.join('\n'), 'Recovery codes')}><FiCopy /> Copy</Button>
                  <Button type="button" variant="outline" onClick={download}><FiDownload /> Download</Button>
                </div>
                <Button type="button" size="lg" className="h-11 w-full font-semibold" onClick={() => finish(pending)}>I have saved them, continue</Button>
              </div>
            )}
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-slate-400">
          Getnera Admin · © {YEAR} Afra Ventures Private Limited
        </p>
      </main>
    </div>
  );
};

export default Login;
