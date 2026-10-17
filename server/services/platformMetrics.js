/**
 * Platform subscription metrics for Founder Reports (MRR, TCV).
 *
 * Rules (Founder Reports MRR business decisions, checked against the Pricing
 * Spec in docs/Full scope LeadOS + AllianceOS.pdf, "Terms and discounts"):
 *
 * 1. Recurring amount: the contracted monthly amount = contract_value /
 *    term_months. contract_value is stored at sale time as
 *    monthly_price × term × (1 − term discount), rounded to the rupee, GST and
 *    the one-time onboarding fee excluded. It is used only when it matches an
 *    authorised term discount (config/plan-catalogue.json); otherwise the row
 *    is excluded as `contract_unverified`. No discount is invented.
 * 2. In force: status 'active' and current_period_start <= now < end. One
 *    subscription per workspace (the latest-starting one if several overlap);
 *    a same-plan renewal starting later is `scheduled`.
 *    Grace (days 1–7 after expiry) is not counted: the data model records no
 *    auto-renewal or continuing mandate, so a contract cannot be shown to
 *    continue past its end. It is reported separately as at-risk.
 *    Day 8 onwards is `lapsed` (an approved renewal in force counts instead).
 * 3. Paid: only subscriptions paid through a verified gateway (payment_method
 *    'razorpay') count as revenue. 'manual_grant' covers both offline-paid and
 *    free grants and cannot be told apart, so those are reported separately as
 *    `manual_grant_unverified`, never added to MRR.
 * 4. A workspace suspended by staff still counts while its paid contract is in
 *    force; it is also reported in `staff_suspended`.
 * 5. Legacy-only rows (price_monthly / starts_at / expires_at, no contract
 *    fields): their units, GST treatment and currency are not defined anywhere,
 *    so they are excluded with a reason rather than interpreted.
 *
 * Orphans (no workspace / missing / deleted workspace) never count. Currencies
 * are never added together. Duplicate rows (same id, or an identical contract
 * stored twice) count once in MRR and TCV.
 *
 * TCV = contract_value of every verified (rule 1) subscription of a valid
 *       workspace whose period has not ended (in force + scheduled), split
 *       into paid and manual-grant, per currency.
 */
const catalogue = require('../config/plan-catalogue.json');

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_DAYS = 7;
const HEADLINE_CURRENCY = 'INR';
const TERM_DISCOUNT_PCT = catalogue.pricing_rules?.term_discount_pct || {};
const PAID_METHODS = new Set(['razorpay']);

const toTime = (value) => {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : null;
};
const isAmount = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const round2 = (value) => Math.round(value * 100) / 100;
const addTo = (bucket, currency, amount) => { bucket[currency] = round2((bucket[currency] || 0) + amount); };
const hasContractFields = (s) => s.contract_value != null || s.term_months != null || s.current_period_start != null || s.current_period_end != null;
const hasLegacyFields = (s) => s.price_monthly != null || s.starts_at != null || s.expires_at != null;

// The contracted monthly amount, or the reason it cannot be trusted.
function contractedMonthly(sub) {
  const term = Number(sub.term_months);
  if (!Number.isInteger(term) || term <= 0) return { reason: 'missing_term' };
  if (!isAmount(sub.contract_value)) return { reason: 'missing_contract_value' };
  const authorisedPct = Number(TERM_DISCOUNT_PCT[String(term)]);
  if (!Number.isFinite(authorisedPct)) return { reason: 'unauthorised_term' };
  if (sub.discount_pct != null && Number(sub.discount_pct) !== authorisedPct) return { reason: 'unauthorised_discount' };
  if (!isAmount(sub.monthly_price)) return { reason: 'missing_list_price' };
  const expected = Math.round(sub.monthly_price * term * (1 - authorisedPct / 100));
  if (Math.abs(expected - sub.contract_value) > 1) return { reason: 'contract_value_mismatch' };
  return { monthly: sub.contract_value / term };
}

const paymentClass = (sub) => (PAID_METHODS.has(sub.payment_method) ? 'paid' : 'manual_grant_unverified');

function emptyResult() {
  return {
    paid: { mrr_by_currency: {}, tcv_by_currency: {}, workspaces: 0 },
    manual_grant_unverified: { mrr_by_currency: {}, tcv_by_currency: {}, workspaces: 0 },
    at_risk_grace: { mrr_by_currency: {}, count: 0, subscription_ids: [] },
    staff_suspended: { mrr_by_currency: {}, count: 0, tenant_ids: [] },
    excluded: {
      orphan: { count: 0, subscription_ids: [] },
      lapsed: { count: 0 },
      scheduled: { count: 0 },
      superseded_overlap: { count: 0 },
      duplicate_rows: { count: 0 },
      undated: { count: 0, subscription_ids: [] },
      contract_unverified: { count: 0, items: [] },
      legacy_unconfirmed: { count: 0, items: [] },
    },
  };
}

