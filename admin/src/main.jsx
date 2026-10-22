import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { Toaster } from '@/components/ui/sonner';
import './style.css';

// The admin panel ships no service worker. Remove any left on this origin by
// another app that once ran on the same localhost port, so it can't intercept
// navigation.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <Toaster />
  </React.StrictMode>
);
