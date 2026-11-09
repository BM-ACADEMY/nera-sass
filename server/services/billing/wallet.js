/**
 * Prepaid wallet, one per workspace, kept as an append-only ledger
 * (models/WalletLedger.js). The balance is always the sum of the rows; no row
 * is ever updated or deleted. Credits come only from verified Razorpay
 * webhooks (services/billing/orders.js) or a staff adjustment; debits pay AI
 * overage, extra seats and extra numbers. Every function runs in the caller's
 * tenant context, so a workspace can only ever see and move its own money.
 */
const { WalletLedger } = require('../../models');
const { requireTenantId } = require('../tenantContext');
const { withLock } = require('../../db/mongo');

class WalletError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const REASONS = Object.freeze(['topup', 'ai_overage', 'extra_seat', 'extra_number', 'adjustment', 'refund']);

const toInt = (value) => {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new WalletError(400, 'Amount must be a whole number of paise');
  return n;
};

/** Current balance in paise (sum of the ledger for the current tenant). */
async function balancePaise() {
  requireTenantId();
  const [row] = await WalletLedger.aggregate([{ $group: { _id: null, total: { $sum: '$signed_paise' } } }]);
  return Number(row?.total || 0);
}

/** Recent movements, newest first. */
async function ledger({ limit = 50, before = null } = {}) {
  requireTenantId();
  const filter = before ? { id: { $lt: Number(before) } } : {};
  const size = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return WalletLedger.find(filter, { _id: 0 }).sort({ id: -1 }).limit(size).lean();
}

const lockKey = () => `wallet:${requireTenantId()}`;

async function append({ direction, amountPaise, reason, referenceType = null, referenceId = null, description = '', createdBy = null, meta = {} }) {
  const amount = toInt(amountPaise);
  if (amount <= 0) throw new WalletError(400, 'Amount must be greater than zero');
  if (!REASONS.includes(reason)) throw new WalletError(400, 'Unknown wallet reason');
  try {
    const row = await WalletLedger.create({
      direction,
      amount_paise: amount,
      signed_paise: direction === 'credit' ? amount : -amount,
      reason,
      reference_type: referenceType,
      reference_id: referenceId == null ? null : String(referenceId),
      description: String(description || '').slice(0, 300),
      created_by: createdBy,
      meta,
      created_at: new Date(),
    });
    return { row: row.toObject(), duplicate: false };
  } catch (error) {
    // The same reference again (webhook replay, retried job): the first row stands.
    if (error.code === 11000 && referenceId != null) {
      const existing = await WalletLedger.findOne({ reference_type: referenceType, reference_id: String(referenceId) }, { _id: 0 }).lean();
      return { row: existing, duplicate: true };
    }
    throw error;
  }
}

/**
 * Adds money. Idempotent per (referenceType, referenceId): a Razorpay payment
 * id credits the wallet exactly once however many times the webhook arrives.
 * Returns { row, duplicate, balance_paise }.
 */
async function credit(input) {
  const result = await append({ ...input, direction: 'credit' });
  return { ...result, balance_paise: await balancePaise() };
}

/**
 * Takes money out, never below zero. Idempotent per reference like credit().
 * Throws WalletError 402 INSUFFICIENT_FUNDS when the balance is too low.
 */
async function debit(input) {
  const amount = toInt(input.amountPaise);
  return withLock(lockKey(), async () => {
    if (input.referenceId != null) {
      const existing = await WalletLedger.findOne({ reference_type: input.referenceType || null, reference_id: String(input.referenceId) }, { _id: 0 }).lean();
      if (existing) return { row: existing, duplicate: true, balance_paise: await balancePaise() };
    }
    const balance = await balancePaise();
    if (balance < amount) {
      throw new WalletError(402, 'Not enough money in the wallet. Top up the wallet to continue.', 'INSUFFICIENT_FUNDS');
    }
    const result = await append({ ...input, direction: 'debit' });
    return { ...result, balance_paise: balance - (result.duplicate ? 0 : amount) };
  }, { ttlMs: 15000, waitMs: 10000 });
}

/** Can the wallet pay `amountPaise` right now? */
async function canPay(amountPaise) {
  const amount = toInt(amountPaise);
  if (amount <= 0) return true;
  return (await balancePaise()) >= amount;
}

/** The latest top-up credit, used to judge "20 percent of the wallet left". */
async function lastTopup() {
  requireTenantId();
  return WalletLedger.findOne({ direction: 'credit', reason: { $in: ['topup', 'adjustment'] } }, { _id: 0 }).sort({ id: -1 }).lean();
}

const formatInr = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

module.exports = { WalletError, REASONS, balancePaise, ledger, credit, debit, canPay, lastTopup, formatInr };
