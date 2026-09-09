/* eslint-env node */
const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const axios = require('axios');

const pool = new Pool({
  host:     process.env.DB_HOST || 'localhost',
  port:     process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'leados_db',
  user:     process.env.DB_USER || 'leados_user',
  password: process.env.DB_PASS || 'LeadOS_DB@2026',
});

// Ensure DB table exists
const ensureTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS backlink_tracker_history (
        id SERIAL PRIMARY KEY,
        domain VARCHAR(255) NOT NULL,
        metrics JSONB,
        links JSONB,
        scanned_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tracked_backlinks (
        id SERIAL PRIMARY KEY,
        domain VARCHAR(255) UNIQUE NOT NULL,
        added_at TIMESTAMP DEFAULT NOW(),
        last_checked TIMESTAMP,
        metrics JSONB,
        status VARCHAR(50) DEFAULT 'Monitoring'
      )
    `);
  } catch (err) {
    console.error('Failed to create backlink_tracker_history table', err);
  }
};
ensureTable();

// Helper to generate mock backlink data for a domain
function generateMockBacklinks(domain) {
  const cleanDomain = domain.toLowerCase().replace(/^(?:https?:\/\/)?(?:www\.)?/i, "").split('/')[0];
  
  const sources = [
    { 
      name: 'Wikipedia', 
      root: 'en.wikipedia.org', 
      maxDr: 98, 
      minDr: 95,
      urls: [
        'https://en.wikipedia.org/wiki/B2B_e-commerce',
        'https://en.wikipedia.org/wiki/Export',
        'https://en.wikipedia.org/wiki/Trade',
        'https://en.wikipedia.org/wiki/Wholesaling',
        'https://en.wikipedia.org/wiki/International_trade',
        'https://en.wikipedia.org/wiki/Global_marketing',
        'https://en.wikipedia.org/wiki/Supply_chain_management',
        'https://en.wikipedia.org/wiki/E-commerce'
      ]
    },
    { 
      name: 'Medium', 
      root: 'medium.com', 
      maxDr: 95, 
      minDr: 85,
      urls: [
        'https://medium.com/topic/business',
        'https://medium.com/topic/marketing',
        'https://medium.com/topic/technology',
        'https://medium.com/tag/b2b-marketing',
        'https://medium.com/tag/seo',
        'https://medium.com/tag/business-strategy',
        'https://medium.com/tag/entrepreneurship'
      ]
    },
    { 
      name: 'TechCrunch', 
      root: 'techcrunch.com', 
      maxDr: 92, 
      minDr: 80,
      urls: [
        'https://techcrunch.com/category/startups/',
        'https://techcrunch.com/category/enterprise/',
        'https://techcrunch.com/category/marketing/',
        'https://techcrunch.com/category/funding/',
        'https://techcrunch.com/category/artificial-intelligence/'
      ]
    },
    { 
      name: 'GitHub', 
      root: 'github.com', 
      maxDr: 96, 
      minDr: 90,
      urls: [
        'https://github.com/trending',
        'https://github.com/topics/seo',
        'https://github.com/topics/b2b',
        'https://github.com/topics/marketing',
        'https://github.com/collections/clean-code'
      ]
    },
    { 
      name: 'Forbes', 
      root: 'forbes.com', 
      maxDr: 94, 
      minDr: 85,
      urls: [
        'https://www.forbes.com/business/',
        'https://www.forbes.com/leadership/',
        'https://www.forbes.com/innovation/',
        'https://www.forbes.com/lists/',
        'https://www.forbes.com/money/',
        'https://www.forbes.com/small-business/'
      ]
    },
    { 
      name: 'Reddit', 
      root: 'reddit.com', 
      maxDr: 93, 
      minDr: 75,
      urls: [
        'https://www.reddit.com/r/SEO/',
        'https://www.reddit.com/r/marketing/',
        'https://www.reddit.com/r/business/',
        'https://www.reddit.com/r/startups/',
        'https://www.reddit.com/r/ecommerce/'
      ]
    },
    { 
      name: 'Yellow Pages', 
      root: 'yellowpages.com', 
      maxDr: 88, 
      minDr: 70,
      urls: [
        'https://www.yellowpages.com/',
        'https://www.yellowpages.com/about',
        'https://www.yellowpages.com/contact'
      ]
    },
    { 
      name: 'HubSpot', 
      root: 'hubspot.com', 
      maxDr: 92, 
      minDr: 80,
      urls: [
        'https://www.hubspot.com/resources',
        'https://blog.hubspot.com/',
        'https://blog.hubspot.com/marketing',
        'https://blog.hubspot.com/sales'
      ]
    },
    { 
      name: 'Shopify Blog', 
      root: 'shopify.com', 
      maxDr: 94, 
      minDr: 80,
      urls: [
        'https://www.shopify.com/blog',
        'https://www.shopify.com/blog/topics/marketing',
        'https://www.shopify.com/blog/topics/seo'
      ]
    },
    { 
      name: 'New York Times', 
      root: 'nytimes.com', 
      maxDr: 95, 
      minDr: 85,
      urls: [
        'https://www.nytimes.com/section/business',
        'https://www.nytimes.com/section/technology',
        'https://www.nytimes.com/section/world'
      ]
    },
  ];

  let totalLinks, referringDomains, dofollowRatio, domainAuthority;
  const isExportersIndia = cleanDomain === 'exportersindia.com';

  if (isExportersIndia) {
    totalLinks = 1724530;
    referringDomains = 40230;
    dofollowRatio = 76;
    domainAuthority = 81;
  } else {
    // Generate randomized metrics for other domains
    const baseLinks = Math.floor(Math.random() * 40) + 15;
    totalLinks = baseLinks + Math.floor(Math.random() * 1000);
    referringDomains = Math.floor(baseLinks * 0.7) + Math.floor(Math.random() * 200);
    dofollowRatio = Math.floor(Math.random() * 30) + 50;
    domainAuthority = Math.floor(Math.random() * 40) + 20;
  }

  // Generate sample links for the table (e.g., 50 for exportersindia or 20-30 for others)
  const linksCount = isExportersIndia ? 80 : (Math.floor(Math.random() * 30) + 20);
  const links = [];

  // Custom targets for exportersindia
  const exportersIndiaTargets = [
    `https://www.exportersindia.com/`,
    `https://www.exportersindia.com/indian-manufacturers.html`,
    `https://www.exportersindia.com/suppliers/`,
    `https://www.exportersindia.com/apparel-fashion.htm`,
    `https://www.exportersindia.com/machinery-equipment.htm`
  ];

  // Custom anchors for exportersindia
  const exportersIndiaAnchors = [
    'Exporters India',
    'Indian Exporters B2B Marketplace',
    'exportersindia.com',
    'B2B Directory',
    'Indian exporters list',
    'Indian Manufacturers & Suppliers',
    'B2B Portal',
    'Indian Trade Directory'
  ];

  for (let i = 0; i < linksCount; i++) {
    const source = sources[Math.floor(Math.random() * sources.length)];
    const isDofollow = Math.random() < (dofollowRatio / 100);

    const dr = isExportersIndia && source.maxDr > 80
      ? Math.floor(Math.random() * (source.maxDr - 82 + 1)) + 82
      : Math.floor(Math.random() * (source.maxDr - source.minDr + 1)) + source.minDr;
    
    // URL Rating (UR) is generally lower than DR
    const ur = Math.max(5, Math.min(100, Math.floor(dr * 0.65) + Math.floor(Math.random() * 12)));

    // Referring domains of the referring page
    const refDomainsCount = Math.floor(Math.random() * 18) + 1;

    // Linked external domains from the referring page
    const linkedDomainsCount = Math.floor(Math.random() * 80) + 10;

    // Target URL
    let targetUrl = `https://www.${cleanDomain}/`;
    if (isExportersIndia) {
      targetUrl = exportersIndiaTargets[Math.floor(Math.random() * exportersIndiaTargets.length)];
    } else if (Math.random() > 0.5) {
      targetUrl = `https://www.${cleanDomain}/product-item-${Math.floor(Math.random() * 100)}.html`;
    }

    // Anchor text
    let anchor = '';
    if (isExportersIndia) {
      anchor = exportersIndiaAnchors[Math.floor(Math.random() * exportersIndiaAnchors.length)];
    } else {
      const anchors = [cleanDomain, `Visit ${cleanDomain}`, 'Click here', 'Website', 'Source', 'Read more', 'Official Site'];
      anchor = anchors[Math.floor(Math.random() * anchors.length)];
    }

    const status = Math.random() > 0.08 ? 'Active' : 'Lost';
    const sourceUrl = source.urls[Math.floor(Math.random() * source.urls.length)];

    links.push({
      id: i + 1,
      sourceUrl: sourceUrl,
      sourceTitle: isExportersIndia 
        ? `${source.name} - Directory profile of ExportersIndia` 
        : `${source.name} - Mention of ${cleanDomain}`,
      anchorText: anchor,
      targetUrl: targetUrl,
      type: isDofollow ? 'Dofollow' : 'Nofollow',
      dr: dr,
      ur: ur,
      refDomains: refDomainsCount,
      linkedDomains: linkedDomainsCount,
      status: status,
      firstSeen: new Date(Date.now() - Math.floor(Math.random() * 10000000000)).toISOString().split('T')[0],
    });
  }

  // Sort by DR descending
  links.sort((a, b) => b.dr - a.dr);

  const metrics = {
    totalBacklinks: totalLinks,
    referringDomains: referringDomains,
    dofollowRatio: dofollowRatio,
    domainAuthority: domainAuthority,
    provider: 'Simulated',
    resultType: 'Generated example data — not a real scan'
  };

  return { metrics, links };
}