function computeSubscriptionMetrics({ tenants, subscriptions, now = new Date() }) {
  const nowMs = now.getTime();
  const result = emptyResult();
  const { excluded } = result;
  const tenantById = new Map(tenants.filter((t) => t && t.status !== 'deleted' && !t.deleted_at).map((t) => [Number(t.id), t]));

  const seenIds = new Set();
  const seenContracts = new Set();
  const inForceByTenant = new Map();
  for (const sub of subscriptions) {
    if (!sub || sub.status !== 'active') continue;
    if (seenIds.has(sub.id)) { excluded.duplicate_rows.count += 1; continue; }
    seenIds.add(sub.id);

    const tenantId = sub.tenant_id == null ? null : Number(sub.tenant_id);
    if (tenantId == null || !tenantById.has(tenantId)) {
      excluded.orphan.count += 1;
      excluded.orphan.subscription_ids.push(sub.id);
      continue;
    }
    if (!hasContractFields(sub) && hasLegacyFields(sub)) {
      excluded.legacy_unconfirmed.count += 1;
      excluded.legacy_unconfirmed.items.push({ subscription_id: sub.id, reason: 'legacy_units_and_currency_unconfirmed' });
      continue;
    }
    const start = toTime(sub.current_period_start);
    const end = toTime(sub.current_period_end);
    if (start == null || end == null || start >= end) {
      excluded.undated.count += 1;
      excluded.undated.subscription_ids.push(sub.id);
      continue;
    }
    const contract = contractedMonthly(sub);
    if (contract.reason) {
      excluded.contract_unverified.count += 1;
      excluded.contract_unverified.items.push({ subscription_id: sub.id, reason: contract.reason });
      continue;
    }
    // The same contract stored twice (identical workspace, plan, period, value).
    const contractKey = [tenantId, sub.plan_code, start, end, sub.contract_value, sub.currency || HEADLINE_CURRENCY].join('|');
    if (seenContracts.has(contractKey)) { excluded.duplicate_rows.count += 1; continue; }
    seenContracts.add(contractKey);

    const currency = String(sub.currency || HEADLINE_CURRENCY).toUpperCase();
    const bucket = result[paymentClass(sub)];
    if (end > nowMs) addTo(bucket.tcv_by_currency, currency, sub.contract_value);

    if (start > nowMs) { excluded.scheduled.count += 1; continue; }
    if (end <= nowMs) {
      const daysPastEnd = Math.ceil((nowMs - end) / DAY_MS);
      if (daysPastEnd <= GRACE_DAYS) {
        result.at_risk_grace.count += 1;
        result.at_risk_grace.subscription_ids.push(sub.id);
        addTo(result.at_risk_grace.mrr_by_currency, currency, contract.monthly);
      } else {
        excluded.lapsed.count += 1;
      }
      continue;
    }
    if (!inForceByTenant.has(tenantId)) inForceByTenant.set(tenantId, []);
    inForceByTenant.get(tenantId).push({ sub, monthly: contract.monthly, currency });
  }

  for (const [tenantId, entries] of inForceByTenant) {
    entries.sort((a, b) => toTime(b.sub.current_period_start) - toTime(a.sub.current_period_start) || Number(b.sub.id) - Number(a.sub.id));
    const [governing, ...overlapping] = entries;
    excluded.superseded_overlap.count += overlapping.length;
    const bucket = result[paymentClass(governing.sub)];
    addTo(bucket.mrr_by_currency, governing.currency, governing.monthly);
    bucket.workspaces += 1;
    if (tenantById.get(tenantId).status === 'suspended') {
      result.staff_suspended.count += 1;
      result.staff_suspended.tenant_ids.push(tenantId);
      addTo(result.staff_suspended.mrr_by_currency, governing.currency, governing.monthly);
    }
  }

  return {
    currency: HEADLINE_CURRENCY,
    // Headline figures: verified paid contracts in the headline currency.
    mrr: result.paid.mrr_by_currency[HEADLINE_CURRENCY] || 0,
    totalContractValue: result.paid.tcv_by_currency[HEADLINE_CURRENCY] || 0,
    activeSubscriptions: result.paid.workspaces,
    ...result,
  };
}

module.exports = { computeSubscriptionMetrics, contractedMonthly, GRACE_DAYS, HEADLINE_CURRENCY };
