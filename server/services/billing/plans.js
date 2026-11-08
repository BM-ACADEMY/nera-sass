/**
 * Plan catalogue. Prices and allowances are read from the `plans` collection
 * every time, so platform staff can change them without a deploy. The
 * defaults below are only used to seed an empty catalogue (migration 037 or
 * ensureDefaultPlans at startup); after that the database wins.
 */
const { Plans } = require('../../models');
const { runAsSystem } = require('../tenantContext');
const { insertIgnore } = require('../../db/mongo');

const DEFAULT_PLANS = Object.freeze([
  {
    code: 'desk', name: 'Desk', price_inr: 799, sort_order: 1,
    description: 'Inbox and lead desk for one person.',
    ai_replies_month: 200, ai_overage_price_paise: 100,
    seats_included: 1, numbers_included: 1, extra_seat_price_inr: 299, extra_number_price_inr: 499,
    features: ['Shared inbox', 'Leads and follow-ups', '200 AI replies a month'],
  },
  {
    code: 'whatsapp', name: 'WhatsApp', price_inr: 1999, sort_order: 2,
    description: 'WhatsApp campaigns, templates and the AI Brain.',
    ai_replies_month: 1000, ai_overage_price_paise: 100,
    seats_included: 2, numbers_included: 1, extra_seat_price_inr: 299, extra_number_price_inr: 499,
    features: ['Everything in Desk', 'WhatsApp campaigns and templates', 'AI Brain', '1,000 AI replies a month', '2 seats'],
  },
  {
    code: 'complete', name: 'Complete', price_inr: 3999, sort_order: 3,
    description: 'The whole platform for a growing team.',
    ai_replies_month: 3000, ai_overage_price_paise: 100,
    seats_included: 5, numbers_included: 2, extra_seat_price_inr: 299, extra_number_price_inr: 499,
    features: ['Everything in WhatsApp', '3,000 AI replies a month', '5 seats', '2 WhatsApp numbers', 'Reports and calendar'],
  },
]);

class PlanError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const PLAN_FIELDS = ['code', 'name', 'description', 'price_inr', 'currency', 'billing_cycle', 'ai_replies_month',
  'ai_overage_price_paise', 'seats_included', 'numbers_included', 'extra_seat_price_inr', 'extra_number_price_inr',
  'features', 'is_active', 'sort_order'];

// What a customer sees: the price list without internal metadata.
function publicPlan(plan) {
  if (!plan) return null;
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description || '',
    price_inr: Number(plan.price_inr),
    price_paise: toPaise(plan.price_inr),
    currency: plan.currency || 'INR',
    billing_cycle: plan.billing_cycle || 'monthly',
    ai_replies_month: Number(plan.ai_replies_month ?? 0),
    ai_overage_price_paise: Number(plan.ai_overage_price_paise ?? 0),
    seats_included: Number(plan.seats_included ?? 1),
    numbers_included: Number(plan.numbers_included ?? 1),
    extra_seat_price_inr: Number(plan.extra_seat_price_inr ?? 0),
    extra_number_price_inr: Number(plan.extra_number_price_inr ?? 0),
    features: Array.isArray(plan.features) ? plan.features : [],
    is_active: plan.is_active !== false,
    sort_order: Number(plan.sort_order ?? 0),
  };
}

const toPaise = (inr) => Math.round(Number(inr) * 100);

// Seeds the three default plans when the catalogue is empty. Idempotent:
// an existing code is never overwritten, so edited prices survive restarts.
async function ensureDefaultPlans() {
  return runAsSystem(async () => {
    const existing = await Plans.countDocuments({});
    if (existing > 0) return { seeded: 0 };
    let seeded = 0;
    for (const plan of DEFAULT_PLANS) {
      const inserted = await insertIgnore(Plans, { ...plan, is_active: true, created_at: new Date(), updated_at: new Date() });
      if (inserted) seeded += 1;
    }
    return { seeded };
  }, 'billing:plans');
}

async function listPlans({ includeInactive = false } = {}) {
  const filter = includeInactive ? {} : { is_active: { $ne: false } };
  const rows = await runAsSystem(() => Plans.find(filter, { _id: 0 }).sort({ sort_order: 1, price_inr: 1 }).lean(), 'billing:plans');
  return rows.map(publicPlan);
}

async function planByCode(code) {
  const value = String(code || '').trim().toLowerCase();
  if (!value) return null;
  const plan = await runAsSystem(() => Plans.findOne({ code: value }, { _id: 0 }).lean(), 'billing:plans');
  return publicPlan(plan);
}

async function planById(id) {
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  const plan = await runAsSystem(() => Plans.findOne({ id: n }, { _id: 0 }).lean(), 'billing:plans');
  return publicPlan(plan);
}

// Platform staff edit (routes/admin.js). Only known fields, validated.
async function updatePlan(id, changes = {}) {
  const set = {};
  const nonNegativeInt = (v) => Number.isInteger(Number(v)) && Number(v) >= 0;
  for (const field of PLAN_FIELDS) {
    if (changes[field] === undefined || field === 'code') continue;
    const value = changes[field];
    switch (field) {
      case 'name':
      case 'description':
      case 'currency':
      case 'billing_cycle':
        if (typeof value !== 'string' || value.length > 500) throw new PlanError(400, `Invalid ${field}`);
        set[field] = value.trim();
        break;
      case 'price_inr':
      case 'extra_seat_price_inr':
      case 'extra_number_price_inr':
        if (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 10000000) throw new PlanError(400, `Invalid ${field}`);
        set[field] = Math.round(Number(value) * 100) / 100;
        break;
      case 'ai_replies_month':
        if (!(Number(value) === -1 || nonNegativeInt(value))) throw new PlanError(400, 'ai_replies_month must be -1 (no limit) or a whole number');
        set[field] = Number(value);
        break;
      case 'ai_overage_price_paise':
      case 'seats_included':
      case 'numbers_included':
      case 'sort_order':
        if (!nonNegativeInt(value)) throw new PlanError(400, `${field} must be a whole number`);
        set[field] = Number(value);
        break;
      case 'features':
        if (!Array.isArray(value) || value.length > 30 || value.some((f) => typeof f !== 'string' || f.length > 200)) throw new PlanError(400, 'features must be a list of short texts');
        set[field] = value.map((f) => f.trim()).filter(Boolean);
        break;
      case 'is_active':
        set[field] = Boolean(value);
        break;
      default:
        break;
    }
  }
  if (!Object.keys(set).length) throw new PlanError(400, 'Nothing to update');
  const plan = await runAsSystem(() => Plans.findOneAndUpdate({ id: Number(id) }, { $set: { ...set, updated_at: new Date() } }, { new: true, projection: { _id: 0 } }).lean(), 'billing:plans');
  if (!plan) throw new PlanError(404, 'Plan not found');
  return publicPlan(plan);
}

module.exports = { DEFAULT_PLANS, PlanError, publicPlan, toPaise, ensureDefaultPlans, listPlans, planByCode, planById, updatePlan };
