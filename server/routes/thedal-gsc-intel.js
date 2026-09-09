const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const axios = require('axios');
const https = require('https');

const tokensFile = path.join(__dirname, '../data/gsc_tokens.json');
const inspectionHistoryFile = path.join(__dirname, '../data/gsc_inspection_history.json');

// Ensure token file exists
if (!fs.existsSync(tokensFile)) {
  fs.writeFileSync(tokensFile, JSON.stringify({}), 'utf8');
}
if (!fs.existsSync(inspectionHistoryFile)) fs.writeFileSync(inspectionHistoryFile, JSON.stringify([]), 'utf8');

const getTokens = () => JSON.parse(fs.readFileSync(tokensFile, 'utf8'));
const saveTokens = (data) => fs.writeFileSync(tokensFile, JSON.stringify(data, null, 2), 'utf8');
const getInspectionHistory = () => JSON.parse(fs.readFileSync(inspectionHistoryFile, 'utf8'));
const saveInspectionHistory = data => fs.writeFileSync(inspectionHistoryFile, JSON.stringify(data.slice(-500), null, 2), 'utf8');

const getAuthorizedClient = (clientId = 'default') => {
  const tokens = getTokens();
  const clientTokens = tokens[clientId];
  if (!clientTokens?.refresh_token) {
    const error = new Error('Google Search Console is not connected');
    error.status = 401;
    throw error;
  }
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_GSCINTEL
  );
  client.setCredentials(clientTokens);
  return client;
};

const sendGoogleError = (res, error) => {
  const status = error.status || error.code || 500;
  if (status === 401) return res.status(401).json({ error: 'Google Search Console is not connected. Please reconnect.' });
  if (status === 403) return res.status(403).json({ error: 'This Google account does not have permission for that property or action.' });
  if (status === 429) return res.status(429).json({ error: 'Google Search Console quota exceeded. Please try again later.' });
  console.error('[GSC API]', error.message || error);
  return res.status(500).json({ error: error.message || 'Google Search Console request failed' });
};

// Initialize OAuth2 client
const port = process.env.PORT || 3600;
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_CALLBACK_GSCINTEL
);

// 1. Check Status (Is the client verified?)
router.get('/status', (req, res) => {
  const { clientId = 'default' } = req.query; // Support multi-client
  const tokens = getTokens();

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.json({ isVerified: false, error: 'MISSING_ENV_KEYS' });
  }

  if (tokens[clientId] && tokens[clientId].refresh_token) {
    return res.json({ isVerified: true, connectedEmail: tokens[clientId].connected_email || null });
  }

  res.json({ isVerified: false });
});

// Remove a saved GSC connection so the user can choose another Google account.
router.delete('/connection', (req, res) => {
  const { clientId = 'default' } = req.query;
  const tokens = getTokens();

  if (tokens[clientId]) {
    delete tokens[clientId];
    saveTokens(tokens);
  }

  res.json({ success: true, isVerified: false });
});

// 2. Generate Google OAuth URL
router.get('/auth/google', (req, res) => {
  const { clientId = 'default' } = req.query;

  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(500).json({ error: 'Please set GOOGLE_CLIENT_ID in your .env file.' });
  }

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline', // Critical for getting refresh token
    scope: [
      'https://www.googleapis.com/auth/webmasters',
      'https://www.googleapis.com/auth/userinfo.email',
      'openid'
    ],
    state: clientId, // Pass client ID to callback
    prompt: 'select_account consent' // Always show the account chooser and request a refresh token
  });

  res.redirect(url);
});

