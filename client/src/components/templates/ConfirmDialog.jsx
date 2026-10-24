import React, { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Spinner } from '@/components/ui/spinner';

// Confirmation for one action. `confirm` is null (closed) or
// { title, description, actionLabel, destructive, run }; run() may be async.
const ConfirmDialog = ({ confirm, onClose }) => {
  const [busy, setBusy] = useState(false);

  const handleConfirm = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await confirm.run();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={Boolean(confirm)} onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
          {confirm?.description && <AlertDialogDescription>{confirm.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={confirm?.destructive ? 'destructive' : 'default'} disabled={busy} onClick={handleConfirm}>
            {busy && <Spinner />} {confirm?.actionLabel || 'Confirm'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default ConfirmDialog;
