import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle,
  AlertDialogDescription, AlertDialogCancel,
} from '@/components/ui/alert-dialog';

const ErrorLine = ({ text }) => (text ? <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700" role="alert">{text}</p> : null);

/** Adds another brand on this WhatsApp number. save(name) resolves on success.
 * The page remounts it (key) each time it opens, so it starts empty. */
export function AddBrandDialog({ open, onClose, save }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (name.trim().length < 2) return setError('Type the brand name');
    setBusy(true);
    setError('');
    try {
      await save(name.trim());
      onClose();
    } catch (err) {
      setError(err.message || 'Could not add this brand');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <AlertDialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>Add a brand</AlertDialogTitle>
            <AlertDialogDescription>
              Another brand that answers on this WhatsApp number gets its own brain. It starts with AI replies off.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="brand-name">Brand name</Label>
            <Input id="brand-name" autoFocus maxLength={80} value={name} placeholder="BM Academy" onChange={(e) => setName(e.target.value)} disabled={busy} />
          </div>
          <ErrorLine text={error} />
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={busy}>Cancel</AlertDialogCancel>
            <Button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add brand'}</Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Removes a brand with its brain and knowledge, after the Owner types their password. */
export function DeleteBrandDialog({ brand, onClose, remove }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!password) return setError('Enter your password to continue.');
    setBusy(true);
    setError('');
    try {
      await remove(brand, password);
      onClose();
    } catch (err) {
      setError(err.message || 'Could not remove this brand');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={Boolean(brand)} onOpenChange={(next) => !next && !busy && onClose()}>
      <AlertDialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {brand?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its brain and all its knowledge are deleted and cannot be brought back. Its chats go back to the other brands or your team.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="brand-delete-password">Your password</Label>
            <Input id="brand-delete-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
          </div>
          <ErrorLine text={error} />
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={busy}>Cancel</AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={busy}>{busy ? 'Removing…' : 'Remove brand'}</Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
