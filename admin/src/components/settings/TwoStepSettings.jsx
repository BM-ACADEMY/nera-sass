import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { QRCodeSVG } from 'qrcode.react';
import { FiMail, FiSmartphone, FiKey, FiCopy, FiDownload, FiRefreshCw, FiCheckCircle, FiAlertTriangle, FiInfo } from 'react-icons/fi';
import axiosClient from '../../api/axiosClient';
import { SettingsPageHeader } from './SettingsPageHeader';
import OtpInput from '../security/OtpInput';
import PasswordInput from '../security/PasswordInput';
import { AuthenticatorArt, EmailCodeArt, ShieldArt } from '../security/Art';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

const errorOf = (err, fallback) => err.response?.data?.error || fallback;

// A session token comes back after setup; keep it so this tab stays signed in.
const keepToken = (data) => { if (data?.token) localStorage.setItem('adminToken', data.token); };

const RecoveryCodesDialog = ({ codes, onClose }) => {
  const copy = () => navigator.clipboard?.writeText(codes.join('\n')).then(() => toast.success('Recovery codes copied')).catch(() => {});
  const download = () => {
    const blob = new Blob([`Getnera Admin recovery codes\nEach code works once.\n\n${codes.join('\n')}\n`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'getnera-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <Dialog open={Boolean(codes?.length)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FiKey className="text-amber-500" /> Save your recovery codes</DialogTitle>
          <DialogDescription>These are shown only now. Each one signs you in once if you lose your phone or email access.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center font-mono text-sm">
          {codes?.map((c) => <span key={c}>{c}</span>)}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" onClick={copy}><FiCopy /> Copy</Button>
            <Button variant="outline" onClick={download}><FiDownload /> Download</Button>
          </div>
          <Button onClick={onClose}>I saved them</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// Asks for the password before turning a method off or replacing recovery codes.
const PasswordDialog = ({ request, onClose }) => {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPassword(''); }, [request]);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await request.run(password);
      onClose();
    } catch (err) {
      toast.error(errorOf(err, 'Something went wrong'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{request?.title}</DialogTitle>
            <DialogDescription>{request?.description}</DialogDescription>
          </DialogHeader>
          <PasswordInput autoFocus placeholder="Your password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" variant={request?.destructive ? 'destructive' : 'default'} disabled={busy || !password}>{busy && <Spinner />} {request?.action}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

// Turning on email codes: send a code, enter it.
const EmailSetupDialog = ({ open, email, onClose, onDone }) => {
  const [sent, setSent] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  useEffect(() => { if (open) { setSent(null); setCode(''); } }, [open]);
  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async () => {
    setBusy(true);
    try {
      const res = await axiosClient.post('/auth/mfa/email/setup', {});
      setSent(res.data);
      setWait(res.data.resend_after || 45);
      toast.success(`Code sent to ${res.data.sent_to}`);
    } catch (err) {
      toast.error(errorOf(err, 'The code could not be sent'));
    } finally {
      setBusy(false);
    }
  };
  const confirm = async (value = code) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await axiosClient.post('/auth/mfa/email/setup/confirm', { code: value });
      keepToken(res.data);
      toast.success('Email verification is on');
      onDone(res.data.recovery_codes);
    } catch (err) {
      setCode('');
      toast.error(errorOf(err, 'Invalid verification code'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <div className="flex justify-center"><EmailCodeArt className="h-28 w-auto" /></div>
        <DialogHeader className="text-center sm:text-center">
          <DialogTitle>Turn on email codes</DialogTitle>
          <DialogDescription>
            {sent ? `Enter the 6-digit code we sent to ${sent.sent_to}.` : `We'll send a 6-digit code to ${email}. At each sign-in you'll get a new one.`}
          </DialogDescription>
        </DialogHeader>
        {sent ? (
          <div className="flex flex-col items-center gap-4">
            <OtpInput value={code} onChange={setCode} onComplete={confirm} disabled={busy} />
            <button type="button" disabled={wait > 0 || busy} onClick={send} className="cursor-pointer text-[13px] text-primary hover:underline disabled:cursor-default disabled:text-slate-400 disabled:no-underline">
              {wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
            </button>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          {sent
            ? <Button onClick={() => confirm()} disabled={busy || code.length !== 6}>{busy && <Spinner />} Verify and turn on</Button>
            : <Button onClick={send} disabled={busy}>{busy && <Spinner />} Send code</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// Setting up the authenticator app: QR code, key, then a code from the app.
const AppSetupDialog = ({ open, onClose, onDone }) => {
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSetup(null);
    setCode('');
    axiosClient.post('/auth/mfa/setup', {})
      .then((r) => setSetup(r.data))
      .catch((err) => { toast.error(errorOf(err, 'Could not start the setup')); onClose(); });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirm = async (value = code) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await axiosClient.post('/auth/mfa/setup/confirm', { code: value });
      keepToken(res.data);
      toast.success('Authenticator app is on');
      onDone(res.data.recovery_codes);
    } catch (err) {
      setCode('');
      toast.error(errorOf(err, 'Invalid verification code'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FiSmartphone className="text-emerald-600" /> Set up the authenticator app</DialogTitle>
          <DialogDescription>Works with Google Authenticator, Microsoft Authenticator and Authy.</DialogDescription>
        </DialogHeader>
        {!setup ? (
          <div className="flex flex-col items-center gap-3 py-6"><Skeleton className="size-44" /><Skeleton className="h-4 w-48" /></div>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="grid items-center gap-5 sm:grid-cols-[auto_1fr]">
              <div className="mx-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"><QRCodeSVG value={setup.otpauth_url} size={156} /></div>
              <ol className="flex flex-col gap-2.5 text-[13px] text-slate-600">
                {['Open the app and tap + to add an account.', 'Choose “Scan a QR code” and scan this one.', 'Type the 6-digit code it shows below.'].map((t, i) => (
                  <li key={t} className="flex items-start gap-2.5">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-bold text-emerald-700">{i + 1}</span>{t}
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Can’t scan? Enter this key in the app:</div>
              <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2">
                <code className="min-w-0 flex-1 truncate text-xs">{setup.secret}</code>
                <Button variant="ghost" size="icon" className="size-7" aria-label="Copy key" onClick={() => navigator.clipboard?.writeText(setup.secret).then(() => toast.success('Key copied'))}><FiCopy /></Button>
              </div>
            </div>
            <OtpInput value={code} onChange={setCode} onComplete={confirm} disabled={busy} autoFocus={false} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => confirm()} disabled={busy || !setup || code.length !== 6}>{busy && <Spinner />} Verify and turn on</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const MethodCard = ({ art, icon: Icon, tone, title, text, on, detail, onEnable, onDisable, enableLabel }) => (
  <Card className={cn('gap-0 overflow-hidden py-0 transition-shadow hover:shadow-md', on && 'ring-1 ring-emerald-200')}>
    <div className={cn('flex justify-center py-4', on ? 'bg-gradient-to-b from-emerald-50 to-white' : 'bg-gradient-to-b from-slate-50 to-white')}>{art}</div>
    <div className="flex flex-1 flex-col gap-3 p-5 pt-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className={cn('flex size-9 items-center justify-center rounded-lg', tone)}><Icon size={17} /></span>
          <span className="font-bold">{title}</span>
        </div>
        {on ? <Badge variant="success"><FiCheckCircle /> On</Badge> : <Badge variant="muted">Off</Badge>}
      </div>
      <p className="text-[13px] text-muted-foreground">{text}</p>
      {detail && <p className="text-xs text-slate-500">{detail}</p>}
      <div className="mt-auto pt-1">
        {on
          ? <Button variant="outline" className="w-full border-rose-200 text-rose-700 hover:bg-rose-50" onClick={onDisable}>Turn off</Button>
          : <Button className="w-full" onClick={onEnable}>{enableLabel}</Button>}
      </div>
    </div>
  </Card>
);

const TwoStepSettings = ({ account, onChanged }) => {
  const [dialog, setDialog] = useState(null); // 'email' | 'app'
  const [codes, setCodes] = useState(null);
  const [passwordRequest, setPasswordRequest] = useState(null);
  const methods = account?.mfa_methods || [];
  const emailOn = methods.includes('email');
  const appOn = methods.includes('totp');

  const done = (recoveryCodes) => {
    setDialog(null);
    if (recoveryCodes?.length) setCodes(recoveryCodes);
    onChanged();
  };

  const turnOff = (method) => setPasswordRequest({
    title: method === 'email' ? 'Turn off email codes?' : 'Turn off the authenticator app?',
    description: 'Enter your password to confirm.',
    action: 'Turn off',
    destructive: true,
    run: async (password) => {
      await axiosClient.post('/auth/mfa/disable', { method, password });
      toast.success('Turned off');
      onChanged();
    },
  });

  const regenerate = () => setPasswordRequest({
    title: 'Create new recovery codes?',
    description: 'Your old recovery codes stop working. Enter your password to continue.',
    action: 'Create new codes',
    run: async (password) => {
      const res = await axiosClient.post('/auth/mfa/recovery-codes', { password });
      setCodes(res.data.recovery_codes);
      onChanged();
    },
  });

  if (!account) {
    return (
      <div className="max-w-6xl">
        <SettingsPageHeader section="two-step" />
        <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-72 rounded-xl" /><Skeleton className="h-72 rounded-xl" /></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <SettingsPageHeader section="two-step" />

      {/* Status */}
      <Card className={cn('mb-5 flex-row items-center gap-5 px-6 py-5', methods.length ? 'bg-gradient-to-r from-emerald-50 to-white' : 'bg-gradient-to-r from-red-50 to-white')}>
        <ShieldArt className="hidden h-24 w-auto shrink-0 sm:block" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-base font-extrabold">
            {methods.length ? <FiCheckCircle className="text-emerald-600" /> : <FiAlertTriangle className="text-red-600" />}
            Two-step verification is {methods.length ? 'on' : 'off'}
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {methods.length === 2
              ? 'Both methods are on. At each sign-in you choose: a code by email or a code from the app.'
              : methods.length === 1
                ? `At each sign-in you enter a code ${emailOn ? `sent to ${account.email}` : 'from your authenticator app'}. Add the other method as a backup.`
                : 'Turn on a method below. Admin accounts must use two-step verification.'}
          </p>
        </div>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <MethodCard
          art={<EmailCodeArt className="h-28 w-auto" />}
          icon={FiMail}
          tone="bg-blue-50 text-blue-600"
          title="Email code"
          text="A 6-digit code is emailed to you at each sign-in."
          detail={`Codes go to ${account.email}`}
          on={emailOn}
          enableLabel="Turn on email codes"
          onEnable={() => setDialog('email')}
          onDisable={() => turnOff('email')}
        />
        <MethodCard
          art={<AuthenticatorArt className="h-28 w-auto" />}
          icon={FiSmartphone}
          tone="bg-emerald-50 text-emerald-600"
          title="Authenticator app"
          text="Google Authenticator makes a new code every 30 seconds, even offline."
          detail="Recommended: works without email access."
          on={appOn}
          enableLabel="Set up authenticator app"
          onEnable={() => setDialog('app')}
          onDisable={() => turnOff('totp')}
        />
      </div>

      {methods.length > 0 && (
        <Card className="mt-5 flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><FiKey size={20} /></span>
          <div className="min-w-0 flex-1">
            <div className="font-bold">Recovery codes</div>
            <p className="text-[13px] text-muted-foreground">
              {account.recovery_codes_left || 0} of 10 left. Use one if you can’t get a code by email or app.
            </p>
          </div>
          <Button variant="outline" onClick={regenerate}><FiRefreshCw /> Create new codes</Button>
        </Card>
      )}

      <p className="mt-5 flex items-start gap-2 text-xs text-muted-foreground">
        <FiInfo className="mt-0.5 shrink-0" /> Admin accounts must keep at least one method on. To switch, turn the new one on first, then turn the old one off.
      </p>

      <EmailSetupDialog open={dialog === 'email'} email={account.email} onClose={() => setDialog(null)} onDone={done} />
      <AppSetupDialog open={dialog === 'app'} onClose={() => setDialog(null)} onDone={done} />
      <RecoveryCodesDialog codes={codes} onClose={() => setCodes(null)} />
      <PasswordDialog request={passwordRequest} onClose={() => setPasswordRequest(null)} />
    </div>
  );
};

export default TwoStepSettings;
