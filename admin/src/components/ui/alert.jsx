import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-border bg-card text-card-foreground',
        destructive: 'border-red-200 bg-red-50 text-red-700',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

function Alert({ className, variant, ...props }) {
  return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({ className, ...props }) {
  return <div data-slot="alert-title" className={cn('font-semibold', className)} {...props} />;
}

function AlertDescription({ className, ...props }) {
  return <div data-slot="alert-description" className={cn('text-sm opacity-90', className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription };
