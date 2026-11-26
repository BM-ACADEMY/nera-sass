import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';
import { FiCopy, FiShield } from 'react-icons/fi';
import { api } from '../../services/api.js';
import { C } from '../../constants/theme.js';
import { MethodTile, METHOD_META } from '../../components/auth/MfaBrandIcons.jsx';
import { EmailCodeArt } from '../../components/auth/Art.jsx';
import OtpInput from '../../components/auth/OtpInput.jsx';
import { FormRow, Callout } from './SettingsKit.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useSecondsUntil } from '../../hooks/useSecondsUntil.js';
import { codeDeadline } from '../../utils/otpTimer.js';
import { ConfirmIdentity, ChooseMethod, ConfirmOff, Steps, PanelActions, CodeCountdown, LinkButton } from './TwoStepDialogs.jsx';
import {
  TITLES, DEFAULT_RESEND_SECONDS, currentStep, waitFromError, enrolledMethods, shownMethods, setupChoices, switchState,
  setupBlocker, removeBlocker, whatsappOnly, needsConfirmation, isConfirmed, holdOf,
} from './twoStepFlow.js';

// Two-step verification in Settings: a switch at the top and three methods
// (authenticator app, email code, WhatsApp code) as cards. Changes ask
// "confirm it's you" in a pop-up: the password only for adding a method; for
// turning one off, changing the default or new recovery codes also a current
// code while two-step is on. The server remembers the check for this session
// for a few minutes (a password-only one covers adding only), so it is asked
// once; the password is not kept in the browser. New recovery codes always ask
// again. A method added to an account that already had two-step on cannot
// confirm changes for 24 hours. Turning a method on shows three steps: confirm
// it's you (the pop-up), scan the QR code (or get a code), enter the code.
const TEXT = {
  totp: 'A new code every 30 seconds in Google Authenticator, even offline.',
  email: 'A 6-digit code is emailed to you at each sign-in.',
  whatsapp: 'An extra method: a code on WhatsApp, valid 10 minutes, up to 3 sign-in codes a day.',
};

const timeAfter = (seconds) => Date.now() + seconds * 1000;

// What the code step shows about the code just sent (null: one is on its way
// and `wait` seconds remain before another can be asked for).
const sentInfo = (res, wait = DEFAULT_RESEND_SECONDS) => (res
  ? { sentTo: res.sent_to, deadline: codeDeadline(res), resendAt: timeAfter(res.resend_after || DEFAULT_RESEND_SECONDS) }
  : { sentTo: '', deadline: 0, resendAt: timeAfter(wait) });

const Badge = ({ tone, children }) => {
  const colors = { ok: [C.green, '#ecfdf3'], muted: [C.muted, '#f1f5f9'], info: [C.accent, '#eef4ff'], warn: ['#b45309', '#fffbeb'] }[tone];
  return <span style={{ fontSize: 10, fontWeight: 700, color: colors[0], background: colors[1], borderRadius: 999, padding: '2px 8px' }}>{children}</span>;
};

const Switch = ({ on, disabled, onClick, label }) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick}
    className={cn('relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
      on ? 'bg-emerald-600' : 'bg-slate-300')}>
    <span className={cn('inline-block size-5 rounded-full bg-white shadow transition-transform', on ? 'translate-x-6' : 'translate-x-1')} />
  </button>
);

// The box a setup step sits in, scrolled into view when it opens (on a phone
// the cards stack above it).
const Panel = ({ method, onSubmit, step, children }) => {
  const ref = useRef(null);
  useEffect(() => { ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }); }, []);
  return (
    <form id="twostep-setup" ref={ref} onSubmit={onSubmit}className="flex flex-col gap-4 rounded-xl border border-border bg-white p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <MethodTile method={method} size={36} />
        <h3 className="text-[15px] font-bold text-slate-900">{TITLES.enable[method]}</h3>
      </div>
      <Steps method={method} current={currentStep(step)} />
      {children}
    </form>
  );
};

