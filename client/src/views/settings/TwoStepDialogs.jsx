import { useEffect, useRef, useState } from 'react';
import { FiCheck, FiChevronRight, FiClock, FiKey } from 'react-icons/fi';
import { api } from '../../services/api.js';
import { MethodTile, METHOD_META } from '../../components/auth/MfaBrandIcons.jsx';
import OtpInput from '../../components/auth/OtpInput.jsx';
import PasswordInput from '../../components/security/PasswordInput.jsx';
import { FormRow, Callout } from './SettingsKit.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useSecondsUntil } from '../../hooks/useSecondsUntil.js';
import { codeDeadline, formatClock } from '../../utils/otpTimer.js';
import {
  CODE_CHANNELS, DEFAULT_RESEND_SECONDS, setupSteps, showsSteps, firstCodeMethod, secondsLeft, shouldAutoSend,
  waitFromError, otherCodeMethods, confirmationProof, TITLES,
} from './twoStepFlow.js';

// The pop-ups of Settings > Two-step verification (confirm it's you, pick a
// method, confirm turning off) and the pieces they share with the setup panel
// in TwoStepMethods.jsx (step indicator, buttons, countdown).
const CHANNEL_WORD = { email: 'email', whatsapp: 'WhatsApp' };
const INSTEAD = {
  totp: 'Use the authenticator app instead',
  email: 'Get a code by email instead',
  whatsapp: 'Get a code on WhatsApp instead',
  recovery: 'Use a recovery code instead',
};
const INTRO = {
  enable: "For your safety, confirm it's you before adding a new sign-in method.",
  disable: "For your safety, confirm it's you before turning this sign-in method off.",
  disableAll: "For your safety, confirm it's you before turning two-step verification off.",
  recovery: "For your safety, confirm it's you. Your old recovery codes stop working once new ones are made.",
};
const OFF_ALL_TEXT ='Every method and your recovery codes are removed. Your password alone will then sign you in.';

const titleOf = ({ kind, method }) => {
  if (kind === 'disableAll') return 'Turn off two-step verification';
  if (kind === 'recovery') return 'Create new recovery codes';
  return TITLES[kind][method];
};

// Confirmation codes sent in this tab, per user and channel, so reopening the
// pop-up during the resend wait shows the code already sent instead of asking
// for another one: `${userId}:${channel}` -> { at, resend_after, sent_to, deadline }.
const lastSends = new Map();

export const LinkButton = ({ className, ...props }) => (
  <button type="button" {...props}
    className={cn('cursor-pointer text-[13px] font-medium text-primary hover:underline disabled:cursor-default disabled:text-slate-400 disabled:no-underline', className)} />
);

// 1 Confirm it's you -> 2 Scan the QR code / Get a code -> 3 Enter the code.
// On a phone only the current step keeps its label.
export const Steps = ({ method, current }) => (
  <ol className="flex items-center gap-2" aria-label="Setup steps">
    {setupSteps(method).map((label, i) => {
      const n = i + 1;
      const done = n < current;
      const active = n === current;
      return (
        <li key={label} className={cn('flex items-center gap-2 sm:min-w-0', n < 3 && 'flex-1', active && 'max-sm:flex-none')} aria-current={active ? 'step' : undefined}>
          <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
            done ? 'bg-emerald-600 text-white' : active ? 'bg-primary text-primary-foreground ring-4 ring-primary/15' : 'bg-slate-100 text-slate-500')}>
            {done ? <FiCheck /> : n}
          </span>
          <span className={cn('truncate text-xs', active ? 'font-semibold text-slate-900' : 'hidden text-slate-500 sm:inline')}>{label}</span>
          {n < 3 && <span className="h-px min-w-3 flex-1 bg-slate-200" aria-hidden />}
        </li>
      );
    })}
  </ol>
);

export const PanelActions = ({ busy, label, destructive, disabled, onCancel, cancelLabel = 'Cancel', onBack }) => (
  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
    {onBack && <Button type="button" variant="ghost" onClick={onBack} disabled={busy} className="sm:mr-auto">Back</Button>}
    <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
    <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={busy || disabled}>{busy && <Spinner />} {busy ? 'Checking…' : label}</Button>
  </div>
);

