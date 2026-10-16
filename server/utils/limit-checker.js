const { MafiyaGmbClients, MafiyaPlanFeatures } = require('../models');

/**
 * Checks if a specific feature limit has been reached for a GMB Client.
 * If the GMB client is internal, the limit is bypassed (unlimited).
 * If the GMB client is paid, it enforces the limit value set in their assigned plan.
 * 
 * @param {number|string} clientId - The GMB client ID.
 * @param {string} featureKey - The feature key (e.g. 'mafiya_keywords', 'mafiya_ai_replies', 'mafiya_geogrid_scans', 'mafiya_citations_scans', 'mafiya_street_posts').
 * @param {function} countGetter - An async function that returns the current count of usage (e.g. current keywords tracked, monthly AI replies used, etc.).
 * @returns {Promise<{allowed: boolean, limit: number, current: number}>}
 */
async function checkLimit(clientId, featureKey, countGetter, dailyCountGetter = null) {
  try {
    // 1. Fetch GMB Client details
    const client = await MafiyaGmbClients.findOne({ id: clientId }, { client_type: 1, plan_id: 1 }).lean();

    if (!client) {
      return { allowed: false, error: 'Client not found', limit: 0, current: 0 };
    }

    const { client_type, plan_id } = client;

    // 2. Internal clients are completely unlimited (bypass limits)
    if (!client_type || client_type === 'internal') {
      return { allowed: true, limit: -1, current: 0 };
    }

    // 3. Paid clients without a plan defaults to 0 limits
    if (!plan_id) {
      return { allowed: false, error: 'Paid client has no plan assigned', limit: 0, current: 0 };
    }

    // 4. Fetch Plan Feature limit
    const feature = await MafiyaPlanFeatures.findOne(
      { plan_id, feature_key: featureKey },
      { limit_value: 1, daily_limit: 1 }
    ).lean();

    let limit = 0;
    let daily_limit = -1;
    if (feature) {
      limit = feature.limit_value;
      daily_limit = feature.daily_limit !== undefined && feature.daily_limit !== null ? feature.daily_limit : -1;
    }

    // -1 represents unlimited on a paid plan
    if (limit === -1 && daily_limit === -1) {
      return { allowed: true, limit: -1, current: 0 };
    }

    let current = 0;
    // 5. Evaluate current usage using countGetter callback (Monthly)
    if (limit !== -1 && countGetter) {
      current = await countGetter();
      if (current >= limit) {
        return { allowed: false, limit, current, isDailyLimit: false };
      }
    }

    // Evaluate daily limit
    if (daily_limit !== -1 && dailyCountGetter) {
      const dailyCurrent = await dailyCountGetter();
      if (dailyCurrent >= daily_limit) {
        return { allowed: false, limit: daily_limit, current: dailyCurrent, isDailyLimit: true };
      }
    }

    return { allowed: true, limit, current };
  } catch (err) {
    console.error(`[Limit Checker] Error checking limit for key: ${featureKey}:`, err);
    throw err;
  }
}

module.exports = { checkLimit };
