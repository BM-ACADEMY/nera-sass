# Billing: plans, subscriptions and the wallet

Every customer pays Meta directly for WhatsApp conversations. Getnera bills the
plan (prepaid for 1, 3 or 6 months, through Razorpay, plus 18 percent GST) and
keeps a prepaid wallet per workspace that pays only for AI replies beyond the
plan allowance, extra seats and extra WhatsApp numbers. A new business can try
the product for 7 days without a card (N7).

## Tables (MongoDB collections, migrations `038_billing_plans_subscriptions_wallet.js` and `039_billing_periods_trial_gst.js`)

| collection        | scope    | purpose |
|-------------------|----------|---------|
| `plans`           | platform | price list: Desk 799 / 2149 / 3799, WhatsApp 1999 / 5399 / 9599, Complete 3999 / 10799 / 19199 rupees for 1 / 3 / 6 months (`period_prices_inr`, before GST), AI allowance a month, seats, numbers, overage prices. Edited by the platform Admin (Owner) at `PATCH /api/admin/billing/plans/:id`, never in code. |
| `subscriptions`   | tenant   | one row per workspace: plan, paid period (`period_months`), extras bought this period, `is_trial`. |
| `wallet_ledger`   | tenant   | append-only money movements in paise; balance = sum of `signed_paise`. Updates and deletes are refused by the model; a correction is a new row. |
| `billing_orders`  | tenant   | Razorpay orders the server created (plan or top-up) with `price_paise`, `gst_paise` and `total_paise` kept apart; `amount_paise` is the total charged. The tenant and amount of a payment come from here, never from the browser or the webhook notes. |
| `billing_invoices` | tenant  | one numbered tax invoice per payment (`GN-<year>-<six digits>`): date, customer business name, plan, period, price, GST, total. Downloaded as PDF at `GET /api/billing/invoices/:id/pdf`. |
| `billing_trials`  | tenant   | the workspace's free trial: business name, website, dates, extensions (who, when, days, reason). Normalised keys are unique, so one trial per business, website, WhatsApp number, email and phone is enforced by the database. |
| `billing_trial_attempts` | tenant | every refused trial request and which rule matched. |
| `billing_alerts`  | tenant   | owner notices sent once per period / top-up / trial (20 percent left, AI paused, trial day 5, trial ended). |

## Billing periods and GST (N7)

A plan is sold for 1, 3 or 6 months at the table price for that period. The
order adds GST (`BILLING_GST_PERCENT`, default 18) on top: for Desk 3 months,
price 2,149, GST 386.82, total 2,535.82, and Razorpay is asked for the total.
Activation adds the months to the paid period (a renewal of the same plan
extends it). The AI allowance stays per month: on a 3 or 6 month plan it
resets on each monthly anniversary of the period start
(`subscriptions.cycleStart`), and the Billing tab shows when. Wallet top-ups
carry no GST (prepaid balance, not a plan price). Every fulfilled payment
writes one invoice inside the order lock, so a replayed webhook never issues
a second one. There is no refund flow: refunds and credit notes are an open
decision, handled by staff through the wallet adjustment for now.

## Free trial (N7)

`POST /api/billing/trial/start { business_name, website }` (owner/admin, no
card). The trial is a subscription row with `is_trial` and the synthetic trial
plan (`trialLimits.js`): 7 days, 1 seat, 1 number, 50 AI replies in total,
no wallet. Repeats are refused when the business name, website host, owner
email, brand phone or WhatsApp number already had a trial; the attempt is
logged and audited (`TRIAL_BLOCKED`). What a trial may do is decided in one
place, `trial.js`:

- `sendBlock` is asked by the N1 send policy (`sendPolicy.assertCanSend`) on
  every send: only kind `service` without a template (a reply to someone who
  wrote first) passes; after day 7 nothing passes (`TRIAL_ENDED`).
- `guard('campaigns')` / `guard('exports')` refuse campaign creation and retry,
  lead exports and the data-rights CSV exports; extras (seats, numbers) are
  refused in `orders.buyExtra`. Seats and numbers are limited by the trial plan.
