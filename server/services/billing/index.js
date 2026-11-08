/**
 * Billing: plans, subscriptions and the prepaid wallet.
 *   plans          price list (plans collection)
 *   subscriptions  which plan a workspace is on and until when
 *   wallet         append-only ledger; balance = sum of rows
 *   orders         Razorpay orders, checkout verification, webhook, extras
 *   aiAllowance    may one more AI reply go out, and what does it cost
 *   alerts         owner notices (20 percent left, AI paused)
 */
const plans = require('./plans');
const subscriptions = require('./subscriptions');
const wallet = require('./wallet');
const orders = require('./orders');
const aiAllowance = require('./aiAllowance');
const alerts = require('./alerts');
const razorpay = require('./razorpay');
const { limits, seatLimit, numberLimit } = require('./limits');

module.exports = { plans, subscriptions, wallet, orders, aiAllowance, alerts, razorpay, limits, seatLimit, numberLimit };