// Steps 2 and 3 of turning a method on. 2: the app's QR code and key, or the
// WhatsApp number to send a code to. 3: the 6-digit code, with how long a
// code sent by email / WhatsApp still works. The on* requests throw to show an
// error here.
const SetupPanel = ({ flow, onSendCode, onNext, onConfirm, onResend, onBack, onCancel }) => {
  const { method, step, info } = flow;
  const isApp = method === 'totp';
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState(flow.phone || '');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const left = useSecondsUntil(info?.deadline || 0);
  const wait = useSecondsUntil(info?.resendAt || 0);
  const expired = Boolean(info?.deadline) && left === 0;

  const run = async (work) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (err) {
      setCode('');
      setError(err.code === 'INVALID_MFA_CODE' ? 'That code is not valid. Try again.' : err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };
  const confirm = (value = code) => {
    if (busy || expired) return;
    if (value.length !== 6) return setError('Enter the 6-digit code');
    return run(() => onConfirm(value));
  };
  const sendToNumber = () => {
    if (phone.replace(/\D/g, '').length < 10) return setError('Enter your WhatsApp number with the country code');
    return run(() => onSendCode(phone));
  };
  const resend = async () => {
    setResending(true);
    setError('');
    try {
      await onResend();
      setCode('');
    } catch (err) {
      setError(err.message || 'The code could not be sent');
    } finally {
      setResending(false);
    }
  };
  const copyKey = () => navigator.clipboard?.writeText(flow.setup.secret)
    .then(() => toast.success('Key copied'))
    .catch(() => toast.error('Could not copy. Select the key and copy it.'));
  const submit = (event) => {
    event.preventDefault();
    if (step === 'scan') return onNext();
    if (step === 'phone') return sendToNumber();
    if (step === 'code') return confirm();
    return null;
  };

  return (
    <Panel method={method} step={step} onSubmit={submit}>
      {error && <Callout tone="error">{error}</Callout>}
      {step === 'starting' && <div className="flex justify-center py-6"><Spinner className="size-6" /></div>}
      {step === 'scan' && (
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
        </div>
      )}
      {step === 'phone' && (
        <FormRow label="WhatsApp number for codes" htmlFor="twostep-phone" hint="With the country code. Next we send a code to it to check it is yours.">
          <Input id="twostep-phone" type="tel" autoComplete="tel" autoFocus placeholder="+91 98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-10" />
        </FormRow>
      )}
      {step === 'code' && (
        <div className="flex flex-col items-center gap-4 text-center">
          {method === 'email' && <EmailCodeArt className="h-24 w-auto" />}
          {method === 'whatsapp' && <MethodTile method="whatsapp" size={64} />}
          {isApp ? <div className="text-[13px] font-semibold text-slate-700">Enter the 6-digit code the app shows</div> : (
            <p className="max-w-sm text-[13px] text-muted-foreground">
              {info?.sentTo
                ? <>Enter the 6-digit code we sent to <b className="text-slate-900 [overflow-wrap:anywhere]">{info.sentTo}</b>.</>
                : 'Enter the 6-digit code we sent a moment ago.'}
              {' '}At each sign-in you’ll get a new one.
            </p>
          )}
          <OtpInput value={code} onChange={setCode} onComplete={confirm} disabled={busy || expired} />
          {!isApp && (
            <>
              <CodeCountdown deadline={info?.deadline} />
              <LinkButton onClick={resend} disabled={busy || resending || wait > 0}>
                {resending ? 'Sending…' : wait > 0 ? `Send again in ${wait}s` : 'Didn’t get it? Send again'}
              </LinkButton>
            </>
          )}
        </div>
      )}
      {step !== 'starting' && (
        <PanelActions busy={busy} onCancel={onCancel} onBack={step === 'code' ? onBack : null}
          label={{ scan: 'Next', phone: 'Send code', code: 'Turn on' }[step]}
          disabled={step === 'code' && (code.length !== 6 || expired)} />
      )}
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
  const enrolled = enrolledMethods(me);
  const defaultMethod = me?.mfa_default_method || null;
  const waAvailable = Boolean(me?.whatsapp_otp_available);
  const state = switchState(me);
  // The open pop-up: { type: 'confirm' | 'choose' | 'off', action, notice }.
  // action: { kind: 'enable' | 'disable' | 'disableAll' | 'default' | 'recovery', method, phone, resume }.
  const [dialog, setDialog] = useState(null);
  // The setup panel: { method, step: 'starting' | 'scan' | 'phone' | 'code', setup, phone, info }.
  const [flow, setFlow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState(null);
  // Until when the server accepts changes without the password again, and
  // whether that covers more than adding a method (it was made with a code).
  const [confirmation, setConfirmation] = useState(() => (me?.mfa_stepup_seconds
    ? { until: timeAfter(me.mfa_stepup_seconds), full: Boolean(me.mfa_stepup_full) } : null));
  const idle = !flow && !dialog;

  const closeAll = () => {
    setDialog(null);
    setFlow(null);
  };

  // The parent Settings page remounts this section on onChanged (key={version}),
  // which would wipe freshly shown recovery codes. While codes are on screen,
  // the refresh waits until the user closes them.
  const done = (data) => {
    closeAll();
    toast.success('Two-step verification updated');
    if (data?.recovery_codes?.length) return setCodes(data.recovery_codes);
    onChanged?.();
  };

  const askAgain = (action) => {
    setConfirmation(null);
    setDialog({ type: 'confirm', action, notice: 'Please confirm it’s you again to continue.' });
  };

  // Sends the setup code by email / WhatsApp and shows the code step.
  const sendSetupCode = async (method, phone, { acceptWait = false } = {}) => {
    let res = null;
    let wait;
    try {
      res = method === 'email' ? await api.startEmailSetup(null, {}) : await api.startWhatsappSetup(phone, null, {});
    } catch (err) {
      // An email code sent moments ago is still good. (A WhatsApp number may
      // have changed, so there the wait is shown instead.)
      wait = waitFromError(err);
      if (!(acceptWait && method === 'email' && wait != null)) throw err;
    }
    setDialog(null);
    setFlow({ method, step: 'code', phone, info: sentInfo(res, wait) });
  };

  // Does a change the server will accept without a password (just confirmed).
  const perform = async (action) => {
    const { kind, method, phone } = action;
    if (kind === 'disableAll') {
      await api.disableAllMfa();
      setConfirmation(null);
      return done();
    }
    if (kind === 'disable') {
      await api.disableMfaMethod(method, {});
      return done();
    }
    if (kind === 'default') {
      await api.setDefaultMfaMethod(method);
      setDialog(null);
      toast.success(`${METHOD_META[method].title} is now your default`);
      return onChanged?.();
    }
    // The setup panel is still open: only the confirmation had run out.
    if (action.resume) return setDialog(null);
    if (method === 'totp') {
      const setup = await api.startMfaSetup(null, {});
      setDialog(null);
      return setFlow({ method, step: 'scan', setup });
    }
    if (method === 'whatsapp' && !phone) {
      setDialog(null);
      return setFlow({ method, step: 'phone' });
    }
    return sendSetupCode(method, phone, { acceptWait: true });
  };

  const startsSetup = (action) => action.kind === 'enable' && !action.resume;

  // A click: ask "confirm it's you" only when there is no live confirmation.
  const begin = async (action) => {
    if (action.kind === 'recovery' || !isConfirmed(confirmation, action)) return setDialog({ type: 'confirm', action });
    if (action.kind === 'disable' || action.kind === 'disableAll') return setDialog({ type: 'off', action });
    setDialog(null);
    if (action.kind === 'enable') setFlow({ method: action.method, step: 'starting' });
    try {
      await perform(action);
    } catch (err) {
      if (action.kind === 'enable') setFlow(null);
      if (needsConfirmation(err)) return askAgain(action);
      toast.error(err.message || 'Something went wrong');
    }
  };

  const submitConfirmation = async (action, proof) => {
    if (action.kind === 'recovery') {
      const res = await api.regenerateRecoveryCodes(proof);
      closeAll();
      if (res?.recovery_codes?.length) return setCodes(res.recovery_codes);
      return onChanged?.();
    }
    const res = await api.confirmStepUp(proof);
    setConfirmation({ until: timeAfter(res.expires_in), full: res.strength === 'full' });
    if (startsSetup(action)) {
      setDialog(null);
      setFlow({ method: action.method, step: 'starting' });
    }
    // Confirmed: if the change itself fails, close (the next click goes
    // straight to it) instead of asking for the password and code again.
    try {
      await perform(action);
    } catch (err) {
      setDialog(null);
      if (startsSetup(action)) setFlow(null);
      toast.error(err.message || 'Something went wrong');
    }
  };

  // Runs a request; back to "confirm it's you" if the confirmation ran out.
  const guarded = async (action, work) => {
    try {
      return await work();
    } catch (err) {
      if (needsConfirmation(err)) return askAgain(action);
      throw err;
    }
  };

  const confirmCode = async (value) => {
    const { method, phone } = flow;
    try {
      const data = method === 'totp' ? await api.confirmMfaSetup(value, null, {})
        : method === 'email' ? await api.confirmEmailSetup(value, null, {})
          : await api.confirmWhatsappSetup(value, null, {});
      done(data);
    } catch (err) {
      if (!needsConfirmation(err)) throw err;
      // MFA_CODE_REQUIRED: the started setup is too old, so it starts again.
      askAgain({ kind: 'enable', method, phone, resume: err.code === 'PASSWORD_REQUIRED' });
    }
  };

  const toggle = () => {
    if (state.on) return begin({ kind: 'disableAll' });
    const choices = setupChoices(me);
    if (choices.length === 1) return begin({ kind: 'enable', method: choices[0] });
    return setDialog({ type: 'choose' });
  };

  if (codes) return <RecoveryCodes codes={codes} onClose={() => { setCodes(null); onChanged?.(); }} />;

  const closeDialog = () => setDialog(null);

  return (
    <div className="flex flex-col gap-4">
      {/* The switch */}
      <div className={cn('flex items-center gap-3 rounded-xl border p-4', state.on ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50')}>
        <FiShield className={cn('hidden size-6 shrink-0 sm:block', state.on ? 'text-emerald-600' : 'text-amber-600')} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-slate-900">Two-step verification is {state.on ? 'on' : 'off'}</div>
          <p className="text-[13px] text-slate-600">
            {state.locked ? state.reason
              : state.on ? 'At sign-in you get a code from your default method and can switch to another one.'
                : 'Switch it on so a stolen password alone cannot open your workspace.'}
          </p>
        </div>
        <Switch on={state.on} label="Two-step verification" disabled={!me || state.locked || !idle} onClick={toggle} />
      </div>

      {whatsappOnly(me) && (
        <Callout tone="warn">
          WhatsApp is your only method and only 3 sign-in codes can be sent a day. Turn on another method, and keep your recovery codes safe.
        </Callout>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {shownMethods(me).map((method) => {
          const on = enrolled.includes(method);
          const unavailable = method === 'whatsapp' && !waAvailable;
          const isDefault = on && defaultMethod === method;
          const active = flow?.method === method;
          const blocker = on ? removeBlocker(me, method) : setupBlocker(me, method);
          const hold = on ? holdOf(me, method) : null;
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
              <div style={{ marginTop: 'auto' }}>
                {hold && <p className="mb-2 text-[11px] text-slate-500">Added recently: it signs you in, but cannot confirm changes until {new Date(hold.until).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}.</p>}
                {blocker && !unavailable && <p className="mb-2 text-[11px] text-amber-700">{blocker}</p>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {on ? (
                    <>
                      <Button type="button" size="sm" variant="outline" className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700" disabled={!idle || Boolean(blocker)}
                        aria-label={TITLES.disable[method]} onClick={() => begin({ kind: 'disable', method })}>Turn off</Button>
                      {!isDefault && usable.includes(method) && <Button type="button" size="sm" variant="outline" disabled={!idle} onClick={() => begin({ kind: 'default', method })}>Make default</Button>}
                    </>
                  ) : (
                    <Button type="button" size="sm" disabled={!idle || Boolean(blocker)} aria-label={TITLES.enable[method]} onClick={() => begin({ kind: 'enable', method })}>Set up</Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {flow && (
        <SetupPanel key={`${flow.method}:${flow.step}`} flow={flow} onCancel={() => setFlow(null)} onConfirm={confirmCode}
          onNext={() => setFlow({ ...flow, step: 'code' })}
          onSendCode={(phone) => guarded({ kind: 'enable', method: flow.method, phone }, () => sendSetupCode(flow.method, phone))}
          onResend={() => guarded({ kind: 'enable', method: flow.method, phone: flow.phone }, () => sendSetupCode(flow.method, flow.phone))}
          onBack={flow.method === 'email' ? null : () => setFlow({ ...flow, step: flow.method === 'totp' ? 'scan' : 'phone' })} />
      )}

      {me?.mfa_enabled && !flow && (
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <span className="text-xs text-muted-foreground">Recovery codes left: {me?.recovery_codes_left || 0} of 10.</span>
          <Button type="button" size="sm" variant="outline" disabled={Boolean(dialog)} onClick={() => begin({ kind: 'recovery' })}>Create new recovery codes</Button>
        </div>
      )}

      <Dialog open={Boolean(dialog)} onOpenChange={(open) => { if (!open && !busy) closeDialog(); }}>
        {dialog && (
          // A stray tap outside must not throw away a half-typed confirmation.
          // With a setup panel opening, focus stays there instead of going back.
          <DialogContent className="px-4 sm:max-w-md sm:px-6" onInteractOutside={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => { if (document.getElementById('twostep-setup')) e.preventDefault(); }}>
            <div className="min-w-0">
              {dialog.type === 'confirm' && (
                <ConfirmIdentity key={`${dialog.action.kind}:${dialog.action.method || ''}`} me={me} action={dialog.action} notice={dialog.notice}
                  busy={busy} setBusy={setBusy} onCancel={closeDialog} onSubmit={(proof) => submitConfirmation(dialog.action, proof)} />
              )}
              {dialog.type === 'choose' && (
                <ChooseMethod choices={setupChoices(me)} texts={TEXT} onPick={(method) => begin({ kind: 'enable', method })} />
              )}
              {dialog.type === 'off' && (
                <ConfirmOff action={dialog.action} busy={busy} setBusy={setBusy} onCancel={closeDialog}
                  onConfirm={() => guarded(dialog.action, () => perform(dialog.action))} />
              )}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
};