// Helper to fetch live backlinks from DataForSEO
async function fetchLiveBacklinks(domain, mode = 'subdomains') {
  const dfsLogin = process.env.DATAFORSEO_LOGIN;
  const dfsPass = process.env.DATAFORSEO_PASSWORD;
  
  if (!dfsLogin || !dfsPass) {
    throw new Error('DataForSEO credentials not configured in environment');
  }

  const auth = Buffer.from(`${dfsLogin}:${dfsPass}`).toString('base64');
  const cleanDomain = domain.toLowerCase().replace(/^(?:https?:\/\/)?(?:www\.)?/i, "").split('/')[0];

  // 1. Call summary API
  const summaryRes = await axios({
    method: 'post',
    url: 'https://api.dataforseo.com/v3/backlinks/summary/live',
    data: [{
      target: cleanDomain,
      include_subdomains: mode !== 'exact'
    }],
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    timeout: 8000
  });

  // 2. Call backlinks list API
  const listRes = await axios({
    method: 'post',
    url: 'https://api.dataforseo.com/v3/backlinks/backlinks/live',
    data: [{
      target: cleanDomain,
      mode: 'as_is',
      limit: 50,
      include_subdomains: mode !== 'exact'
    }],
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    timeout: 8000
  });

  // Parse Summary
  const summaryTask = summaryRes.data?.tasks?.[0];
  if (!summaryTask || summaryTask.status_code !== 20000) {
    throw new Error(`Summary API error: ${summaryTask?.status_message || 'Unknown error'}`);
  }
  const summaryResult = summaryTask.result?.[0];
  if (!summaryResult) {
    throw new Error('Summary API returned empty results');
  }

  // Parse List
  const listTask = listRes.data?.tasks?.[0];
  if (!listTask || listTask.status_code !== 20000) {
    throw new Error(`List API error: ${listTask?.status_message || 'Unknown error'}`);
  }
  const listItems = listTask.result?.[0]?.items || [];

  // Map to our expected metrics
  const totalBacklinks = summaryResult.backlinks || 0;
  const referringDomains = summaryResult.referring_domains || 0;
  
  // Calculate dofollow ratio
  const dofollowCount = summaryResult.referring_links_attributes?.dofollow || 0;
  const nofollowCount = summaryResult.referring_links_attributes?.nofollow || 0;
  const totalLinksCount = dofollowCount + nofollowCount;
  const dofollowRatio = totalLinksCount > 0 ? Math.round((dofollowCount / totalLinksCount) * 100) : 0;
  
  const rankVal = summaryResult.rank || 0;
  const capRank = rankVal > 100 ? Math.round(Math.min(100, rankVal / 10)) : rankVal;

  const metrics = {
    totalBacklinks,
    referringDomains,
    dofollowRatio: dofollowRatio || 50,
    domainAuthority: capRank || 1,
    provider: 'DataForSEO',
    resultType: 'Live backlink index data'
  };

  // Map items to our link format
  const links = listItems.map((item, idx) => {
    const targetUrl = item.url_to || `https://www.${cleanDomain}/`;
    const dr = item.domain_from_rank 
      ? (item.domain_from_rank > 100 ? Math.round(Math.min(100, item.domain_from_rank / 10)) : item.domain_from_rank)
      : 1;
    const ur = item.page_from_rank
      ? (item.page_from_rank > 100 ? Math.round(Math.min(100, item.page_from_rank / 10)) : item.page_from_rank)
      : 1;

    const status = item.is_broken ? 'Lost' : 'Active';

    return {
      id: idx + 1,
      sourceUrl: item.url_from,
      sourceDomain: item.domain_from || '',
      sourceTitle: item.page_from_title || 'Untitled Referring Page',
      anchorText: item.anchor || 'No anchor text',
      targetUrl: targetUrl,
      type: item.dofollow ? 'Dofollow' : 'Nofollow',
      dr: dr || 1,
      ur: ur || 1,
      refDomains: item.referring_links_count || 1,
      linkedDomains: item.external_links_count || 10,
      status: status,
      firstSeen: item.first_seen ? item.first_seen.split(' ')[0] : new Date().toISOString().split('T')[0],
    };
  });

  return { metrics, links };
}

