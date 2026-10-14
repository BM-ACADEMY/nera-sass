const axios = require('axios');
const { MafiyaGmbClients, ApiUsageLogs, UsageSettings, CitationScans } = require('../../models');
const { escapeRegex } = require('../../db/mongo');

const startOfUtcDay = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };
const startOfUtcMonth = () => { const d = startOfUtcDay(); d.setUTCDate(1); return d; };

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
      const client = await MafiyaGmbClients.findOne({ id: clientId }, { business_name: 1, display_name: 1 }).lean();
      if (client) {
        resolvedName = client.display_name || client.business_name;
      }
    }

    const log = await ApiUsageLogs.create({
      provider,
      client_id: clientId,
      client_name: resolvedName || 'System',
      search_query: searchQuery,
      directory,
      credits_consumed: isCached ? 0 : creditsConsumed,
      response_status: String(responseStatus),
      scan_duration_ms: scanDurationMs,
      is_cached: isCached,
      request_time: new Date(),
    });

    return log.toObject();
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
  const [stats] = await ApiUsageLogs.aggregate([
    { $match: { provider } },
    {
      $group: {
        _id: null,
        total_credits_used: { $sum: { $ifNull: ['$credits_consumed', 0] } },
        total_requests: { $sum: 1 },
        today_requests: { $sum: { $cond: [{ $gte: ['$request_time', startOfUtcDay()] }, 1, 0] } },
        month_requests: { $sum: { $cond: [{ $gte: ['$request_time', startOfUtcMonth()] }, 1, 0] } },
        last_call_time: { $max: '$request_time' },
      },
    },
  ]);
  const dbStats = stats || { total_credits_used: 0, total_requests: 0, today_requests: 0, month_requests: 0, last_call_time: null };

  // Get warning threshold setting from DB
  const thresholdSetting = await UsageSettings.findOne({ key: 'warning_threshold_pct' }, { value: 1 }).lean();
  const warningThresholdPct = parseFloat(thresholdSetting?.value || '20');

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

