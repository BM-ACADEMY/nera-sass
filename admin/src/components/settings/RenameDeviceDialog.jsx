import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle,
  AlertDialogDescription, AlertDialogCancel,
} from '@/components/ui/alert-dialog';

export const MAX_DEVICE_NAME = 40;

/**
 * Names one of the user's signed-in devices ("Aakash's laptop"). An empty
 * name goes back to the automatic device label.
 *
 *   session     the session being named (null = closed)
 *   label       its automatic device label, shown as a hint
 *   save(name)  resolves on success
 *   messageOf(err, fallback)  plain-language text for an error
 */
export default function RenameDeviceDialog({ session, label, onClose, save, messageOf }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!session) return;
    setName(session.name || '');
    setError(null);
  }, [session]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await save(name.trim());
      onClose();
    } catch (err) {
      setError(messageOf(err, 'Could not save the name. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={Boolean(session)} onOpenChange={(next) => !next && !busy && onClose()}>
      <AlertDialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>Name this device</AlertDialogTitle>
            <AlertDialogDescription>
              A name you will recognise, like &quot;Office laptop&quot;. Leave it empty to show &quot;{label}&quot;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="device-name">Device name</Label>
            <Input id="device-name" autoFocus maxLength={MAX_DEVICE_NAME} value={name} placeholder={label}
              onChange={(e) => setName(e.target.value)} disabled={busy} />
            <p className="text-xs text-muted-foreground">{name.length}/{MAX_DEVICE_NAME}</p>
          </div>
          {error && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700" role="alert">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={busy}>Cancel</AlertDialogCancel>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