// Helper to fetch live backlinks from ValueSerp API
async function fetchValueSerpBacklinks(domain) {
  const apiKey = process.env.VALUESERP_API_KEY || process.env.SERP_RADAR_API_KEY || process.env.SERP_API_KEY;
  if (!apiKey) {
    throw new Error('ValueSerp API key not configured');
  }

  const cleanDomain = domain.toLowerCase().replace(/^(?:https?:\/\/)?(?:www\.)?/i, "").split('/')[0];
  
  const searchValueSerp = async (query) => {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await axios.get('https://api.valueserp.com/search', {
          params: {
            q: query,
            api_key: apiKey,
            num: 50,
            location: 'India',
            google_domain: 'google.co.in',
            gl: 'in',
            hl: 'en',
            device: 'desktop'
          },
          timeout: 20000
        });
      } catch (err) {
        lastError = err;
        const status = err.response?.status;
        if (status !== 429 && (!status || status < 500)) break;
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    const status = lastError?.response?.status;
    const providerMessage = lastError?.response?.data?.request_info?.message ||
      lastError?.response?.data?.message || lastError?.message;
    throw new Error(`ValueSERP request failed${status ? ` (${status})` : ''}: ${providerMessage}`);
  };

  // Search ValueSerp for pages linking to or referencing the domain.
  const response = await searchValueSerp(`"${cleanDomain}" -site:${cleanDomain}`);

  const organicResults = response.data?.organic_results || [];

  if (organicResults.length === 0) {
    const fallbackRes = await searchValueSerp(cleanDomain);
    const fallbackOrganic = fallbackRes.data?.organic_results || [];
    organicResults.push(...fallbackOrganic);
  }

  const links = organicResults.map((item, idx) => {
    let sourceDomain = 'external.com';
    try {
      sourceDomain = new URL(item.link).hostname.replace(/^www\./, '');
    } catch (e) {}

    return {
      id: idx + 1,
      sourceUrl: item.link,
      sourceDomain,
      sourceTitle: item.title || `Mention on ${sourceDomain}`,
      snippet: item.snippet || '',
      anchorText: item.snippet ? (item.snippet.slice(0, 80) + '...') : cleanDomain,
      targetUrl: `https://${cleanDomain}/`,
      type: 'Unknown',
      position: item.position || idx + 1,
      status: 'Discovered',
      firstSeen: new Date().toISOString().split('T')[0]
    };
  }).filter(link => link.sourceDomain !== cleanDomain);

  const referringDomains = new Set(links.map(link => link.sourceDomain)).size;
  const authorityEstimate = Math.min(100, Math.round(
    (Math.log10(links.length + 1) * 18) + (Math.log10(referringDomains + 1) * 22)
  ));

  const metrics = {
    totalBacklinks: links.length,
    referringDomains,
    dofollowRatio: null,
    domainAuthority: authorityEstimate,
    provider: 'ValueSERP',
    metricLabel: 'LeadOS authority estimate',
    resultType: 'Search-discovered linking or mentioning pages'
  };

  return { metrics, links };
}

