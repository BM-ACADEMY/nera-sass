import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { FiShield } from 'react-icons/fi';
import { api } from '../../services/api.js';
import { C } from '../../constants/theme.js';
import { MethodTile, METHOD_META } from '../../components/auth/MfaBrandIcons.jsx';
import { Callout } from './SettingsKit.jsx';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { codeDeadline } from '../../utils/otpTimer.js';
import { readWizard, saveWizard, clearWizard } from '../../utils/twoStepWizard.js';
import { ConfirmIdentity, ChooseMethod, ConfirmOff } from './TwoStepDialogs.jsx';
import { SetupSteps, RecoveryCodes, LostCodes } from './TwoStepWizard.jsx';
import {
  TITLES, DEFAULT_RESEND_SECONDS, waitFromError, enrolledMethods, shownMethods, setupChoices, switchState,
  setupBlocker, removeBlocker, whatsappOnly, needsConfirmation, isConfirmed, holdOf, restoreWizard, resumedWizard,
} from './twoStepFlow.js';

// Two-step verification in Settings: a switch at the top and three methods
// (authenticator app, email code, WhatsApp code) as cards. Everything else
// happens in one pop-up. Turning a method on shows three steps in it: confirm
// it's you, scan the QR code (or get a code), enter the code; then the recovery
// codes. The pop-up closes only with Cancel (or the X) or when done, and comes
// back on the same step after a reload (utils/twoStepWizard.js keeps the
// position only; the server gives the rest again).
// "Confirm it's you" is the password only for adding a method; for turning one
// off, changing the default or new recovery codes also a current code while
// two-step is on. The server remembers the check for this session for a few
// minutes (a password-only one covers adding only), so it is asked once; the
// password is not kept in the browser. New recovery codes always ask again. A
// method added to an account that already had two-step on cannot confirm
// changes for 24 hours.
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

