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

// Popular Android model codes (region letters stripped, so SM-S918B and
// SM-S918E both match SM-S918). Anything else shows its model code.
const MODEL_NAMES = {
  'SM-S928': 'Samsung Galaxy S24 Ultra',
  'SM-S926': 'Samsung Galaxy S24+',
  'SM-S921': 'Samsung Galaxy S24',
  'SM-S918': 'Samsung Galaxy S23 Ultra',
  'SM-S916': 'Samsung Galaxy S23+',
  'SM-S911': 'Samsung Galaxy S23',
  'SM-S908': 'Samsung Galaxy S22 Ultra',
  'SM-S901': 'Samsung Galaxy S22',
  'SM-A556': 'Samsung Galaxy A55',
  'SM-A546': 'Samsung Galaxy A54',
  'SM-A356': 'Samsung Galaxy A35',
  'SM-A346': 'Samsung Galaxy A34',
  'SM-A155': 'Samsung Galaxy A15',
  'SM-M346': 'Samsung Galaxy M34',
  'SM-F946': 'Samsung Galaxy Z Fold5',
  'SM-F731': 'Samsung Galaxy Z Flip5',
  CPH2581: 'OnePlus 12',
  CPH2449: 'OnePlus 11',
  CPH2467: 'OnePlus Nord CE 3 Lite',
  '2201117TI': 'Redmi Note 11',
  '23021RAAEG': 'Redmi Note 12',
};

// "Samsung Galaxy S23 Ultra", "Samsung SM-X123", "Google Pixel 8", or the code itself.
export function modelName(model) {
  const code = String(model || '').trim();
  if (!code) return null;
  const upper = code.toUpperCase();
  const samsung = /^(SM-[A-Z]\d{3})/.exec(upper);
  if (samsung) return MODEL_NAMES[samsung[1]] || `Samsung ${code}`;
  if (MODEL_NAMES[upper]) return MODEL_NAMES[upper];
  if (/^Pixel(\s|$)/i.test(code)) return `Google ${code}`;
  return code;
}

// "Windows 11" (platformVersion 13 and up), "Windows 10", "Android 14", "macOS 14".
export function platformLabel(platform, version) {
  const name = String(platform || '').trim();
  if (!name) return null;
  const major = Number(String(version || '').split('.')[0]);
  const hasMajor = Number.isFinite(major) && String(version || '').trim() !== '';
  if (/^windows$/i.test(name)) {
    if (!hasMajor) return 'Windows';
    if (major >= 13) return 'Windows 11';
    if (major >= 1) return 'Windows 10';
    return 'Windows';
  }
  if (/^chrome ?os$/i.test(name)) return 'ChromeOS';
  if (/^(android|macos)$/i.test(name) && hasMajor && major > 0) return `${name} ${major}`;
  return name;
}

// What the device is, from the app's client hints when it sent them:
// "Samsung Galaxy S23 Ultra · Android 14 · Chrome 158", "Windows 11 · Chrome 157".
// Without hints: "iPhone · Safari 17" for iOS, else as before ("Chrome 131 on Windows").
export function deviceLabel(session) {
  const browser = session?.browser || 'Unknown browser';
  const model = modelName(session?.model);
  const platform = platformLabel(session?.platform, session?.platform_version);
  if (model || platform) return [model, platform || session?.os, session?.browser].filter(Boolean).join(' · ');
  if (session?.os === 'iOS') return `iPhone · ${browser}`;
  if (session?.os === 'iPadOS') return `iPad · ${browser}`;
  return session?.os ? `${browser} on ${session.os}` : browser;
}

// The user's own name for the device when they gave one, else the device label.
export const sessionTitle = (session) => (session?.name ? session.name : deviceLabel(session));

// Collects User-Agent Client Hints (Chromium browsers only) for the server
// to show a real device name. Resolves null when the browser has none.
export async function collectClientHints(nav = globalThis.navigator) {
  const uaData = nav?.userAgentData;
  if (!uaData || typeof uaData.getHighEntropyValues !== 'function') return null;
  try {
    let timer;
    const values = await Promise.race([
      uaData.getHighEntropyValues(['model', 'platform', 'platformVersion', 'fullVersionList']),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), 1000); }),
    ]).finally(() => clearTimeout(timer));
    if (!values) return null;
    return { model: values.model || '', platform: values.platform || uaData.platform || '', platformVersion: values.platformVersion || '' };
  } catch {
    return null;
  }
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
