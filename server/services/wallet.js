/**
 * The workspace wallet. Billing code credits (top-up) and debits (usage)
 * through here so the "below 20 percent" notice stays in step with the balance.
 * All functions run inside the caller's tenant context.
 */
const { TenantWallets } = require('../models');
const { NO_ID } = require('../db/mongo');

const LOW_FRACTION = 0.2;
const lowThreshold = () => {
  const value = Number(process.env.WALLET_LOW_PERCENT);
  return Number.isFinite(value) && value > 0 && value < 100 ? value / 100 : LOW_FRACTION;
};

const getWallet = () => TenantWallets.findOne({}, NO_ID).lean();

/** True when the balance is under the threshold share of the last top-up. */
function isLow(wallet) {
  if (!wallet || !(Number(wallet.reference_amount) > 0)) return false;
  return Number(wallet.balance) < Number(wallet.reference_amount) * lowThreshold();
}

async function afterChange(wallet, { toppedUp = false } = {}) {
  // Required here to avoid a load cycle (alerts reads the wallet too).
  const alerts = require('./alerts');
  await alerts.evaluateWallet(wallet).catch((error) => console.error('[wallet] Alert check failed:', error.message));
  // A successful top-up settles an earlier failed payment.
  if (toppedUp) await alerts.resolve('payment_failed').catch((error) => console.error('[wallet] Notice close failed:', error.message));
  return wallet;
}

/** Adds money after a successful payment; the new balance becomes the reference. */
async function credit(amount, { at = new Date() } = {}) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw Object.assign(new Error('A positive amount is required'), { status: 400 });
  const wallet = await TenantWallets.findOneAndUpdate({}, { $inc: { balance: value }, $set: { last_topup_at: at, updated_at: at } }, { upsert: true, new: true, projection: NO_ID }).lean();
  const topped = await TenantWallets.findOneAndUpdate({ id: wallet.id }, { $set: { reference_amount: wallet.balance } }, { new: true, projection: NO_ID }).lean();
  return afterChange(topped, { toppedUp: true });
}

/** Takes money for usage. The balance may not go below zero. */
async function debit(amount, { at = new Date() } = {}) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw Object.assign(new Error('A positive amount is required'), { status: 400 });
  const wallet = await TenantWallets.findOneAndUpdate({ balance: { $gte: value } }, { $inc: { balance: -value }, $set: { updated_at: at } }, { new: true, projection: NO_ID }).lean();
  if (!wallet) throw Object.assign(new Error('Not enough balance in the wallet'), { status: 402, code: 'WALLET_EMPTY' });
  return afterChange(wallet);
}

module.exports = { LOW_FRACTION, lowThreshold, getWallet, isLow, credit, debit };