// How long the code that was sent still works.
export const CodeCountdown = ({ deadline }) => {
  const left = useSecondsUntil(deadline || 0);
  if (!deadline) return null;
  return (
    <div role="timer" className={cn('flex items-center gap-1.5 text-[13px]', left ? 'text-slate-600' : 'font-semibold text-red-600')}>
      <FiClock className="shrink-0" /> {left ? <span>Code expires in <b className="tabular-nums">{formatClock(left)}</b></span> : 'This code has expired. Send a new one.'}
    </div>
  );
};

const PopupHeader = ({ method, icon, title }) => (
  <div className="flex items-center gap-3 pr-6">
    {method ? <MethodTile method={method} size={36} /> : <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">{icon || <FiKey />}</span>}
    <DialogTitle className="text-[15px] leading-snug font-bold text-slate-900">{title}</DialogTitle>
  </div>
);

// Password, plus a current code when two-step is already on. An email /
// WhatsApp default code is sent as soon as the pop-up opens.
// onSubmit(proof) does the check; errors stay in the pop-up.
export const ConfirmIdentity = ({ me, action, notice, onSubmit, onCancel, busy, setBusy }) => {
  const usable = me?.mfa_methods || [];
  const hasMfa = Boolean(me?.mfa_enabled);
  const userKey = me?.id || me?.email || '';
  const remembered = (m) => lastSends.get(`${userKey}:${m}`) || null;
  const [method, setMethod] = useState(() => firstCodeMethod(me));
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(() => remembered(firstCodeMethod(me)));
  const [sending, setSending] = useState(() => shouldAutoSend({ hasMfa, method: firstCodeMethod(me), lastSent: remembered(firstCodeMethod(me)) }));
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState('');
  const methodRef = useRef(method);
  const autoSent = useRef(false);

  // Same endpoint as "Send again"; a resend wait from the server counts as a
  // code already on its way.
  const deliver = (m) => {
    const key = `${userKey}:${m}`;
    const before = lastSends.get(key);
    lastSends.set(key, { sent_to: before?.sent_to, at: Date.now(), resend_after: DEFAULT_RESEND_SECONDS });
    api.sendReauthCode(m)
      .then((res) => ({ at: Date.now(), resend_after: res.resend_after || DEFAULT_RESEND_SECONDS, sent_to: res.sent_to, deadline: codeDeadline(res) }))
      .catch((err) => {
        const wait = waitFromError(err);
        if (wait == null) { lastSends.delete(key); throw err; }
        return { sent_to: before?.sent_to, deadline: before?.deadline, at: Date.now() - (DEFAULT_RESEND_SECONDS - wait) * 1000, resend_after: DEFAULT_RESEND_SECONDS };
      })
      .then((entry) => {
        lastSends.set(key, entry);
        if (methodRef.current !== m) return;
        setSent(entry);
        setNow(Date.now());
      })
      .catch((err) => { if (methodRef.current === m) setError(err.message || 'The code could not be sent'); })
      .finally(() => { if (methodRef.current === m) setSending(false); });
  };

  useEffect(() => {
    if (!sending || autoSent.current) return;
    autoSent.current = true;
    deliver(method);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const wait = secondsLeft(sent, now);
  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(t);
  }, [wait, now]);

  const sendNow = (m = method) => {
    setError('');
    setSending(true);
    deliver(m);
  };
  const choose = (m) => {
    const last = remembered(m);
    methodRef.current = m;
    setMethod(m);
    setCode('');
    setError('');
    setSent(last);
    setSending(false);
    // Picking email / WhatsApp asks for that code, unless one was just sent.
    if (CODE_CHANNELS.includes(m) && secondsLeft(last) === 0) sendNow(m);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!password) return setError('Enter your current password');
    if (hasMfa && !code.trim()) return setError(method === 'recovery' ? 'Enter one of your recovery codes' : 'Enter the 6-digit code');
    setBusy(true);
    setError('');
    try {
      await onSubmit(confirmationProof({ hasMfa, password, method, code }));
      // That code is used up now; reopening the pop-up asks for a new one.
      const key = `${userKey}:${method}`;
      if (hasMfa && lastSends.has(key)) lastSends.set(key, { ...lastSends.get(key), used: true, deadline: 0 });
    } catch (err) {
      setError(err.message || 'Something went wrong');
      if (method !== 'recovery') setCode('');
    } finally {
      setBusy(false);
    }
  };

  const word = CHANNEL_WORD[method];
  const codeText = method === 'totp' ? 'Open your authenticator app and enter the 6-digit code it shows.'
    : method === 'recovery' ? 'Enter one of the recovery codes you saved when you turned on two-step verification.'
      : sending ? `Sending a code to your ${word}…`
        : sent?.used ? `Get a new 6-digit code by ${word}.`
          : sent?.sent_to ? <>We sent a code to <b className="text-slate-900">{sent.sent_to}</b>.</>
            : sent ? `We sent a code to your ${word} a moment ago.`
              : `Get a 6-digit code by ${word}.`;

  const { kind } = action;
  const off = kind === 'disable' || kind === 'disableAll';
  return (
    <form onSubmit={submit} className="flex min-w-0 flex-col gap-4">
      <PopupHeader method={action.method} title={titleOf(action)} />
      {showsSteps(kind) && <Steps method={action.method} current={1} />}
      <DialogDescription asChild>
        <div>
          <p className="text-[13px] text-slate-700">{INTRO[kind]}</p>
          <p className="mt-1 text-xs text-muted-foreground">This stops anyone who gets into your open account from changing how you sign in.</p>
        </div>
      </DialogDescription>
      {notice && <Callout tone="info">{notice}</Callout>}
      {kind === 'disableAll' && <Callout tone="warn">{OFF_ALL_TEXT}</Callout>}
      {error && <Callout tone="error">{error}</Callout>}
      <FormRow label="Your password" htmlFor="twostep-password">
        <PasswordInput id="twostep-password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </FormRow>
      {hasMfa && (
        <div className="flex flex-col gap-2.5">
          <div className="text-[13px] font-semibold text-slate-700">{method === 'recovery' ? 'Recovery code' : 'Code from your current sign-in method'}</div>
          <p className="text-[13px] text-muted-foreground">{codeText}</p>
          {method === 'recovery'
            ? <Input autoComplete="off" aria-label="Recovery code" placeholder="XXXXX-XXXXX" value={code} onChange={(e) => setCode(e.target.value)} className="h-10 font-mono" />
            : <div className="py-1"><OtpInput value={code} onChange={setCode} disabled={busy} autoFocus={false} /></div>}
          {CODE_CHANNELS.includes(method) && !sending && <CodeCountdown deadline={sent?.deadline} />}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {CODE_CHANNELS.includes(method) && (
              <LinkButton onClick={() => sendNow()} disabled={sending || wait > 0 || busy}>
                {wait > 0 ? `Send again in ${wait}s` : sent && !sent.used ? 'Send again' : 'Send a code'}
              </LinkButton>
            )}
            {otherCodeMethods(usable, method).map((m) => (
              <LinkButton key={m} className="text-slate-500 hover:text-slate-700" onClick={() => choose(m)} disabled={busy}>{INSTEAD[m]}</LinkButton>
            ))}
          </div>
        </div>
      )}
      <PanelActions busy={busy} onCancel={onCancel} destructive={off}
        label={kind === 'enable' ? 'Continue' : off ? 'Turn off' : 'Create new codes'} />
    </form>
  );
};

