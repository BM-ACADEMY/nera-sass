# Billing: plans, subscriptions and the wallet

Every customer pays Meta directly for WhatsApp conversations. Getnera bills the
plan (monthly, through Razorpay) and keeps a prepaid wallet per workspace that
pays only for AI replies beyond the plan allowance, extra seats and extra
WhatsApp numbers.

## Tables (MongoDB collections, migration `037_billing_plans_subscriptions_wallet.js`)

| collection        | scope    | purpose |
|-------------------|----------|---------|
| `plans`           | platform | price list: Desk 799, WhatsApp 1999, Complete 3999 rupees a month, AI allowance, seats, numbers, overage prices. Edited by the platform Admin (Owner) at `PATCH /api/admin/billing/plans/:id`, never in code. |
| `subscriptions`   | tenant   | one row per workspace: plan, paid period, extras bought this period. |
| `wallet_ledger`   | tenant   | append-only money movements in paise; balance = sum of `signed_paise`. Updates and deletes are refused by the model; a correction is a new row. |
| `billing_orders`  | tenant   | Razorpay orders the server created (plan or top-up). The tenant and amount of a payment come from here, never from the browser or the webhook notes. |
| `billing_alerts`  | tenant   | owner notices sent once per period / top-up (20 percent left, AI paused). |

## Money flow

1. `POST /api/billing/orders` (owner/admin) creates the Razorpay order on the
   server. The amount is the plan price from the table or a validated top-up
   amount (`WALLET_TOPUP_MIN_INR` to `WALLET_TOPUP_MAX_INR`).
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
