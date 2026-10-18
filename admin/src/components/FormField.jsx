import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// Label + control + hint/error, the shape every admin form field shares.
export const FormField = ({ label, htmlFor, hint, error, className, children }) => (
  <div className={cn('flex flex-col gap-2', className)}>
    {label && <Label htmlFor={htmlFor} className="text-[12.5px] font-semibold">{label}</Label>}
    {children}
    {error ? (
      <p className="text-xs text-destructive">{error}</p>
    ) : hint ? (
      <p className="text-xs text-muted-foreground">{hint}</p>
    ) : null}
  </div>
);

// Input with a leading icon.
export const IconInput = ({ icon: Icon, className, ...props }) => (
  <div className="relative">
    {Icon && <Icon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />}
    <Input className={cn('h-10', Icon && 'pl-9', className)} {...props} />
  </div>
);

export default FormField;
