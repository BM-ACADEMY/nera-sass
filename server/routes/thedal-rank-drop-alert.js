/* eslint-env node */
const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

require('dotenv').config();

const pool = new Pool({
  host:     process.env.DB_HOST || 'localhost',
  port:     process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'leados_db',
  user:     process.env.DB_USER || 'leados_user',
  password: process.env.DB_PASS || 'LeadOS_DB@2026',
});

// ── ENSURE TABLE EXISTS ──────────────────────────────────────
const ensureTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS thedal_rank_drop_alerts (
        id            VARCHAR(16) PRIMARY KEY,
        client_id     INTEGER,
        client_name   VARCHAR(255),
        keyword       TEXT,
        url           TEXT,
        old_rank      INTEGER,
        new_rank      INTEGER,
        drop_amount   INTEGER,
        search_volume INTEGER,
        traffic_risk  INTEGER,
        severity      VARCHAR(16) DEFAULT 'info',
        is_critical   BOOLEAN DEFAULT FALSE,
        acknowledged  BOOLEAN DEFAULT FALSE,
        acknowledged_at TIMESTAMP,
        note          TEXT,
        is_demo       BOOLEAN DEFAULT FALSE,
        date_detected TIMESTAMP DEFAULT NOW()
      )
    `);
    // Safe column addition
    await pool.query(`ALTER TABLE thedal_rank_drop_alerts ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT FALSE`);

    // Clean up old seeded alerts from Live Mode (since they were created before is_demo column existed)
    const mockKeywords = [
      'top rated agency in city',
      'local seo experts near me',
      'affordable web design',
      'digital marketing company',
      'how to improve seo',
      'b2b lead generation'
    ];
    await pool.query(`
      DELETE FROM thedal_rank_drop_alerts 
      WHERE is_demo = FALSE AND (
        keyword = ANY($1) 
        OR keyword LIKE '%services' 
        OR keyword LIKE '%pricing'
      )
    `, [mockKeywords]);
    console.log('Cleaned up old seeded mock alerts from Live Mode table.');

    // History for the free-text "any domain" live check — independent of CRM clients,
    // so a rank drop can be detected for a domain/keyword that isn't tracked anywhere else.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS thedal_domain_watch_checks (
        id           SERIAL PRIMARY KEY,
        domain       VARCHAR(255) NOT NULL,
        keyword      TEXT NOT NULL,
        location     VARCHAR(64) NOT NULL DEFAULT 'India',
        rank         INTEGER,
        found        BOOLEAN DEFAULT FALSE,
        result_url   TEXT,
        result_title TEXT,
        checked_at   TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_domain_watch_lookup ON thedal_domain_watch_checks (domain, keyword, location, checked_at DESC)`);
  } catch (err) {
    console.error('Failed to create thedal_rank_drop_alerts table', err);
  }
};
ensureTable();

// ── HELPERS ──────────────────────────────────────────────────
const keywordsFile = path.join(__dirname, '../data/keywords.json');

const getTrackedKeywords = () => {
  try {
    if (fs.existsSync(keywordsFile)) {
      return JSON.parse(fs.readFileSync(keywordsFile, 'utf8'));
    }
  } catch (e) {}
  return [];
};

