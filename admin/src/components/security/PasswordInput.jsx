import React, { useState } from 'react';
import { FiEye, FiEyeOff, FiLock } from 'react-icons/fi';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// Password field with a lock icon and a show/hide (eye) button.
const PasswordInput = ({ className, icon = true, ...props }) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      {icon && <FiLock className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />}
      <Input type={visible ? 'text' : 'password'} className={cn('h-10 pr-10', icon && 'pl-9', className)} {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
        tabIndex={-1}
      >
        {visible ? <FiEyeOff /> : <FiEye />}
      </button>
    </div>
  );
};

export default PasswordInput;