// 3. OAuth Callback
router.get('/auth/callback', async (req, res) => {
  const { code, state: clientId } = req.query;

  try {
    const { tokens } = await oauth2Client.getToken(code);

    // We strictly need the refresh_token for background/future requests
    const allTokens = getTokens();
    if (tokens.refresh_token) {
      allTokens[clientId] = tokens;
      saveTokens(allTokens);
    } else if (allTokens[clientId]) {
      // If we already had a refresh token, just update access token
      allTokens[clientId].access_token = tokens.access_token;
    }

    oauth2Client.setCredentials(allTokens[clientId]);
    const profile = await google.oauth2({ version: 'v2', auth: oauth2Client }).userinfo.get().catch(() => ({ data: {} }));
    allTokens[clientId].connected_email = profile.data.email || allTokens[clientId].connected_email || null;
    saveTokens(allTokens);

    // Redirect back to frontend
    const frontendUrl = process.env.VITE_FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/thedal/gsc-intel?verified=true`);
  } catch (error) {
    console.error('Error exchanging Google OAuth code:', error);
    res.status(500).send('Authentication failed');
  }
});

// Official GSC properties available to the connected Google account.
router.get('/properties', async (req, res) => {
  try {
    const auth = getAuthorizedClient(req.query.clientId);
    const response = await google.searchconsole({ version: 'v1', auth }).sites.list();
    res.json({ properties: (response.data.siteEntry || []).map(item => ({ siteUrl: item.siteUrl, permissionLevel: item.permissionLevel })) });
  } catch (error) { sendGoogleError(res, error); }
});

// Inspect the version of a URL currently held in Google's index.
router.post('/inspect', async (req, res) => {
  const { clientId = 'default', siteUrl, inspectionUrl, languageCode = 'en-US' } = req.body;
  if (!siteUrl || !inspectionUrl) return res.status(400).json({ error: 'siteUrl and inspectionUrl are required' });
  try {
    const auth = getAuthorizedClient(clientId);
    const response = await google.searchconsole({ version: 'v1', auth }).urlInspection.index.inspect({
      requestBody: { siteUrl, inspectionUrl, languageCode }
    });
    const result = { inspectionUrl, inspectedAt: new Date().toISOString(), ...response.data.inspectionResult };
    const history = getInspectionHistory();
    history.push({ clientId, siteUrl, ...result });
    saveInspectionHistory(history);
    res.json(result);
  } catch (error) { sendGoogleError(res, error); }
});

router.get('/inspect/history', (req, res) => {
  const { clientId = 'default', siteUrl } = req.query;
  const history = getInspectionHistory().filter(item => item.clientId === clientId && (!siteUrl || item.siteUrl === siteUrl)).slice(-100).reverse();
  res.json({ history });
});

router.post('/inspect/queue', async (req, res) => {
  const { clientId = 'default', siteUrl, urls = [] } = req.body;
  if (!siteUrl || !Array.isArray(urls) || !urls.length) return res.status(400).json({ error: 'siteUrl and urls are required' });
  if (urls.length > 20) return res.status(400).json({ error: 'Inspect up to 20 URLs per batch' });
  try {
    const auth = getAuthorizedClient(clientId);
    const service = google.searchconsole({ version: 'v1', auth });
    const results = [];
    for (const inspectionUrl of urls) {
      try {
        const response = await service.urlInspection.index.inspect({ requestBody: { siteUrl, inspectionUrl, languageCode: 'en-US' } });
        results.push({ inspectionUrl, inspectedAt: new Date().toISOString(), ...response.data.inspectionResult });
      } catch (error) { results.push({ inspectionUrl, error: error.message }); }
    }
    const history = getInspectionHistory();
    results.filter(item => !item.error).forEach(item => history.push({ clientId, siteUrl, ...item }));
    saveInspectionHistory(history);
    res.json({ results });
  } catch (error) { sendGoogleError(res, error); }
});

router.get('/sitemaps', async (req, res) => {
  const { clientId = 'default', siteUrl } = req.query;
  if (!siteUrl) return res.status(400).json({ error: 'siteUrl is required' });
  try {
    const auth = getAuthorizedClient(clientId);
    const response = await google.searchconsole({ version: 'v1', auth }).sitemaps.list({ siteUrl });
    res.json({ sitemaps: response.data.sitemap || [] });
  } catch (error) { sendGoogleError(res, error); }
});

router.post('/sitemaps', async (req, res) => {
  const { clientId = 'default', siteUrl, feedpath } = req.body;
  if (!siteUrl || !feedpath) return res.status(400).json({ error: 'siteUrl and feedpath are required' });
  try {
    const auth = getAuthorizedClient(clientId);
    await google.searchconsole({ version: 'v1', auth }).sitemaps.submit({ siteUrl, feedpath });
    res.json({ success: true });
  } catch (error) { sendGoogleError(res, error); }
});

router.delete('/sitemaps', async (req, res) => {
  const { clientId = 'default', siteUrl, feedpath } = req.query;
  if (!siteUrl || !feedpath) return res.status(400).json({ error: 'siteUrl and feedpath are required' });
  try {
    const auth = getAuthorizedClient(clientId);
    await google.searchconsole({ version: 'v1', auth }).sitemaps.delete({ siteUrl, feedpath });
    res.json({ success: true });
  } catch (error) { sendGoogleError(res, error); }
});

router.get('/sitemap-urls', async (req, res) => {
  const { siteUrl, feedpath } = req.query;
  if (!siteUrl || !feedpath) return res.status(400).json({ error: 'siteUrl and feedpath are required' });
  try {
    const propertyHost = siteUrl.replace('sc-domain:', '').replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
    const feed = new URL(feedpath);
    const feedHost = feed.hostname.replace(/^www\./, '');
    if (feed.protocol !== 'https:' || (feedHost !== propertyHost && !feedHost.endsWith(`.${propertyHost}`))) return res.status(400).json({ error: 'Sitemap must be HTTPS and belong to the selected property' });
    const response = await axios.get(feed.href, { timeout: 15000, maxContentLength: 5_000_000, responseType: 'text' });
    const urls = [...String(response.data).matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map(match => match[1].trim()).filter(url => !url.endsWith('.xml')).slice(0, 500);
    res.json({ feedpath, urls, truncated: urls.length === 500 });
  } catch (error) { res.status(502).json({ error: `Could not download sitemap: ${error.message}` }); }
});

router.get('/technical-audit', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url is required' });
  try {
    const target = new URL(url.startsWith('http') ? url : `https://${url}`);
    const response = await axios.get(target.href, { timeout: 15000, maxRedirects: 8, maxContentLength: 2_000_000, httpsAgent: new https.Agent({ rejectUnauthorized: true }) });
    const html = String(response.data || '');
    const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)?.[1] || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical/i)?.[1] || null;
    const robots = html.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)/i)?.[1] || null;
    res.json({ requestedUrl: target.href, finalUrl: response.request?.res?.responseUrl || target.href, status: response.status, https: (response.request?.res?.responseUrl || target.href).startsWith('https://'), redirected: (response.request?.res?.responseUrl || target.href) !== target.href, canonical, robots, certificateValid: true });
  } catch (error) { res.json({ requestedUrl: url, status: error.response?.status || null, https: false, certificateValid: !String(error.message).toLowerCase().includes('certificate'), error: error.message }); }
});

