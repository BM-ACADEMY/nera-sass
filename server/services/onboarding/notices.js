/**
 * The Notices box at the top of the customer's Home screen: everything that
 * needs the customer's attention, most urgent first. Pure function over what
 * index.js reads. Plan and trial wording comes from the existing N3
 * subscription and AI allowance state; nothing here writes billing data.
 *
 * Customers never see raw errors: a failed WhatsApp verification is reported
 * as "our team is looking at it", never as Meta's own message.
 */
const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };
const EXPIRY_WARNING_DAYS = 7;

const notice = (id, severity, title, message, action = null) => ({ id, severity, title, message, action });
const goto = (label, path) => ({ label, path });
const names = (list) => list.slice(0, 3).join(', ') + (list.length > 3 ? ` and ${list.length - 3} more` : '');

/**
 * input = {
 *   brand, templates (presentTemplate rows), numberState, live,
 *   subscription (billing publicSubscription or null), subscriptionRow, planRequired,
 *   aiGate (billing aiAllowance.check), brain: { enabled, missing, configured },
 *   alerts: recent billing_alerts rows, now
 * }
 */
function buildNotices(input) {
  const now = input.now || new Date();
  const out = [];
  const { brand, templates = [], numberState, subscription, aiGate, brain } = input;

  // WhatsApp
  if (brand?.whatsapp_status === 'verification_failed') {
    out.push(notice('whatsapp-failed', 'critical', 'WhatsApp is not connected yet',
      'We could not finish connecting your WhatsApp number. Our team has been told and will contact you. You do not need to do anything.',
      goto('See setup', '/dashboard')));
  }
  if (numberState?.marketing_paused) {
    out.push(notice('number-paused', 'critical', 'Campaigns are paused on your WhatsApp number',
      'Meta lowered the quality rating of your number, so marketing messages are paused to protect it. Replies to customers still work.',
      goto('Open WhatsApp', '/whatsapp')));
  }

  // Templates
  const rejected = templates.filter((template) => template.status === 'rejected');
  if (rejected.length) {
    out.push(notice('templates-rejected', 'warning', rejected.length === 1 ? 'A template was rejected by Meta' : `${rejected.length} templates were rejected by Meta`,
      `${names(rejected.map((template) => template.name))}. Edit and send again so you can use them.`, goto('Open templates', '/templates')));
  }
  const paused = templates.filter((template) => template.status === 'paused');
  if (paused.length) {
    out.push(notice('templates-paused', 'warning', 'Meta paused a template',
      `${names(paused.map((template) => template.name))} cannot be sent right now.`, goto('Open templates', '/templates')));
  }

  // Plan and trial (N3 state, read only)
  const grantedByStaff = String(input.subscriptionRow?.meta?.last_activation_source || '').startsWith('staff:');
  const planWord = grantedByStaff ? 'trial' : 'plan';
  if (!subscription) {
    out.push(notice('plan-none', input.planRequired ? 'warning' : 'info', 'Choose a plan',
      input.planRequired ? 'AI replies need an active plan. Choose one to keep them on.' : 'You are not on a plan yet. Choose one to get your AI reply allowance.',
      goto('See plans', '/settings')));
  } else if (subscription.status !== 'active') {
    out.push(notice('plan-ended', 'critical', `Your ${planWord} has ended`,
      'Renew to keep your AI reply allowance.', goto('Renew', '/settings')));
  } else if (subscription.days_left <= EXPIRY_WARNING_DAYS) {
    out.push(notice('plan-ending', 'warning', `Your ${planWord} ends in ${subscription.days_left} ${subscription.days_left === 1 ? 'day' : 'days'}`,
      'Renew before it ends so AI replies and campaigns keep working.', goto('Renew', '/settings')));
  }
  if (aiGate && aiGate.allowed === false && aiGate.reason) {
    out.push(notice('ai-blocked', 'critical', 'AI replies are paused', aiGate.reason, goto('Open billing', '/settings')));
  }

  // AI readiness once live
  if (input.live && brain && !brain.enabled) {
    if (brain.missing?.length) {
      out.push(notice('ai-profile', 'warning', 'Finish your AI Brain to turn on AI replies',
        `Still needed: ${names(brain.missing)}.`, goto('Open AI Brain', '/brain')));
    } else if (!brain.configured) {
      out.push(notice('ai-unavailable', 'info', 'AI replies are not available yet',
        'Our team is finishing the AI setup for your workspace.'));
    } else {
      out.push(notice('ai-off', 'info', 'AI replies are off', 'Turn them on in AI Brain when you are ready.', goto('Open AI Brain', '/brain')));
    }
  }

  // Recent billing alerts the owner may have missed (last 3 days)
  const since = now.getTime() - 3 * 24 * 60 * 60 * 1000;
  for (const alert of input.alerts || []) {
    if (new Date(alert.created_at).getTime() < since) continue;
    if (out.some((item) => item.id === 'ai-blocked') && alert.kind === 'ai_blocked') continue;
    out.push(notice(`billing-${alert.id}`, 'info', 'Billing', alert.message, goto('Open billing', '/settings')));
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

module.exports = { buildNotices, EXPIRY_WARNING_DAYS };
