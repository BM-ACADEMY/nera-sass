const pool = require('../../db/connection');
const axios = require('axios');

/**
 * Log an individual API request (ValueSERP, DataForSEO, etc.)
 */
async function logApiRequest({
  provider = 'valueserp',
  clientId = null,
  clientName = null,
  searchQuery = '',
  directory = 'Google',
  creditsConsumed = 1,
  responseStatus = '200',
  scanDurationMs = 0,
  isCached = false
}) {
  try {
    // If clientName is missing but clientId exists, look up client name
    let resolvedName = clientName;
    if (!resolvedName && clientId) {
      const cRes = await pool.query('SELECT business_name, display_name FROM mafiya_gmb_clients WHERE id = $1', [clientId]);
      if (cRes.rowCount > 0) {
        resolvedName = cRes.rows[0].display_name || cRes.rows[0].business_name;
      }
    }

    const res = await pool.query(
      `INSERT INTO api_usage_logs 
        (provider, client_id, client_name, search_query, directory, credits_consumed, response_status, scan_duration_ms, is_cached, request_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       RETURNING *`,
      [provider, clientId, resolvedName || 'System', searchQuery, directory, isCached ? 0 : creditsConsumed, String(responseStatus), scanDurationMs, isCached]
    );

    return res.rows[0];
  } catch (err) {
    console.error('[Usage Service] Failed to log API request:', err.message);
    return null;
  }
}

/**
 * Fetch Account Usage Summary (Dashboard stats & credit protection warning)
 */
async function getAccountUsageSummary(provider = 'valueserp') {
  const apiKey = process.env.VALUESERP_API_KEY;

  let apiAccountData = null;
  if (provider === 'valueserp' && apiKey) {
    try {
      const response = await axios.get('https://api.valueserp.com/account', {
        params: { api_key: apiKey },
        timeout: 8000
      });
      if (response.data && response.data.account_info) {
        apiAccountData = response.data.account_info;
      }
    } catch (err) {
      console.warn('[Usage Service] ValueSERP account API call failed, falling back to database metrics:', err.message);
    }
  }

  // Database metrics
  const statsRes = await pool.query(`
    SELECT 
      COALESCE(SUM(credits_consumed), 0) as total_credits_used,
      COUNT(*) as total_requests,
      COUNT(*) FILTER (WHERE request_time >= CURRENT_DATE) as today_requests,
      COUNT(*) FILTER (WHERE DATE_TRUNC('month', request_time) = DATE_TRUNC('month', CURRENT_DATE)) as month_requests,
      MAX(request_time) as last_call_time
    FROM api_usage_logs
    WHERE provider = $1
  `, [provider]);

  const dbStats = statsRes.rows[0];

  // Get warning threshold setting from DB
  const thresholdRes = await pool.query(`SELECT value FROM usage_settings WHERE key = 'warning_threshold_pct'`);
  const warningThresholdPct = parseFloat(thresholdRes.rows[0]?.value || '20');

  // Estimate or parse credits
  let totalAvailableCredits = 15000; // default estimated monthly quota
  let creditsUsed = parseInt(dbStats.total_credits_used, 10);
  let remainingCredits = Math.max(0, totalAvailableCredits - creditsUsed);

  if (apiAccountData) {
    const remaining = apiAccountData.topup_credits_remaining ??
                      apiAccountData.monthly_credits_remaining ??
                      apiAccountData.credits_remaining ??
                      0;

    remainingCredits = remaining;

    const currentMonthUsage = apiAccountData.usage_history?.find(u => u.is_current_month);
    const monthUsed = currentMonthUsage ? (currentMonthUsage.credits_total_for_month || 0) : 0;

    const dbUsed = parseInt(dbStats.total_credits_used, 10);
    creditsUsed = Math.max(dbUsed, monthUsed);
    totalAvailableCredits = remainingCredits + creditsUsed;
  }

  const remainingPct = totalAvailableCredits > 0 ? Math.round((remainingCredits / totalAvailableCredits) * 100) : 0;
  const isWarning = remainingPct <= warningThresholdPct;

  return {
    provider,
    totalCreditsAvailable: totalAvailableCredits,
    totalCreditsUsed: creditsUsed,
    remainingCredits,
    remainingPct,
    totalApiRequests: parseInt(dbStats.total_requests, 10),
    todayApiRequests: parseInt(dbStats.today_requests, 10),
    monthApiRequests: parseInt(dbStats.month_requests, 10),
    lastApiCallTime: dbStats.last_call_time,
    warningThresholdPct,
    isWarning,
    warningMessage: isWarning ? `Warning: Remaining ValueSERP API credits are at ${remainingPct}% (below ${warningThresholdPct}% threshold).` : null
  };
}

