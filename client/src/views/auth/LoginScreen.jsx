import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { message } from 'antd';
import { QRCodeSVG } from 'qrcode.react';
import { Mail, Lock, Eye, EyeOff, ShieldCheck, ChevronRight, ArrowLeft, KeyRound, Copy, Download, Info, Loader2 } from 'lucide-react';
import leadosLogo from '../../assets/getnera-logo.png';
import { api } from '../../services/api.js';
import { mfaErrorKind, NOTICES } from '../../services/session.js';
import OtpInput from '../../components/auth/OtpInput.jsx';
import { AuthenticatorArt, EmailCodeArt, ShieldArt } from '../../components/auth/Art.jsx';
import { MethodTile } from '../../components/auth/MfaBrandIcons.jsx';
import { useSecondsUntil } from '../../hooks/useSecondsUntil.js';
import { codeDeadline, formatClock, sendsLeftText, sendsUsedUp } from '../../utils/otpTimer.js';

const YEAR = new Date().getFullYear();
const cn = (...parts) => parts.filter(Boolean).join(' ');

// Seconds until another email code may be requested.
const useCountdown = () => {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return undefined;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft];
};

const Spinner = () => <Loader2 size={16} className="animate-spin" />;

const PrimaryButton = ({ children, className, ...props }) => (
  <button
    {...props}
    className={cn('flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-blue-600 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50', className)}
  >
    {children}
  </button>
);

const LinkButton = ({ children, className, ...props }) => (
  <button type="button" {...props} className={cn('inline-flex cursor-pointer items-center gap-1.5 text-[13px] hover:underline disabled:cursor-default disabled:text-slate-400 disabled:no-underline', className)}>
    {children}
  </button>
);

