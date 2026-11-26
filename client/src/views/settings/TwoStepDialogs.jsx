import { useState } from 'react';
import toast from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';
import { FiCopy, FiChevronRight, FiClock } from 'react-icons/fi';
import { api } from '../../services/api.js';
import { MethodTile, METHOD_META } from '../../components/auth/MfaBrandIcons.jsx';
import OtpInput from '../../components/auth/OtpInput.jsx';
import PasswordInput from '../../components/security/PasswordInput.jsx';
import { FormRow, Callout } from './SettingsKit.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useSecondsUntil } from '../../hooks/useSecondsUntil.js';
import { formatClock } from '../../utils/otpTimer.js';
import { CODE_CHANNELS, confirmationProof, firstCodeMethod, needsConfirmation } from './twoStepPolicy.js';

// The contents of the two-step pop-ups (TwoStepMethods.jsx opens them):
// confirm it's you, pick a method, WhatsApp number, QR code, enter the code,
// confirm turning off.
const CHANNEL_WORD = { email: 'email', whatsapp: 'WhatsApp' };
const USE_INSTEAD = { totp: 'Authenticator app', email: 'Email code', whatsapp: 'WhatsApp code', recovery: 'Recovery code' };
const RESEND_SECONDS = 45;

const LinkButton = ({ className, ...props }) => (
  <button type="button" {...props}
    className={cn('cursor-pointer text-[13px] font-medium text-primary hover:underline disabled:cursor-default disabled:text-slate-400 disabled:no-underline', className)} />
);

const Header = ({ method, title, children }) => (
  <DialogHeader>
    <DialogTitle className="flex items-center gap-3 pr-6 text-base leading-snug">
      {method && <MethodTile method={method} size={32} />} {title}
    </DialogTitle>
    <DialogDescription className="text-[13px]">{children}</DialogDescription>
  </DialogHeader>
);

const Actions = ({ busy, label, destructive, disabled, onCancel, cancelLabel = 'Cancel' }) => (
  <DialogFooter>
    <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
    <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={busy || disabled}>
      {busy && <Spinner />} {busy ? 'Please wait…' : label}
    </Button>
  </DialogFooter>
);

const Form = ({ onSubmit, children }) => (
  <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="flex min-w-0 flex-col gap-4">{children}</form>
);

