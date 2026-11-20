// Display helpers for "My sessions" (signed-in devices). Pure functions, no
// React, so they are unit-tested with node --test.

const UNITS = [
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

// "just now", "2 min ago", "3 hours ago", "5 days ago".
export function timeAgo(value, now = Date.now()) {
  if (!value) return 'unknown';
  const seconds = Math.max(0, (now - new Date(value).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return 'unknown';
  if (seconds < 60) return 'just now';
  for (const [unit, size] of UNITS) {
    if (seconds >= size) {
      const n = Math.floor(seconds / size);
      if (unit === 'minute') return `${n} min ago`;
      return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
    }
  }
  return 'just now';
}

export function shortDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// "Chennai, TN, India" / "Local network" / "Unknown location".
export function locationLabel(location) {
  if (!location) return 'Unknown location';
  if (location.private) return 'Local network';
  const parts = [location.city, location.region, location.country].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Unknown location';
}

// "Chrome 131 on Windows".
export function deviceLabel(session) {
  const browser = session?.browser || 'Unknown browser';
  return session?.os ? `${browser} on ${session.os}` : browser;
}

export const deviceKind = (session) => (['desktop', 'mobile', 'tablet'].includes(session?.device_type) ? session.device_type : 'unknown');

// Friendly text for a failed sessions call.
export function sessionsError(error, fallback) {
  if (error?.code === 'CURRENT_SESSION') return 'This is the device you are using. Use Log out instead.';
  if (error?.code === 'SESSION_NOT_FOUND' || error?.status === 404) return 'That session has already ended.';
  if (error?.status === 429) return 'Too many attempts. Wait a few minutes and try again.';
  if (error?.status === 0 || error?.code === 'API_UNREACHABLE') return 'Cannot reach the server. Check your connection and try again.';
  return fallback;
}
