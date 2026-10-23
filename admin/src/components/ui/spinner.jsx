import * as React from 'react';
import { FiLoader } from 'react-icons/fi';
import { cn } from '@/lib/utils';

function Spinner({ className, ...props }) {
  return <FiLoader role="status" aria-label="Loading" className={cn('size-4 animate-spin', className)} {...props} />;
}

export { Spinner };