// Password, plus a current code when two-step verification is on.
// onSubmit(proof) does the work and throws to show an error here.
export const ConfirmIdentity = ({ me, title, intro, notice, warning, actionLabel, destructive, onSubmit, onCancel, busy, setBusy }) => {
  const hasMfa = Boolean(me?.mfa_enabled);
  const usable = me?.mfa_methods || [];
  const [method, setMethod] = useState(() => firstCodeMethod(me));
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [sending, setSending] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [error, setError] = useState('');
  const wait = useSecondsUntil(resendAt);

  const send = async () => {
    setSending(true);
    setError('');
    try {
      const res = await api.sendReauthCode(method);
      setSentTo(res.sent_to);
      setResendAt(Date.now() + (res.resend_after || RESEND_SECONDS) * 1000);
    } catch (err) {
      setError(err.message || 'The code could not be sent');
    } finally {
      setSending(false);
    }
  };

  const submit = async () => {
    if (!password) return setError('Enter your current password');
    if (hasMfa && !code.trim()) return setError(method === 'recovery' ? 'Enter one of your recovery codes' : 'Enter the 6-digit code');
    setBusy(true);
    setError('');
    try {
      await onSubmit(confirmationProof({ hasMfa, password, method, code }));
    } catch (err) {
      setError(err.message || 'Something went wrong');
      if (method !== 'recovery') setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Form onSubmit={submit}>
      <Header title={title}>{intro}</Header>
      {notice && <Callout tone="info">{notice}</Callout>}
      {warning && <Callout tone="warn">{warning}</Callout>}
      {error && <Callout tone="error">{error}</Callout>}
      <FormRow label="Your password" htmlFor="twostep-password">
        <PasswordInput id="twostep-password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </FormRow>
      {hasMfa && (
        <div className="flex flex-col gap-2.5">
          <div className="text-[13px] font-semibold text-slate-700">Current verification code</div>
          <div className="flex flex-wrap gap-1.5">
            {[...usable, 'recovery'].map((m) => (
              <button key={m} type="button" aria-pressed={method === m} disabled={busy}
                onClick={() => { setMethod(m); setCode(''); setSentTo(''); setResendAt(0); setError(''); }}
                className={cn('cursor-pointer rounded-md border px-2.5 py-1 text-xs font-semibold', method === m ? 'border-primary bg-primary/10 text-slate-900' : 'border-border text-slate-600')}>
                {USE_INSTEAD[m]}
              </button>
            ))}
          </div>
          {method === 'recovery'
            ? <Input autoComplete="off" aria-label="Recovery code" placeholder="XXXXX-XXXXX" value={code} onChange={(e) => setCode(e.target.value)} className="h-10 font-mono" />
            : <OtpInput value={code} onChange={setCode} disabled={busy} autoFocus={false} />}
          {CODE_CHANNELS.includes(method) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <LinkButton onClick={send} disabled={sending || busy || wait > 0}>
                {sending ? 'Sending…' : wait > 0 ? `Send again in ${wait}s` : sentTo ? 'Send again' : `Send me a code by ${CHANNEL_WORD[method]}`}
              </LinkButton>
              {sentTo && <span className="text-xs text-muted-foreground">Sent to {sentTo}</span>}
            </div>
          )}
        </div>
      )}
      <Actions busy={busy} label={actionLabel} destructive={destructive} onCancel={onCancel} />
    </Form>
  );
};

// The switch was turned on: pick the first method.
export const ChooseMethod = ({ choices, texts, onPick }) => (
  <div className="flex min-w-0 flex-col gap-3">
    <Header title="Turn on 2-step verification">Choose how you want to get your sign-in code.</Header>
    {choices.map((method) => (
      <button key={method} type="button" onClick={() => onPick(method)}
        className="flex w-full cursor-pointer items-center gap-3.5 rounded-xl border border-border p-3.5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5">
        <MethodTile method={method} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-slate-900">{METHOD_META[method].title}</span>
          <span className="block text-xs text-muted-foreground">{texts[method]}</span>
        </span>
        <FiChevronRight className="shrink-0 text-slate-400" />
      </button>
    ))}
  </div>
);

export const ConfirmOff = ({ method, title, text, onConfirm, onCancel, busy, setBusy }) => {
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Form onSubmit={submit}>
      <Header method={method} title={title}>{text}</Header>
      {error && <Callout tone="error">{error}</Callout>}
      <Actions busy={busy} label="Turn off" destructive onCancel={onCancel} />
    </Form>
  );
};

