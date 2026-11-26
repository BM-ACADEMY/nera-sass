import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';
import { FiCheck, FiCopy, FiKey } from 'react-icons/fi';
import { api } from '../../services/api.js';
import { C } from '../../constants/theme.js';
import { MethodTile, METHOD_META } from '../../components/auth/MfaBrandIcons.jsx';
import { EmailCodeArt } from '../../components/auth/Art.jsx';
import OtpInput from '../../components/auth/OtpInput.jsx';
import PasswordInput from '../../components/security/PasswordInput.jsx';
import { FormRow, Callout } from './SettingsKit.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import {
  CODE_CHANNELS, DEFAULT_RESEND_SECONDS, setupSteps, showsSteps, currentStep, firstCodeMethod,
  secondsLeft, shouldAutoSend, waitFromError, otherCodeMethods,
} from './twoStepFlow.js';

// Two-step verification in Settings: three methods (authenticator app, email
// code, WhatsApp code) as cards. Turning a method on or off and new recovery
// codes first confirm it is really the user: password, plus a current code
// when two-step verification is already on (the server refuses otherwise).
// Turning a method on shows three steps: confirm it's you, scan the QR code
// (or get a code), enter the code.
const METHODS = ['totp', 'email', 'whatsapp'];
const TEXT = {
  totp: 'A new code every 30 seconds in Google Authenticator, even offline.',
  email: 'A 6-digit code is emailed to you at each sign-in.',
  whatsapp: 'A 6-digit code is sent to your WhatsApp number at each sign-in.',
};
const CHANNEL_WORD = { email: 'email', whatsapp: 'WhatsApp' };
const INSTEAD = {
  totp: 'Use the authenticator app instead',
  email: 'Get a code by email instead',
  whatsapp: 'Get a code on WhatsApp instead',
  recovery: 'Use a recovery code instead',
};
const TITLES = {
  enable: { totp: 'Set up the authenticator app', email: 'Set up email codes', whatsapp: 'Set up WhatsApp codes' },
  disable: { totp: 'Turn off the authenticator app', email: 'Turn off email codes', whatsapp: 'Turn off WhatsApp codes' },
};
const INTRO = {
  enable: "For your safety, confirm it's you before adding a new sign-in method.",
  disable: "For your safety, confirm it's you before turning this sign-in method off.",
  recovery: "For your safety, confirm it's you. Your old recovery codes stop working once new ones are made.",
};

// Confirmation codes sent in this tab, per user and channel, so reopening the
// panel during the resend wait shows the code already sent instead of asking
// for another one: `${userId}:${channel}` -> { at, resend_after, sent_to }.
const lastSends = new Map();

const Badge = ({ tone, children }) => {
  const colors = { ok: [C.green, '#ecfdf3'], muted: [C.muted, '#f1f5f9'], info: [C.accent, '#eef4ff'], warn: ['#b45309', '#fffbeb'] }[tone];
  return <span style={{ fontSize: 10, fontWeight: 700, color: colors[0], background: colors[1], borderRadius: 999, padding: '2px 8px' }}>{children}</span>;
};

const LinkButton = ({ className, ...props }) => (
  <button type="button" {...props}
    className={cn('cursor-pointer text-[13px] font-medium text-primary hover:underline disabled:cursor-default disabled:text-slate-400 disabled:no-underline', className)} />
);

