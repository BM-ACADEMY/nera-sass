import * as React from 'react';
import { Toaster as Sonner } from 'sonner';

function Toaster(props) {
  return <Sonner theme="light" position="top-center" richColors closeButton {...props} />;
}

export { Toaster };
