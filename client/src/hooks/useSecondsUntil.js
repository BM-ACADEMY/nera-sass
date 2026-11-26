import { useCallback, useSyncExternalStore } from 'react';
import { secondsUntil } from '../utils/otpTimer.js';

// Seconds left until `deadline` (ms), re-read twice a second while it is set.
export function useSecondsUntil(deadline) {
  const subscribe = useCallback((onChange) => {
    if (!deadline) return () => {};
    const timer = setInterval(onChange, 500);
    return () => clearInterval(timer);
  }, [deadline]);
  return useSyncExternalStore(subscribe, () => secondsUntil(deadline));
}
