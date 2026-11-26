import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { QRCodeSVG } from 'qrcode.react';
import { FiKey, FiCopy, FiDownload, FiRefreshCw, FiCheckCircle, FiAlertTriangle, FiInfo, FiStar } from 'react-icons/fi';
import axiosClient from '../../api/axiosClient';
import { SettingsPageHeader } from './SettingsPageHeader';
import OtpInput from '../security/OtpInput';
import PasswordInput from '../security/PasswordInput';
import { EmailCodeArt, ShieldArt } from '../security/Art';
import { MethodTile, METHOD_META } from '../security/MfaBrandIcons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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

// Confirms it is really the account owner before any two-step change (turning
// a method on or off, new recovery codes): the current password and, when
// two-step verification is already on, a current code from the app, by email
// WhatsApp or a recovery code. request.run gets the proof to send with the
// request (with request.needsPhone, also the WhatsApp number to verify).
const ConfirmIdentityDialog = ({ request, methods, hasMfa, onClose }) => {
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [method, setMethod] = useState('totp'); // 'totp' | 'email' | 'whatsapp' | 'recovery'
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [wait, setWait] = useState(0);
  useEffect(() => {
    setPassword('');
    setPhone('');
    setCode('');
    setSentTo('');
    setMethod(methods.includes('totp') ? 'totp' : methods[0] || 'recovery');
  }, [request]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const choose = (m) => { setMethod(m); setCode(''); setSentTo(''); };
  const sendCode = async () => {
    setSending(true);
    try {
      const res = await axiosClient.post(`/auth/mfa/reauth/${method}/send`, {});
      setSentTo(res.data.sent_to);
      setWait(res.data.resend_after || 45);
      toast.success(`Code sent to ${res.data.sent_to}`);
    } catch (err) {
      toast.error(errorOf(err, 'The code could not be sent'));
    } finally {
      setSending(false);
    }
  };

  const proof = () => {
    const extra = request?.needsPhone ? { phone } : {};
    if (!hasMfa) return { password, ...extra };
    if (method === 'recovery') return { password, recovery_code: code.trim(), ...extra };
    return { password, code_method: method, code, ...extra };
  };
  const ready = password && (!request?.needsPhone || phone.replace(/\D/g, '').length >= 10)
    && (!hasMfa || (method === 'recovery' ? code.trim().length >= 6 : code.length === 6));
  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      await request.run(proof());
      onClose();
    } catch (err) {
      if (method !== 'recovery') setCode('');
      toast.error(errorOf(err, 'Something went wrong'));
    } finally {
      setBusy(false);
    }
  };
  const tab = (m, label) => (
    <button type="button" key={m} onClick={() => choose(m)} disabled={busy}
      className={cn('cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold', method === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
      {label}
    </button>
  );
  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{request?.title}</DialogTitle>
            <DialogDescription>
              {request?.description} {hasMfa ? 'Enter your password and a current verification code.' : 'Enter your password to continue.'}
            </DialogDescription>
          </DialogHeader>
          {request?.needsPhone && (
            <div className="flex flex-col gap-1.5">
              <Input type="tel" autoComplete="tel" placeholder="WhatsApp number, e.g. +91 98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-10" />
              <span className="text-xs text-muted-foreground">With the country code. We send a code to it to check it is yours.</span>
            </div>
          )}
          <PasswordInput autoFocus placeholder="Your password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {hasMfa && (
            <div className="flex flex-col gap-3">
              <div className="flex w-fit gap-1 rounded-lg bg-slate-100 p-1">
                {methods.includes('totp') && tab('totp', 'App')}
                {methods.includes('email') && tab('email', 'Email')}
                {methods.includes('whatsapp') && tab('whatsapp', 'WhatsApp')}
                {tab('recovery', 'Recovery code')}
              </div>
              {method === 'recovery' ? (
                <Input placeholder="Recovery code" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} className="h-10 font-mono" />
              ) : (
                <>
                  {(method === 'email' || method === 'whatsapp') && (
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{sentTo ? `Code sent to ${sentTo}` : `We will send you a 6-digit code by ${method === 'email' ? 'email' : 'WhatsApp'}.`}</span>
                      <Button type="button" variant="outline" size="sm" onClick={sendCode} disabled={sending || wait > 0 || busy}>
                        {sending && <Spinner />} {wait > 0 ? `Resend in ${wait}s` : sentTo ? 'Resend' : 'Send me a code'}
                      </Button>
                    </div>
                  )}
                  <OtpInput value={code} onChange={setCode} disabled={busy} autoFocus={false} />
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" variant={request?.destructive ? 'destructive' : 'default'} disabled={busy || !ready}>{busy && <Spinner />} {request?.action}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

// Turning on email or WhatsApp codes (start.channel): the first code was sent
// when the identity was confirmed (start.sent); enter it. A resend needs the
// password again (and, with two-step already on, a fresh current code), so it
// goes back to that step (onRestart) unless the password alone is enough.
const CodeSetupDialog = ({ start, onClose, onDone, onRestart }) => {
  const channel = start?.channel || 'email';
  const open = Boolean(start);
  const [sent, setSent] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (!start) return;
    setSent(start.sent);
    setCode('');
    setWait(start.sent?.resend_after || 45);
  }, [start]);
  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async () => {
    if (start.needsCode) { onRestart(); return; }
    setBusy(true);
    try {
      const res = await axiosClient.post(`/auth/mfa/${channel}/setup`, { password: start.password, ...(channel === 'whatsapp' ? { phone: start.phone } : {}) });
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
      const res = await axiosClient.post(`/auth/mfa/${channel}/setup/confirm`, { code: value, password: start.password });
      keepToken(res.data);
      toast.success(channel === 'whatsapp' ? 'WhatsApp verification is on' : 'Email verification is on');
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
        <div className="flex justify-center">{channel === 'whatsapp' ? <MethodTile method="whatsapp" size={72} /> : <EmailCodeArt className="h-28 w-auto" />}</div>
        <DialogHeader className="text-center sm:text-center">
          <DialogTitle>{channel === 'whatsapp' ? 'Turn on WhatsApp codes' : 'Turn on email codes'}</DialogTitle>
          <DialogDescription>
            {sent ? `Enter the 6-digit code we sent to ${sent.sent_to}. At each sign-in you'll get a new one.` : 'Sending the code…'}
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
          <Button onClick={() => confirm()} disabled={busy || !sent || code.length !== 6}>{busy && <Spinner />} Verify and turn on</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// Setting up the authenticator app: QR code, key, then a code from the app.
// The setup was started when the identity was confirmed (start.setup).
const AppSetupDialog = ({ start, onClose, onDone }) => {
  const open = Boolean(start);
  const setup = start?.setup;
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setCode(''); }, [start]);

  const confirm = async (value = code) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await axiosClient.post('/auth/mfa/setup/confirm', { code: value, password: start.password });
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
          <DialogTitle className="flex items-center gap-2"><MethodTile method="totp" size={28} /> Set up the authenticator app</DialogTitle>
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

// One method: brand icon tile, status (On / Off / Not available), Default
// badge, and Set up / Turn off / Make default.
const MethodCard = ({ method, text, detail, on, unavailable, isDefault, canDefault, onEnable, onDisable, onDefault }) => (
  <Card className={cn('gap-3 p-5 transition-shadow hover:shadow-md', on && 'ring-1 ring-emerald-200')}>
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-center gap-3">
        <MethodTile method={method} size={44} />
        <div>
          <div className="font-bold">{METHOD_META[method].title}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {on ? <Badge variant="success"><FiCheckCircle /> On</Badge> : unavailable ? <Badge variant="warning">Not available yet</Badge> : <Badge variant="muted">Off</Badge>}
            {isDefault && <Badge variant="info"><FiStar /> Default</Badge>}
          </div>
        </div>
      </div>
    </div>
    <p className="text-[13px] text-muted-foreground">{text}</p>
    {detail && <p className="text-xs text-slate-500">{detail}</p>}
    <div className="mt-auto flex flex-col gap-2 pt-1">
      {on
        ? <Button variant="outline" className="w-full border-rose-200 text-rose-700 hover:bg-rose-50" onClick={onDisable}>Turn off</Button>
        : <Button className="w-full" onClick={onEnable} disabled={unavailable}>Set up</Button>}
      {on && canDefault && !isDefault && <Button variant="ghost" size="sm" className="w-full" onClick={onDefault}><FiStar /> Make default</Button>}
    </div>
  </Card>
);

const TwoStepSettings = ({ account, onChanged }) => {
  const [codeStart, setCodeStart] = useState(null); // { channel, sent, password, phone, needsCode }
  const [appStart, setAppStart] = useState(null); // { setup, password }
  const [codes, setCodes] = useState(null);
  const [passwordRequest, setPasswordRequest] = useState(null);
  const methods = account?.mfa_methods || []; // usable now
  const enrolled = account?.mfa_methods_enrolled || methods;
  const hasMfa = Boolean(account?.mfa_enabled);
  const defaultMethod = account?.mfa_default_method || null;
  const waAvailable = Boolean(account?.whatsapp_otp_available);
  // Email / WhatsApp cards only while the server allows new ones
  // (MFA_EXTRA_METHODS_ENABLED), or when this account already has them on.
  const extraMethods = account?.mfa_extra_methods_enabled === true;
  const shown = (method) => method === 'totp' || extraMethods || enrolled.includes(method);

  const done = (recoveryCodes) => {
    setCodeStart(null);
    setAppStart(null);
    if (recoveryCodes?.length) setCodes(recoveryCodes);
    onChanged();
  };

  // Turning a method on starts the setup with the proof; the setup dialog
  // then needs only the password again to finish.
  const turnOnEmail = () => setPasswordRequest({
    title: 'Turn on email codes',
    description: `A 6-digit code will be sent to ${account.email}.`,
    action: 'Send code',
    run: async (proof) => {
      const res = await axiosClient.post('/auth/mfa/email/setup', proof);
      toast.success(`Code sent to ${res.data.sent_to}`);
      setCodeStart({ channel: 'email', sent: res.data, password: proof.password, needsCode: hasMfa });
    },
  });

  const turnOnWhatsapp = () => setPasswordRequest({
    title: 'Turn on WhatsApp codes',
    description: 'Enter your WhatsApp number; a 6-digit code is sent to it.',
    action: 'Send code',
    needsPhone: true,
    run: async (proof) => {
      const res = await axiosClient.post('/auth/mfa/whatsapp/setup', proof);
      toast.success(`Code sent to ${res.data.sent_to}`);
      setCodeStart({ channel: 'whatsapp', sent: res.data, password: proof.password, phone: proof.phone, needsCode: hasMfa });
    },
  });

  const makeDefault = async (method) => {
    try {
      await axiosClient.post('/auth/mfa/default', { method });
      toast.success(`${METHOD_META[method].title} is now your default`);
      onChanged();
    } catch (err) {
      toast.error(errorOf(err, 'Could not change the default'));
    }
  };

  const turnOnApp = () => setPasswordRequest({
    title: 'Set up the authenticator app',
    description: 'First confirm it is you.',
    action: 'Continue',
    run: async (proof) => {
      const res = await axiosClient.post('/auth/mfa/setup', proof);
      setAppStart({ setup: res.data, password: proof.password });
    },
  });

  const turnOff = (method) => setPasswordRequest({
    title: `Turn off ${METHOD_META[method].title.toLowerCase()}?`,
    description: 'Confirm it is you.',
    action: 'Turn off',
    destructive: true,
    run: async (proof) => {
      await axiosClient.post('/auth/mfa/disable', { ...proof, method });
      toast.success('Turned off');
      onChanged();
    },
  });

  const regenerate = () => setPasswordRequest({
    title: 'Create new recovery codes?',
    description: 'Your old recovery codes stop working.',
    action: 'Create new codes',
    run: async (proof) => {
      const res = await axiosClient.post('/auth/mfa/recovery-codes', proof);
      setCodes(res.data.recovery_codes);
      onChanged();
    },
  });

  if (!account) {
    return (
      <div className="max-w-6xl">
        <SettingsPageHeader section="two-step" />
        <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-60 rounded-xl" /><Skeleton className="h-60 rounded-xl" /><Skeleton className="h-60 rounded-xl" /></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <SettingsPageHeader section="two-step" />

      {/* Status */}
      <Card className={cn('mb-5 flex-row items-center gap-5 px-6 py-5', hasMfa ? 'bg-gradient-to-r from-emerald-50 to-white' : 'bg-gradient-to-r from-red-50 to-white')}>
        <ShieldArt className="hidden h-24 w-auto shrink-0 sm:block" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-base font-extrabold">
            {hasMfa ? <FiCheckCircle className="text-emerald-600" /> : <FiAlertTriangle className="text-red-600" />}
            Two-step verification is {hasMfa ? 'on' : 'off'}
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {hasMfa
              ? `At each sign-in you get a code from your default method${defaultMethod ? ` (${METHOD_META[defaultMethod].title.toLowerCase()})` : ''} and can switch to another method that is on.`
              : 'Turn on a method below. Admin accounts must use two-step verification.'}
          </p>
        </div>
      </Card>

      <div className="grid gap-5 md:grid-cols-3">
        {[
          { method: 'totp', text: 'Google Authenticator makes a new code every 30 seconds, even offline.', detail: 'Recommended: works without email or phone signal.', onEnable: turnOnApp },
          { method: 'email', text: 'A 6-digit code is emailed to you at each sign-in.', detail: `Codes go to ${account.email}`, onEnable: turnOnEmail },
          {
            method: 'whatsapp',
            text: 'A 6-digit code is sent to your WhatsApp at each sign-in.',
            detail: account.mfa_whatsapp_number ? `Codes go to ${account.mfa_whatsapp_number}` : waAvailable ? 'Your number is verified with a code first.' : 'Coming soon: waiting for WhatsApp to approve the code message.',
            onEnable: turnOnWhatsapp,
          },
        ].filter((card) => shown(card.method)).map((card) => (
          <MethodCard
            key={card.method}
            method={card.method}
            text={card.text}
            detail={card.detail}
            on={enrolled.includes(card.method)}
            unavailable={card.method === 'whatsapp' && !waAvailable}
            isDefault={enrolled.includes(card.method) && defaultMethod === card.method}
            canDefault={methods.includes(card.method)}
            onEnable={card.onEnable}
            onDisable={() => turnOff(card.method)}
            onDefault={() => makeDefault(card.method)}
          />
        ))}
      </div>

      {hasMfa && (
        <Card className="mt-5 flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><FiKey size={20} /></span>
          <div className="min-w-0 flex-1">
            <div className="font-bold">Recovery codes</div>
            <p className="text-[13px] text-muted-foreground">
              {account.recovery_codes_left || 0} of 10 left. Use one if you can’t get a code from any method.
            </p>
          </div>
          <Button variant="outline" onClick={regenerate}><FiRefreshCw /> Create new codes</Button>
        </Card>
      )}

      <p className="mt-5 flex items-start gap-2 text-xs text-muted-foreground">
        <FiInfo className="mt-0.5 shrink-0" /> Admin accounts must keep at least one method on. To switch, turn the new one on first, then turn the old one off.
      </p>

      <CodeSetupDialog start={codeStart} onClose={() => setCodeStart(null)} onDone={done} onRestart={() => { const ch = codeStart?.channel; setCodeStart(null); if (ch === 'whatsapp') turnOnWhatsapp(); else turnOnEmail(); }} />
      <AppSetupDialog start={appStart} onClose={() => setAppStart(null)} onDone={done} />
      <RecoveryCodesDialog codes={codes} onClose={() => setCodes(null)} />
      <ConfirmIdentityDialog request={passwordRequest} methods={methods} hasMfa={hasMfa} onClose={() => setPasswordRequest(null)} />
    </div>
  );
};

export default TwoStepSettings;