// ── POST /scan ─────────────────────────────────────────────────────────────
router.post('/scan', async (req, res) => {
  const { domain, mode, provider } = req.body;
  if (!domain) {
    return res.status(400).json({ error: 'Domain is required' });
  }

  const useDemoMode = req.headers['x-data-mode'] === 'demo';

  try {
    let metrics, links;
    if (useDemoMode) {
      const mock = generateMockBacklinks(domain);
      metrics = mock.metrics;
      links = mock.links;
      console.log(`Demo Mode active: Generated mock backlinks for: ${domain}`);
    } else if (provider === 'valueserp') {
      try {
        const liveData = await fetchValueSerpBacklinks(domain);
        metrics = liveData.metrics;
        links = liveData.links;
        console.log(`Successfully fetched live discovery data from ValueSerp for: ${domain}`);
      } catch (valueSerpErr) {
        console.warn(`[ValueSERP unavailable]: ${valueSerpErr.message}. Using DataForSEO fallback...`);
        const fallbackData = await fetchLiveBacklinks(domain, mode);
        metrics = {
          ...fallbackData.metrics,
          fallbackReason: valueSerpErr.message
        };
        links = fallbackData.links;
        console.log(`Successfully fetched DataForSEO fallback data for: ${domain}`);
      }
    } else {
      // 1. Try DataForSEO API first
      try {
        const liveData = await fetchLiveBacklinks(domain, mode);
        metrics = liveData.metrics;
        links = liveData.links;
        console.log(`Successfully fetched live backlinks from DataForSEO for: ${domain}`);
      } catch (dfsErr) {
        console.warn(`[DataForSEO Failed]: ${dfsErr.message}. Falling back to ValueSerp API...`);
        // 2. Fallback to ValueSerp API
        try {
          const vsData = await fetchValueSerpBacklinks(domain);
          metrics = vsData.metrics;
          links = vsData.links;
          console.log(`Successfully fetched live backlinks from ValueSerp API for: ${domain}`);
        } catch (vsErr) {
          console.warn(`[ValueSerp Failed]: ${vsErr.message}. Falling back to simulated live backlinks...`);
          // 3. Fallback to generated backlinks so page never crashes
          const mock = generateMockBacklinks(domain);
          metrics = mock.metrics;
          links = mock.links;
        }
      }
    }

    // Save to DB
    await pool.query(
      `INSERT INTO backlink_tracker_history (domain, metrics, links, scanned_at) VALUES ($1, $2, $3, NOW())`,
      [domain, JSON.stringify(metrics), JSON.stringify(links)]
    );

    const { rows: historyRows } = await pool.query(
      `SELECT metrics, scanned_at
         FROM backlink_tracker_history
        WHERE domain = $1
        ORDER BY scanned_at DESC
        LIMIT 12`,
      [domain]
    );

    return res.json({
      domain,
      metrics,
      links,
      history: historyRows.reverse(),
      scanned_at: new Date().toISOString()
    });

  } catch (err) {
    console.error('Backlink scan error:', err);
    return res.status(500).json({ error: err.message || 'Failed to scan backlinks.' });
  }
});

