/**
 * Decides whether one more AI reply may go out for the current workspace,
 * and settles the cost after it did. Rules (Full Scope billing):
 *   - inside the plan allowance: free;
 *   - allowance used: each reply costs plan.ai_overage_price_paise from the
 *     wallet; the wallet must be able to pay before the reply is drafted;
 *   - allowance used and wallet empty: the AI stops and the owner is told;
 *   - the owner is warned once when 20 percent of the allowance is left and
 *     once when 20 percent of the last top-up is left;
 *   - a workspace with no active plan keeps its legacy per-tenant quota
 *     (tenants.ai_reply_quota_month), or no limit when it has none, so
 *     existing workspaces keep working on the day plans launch; set
 *     BILLING_REQUIRE_PLAN=true to make a plan mandatory for AI replies.
 * Usage is counted from outbound AI messages, so both the AI Brain and the
 * older n8n reply flow share one allowance. Runs in the tenant context.
 */
const { Messages } = require('../../models');
const subscriptions = require('./subscriptions');
const wallet = require('./wallet');
const alerts = require('./alerts');

const WARN_FRACTION = 0.2;
const requirePlan = () => process.env.BILLING_REQUIRE_PLAN === 'true';

const REASONS = Object.freeze({
  noPlan: 'AI replies are paused: this workspace has no active plan. Choose a plan in Settings > Billing.',
  legacyQuota: 'AI reply limit reached for this month: please reply yourself',
  walletEmpty: 'AI replies are paused: the plan allowance is used and the wallet is empty. Top up the wallet in Settings > Billing.',
  // N7: the free trial has 50 replies in all and no wallet; an ended trial gets none.
  trialUsed: 'AI replies are paused: the free trial\'s 50 AI replies are used up. Upgrade to a plan in Settings > Billing.',
  trialEnded: 'AI replies are paused: the free trial has ended. Upgrade to a plan in Settings > Billing.',
});

const startOfMonth = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

async function aiRepliesSince(from) {
  return Messages.countDocuments({ direction: 'outbound', is_ai: true, sent_at: { $gte: from } });
}

/**
 * check(tenant, now) -> {
 *   allowed, reason, source: 'plan' | 'legacy' | 'none',
 *   left (plan replies left, or null when unlimited/unknown), used, allowance,
 *   charge_paise (what this reply costs the wallet), period_start, plan
 * }
 */
async function check(tenant, now = new Date()) {
  const live = await subscriptions.active(null, now);
  if (!live?.plan) {
    // An ended trial is not "no plan": it stops, whatever the legacy quota says.
    const lapsed = await subscriptions.current();
    if (lapsed?.is_trial) {
      return { allowed: false, reason: REASONS.trialEnded, code: 'TRIAL_ENDED', source: 'trial', left: 0, used: null, allowance: 0, charge_paise: 0, period_start: lapsed.current_period_start, period_end: lapsed.current_period_end, plan: null, subscription: lapsed };
    }
    const legacy = Number(tenant?.ai_reply_quota_month);
    if (Number.isFinite(legacy) && legacy > 0) {
      const used = await aiRepliesSince(startOfMonth(now));
      const left = Math.max(legacy - used, 0);
      return { allowed: left > 0, reason: left > 0 ? null : REASONS.legacyQuota, source: 'legacy', left, used, allowance: legacy, charge_paise: 0, period_start: startOfMonth(now), plan: null };
    }
    if (!requirePlan()) return { allowed: true, reason: null, source: 'none', left: null, used: null, allowance: null, charge_paise: 0, period_start: null, plan: null };
    return { allowed: false, reason: REASONS.noPlan, code: 'NO_ACTIVE_PLAN', source: 'none', left: 0, used: null, allowance: 0, charge_paise: 0, period_start: null, plan: null };
  }

  const { plan, subscription } = live;
  // The allowance is per month: on a 3 or 6 month plan it resets on each
  // monthly anniversary of the period start (N7). A trial counts its 50
  // replies over the whole trial.
  const cycle = subscriptions.cycleStart(subscription, now);
  const periodStart = cycle.start;
  const allowance = Number(plan.ai_replies_month);
  const used = await aiRepliesSince(periodStart);
  const base = { source: plan.is_trial ? 'trial' : 'plan', used, allowance, period_start: periodStart, period_end: cycle.end, plan, subscription };
  if (allowance === -1) return { ...base, allowed: true, reason: null, left: null, charge_paise: 0 };
  const left = Math.max(allowance - used, 0);
  if (left > 0) return { ...base, allowed: true, reason: null, left, charge_paise: 0 };
  if (plan.is_trial) return { ...base, allowed: false, reason: REASONS.trialUsed, code: 'TRIAL_AI_USED', left: 0, charge_paise: 0 };

  const price = Number(plan.ai_overage_price_paise || 0);
  if (price <= 0) return { ...base, allowed: true, reason: null, left: 0, charge_paise: 0 };
  const balance = await wallet.balancePaise();
  if (balance >= price) return { ...base, allowed: true, reason: null, left: 0, charge_paise: price, balance_paise: balance };
  return { ...base, allowed: false, reason: REASONS.walletEmpty, code: 'WALLET_EMPTY', left: 0, charge_paise: price, balance_paise: balance };
}

