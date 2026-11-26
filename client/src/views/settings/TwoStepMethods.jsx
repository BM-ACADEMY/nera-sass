import { useState } from 'react';
import toast from 'react-hot-toast';
import { FiCopy, FiShield } from 'react-icons/fi';
import { api } from '../../services/api.js';
import { MethodTile, METHOD_META } from '../../components/auth/MfaBrandIcons.jsx';
import { Callout } from './SettingsKit.jsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { codeDeadline } from '../../utils/otpTimer.js';
import { ConfirmIdentity, ChooseMethod, ConfirmOff, WhatsAppNumber, ScanQr, EnterCode } from './TwoStepDialogs.jsx';
import {
  enrolledMethods, shownMethods, setupChoices, switchState, setupBlocker, removeBlocker, whatsappOnly, needsConfirmation, isConfirmed,
} from './twoStepPolicy.js';

// Two-step verification in Settings: a switch at the top and one card per
// method (authenticator app, email code, WhatsApp code). Changes ask "confirm
// it's you" in a pop-up (password, plus a current code when two-step is on).
// The server remembers that check for this session for a few minutes, so it is
// asked once; the password is not kept in the browser. New recovery codes
// always ask again.
const TEXT = {
  totp: 'A new code every 30 seconds in Google Authenticator, even offline.',
  email: 'A 6-digit code is emailed to you at each sign-in.',
  whatsapp: 'An extra method: a code on WhatsApp, valid 10 minutes, up to 3 sign-in codes a day.',
};
const SETUP_TITLE = { totp: 'Set up the authenticator app', email: 'Set up email codes', whatsapp: 'Set up WhatsApp codes' };
const OFF_TITLE = { totp: 'Turn off the authenticator app', email: 'Turn off email codes', whatsapp: 'Turn off WhatsApp codes' };
const OFF_ALL_TEXT = 'Every method and your recovery codes are removed. Your password alone will then sign you in.';

const confirmCopy = (action) => {
  if (action.kind === 'disableAll') return { title: 'Turn off 2-step verification', warning: OFF_ALL_TEXT, actionLabel: 'Turn off', destructive: true };
  if (action.kind === 'disable') return { title: OFF_TITLE[action.method], actionLabel: 'Turn off', destructive: true };
  if (action.kind === 'recovery') return { title: 'Create new recovery codes', warning: 'Your old recovery codes stop working.', actionLabel: 'Create new codes' };
  return { title: 'Confirm it’s you', actionLabel: 'Continue' };
};

const timeAfter = (seconds) => Date.now() + seconds * 1000;

// What the code step shows about the code just sent.
const sentInfo = (res) => (res ? {
  sentTo: res.sent_to,
  deadline: codeDeadline(res),
  resendAt: Date.now() + (res.resend_after || 45) * 1000,
} : { sentTo: '', deadline: 0, resendAt: Date.now() + 45000 });

