// Countdown for one-time codes: how long the code on screen is still valid.
// The server says how many seconds are left; the browser keeps the end time,
// so the clock stays right after the tab was in the background. The server
// alone decides whether a code is accepted.

// End time (ms) of a code from a send or status answer, or 0 when there is no
// valid code. The sign-in step can end before the code does
// (step_expires_in), so the earlier of the two counts.
export function codeDeadline(info, now = Date.now()) {
  const code = Number(info?.expires_in) || 0;
  if (code <= 0) return 0;
  const step = info.step_expires_in == null ? code : Number(info.step_expires_in) || 0;
  return step > 0 ? now + Math.min(code, step) * 1000 : 0;
}

export const secondsUntil = (deadline, now = Date.now()) => (deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0);

// 600 -> "10:00", 65 -> "1:05".
export const formatClock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.max(0, Math.floor(seconds % 60))).padStart(2, '0')}`;

// The line about today's WhatsApp sign-in codes, or '' when unknown.
export function sendsLeftText(status) {
  if (status?.sends_left == null) return '';
  const limit = status.daily_limit || 3;
  if (status.sends_left <= 0) return `All ${limit} WhatsApp codes for today are used.`;
  return `${status.sends_left} of ${limit} WhatsApp codes left today.`;
}

export const sendsUsedUp = (status) => status?.sends_left != null && status.sends_left <= 0;
