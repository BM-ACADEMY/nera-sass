// Turns a raw user-agent string into a friendly label like "Windows · Chrome".
// Works on old sessions that only stored the raw UA. No dependencies.
export function parseDevice(ua) {
  const s = String(ua || '');
  if (!s) return { os: 'Unknown device', browser: '', mobile: false, label: 'Unknown device' };

  let os = 'Unknown';
  let mobile = false;
  if (/iPhone|iPod/i.test(s)) { os = 'iPhone'; mobile = true; }
  else if (/iPad/i.test(s)) { os = 'iPad'; mobile = true; }
  else if (/Android/i.test(s)) { os = 'Android'; mobile = true; }
  else if (/Windows/i.test(s)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(s)) os = 'Mac';
  else if (/CrOS/i.test(s)) os = 'Chromebook';
  else if (/Linux|X11/i.test(s)) os = 'Linux';

  let browser = '';
  if (/Edg(e|A|iOS)?\//.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(s)) browser = 'Opera';
  else if (/SamsungBrowser/.test(s)) browser = 'Samsung Internet';
  else if (/Firefox\/|FxiOS/.test(s)) browser = 'Firefox';
  else if (/Chrome\/|CriOS/.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s)) browser = 'Safari';
  else if (/curl|node|axios|postman/i.test(s)) browser = 'API client';

  const label = [os, browser].filter(Boolean).join(' · ');
  return { os, browser, mobile, label };
}
