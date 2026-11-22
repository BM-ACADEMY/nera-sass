import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle,
  AlertDialogDescription, AlertDialogCancel,
} from '@/components/ui/alert-dialog';

/**
 * Signing a device out (one, or all others): asks for the password again, and
 * a two-step code when that is on, before calling the server.
 *
 *   open          false, or { title, description, actionLabel }
 *   mfaMethods    any of 'totp', 'email', 'whatsapp' (from GET /account/sessions)
 *   submit(body)  the sign-out call with { password, method?, code? } or
 *                 { password, recovery_code }; resolves on success
 *   sendCode(password, channel)  POST /account/sessions/confirm-code for
 *                 'email' or 'whatsapp'; resolves with { sent_to }
 *   messageOf(err, fallback)  plain-language text for an error
 */
export default function ConfirmSignOutDialog({ open, onClose, mfaMethods = [], submit, sendCode, messageOf }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [method, setMethod] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState(null);
  const [error, setError] = useState(null);

  const methods = ['totp', 'email', 'whatsapp'].filter((m) => mfaMethods.includes(m));
  const needsCode = methods.length > 0;
  const choices = needsCode ? [...methods, 'recovery'] : [];
  const sends = method === 'email' || method === 'whatsapp';
  const LABELS = { totp: 'Code from your authenticator app', email: 'Code sent to your email', whatsapp: 'Code sent to your WhatsApp', recovery: 'One of your recovery codes' };
  const SWITCH = { totp: 'authenticator app', email: 'email code', whatsapp: 'WhatsApp code', recovery: 'recovery code' };

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setCode('');
    setMethod(methods[0] || null);
    setSentTo(null);
    setError(null);
  }, [open, mfaMethods.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const emailCode = async () => {
    if (!password) return setError('Enter your password first, then ask for a code.');
    setSending(true);
    setError(null);
    try {
      const res = await sendCode(password, method);
      setSentTo(res?.sent_to || (method === 'whatsapp' ? 'your WhatsApp' : 'your email'));
    } catch (err) {
      setError(messageOf(err, 'The code could not be sent. Try again in a minute.'));
    } finally {
      setSending(false);
    }
  };

  const confirm = async (e) => {
    e.preventDefault();
    if (!password) return setError('Enter your password to continue.');
    if (needsCode && !code.trim()) return setError('Enter your verification code to continue.');
    setBusy(true);
    setError(null);
    try {
      const proof = !needsCode ? {} : method === 'recovery' ? { recovery_code: code.trim() } : { method, code: code.trim() };
      await submit({ password, ...proof });
      onClose();
    } catch (err) {
      setError(messageOf(err, 'Could not sign out. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={Boolean(open)} onOpenChange={(next) => !next && !busy && onClose()}>
      <AlertDialogContent>
        <form onSubmit={confirm} className="grid gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>{open?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {open?.description} To confirm it is you, enter your password{needsCode ? ' and a verification code' : ''}.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="sign-out-password">Password</Label>
            <Input id="sign-out-password" type="password" autoComplete="current-password" autoFocus
              value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
          </div>

          {needsCode && (
            <div className="grid gap-2">
              <Label htmlFor="sign-out-code">{LABELS[method]}</Label>
              <div className="flex gap-2">
                <Input id="sign-out-code" inputMode={method === 'recovery' ? 'text' : 'numeric'} autoComplete="one-time-code" maxLength={11}
                  value={code} onChange={(e) => setCode(e.target.value)} disabled={busy} />
                {sends && (
                  <Button type="button" variant="outline" onClick={emailCode} disabled={sending || busy}>
                    {sending ? 'Sending…' : sentTo ? 'Send again' : method === 'whatsapp' ? 'Send me a code' : 'Email me a code'}
                  </Button>
                )}
              </div>
              {sends && sentTo && <p className="text-xs text-muted-foreground">Code sent to {sentTo}.</p>}
              <div className="flex flex-wrap gap-3">
                {choices.filter((m) => m !== method).map((m) => (
                  <button key={m} type="button" className="w-fit text-xs font-semibold text-blue-600 underline"
                    onClick={() => { setMethod(m); setCode(''); setSentTo(null); setError(null); }}>
                    Use {m === 'recovery' ? 'a' : 'my'} {SWITCH[m]} instead
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700" role="alert">{error}</p>}

          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={busy}>Cancel</AlertDialogCancel>
            {/* A plain submit button: AlertDialogAction would close the dialog before the check. */}
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy ? 'Signing out…' : open?.actionLabel || 'Sign out'}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