// ── GET /history ────────────────────────────────────────────────────────────
router.get('/history', async (req, res) => {
  try {
    const { domain, startDate, endDate } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const conditions = [];
    const params = [];
    if (domain) {
      params.push(domain.toLowerCase().replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0]);
      conditions.push(`LOWER(REGEXP_REPLACE(domain, '^www\\.', '')) = $${params.length}`);
    }
    if (startDate) {
      params.push(startDate);
      conditions.push(`scanned_at >= $${params.length}::date`);
    }
    if (endDate) {
      params.push(endDate);
      conditions.push(`scanned_at < ($${params.length}::date + INTERVAL '1 day')`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM backlink_tracker_history ${whereClause}`, params);
    const { rows } = await pool.query(
      `SELECT id, domain, metrics, links, scanned_at
         FROM backlink_tracker_history
         ${whereClause}
        ORDER BY scanned_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    return res.json({ history: rows, total: countResult.rows[0].total, limit, offset });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /track ─────────────────────────────────────────────────────────────
router.post('/track', async (req, res) => {
  const { domain, metrics } = req.body;
  if (!domain) return res.status(400).json({ error: 'Domain is required' });

  try {
    const existing = await pool.query('SELECT id FROM tracked_backlinks WHERE domain = $1', [domain]);
    
    if (existing.rows.length > 0) {
      // Untrack if already tracked
      await pool.query('DELETE FROM tracked_backlinks WHERE domain = $1', [domain]);
      return res.json({ success: true, tracking: false, message: 'Domain removed from tracking.' });
    } else {
      // Track
      await pool.query(
        `INSERT INTO tracked_backlinks (domain, metrics, last_checked) VALUES ($1, $2, NOW())`,
        [domain, metrics ? JSON.stringify(metrics) : null]
      );
      return res.json({ success: true, tracking: true, message: 'Domain is now being monitored.' });
    }
  } catch (err) {
    console.error('Track domain error:', err);
    return res.status(500).json({ error: 'Failed to update tracking status.' });
  }
});

// ── GET /tracked ────────────────────────────────────────────────────────────
router.get('/tracked', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM tracked_backlinks ORDER BY added_at DESC`
    );
    return res.json({ tracked: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
