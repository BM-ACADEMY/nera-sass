// What the Billing tab shows, worked out from the server's own answers
// (GET /api/billing/summary and /plans). The server checks every change again.

export const formatInr = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const formatRupees = (inr) => `₹${Number(inr || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const canManageBilling = (summary) => Boolean(summary?.permissions?.manage_billing);

// Plan replies used, as a 0-100 bar; null when the plan has no limit.
export function allowanceBar(ai) {
  if (!ai || ai.allowance == null || ai.allowance < 0) return null;
  if (ai.allowance === 0) return { percent: 100, tone: 'error', label: 'No AI replies included' };
  const used = Math.min(Number(ai.used || 0), ai.allowance);
  const percent = Math.round((used / ai.allowance) * 100);
  const leftFraction = (ai.allowance - used) / ai.allowance;
  const tone = leftFraction <= 0 ? 'error' : leftFraction <= 0.2 ? 'warn' : 'ok';
  return { percent, tone, label: `${used.toLocaleString('en-IN')} of ${ai.allowance.toLocaleString('en-IN')} AI replies used` };
}

// The one sentence that tells the owner where AI replies stand.
export function aiStatusLine(summary) {
  const ai = summary?.ai;
  if (!ai) return '';
  if (!ai.allowed) return ai.reason || 'AI replies are paused.';
  if (ai.source === 'legacy') return `${ai.left} AI replies left this month on your workspace quota.`;
  if (ai.source === 'none') return 'AI replies are on with no limit.';
  if (ai.allowance === -1) return 'Your plan includes unlimited AI replies.';
  if (ai.left > 0) return `${ai.left.toLocaleString('en-IN')} plan replies left this period.`;
  return `Plan allowance used; each reply now costs ${formatInr(ai.overage_price_paise)} from the wallet.`;
}

export const planLabel = (plan) => (plan ? `${plan.name} · ${formatRupees(plan.price_inr)} a month` : 'No plan');

// N7: the billing periods a plan is sold for, from the server's table.
export const PERIOD_LABELS = { 1: '1 month', 3: '3 months', 6: '6 months' };
export const periodLabel = (months) => PERIOD_LABELS[months] || `${months} months`;

// The period card figures for a plan: price, GST and total, or null when the
// plan is not sold for that period.
export function periodPricing(plan, months) {
  const period = (plan?.periods || []).find((p) => Number(p.months) === Number(months));
  if (!period) return null;
  const perMonth = period.price_inr / period.months;
  const monthly = (plan.periods || []).find((p) => Number(p.months) === 1);
  const saving = monthly && period.months > 1 ? Math.max(0, Math.round((1 - perMonth / monthly.price_inr) * 100)) : 0;
  return {
    months: period.months,
    price: formatRupees(period.price_inr),
    gst: `${formatInr(period.gst_paise)} GST (${period.gst_rate_percent}%)`,
    total: formatInr(period.total_paise),
    perMonth: formatRupees(Math.round(perMonth)),
    saving,
  };
}

// Button text on a plan card given the current subscription and the chosen period.
export function planAction(plan, subscription, months = 1) {
  const period = periodLabel(months);
  if (subscription?.is_trial) return `Upgrade for ${period}`;
  if (!subscription || subscription.status !== 'active') return `Choose plan · ${period}`;
  if (subscription.plan_code === plan.code) return `Renew for ${period}`;
  return plan.price_inr > (subscription.price_inr || 0) ? `Upgrade · ${period}` : `Switch · ${period}`;
}

// N7: what the trial banner says and offers, from GET /api/billing/summary.
export function trialStatus(summary) {
  const trial = summary?.trial;
  if (!trial) return { show: false };
  if (trial.active) {
    const days = Number(trial.days_left || 0);
    return {
      show: true, kind: 'active', tone: days <= 2 ? 'error' : 'info',
      title: days === 0 ? 'Your free trial ends today' : `${days} day${days === 1 ? '' : 's'} left in your free trial`,
      text: `The trial replies to people who message you first, with ${trial.limits?.ai_replies_total ?? 50} AI replies in total, 1 seat and 1 number. Upgrade to send campaigns, templates and exports.`,
      upgrade: trial.upgrade || null,
    };
  }
  if (trial.ended) {
    return {
      show: true, kind: 'ended', tone: 'error',
      title: 'Your free trial has ended',
      text: 'Messages and AI replies are paused. Upgrade with one click to continue; nothing has been deleted.',
      upgrade: trial.upgrade || null,
    };
  }
  if (trial.available) {
    return { show: true, kind: 'available', tone: 'info', title: `Try ${summary.plan ? 'more' : 'Getnera'} free for ${trial.limits?.days ?? 7} days`, text: 'No card needed. Just your business name and website.', upgrade: null };
  }
  return { show: false };
}

// The free-trial form: both fields are required by the server too.
export function validTrialForm({ business_name: name, website } = {}) {
  const businessName = String(name || '').trim();
  const site = String(website || '').trim();
  if (businessName.length < 2) return { ok: false, reason: 'Enter your business name' };
  if (!/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(site)) return { ok: false, reason: 'Enter your business website, for example www.example.in' };
  return { ok: true, business_name: businessName, website: site };
}

// N7: one line per invoice row.
export const invoiceLine = (invoice) => `${invoice.invoice_number} · ${invoice.description || invoice.plan_name || 'Payment'} · ${formatInr(invoice.total_paise)} (incl. ${formatInr(invoice.gst_paise)} GST)`;

// Whole rupees between the server's limits.
export function validTopup(value, wallet) {
  const inr = Number(value);
  if (!Number.isInteger(inr)) return { ok: false, reason: 'Enter a whole number of rupees' };
  const min = wallet?.topup_min_inr ?? 100;
  const max = wallet?.topup_max_inr ?? 100000;
  if (inr < min || inr > max) return { ok: false, reason: `Between ${formatRupees(min)} and ${formatRupees(max)}` };
  return { ok: true, inr };
}

export const LEDGER_LABELS = {
  topup: 'Top-up',
  ai_overage: 'AI reply (beyond plan)',
  extra_seat: 'Extra seat',
  extra_number: 'Extra number',
  adjustment: 'Adjustment by Getnera',
  refund: 'Refund',
};
export const ledgerLabel = (reason) => LEDGER_LABELS[reason] || reason;