export const TwoStepMethods = ({ me, onChanged }) => {
  const usable = me?.mfa_methods || [];
  const enrolled = enrolledMethods(me);
  const defaultMethod = me?.mfa_default_method || null;
  const waAvailable = Boolean(me?.whatsapp_otp_available);
  const state = switchState(me);
  // Where the pop-up was before a reload, and the server's live confirmation.
  const [initial] = useState(() => {
    const live = me?.mfa_stepup_seconds ? { until: timeAfter(me.mfa_stepup_seconds), full: Boolean(me.mfa_stepup_full) } : null;
    return { confirmation: live, ...restoreWizard(readWizard(me?.id), me, isConfirmed(live, { kind: 'enable' })) };
  });
  // A confirmation / choice shown in the pop-up: { type: 'confirm' | 'choose' |
  // 'off', action, notice, error }. action: { kind: 'enable' | 'disable' |
  // 'disableAll' | 'default' | 'recovery', method, phone, resume }.
  const [dialog, setDialog] = useState(initial.dialog);
  // The method being set up: { method, step: 'confirm' | 'starting' | 'failed' |
  // 'scan' | 'phone' | 'code', target, setup, phone, info, missing, error }.
  const [wizard, setWizard] = useState(initial.wizard);
  // Recovery codes were on screen when the page was reloaded.
  const [lost, setLost] = useState(initial.lost);
  const [codes, setCodes] = useState(null);
  const [busy, setBusy] = useState(false);
  // Until when the server accepts changes without the password again, and
  // whether that covers more than adding a method (it was made with a code).
  const [confirmation, setConfirmation] = useState(initial.confirmation);
  // Goes up on cancel and success: answers to older requests are then ignored.
  const run = useRef(0);
  const open = Boolean(codes || lost || dialog || wizard);

  useEffect(() => {
    if (codes || lost) saveWizard(me?.id, { method: null, step: 'codes' });
    else if (wizard) saveWizard(me?.id, { method: wizard.method, step: ['starting', 'failed'].includes(wizard.step) ? wizard.target : wizard.step });
    else clearWizard();
  }, [me?.id, codes, lost, wizard]);

  const cancel = () => {
    run.current += 1;
    setWizard(null);
    setDialog(null);
    setLost(false);
  };

  // The parent Settings page remounts this section on onChanged (key={version}),
  // which would wipe freshly shown recovery codes. While codes are on screen,
  // the refresh waits until the user closes them.
  const done = (data) => {
    cancel();
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
    const mine = run.current;
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
    if (mine !== run.current) return;
    setDialog(null);
    setWizard({ method, step: 'code', phone, info: sentInfo(res, wait) });
  };

  // Starts turning a method on (the confirmation is live).
  const startSetup = async ({ method, phone }) => {
    setDialog(null);
    if (method === 'whatsapp' && !phone) return setWizard({ method, step: 'phone' });
    const target = method === 'totp' ? 'scan' : 'code';
    run.current += 1;
    const mine = run.current;
    setWizard({ method, step: 'starting', target, phone });
    try {
      if (method !== 'totp') return await sendSetupCode(method, phone, { acceptWait: true });
      const setup = await api.startMfaSetup(null, {});
      if (mine === run.current) setWizard({ method, step: 'scan', setup });
    } catch (err) {
      if (mine !== run.current) return;
      if (needsConfirmation(err)) return askAgain({ kind: 'enable', method, phone });
      setWizard({ method, step: 'failed', target, phone, retry: 'start', error: err.message || 'Something went wrong' });
    }
  };

  // Carries a started setup on: asks the server for what is still waiting (after
  // a reload, or after confirming again). Creates and sends nothing.
  const restore = async (current) => {
    const { method, phone } = current;
    const target = ['starting', 'failed'].includes(current.step) ? current.target : current.step;
    if (target === 'phone') return setWizard({ method, step: 'phone', phone });
    const mine = run.current;
    try {
      const res = await api.resumeMfaSetup(method);
      if (mine === run.current) setWizard(resumedWizard(current, target, res));
    } catch (err) {
      if (mine !== run.current) return;
      if (needsConfirmation(err)) return askAgain({ kind: 'enable', method, resume: true });
      if (err.code === 'MFA_ALREADY_ON') {
        cancel();
        return onChanged?.();
      }
      setWizard({ method, step: 'failed', target, phone, retry: 'resume', error: err.message || 'Something went wrong' });
    }
  };

  // Once, for a pop-up reopened with a live confirmation.
  useEffect(() => {
    if (initial.wizard?.step !== 'starting' || initial.dialog) return undefined;
    const timer = setTimeout(() => restore(initial.wizard), 0);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A change other than setting up, which the server will accept without a
  // password (just confirmed).
  const perform = async ({ kind, method }) => {
    if (kind === 'disableAll') {
      await api.disableAllMfa();
      setConfirmation(null);
      return done();
    }
    if (kind === 'disable') {
      await api.disableMfaMethod(method, {});
      return done();
    }
    await api.setDefaultMfaMethod(method);
    cancel();
    toast.success(`${METHOD_META[method].title} is now your default`);
    return onChanged?.();
  };

  // A click: ask "confirm it's you" only when there is no live confirmation.
  const begin = async (action) => {
    setLost(false);
    if (action.kind === 'enable') {
      if (isConfirmed(confirmation, action)) return startSetup(action);
      setDialog(null);
      return setWizard({ method: action.method, step: 'confirm' });
    }
    if (action.kind === 'recovery' || !isConfirmed(confirmation, action)) return setDialog({ type: 'confirm', action });
    if (action.kind !== 'default') return setDialog({ type: 'off', action });
    try {
      await perform(action);
    } catch (err) {
      if (needsConfirmation(err)) return askAgain(action);
      toast.error(err.message || 'Something went wrong');
    }
  };

  const submitConfirmation = async (action, proof) => {
    if (action.kind === 'recovery') {
      const res = await api.regenerateRecoveryCodes(proof);
      cancel();
      if (res?.recovery_codes?.length) return setCodes(res.recovery_codes);
      return onChanged?.();
    }
    const res = await api.confirmStepUp(proof);
    setConfirmation({ until: timeAfter(res.expires_in), full: res.strength === 'full' });
    if (action.kind === 'enable') {
      if (!action.resume) return startSetup(action);
      setDialog(null);
      return restore(wizard);
    }
    // Confirmed: a change that fails stays in the pop-up, to try again
    // without typing the password and code again.
    try {
      await perform(action);
    } catch (err) {
      setDialog({ type: 'off', action, error: err.message || 'Something went wrong' });
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
    const { method } = wizard;
    try {
      const data = method === 'totp' ? await api.confirmMfaSetup(value, null, {})
        : method === 'email' ? await api.confirmEmailSetup(value, null, {})
          : await api.confirmWhatsappSetup(value, null, {});
      done(data);
    } catch (err) {
      if (!needsConfirmation(err)) throw err;
      // The same key / code carries on after confirming again.
      askAgain({ kind: 'enable', method, resume: true });
    }
  };

  const resend = () => {
    const { method, phone } = wizard;
    // The number is not kept across a reload: it is typed again.
    if (method === 'whatsapp' && !phone) return setWizard({ method, step: 'phone' });
    return guarded({ kind: 'enable', method, phone }, () => sendSetupCode(method, phone));
  };

  const retry = () => {
    if (wizard.retry !== 'resume') return begin({ kind: 'enable', method: wizard.method, phone: wizard.phone });
    const again = { ...wizard, step: 'starting' };
    setWizard(again);
    return restore(again);
  };

  const toggle = () => {
    if (state.on) return begin({ kind: 'disableAll' });
    const choices = setupChoices(me);
    if (choices.length === 1) return begin({ kind: 'enable', method: choices[0] });
    return setDialog({ type: 'choose' });
  };

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
        <Switch on={state.on} label="Two-step verification" disabled={!me || state.locked || open} onClick={toggle} />
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
          const active = wizard?.method === method;
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
                      <Button type="button" size="sm" variant="outline" className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700" disabled={open || Boolean(blocker)}
                        aria-label={TITLES.disable[method]} onClick={() => begin({ kind: 'disable', method })}>Turn off</Button>
                      {!isDefault && usable.includes(method) && <Button type="button" size="sm" variant="outline" disabled={open} onClick={() => begin({ kind: 'default', method })}>Make default</Button>}
                    </>
                  ) : (
                    <Button type="button" size="sm" disabled={open || Boolean(blocker)} aria-label={TITLES.enable[method]} onClick={() => begin({ kind: 'enable', method })}>Set up</Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {me?.mfa_enabled && (
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <span className="text-xs text-muted-foreground">Recovery codes left: {me?.recovery_codes_left || 0} of 10.</span>
          <Button type="button" size="sm" variant="outline" disabled={open} onClick={() => begin({ kind: 'recovery' })}>Create new recovery codes</Button>
        </div>
      )}

      {/* Closed only by Cancel / X or by finishing: Escape and outside clicks do nothing. */}
      <Dialog open={open} onOpenChange={(next) => { if (!next && !busy && !codes) cancel(); }}>
        {open && (
          <DialogContent showCloseButton={!codes} className="max-h-[calc(100dvh-1.5rem)] px-4 sm:max-w-lg sm:px-6"
            onEscapeKeyDown={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
            {codes && <RecoveryCodes codes={codes} onClose={() => { setCodes(null); onChanged?.(); }} />}
            {!codes && lost && !dialog && <LostCodes onCancel={cancel} onNewCodes={() => begin({ kind: 'recovery' })} />}
            {!codes && wizard && wizard.step !== 'confirm' && (
              // Kept while "confirm it's you" is asked again, so nothing typed is lost.
              <div className="min-w-0" hidden={Boolean(dialog)}>
                <SetupSteps key={`${wizard.method}:${wizard.step}`} flow={wizard} busy={busy} setBusy={setBusy} onCancel={cancel}
                  onConfirm={confirmCode} onResend={resend} onRetry={retry}
                  onNext={() => setWizard({ ...wizard, step: 'code' })}
                  onRestart={() => begin({ kind: 'enable', method: wizard.method })}
                  onSendCode={(phone) => guarded({ kind: 'enable', method: wizard.method, phone }, () => sendSetupCode(wizard.method, phone))}
                  onBack={wizard.method === 'email' || (wizard.method === 'totp' && !wizard.setup) ? null
                    : () => setWizard({ ...wizard, step: wizard.method === 'totp' ? 'scan' : 'phone' })} />
              </div>
            )}
            {!codes && wizard?.step === 'confirm' && !dialog && (
              <ConfirmIdentity key={`enable:${wizard.method}`} me={me} action={{ kind: 'enable', method: wizard.method }}
                busy={busy} setBusy={setBusy} onCancel={cancel} onSubmit={(proof) => submitConfirmation({ kind: 'enable', method: wizard.method }, proof)} />
            )}
            {!codes && dialog?.type === 'confirm' && (
              <ConfirmIdentity key={`${dialog.action.kind}:${dialog.action.method || ''}`} me={me} action={dialog.action} notice={dialog.notice}
                busy={busy} setBusy={setBusy} onCancel={cancel} onSubmit={(proof) => submitConfirmation(dialog.action, proof)} />
            )}
            {!codes && dialog?.type === 'choose' && (
              <ChooseMethod choices={setupChoices(me)} texts={TEXT} onPick={(method) => begin({ kind: 'enable', method })} />
            )}
            {!codes && dialog?.type === 'off' && (
              <ConfirmOff action={dialog.action} initialError={dialog.error} busy={busy} setBusy={setBusy} onCancel={cancel}
                onConfirm={() => guarded(dialog.action, () => perform(dialog.action))} />
            )}
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
};
