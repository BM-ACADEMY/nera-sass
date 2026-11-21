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
 *   mfaMethods    ['totp'] / ['email'] / both / [] (from GET /account/sessions)
 *   submit(body)  the sign-out call with { password, method?, code? }; resolves on success
 *   sendCode(password)  POST /account/sessions/confirm-code; resolves with { sent_to }
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

  const hasTotp = mfaMethods.includes('totp');
  const hasEmail = mfaMethods.includes('email');
  const needsCode = hasTotp || hasEmail;

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setCode('');
    setMethod(hasTotp ? 'totp' : hasEmail ? 'email' : null);
    setSentTo(null);
    setError(null);
  }, [open, hasTotp, hasEmail]);

  const emailCode = async () => {
    if (!password) return setError('Enter your password first, then ask for a code.');
    setSending(true);
    setError(null);
    try {
      const res = await sendCode(password);
      setSentTo(res?.sent_to || 'your email');
    } catch (err) {
      setError(messageOf(err, 'The code could not be emailed. Try again in a minute.'));
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
      await submit({ password, ...(needsCode ? { method, code: code.trim() } : {}) });
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
              <Label htmlFor="sign-out-code">
                {method === 'totp' ? 'Code from your authenticator app' : 'Code sent to your email'}
              </Label>
              <div className="flex gap-2">
                <Input id="sign-out-code" inputMode="numeric" autoComplete="one-time-code" maxLength={11}
                  value={code} onChange={(e) => setCode(e.target.value)} disabled={busy} />
                {method === 'email' && (
                  <Button type="button" variant="outline" onClick={emailCode} disabled={sending || busy}>
                    {sending ? 'Sending…' : sentTo ? 'Send again' : 'Email me a code'}
                  </Button>
                )}
              </div>
              {method === 'email' && sentTo && <p className="text-xs text-muted-foreground">Code sent to {sentTo}.</p>}
              {hasTotp && hasEmail && (
                <button type="button" className="w-fit text-xs font-semibold text-blue-600 underline"
                  onClick={() => { setMethod(method === 'totp' ? 'email' : 'totp'); setCode(''); setError(null); }}>
                  {method === 'totp' ? 'Use a code by email instead' : 'Use my authenticator app instead'}
                </button>
              )}
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