// 1 Confirm it's you -> 2 Scan the QR code / Get a code -> 3 Enter the code.
// On a phone only the current step keeps its label.
const Steps = ({ method, current }) => (
  <ol className="flex items-center gap-2" aria-label="Setup steps">
    {setupSteps(method).map((label, i) => {
      const n = i + 1;
      const done = n < current;
      const active = n === current;
      return (
        <li key={label} className={cn('flex min-w-0 items-center gap-2', n < 3 && 'flex-1')} aria-current={active ? 'step' : undefined}>
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

// The box a setup / confirm step sits in, scrolled into view when it opens
// (on a phone the cards stack above it).
const Panel = ({ method, title, step, onSubmit, children }) => {
  const ref = useRef(null);
  useEffect(() => { ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }); }, []);
  return (
    <form ref={ref} onSubmit={onSubmit} className="mt-4 flex flex-col gap-4 rounded-xl border border-border bg-white p-4 sm:p-5">
      <div className="flex items-center gap-3">
        {method ? <MethodTile method={method} size={36} /> : <span className="flex size-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><FiKey /></span>}
        <h3 className="text-[15px] font-bold text-slate-900">{title}</h3>
      </div>
      {step && <Steps method={method} current={step} />}
      {children}
    </form>
  );
};

const PanelActions = ({ busy, label, destructive, disabled, onCancel }) => (
  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
    <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
    <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={busy || disabled}>{busy && <Spinner />} {busy ? 'Checking…' : label}</Button>
  </div>
);

// Step 1: password, plus a current code when two-step is already on. An
// email / WhatsApp default code is sent as soon as the panel opens.
// onSubmit(proof, { phone }) does the change; errors stay in the panel.
const ConfirmIdentity = ({ me, flow, onSubmit, onCancel }) => {
  const usable = me?.mfa_methods || [];
  const hasMfa = Boolean(me?.mfa_enabled);
  const userKey = me?.id || me?.email || '';
  const remembered = (m) => lastSends.get(`${userKey}:${m}`) || null;
  const [method, setMethod] = useState(() => firstCodeMethod(me));
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(() => remembered(firstCodeMethod(me)));
  const [sending, setSending] = useState(() => shouldAutoSend({ hasMfa, method: firstCodeMethod(me), lastSent: remembered(firstCodeMethod(me)) }));
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
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
      .then((res) => ({ at: Date.now(), resend_after: res.resend_after || DEFAULT_RESEND_SECONDS, sent_to: res.sent_to }))
      .catch((err) => {
        const wait = waitFromError(err);
        if (wait == null) { lastSends.delete(key); throw err; }
        return { sent_to: before?.sent_to, at: Date.now() - (DEFAULT_RESEND_SECONDS - wait) * 1000, resend_after: DEFAULT_RESEND_SECONDS };
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
    if (flow.action === 'enable' && flow.method === 'whatsapp' && !phone.trim()) return setError('Enter your WhatsApp number');
    setBusy(true);
    setError('');
    try {
      const proof = !hasMfa ? { password }
        : method === 'recovery' ? { password, recovery_code: code.trim() } : { password, code_method: method, code };
      await onSubmit(proof, { phone });
      // That code is used up now; reopening the panel asks for a new one.
      const key = `${userKey}:${method}`;
      if (hasMfa && lastSends.has(key)) lastSends.set(key, { ...lastSends.get(key), used: true });
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

  const enable = flow.action === 'enable';
  return (
    <Panel method={flow.method} title={enable || flow.action === 'disable' ? TITLES[flow.action][flow.method] : 'Create new recovery codes'}
      step={showsSteps(flow.action) ? 1 : null} onSubmit={submit}>
      <div>
        <p className="text-[13px] text-slate-700">{INTRO[flow.action]}</p>
        <p className="mt-1 text-xs text-muted-foreground">This stops anyone who gets into your open account from changing how you sign in.</p>
      </div>
      {error && <Callout tone="error">{error}</Callout>}
      <FormRow label="Your password" htmlFor="twostep-password">
        <PasswordInput id="twostep-password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </FormRow>
      {hasMfa && (
        <div className="flex flex-col gap-2.5">
          <div className="text-[13px] font-semibold text-slate-700">{method === 'recovery' ? 'Recovery code' : 'Code from your current sign-in method'}</div>
          <p className="text-[13px] text-muted-foreground">{codeText}</p>
          {method === 'recovery'
            ? <Input autoComplete="off" placeholder="XXXXX-XXXXX" value={code} onChange={(e) => setCode(e.target.value)} className="h-10 font-mono" />
            : <div className="py-1"><OtpInput value={code} onChange={setCode} disabled={busy} autoFocus={false} /></div>}
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
      {enable && flow.method === 'whatsapp' && (
        <FormRow label="WhatsApp number for codes" htmlFor="twostep-phone" hint="With the country code. Next we send a code to it to check it is yours.">
          <Input id="twostep-phone" type="tel" autoComplete="tel" placeholder="+91 98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-10" />
        </FormRow>
      )}
      <PanelActions busy={busy} onCancel={onCancel} destructive={flow.action === 'disable'}
        label={enable ? 'Continue' : flow.action === 'disable' ? 'Turn off' : 'Create new codes'} />
    </Panel>
  );
};

// Steps 2 and 3 of turning a method on: the app's QR code and key, or the
// code that was sent by email / WhatsApp; then the 6-digit code.
const FinishSetup = ({ me, flow, onDone, onBack, onCancel }) => {
  const isApp = flow.method === 'totp';
  const hasMfa = Boolean(me?.mfa_enabled);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(() => (flow.sent ? { ...flow.sent, at: Date.now() } : null));
  const [now, setNow] = useState(() => Date.now());
  const [resending, setResending] = useState(false);

  const wait = isApp ? 0 : secondsLeft(sent, now);
  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(t);
  }, [wait, now]);

  const confirm = async (value = code) => {
    if (busy) return;
    if (value.length !== 6) return setError('Enter the 6-digit code');
    setBusy(true);
    setError('');
    try {
      const reauth = { password: flow.password };
      const data = isApp ? await api.confirmMfaSetup(value, null, reauth)
        : flow.method === 'email' ? await api.confirmEmailSetup(value, null, reauth)
          : await api.confirmWhatsappSetup(value, null, reauth);
      onDone(data);
    } catch (err) {
      setCode('');
      setError(err.code === 'INVALID_MFA_CODE' ? 'That code is not valid. Try again.' : err.message || 'Could not turn it on');
    } finally {
      setBusy(false);
    }
  };

  // With two-step off the password alone starts the setup again (a new
  // code); with it on a fresh current code is needed, so go back to step 1.
  const resend = async () => {
    if (hasMfa) return onBack();
    setResending(true);
    setError('');
    try {
      const reauth = { password: flow.password };
      const res = flow.method === 'email' ? await api.startEmailSetup(null, reauth) : await api.startWhatsappSetup(flow.phone, null, reauth);
      setSent({ ...res, at: Date.now() });
      setNow(Date.now());
      toast.success(`Code sent to ${res.sent_to}`);
    } catch (err) {
      setError(err.message || 'The code could not be sent');
    } finally {
      setResending(false);
    }
  };

  const copyKey = () => navigator.clipboard?.writeText(flow.setup.secret)
    .then(() => toast.success('Key copied'))
    .catch(() => toast.error('Could not copy. Select the key and copy it.'));

  return (
    <Panel method={flow.method} title={TITLES.enable[flow.method]} step={currentStep({ step: 'finish', method: flow.method, codeLength: code.length })}
      onSubmit={(e) => { e.preventDefault(); confirm(); }}>
      {error && <Callout tone="error">{error}</Callout>}
      {isApp ? (
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="max-w-sm text-[13px] text-muted-foreground">
            Open Google Authenticator (or Microsoft Authenticator, Authy), tap <b className="text-slate-900">+</b>, choose “Scan a QR code” and scan this one.
          </p>
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"><QRCodeSVG value={flow.setup.otpauth_url} size={184} /></div>
          <div className="w-full max-w-sm text-left">
            <div className="mb-1 text-xs text-muted-foreground">Can’t scan? Enter this key in the app:</div>
            <div className="flex items-center gap-2 rounded-lg bg-slate-100 py-1.5 pr-1.5 pl-3">
              <code className="min-w-0 flex-1 font-mono text-xs break-all text-slate-800">{flow.setup.secret}</code>
              <Button type="button" variant="outline" size="sm" className="bg-white" onClick={copyKey}><FiCopy /> Copy</Button>
            </div>
          </div>
          <div className="flex w-full flex-col items-center gap-2 pt-1">
            <div className="text-[13px] font-semibold text-slate-700">Enter the 6-digit code the app shows</div>
            <OtpInput value={code} onChange={setCode} onComplete={confirm} disabled={busy} autoFocus={false} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 text-center">
          {flow.method === 'email' ? <EmailCodeArt className="h-24 w-auto" /> : <MethodTile method="whatsapp" size={64} />}
          <p className="max-w-sm text-[13px] text-muted-foreground">
            Enter the 6-digit code we sent to <b className="text-slate-900">{sent?.sent_to}</b>. At each sign-in you’ll get a new one.
          </p>
          <OtpInput value={code} onChange={setCode} onComplete={confirm} disabled={busy} />
          <LinkButton onClick={resend} disabled={busy || resending || (!hasMfa && wait > 0)}>
            {hasMfa ? 'Didn’t get it? Go back and send a new one' : wait > 0 ? `Send again in ${wait}s` : 'Didn’t get it? Send again'}
          </LinkButton>
        </div>
      )}
      <PanelActions busy={busy} onCancel={onCancel} label="Turn on" disabled={code.length !== 6} />
    </Panel>
  );
};

const RecoveryCodes = ({ codes, onClose }) => {
  const copy = () => navigator.clipboard?.writeText(codes.join('\n'))
    .then(() => toast.success('Recovery codes copied'))
    .catch(() => toast.error('Could not copy. Select the codes and copy them.'));
  return (
    <div className="flex flex-col gap-3">
      <Callout tone="ok">Save these recovery codes somewhere safe. Each one signs you in once if you lose access to your methods. They will not be shown again.</Callout>
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center font-mono text-sm select-all">
        {codes.map((c) => <span key={c}>{c}</span>)}
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={copy}><FiCopy /> Copy</Button>
        <Button type="button" onClick={onClose}>I have saved my recovery codes</Button>
      </div>
    </div>
  );
};

export const TwoStepMethods = ({ me, onChanged }) => {
  const usable = me?.mfa_methods || [];
  const enrolled = me?.mfa_methods_enrolled || usable;
  const defaultMethod = me?.mfa_default_method || null;
  const waAvailable = Boolean(me?.whatsapp_otp_available);
  // { step: 'confirm' | 'finish', action: 'enable' | 'disable' | 'recovery', method, ... }
  const [flow, setFlow] = useState(null);
  const [codes, setCodes] = useState(null);

  const done = (data) => {
    setFlow(null);
    if (data?.recovery_codes?.length) setCodes(data.recovery_codes);
    toast.success('Two-step verification updated');
    onChanged?.();
  };

  const runConfirmed = async (proof, { phone } = {}) => {
    const { action, method } = flow;
    if (action === 'disable') {
      await api.disableMfaMethod(method, proof);
      return done();
    }
    if (action === 'recovery') {
      const res = await api.regenerateRecoveryCodes(proof);
      setFlow(null);
      setCodes(res.recovery_codes);
      return onChanged?.();
    }
    if (method === 'totp') return setFlow({ ...flow, step: 'finish', password: proof.password, setup: await api.startMfaSetup(null, proof) });
    if (method === 'email') return setFlow({ ...flow, step: 'finish', password: proof.password, sent: await api.startEmailSetup(null, proof) });
    return setFlow({ ...flow, step: 'finish', password: proof.password, phone, sent: await api.startWhatsappSetup(phone, null, proof) });
  };

  const makeDefault = async (method) => {
    try {
      await api.setDefaultMfaMethod(method);
      toast.success(`${METHOD_META[method].title} is now your default`);
      onChanged?.();
    } catch (err) {
      toast.error(err.message || 'Could not change the default');
    }
  };

  if (codes) return <RecoveryCodes codes={codes} onClose={() => setCodes(null)} />;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {METHODS.map((method) => {
          const on = enrolled.includes(method);
          const unavailable = method === 'whatsapp' && !waAvailable;
          const isDefault = on && defaultMethod === method;
          const active = flow?.method === method && flow.action !== 'recovery';
          return (
            <div key={method} style={{ border: '1px solid ' + (active ? C.accent : on ? C.green + '55' : C.border), borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <MethodTile method={method} size={40} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{METHOD_META[method].title}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    {on ? <Badge tone="ok">On</Badge> : unavailable ? <Badge tone="warn">Not available yet</Badge> : <Badge tone="muted">Off</Badge>}
                    {isDefault && <Badge tone="info">Default</Badge>}
                  </div>
                </div>
              </div>
              <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>
                {TEXT[method]}
                {method === 'whatsapp' && on && me?.mfa_whatsapp_number ? ` Number: ${me.mfa_whatsapp_number}.` : ''}
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
                {on ? (
                  <>
                    <Button type="button" size="sm" variant="outline" className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700" disabled={Boolean(flow)}
                      onClick={() => setFlow({ step: 'confirm', action: 'disable', method })}>Turn off</Button>
                    {!isDefault && usable.includes(method) && <Button type="button" size="sm" variant="outline" disabled={Boolean(flow)} onClick={() => makeDefault(method)}>Make default</Button>}
                  </>
                ) : (
                  <Button type="button" size="sm" disabled={Boolean(flow) || unavailable} onClick={() => setFlow({ step: 'confirm', action: 'enable', method })}>Set up</Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {flow?.step === 'confirm' && <ConfirmIdentity key={`${flow.action}:${flow.method}`} me={me} flow={flow} onSubmit={runConfirmed} onCancel={() => setFlow(null)} />}
      {flow?.step === 'finish' && (
        <FinishSetup me={me} flow={flow} onDone={done} onCancel={() => setFlow(null)}
          onBack={() => setFlow({ step: 'confirm', action: 'enable', method: flow.method })} />
      )}

      {me?.mfa_enabled && !flow && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5">
          <span className="text-xs text-muted-foreground">Recovery codes left: {me?.recovery_codes_left || 0} of 10.</span>
          <Button type="button" size="sm" variant="outline" onClick={() => setFlow({ step: 'confirm', action: 'recovery' })}>Create new recovery codes</Button>
        </div>
      )}
    </div>
  );
};
