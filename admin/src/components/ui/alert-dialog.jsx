import * as React from 'react';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

function AlertDialog(props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogTrigger(props) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />;
}

function AlertDialogContent({ className, ...props }) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-border bg-background p-6 shadow-lg outline-none',
          className
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

function AlertDialogHeader({ className, ...props }) {
  return <div data-slot="alert-dialog-header" className={cn('flex flex-col gap-2 text-left', className)} {...props} />;
}

function AlertDialogFooter({ className, ...props }) {
  return <div data-slot="alert-dialog-footer" className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}

function AlertDialogTitle({ className, ...props }) {
  return <AlertDialogPrimitive.Title data-slot="alert-dialog-title" className={cn('text-lg font-semibold', className)} {...props} />;
}

function AlertDialogDescription({ className, ...props }) {
  return <AlertDialogPrimitive.Description data-slot="alert-dialog-description" className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

function AlertDialogAction({ className, variant = 'default', ...props }) {
  return <AlertDialogPrimitive.Action className={cn(buttonVariants({ variant }), className)} {...props} />;
}

function AlertDialogCancel({ className, ...props }) {
  return <AlertDialogPrimitive.Cancel className={cn(buttonVariants({ variant: 'outline' }), className)} {...props} />;
}

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