const Switch = ({ on, disabled, onClick, label }) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick}
    className={cn('relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
      on ? 'bg-emerald-600' : 'bg-slate-300')}>
    <span className={cn('inline-block size-5 rounded-full bg-white shadow transition-transform', on ? 'translate-x-6' : 'translate-x-1')} />
  </button>
);

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
  const enrolled = enrolledMethods(me);
  const usable = me?.mfa_methods || [];
  const defaultMethod = me?.mfa_default_method || null;
  const state = switchState(me);
  // The open pop-up: { type: 'choose' | 'confirm' | 'off' | 'phone' | 'qr' | 'code' | 'loading', ... }.
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState(null);
  // Until when the server accepts changes without the password again.
  const [confirmedUntil, setConfirmedUntil] = useState(() => (me?.mfa_stepup_seconds ? Date.now() + me.mfa_stepup_seconds * 1000 : 0));

  const close = () => setDialog(null);

  // The settings page reloads this section on onChanged, which would wipe
  // freshly shown recovery codes: with codes on screen the reload waits.
  const done = (data) => {
    close();
    toast.success('Two-step verification updated');
    if (data?.recovery_codes?.length) return setCodes(data.recovery_codes);
    onChanged?.();
  };

  const askAgain = (action) => {
    setConfirmedUntil(0);
    setDialog({ type: 'confirm', action, notice: 'Please confirm it’s you again to continue.' });
  };

  // Sends the code for email / WhatsApp setup and shows the code step.
  const sendSetupCode = async (method, phone) => {
    let res = null;
    try {
      res = method === 'email' ? await api.startEmailSetup(null, {}) : await api.startWhatsappSetup(phone, null, {});
    } catch (err) {
      // An email code sent moments ago is still good. (A WhatsApp number may
      // have changed, so there the wait is shown instead.)
      if (!(method === 'email' && err.code === 'OTP_RESEND_WAIT')) throw err;
    }
    setDialog({ type: 'code', method, phone, info: sentInfo(res) });
  };

  // Does a change the server will accept without a password (just confirmed).
  const perform = async (action) => {
    if (action.kind === 'disableAll') {
      await api.disableAllMfa();
      setConfirmedUntil(0);
      return done();
    }
    if (action.kind === 'disable') {
      await api.disableMfaMethod(action.method, {});
      return done();
    }
    if (action.kind === 'resume') return setDialog(action.dialog);
    if (action.method === 'totp') return setDialog({ type: 'qr', setup: await api.startMfaSetup(null, {}) });
    if (action.method === 'email') return sendSetupCode('email');
    return setDialog({ type: 'phone', action });
  };

  // A click: ask "confirm it's you" only when there is no live confirmation.
  const begin = async (action) => {
    if (action.kind === 'recovery' || !isConfirmed(confirmedUntil)) return setDialog({ type: 'confirm', action });
    if (action.kind === 'disable' || action.kind === 'disableAll') return setDialog({ type: 'off', action });
    setDialog({ type: 'loading' });
    try {
      await perform(action);
    } catch (err) {
      if (needsConfirmation(err)) return askAgain(action);
      close();
      toast.error(err.message || 'Something went wrong');
    }
  };

  const submitConfirmation = async (action, proof) => {
    if (action.kind === 'recovery') {
      const res = await api.regenerateRecoveryCodes(proof);
      close();
      if (res?.recovery_codes?.length) return setCodes(res.recovery_codes);
      return onChanged?.();
    }
    const res = await api.confirmStepUp(proof);
    setConfirmedUntil(timeAfter(res.expires_in));
    // Confirmed: if the change itself fails, close the pop-up (the next click
    // goes straight to it) instead of asking for the password and code again.
    try {
      await perform(action);
    } catch (err) {
      close();
      toast.error(err.message || 'Something went wrong');
    }
  };

  // Runs a request from inside a pop-up; back to "confirm it's you" if the
  // confirmation ran out.
  const guarded = (action) => async (work) => {
    try {
      return await work();
    } catch (err) {
      if (needsConfirmation(err)) return askAgain(action);
      throw err;
    }
  };

  const confirmCode = async (current, value) => {
    const { method } = current;
    try {
      const data = method === 'totp' ? await api.confirmMfaSetup(value, null, {})
        : method === 'email' ? await api.confirmEmailSetup(value, null, {})
          : await api.confirmWhatsappSetup(value, null, {});
      done(data);
    } catch (err) {
      if (!needsConfirmation(err)) throw err;
      // MFA_CODE_REQUIRED: the started setup is too old, so it starts again.
      askAgain(err.code === 'PASSWORD_REQUIRED' ? { kind: 'resume', dialog: current } : { kind: 'enable', method });
    }
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

  const toggle = () => {
    if (state.on) return begin({ kind: 'disableAll' });
    const choices = setupChoices(me);
    if (choices.length === 1) return begin({ kind: 'enable', method: choices[0] });
    return setDialog({ type: 'choose' });
  };

  if (codes) return <RecoveryCodes codes={codes} onClose={() => { setCodes(null); onChanged?.(); }} />;

  const renderDialog = () => {
    const common = { busy, setBusy, onCancel: close };
    switch (dialog.type) {
      case 'choose':
        return <ChooseMethod choices={setupChoices(me)} texts={TEXT} onPick={(method) => begin({ kind: 'enable', method })} />;
      case 'confirm': {
        const copy = confirmCopy(dialog.action);
        const intro = dialog.action.kind === 'enable' || dialog.action.kind === 'resume'
          ? 'Enter your password to change how you sign in.'
          : 'For your safety, enter your password to make this change.';
        return <ConfirmIdentity {...common} {...copy} me={me} intro={intro} notice={dialog.notice} onSubmit={(proof) => submitConfirmation(dialog.action, proof)} />;
      }
      case 'off': {
        const { action } = dialog;
        const all = action.kind === 'disableAll';
        return (
          <ConfirmOff {...common} method={all ? null : action.method}
            title={all ? 'Turn off 2-step verification?' : `${OFF_TITLE[action.method]}?`}
            text={all ? OFF_ALL_TEXT : 'You will no longer get sign-in codes this way.'}
            onConfirm={() => guarded(action)(() => perform(action))} />
        );
      }
      case 'phone':
        return <WhatsAppNumber {...common} onSubmit={(phone) => guarded(dialog.action)(() => sendSetupCode('whatsapp', phone))} />;
      case 'qr':
        return <ScanQr setup={dialog.setup} onCancel={close} onNext={() => setDialog({ type: 'code', method: 'totp', setup: dialog.setup })} />;
      case 'code':
        return (
          <EnterCode {...common} method={dialog.method} info={dialog.info}
            onBack={dialog.method === 'totp' ? () => setDialog({ type: 'qr', setup: dialog.setup }) : null}
            onConfirm={(value) => confirmCode(dialog, value)}
            onResend={() => guarded({ kind: 'enable', method: dialog.method })(() => sendSetupCode(dialog.method, dialog.phone))} />
        );
      default:
        return (
          <div className="flex justify-center py-8">
            <DialogTitle className="sr-only">Please wait</DialogTitle>
            <DialogDescription className="sr-only">Loading</DialogDescription>
            <Spinner />
          </div>
        );
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* The switch */}
      <div className={cn('flex items-center gap-3 rounded-xl border p-4', state.on ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50')}>
        <FiShield className={cn('hidden size-6 shrink-0 sm:block', state.on ? 'text-emerald-600' : 'text-amber-600')} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-slate-900">2-step verification is {state.on ? 'on' : 'off'}</div>
          <p className="text-[13px] text-slate-600">
            {state.locked ? state.reason
              : state.on ? 'At sign-in you get a code from your default method and can switch to another one.'
                : 'Switch it on so a stolen password alone cannot open your workspace.'}
          </p>
        </div>
        <Switch on={state.on} label="2-step verification" disabled={!me || state.locked || Boolean(dialog)} onClick={toggle} />
      </div>

      {whatsappOnly(me) && (
        <Callout tone="warn">
          WhatsApp is your only method and only 3 sign-in codes can be sent a day. Add the authenticator app or email codes, and keep your recovery codes safe.
        </Callout>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {shownMethods(me).map((method) => {
          const on = enrolled.includes(method);
          const isDefault = on && defaultMethod === method;
          const blocker = on ? removeBlocker(me, method) : setupBlocker(me, method);
          return (
            <div key={method} className={cn('flex min-w-0 flex-col gap-2.5 rounded-xl border bg-white p-4', on ? 'border-emerald-300' : 'border-border')}>
              <div className="flex items-center gap-3">
                <MethodTile method={method} size={40} />
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-slate-900">{METHOD_META[method].title}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {on ? <Badge variant="success">On</Badge> : <Badge variant="muted">Off</Badge>}
                    {isDefault && <Badge variant="info">Default</Badge>}
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {TEXT[method]}
                {method === 'whatsapp' && on && me?.mfa_whatsapp_number ? ` Number: ${me.mfa_whatsapp_number}.` : ''}
              </p>
              <div className="mt-auto flex flex-col gap-2">
                {blocker && <p className="text-xs text-amber-700">{blocker}</p>}
                <div className="flex flex-wrap gap-2">
                  {on ? (
                    <>
                      <Button type="button" size="sm" variant="outline" className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700" disabled={Boolean(blocker)}
                        aria-label={OFF_TITLE[method]} onClick={() => begin({ kind: 'disable', method })}>Turn off</Button>
                      {!isDefault && usable.includes(method) && <Button type="button" size="sm" variant="outline" onClick={() => makeDefault(method)}>Make default</Button>}
                    </>
                  ) : (
                    <Button type="button" size="sm" disabled={Boolean(blocker)} aria-label={SETUP_TITLE[method]} onClick={() => begin({ kind: 'enable', method })}>Set up</Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {me?.mfa_enabled && (
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">Recovery codes left: {me?.recovery_codes_left || 0} of 10.</span>
          <Button type="button" size="sm" variant="outline" onClick={() => begin({ kind: 'recovery' })}>Create new recovery codes</Button>
        </div>
      )}

      <Dialog open={Boolean(dialog)} onOpenChange={(open) => { if (!open && !busy && dialog?.type !== 'loading') close(); }}>
        {dialog && (
          // A stray tap outside must not throw away a setup in progress.
          <DialogContent className="px-4 sm:max-w-md sm:px-6" onInteractOutside={(e) => e.preventDefault()}>
            <div key={`${dialog.type}:${dialog.method || dialog.action?.method || ''}`} className="min-w-0">{renderDialog()}</div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
};