// 4. Fetch Live Data from GSC
router.get('/', async (req, res) => {
  const isDemo = req.headers['x-data-mode'] === 'demo';
  const { clientId = 'default', days = '28Days', device = 'All', country = 'All', searchType = 'web', queryFilter = '', queryOperator = 'includingRegex', siteUrl, startDate: customStart, endDate: customEnd } = req.query;

  if (!siteUrl) {
    return res.status(400).json({ error: 'siteUrl is required (e.g., https://bmtechx.in/)' });
  }

  if (isDemo) {
    return res.json({
      metrics: {
        clicks: 12450,
        impressions: 145000,
        ctr: 8.5,
        position: 14.2
      },
      topQueries: [
        { query: 'digital marketing agency', clicks: 1200, impressions: 15000, ctr: 8.0, position: 5.1 },
        { query: 'seo services', clicks: 950, impressions: 12000, ctr: 7.9, position: 4.8 },
        { query: 'web development company', clicks: 800, impressions: 10000, ctr: 8.0, position: 6.2 },
        { query: 'local seo expert', clicks: 500, impressions: 5000, ctr: 10.0, position: 3.5 },
        { query: 'social media management', clicks: 450, impressions: 8000, ctr: 5.6, position: 7.1 }
      ],
      topPages: [
        { page: 'https://' + siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') + '/', clicks: 5000, impressions: 50000, ctr: 10.0, position: 5.5 },
        { page: 'https://' + siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') + '/services/seo', clicks: 2500, impressions: 20000, ctr: 12.5, position: 3.2 },
        { page: 'https://' + siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') + '/about-us', clicks: 1000, impressions: 15000, ctr: 6.6, position: 8.4 },
        { page: 'https://' + siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') + '/blog/seo-tips', clicks: 800, impressions: 10000, ctr: 8.0, position: 4.5 },
        { page: 'https://' + siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') + '/contact', clicks: 500, impressions: 5000, ctr: 10.0, position: 2.1 }
      ],
      isVerified: true
    });
  }

  const allTokens = getTokens();
  const clientTokens = allTokens[clientId];

  if (!clientTokens || !clientTokens.refresh_token) {
    return res.status(200).json({ error: 'Not verified. Please authenticate with Google first.', isVerified: false });
  }

  try {
    oauth2Client.setCredentials(clientTokens);
    const searchconsole = google.searchconsole({ version: 'v1', auth: oauth2Client });

    // Calculate dates based on data freshness (GSC is delayed by ~3 days, except for 24Hours/fresh data)
    let startDate, endDate;
    if (customStart && customEnd) {
      startDate = customStart;
      endDate = customEnd;
    } else if (days === '24Hours') {
      const todayObj = new Date();
      endDate = todayObj.toISOString().split('T')[0];
      const yesterdayObj = new Date();
      yesterdayObj.setDate(yesterdayObj.getDate() - 1);
      startDate = yesterdayObj.toISOString().split('T')[0];
    } else {
      const today = new Date();
      today.setDate(today.getDate() - 3);
      endDate = today.toISOString().split('T')[0];

      const startDateObj = new Date(today);
      if (days === '7Days') startDateObj.setDate(startDateObj.getDate() - 7);
      else if (days === '3Months') startDateObj.setDate(startDateObj.getDate() - 90);
      else if (days === '6Months') startDateObj.setDate(startDateObj.getDate() - 180);
      else if (days === '12Months') startDateObj.setDate(startDateObj.getDate() - 365);
      else if (days === '16Months') startDateObj.setDate(startDateObj.getDate() - 480);
      else startDateObj.setDate(startDateObj.getDate() - 28); // Default 28 days
      startDate = startDateObj.toISOString().split('T')[0];
    }

    // Build dimensions and filters
    const dimensions = ['query'];
    const dimensionFilterGroups = [];

    const filters = [];
    if (device !== 'All') {
      filters.push({ dimension: 'device', operator: 'equals', expression: device.toUpperCase() });
    }
    if (country !== 'All') {
      filters.push({ dimension: 'country', operator: 'equals', expression: country.toLowerCase() });
    }
    if (queryFilter) filters.push({ dimension: 'query', operator: queryOperator, expression: queryFilter });

    if (filters.length > 0) {
      dimensionFilterGroups.push({ filters });
    }

    let activeSiteUrl = siteUrl;
    let fallbackSiteUrl = siteUrl.startsWith('sc-domain:')
      ? 'https://' + siteUrl.replace('sc-domain:', '') + '/'
      : 'sc-domain:' + siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

    let metricsReq;
    try {
      // 1. Try to Fetch Aggregated Metrics with primary URL
      metricsReq = await searchconsole.searchanalytics.query({
        siteUrl: activeSiteUrl,
        requestBody: { startDate, endDate, dimensions: [], dimensionFilterGroups, dataState: 'all', type: searchType }
      });
    } catch (err) {
      if (err.code === 403 && fallbackSiteUrl) {
        // If 403 Forbidden, they probably verified the other property type. Try the fallback.
        try {
          metricsReq = await searchconsole.searchanalytics.query({
            siteUrl: fallbackSiteUrl,
            requestBody: { startDate, endDate, dimensions: [], dimensionFilterGroups, dataState: 'all', type: searchType }
          });
          activeSiteUrl = fallbackSiteUrl; // Keep this for the queries fetch below
        } catch (fallbackErr) {
          throw fallbackErr; // If both fail, throw the error
        }
      } else {
        throw err;
      }
    }

    const totals = metricsReq.data.rows && metricsReq.data.rows.length > 0
      ? metricsReq.data.rows[0]
      : { clicks: 0, impressions: 0, ctr: 0, position: 0 };

    const periodDays = Math.max(1, Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1);
    const previousEnd = new Date(startDate);
    previousEnd.setDate(previousEnd.getDate() - 1);
    const previousStart = new Date(previousEnd);
    previousStart.setDate(previousStart.getDate() - periodDays + 1);
    let previous = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    try {
      const previousReq = await searchconsole.searchanalytics.query({
        siteUrl: activeSiteUrl,
        requestBody: { startDate: previousStart.toISOString().split('T')[0], endDate: previousEnd.toISOString().split('T')[0], dimensions: [], dimensionFilterGroups, dataState: 'final', type: searchType }
      });
      previous = previousReq.data.rows?.[0] || previous;
    } catch (comparisonError) { console.warn('[GSC] Comparison unavailable:', comparisonError.message); }
    const change = (current, prior) => prior ? +(((current - prior) / prior) * 100).toFixed(1) : 0;

    // 2. Fetch Query Level Data (Top 100 queries)
    const queriesReq = await searchconsole.searchanalytics.query({
      siteUrl: activeSiteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: ['query'],
        dimensionFilterGroups,
        dataState: 'all',
        type: searchType,
        rowLimit: 100
      }
    });

    const queries = (queriesReq.data.rows || []).map((row, index) => ({
      id: index + 1,
      query: row.keys?.[0] || '',
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: (row.ctr * 100).toFixed(2), // Convert to percentage
      position: row.position.toFixed(1)
    }));

    // 3. Fetch Top Pages Data (Top 100 pages)
    const pagesReq = await searchconsole.searchanalytics.query({
      siteUrl: activeSiteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: ['page'],
        dimensionFilterGroups,
        dataState: 'all',
        type: searchType,
        rowLimit: 100
      }
    });

    const pages = (pagesReq.data.rows || []).map((row, index) => ({
      id: index + 1,
      page: row.keys?.[0] || '',
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: (row.ctr * 100).toFixed(2), // Convert to percentage
      position: row.position.toFixed(1)
    }));

    // 4. Fetch Top Countries Data (Top 50 countries)
    let countries = [];
    try {
      const countriesReq = await searchconsole.searchanalytics.query({
        siteUrl: activeSiteUrl,
        requestBody: {
          startDate,
          endDate,
          dimensions: ['country'],
          dataState: 'all',
          type: searchType,
          rowLimit: 50
        }
      });
      countries = (countriesReq.data.rows || []).map(row => ({
        countryCode: (row.keys?.[0] || 'unknown').toUpperCase(),
        clicks: row.clicks,
        impressions: row.impressions
      }));
    } catch (cErr) {
      console.error('Failed to fetch GSC countries list', cErr);
    }

    // 5. Fetch Timeseries/Date level metrics (daily trend)
    let timeseries = [];
    try {
      const timeseriesReq = await searchconsole.searchanalytics.query({
        siteUrl: activeSiteUrl,
        requestBody: {
          startDate,
          endDate,
          dimensions: ['date'],
          dimensionFilterGroups,
          dataState: 'all',
          type: searchType,
          rowLimit: 90
        }
      });
      timeseries = (timeseriesReq.data.rows || []).map(row => ({
        date: row.keys?.[0] || '',
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: parseFloat((row.ctr * 100).toFixed(2)),
        position: parseFloat(row.position.toFixed(1))
      })).sort((a, b) => new Date(a.date) - new Date(b.date));
    } catch (tErr) {
      console.error('Failed to fetch GSC timeseries daily data', tErr);
    }

    // 6. Fetch Device level metrics
    let devices = [];
    try {
      const devicesReq = await searchconsole.searchanalytics.query({
        siteUrl: activeSiteUrl,
        requestBody: {
          startDate,
          endDate,
          dimensions: ['device'],
          dataState: 'all',
          type: searchType,
          rowLimit: 5
        }
      });
      devices = (devicesReq.data.rows || []).map(row => ({
        device: (row.keys?.[0] || 'unknown').toLowerCase(),
        clicks: row.clicks,
        impressions: row.impressions
      }));
    } catch (dErr) {
      console.error('Failed to fetch GSC devices list', dErr);
    }

    let searchAppearances = [];
    try {
      const appearanceReq = await searchconsole.searchanalytics.query({
        siteUrl: activeSiteUrl,
        requestBody: { startDate, endDate, dimensions: ['searchAppearance'], dimensionFilterGroups, dataState: 'all', type: searchType, rowLimit: 100 }
      });
      searchAppearances = (appearanceReq.data.rows || []).map(row => ({ appearance: row.keys?.[0] || 'Unknown', clicks: row.clicks, impressions: row.impressions, ctr: +(row.ctr * 100).toFixed(2), position: +row.position.toFixed(1) }));
    } catch (appearanceError) { console.warn('[GSC] Search appearance unavailable:', appearanceError.message); }

    // Send payload matching the exact UI structure we built
    res.json({
      isVerified: true,
      siteUrl,
      startDate,
      endDate,
      metrics: {
        clicks: totals.clicks,
        impressions: totals.impressions,
        ctr: (totals.ctr * 100).toFixed(2),
        position: totals.position.toFixed(1),
        trends: { clicks: change(totals.clicks, previous.clicks), impressions: change(totals.impressions, previous.impressions), ctr: change(totals.ctr, previous.ctr), position: change(totals.position, previous.position) }
      },
      previousMetrics: previous,
      searchAppearances,
      queries,
      topQueries: queries,
      topPages: pages,
      pages,
      countries,
      timeseries,
      devices
    });

  } catch (error) {
    const errorMsg = error.message || '';
    if (error.code === 403 && (errorMsg.includes('has not been used in project') || errorMsg.includes('it is disabled') || errorMsg.includes('accessNotConfigured'))) {
      const projectId = errorMsg.match(/project\s+(\d+)/i)?.[1] || null;
      console.log(`[GSC API] Search Console API disabled${projectId ? ` for project ${projectId}` : ''}`);
      return res.status(403).json({
        error: `Search Console API is disabled${projectId ? ` in Google Cloud project ${projectId}` : ''}. Enable it in Google Cloud Console, wait a few minutes, then retry.`,
        code: 'SEARCH_CONSOLE_API_DISABLED',
        projectId
      });
    }
    if (error.code === 400 || errorMsg.includes('invalid_grant')) {
      console.log(`[GSC API] invalid_grant (token revoked/invalid) for ${siteUrl}`);
      return res.status(200).json({ error: 'Google Account connection has expired. Please reconnect.', isVerified: false });
    }
    if (error.code === 403) {
      console.log(`[GSC API] 403 Access Denied for ${siteUrl}`);
      return res.status(403).json({ error: 'Access Denied. Make sure your Google Account has permission to view this property in GSC.' });
    }
    if (error.code === 401) {
      console.log(`[GSC API] 401 Token Expired for ${siteUrl}`);
      return res.status(401).json({ error: 'Google OAuth token expired or invalid. Please reconnect your account.' });
    }
    if (error.code === 429) {
      console.log(`[GSC API] 429 Quota Exceeded`);
      return res.status(429).json({ error: 'Google Search Console API quota exceeded. Please try again later.' });
    }

    console.error('[GSC API] Critical Error:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch data from Google Search Console' });
  }
});

module.exports = router;
