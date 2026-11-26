import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';
import { FiCopy } from 'react-icons/fi';
import { MethodTile } from '../../components/auth/MfaBrandIcons.jsx';
import { EmailCodeArt } from '../../components/auth/Art.jsx';
import OtpInput from '../../components/auth/OtpInput.jsx';
import { FormRow, Callout } from './SettingsKit.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { DialogDescription } from '@/components/ui/dialog';
import { useSecondsUntil } from '../../hooks/useSecondsUntil.js';
import { PopupHeader, Steps, PanelActions, CodeCountdown, LinkButton } from './TwoStepDialogs.jsx';
import { TITLES, currentStep } from './twoStepFlow.js';

// Pop-up contents after "confirm it's you": steps 2 and 3 of turning a method
// on, and the recovery codes.
const copyText = (text, done, failed) => navigator.clipboard?.writeText(text)
  .then(() => toast.success(done))
  .catch(() => toast.error(failed));

// Steps 2 and 3. 2: the app's QR code and key, or the WhatsApp number to send a
// code to. 3: the 6-digit code, with how long a code sent by email / WhatsApp
// still works. `flow`: { method, step: 'starting' | 'failed' | 'scan' |
// 'phone' | 'code', target, setup, phone, info, missing, error }. The on*
// requests throw to show an error here.
export const SetupSteps = ({ flow, busy, setBusy, onSendCode, onNext, onConfirm, onResend, onRestart, onRetry, onBack, onCancel }) => {
  const { method, step, info } = flow;
  const isApp = method === 'totp';
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState(flow.phone || '');
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const left = useSecondsUntil(info?.deadline || 0);
  const wait = useSecondsUntil(info?.resendAt || 0);
  const expired = Boolean(info?.deadline) && left === 0;
  const noCode = !isApp && Boolean(info?.missing);
  const noKey = step === 'scan' && Boolean(flow.missing);
  const top = useRef(null);
  // A new step starts at the top of the pop-up (it scrolls on small screens).
  useEffect(() => { const box = top.current?.closest('[role="dialog"]'); if (box) box.scrollTop = 0; }, []);

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
    if (busy || expired || noCode) return;
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
  const submit = (event) => {
    event.preventDefault();
    if (step === 'failed') return onRetry();
    if (noKey) return onRestart();
    if (step === 'scan') return onNext();
    if (step === 'phone') return sendToNumber();
    if (step === 'code') return confirm();
    return null;
  };
  const label = step === 'failed' ? 'Try again' : noKey ? 'Show a new QR code'
    : { scan: 'Next', phone: 'Send code', code: 'Turn on' }[step];

  return (
    <form ref={top} onSubmit={submit} className="flex min-w-0 flex-col gap-4">
      <PopupHeader method={method} title={TITLES.enable[method]} />
      <DialogDescription className="sr-only">Setting up a sign-in method for two-step verification.</DialogDescription>
      <Steps method={method} current={currentStep(step === 'starting' || step === 'failed' ? flow.target : step)} />
      {(error || flow.error) && <Callout tone="error">{error || flow.error}</Callout>}
      {step === 'starting' && <div className="flex justify-center py-6"><Spinner className="size-6" /></div>}
      {noKey && <Callout tone="info">This setup has expired. Show a new QR code and scan it; remove the older Getnera entry from your app if you added it.</Callout>}
      {step === 'scan' && !noKey && (
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="max-w-sm text-[13px] text-muted-foreground">
            Open Google Authenticator (or Microsoft Authenticator, Authy), tap <b className="text-slate-900">+</b>, choose “Scan a QR code” and scan this one.
          </p>
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"><QRCodeSVG value={flow.setup.otpauth_url} size={176} /></div>
          <div className="w-full max-w-sm text-left">
            <div className="mb-1 text-xs text-muted-foreground">Can’t scan? Enter this key in the app:</div>
            <div className="flex items-center gap-2 rounded-lg bg-slate-100 py-1.5 pr-1.5 pl-3">
              <code className="min-w-0 flex-1 font-mono text-xs break-all text-slate-800">{flow.setup.secret}</code>
              <Button type="button" variant="outline" size="sm" className="bg-white"
                onClick={() => copyText(flow.setup.secret, 'Key copied', 'Could not copy. Select the key and copy it.')}><FiCopy /> Copy</Button>
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
        <div className="flex flex-col items-center gap-3 text-center">
          {method === 'email' && <EmailCodeArt className="h-20 w-auto" />}
          {method === 'whatsapp' && <MethodTile method="whatsapp" size={56} />}
          {isApp ? <div className="text-[13px] font-semibold text-slate-700">Enter the 6-digit code the app shows</div> : (
            <p className="max-w-sm text-[13px] text-muted-foreground">
              {noCode ? 'There is no code waiting to be entered. Send a new one.' : (
                <>
                  {info?.sentTo
                    ? <>Enter the 6-digit code we sent to <b className="text-slate-900 [overflow-wrap:anywhere]">{info.sentTo}</b>.</>
                    : 'Enter the 6-digit code we sent a moment ago.'}
                  {' '}At each sign-in you’ll get a new one.
                </>
              )}
            </p>
          )}
          <OtpInput value={code} onChange={setCode} onComplete={confirm} disabled={busy || expired || noCode} />
          {!isApp && (
            <>
              <CodeCountdown deadline={info?.deadline} />
              <LinkButton onClick={resend} disabled={busy || resending || wait > 0}>
                {resending ? 'Sending…' : wait > 0 ? `Send again in ${wait}s` : noCode ? 'Send a new code' : 'Didn’t get it? Send again'}
              </LinkButton>
            </>
          )}
        </div>
      )}
      {step === 'starting'
        ? <div className="flex flex-col sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button></div>
        : <PanelActions busy={busy} onCancel={onCancel} onBack={step === 'code' ? onBack : null} label={label}
          disabled={step === 'code' && (code.length !== 6 || expired || noCode)} />}
    </form>
  );
};

// Shown once. Closed only with the button: the codes cannot be shown again.
export const RecoveryCodes = ({ codes, onClose }) => {
  // Reloading or closing the tab would lose them: the browser asks first.
  useEffect(() => {
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <PopupHeader title="Your recovery codes" />
      <DialogDescription className="sr-only">Save these codes before closing.</DialogDescription>
      <Callout tone="ok">Save these recovery codes somewhere safe. Each one signs you in once if you lose access to your methods. They will not be shown again.</Callout>
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center font-mono text-sm select-all">
        {codes.map((c) => <span key={c}>{c}</span>)}
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline"
          onClick={() => copyText(codes.join('\n'), 'Recovery codes copied', 'Could not copy. Select the codes and copy them.')}><FiCopy /> Copy</Button>
        <Button type="button" onClick={onClose}>I have saved my recovery codes</Button>
      </div>
    </div>
  );
};

// The page was reloaded while new recovery codes were on screen.
export const LostCodes = ({ onNewCodes, onCancel }) => (
  <form onSubmit={(e) => { e.preventDefault(); onNewCodes(); }} className="flex min-w-0 flex-col gap-4">
    <PopupHeader title="Recovery codes not shown again" />
    <DialogDescription className="text-[13px]">
      The page was reloaded, and recovery codes are shown only once. If you did not save them, create a new set.
    </DialogDescription>
    <PanelActions onCancel={onCancel} cancelLabel="I have saved them" label="Create new recovery codes" />
  </form>
);
