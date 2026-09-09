const express = require('express');
const router = express.Router();
const openRouter = require('../services/openrouter');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'leados_db',
  user: process.env.DB_USER || 'leados_user',
  password: process.env.DB_PASS || 'LeadOS_DB@2026',
});


// Helper to determine category based on positions
const determineCategory = (clientPos, compPositions) => {
  const compPosArr = Object.values(compPositions).filter(p => p !== null && p > 0);
  const bestCompPos = compPosArr.length > 0 ? Math.min(...compPosArr) : null;

  const clientRanks = clientPos !== null && clientPos > 0 && clientPos <= 100;
  const compRanks = bestCompPos !== null && bestCompPos > 0 && bestCompPos <= 100;

  if (clientRanks && compRanks) {
    if (clientPos < bestCompPos) return 'strong';
    if (clientPos > bestCompPos) return 'weak';
    return 'shared';
  }
  if (!clientRanks && compRanks) return 'missing';
  if (clientRanks && !compRanks) return 'unique';
  return 'untapped';
};

// Generate FULLY DYNAMIC domain-specific data using Gemini (optimized for speed)
const generateDynamicGapDataWithAI = async (clientDomain, competitors) => {
  // Use a compact, direct prompt — fewer tokens = faster response
  const prompt = `SEO Keyword Gap analysis for:
- Client: ${clientDomain}
- Competitors: ${competitors.join(', ')}

Generate exactly 25 realistic industry-specific keywords as a JSON array. Each item must have:
keyword (string), intent ("Informational"|"Commercial"|"Transactional"), volume (integer), kd (1-100 integer), cpc (float), com (0.00-1.00 float), results (string like "1.2M"), clientPos (1-100 or null), competitorPositions (object with competitor domain keys, values 1-100 or null).

Ensure a realistic mix: some keywords where client ranks better (strong), some where competitors rank better (weak/missing), some shared, some unique to client, some untapped. Return ONLY the raw JSON array, no explanation.`;

  const response = await openRouter.models.generateContent({
    model: openRouter.DEFAULT_MODEL,
    contents: prompt,
    config: {
      temperature: 0.4,
    },
  });

  // Strip markdown fences if present
  const rawText = response.text.replace(/```json/g, '').replace(/```/g, '').trim();

  const generatedKeywords = JSON.parse(rawText);

  const keywords = [];
  const overlapStats = { shared: 0, missing: 0, weak: 0, strong: 0, untapped: 0, unique: 0 };

  generatedKeywords.forEach((kw, i) => {
    const compPositions = {};
    competitors.forEach(c => {
      compPositions[c] = kw.competitorPositions?.[c] || null;
    });

    const category = determineCategory(kw.clientPos, compPositions);

    // Shared bucket includes strong + weak + exact shared (all domains rank)
    if (category === 'shared' || category === 'weak' || category === 'strong') {
      overlapStats.shared++;
    }
    // Each individual category still tracked for tabs
    if (overlapStats[category] !== undefined) {
      overlapStats[category]++;
    }

    keywords.push({
      id: `kw_${i}_${Date.now()}`,
      keyword: kw.keyword,
      intent: kw.intent || 'Informational',
      volume: Number(kw.volume) || 100,
      kd: Number(kw.kd) || 50,
      cpc: Number(kw.cpc)?.toFixed(2) || '1.00',
      com: Number(kw.com)?.toFixed(2) || '0.50',
      results: kw.results || '1M',
      clientPos: kw.clientPos || null,
      competitorPositions: compPositions,
      category,
    });
  });

  return { keywords, overlapStats };
};

// Helper to generate mock gap hunter data for testing/sandbox
function generateMockGapData(clientDomain, competitors) {
  const intents = ['Informational', 'Commercial', 'Transactional'];
  const baseKeywords = [
    'local digital marketing agency', 'web design packages', 'affordable seo services',
    'ppc management cost', 'google business profile optimization', 'lead generation strategies',
    'b2b content writing', 'social media advertising pondicherry', 'ecommerce web development',
    'seo audit checklist', 'how to rank on google maps', 'best marketing tools 2026',
    'responsive design benefits', 'conversion rate optimization', 'local map pack ranking',
    'website speed optimization', 'meta tags generator', 'schema markup builder',
    'link building agency', 'on-page seo checklist', 'dental seo services',
    'real estate leads', 'gmb review optimization', 'organic traffic growth',
    'google search console integration'
  ];

  const keywords = [];
  const overlapStats = { shared: 0, missing: 0, weak: 0, strong: 0, untapped: 0, unique: 0 };

  baseKeywords.forEach((word, idx) => {
    const intent = intents[idx % intents.length];
    const volume = Math.floor(Math.random() * 2000) + 150;
    const kd = Math.floor(Math.random() * 70) + 15;
    const cpc = (0.5 + Math.random() * 8.5).toFixed(2);
    const com = (0.1 + Math.random() * 0.8).toFixed(2);
    const results = `${(100 + Math.random() * 900).toFixed(0)}k`;

    // Client rank
    const clientPos = idx % 5 === 0 ? null : Math.floor(Math.random() * 90) + 1;
    
    // Competitor positions
    const compPositions = {};
    competitors.forEach(c => {
      compPositions[c] = idx % 4 === 0 ? null : Math.floor(Math.random() * 80) + 1;
    });

    const category = determineCategory(clientPos, compPositions);

    if (category === 'shared' || category === 'weak' || category === 'strong') {
      overlapStats.shared++;
    }
    if (overlapStats[category] !== undefined) {
      overlapStats[category]++;
    }

    keywords.push({
      id: `kw_${idx}_${Date.now()}`,
      keyword: word,
      intent,
      volume,
      kd,
      cpc,
      com,
      results,
      clientPos,
      competitorPositions: compPositions,
      category
    });
  });

  return { keywords, overlapStats };
}