/** Tells the owner once per period that the AI stopped for lack of money. */
async function notifyBlocked(gate) {
  if (!gate || gate.allowed) return;
  if (gate.code === 'WALLET_EMPTY') {
    await alerts.raise({
      key: `ai_blocked:${gate.period_start.toISOString()}`,
      kind: 'ai_blocked',
      message: 'AI replies are paused: your plan allowance is used up and the wallet is empty. Top up the wallet to turn them back on.',
      meta: { allowance: gate.allowance, used: gate.used, balance_paise: gate.balance_paise ?? 0 },
    });
  } else if (gate.code === 'NO_ACTIVE_PLAN') {
    await alerts.raise({
      key: `ai_no_plan:${startOfMonth(new Date()).toISOString()}`,
      kind: 'ai_blocked',
      message: 'AI replies are paused because this workspace has no active plan. Choose a plan to turn them back on.',
      meta: {},
    });
  } else if (gate.code === 'TRIAL_AI_USED') {
    await alerts.raise({
      key: `ai_trial_used:${new Date(gate.period_start).toISOString()}`,
      kind: 'ai_blocked',
      message: `The free trial's ${gate.allowance} AI replies are used up. Upgrade to a plan to keep the AI replying to customers.`,
      meta: { allowance: gate.allowance, used: gate.used },
    });
  }
  // TRIAL_ENDED: the end-of-trial notice already went out (trial.markExpired).
}

/**
 * After a reply went out: charge the wallet when the reply was overage and
 * raise the 20 percent warnings. `reference` ties the debit to the message so
 * a retry never charges twice. Never throws.
 */
async function settle(gate, { referenceType = 'message', referenceId, now = new Date() } = {}) {
  if (!gate || !['plan', 'trial'].includes(gate.source)) return { charged_paise: 0 };
  const result = { charged_paise: 0 };
  try {
    if (gate.charge_paise > 0 && referenceId != null) {
      const debit = await wallet.debit({
        amountPaise: gate.charge_paise,
        reason: 'ai_overage',
        referenceType,
        referenceId,
        description: `AI reply beyond the ${gate.plan.name} plan allowance`,
      });
      result.charged_paise = debit.duplicate ? 0 : gate.charge_paise;
      result.balance_paise = debit.balance_paise;
      await warnWalletLow(debit.balance_paise, gate);
    } else if (gate.allowance > 0) {
      // Plan replies left after this one.
      const leftAfter = Math.max(gate.allowance - (gate.used + 1), 0);
      if (leftAfter <= Math.ceil(gate.allowance * WARN_FRACTION)) {
        const trialNote = gate.plan.is_trial
          ? (leftAfter === 0 ? `Your free trial's ${gate.allowance} AI replies are used up. Upgrade to a plan to keep the AI replying.` : `${leftAfter} of your free trial's ${gate.allowance} AI replies are left. Upgrade to a plan for a monthly allowance.`)
          : null;
        await alerts.raise({
          key: `ai_allowance_low:${gate.period_start.toISOString()}`,
          kind: 'ai_allowance_low',
          message: trialNote || (leftAfter === 0
            ? `Your ${gate.plan.name} plan's ${gate.allowance} AI replies for this period are used up. Further replies are paid from the wallet at ${wallet.formatInr(gate.plan.ai_overage_price_paise)} each.`
            : `${leftAfter} of your ${gate.allowance} AI replies are left this period (under 20 percent). Replies beyond that are paid from the wallet at ${wallet.formatInr(gate.plan.ai_overage_price_paise)} each.`),
          meta: { left: leftAfter, allowance: gate.allowance, period_start: gate.period_start },
        });
      }
    }
  } catch (error) {
    // A wallet race (two replies for the last rupee) lands here: the reply
    // already went out, so log it and let the next check() stop the AI.
    console.error('[billing/aiAllowance] Could not settle an AI reply:', error.message);
    result.error = error.message;
  }
  return result;
}

async function warnWalletLow(balancePaise, gate) {
  const topup = await wallet.lastTopup();
  if (!topup) return;
  const threshold = Math.ceil(Number(topup.amount_paise) * WARN_FRACTION);
  if (balancePaise > threshold) return;
  await alerts.raise({
    key: `wallet_low:${topup.id}`,
    kind: 'wallet_low',
    message: balancePaise <= 0
      ? 'Your wallet is empty. AI replies stop until you top it up.'
      : `Your wallet is down to ${wallet.formatInr(balancePaise)} (under 20 percent of your last top-up). Top up to keep AI replies going.`,
    meta: { balance_paise: balancePaise, last_topup_paise: topup.amount_paise, plan: gate?.plan?.code || null },
  });
}

module.exports = { REASONS, WARN_FRACTION, requirePlan, check, settle, notifyBlocked, aiRepliesSince };
