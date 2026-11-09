/**
 * Billing: plans, subscriptions and the prepaid wallet.
 *   plans          price list (plans collection)
 *   subscriptions  which plan a workspace is on and until when
 *   wallet         append-only ledger; balance = sum of rows
 *   orders         Razorpay orders, checkout verification, webhook, extras
 *   aiAllowance    may one more AI reply go out, and what does it cost
 *   alerts         owner notices (20 percent left, AI paused)
 *   gst            18 percent on top of every plan price (N7)
 *   invoices       one numbered tax invoice per payment, PDF download (N7)
 *   trial          the 7-day free trial and its limits (N7)
 */
const plans = require('./plans');
const subscriptions = require('./subscriptions');
const wallet = require('./wallet');
const orders = require('./orders');
const aiAllowance = require('./aiAllowance');
const alerts = require('./alerts');
const razorpay = require('./razorpay');
const gst = require('./gst');
const invoices = require('./invoices');
const trial = require('./trial');
const { limits, seatLimit, numberLimit } = require('./limits');

module.exports = { plans, subscriptions, wallet, orders, aiAllowance, alerts, razorpay, gst, invoices, trial, limits, seatLimit, numberLimit };
