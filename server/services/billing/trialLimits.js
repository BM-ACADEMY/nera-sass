/**
 * What the 7-day free trial includes (N7). Kept apart from trial.js so the
 * subscription module can describe a trial without a circular require.
 *
 *   one seat, one WhatsApp number, 50 AI replies in total (not per month),
 *   replies only to people who message first: no campaigns, no bulk sends,
 *   no exports, no extra seats or numbers, no card.
 */
const TRIAL = Object.freeze({
  code: 'trial',
  name: 'Free trial',
  days: 7,
  maxDays: 14,
  aiRepliesTotal: 50,
  seats: 1,
  numbers: 1,
});

/** The trial as a plan object, so limits and the AI allowance need no special case. */
function trialPlan() {
  return {
    id: null,
    code: TRIAL.code,
    name: TRIAL.name,
    description: '7 days free: reply to people who message you, with 50 AI replies.',
    price_inr: 0,
    price_paise: 0,
    currency: 'INR',
    billing_cycle: 'trial',
    ai_replies_month: TRIAL.aiRepliesTotal,
    ai_overage_price_paise: 0,
    seats_included: TRIAL.seats,
    numbers_included: TRIAL.numbers,
    extra_seat_price_inr: 0,
    extra_number_price_inr: 0,
    features: ['1 seat', '1 WhatsApp number', '50 AI replies in total', 'Replies to people who message you first'],
    is_active: true,
    is_trial: true,
    sort_order: 0,
    periods: [],
  };
}

module.exports = { TRIAL, trialPlan };