const MethodCard = ({ icon: Icon, tone, tile, title, text, onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="group flex w-full cursor-pointer items-center gap-3.5 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md disabled:pointer-events-none disabled:opacity-60"
  >
    {tile ? <MethodTile method={tile} size={44} /> : <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', tone)}><Icon size={22} /></span>}
    <span className="min-w-0 flex-1">
      <span className="block font-semibold leading-snug text-slate-900">{title}</span>
      <span className="mt-0.5 block text-[13px] leading-snug text-slate-500">{text}</span>
    </span>
    <ChevronRight size={18} className="text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-blue-600" />
  </button>
);

// Time left on a WhatsApp code.
const CodeTimer = ({ left, sent }) => {
  if (!sent) return null;
  return (
    <p role="timer" className={cn('m-0 text-center text-[13px]', left ? 'text-slate-600' : 'font-semibold text-red-600')}>
      {left ? <>Code expires in <b className="tabular-nums">{formatClock(left)}</b></> : 'This code has expired.'}
    </p>
  );
};

const Field = ({ label, htmlFor, children }) => (
  <div className="flex flex-col gap-2">
    <label htmlFor={htmlFor} className="text-[13px] font-semibold text-slate-700">{label}</label>
    {children}
  </div>
);

const inputClass = 'h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-[15px] text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10';

// Customer sign-in: password, then the second step: the default method's
// code (app, email or WhatsApp), with a switch to any other method that is on,
// or a recovery code. Accounts that must use two-step verification set a
// method up here first.
export function LoginScreen({ login, completeSession, authLoading, initialNotice }) {
  const [values, setValues] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState(initialNotice || '');
  const [step, setStep] = useState('password'); // password | choose | verify | setup-choose | setup-email | setup-whatsapp-number | setup-whatsapp | setup-totp | codes
  const [busy, setBusy] = useState(false);
  const [mfaToken, setMfaToken] = useState('');
  const [methods, setMethods] = useState([]);
  const [method, setMethod] = useState('totp');
  const [emailHint, setEmailHint] = useState('');
  const [whatsappHint, setWhatsappHint] = useState('');
  const [whatsappAvailable, setWhatsappAvailable] = useState(false);
  // Email codes are offered at setup only when the server allows them (MFA_EXTRA_METHODS_ENABLED).
  const [emailSetupAvailable, setEmailSetupAvailable] = useState(false);
  const [phone, setPhone] = useState('');
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [pending, setPending] = useState(null);
  const [resendIn, setResendIn] = useCountdown();
  // WhatsApp codes: when the code on screen ends (0: none sent) and what is
  // left of today's sign-in codes.
  const [waDeadline, setWaDeadline] = useState(0);
  const [waStatus, setWaStatus] = useState(null);
  const [waSetupDeadline, setWaSetupDeadline] = useState(0);
  const waLeft = useSecondsUntil(waDeadline);
  const waSetupLeft = useSecondsUntil(waSetupDeadline);

  const showWaStatus = (status) => {
    if (!status) return;
    setWaStatus(status);
    setWaDeadline(codeDeadline(status));
  };

  useEffect(() => { document.title = 'Sign in · Getnera'; }, []);

  const restart = (text = '') => {
    setStep('password');
    setMfaToken('');
    setSetup(null);
    setCode('');
    setUseRecovery(false);
    setMethods([]);
    setWaDeadline(0);
    setWaStatus(null);
    setWaSetupDeadline(0);
    setNotice(text);
  };

  const finish = (data) => {
    if (!completeSession(data)) message.error('Sign-in could not be completed. Please try again.');
  };

  const onError = (err, fallback) => {
    const kind = mfaErrorKind(err);
    if (kind === 'expired') return restart(NOTICES.signInStepExpired);
    if (kind === 'invalid_code') {
      setInvalid(true);
      setCode('');
      setTimeout(() => setInvalid(false), 400);
      return message.error('That code is not valid. Try again.');
    }
    return message.error(err?.message || fallback);
  };

  // Sends a code by email or WhatsApp, for the login step or for setup.
  const sendCode = async (channel, purpose = 'login', token = mfaToken) => {
    setBusy(true);
    try {
      const res = channel === 'whatsapp'
        ? (purpose === 'setup' ? await api.startWhatsappSetup(phone, token) : await api.sendMfaWhatsapp(token))
        : (purpose === 'setup' ? await api.startEmailSetup(token) : await api.sendMfaEmail(token));
      if (channel === 'whatsapp') setWhatsappHint(res.sent_to || whatsappHint);
      else setEmailHint(res.sent_to || emailHint);
      if (channel === 'whatsapp') {
        if (purpose === 'setup') setWaSetupDeadline(codeDeadline(res));
        else showWaStatus(res.whatsapp_status);
      }
      setResendIn(res.resend_after || 45);
      message.success(`Code sent to ${res.sent_to}`);
      return true;
    } catch (err) {
      const status = err?.response?.data?.whatsapp_status;
      showWaStatus(status);
      // The code that failed to go out replaced the one before it.
      if (err?.code === 'WHATSAPP_SEND_FAILED') setWaDeadline(0);
      // Today's codes are used up: the code screen explains what else works.
      if (err?.code === 'WHATSAPP_DAILY_LIMIT') { message.warning(err.message); return true; }
      if (err?.code === 'OTP_RESEND_WAIT') { message.info(err.message); return true; }
      onError(err, 'The code could not be sent');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setNotice('');
    const result = await login(values.email.trim(), values.password);
    if (result.ok) return;
    if (!result.mfa) {
      message.error(result.error || 'Invalid email or password');
      return;
    }
    const info = result.mfaInfo || {};
    setMfaToken(result.mfaToken);
    setEmailHint(info.email_hint || '');
    setWhatsappHint(info.whatsapp_hint || '');
    setWhatsappAvailable(Boolean(info.whatsapp_available));
    setEmailSetupAvailable(info.email_setup_available === true);
    setCode('');
    setWaStatus(info.whatsapp_status || null);
    setWaDeadline(codeDeadline(info.whatsapp_status));
    if (result.mfa === 'setup') {
      setStep('setup-choose');
      return;
    }
    const list = info.methods || [];
    setMethods(list);
    setStep('verify');
    // Only a recovery code works (for example WhatsApp codes are switched off).
    if (info.recovery_only || !list.length) {
      setUseRecovery(true);
      return;
    }
    const first = list.includes(info.default_method) ? info.default_method : list[0];
    setMethod(first);
    const delivery = first === 'email' ? [info.email, info.email_error] : first === 'whatsapp' ? [info.whatsapp, info.whatsapp_error] : [];
    if (delivery[0]) setResendIn(delivery[0].resend_after || 45);
    if (delivery[1]) message.error(delivery[1]);
  };

  const chooseMethod = async (picked) => {
    setMethod(picked);
    setCode('');
    setUseRecovery(false);
    // A WhatsApp code that is still valid is not sent again (3 a day).
    const stillValid = picked === 'whatsapp' && waDeadline > Date.now();
    if ((picked === 'email' || picked === 'whatsapp') && !stillValid && !(await sendCode(picked, 'login'))) return;
    setStep('verify');
  };

  const verify = async (value = code) => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await api.verifyMfa(mfaToken, useRecovery ? { recoveryCode: value.trim() } : { code: value.replace(/\s/g, ''), method });
      finish(data);
    } catch (err) {
      onError(err, 'Verification failed');
    } finally {
      setBusy(false);
    }
  };

  const startSetup = async (picked) => {
    setCode('');
    if (picked === 'email') {
      if (await sendCode('email', 'setup')) setStep('setup-email');
      return;
    }
    if (picked === 'whatsapp') {
      setStep('setup-whatsapp-number');
      return;
    }
    setBusy(true);
    try {
      setSetup(await api.startMfaSetup(mfaToken));
      setStep('setup-totp');
    } catch (err) {
      onError(err, 'Could not start the setup');
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async (value = code) => {
    if (busy) return;
    setBusy(true);
    try {
      const clean = value.replace(/\s/g, '');
      const data = step === 'setup-email' ? await api.confirmEmailSetup(clean, mfaToken)
        : step === 'setup-whatsapp' ? await api.confirmWhatsappSetup(clean, mfaToken)
          : await api.confirmMfaSetup(clean, mfaToken);
      if (data.recovery_codes?.length) {
        setRecoveryCodes(data.recovery_codes);
        setPending(data);
        setStep('codes');
      } else {
        finish(data);
      }
    } catch (err) {
      onError(err, 'Verification failed');
    } finally {
      setBusy(false);
    }
  };

  const copy = (text, label) => navigator.clipboard?.writeText(text).then(() => message.success(`${label} copied`)).catch(() => {});
  const download = () => {
    const blob = new Blob([`Getnera recovery codes (${values.email})\nEach code works once.\n\n${recoveryCodes.join('\n')}\n`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'getnera-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const art = {
    choose: <ShieldArt className="h-24 w-auto" />,
    verify: useRecovery ? <ShieldArt className="h-24 w-auto" /> : method === 'email' ? <EmailCodeArt className="h-24 w-auto" /> : method === 'whatsapp' ? <MethodTile method="whatsapp" size={72} /> : <AuthenticatorArt className="h-24 w-auto" />,
    'setup-choose': <ShieldArt className="h-24 w-auto" />,
    'setup-email': <EmailCodeArt className="h-24 w-auto" />,
    'setup-whatsapp-number': <MethodTile method="whatsapp" size={72} />,
    'setup-whatsapp': <MethodTile method="whatsapp" size={72} />,
    codes: <ShieldArt className="h-24 w-auto" />,
  }[step];

  const heading = {
    password: ['Welcome back', 'Sign in to your Getnera workspace.'],
    choose: ['Verify it’s you', 'Choose how you want to get your sign-in code.'],
    verify: useRecovery
      ? ['Use a recovery code', 'Enter one of the recovery codes you saved when you set up two-step verification.']
      : method === 'email'
        ? ['Check your email', `We sent a 6-digit code to ${emailHint || 'your email'}.`]
        : method === 'whatsapp'
          ? ['Check WhatsApp', waDeadline ? `We sent a 6-digit code to your WhatsApp ${whatsappHint || 'number'}.` : 'Ask for a code, or use another method.']
          : ['Authenticator code', 'Open Google Authenticator (or your authenticator app) and enter the 6-digit code for Getnera.'],
    'setup-choose': ['Protect your account', 'Your account needs two-step verification. Pick a method to finish signing in.'],
    'setup-email': ['Check your email', `Enter the 6-digit code we sent to ${emailHint || 'your email'} to turn on email verification.`],
    'setup-whatsapp-number': ['Your WhatsApp number', 'We send a 6-digit code to it to check it is yours.'],
    'setup-whatsapp': ['Check WhatsApp', `Enter the 6-digit code we sent to ${whatsappHint || 'your WhatsApp'} to turn on WhatsApp verification.`],
    'setup-totp': ['Set up the authenticator app', 'Scan the QR code with Google Authenticator, Microsoft Authenticator or Authy.'],
    codes: ['Save your recovery codes', 'If you lose your phone or email access, each code lets you sign in once.'],
  }[step];

  const back = <LinkButton onClick={() => restart()} className="text-slate-500"><ArrowLeft size={14} /> Back to sign in</LinkButton>;
  const waVerify = step === 'verify' && method === 'whatsapp' && !useRecovery;
  const waUsedUp = sendsUsedUp(waStatus);
  const resend = (channel, purpose) => (
    <LinkButton disabled={resendIn > 0 || busy || (channel === 'whatsapp' && purpose === 'login' && waUsedUp)} onClick={() => sendCode(channel, purpose)} className="text-blue-600">
      {resendIn > 0 && !(channel === 'whatsapp' && purpose === 'login' && waUsedUp) ? `Resend code in ${resendIn}s` : 'Didn’t get it? Resend code'}
    </LinkButton>
  );

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#f5f8fc] px-4 py-6" style={{ fontFamily: "'Inter', system-ui, sans-serif", colorScheme: 'light' }}>
      {/* Form */}
      <main className="flex w-full flex-col items-center">
        <div className="mb-5 flex items-center gap-2.5">
          <img src={leadosLogo} alt="" className="h-9 w-9 rounded-lg object-cover" />
          <span className="text-lg font-extrabold text-slate-900">Getnera</span>
        </div>

        <div className="w-full max-w-[420px] rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-8">
          {art && <div className="mb-2 flex justify-center">{art}</div>}
          {step === 'password' && (
            <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><ShieldCheck size={22} /></span>
          )}
          <h1 className={cn('m-0 font-sans text-2xl font-extrabold tracking-tight text-slate-900', art && 'text-center')}>{heading[0]}</h1>
          <p className={cn('mt-1.5 text-sm text-slate-500', art && 'text-center')}>{heading[1]}</p>

          {notice && (
            <div className="mt-5 flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-[13px] text-blue-800">
              <Info size={16} className="mt-0.5 shrink-0" /> {notice}
            </div>
          )}

          <div className="mt-6">
            {step === 'password' && (
              <form onSubmit={onSubmit} className="flex flex-col gap-5">
                <Field label="Email" htmlFor="email">
                  <div className="relative">
                    <Mail size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input id="email" type="email" autoComplete="email" required placeholder="you@company.com" value={values.email} onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))} className={inputClass} />
                  </div>
                </Field>
                <Field label="Password" htmlFor="password">
                  <div className="relative">
                    <Lock size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required placeholder="Enter your password" value={values.password} onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))} className={cn(inputClass, 'pr-11')} />
                    <button type="button" tabIndex={-1} onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'} title={showPassword ? 'Hide password' : 'Show password'} className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </Field>
                <PrimaryButton type="submit" disabled={authLoading} className="mt-2">
                  {authLoading ? <><Spinner /> Signing in…</> : 'Sign in'}
                </PrimaryButton>
              </form>
            )}

            {step === 'choose' && (
              <div className="flex flex-col gap-3">
                {methods.includes('totp') && <MethodCard tile="totp" title="Authenticator app" text="Use the code from Google Authenticator" onClick={() => chooseMethod('totp')} disabled={busy} />}
                {methods.includes('email') && <MethodCard tile="email" title="Email code" text={`Send a code to ${emailHint}`} onClick={() => chooseMethod('email')} disabled={busy} />}
                {methods.includes('whatsapp') && <MethodCard tile="whatsapp" title="WhatsApp code" text={`Send a code to ${whatsappHint || 'your WhatsApp'}`} onClick={() => chooseMethod('whatsapp')} disabled={busy} />}
                <div className="mt-2 flex justify-center">{back}</div>
              </div>
            )}

            {step === 'verify' && (
              <form onSubmit={(e) => { e.preventDefault(); verify(); }} className="flex flex-col gap-5">
                {useRecovery ? (
                  <input autoFocus placeholder="XXXXX-XXXXX" value={code} onChange={(e) => setCode(e.target.value)} className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 text-center font-mono text-lg tracking-widest outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10" />
                ) : (
                  <OtpInput value={code} onChange={setCode} onComplete={verify} invalid={invalid} disabled={busy} />
                )}
                {waVerify && (
                  <div className="flex flex-col gap-2">
                    <CodeTimer left={waLeft} sent={Boolean(waDeadline)} />
                    {!waUsedUp && sendsLeftText(waStatus) && <p className="m-0 text-center text-xs text-slate-500">{sendsLeftText(waStatus)}</p>}
                    {waUsedUp && (
                      <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-800">
                        <b>{sendsLeftText(waStatus)}</b>{' '}
                        {waLeft > 0 ? 'You can still enter the last code before it expires. ' : ''}
                        {methods.length > 1 ? 'Use another method or a recovery code.' : 'Use a recovery code.'}{' '}
                        New WhatsApp codes are available after midnight (India time). No recovery codes? Contact Getnera support.
                      </div>
                    )}
                  </div>
                )}
                <PrimaryButton type="submit" disabled={busy || (useRecovery ? !code.trim() : code.length !== 6)}>
                  {busy ? <><Spinner /> Checking…</> : 'Verify and sign in'}
                </PrimaryButton>
                <div className="flex flex-col items-center gap-2">
                  {(method === 'email' || method === 'whatsapp') && !useRecovery && resend(method, 'login')}
                  {methods.length > 1 && !useRecovery && (
                    <LinkButton onClick={() => { setStep('choose'); setCode(''); }} className="text-slate-600">
                      Use another method
                    </LinkButton>
                  )}
                  {methods.length > 0 && (
                    <LinkButton onClick={() => { setUseRecovery((v) => !v); setCode(''); }} className="text-slate-500">
                      <KeyRound size={14} /> {useRecovery ? 'Use a verification code instead' : 'Lost access? Use a recovery code'}
                    </LinkButton>
                  )}
                  {back}
                </div>
              </form>
            )}

            {step === 'setup-choose' && (
              <div className="flex flex-col gap-3">
                <MethodCard tile="totp" title="Authenticator app (recommended)" text="Google Authenticator, Microsoft Authenticator or Authy" onClick={() => startSetup('totp')} disabled={busy} />
                {emailSetupAvailable && <MethodCard tile="email" title="Email code" text={`Get a code at ${emailHint || 'your email'} each sign-in`} onClick={() => startSetup('email')} disabled={busy} />}
                {whatsappAvailable && <MethodCard tile="whatsapp" title="WhatsApp code" text="Get a code on WhatsApp each sign-in" onClick={() => startSetup('whatsapp')} disabled={busy} />}
                <p className="mt-1 text-center text-xs text-slate-400">You can change this later in Settings.</p>
                <div className="flex justify-center">{back}</div>
              </div>
            )}

            {step === 'setup-email' && (
              <form onSubmit={(e) => { e.preventDefault(); confirmSetup(); }} className="flex flex-col gap-5">
                <OtpInput value={code} onChange={setCode} onComplete={confirmSetup} invalid={invalid} disabled={busy} />
                <PrimaryButton type="submit" disabled={busy || code.length !== 6}>
                  {busy ? <><Spinner /> Checking…</> : 'Turn on and sign in'}
                </PrimaryButton>
                <div className="flex flex-col items-center gap-2">
                  {resend('email', 'setup')}
                  <LinkButton onClick={() => { setStep('setup-choose'); setCode(''); }} className="text-slate-600">Choose another method</LinkButton>
                </div>
              </form>
            )}

            {step === 'setup-whatsapp-number' && (
              <form onSubmit={async (e) => { e.preventDefault(); if (await sendCode('whatsapp', 'setup')) setStep('setup-whatsapp'); }} className="flex flex-col gap-5">
                <Field label="WhatsApp number (with country code)" htmlFor="wa-phone">
                  <input id="wa-phone" type="tel" autoComplete="tel" autoFocus placeholder="+91 98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} className={cn(inputClass, 'pl-3')} />
                </Field>
                <PrimaryButton type="submit" disabled={busy || phone.replace(/\D/g, '').length < 10}>
                  {busy ? <><Spinner /> Sending…</> : 'Send code'}
                </PrimaryButton>
                <div className="flex justify-center">
                  <LinkButton onClick={() => { setStep('setup-choose'); setCode(''); }} className="text-slate-600">Choose another method</LinkButton>
                </div>
              </form>
            )}

            {step === 'setup-whatsapp' && (
              <form onSubmit={(e) => { e.preventDefault(); confirmSetup(); }} className="flex flex-col gap-5">
                <OtpInput value={code} onChange={setCode} onComplete={confirmSetup} invalid={invalid} disabled={busy} />
                <CodeTimer left={waSetupLeft} sent={Boolean(waSetupDeadline)} />
                <PrimaryButton type="submit" disabled={busy || code.length !== 6}>
                  {busy ? <><Spinner /> Checking…</> : 'Turn on and sign in'}
                </PrimaryButton>
                <div className="flex flex-col items-center gap-2">
                  {resend('whatsapp', 'setup')}
                  <LinkButton onClick={() => { setStep('setup-whatsapp-number'); setCode(''); }} className="text-slate-600">Change the number</LinkButton>
                </div>
              </form>
            )}

            {step === 'setup-totp' && setup && (
              <form onSubmit={(e) => { e.preventDefault(); confirmSetup(); }} className="flex flex-col gap-5">
                <ol className="flex flex-col gap-2 text-[13px] text-slate-600">
                  {['Open the app and tap + (add an account).', 'Scan this QR code, or type the key below.', 'Enter the 6-digit code the app shows.'].map((t, i) => (
                    <li key={t} className="flex items-start gap-2.5">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[11px] font-bold text-blue-600">{i + 1}</span>{t}
                    </li>
                  ))}
                </ol>
                <div className="flex justify-center">
                  <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"><QRCodeSVG value={setup.otpauth_url} size={148} /></div>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2">
                  <code className="min-w-0 flex-1 truncate text-xs">{setup.secret}</code>
                  <button type="button" onClick={() => copy(setup.secret, 'Key')} aria-label="Copy key" className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-slate-500 hover:bg-white"><Copy size={14} /></button>
                </div>
                <OtpInput value={code} onChange={setCode} onComplete={confirmSetup} invalid={invalid} disabled={busy} autoFocus={false} />
                <PrimaryButton type="submit" disabled={busy || code.length !== 6}>
                  {busy ? <><Spinner /> Checking…</> : 'Turn on and sign in'}
                </PrimaryButton>
                <div className="flex justify-center">
                  <LinkButton onClick={() => { setStep('setup-choose'); setCode(''); }} className="text-slate-600">Choose another method</LinkButton>
                </div>
              </form>
            )}

            {step === 'codes' && (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 font-mono text-sm">
                  {recoveryCodes.map((c) => <span key={c} className="text-center">{c}</span>)}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => copy(recoveryCodes.join('\n'), 'Recovery codes')} className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm font-medium hover:bg-slate-50"><Copy size={15} /> Copy</button>
                  <button type="button" onClick={download} className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm font-medium hover:bg-slate-50"><Download size={15} /> Download</button>
                </div>
                <PrimaryButton type="button" onClick={() => finish(pending)}>I have saved them, continue</PrimaryButton>
              </div>
            )}
          </div>
        </div>

        <p className="mt-5 text-center text-xs text-slate-500">
          © {YEAR} Afra Ventures Private Limited · <Link to="/privacy-policy" className="hover:text-slate-600">Privacy</Link> · <Link to="/terms-and-conditions" className="hover:text-slate-600">Terms</Link>
        </p>
      </main>
    </div>
  );
}