- `aiAllowance` stops the AI at 50 replies over the whole trial
  (`TRIAL_AI_USED`) and after the trial ends (`TRIAL_ENDED`), whatever
  `BILLING_REQUIRE_PLAN` says.

Day 5: the daily job (`trial.sweep`) emails the owner once. Day 7:
`orders.expireLapsed` marks the subscription expired, marks the trial expired
and emails the owner (`trial_expired`); the Billing tab shows the days left
while it runs and a one-click upgrade (the WhatsApp plan, 1 month) during and
after. Staff extend a trial to 14 days at most at
`POST /api/admin/tenants/:id/billing/trial/extend { days?, reason }`; the
reason is required and every extension is audited (`TRIAL_EXTENDED`).

## Money flow

1. `POST /api/billing/orders` (owner/admin) creates the Razorpay order on the
   server. The amount is the plan price for the chosen period from the table
   plus GST, or a validated top-up amount (`WALLET_TOPUP_MIN_INR` to
   `WALLET_TOPUP_MAX_INR`).
2. The browser pays with Razorpay Checkout using only the public key id.
3. `POST /api/billing/orders/verify` checks `HMAC-SHA256(order_id|payment_id)`
   with `RAZORPAY_SECRET` (constant time). A verified plan payment activates
   the subscription at once. A verified top-up is marked paid only.
4. `POST /webhook/razorpay/billing` (also reached through the older
   `/webhook/razorpay`) checks the `x-razorpay-signature` HMAC of the raw body
   with `RAZORPAY_WEBHOOK_SECRET`, checks the amount and currency against the
   order, and credits the wallet exactly once per Razorpay payment id (unique
   ledger key `tenant_id + reference_type + reference_id`). Replays are no-ops.
   Without the webhook secret the route answers 503 and credits nothing.

## AI replies

`services/billing/aiAllowance.js` is called before every AI reply (AI Brain
`brainEngine.respond` and the older n8n `POST /api/internal/send-reply`):

- inside `plan.ai_replies_month`: free;
- allowance used: the wallet must cover `plan.ai_overage_price_paise`; after
  the reply is sent the wallet is debited once per message id;
- allowance used and wallet empty: the reply is not drafted, the chat is handed
  to a person, and the owner is emailed once per period;
- 20 percent warnings: once when 20 percent of the allowance is left and once
  when the wallet falls to 20 percent of the last top-up;
- no plan: a workspace keeps its legacy `tenants.ai_reply_quota_month`, or no
  limit when it has none, so existing workspaces keep working on launch day.
  `BILLING_REQUIRE_PLAN=true` makes a plan mandatory: no plan, no AI replies.

Usage is counted from outbound messages with `is_ai: true` since the start of
the paid period, so both reply paths share one allowance.

## Seats and numbers

Seat limit = `plan.seats_included + subscription.extra_seats` (1 without a
plan: the original one-login rule). Invitations refuse the next seat with a
message pointing at Billing. Extras are bought at `POST /api/billing/extras`
and paid from the wallet for the rest of the current period. The number limit
is reported in the summary; linking numbers is not blocked by this module.

## Environment

| variable | purpose |
|----------|---------|
| `RAZORPAY_KEY_ID` | public key id, sent to the browser for Checkout |
| `RAZORPAY_SECRET` | key secret, server only: order creation and checkout signature |
| `RAZORPAY_WEBHOOK_SECRET` | webhook signature; required for wallet credits |
| `BILLING_REQUIRE_PLAN` | default `false`; `true` stops AI replies for workspaces without an active plan |
| `WALLET_TOPUP_MIN_INR` / `WALLET_TOPUP_MAX_INR` | top-up bounds, default 100 and 100000 |
| `BILLING_GST_PERCENT` | GST added on top of plan prices, default 18 |
| `BILLING_SELLER_NAME` / `BILLING_SELLER_GSTIN` / `BILLING_SELLER_ADDRESS` | seller details printed on invoice PDFs (name falls back to `NERA_PRODUCT_NAME`) |
