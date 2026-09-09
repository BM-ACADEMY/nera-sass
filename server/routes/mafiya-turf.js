const express = require('express');
const router = express.Router();
const axios = require('axios');
const cheerio = require('cheerio');
const pool = require('../db/connection');
const { generateContent, DEFAULT_MODEL } = require('../services/openrouter');

// GET keywords for a GMB client
router.get('/keywords', async (req, res) => {
  const { clientId } = req.query;
  if (!clientId) return res.status(400).json({ error: 'clientId is required' });

  try {
    const result = await pool.query(
      'SELECT * FROM mafiya_turf_keywords WHERE client_id = $1 ORDER BY created_at DESC',
      [clientId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Mafiya Turf] GET /keywords error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST add new GMB keyword
router.post('/keywords', async (req, res) => {
  const { client_id, keyword, initial_rank, pack_status } = req.body;
  if (!client_id || !keyword) {
    return res.status(400).json({ error: 'client_id and keyword are required' });
  }

  const { checkLimit } = require('../utils/limit-checker');

  try {
    // Enforce keyword limit check
    const limitCheck = await checkLimit(client_id, 'mafiya_keywords', async () => {
      const countRes = await pool.query('SELECT COUNT(*) FROM mafiya_turf_keywords WHERE client_id = $1', [client_id]);
      return parseInt(countRes.rows[0].count, 10);
    });

    if (!limitCheck.allowed) {
      return res.status(403).json({ 
        error: 'Limit reached', 
        message: `Your current plan allows up to ${limitCheck.limit} keywords. Please upgrade your plan to track more keywords.` 
      });
    }

    const result = await pool.query(
      `INSERT INTO mafiya_turf_keywords (client_id, keyword, initial_rank, current_rank, pack_status, last_checked)
       VALUES ($1, $2, $3, $3, $4, NOW())
       RETURNING *`,
      [client_id, keyword.trim(), initial_rank || 100, pack_status || 'Not in Pack']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[Mafiya Turf] POST /keywords error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT manually update a tracked keyword and its ranking values.
// client_id is required so a keyword cannot be edited from another active client.
router.put('/keywords/:id', async (req, res) => {
  const { client_id, keyword, initial_rank, current_rank, pack_status } = req.body;
  if (!client_id || !keyword?.trim()) {
    return res.status(400).json({ error: 'client_id and keyword are required' });
  }

  const parseRank = (value, field) => {
    const rank = Number(value);
    if (!Number.isInteger(rank) || rank < 1 || rank > 100) {
      const error = new Error(`${field} must be a whole number from 1 to 100`);
      error.status = 400;
      throw error;
    }
    return rank;
  };

  try {
    const initialRank = parseRank(initial_rank, 'Initial rank');
    const currentRank = parseRank(current_rank, 'Current rank');
    const packStatus = pack_status === 'In Pack' ? 'In Pack' : 'Not in Pack';
    const result = await pool.query(
      `UPDATE mafiya_turf_keywords
       SET keyword = $1, initial_rank = $2, current_rank = $3,
           pack_status = $4, last_checked = NOW()
       WHERE id = $5 AND client_id = $6
       RETURNING *`,
      [keyword.trim(), initialRank, currentRank, packStatus, req.params.id, client_id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Keyword not found for this client' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('[Mafiya Turf] PUT /keywords error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE stop tracking keyword
router.delete('/keywords/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM mafiya_turf_keywords WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Keyword not found' });
    res.json({ message: 'Keyword deleted successfully' });
  } catch (err) {
    console.error('[Mafiya Turf] DELETE /keywords error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Helper to clean domain name for comparison
function cleanDomain(url) {
  if (!url) return '';
  return url.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/$/, '').trim();
}

// Resolve coordinates of GMB business profile
async function resolveClientCoords(client, apiKey) {
  let searchName = client.business_name;

  if (client.gmb_url) {
    try {
      const res = await axios.get(client.gmb_url, {
        maxRedirects: 5,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
        }
      });
      const finalUrl = res.request.res.responseUrl;
      const urlObj = new URL(finalUrl);
      const q = urlObj.searchParams.get('q');
      if (q) {
        searchName = q;
      }
    } catch (err) {
      console.error('[Mafiya Turf] Failed to resolve GMB URL:', err.message);
    }
  }

  try {
    const res = await axios.post(
      'https://google.serper.dev/places',
      { q: searchName, gl: 'in', hl: 'en' },
      { headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' } }
    );
    const places = res.data?.places || [];
    const clientWeb = cleanDomain(client.website_url);
    const cleanClientName = client.business_name.toLowerCase().replace(/[^a-z0-9]/g, '');

    let matchedPlace = null;
    for (const p of places) {
      const placeWeb = cleanDomain(p.website || p.link);
      const cleanPlaceTitle = p.title.toLowerCase().replace(/[^a-z0-9]/g, '');

      const webMatch = clientWeb && placeWeb && (placeWeb.includes(clientWeb) || clientWeb.includes(placeWeb));
      const nameMatch = cleanPlaceTitle.includes(cleanClientName) || cleanClientName.includes(cleanPlaceTitle);

      if (webMatch || nameMatch) {
        matchedPlace = p;
        break;
      }
    }

    if (!matchedPlace && places.length > 0) {
      matchedPlace = places[0];
    }

    if (matchedPlace) {
      const { latitude, longitude } = matchedPlace;
      await pool.query(
        'UPDATE mafiya_gmb_clients SET latitude = $1, longitude = $2 WHERE id = $3',
        [latitude, longitude, client.id]
      );
      return { latitude, longitude };
    }
  } catch (err) {
    console.error('[Mafiya Turf] Serper Places coordinates search failed:', err.message);
  }
  return null;
}

// POST refresh keyword position (using Serper API or ValueSERP)
router.post('/keywords/refresh/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const kwResult = await pool.query('SELECT * FROM mafiya_turf_keywords WHERE id = $1', [id]);
    if (kwResult.rowCount === 0) return res.status(404).json({ error: 'Keyword not found' });

    const kwItem = kwResult.rows[0];
    const clientResult = await pool.query('SELECT * FROM mafiya_gmb_clients WHERE id = $1', [kwItem.client_id]);
    if (clientResult.rowCount === 0) return res.status(404).json({ error: 'Client not found' });

    let client = clientResult.rows[0];
    const apiKey = process.env.SERPER_API_KEY || process.env.SERP_API_KEY;
    const isDemo = !apiKey;

    let newRank = null;
    let packStatus = 'Not in Pack';

    if (isDemo) {
      // Simulate GMB position lookup
      newRank = Math.random() > 0.2 ? Math.floor(Math.random() * 12) + 1 : null;
      packStatus = newRank && newRank <= 3 ? 'In Pack' : 'Not in Pack';
    } else {
      // Check if client has cached coordinates. If not, resolve them.
      let lat = client.latitude;
      let lng = client.longitude;
      
      if (lat === null || lng === null) {
        const coords = await resolveClientCoords(client, apiKey);
        if (coords) {
          lat = coords.latitude;
          lng = coords.longitude;
        }
      }

      const llParam = (lat !== null && lng !== null) ? `@${lat},${lng},14z` : null;

      // Query 3 pages of results to search top 30 places
      let localResults = [];
      for (let page = 1; page <= 3; page++) {
        try {
          const reqBody = { q: kwItem.keyword, gl: 'in', hl: 'en', page: page };
          if (llParam) {
            reqBody.ll = llParam;
          }
          const placesResponse = await axios.post(
            'https://google.serper.dev/places',
            reqBody,
            { headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' } }
          );
          const pagePlaces = placesResponse.data?.places || [];
          localResults = localResults.concat(pagePlaces);
          // If page returned fewer than 10 results, no more pages exist
          if (pagePlaces.length < 10) break;
        } catch (err) {
          console.error(`[Mafiya Turf] Serper places API failed on page ${page}:`, err.message);
          break;
        }
      }

      // Fallback to Serper Search API if Places returned nothing at all
      if (localResults.length === 0) {
        try {
          const searchResponse = await axios.post(
            'https://google.serper.dev/search',
            { q: kwItem.keyword, gl: 'in', hl: 'en', num: 100 },
            { headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' } }
          );
          localResults = searchResponse.data?.localResults || searchResponse.data?.local?.results || [];
        } catch (err) {
          console.error('[Mafiya Turf] Serper search API fallback failed:', err.message);
        }
      }

      // Try to find client name in Local Maps results using a robust alphanumeric match + website match
      const cleanClientName = client.business_name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const clientWebHost = cleanDomain(client.website_url);

      const matchIdx = localResults.findIndex(r => {
        // 1. Match by website URL if available
        if (clientWebHost && (r.website || r.link)) {
          const resultWeb = cleanDomain(r.website || r.link);
          if (resultWeb.includes(clientWebHost) || clientWebHost.includes(resultWeb)) {
            return true;
          }
        }
        // 2. Match by business name
        const cleanResultTitle = r.title.toLowerCase().replace(/[^a-z0-9]/g, '');
        return cleanResultTitle.includes(cleanClientName) || cleanClientName.includes(cleanResultTitle);
      });

      if (matchIdx !== -1) {
        newRank = matchIdx + 1;
        packStatus = newRank <= 3 ? 'In Pack' : 'Not in Pack';
      }
    }

    const updated = await pool.query(
      `UPDATE mafiya_turf_keywords
       SET previous_rank = current_rank, 
           current_rank = $1, 
           pack_status = $2, 
           initial_rank = CASE WHEN initial_rank = 100 THEN $1 ELSE initial_rank END,
           last_checked = NOW()
       WHERE id = $3
       RETURNING *`,
      [newRank, packStatus, id]
    );

    res.json(updated.rows[0]);
  } catch (err) {
    console.error('[Mafiya Turf] refresh error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET PageSpeed Insights audit
router.get('/pagespeed', async (req, res) => {
  const { url, strategy = 'mobile' } = req.query;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const cleanUrl = url.startsWith('http') ? url : `https://${url}`;
  const apiKey = process.env.GOOGLE_PAGESPEED_API_KEY;

  try {
    let pagespeedUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(cleanUrl)}&category=performance&strategy=${strategy === 'desktop' ? 'desktop' : 'mobile'}`;
    if (apiKey) pagespeedUrl += `&key=${apiKey}`;

    const response = await axios.get(pagespeedUrl);
    const lighthouse = response.data?.lighthouseResult;

    const performanceScore = Math.round((lighthouse?.categories?.performance?.score || 0) * 100);
    const speedIndex = lighthouse?.audits?.['speed-index']?.displayValue || 'N/A';
    const firstContentfulPaint = lighthouse?.audits?.['first-contentful-paint']?.displayValue || 'N/A';
    const largestContentfulPaint = lighthouse?.audits?.['largest-contentful-paint']?.displayValue || 'N/A';
    const cumulativeLayoutShift = lighthouse?.audits?.['cumulative-layout-shift']?.displayValue || 'N/A';
    const interactionToNextPaint = response.data?.loadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT?.percentile
      ? `${response.data.loadingExperience.metrics.INTERACTION_TO_NEXT_PAINT.percentile} ms`
      : 'Insufficient field data';

    res.json({
      performance: performanceScore,
      speedIndex,
      firstContentfulPaint,
      largestContentfulPaint,
      cumulativeLayoutShift,
      interactionToNextPaint,
      strategy,
    });
  } catch (err) {
    console.error('[Mafiya Turf] PageSpeed error:', err.message);
    // Fallback Mock Data so it never crashes
    res.json({
      performance: 74,
      speedIndex: '2.1 s',
      firstContentfulPaint: '1.2 s',
      largestContentfulPaint: '2.8 s',
      isMock: true
    });
  }
});

// GET AI Keyword suggestions via Gemini


// GET AI Keyword suggestions via Gemini
router.get('/ai-suggestions', async (req, res) => {
  const { clientId, location } = req.query;
  if (!clientId) return res.status(400).json({ error: 'clientId is required' });

  const targetLoc = location && location.trim() ? location.trim() : 'Pondicherry';

  try {
    const clientResult = await pool.query('SELECT * FROM mafiya_gmb_clients WHERE id = $1', [clientId]);
    if (clientResult.rowCount === 0) return res.status(404).json({ error: 'Client not found' });

    const client = clientResult.rows[0];

    let scrapedContent = '';
    if (client.website_url) {
      try {
        const cleanUrl = client.website_url.startsWith('http') ? client.website_url : `https://${client.website_url}`;
        console.log('[Mafiya Turf] Scraping client website:', cleanUrl);
        const webRes = await axios.get(cleanUrl, { 
          timeout: 6000, 
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36' } 
        });
        if (webRes.status === 200) {
          const $ = cheerio.load(webRes.data);
          const pageTitle = $('title').text().trim();
          const metaDesc = $('meta[name="description"]').attr('content')?.trim() || '';
          
          const headings = [];
          $('h1, h2, h3').each((i, el) => {
            const txt = $(el).text().trim();
            if (txt && headings.length < 12) headings.push(txt);
          });
          
          const bodyText = $('body').text().replace(/\s+/g, ' ').substring(0, 1200).trim();
          
          scrapedContent = `
          Page Title: ${pageTitle}
          Meta Description: ${metaDesc}
          Headings: ${headings.join(' | ')}
          Sample Content: ${bodyText}
          `;
          console.log('[Mafiya Turf] Successfully scraped client website.');
        }
      } catch (scrapErr) {
        console.error('[Mafiya Turf] Failed to scrape website:', scrapErr.message);
      }
    }

    const prompt = `You are a local SEO expert. Analyze this GMB client details and their scraped website content:
    Business Name: ${client.business_name}
    Category: ${client.business_category}
    Website: ${client.website_url || 'N/A'}
    Target Location / City: ${targetLoc}
    
    Scraped Website Content:
    ${scrapedContent || 'No content scraped from website.'}
    
    Using the client's actual services, business description, and target location "${targetLoc}" from the website content, generate 4 highly relevant target local keywords containing "${targetLoc}" suitable for Google Maps 3-Pack tracking.
    Return ONLY a JSON array of objects with "keyword" and "volume" properties. Return strictly a JSON format list of objects. Example format:
    [
      {"keyword": "SEO course ${targetLoc}", "volume": "~200/mo"},
      {"keyword": "digital marketing training ${targetLoc}", "volume": "~320/mo"}
    ]`;

    const response = await generateContent({
      model: DEFAULT_MODEL,
      contents: prompt,
      config: { maxOutputTokens: 600, temperature: 0.3, responseMimeType: 'application/json' }
    });

    let suggestions = JSON.parse(response.text.trim());
    if (!Array.isArray(suggestions)) {
      if (suggestions.keywords && Array.isArray(suggestions.keywords)) {
        suggestions = suggestions.keywords;
      } else if (suggestions.suggestions && Array.isArray(suggestions.suggestions)) {
        suggestions = suggestions.suggestions;
      } else {
        const arrayVal = Object.values(suggestions).find(v => Array.isArray(v));
        if (arrayVal) {
          suggestions = arrayVal;
        } else {
          suggestions = [];
        }
      }
    }
    res.json(suggestions);
  } catch (err) {
    console.error('[Mafiya Turf] AI suggestions error:', err);
    res.json([
      { keyword: `digital marketing course ${targetLoc}`, volume: '~250/mo' },
      { keyword: `best SEO training ${targetLoc}`, volume: '~180/mo' },
      { keyword: `social media marketing course ${targetLoc}`, volume: '~150/mo' },
      { keyword: `best digital marketing institute ${targetLoc}`, volume: '~120/mo' }
    ]);
  }
});

module.exports = router;