// The switch was turned on: pick the first method.
export const ChooseMethod = ({ choices, texts, onPick }) => (
  <div className="flex min-w-0 flex-col gap-3">
    <PopupHeader icon={<FiKey />} title="Turn on two-step verification" />
    <DialogDescription className="text-[13px]">Choose how you want to get your sign-in code.</DialogDescription>
    {choices.map((method) => (
      <button key={method} type="button" onClick={() => onPick(method)}
        className="flex w-full cursor-pointer items-center gap-4 rounded-xl border border-border p-3.5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5">
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

// Already confirmed a moment ago: turning off only asks "are you sure".
export const ConfirmOff = ({ action, onConfirm, onCancel, busy, setBusy }) => {
  const [error, setError] = useState('');
  const all = action.kind === 'disableAll';
  const submit = async (event) => {
    event.preventDefault();
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
    <form onSubmit={submit} className="flex min-w-0 flex-col gap-4">
      <PopupHeader method={action.method} title={`${titleOf(action)}?`} />
      <DialogDescription className="text-[13px]">{all ? OFF_ALL_TEXT : 'You will no longer get sign-in codes this way.'}</DialogDescription>
      {error && <Callout tone="error">{error}</Callout>}
      <PanelActions busy={busy} onCancel={onCancel} destructive label="Turn off" />
    </form>
  );
};