/**
 * Get Client Usage Table (With Search, Filter, Sort, Pagination)
 */
async function getClientUsageList({
  provider = 'valueserp',
  search = '',
  filter = '',
  sort = 'credits',
  order = 'desc',
  page = 1,
  limit = 10
}) {
  const offset = (page - 1) * limit;

  let query = `
    SELECT 
      c.id as client_id,
      c.contact_person,
      c.business_name,
      c.display_name,
      c.business_category,
      COALESCE(u.total_searches, 0) as total_searches,
      COALESCE(u.credits_used, 0) as credits_used,
      u.last_scan_time,
      s.last_scan_status,
      CASE 
        WHEN COALESCE(u.total_searches, 0) > 0 THEN ROUND(COALESCE(u.credits_used, 0)::numeric / COALESCE(u.total_searches, 1), 2)
        ELSE 0 
      END as avg_credits_per_scan
    FROM mafiya_gmb_clients c
    LEFT JOIN (
      SELECT 
        client_id,
        COUNT(*) as total_searches,
        SUM(credits_consumed) as credits_used,
        MAX(request_time) as last_scan_time
      FROM api_usage_logs
      WHERE provider = $1
      GROUP BY client_id
    ) u ON c.id = u.client_id
    LEFT JOIN (
      SELECT DISTINCT ON ("businessId")
        "businessId",
        score,
        matched,
        mismatched,
        missing,
        "lastScan",
        CASE 
          WHEN mismatched > 0 THEN 'Mismatch'
          WHEN matched > 0 AND mismatched = 0 THEN 'Verified'
          WHEN missing > 0 THEN 'Missing'
          ELSE 'Completed'
        END as last_scan_status
      FROM citation_scans
      ORDER BY "businessId", id DESC
    ) s ON c.id = s."businessId"
    WHERE 1=1
  `;

  const params = [provider];
  let paramIdx = 2;

  // Search filter
  if (search && search.trim() !== '') {
    query += ` AND (c.business_name ILIKE $${paramIdx} OR c.display_name ILIKE $${paramIdx} OR c.contact_person ILIKE $${paramIdx})`;
    params.push(`%${search.trim()}%`);
    paramIdx++;
  }

  // Status filter
  if (filter && filter !== 'all') {
    query += ` AND COALESCE(s.last_scan_status, 'Completed') ILIKE $${paramIdx}`;
    params.push(`%${filter.trim()}%`);
    paramIdx++;
  }

  // Sort direction
  const dir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  let orderByClause = 'ORDER BY COALESCE(u.credits_used, 0) DESC';

  if (sort === 'searches') orderByClause = `ORDER BY COALESCE(u.total_searches, 0) ${dir}`;
  else if (sort === 'credits') orderByClause = `ORDER BY COALESCE(u.credits_used, 0) ${dir}`;
  else if (sort === 'last_scan') orderByClause = `ORDER BY u.last_scan_time ${dir} NULLS LAST`;
  else if (sort === 'business_name') orderByClause = `ORDER BY c.business_name ${dir}`;
  else if (sort === 'client_name') orderByClause = `ORDER BY c.contact_person ${dir}`;

  query += ` ${orderByClause}`;

  // Count total matching items
  const countResult = await pool.query(`SELECT COUNT(*) FROM (${query}) count_tbl`, params);
  const totalCount = parseInt(countResult.rows[0].count, 10);

  // Apply pagination
  query += ` LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
  params.push(limit, offset);

  const result = await pool.query(query, params);

  const rows = result.rows.map(row => {
    const lastScanDate = row.last_scan_time ? new Date(row.last_scan_time).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    const lastScanTimeStr = row.last_scan_time ? new Date(row.last_scan_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—';

    return {
      clientId: row.client_id,
      clientName: row.contact_person || 'Client',
      businessName: row.display_name || row.business_name,
      totalSearches: parseInt(row.total_searches, 10),
      creditsUsed: parseInt(row.credits_used, 10),
      lastScanDate,
      lastScanTime: lastScanTimeStr,
      lastScanTimestamp: row.last_scan_time,
      scanStatus: row.last_scan_status || 'Completed',
      avgCreditsPerScan: parseFloat(row.avg_credits_per_scan) || 0
    };
  });

  return {
    rows,
    pagination: {
      totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit) || 1
    }
  };
}

/**
 * Get Client Usage Details (Modal/Drawer)
 */
async function getClientUsageDetails(clientId, provider = 'valueserp') {
  // Client info
  const clientRes = await pool.query('SELECT * FROM mafiya_gmb_clients WHERE id = $1', [clientId]);
  if (clientRes.rowCount === 0) {
    throw new Error('Client not found');
  }
  const client = clientRes.rows[0];

  // Scan stats from citation_scans
  const scansRes = await pool.query(`
    SELECT 
      COUNT(*) as total_scans,
      MIN("lastScan") as first_scan_date,
      MAX("lastScan") as last_scan_date
    FROM citation_scans
    WHERE "businessId" = $1
  `, [clientId]);

  const scanStats = scansRes.rows[0];

  // API logs stats
  const logStatsRes = await pool.query(`
    SELECT 
      COUNT(*) as total_requests,
      COALESCE(SUM(credits_consumed), 0) as total_credits,
      AVG(scan_duration_ms) as avg_duration_ms,
      MAX(scan_duration_ms) as last_duration_ms
    FROM api_usage_logs
    WHERE client_id = $1 AND provider = $2
  `, [clientId, provider]);

  const logStats = logStatsRes.rows[0];

  // Directory breakdown
  const directoryRes = await pool.query(`
    SELECT 
      directory,
      COUNT(*) as request_count,
      COALESCE(SUM(credits_consumed), 0) as credits_consumed
    FROM api_usage_logs
    WHERE client_id = $1 AND provider = $2
    GROUP BY directory
    ORDER BY credits_consumed DESC
  `, [clientId, provider]);

  // Scan history logs (last 30 requests)
  const historyRes = await pool.query(`
    SELECT 
      id,
      directory,
      search_query,
      credits_consumed,
      response_status,
      scan_duration_ms,
      is_cached,
      request_time
    FROM api_usage_logs
    WHERE client_id = $1 AND provider = $2
    ORDER BY id DESC
    LIMIT 30
  `, [clientId, provider]);

  return {
    client: {
      id: client.id,
      clientName: client.contact_person,
      businessName: client.display_name || client.business_name,
      businessCategory: client.business_category || client.custom_category,
      phone: client.phone_number,
      address: client.business_address
    },
    metrics: {
      totalCitationScans: parseInt(scanStats.total_scans, 10),
      totalValueSerpRequests: parseInt(logStats.total_requests, 10),
      totalCreditsConsumed: parseInt(logStats.total_credits, 10),
      firstScanDate: scanStats.first_scan_date ? new Date(scanStats.first_scan_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
      lastScanDate: scanStats.last_scan_date ? new Date(scanStats.last_scan_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—',
      lastScanDurationMs: parseInt(logStats.last_duration_ms || 0, 10),
      avgScanDurationMs: Math.round(parseFloat(logStats.avg_duration_ms || 0))
    },
    directoryUsage: directoryRes.rows.map(d => ({
      directory: d.directory || 'General',
      requestCount: parseInt(d.request_count, 10),
      creditsConsumed: parseInt(d.credits_consumed, 10)
    })),
    scanHistory: historyRes.rows.map(h => ({
      id: h.id,
      directory: h.directory,
      searchQuery: h.search_query,
      creditsConsumed: parseInt(h.credits_consumed, 10),
      responseStatus: h.response_status,
      scanDurationMs: h.scan_duration_ms,
      isCached: h.is_cached,
      requestTime: h.request_time ? new Date(h.request_time).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'
    }))
  };
}

/**
 * Check if a recent scan exists for duplicate scan prevention / caching
 */
async function checkScanCache(clientId, maxAgeMinutes = 60) {
  try {
    const res = await pool.query(`
      SELECT * FROM citation_scans
      WHERE "businessId" = $1
        AND "lastScan" >= NOW() - INTERVAL '1 minute' * $2
      ORDER BY id DESC
      LIMIT 1
    `, [clientId, maxAgeMinutes]);

    if (res.rowCount > 0) {
      return {
        hasRecentScan: true,
        latestScan: res.rows[0]
      };
    }
  } catch (err) {
    console.error('[Usage Service] Cache check error:', err.message);
  }

  return { hasRecentScan: false, latestScan: null };
}

/**
 * Update warning threshold setting
 */
async function updateSettings(key, value) {
  await pool.query(`
    INSERT INTO usage_settings (key, value, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `, [key, String(value)]);
  return { key, value };
}

module.exports = {
  logApiRequest,
  getAccountUsageSummary,
  getClientUsageList,
  getClientUsageDetails,
  checkScanCache,
  updateSettings
};