const scanStatusOf = (scan) => {
  if (scan.mismatched > 0) return 'Mismatch';
  if (scan.matched > 0 && scan.mismatched === 0) return 'Verified';
  if (scan.missing > 0) return 'Missing';
  return 'Completed';
};

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

  const clientFilter = {};
  if (search && search.trim() !== '') {
    const pattern = new RegExp(escapeRegex(search.trim()), 'i');
    clientFilter.$or = [{ business_name: pattern }, { display_name: pattern }, { contact_person: pattern }];
  }
  const clients = await MafiyaGmbClients.find(clientFilter, {
    _id: 0, id: 1, contact_person: 1, business_name: 1, display_name: 1, business_category: 1,
  }).lean();

  // Per-client API usage
  const usage = await ApiUsageLogs.aggregate([
    { $match: { provider } },
    {
      $group: {
        _id: '$client_id',
        total_searches: { $sum: 1 },
        credits_used: { $sum: { $ifNull: ['$credits_consumed', 0] } },
        last_scan_time: { $max: '$request_time' },
      },
    },
  ]);
  const usageByClient = new Map(usage.map((u) => [u._id, u]));

  // Latest citation scan per client (DISTINCT ON "businessId" ORDER BY id DESC)
  const latestScans = await CitationScans.aggregate([
    { $sort: { businessId: 1, id: -1 } },
    { $group: { _id: '$businessId', matched: { $first: '$matched' }, mismatched: { $first: '$mismatched' }, missing: { $first: '$missing' } } },
  ]);
  const scanByClient = new Map(latestScans.map((s) => [s._id, s]));

  let rows = clients.map((c) => {
    const u = usageByClient.get(c.id);
    const s = scanByClient.get(c.id);
    const totalSearches = u?.total_searches || 0;
    const creditsUsed = u?.credits_used || 0;
    return {
      client_id: c.id,
      contact_person: c.contact_person,
      business_name: c.business_name,
      display_name: c.display_name,
      business_category: c.business_category,
      total_searches: totalSearches,
      credits_used: creditsUsed,
      last_scan_time: u?.last_scan_time || null,
      last_scan_status: s ? scanStatusOf(s) : null,
      avg_credits_per_scan: totalSearches > 0 ? Math.round((creditsUsed / totalSearches) * 100) / 100 : 0,
    };
  });

  // Status filter
  if (filter && filter !== 'all') {
    const pattern = new RegExp(escapeRegex(filter.trim()), 'i');
    rows = rows.filter((row) => pattern.test(row.last_scan_status || 'Completed'));
  }

  // Sort
  const dir = order.toLowerCase() === 'asc' ? 1 : -1;
  const compareText = (a, b) => (a == null ? 1 : b == null ? -1 : String(a).localeCompare(String(b)) * dir);
  if (sort === 'searches') rows.sort((a, b) => (a.total_searches - b.total_searches) * dir);
  else if (sort === 'credits') rows.sort((a, b) => (a.credits_used - b.credits_used) * dir);
  else if (sort === 'last_scan') {
    rows.sort((a, b) => {
      if (!a.last_scan_time && !b.last_scan_time) return 0;
      if (!a.last_scan_time) return 1; // NULLS LAST
      if (!b.last_scan_time) return -1;
      return (new Date(a.last_scan_time) - new Date(b.last_scan_time)) * dir;
    });
  } else if (sort === 'business_name') rows.sort((a, b) => compareText(a.business_name, b.business_name));
  else if (sort === 'client_name') rows.sort((a, b) => compareText(a.contact_person, b.contact_person));
  else rows.sort((a, b) => b.credits_used - a.credits_used);

  const totalCount = rows.length;
  const pageRows = rows.slice(offset, offset + Number(limit));

  return {
    rows: pageRows.map(row => {
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
    }),
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
  const client = await MafiyaGmbClients.findOne({ id: clientId }).lean();
  if (!client) {
    throw new Error('Client not found');
  }

  // Scan stats from citation_scans
  const [scanStats = { total_scans: 0, first_scan_date: null, last_scan_date: null }] = await CitationScans.aggregate([
    { $match: { businessId: Number(clientId) } },
    { $group: { _id: null, total_scans: { $sum: 1 }, first_scan_date: { $min: '$lastScan' }, last_scan_date: { $max: '$lastScan' } } },
  ]);

  const logMatch = { client_id: Number(clientId), provider };

  // API logs stats
  const [logStats = { total_requests: 0, total_credits: 0, avg_duration_ms: null, last_duration_ms: null }] = await ApiUsageLogs.aggregate([
    { $match: logMatch },
    {
      $group: {
        _id: null,
        total_requests: { $sum: 1 },
        total_credits: { $sum: { $ifNull: ['$credits_consumed', 0] } },
        avg_duration_ms: { $avg: '$scan_duration_ms' },
        last_duration_ms: { $max: '$scan_duration_ms' },
      },
    },
  ]);

  // Directory breakdown
  const directoryRows = await ApiUsageLogs.aggregate([
    { $match: logMatch },
    { $group: { _id: '$directory', request_count: { $sum: 1 }, credits_consumed: { $sum: { $ifNull: ['$credits_consumed', 0] } } } },
    { $sort: { credits_consumed: -1 } },
  ]);

  // Scan history logs (last 30 requests)
  const historyRows = await ApiUsageLogs.find(logMatch, {
    _id: 0, id: 1, directory: 1, search_query: 1, credits_consumed: 1, response_status: 1, scan_duration_ms: 1, is_cached: 1, request_time: 1,
  }).sort({ id: -1 }).limit(30).lean();

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
    directoryUsage: directoryRows.map(d => ({
      directory: d._id || 'General',
      requestCount: parseInt(d.request_count, 10),
      creditsConsumed: parseInt(d.credits_consumed, 10)
    })),
    scanHistory: historyRows.map(h => ({
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
    const latestScan = await CitationScans.findOne(
      { businessId: clientId, lastScan: { $gte: new Date(Date.now() - maxAgeMinutes * 60 * 1000) } },
      { _id: 0 }
    ).sort({ id: -1 }).lean();

    if (latestScan) {
      return {
        hasRecentScan: true,
        latestScan
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
  await UsageSettings.updateOne(
    { key },
    { $set: { value: String(value), updated_at: new Date() } },
    { upsert: true }
  );
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
