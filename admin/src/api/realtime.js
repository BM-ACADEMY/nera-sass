import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

// Live updates from the API: the server emits "admin:changed" to signed-in
// staff whenever something audited happens (a workspace created or suspended,
// a number assigned, a login added or deactivated...). Views subscribe and
// reload their data. One shared socket for the whole admin panel.

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3600/api').replace(/\/api\/?$/, '');

let socket = null;
const changeListeners = new Set();
const statusListeners = new Set();

function setStatus(connected) {
  statusListeners.forEach((fn) => fn(connected));
}

function ensureSocket() {
  const token = localStorage.getItem('adminToken');
  if (!token) return null;
  if (socket) return socket;
  socket = io(API_BASE, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnectionDelay: 2000,
    reconnectionDelayMax: 15000,
  });
  socket.on('connect', () => setStatus(true));
  socket.on('disconnect', () => setStatus(false));
  socket.on('connect_error', () => setStatus(false));
  socket.on('admin:changed', (payload) => changeListeners.forEach((fn) => fn(payload)));
  return socket;
}

// Calls handler for every occurrence of a server event while mounted.
export function useLiveEvent(event, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const s = ensureSocket();
    if (!s) return undefined;
    const listener = (payload) => ref.current?.(payload);
    s.on(event, listener);
    return () => s.off(event, listener);
  }, [event]);
}

export function disconnectRealtime() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  setStatus(false);
}

// Calls onChange (debounced) when the server reports a change, and when the
// admin comes back to this browser tab, so the view never shows stale data.
export function useLiveRefresh(onChange, { delay = 600 } = {}) {
  const handler = useRef(onChange);
  handler.current = onChange;

  useEffect(() => {
    ensureSocket();
    let timer = null;
    const trigger = (payload) => {
      clearTimeout(timer);
      timer = setTimeout(() => handler.current?.(payload), delay);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') trigger({ event: 'TAB_FOCUSED' });
    };
    changeListeners.add(trigger);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      changeListeners.delete(trigger);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [delay]);
}

// Whether the live connection is up, for the "Live" indicator.
export function useLiveStatus() {
  const [connected, setConnected] = useState(Boolean(socket?.connected));
  useEffect(() => {
    ensureSocket();
    statusListeners.add(setConnected);
    setConnected(Boolean(socket?.connected));
    return () => statusListeners.delete(setConnected);
  }, []);
  return connected;
}