export const WhatsAppNumber = ({ onSubmit, onCancel, busy, setBusy }) => {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const submit = async () => {
    if (phone.replace(/\D/g, '').length < 10) return setError('Enter your WhatsApp number with the country code');
    setBusy(true);
    setError('');
    try {
      await onSubmit(phone);
    } catch (err) {
      setError(err.message || 'The code could not be sent');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Form onSubmit={submit}>
      <Header method="whatsapp" title="Your WhatsApp number">We send a 6-digit code to it to check it is yours.</Header>
      {error && <Callout tone="error">{error}</Callout>}
      <FormRow label="WhatsApp number" htmlFor="twostep-phone" hint="With the country code.">
        <Input id="twostep-phone" type="tel" autoComplete="tel" autoFocus placeholder="+91 98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-10" />
      </FormRow>
      <Actions busy={busy} label="Send code" onCancel={onCancel} />
    </Form>
  );
};

export const ScanQr = ({ setup, onNext, onCancel }) => {
  const copyKey = () => navigator.clipboard?.writeText(setup.secret)
    .then(() => toast.success('Key copied'))
    .catch(() => toast.error('Could not copy. Select the key and copy it.'));
  return (
    <Form onSubmit={onNext}>
      <Header method="totp" title="Scan the QR code">
        Open Google Authenticator (or Microsoft Authenticator, Authy), tap +, and scan this code.
      </Header>
      <div className="mx-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"><QRCodeSVG value={setup.otpauth_url} size={176} /></div>
      <div className="min-w-0">
        <div className="mb-1 text-xs text-muted-foreground">Can’t scan? Enter this key in the app:</div>
        <div className="flex items-center gap-2 rounded-lg bg-slate-100 py-1.5 pr-1.5 pl-3">
          <code className="min-w-0 flex-1 font-mono text-xs break-all text-slate-800">{setup.secret}</code>
          <Button type="button" variant="outline" size="sm" className="bg-white" onClick={copyKey}><FiCopy /> Copy</Button>
        </div>
      </div>
      <Actions label="Next" onCancel={onCancel} />
    </Form>
  );
};

// The 6-digit code that turns a method on. For email and WhatsApp: a countdown
// of the code's life and "send again". `info`: { sentTo, deadline, resendAt }.
// onConfirm(code) and onResend() throw to show an error here; both return
// false when the pop-up moved on to "confirm it's you".
export const EnterCode = ({ method, info, onConfirm, onResend, onBack, onCancel, busy, setBusy }) => {
  const isApp = method === 'totp';
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const left = useSecondsUntil(info?.deadline || 0);
  const wait = useSecondsUntil(info?.resendAt || 0);
  const expired = !isApp && Boolean(info?.deadline) && left === 0;

  const submit = async (value = code) => {
    if (busy || expired) return;
    if (value.length !== 6) return setError('Enter the 6-digit code');
    setBusy(true);
    setError('');
    try {
      await onConfirm(value);
    } catch (err) {
      setCode('');
      setError(err.code === 'INVALID_MFA_CODE' ? 'That code is not valid. Try again.' : err.message || 'Could not turn it on');
    } finally {
      setBusy(false);
    }
  };
  const resend = async () => {
    setSending(true);
    setError('');
    try {
      await onResend();
      setCode('');
    } catch (err) {
      if (!needsConfirmation(err)) setError(err.message || 'The code could not be sent');
    } finally {
      setSending(false);
    }
  };

  return (
    <Form onSubmit={() => submit()}>
      <Header method={method} title="Enter the code">
        {isApp ? 'Enter the 6-digit code your authenticator app shows for Getnera.'
          : info?.sentTo ? <>Enter the 6-digit code we sent to <b className="text-slate-900 [overflow-wrap:anywhere]">{info.sentTo}</b>.</>
            : `Enter the 6-digit code we sent by ${CHANNEL_WORD[method]} a moment ago.`}
      </Header>
      {error && <Callout tone="error">{error}</Callout>}
      <OtpInput value={code} onChange={setCode} onComplete={submit} disabled={busy || expired} />
      {!isApp && (
        <div className="flex flex-col items-center gap-2 text-center">
          {info?.deadline ? (
            <div role="timer" className={cn('flex items-center gap-1.5 text-[13px]', expired ? 'font-semibold text-red-600' : 'text-slate-600')}>
              <FiClock /> {expired ? 'This code has expired. Send a new one.' : <>Code expires in <b className="tabular-nums">{formatClock(left)}</b></>}
            </div>
          ) : null}
          <LinkButton onClick={resend} disabled={busy || sending || wait > 0}>
            {sending ? 'Sending…' : wait > 0 ? `Send again in ${wait}s` : 'Didn’t get it? Send again'}
          </LinkButton>
        </div>
      )}
      <Actions busy={busy} label="Turn on" disabled={code.length !== 6 || expired}
        onCancel={onBack || onCancel} cancelLabel={onBack ? 'Back' : 'Cancel'} />
    </Form>
  );
};
