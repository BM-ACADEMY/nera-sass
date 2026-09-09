const pool = require('../db/connection');

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
    const clientRes = await pool.query(
      'SELECT client_type, plan_id FROM mafiya_gmb_clients WHERE id = $1',
      [clientId]
    );

    if (clientRes.rows.length === 0) {
      return { allowed: false, error: 'Client not found', limit: 0, current: 0 };
    }

    const { client_type, plan_id } = clientRes.rows[0];

    // 2. Internal clients are completely unlimited (bypass limits)
    if (!client_type || client_type === 'internal') {
      return { allowed: true, limit: -1, current: 0 };
    }

    // 3. Paid clients without a plan defaults to 0 limits
    if (!plan_id) {
      return { allowed: false, error: 'Paid client has no plan assigned', limit: 0, current: 0 };
    }

    // 4. Fetch Plan Feature limit
    const featureRes = await pool.query(
      'SELECT limit_value, daily_limit FROM mafiya_plan_features WHERE plan_id = $1 AND feature_key = $2',
      [plan_id, featureKey]
    );

    let limit = 0;
    let daily_limit = -1;
    if (featureRes.rows.length > 0) {
      limit = featureRes.rows[0].limit_value;
      daily_limit = featureRes.rows[0].daily_limit !== undefined ? featureRes.rows[0].daily_limit : -1;
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
