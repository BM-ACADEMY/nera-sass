/**
 * Seat and WhatsApp-number limits of a workspace: what the plan includes plus
 * extras bought from the wallet for the current period. Without an active
 * plan a workspace keeps the original one-login rule (1 seat, 1 number).
 */
const subscriptions = require('./subscriptions');

const DEFAULT_SEATS = 1;
const DEFAULT_NUMBERS = 1;

async function limits(tenantId = null, now = new Date()) {
  const live = await subscriptions.active(tenantId, now);
  if (!live?.plan) return { seats: DEFAULT_SEATS, numbers: DEFAULT_NUMBERS, plan: null, subscription: null };
  return {
    seats: Number(live.plan.seats_included) + Number(live.subscription.extra_seats || 0),
    numbers: Number(live.plan.numbers_included) + Number(live.subscription.extra_numbers || 0),
    plan: live.plan,
    subscription: live.subscription,
  };
}

const seatLimit = async (tenantId = null, now) => (await limits(tenantId, now)).seats;
const numberLimit = async (tenantId = null, now) => (await limits(tenantId, now)).numbers;

module.exports = { DEFAULT_SEATS, DEFAULT_NUMBERS, limits, seatLimit, numberLimit };