function seededRandom(seedStr, min, max) {
  const hash = crypto.createHash('md5').update(seedStr).digest('hex');
  const num = parseInt(hash.substring(0, 8), 16);
  return min + (num % (max - min + 1));
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

// Treat as a likely typo/reformat of the SAME domain only when the core label
// (part before the first dot) matches, or the two hostnames are near-identical.
// Unrelated domains (e.g. a competitor's) must not silently swap to another client.
function isLikelyTypo(hostnameA, hostnameB) {
  if (!hostnameA || !hostnameB || hostnameA === hostnameB) return hostnameA === hostnameB;
  const coreA = hostnameA.split('.')[0];
  const coreB = hostnameB.split('.')[0];
  if (coreA.length >= 3 && coreA === coreB) return true;
  return levenshtein(hostnameA, hostnameB) <= 2;
}

function getSeverity(dropAmount, oldRank, newRank) {
  const wasPage1 = oldRank <= 10;
  const isPage1 = newRank <= 10;
  if (wasPage1 && !isPage1) return 'critical';
  if (dropAmount >= 10) return 'critical';
  if (dropAmount >= 5) return 'warning';
  return 'info';
}

// organic_results is capped at 100 rows; "not found" is treated as just beyond that
// so drop-amount math still works when a keyword falls out of the results entirely.
const RANK_NOT_FOUND = 101;

function describeDrop(oldRank, newRank) {
  const amount = newRank - oldRank;
  const severity = getSeverity(amount, oldRank, newRank);
  const droppedOutOfResults = newRank >= RANK_NOT_FOUND;
  const possibleReasons = droppedOutOfResults
    ? ['The page no longer appears in the first 100 organic results for this keyword.', 'It may have been deindexed, blocked, redirected, or heavily outranked — verify before assuming the worst.']
    : oldRank <= 10 && newRank > 10
      ? ['The keyword moved off page one.', 'Content relevance, competitor improvements, technical changes or normal result volatility may be involved.']
      : amount >= 10
        ? ['This is a large movement and should be investigated.', 'Check indexing, page changes, competitors, backlinks and technical health.']
        : ['This may be normal ranking fluctuation.', 'Confirm the movement in another check before making a major change.'];
  const solutions = ['Inspect the ranking page in GSC URL Inspection.', 'Compare clicks, impressions and position in GSC Performance.', 'Review recent title, content, canonical, robots and redirect changes.', 'Improve the page only when the evidence identifies a relevance or quality gap.', 'Refresh the keyword later to verify whether the rank recovers.'];
  return { severity, possibleReasons, solutions };
}

// Standing advice for the CURRENT position — shown for every checked keyword,
// not just ones that dropped, so a first-time or stable check still tells you
// why it's ranking where it is and what would move it toward #1-2.
function describeCurrentPosition(rank, found) {
  if (!found || rank == null) {
    return {
      rankReasons: [
        'This page does not appear in the first 100 organic results for this keyword.',
        'It may not exist yet, may not be indexed, may not target this exact phrase, or is heavily outranked by stronger competitors.'
      ],
      rankSuggestions: [
        'Confirm a page actually targets this keyword; create one if it does not exist.',
        'Check indexing status in GSC URL Inspection and request indexing if needed.',
        'Use the exact keyword phrase in the title, H1 and first paragraph.',
        'Build topical depth: cover related subtopics, add FAQs, data, or media.',
        'Earn a few relevant backlinks and internal links pointing to this page.'
      ]
    };
  }
  if (rank <= 3) {
    return {
      rankReasons: ['Already in the top 3 for this keyword — strong relevance and authority signals for this term.'],
      rankSuggestions: [
        'Keep the content fresh and accurate to defend the position.',
        'Monitor competitors moving into the top 3 and respond if they add depth you lack.',
        'Continue earning quality backlinks; do not let the link profile stagnate.'
      ]
    };
  }
  if (rank <= 10) {
    return {
      rankReasons: [`On page 1 at position #${rank}, but not yet top 3 — competitors above it likely have deeper content, more authority, or better on-page relevance.`],
      rankSuggestions: [
        'Expand the page to cover the topic more thoroughly than the top 3 results.',
        'Match the exact search intent (informational vs transactional) shown by the current top 3.',
        'Improve page speed and Core Web Vitals.',
        'Earn a few additional relevant, high-quality backlinks.',
        'Strengthen internal linking from related pages on the site.'
      ]
    };
  }
  return {
    rankReasons: [`At position #${rank} — on page 2 or later. The page is likely thinner or less authoritative than the results ranking above it.`],
    rankSuggestions: [
      "Rewrite the page to directly and thoroughly answer this exact keyword's intent.",
      'Add unique value competitors lack: original data, examples, FAQs, or media.',
      'Build topical authority with supporting content linking back to this page.',
      'Earn relevant backlinks and citations for this page specifically.',
      'Verify technical health: indexing, canonical tags, mobile usability, page speed.'
    ]
  };
}

async function fetchOrganicResults(keyword, location) {
  const valueSerpKey = process.env.VALUESERP_API_KEY;
  const serperKey = process.env.SERPER_API_KEY || process.env.SERP_API_KEY;
  if (!valueSerpKey && !serperKey) throw Object.assign(new Error('No organic rank provider API key is configured'), { status: 503 });
  if (valueSerpKey) {
    const response = await axios.get('https://api.valueserp.com/search', { params: { q: keyword, api_key: valueSerpKey, num: 100, location, gl: 'in', hl: 'en', google_domain: 'google.co.in', device: 'desktop' }, timeout: 25000 });
    return { organicResults: response.data?.organic_results || [], provider: 'ValueSERP' };
  }
  const response = await axios.post('https://google.serper.dev/search', { q: keyword, gl: 'in', hl: 'en', num: 100, location }, { headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' }, timeout: 25000 });
  return { organicResults: response.data?.organic || [], provider: 'Serper' };
}

async function seedAlertsForClient(clientId, clientName) {
  const baseKeywords = [
    { text: 'best ' + (clientName.split(' ')[0] || 'local') + ' services', url: '/services', sv: 1200 },
    { text: 'top rated agency in city', url: '/about', sv: 850 },
    { text: clientName + ' pricing', url: '/pricing', sv: 450 },
    { text: 'local seo experts near me', url: '/seo-services', sv: 3200 },
    { text: 'affordable web design', url: '/web-design', sv: 5400 },
    { text: 'digital marketing company', url: '/', sv: 8100 },
    { text: 'how to improve seo', url: '/blog/improve-seo', sv: 1500 },
    { text: 'b2b lead generation', url: '/lead-gen', sv: 2100 }
  ];

  const dropCount = seededRandom(clientName + 'count', 3, 6);
  const existing = await pool.query(
    'SELECT keyword FROM thedal_rank_drop_alerts WHERE client_name = $1 AND is_demo = TRUE', [clientName]
  );
  const existingKeywords = new Set(existing.rows.map(r => r.keyword));

  for (let i = 0; i < dropCount; i++) {
    const kw = baseKeywords[seededRandom(clientName + i, 0, baseKeywords.length - 1)];
    if (existingKeywords.has(kw.text)) continue;

    const oldRank = seededRandom(clientName + i + 'old', 1, 15);
    const dropAmount = seededRandom(clientName + i + 'drop', 3, 25);
    const newRank = oldRank + dropAmount;
    const severity = getSeverity(dropAmount, oldRank, newRank);
    const isCritical = severity === 'critical';

    const wasPage1 = oldRank <= 10;
    const isPage1 = newRank <= 10;
    const sv = Number(kw.sv) || 0;
    let trafficRisk = 0;
    if (wasPage1 && !isPage1) trafficRisk = Math.floor(sv * 0.15);
    else if (dropAmount >= 10) trafficRisk = Math.floor(sv * 0.05);
    else trafficRisk = Math.floor(sv * 0.02);

    const id = crypto.randomBytes(6).toString('hex');
    const daysAgo = seededRandom(clientName + i + 'days', 1, 6);
    const dateDetected = new Date(Date.now() - daysAgo * 86400000).toISOString();

    await pool.query(`
      INSERT INTO thedal_rank_drop_alerts
        (id, client_id, client_name, keyword, url, old_rank, new_rank, drop_amount, search_volume, traffic_risk, severity, is_critical, is_demo, date_detected)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (id) DO NOTHING
    `, [id, clientId || null, clientName, kw.text, kw.url, oldRank, newRank, dropAmount, kw.sv, trafficRisk, severity, isCritical, true, dateDetected]);
  }
}

// ── GET /count — unread count for active mode (for sidebar badge) ──
router.get('/count', async (req, res) => {
  const { client } = req.query;
  const useDemoMode = req.headers['x-data-mode'] === 'demo';
  try {
    let query = 'SELECT COUNT(*) FROM thedal_rank_drop_alerts WHERE acknowledged = FALSE AND is_demo = $1';
    const params = [useDemoMode];
    if (client) {
      query += ' AND client_name = $2';
      params.push(client);
    }
    const result = await pool.query(query, params);
    res.json({ count: parseInt(result.rows[0].count, 10) });
  } catch (err) {
    console.error(err);
    res.json({ count: 0 });
  }
});

// ── GET /history — acknowledged alerts for active mode ──
router.get('/history', async (req, res) => {
  const { client } = req.query;
  const useDemoMode = req.headers['x-data-mode'] === 'demo';
  try {
    const result = await pool.query(
      `SELECT * FROM thedal_rank_drop_alerts
       WHERE acknowledged = TRUE AND is_demo = $1 ${client ? 'AND client_name = $2' : ''}
       ORDER BY acknowledged_at DESC LIMIT 50`,
      client ? [useDemoMode, client] : [useDemoMode]
    );
    res.json({ history: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// ── GET / — active (unacknowledged) alerts for a client ──
router.get('/', async (req, res) => {
  const { client, client_id, tracking_client_id } = req.query;
  if (!client) return res.status(400).json({ error: 'client query param required' });

  const useDemoMode = req.headers['x-data-mode'] === 'demo';
  let trackingStats = null;

  try {
    if (useDemoMode) {
      // Seed mock data for this client under demo mode if none exist yet
      const check = await pool.query(
        'SELECT id FROM thedal_rank_drop_alerts WHERE client_name = $1 AND is_demo = TRUE LIMIT 1', [client]
      );
      if (check.rows.length === 0) {
        await seedAlertsForClient(client_id || null, client);
      }
    } else {
      // Live mode uses the same PostgreSQL ranking records as Keyword Tracking.
      try {
        const trackedResult = tracking_client_id
          ? await pool.query(
              `SELECT id, keyword, initial_rank, previous_rank, current_rank, last_checked
                 FROM mafiya_turf_keywords
                WHERE client_id = $1
                ORDER BY last_checked DESC NULLS LAST`,
              [tracking_client_id]
            )
          : { rows: [] };
        trackingStats = {
          tracking_client_id: tracking_client_id ? Number(tracking_client_id) : null,
          tracked_keywords: trackedResult.rows.length,
          comparable_keywords: trackedResult.rows.filter(row => row.previous_rank != null && row.current_rank != null).length,
          dropped_keywords: trackedResult.rows.filter(row => row.previous_rank != null && row.current_rank != null && Number(row.current_rank) > Number(row.previous_rank)).length
        };

        for (const kw of trackedResult.rows) {
          const previousRank = Number(kw.previous_rank);
          const currentRank = Number(kw.current_rank);
          if (Number.isFinite(currentRank) && Number.isFinite(previousRank) && currentRank > previousRank) {
            const dropAmount = currentRank - previousRank;
            const severity = getSeverity(dropAmount, previousRank, currentRank);
            const isCritical = severity === 'critical';
            const sv = 850; // default estimate
            const trafficRisk = previousRank <= 10 && currentRank > 10
              ? Math.floor(sv * 0.15)
              : dropAmount >= 10 ? Math.floor(sv * 0.05) : Math.floor(sv * 0.02);
            const alertId = crypto.createHash('md5')
              .update(`${kw.id}:${kw.last_checked || ''}:${previousRank}:${currentRank}`)
              .digest('hex').substring(0, 16);

            // Check if alert already logged
            const checkAlert = await pool.query(
              'SELECT id FROM thedal_rank_drop_alerts WHERE id = $1', [alertId]
            );
            if (checkAlert.rows.length === 0) {
              await pool.query(`
                INSERT INTO thedal_rank_drop_alerts
                  (id, client_id, client_name, keyword, url, old_rank, new_rank, drop_amount, search_volume, traffic_risk, severity, is_critical, is_demo, date_detected)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
              `, [alertId, client_id || null, client, kw.keyword, '/', previousRank, currentRank, dropAmount, sv, trafficRisk, severity, isCritical, false]);
            }
          }
        }
      } catch (e) {
        console.error('Failed to generate live rank-drop alerts from mafiya_turf_keywords:', e);
      }
    }

    const result = await pool.query(
      `SELECT * FROM thedal_rank_drop_alerts
       WHERE client_name = $1 AND acknowledged = FALSE AND is_demo = $2
       ORDER BY is_critical DESC, traffic_risk DESC`,
      [client, useDemoMode]
    );

    const alerts = result.rows;
    const critical = alerts.filter(a => a.severity === 'critical').length;
    const totalTrafficRisk = alerts.reduce((acc, a) => acc + (a.traffic_risk || 0), 0);

    res.json({
      summary: {
        total_alerts: alerts.length,
        critical_drops: critical,
        total_traffic_risk: totalTrafficRisk
      },
      tracking: trackingStats,
      alerts
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// One-off organic rank check for a domain. Two modes:
//  - keywords given: live-checks ANY domain (no CRM/Keyword Tracking record required) against
//    those specific keywords and compares to our own saved history for the same domain+keyword.
//  - no keywords: diagnoses drops across all keywords already tracked for the mapped CRM client.
router.post('/check-rank', async (req, res) => {
  const { domain, keyword, keywords, location = 'India', trackingClientId, thedalClientId } = req.body;
  if (!domain?.trim()) return res.status(400).json({ error: 'Domain is required' });
  let hostname;
  try { hostname = new URL(/^https?:\/\//i.test(domain) ? domain : `https://${domain}`).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return res.status(400).json({ error: 'Enter a valid domain, for example bmtechx.in' }); }

  // Cap keyword count to bound SERP API cost from free-text input.
  const keywordList = [...new Set(
    (Array.isArray(keywords) ? keywords : typeof keywords === 'string' ? keywords.split(/[,\n]/) : keyword ? [keyword] : [])
      .map(k => String(k).trim())
      .filter(Boolean)
  )].slice(0, 5);

  if (keywordList.length > 0) {
    try {
      const results = [];
      let provider = '';
      for (const kw of keywordList) {
        const { organicResults, provider: usedProvider } = await fetchOrganicResults(kw, location);
        provider = usedProvider;
        const match = organicResults.find(result => {
          try { const resultHost = new URL(result.link).hostname.replace(/^www\./, '').toLowerCase(); return resultHost === hostname || resultHost.endsWith(`.${hostname}`); }
          catch { return false; }
        });
        const currentRank = match?.position || null;
        const found = Boolean(match);

        const previousResult = await pool.query(
          `SELECT rank, checked_at FROM thedal_domain_watch_checks
             WHERE domain = $1 AND keyword = $2 AND location = $3
             ORDER BY checked_at DESC LIMIT 1`,
          [hostname, kw, location]
        );
        const previous = previousResult.rows[0] || null;

        await pool.query(
          `INSERT INTO thedal_domain_watch_checks (domain, keyword, location, rank, found, result_url, result_title)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [hostname, kw, location, currentRank, found, match?.link || null, match?.title || null]
        );

        const entry = {
          keyword: kw, newRank: currentRank, found,
          resultUrl: match?.link || null, resultTitle: match?.title || null,
          isNew: !previous, oldRank: previous?.rank ?? null, previousCheckedAt: previous?.checked_at ?? null,
          hasDrop: false,
          ...describeCurrentPosition(currentRank, found)
        };

        if (previous) {
          const oldEff = previous.rank == null ? RANK_NOT_FOUND : Number(previous.rank);
          const newEff = currentRank == null ? RANK_NOT_FOUND : Number(currentRank);
          if (newEff > oldEff) {
            const { severity, possibleReasons, solutions } = describeDrop(oldEff, newEff);
            Object.assign(entry, { hasDrop: true, dropAmount: newEff - oldEff, severity, possibleReasons, solutions });
          }
        }
        results.push(entry);
      }

      const comparable = results.filter(r => !r.isNew);
      const drops = results.filter(r => r.hasDrop).sort((a, b) => b.dropAmount - a.dropAmount);

      return res.json({
        mode: 'live-check',
        domain: hostname,
        requestedDomain: hostname,
        provider,
        location,
        trackedKeywords: results.length,
        comparableKeywords: comparable.length,
        newKeywordCount: results.length - comparable.length,
        stableKeywords: comparable.length - drops.length,
        results,
        drops,
        hasDrop: drops.length > 0,
        checkedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('[Rank Drop Alert] Live domain check failed:', error.response?.data || error.message);
      return res.status(error.status || 502).json({ error: error.response?.data?.message || error.message || 'The rank provider could not complete this check' });
    }
  }

  // Domain-only mode diagnoses drops across all keywords already tracked for the mapped client.
  {
    try {
      const clientsResult = await pool.query(`SELECT id, business_name, website_url FROM mafiya_gmb_clients WHERE website_url IS NOT NULL`);
      const exactClient = clientsResult.rows.find(client => {
        try { return new URL(/^https?:\/\//i.test(client.website_url) ? client.website_url : `https://${client.website_url}`).hostname.replace(/^www\./, '').toLowerCase() === hostname; }
        catch { return false; }
      });
      // The page is client-scoped. Fall back to its explicit Keyword Tracking mapping
      // ONLY when the typed domain looks like a typo/reformat of that same client's
      // website — never silently swap in a genuinely different client's domain.
      const sidebarClient = trackingClientId
        ? clientsResult.rows.find(client => Number(client.id) === Number(trackingClientId))
        : null;
      let sidebarHostname = null;
      if (sidebarClient) {
        try { sidebarHostname = new URL(/^https?:\/\//i.test(sidebarClient.website_url) ? sidebarClient.website_url : `https://${sidebarClient.website_url}`).hostname.replace(/^www\./, '').toLowerCase(); }
        catch { /* Malformed stored URL — leave sidebarHostname null. */ }
      }
      const typoFallback = !exactClient && sidebarClient && sidebarHostname && isLikelyTypo(hostname, sidebarHostname)
        ? sidebarClient
        : null;
      const mappedClient = exactClient || typoFallback;

      if (!mappedClient) {
        if (sidebarClient) {
          // A client IS selected in the sidebar, but the domain typed here belongs
          // to neither it nor any other tracked client — say so plainly.
          return res.json({
            mode: 'domain-drop',
            domain: hostname,
            requestedDomain: hostname,
            noMatchingClient: true,
            setupMessage: `No tracked client matches "${hostname}". The client currently selected in the sidebar is mapped to ${sidebarHostname || sidebarClient.website_url}. To check THIS domain anyway, add at least one keyword in the "Keywords to check" box above and try again — that runs a live check on any domain, no CRM record needed. Otherwise, select the correct client from the sidebar, or fix that client's website URL in Clients if it's wrong.`,
            trackedKeywords: 0,
            comparableKeywords: 0,
            stableKeywords: 0,
            drops: [],
            hasDrop: false,
            checkedAt: new Date().toISOString()
          });
        }
        let storedDomain = hostname;
        if (thedalClientId) {
          const thedalResult = await pool.query('SELECT domain FROM thedal_clients WHERE id = $1', [thedalClientId]);
          storedDomain = thedalResult.rows[0]?.domain || hostname;
        }
        return res.json({
          mode: 'domain-drop',
          domain: hostname,
          requestedDomain: hostname,
          setupRequired: true,
          setupMessage: `This client is not connected to Keyword Tracking. To check "${hostname}" right now anyway, add at least one keyword in the "Keywords to check" box above and try again — that runs a live check on any domain, no CRM record needed. To fix it properly instead, correct the website domain (${storedDomain}), connect it to a Keyword Tracking client, add keywords there, and complete at least two rank checks.`,
          trackedKeywords: 0,
          comparableKeywords: 0,
          stableKeywords: 0,
          drops: [],
          hasDrop: false,
          checkedAt: new Date().toISOString()
        });
      }

      let mappedHostname = hostname;
      try { mappedHostname = new URL(/^https?:\/\//i.test(mappedClient.website_url) ? mappedClient.website_url : `https://${mappedClient.website_url}`).hostname.replace(/^www\./, '').toLowerCase(); }
      catch { /* Keep the submitted hostname when the stored URL is malformed. */ }

      const trackedResult = await pool.query(
        `SELECT id, keyword, initial_rank, previous_rank, current_rank, pack_status, last_checked
           FROM mafiya_turf_keywords WHERE client_id = $1 ORDER BY keyword`,
        [mappedClient.id]
      );
      const comparable = trackedResult.rows.filter(row => row.previous_rank != null && row.current_rank != null);
      const drops = comparable.filter(row => Number(row.current_rank) > Number(row.previous_rank)).map(row => {
        const oldRank = Number(row.previous_rank);
        const newRank = Number(row.current_rank);
        const { severity, possibleReasons, solutions } = describeDrop(oldRank, newRank);
        return { keyword: row.keyword, oldRank, newRank, dropAmount: newRank - oldRank, severity, packStatus: row.pack_status, lastChecked: row.last_checked, possibleReasons, solutions };
      }).sort((a, b) => b.dropAmount - a.dropAmount);

      return res.json({ mode: 'domain-drop', domain: mappedHostname, requestedDomain: hostname, mappingCorrected: mappedHostname !== hostname, clientId: mappedClient.id, clientName: mappedClient.business_name, trackedKeywords: trackedResult.rows.length, comparableKeywords: comparable.length, stableKeywords: comparable.length - drops.length, drops, hasDrop: drops.length > 0, checkedAt: new Date().toISOString() });
    } catch (error) {
      console.error('[Rank Drop Alert] Domain diagnosis failed:', error.message);
      return res.status(500).json({ error: 'Could not analyze tracked rankings for this domain' });
    }
  }
});

router.put('/:id/acknowledge', async (req, res) => {
  const { id } = req.params;
  const { note } = req.body;
  try {
    const trimmedNote = note ? String(note).slice(0, 1000) : null;
    await pool.query(
      `UPDATE thedal_rank_drop_alerts
       SET acknowledged = TRUE, acknowledged_at = NOW(), note = $1
       WHERE id = $2`,
      [trimmedNote, id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to acknowledge alert' });
  }
});

module.exports = router;
