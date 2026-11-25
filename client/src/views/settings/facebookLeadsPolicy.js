// What Settings > Integrations shows for Facebook Lead Ads, from
// GET /api/facebook-leads/status. The server checks every change again.

// The status request failed with 404: the feature is switched off on this server.
export const isFeatureOff = (error) => error?.status === 404;

export function lastLeadText(value, now = new Date()) {
  if (!value) return 'No leads received yet';
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return 'No leads received yet';
  const minutes = Math.round((now.getTime() - at.getTime()) / 60000);
  if (minutes < 1) return 'Last lead just now';
  if (minutes < 60) return `Last lead ${minutes} min ago`;
  if (minutes < 24 * 60) return `Last lead ${Math.round(minutes / 60)} h ago`;
  return `Last lead on ${at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export function pageBadge(page) {
  if (page?.status === 'error') return { variant: 'danger', label: 'Needs attention' };
  if (page?.subscribed) return { variant: 'success', label: 'Receiving leads' };
  return { variant: 'warning', label: 'Not subscribed' };
}

// The overall state of the Facebook card.
export function facebookState(status) {
  if (!status) return 'loading';
  if (!status.configured) return 'not-configured';
  if (status.pending?.pages?.length) return 'choosing';
  if (status.pages?.length) return 'connected';
  return 'not-connected';
}