router.get('/history', async (req, res) => {
  const { domain, startDate, endDate } = req.query;
  if (!domain) return res.status(400).json({ error: 'domain is required' });
  try {
    const { rows } = await pool.query(
      `SELECT id, client_domain, competitor_domain, results_json, scanned_at
         FROM gap_hunter_scans
        WHERE LOWER(client_domain) = LOWER($1)
          AND ($2::date IS NULL OR scanned_at >= $2::date)
          AND ($3::date IS NULL OR scanned_at < ($3::date + INTERVAL '1 day'))
        ORDER BY scanned_at DESC
        LIMIT 20`,
      [domain, startDate || null, endDate || null]
    );
    res.json({ history: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/track', async (req, res) => {
  const { clientDomain, keywords } = req.body;
  if (!clientDomain || !keywords || !keywords.length) {
    return res.status(400).json({ error: 'Client domain and keywords are required.' });
  }

  try {
    // Batch insert with Promise.all instead of sequential awaits
    await Promise.all(keywords.map(kw =>
      pool.query(
        `INSERT INTO thedal_tracked_keywords (client_domain, keyword) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [clientDomain, kw]
      )
    ));
    res.json({ success: true, message: `Successfully tracked ${keywords.length} keywords.` });
  } catch (err) {
    console.error('Failed to track keywords:', err);
    res.status(500).json({ error: 'Database error while tracking keywords.' });
  }
});

router.post('/scan', async (req, res) => {
  let { clientDomain, competitors = [] } = req.body;

  if (!clientDomain) {
    return res.status(400).json({ error: 'Client domain is required.' });
  }

  try {
    // Auto-discover competitors if none provided (run in parallel with AI call)
    let competitorLookup = Promise.resolve();
    if (!competitors || competitors.length === 0) {
      competitorLookup = pool
        .query(`SELECT competitors_json FROM serp_radar_history ORDER BY scanned_at DESC LIMIT 1`)
        .then(({ rows }) => {
          if (rows.length > 0 && rows[0].competitors_json?.length > 0) {
            competitors = [rows[0].competitors_json[0].domain];
          } else {
            competitors = ['searchenginejournal.com'];
          }
        })
        .catch(() => {
          competitors = ['searchenginejournal.com'];
        });
    }

    // Run competitor lookup + tracked keyword fetch in parallel
    const [, trackedResult] = await Promise.all([
      competitorLookup,
      pool.query(
        `SELECT keyword FROM thedal_tracked_keywords WHERE client_domain = $1`,
        [clientDomain]
      ).catch(() => ({ rows: [] })),
    ]);

    const activeKeywords = new Set((trackedResult?.rows || []).map(r => r.keyword.toLowerCase()));

    // Generate AI data AFTER competitor list is resolved
    const useDemoMode = req.headers['x-data-mode'] === 'demo' || !openRouter.isConfigured;
    let gapData;
    if (useDemoMode) {
      gapData = generateMockGapData(clientDomain, competitors);
      console.log(`Demo Mode active: Generated mock keywords gap report for client: ${clientDomain}`);
    } else {
      gapData = await generateDynamicGapDataWithAI(clientDomain, competitors);
    }
    const { keywords, overlapStats } = gapData;

    const finalKeywords = keywords
      .map(kw => ({ ...kw, is_already_tracked: activeKeywords.has(kw.keyword.toLowerCase()) }))
      .sort((a, b) => b.volume - a.volume);

    // Send response immediately — don't wait for DB write
    res.json({
      clientDomain,
      competitors,
      scanned_at: new Date().toISOString(),
      overlapStats,
      keywords: finalKeywords,
    });

    // Non-blocking DB history save (fire and forget)
    const joinedCompetitors = competitors.join(',').substring(0, 255);
    pool.query(
      `INSERT INTO gap_hunter_scans (client_domain, competitor_domain, results_json) VALUES ($1, $2, $3)`,
      [clientDomain, joinedCompetitors, JSON.stringify(finalKeywords)]
    ).catch(err => console.error('Non-blocking DB save failed:', err));

  } catch (err) {
    console.error('Gap Hunter API Error:', err);
    res.status(500).json({ error: 'Failed to run Keyword Gap Analysis.' });
  }
});

module.exports = router;
