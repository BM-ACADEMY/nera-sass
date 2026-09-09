const express = require('express');
const router = express.Router();
const axios = require('axios');
const cheerio = require('cheerio');
const openRouter = require('../services/openrouter');
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'leados',
  password: process.env.DB_PASS || 'LeadOS_DB@2026',
  port: process.env.DB_PORT || 5432,
});

// Initialize table
pool.query(`
  CREATE TABLE IF NOT EXISTS seo_audits (
    id SERIAL PRIMARY KEY,
    client_id VARCHAR(255) NOT NULL,
    url VARCHAR(255) NOT NULL,
    audit_data JSONB NOT NULL DEFAULT '{}',
    off_page_checklist JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(client_id)
  );
`).catch(err => console.error('Error creating seo_audits table:', err));

const STOP_WORDS = new Set(["a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by", "can", "cannot", "did", "do", "does", "doing", "down", "during", "each", "few", "for", "from", "further", "had", "has", "have", "having", "he", "her", "here", "hers", "herself", "him", "himself", "his", "how", "i", "if", "in", "into", "is", "it", "its", "itself", "me", "more", "most", "my", "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "our", "ours", "ourselves", "out", "over", "own", "same", "she", "should", "so", "some", "such", "than", "that", "the", "their", "theirs", "them", "themselves", "then", "there", "these", "they", "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "we", "were", "what", "when", "where", "which", "while", "who", "whom", "why", "with", "would", "you", "your", "yours", "yourself", "yourselves"]);

// GET /saved - Fetch saved audit for a client
router.get('/saved', async (req, res) => {
  const { clientId } = req.query;
  if (!clientId) return res.status(400).json({ error: 'clientId is required' });

  try {
    const { rows } = await pool.query('SELECT * FROM seo_audits WHERE client_id = $1', [clientId]);
    if (rows.length === 0) {
      return res.json({ saved: false });
    }
    res.json({
      saved: true,
      url: rows[0].url,
      auditData: rows[0].audit_data,
      offPageChecklist: rows[0].off_page_checklist,
      updatedAt: rows[0].updated_at
    });
  } catch (err) {
    console.error('Error fetching saved audit:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// PUT /offpage - Update off-page checklist
router.put('/offpage', async (req, res) => {
  const { clientId, checklist } = req.body;
  if (!clientId || !checklist) return res.status(400).json({ error: 'clientId and checklist required' });

  try {
    await pool.query(
      `INSERT INTO seo_audits (client_id, url, off_page_checklist)
       VALUES ($1, '', $2)
       ON CONFLICT (client_id)
       DO UPDATE SET off_page_checklist = $2, updated_at = CURRENT_TIMESTAMP`,
      [clientId, checklist]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating offpage checklist:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/', async (req, res) => {
  const { url, clientId } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  let targetUrl = url.trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = 'https://' + targetUrl;
  }

  let urlObj;
  try {
    urlObj = new URL(targetUrl);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  const useDemoMode = req.headers['x-data-mode'] === 'demo';
  if (useDemoMode) {
    return res.json({
      url: targetUrl,
      inferredKeyword: 'Indian Manufacturers',
      inferredBusinessName: 'ExportersIndia',
      inferredCity: 'New Delhi',
      overallScore: 0, // computed by frontend
      onPage: {
        score: 84,
        checks: [
          { id: 'title-presence', name: 'Title Tag Presence', status: 'passed', points: 5, maxPoints: 5, value: 'Title found', recommendation: 'Your title tag is present.', priority: 'high' },
          { id: 'title-length', name: 'Title Length', status: 'passed', points: 5, maxPoints: 5, value: 'Title length is 58 characters', recommendation: 'Target between 50 and 60 characters.', priority: 'medium' },
          { id: 'title-keyword', name: 'Keyword in Title', status: 'passed', points: 5, maxPoints: 5, value: 'Keyword "Indian Manufacturers" present', recommendation: 'Keyword is present in title.', priority: 'high' },
          { id: 'desc-presence', name: 'Meta Description Presence', status: 'passed', points: 5, maxPoints: 5, value: 'Meta description found', recommendation: 'Meta description is present.', priority: 'high' },
          { id: 'h1-count', name: 'H1 Headings Count', status: 'passed', points: 5, maxPoints: 5, value: 'Found exactly 1 H1 tag', recommendation: 'Ensure your page has exactly one H1 tag.', priority: 'high' },
          { id: 'meta-viewport', name: 'Viewport Tag', status: 'passed', points: 2, maxPoints: 2, value: 'Viewport tag is present', recommendation: 'Mobile responsiveness enabled.', priority: 'high' },
          { id: 'content-length-check', name: 'Content Word Count', status: 'passed', points: 5, maxPoints: 5, value: 'Word count is 940 words', recommendation: 'Healthy text length.', priority: 'medium' },
          { id: 'img-alt-tags', name: 'Image Alt Text', status: 'warning', points: 2, maxPoints: 4, value: '3 of 12 images lack alt attributes', recommendation: 'Provide descriptive alt tags for all images.', priority: 'high' }
        ]
      },
      technical: {
        score: 82,
        checks: [
          { id: 'robots-txt', name: 'Robots.txt Found', status: 'passed', points: 5, maxPoints: 5, value: 'robots.txt is accessible', recommendation: 'Robots.txt is properly configured.', priority: 'high' },
          { id: 'sitemap', name: 'XML Sitemap Found', status: 'passed', points: 5, maxPoints: 5, value: 'sitemap.xml found with 4200 URLs', recommendation: 'Sitemap is present.', priority: 'high' },
          { id: 'response-time', name: 'Page Response Time', status: 'passed', points: 5, maxPoints: 5, value: 'Response time: 310ms', recommendation: 'Good response time.', priority: 'high' },
          { id: 'https', name: 'HTTPS Enabled', status: 'passed', points: 5, maxPoints: 5, value: 'Site uses HTTPS', recommendation: 'HTTPS is properly configured.', priority: 'high' },
          { id: 'canonical', name: 'Canonical Tag', status: 'warning', points: 2, maxPoints: 5, value: 'Canonical tag missing on some pages', recommendation: 'Add canonical tags to avoid duplicate content.', priority: 'medium' },
          { id: 'broken-links', name: 'Broken Links', status: 'passed', points: 5, maxPoints: 5, value: 'No broken links detected', recommendation: 'No broken links found.', priority: 'high' }
        ]
      },
      local: {
        score: 50,
        checks: [
          { id: 'local-schema', name: 'LocalBusiness Schema', status: 'warning', points: 2, maxPoints: 5, value: 'Schema found but not LocalBusiness type', recommendation: 'Add LocalBusiness schema markup.', priority: 'high' },
          { id: 'nap-consistency', name: 'NAP Consistency', status: 'passed', points: 5, maxPoints: 5, value: 'Phone number detected on page', recommendation: 'NAP details visible on page.', priority: 'high' }
        ]
      },
      serp: {
        title: 'ExportersIndia - Indian Manufacturers, Suppliers & Exporters Directory',
        description: 'B2B portal of Indian manufacturers, exporters, suppliers, and importers directory.'
      },
      linksCount: {
        internal: 142,
        external: 15,
        broken: 0,
        doFollowInt: 138,
        doFollowExt: 12,
        noFollow: 7
      },
      wordCloud: [
        { word: 'manufacturers', count: 42 },
        { word: 'exporters', count: 38 },
        { word: 'suppliers', count: 31 },
        { word: 'indian', count: 28 },
        { word: 'products', count: 24 },
        { word: 'business', count: 19 }
      ],
      densityInfo: { count: 17, percent: 1.85 },
      schemaInfo: { types: ['Organization', 'WebSite', 'DirectoryList'] },
      robotsText: 'User-agent: *\nAllow: /',
      phone: '+91 9999999999',
      aiContent: {
        score: 72,
        recommendations: [
          'Improve content depth with more detailed product descriptions.',
          'Add FAQs to target long-tail keywords.',
          'Include location-specific landing pages for better local targeting.'
        ]
      }
    });
  }

  const startTime = Date.now();
  try {
    // 1. Fetch Website HTML
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      },
      timeout: 10000
    });
    
    const responseTime = Date.now() - startTime;
    const html = response.data;
    const finalUrl = response.request?.res?.responseUrl || targetUrl;
    const $ = cheerio.load(html);

    // 2. Extract tags & content details
    const title = $('title').text().trim() || '';
    const metaDescription = $('meta[name="description" i]').attr('content')?.trim() || '';
    const viewportVal = $('meta[name="viewport" i]').attr('content')?.trim() || '';
    const charsetVal = $('meta[charset]').attr('charset')?.trim() || $('meta[http-equiv="content-type" i]').attr('content')?.trim() || '';
    const robotsVal = $('meta[name="robots" i]').attr('content')?.trim() || '';
    const canonicalVal = $('link[rel="canonical" i]').attr('href')?.trim() || '';

    // Headings
    const allHeadings = [];
    const h1s = [];
    const h2s = [];
    const h3s = [];
    $('h1, h2, h3, h4, h5, h6').each((_, el) => {
      const tag = el.name.toUpperCase();
      const text = $(el).text().trim();
      allHeadings.push({ tag, text });
      if (tag === 'H1') h1s.push(text);
      if (tag === 'H2') h2s.push(text);
      if (tag === 'H3') h3s.push(text);
    });
    const h1Text = h1s[0] || '';

    // Body Text
    const bodyClone = $('body').clone();
    bodyClone.find('script, style, noscript, iframe').remove();
    const pageText = bodyClone.text() || '';
    const words = pageText.toLowerCase().match(/\b[a-z0-9'-]+\b/g) || [];
    const totalWords = words.length;

    // Word frequencies & Top 10 words
    const wordFreq = {};
    words.forEach(w => {
      if (w.length > 2 && !STOP_WORDS.has(w) && isNaN(w)) {
        wordFreq[w] = (wordFreq[w] || 0) + 1;
      }
    });
    const topWords = Object.entries(wordFreq)
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Auto-infer Keyword
    let inferredKw = '';
    if (h1Text) {
      const parts = h1Text.split(/[|:-]/);
      if (parts[0]) inferredKw = parts[0].trim();
    } else if (title) {
      const parts = title.split(/[|:-]/);
      if (parts[0]) inferredKw = parts[0].trim();
    }
    if (!inferredKw || inferredKw.split(/\s+/).length > 3) {
      inferredKw = topWords[0]?.word || 'seo';
    }
    const lowerKw = inferredKw.toLowerCase();

    // Keyword Density & count
    const kwRegex = new RegExp('\\b' + lowerKw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'gi');
    const kwCount = (pageText.match(kwRegex) || []).length;
    const density = totalWords > 0 ? (kwCount / totalWords) * 100 : 0;

    // Parsed schemas JSON-LD
    const schemas = [];
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const parsed = JSON.parse($(el).text() || '{}');
        if (Array.isArray(parsed)) schemas.push(...parsed);
        else schemas.push(parsed);
      } catch (e) {}
    });

    const schemaTypes = [];
    schemas.forEach(s => {
      const type = s['@type'];
      if (typeof type === 'string') {
        schemaTypes.push(type);
      } else if (Array.isArray(type)) {
        schemaTypes.push(...type);
      }
    });

    // Auto-infer local business details
    const localBusinessSchema = schemas.find(s => {
      const type = s['@type'];
      if (typeof type === 'string') return type === 'LocalBusiness' || type.includes('Business') || ['Restaurant', 'Dentist', 'Store', 'Hotel', 'AutomotiveBusiness', 'ProfessionalService'].includes(type);
      if (Array.isArray(type)) return type.some(t => t === 'LocalBusiness' || t.includes('Business'));
      return false;
    });

    let inferredBusinessName = '';
    let inferredCity = '';
    if (localBusinessSchema) {
      inferredBusinessName = localBusinessSchema.name || '';
      if (localBusinessSchema.address) {
        inferredCity = localBusinessSchema.address.addressLocality || '';
      }
    }
    if (!inferredBusinessName) {
      inferredBusinessName = title ? title.split(/[|:-]/)[0].trim() : urlObj.hostname.replace('www.', '').split('.')[0];
    }
    if (!inferredCity) {
      const cityMatch = pageText.match(/(?:in|near|at)\s+([A-Z][a-zA-Z\s]{2,15})(?:\b|,\s*[A-Z]{2})/);
      inferredCity = cityMatch ? cityMatch[1].trim() : 'Local Area';
    }
    const lowerName = inferredBusinessName.toLowerCase().trim();
    const lowerCity = inferredCity.toLowerCase().trim();

    // Link counts and types
    const sameOriginRegex = new RegExp('^' + urlObj.origin.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '|^/|^#');
    const internalLinks = [];
    const externalLinks = [];
    const noFollowLinks = [];
    const hashLinks = [];
    const badAnchors = [];
    const genericKeywords = ['click here', 'read more', 'learn more', 'more', 'link', 'here'];

    $('a').each((_, el) => {
      const href = $(el).attr('href') || '';
      const rel = ($(el).attr('rel') || '').toLowerCase();
      const text = $(el).text().trim().toLowerCase();

      if (!href || href === '#' || href.startsWith('javascript:')) {
        hashLinks.push(href);
      }
      if (rel.includes('nofollow')) {
        noFollowLinks.push(href);
      }

      const isInternal = sameOriginRegex.test(href) && !href.startsWith('//');
      if (isInternal) {
        internalLinks.push(href);
        if (genericKeywords.includes(text)) {
          badAnchors.push(href);
        }
      } else if (href.startsWith('http') || href.startsWith('//')) {
        externalLinks.push(href);
      }
    });

    // 404 Broken links check ( Axios sample checks )
    const uniqueInternal = Array.from(new Set(internalLinks.filter(h => h.startsWith('/') && h !== '/'))).slice(0, 5);
    let brokenLinksCount = 0;
    if (uniqueInternal.length > 0) {
      const promises = uniqueInternal.map(async (path) => {
        try {
          const checkUrl = urlObj.origin + path;
          const resLink = await axios.head(checkUrl, { timeout: 3000 });
          if (resLink.status === 404) brokenLinksCount++;
        } catch (e) {
          if (e.response && e.response.status === 404) brokenLinksCount++;
        }
      });
      await Promise.all(promises);
    }

    // Robots.txt check
    let robotsPassed = false;
    let robotsTxtContent = '';
    let robotsDisallowAll = false;
    let robotsHasSitemap = false;
    try {
      const rRes = await axios.get(urlObj.origin + '/robots.txt', { timeout: 4000 });
      robotsTxtContent = rRes.data || '';
      if (robotsTxtContent.trim().length > 0) {
        robotsPassed = true;
        robotsDisallowAll = /disallow\s*:\s*\/\s*$/im.test(robotsTxtContent);
        robotsHasSitemap = /sitemap/i.test(robotsTxtContent);
      }
    } catch (e) {}

    // Sitemap check
    let sitemapFound = false;
    let sitemapUrlsCount = 0;
    let sitemapLastMod = '';
    try {
      const sRes = await axios.get(urlObj.origin + '/sitemap.xml', { timeout: 4000 });
      const xml = sRes.data || '';
      if (xml.includes('<urlset') || xml.includes('<sitemapindex') || xml.includes('<loc>')) {
        sitemapFound = true;
        sitemapUrlsCount = (xml.match(/<loc>/g) || []).length;
        const lmod = xml.match(/<lastmod>([^<]+)<\/lastmod>/);
        if (lmod) sitemapLastMod = lmod[1];
      }
    } catch(e) {}

    if (!sitemapFound) {
      try {
        const sRes2 = await axios.get(urlObj.origin + '/sitemap_index.xml', { timeout: 4000 });
        const xml = sRes2.data || '';
        if (xml.includes('<urlset') || xml.includes('<sitemapindex') || xml.includes('<loc>')) {
          sitemapFound = true;
          sitemapUrlsCount = (xml.match(/<loc>/g) || []).length;
          const lmod = xml.match(/<lastmod>([^<]+)<\/lastmod>/);
          if (lmod) sitemapLastMod = lmod[1];
        }
      } catch(e) {}
    }

    // Images parsing
    const imgs = [];
    $('img').each((_, el) => {
      const src = $(el).attr('src') || '';
      const alt = $(el).attr('alt');
      const hasAlt = alt !== undefined;
      const emptyAlt = alt !== undefined && alt.trim() === '';
      const loading = $(el).attr('loading') || '';
      const w = $(el).attr('width');
      const h = $(el).attr('height');
      const style = $(el).attr('style') || '';
      const hasDim = w || h || style.includes('width');
      imgs.push({ src, hasAlt, emptyAlt, loading, hasDim });
    });

    // ─── ON PAGE SEO CHECKS ─────────────────────────────────────────
    const opChecks = [];
    // Title
    opChecks.push({
      id: 'title-presence',
      name: 'Title Tag Presence',
      status: title ? 'passed' : 'failed',
      points: title ? 5 : 0,
      maxPoints: 5,
      value: title ? `Title found: "${title}"` : 'Missing title tag',
      recommendation: 'Add a <title> tag inside the <head> of the page.',
      priority: 'high'
    });
    
    const tLen = title.length;
    opChecks.push({
      id: 'title-length',
      name: 'Title Length',
      status: (tLen >= 50 && tLen <= 60) ? 'passed' : ((tLen >= 30 && tLen <= 80) ? 'warning' : 'failed'),
      points: (tLen >= 50 && tLen <= 60) ? 5 : ((tLen >= 30 && tLen <= 80) ? 2 : 0),
      maxPoints: 5,
      value: title ? `Title length is ${tLen} characters` : 'No title tag',
      recommendation: 'Target between 50 and 60 characters for optimum preview display.',
      priority: 'medium'
    });

    const tKw = title.toLowerCase().includes(lowerKw);
    opChecks.push({
      id: 'title-keyword',
      name: 'Keyword in Title',
      status: tKw ? 'passed' : 'failed',
      points: tKw ? 5 : 0,
      maxPoints: 5,
      value: tKw ? `Keyword "${inferredKw}" present` : `Keyword not found in title`,
      recommendation: 'Add your target keyword inside the title tag.',
      priority: 'high'
    });

    const isTitleDup = title.toLowerCase() === h1Text.toLowerCase() || ['home', 'index', 'website'].includes(title.toLowerCase());
    opChecks.push({
      id: 'title-uniqueness',
      name: 'Title Uniqueness',
      status: !isTitleDup && title ? 'passed' : 'failed',
      points: !isTitleDup && title ? 5 : 0,
      maxPoints: 5,
      value: isTitleDup ? 'Title is generic or duplicates H1 heading' : 'Title is unique and descriptive',
      recommendation: 'Ensure your title differs slightly from H1 and describes unique page value.',
      priority: 'medium'
    });

    // Description
    opChecks.push({
      id: 'desc-presence',
      name: 'Meta Description Presence',
      status: metaDescription ? 'passed' : 'failed',
      points: metaDescription ? 5 : 0,
      maxPoints: 5,
      value: metaDescription ? `Description: "${metaDescription.substring(0, 75)}..."` : 'Meta description is missing',
      recommendation: 'Add a <meta name="description"> tag to summarize the page content.',
      priority: 'high'
    });

    const dLen = metaDescription.length;
    opChecks.push({
      id: 'desc-length',
      name: 'Meta Description Length',
      status: (dLen >= 150 && dLen <= 160) ? 'passed' : ((dLen >= 100 && dLen <= 200) ? 'warning' : 'failed'),
      points: (dLen >= 150 && dLen <= 160) ? 4 : ((dLen >= 100 && dLen <= 200) ? 2 : 0),
      maxPoints: 4,
      value: metaDescription ? `Description length is ${dLen} characters` : 'No meta description',
      recommendation: 'Optimize meta description length to be between 150-160 characters.',
      priority: 'medium'
    });

    const dKw = metaDescription.toLowerCase().includes(lowerKw);
    opChecks.push({
      id: 'desc-keyword',
      name: 'Keyword in Description',
      status: dKw ? 'passed' : 'failed',
      points: dKw ? 3 : 0,
      maxPoints: 3,
      value: dKw ? `Keyword "${inferredKw}" present` : `Keyword not found in description`,
      recommendation: 'Include target keyword in meta description to catch searchers\' attention.',
      priority: 'medium'
    });

    const hasCta = ['buy', 'learn', 'get', 'discover', 'shop', 'find', 'try'].some(cta => metaDescription.toLowerCase().includes(cta));
    opChecks.push({
      id: 'desc-cta',
      name: 'Call-to-Action in Description',
      status: hasCta ? 'passed' : 'failed',
      points: hasCta ? 3 : 0,
      maxPoints: 3,
      value: hasCta ? 'Call-to-action keyword found' : 'No CTA keyword found',
      recommendation: 'Include CTA words (e.g. buy, learn, get, discover) in description.',
      priority: 'medium'
    });

    // Viewport & Charset
    opChecks.push({
      id: 'meta-viewport',
      name: 'Viewport Tag',
      status: viewportVal ? 'passed' : 'failed',
      points: viewportVal ? 2 : 0,
      maxPoints: 2,
      value: viewportVal ? 'Viewport tag is present' : 'Missing viewport metadata',
      recommendation: 'Add viewport meta tag to enable mobile responsiveness.',
      priority: 'high'
    });

    opChecks.push({
      id: 'meta-charset',
      name: 'Charset Tag',
      status: charsetVal ? 'passed' : 'failed',
      points: charsetVal ? 2 : 0,
      maxPoints: 2,
      value: charsetVal ? 'Charset is defined' : 'Missing charset tag',
      recommendation: 'Ensure charset metadata (e.g., <meta charset="utf-8">) is present.',
      priority: 'medium'
    });

    const isBlockIndex = /noindex|nofollow/i.test(robotsVal);
    opChecks.push({
      id: 'meta-robots',
      name: 'Robots Tag',
      status: isBlockIndex ? 'warning' : 'passed',
      points: isBlockIndex ? 0 : 1,
      maxPoints: 1,
      value: robotsVal ? `Content: "${robotsVal}"` : 'No robots tag found (assumed indexable)',
      recommendation: isBlockIndex ? 'Robots contains noindex/nofollow. Verify this is intentional.' : 'Crawlable and indexable.',
      priority: 'high'
    });

    // Headings
    const h1Count = h1s.length;
    opChecks.push({
      id: 'h1-count',
      name: 'H1 Headings Count',
      status: h1Count === 1 ? 'passed' : (h1Count > 1 ? 'warning' : 'failed'),
      points: h1Count === 1 ? 5 : (h1Count > 1 ? 2 : 0),
      maxPoints: 5,
      value: `Found ${h1Count} H1 heading(s)`,
      recommendation: 'Ensure your page has exactly one H1 tag.',
      priority: 'high'
    });

    const h1HasKw = h1Text.toLowerCase().includes(lowerKw);
    opChecks.push({
      id: 'h1-keyword',
      name: 'Keyword in H1',
      status: h1HasKw ? 'passed' : 'failed',
      points: h1HasKw ? 4 : 0,
      maxPoints: 4,
      value: h1HasKw ? `Keyword found in H1` : `Keyword not found in H1`,
      recommendation: 'Add your target keyword to the H1 heading.',
      priority: 'high'
    });

    opChecks.push({
      id: 'subheadings',
      name: 'H2 & H3 Subheadings',
      status: (h2s.length > 0 && h3s.length > 0) ? 'passed' : (h2s.length > 0 ? 'warning' : 'failed'),
      points: (h2s.length > 0 && h3s.length > 0) ? 3 : (h2s.length > 0 ? 1 : 0),
      maxPoints: 3,
      value: `Found ${h2s.length} H2 tags, ${h3s.length} H3 tags`,
      recommendation: 'Organize structure with H2 and H3 tags for readability.',
      priority: 'low'
    });

    let validHierarchy = true;
    let prevHeadLevel = 0;
    allHeadings.forEach(h => {
      const level = parseInt(h.tag.substring(1));
      if (prevHeadLevel === 0 && level !== 1) validHierarchy = false;
      if (prevHeadLevel > 0 && level > prevHeadLevel + 1) validHierarchy = false;
      prevHeadLevel = level;
    });
    opChecks.push({
      id: 'headings-hierarchy',
      name: 'Heading Hierarchy',
      status: (validHierarchy && allHeadings.length > 0) ? 'passed' : 'failed',
      points: (validHierarchy && allHeadings.length > 0) ? 3 : 0,
      maxPoints: 3,
      value: validHierarchy ? 'Headings order is correct' : 'Skipped heading levels in hierarchy',
      recommendation: 'Ensure heading levels change sequentially (e.g. H1 then H2, do not skip to H3).',
      priority: 'medium'
    });

    // URL structure
    const uLen = targetUrl.length;
    opChecks.push({
      id: 'url-length',
      name: 'URL Length',
      status: uLen < 75 ? 'passed' : 'warning',
      points: uLen < 75 ? 2 : 0,
      maxPoints: 2,
      value: `URL length is ${uLen} characters`,
      recommendation: 'Keep URL string short and descriptive under 75 characters.',
      priority: 'low'
    });

    const hasUnderscores = urlObj.pathname.includes('_');
    opChecks.push({
      id: 'url-hyphens',
      name: 'URL Separators',
      status: !hasUnderscores ? 'passed' : 'failed',
      points: !hasUnderscores ? 2 : 0,
      maxPoints: 2,
      value: hasUnderscores ? 'URL path uses underscores' : 'URL uses hyphens/contains no underscores',
      recommendation: 'Use hyphens (-) in URLs to separate words instead of underscores (_).',
      priority: 'medium'
    });

    const hasParams = urlObj.search !== '';
    opChecks.push({
      id: 'url-parameters',
      name: 'Static URL URL Params',
      status: !hasParams ? 'passed' : 'warning',
      points: !hasParams ? 2 : 0,
      maxPoints: 2,
      value: hasParams ? `Found dynamic URL parameters: "${urlObj.search}"` : 'No URL query parameters present',
      recommendation: 'Avoid dynamic parameters (?id=, &page=) in URLs; keep them static.',
      priority: 'medium'
    });

    const pathLower = urlObj.pathname === urlObj.pathname.toLowerCase();
    opChecks.push({
      id: 'url-case',
      name: 'URL Lowercase',
      status: pathLower ? 'passed' : 'failed',
      points: pathLower ? 2 : 0,
      maxPoints: 2,
      value: pathLower ? 'URL path is lowercase' : 'URL contains uppercase letters',
      recommendation: 'Convert URL links to lowercase to prevent duplicates.',
      priority: 'low'
    });

    const kwInUrl = targetUrl.toLowerCase().includes(lowerKw);
    opChecks.push({
      id: 'url-keyword',
      name: 'Keyword in URL',
      status: kwInUrl ? 'passed' : 'failed',
      points: kwInUrl ? 1 : 0,
      maxPoints: 1,
      value: kwInUrl ? 'Target keyword found in URL' : 'Target keyword missing in URL',
      recommendation: 'Include target keyword in URL slug.',
      priority: 'medium'
    });

    const stopWords = ['the', 'and', 'of', 'a', 'an', 'or', 'but', 'for', 'is', 'on', 'in', 'at', 'to'];
    const hasStopUrl = stopWords.some(sw => urlObj.pathname.toLowerCase().split(/[-_/]/).includes(sw));
    opChecks.push({
      id: 'url-stopwords',
      name: 'URL Stop Words',
      status: !hasStopUrl ? 'passed' : 'warning',
      points: !hasStopUrl ? 1 : 0,
      maxPoints: 1,
      value: hasStopUrl ? 'URL path contains stop words' : 'No stop words found in URL',
      recommendation: 'Remove stop words (the, of, to, etc.) from the URL.',
      priority: 'low'
    });

    // Density
    let dPoints = 0, dStatus = 'failed', dRec = 'Mention your keyword on page.';
    if (density >= 0.5 && density <= 2.5) { dPoints = 10; dStatus = 'passed'; dRec = 'Ideal keyword density.'; }
    else if (density > 2.5 && density <= 3.0) { dPoints = 6; dStatus = 'warning'; dRec = 'Slightly high keyword density.'; }
    else if (density > 3.0) { dPoints = 3; dStatus = 'failed'; dRec = 'Keyword stuffing alert! (>3%).'; }
    else if (density > 0 && density < 0.5) { dPoints = 5; dStatus = 'warning'; dRec = 'Density is very low. Use keyword more.'; }
    opChecks.push({
      id: 'keyword-density-metric',
      name: 'Keyword Density & Freq',
      status: dStatus,
      points: dPoints,
      maxPoints: 10,
      value: `Density: ${density.toFixed(2)}% (${kwCount} matches)`,
      recommendation: dRec,
      priority: 'high'
    });

    // Word count
    let wcPoints = 0, wcStatus = 'failed', wcRec = 'Expand the page content details.';
    if (totalWords >= 800) { wcPoints = 5; wcStatus = 'passed'; wcRec = 'Healthy long-form article length.'; }
    else if (totalWords >= 300) { wcPoints = 3; wcStatus = 'warning'; wcRec = 'Good for product page, thin for blog.'; }
    else { wcPoints = 1; wcStatus = 'failed'; wcRec = 'Thin content warning (<300 words).'; }
    opChecks.push({
      id: 'content-length-check',
      name: 'Content Word Count',
      status: wcStatus,
      points: wcPoints,
      maxPoints: 5,
      value: `Total word count is ${totalWords}`,
      recommendation: wcRec,
      priority: 'medium'
    });

    // Reading level
    const sentences = pageText.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const sentenceCount = sentences.length || 1;
    const wps = totalWords / sentenceCount;
    opChecks.push({
      id: 'content-reading',
      name: 'Reading Level Complexity',
      status: (wps >= 8 && wps <= 22) ? 'passed' : 'warning',
      points: (wps >= 8 && wps <= 22) ? 2 : 1,
      maxPoints: 2,
      value: `Average of ${Math.round(wps)} words per sentence`,
      recommendation: wps > 25 ? 'Shorten sentences to ease readability.' : 'Varied sentence structure is good.',
      priority: 'low'
    });

    const sameTitleH1 = title.toLowerCase() === h1Text.toLowerCase();
    opChecks.push({
      id: 'content-title-h1-dup',
      name: 'Title & H1 Similarity',
      status: !sameTitleH1 ? 'passed' : 'warning',
      points: !sameTitleH1 ? 2 : 0,
      maxPoints: 2,
      value: sameTitleH1 ? 'Title tag is identical to H1 text' : 'Title tag is distinct from H1 heading',
      recommendation: 'Differentiate Title and H1 tags to capture related search queries.',
      priority: 'low'
    });

    const freshEl = $('meta[property="article:modified_time" i], meta[name="last-modified" i]').attr('content');
    opChecks.push({
      id: 'content-freshness',
      name: 'Freshness Meta Tag',
      status: freshEl ? 'passed' : 'warning',
      points: freshEl ? 1 : 0,
      maxPoints: 1,
      value: freshEl ? `Freshness meta found: "${freshEl}"` : 'No last-modified dates found in tags',
      recommendation: 'Include last-modified or article:modified_time meta headers to indicate update times.',
      priority: 'low'
    });

    // Link counts
    opChecks.push({
      id: 'internal-links',
      name: 'Internal Links Count',
      status: internalLinks.length > 0 ? 'passed' : 'failed',
      points: internalLinks.length > 0 ? 2 : 0,
      maxPoints: 2,
      value: `Found ${internalLinks.length} internal links`,
      recommendation: 'Link to other relevant pages to help robots navigate.',
      priority: 'high'
    });

    opChecks.push({
      id: 'internal-anchors',
      name: 'Link Anchor Text',
      status: badAnchors.length === 0 ? 'passed' : (badAnchors.length <= 3 ? 'warning' : 'failed'),
      points: badAnchors.length === 0 ? 2 : (badAnchors.length <= 3 ? 1 : 0),
      maxPoints: 2,
      value: badAnchors.length > 0 ? `Found ${badAnchors.length} generic links (e.g. "click here")` : 'Anchor text is descriptive',
      recommendation: 'Replace generic link words with context-rich keywords.',
      priority: 'medium'
    });

    opChecks.push({
      id: 'internal-placeholders',
      name: 'Placeholder Links',
      status: hashLinks.length === 0 ? 'passed' : 'warning',
      points: hashLinks.length === 0 ? 1 : 0,
      maxPoints: 1,
      value: hashLinks.length > 0 ? `Found ${hashLinks.length} empty or "#" href(s)` : 'No placeholder links detected',
      recommendation: 'Change placeholders (#) to absolute links or button tags.',
      priority: 'low'
    });

    opChecks.push({
      id: 'external-links',
      name: 'External Links Count',
      status: externalLinks.length > 0 ? 'passed' : 'warning',
      points: externalLinks.length > 0 ? 1 : 0,
      maxPoints: 1,
      value: `Found ${externalLinks.length} external links`,
      recommendation: 'Link out to authoritative sites to validate information.',
      priority: 'low'
    });

    const noFollowExt = externalLinks.filter(h => noFollowLinks.includes(h));
    opChecks.push({
      id: 'external-nofollow',
      name: 'Nofollow on External',
      status: noFollowExt.length > 0 ? 'passed' : 'warning',
      points: noFollowExt.length > 0 ? 2 : 1,
      maxPoints: 2,
      value: `${noFollowExt.length} of ${externalLinks.length} external links use nofollow`,
      recommendation: 'Use rel="nofollow" to avoid leaking page equity to untrusted sites.',
      priority: 'low'
    });

    const targetBlankBad = [];
    $('a[target="_blank"]').each((_, el) => {
      const rel = ($(el).attr('rel') || '').toLowerCase();
      if (!rel.includes('noopener') && !rel.includes('noreferrer')) {
        targetBlankBad.push($(el).attr('href') || '');
      }
    });
    opChecks.push({
      id: 'external-noopener',
      name: 'Secure External Targets',
      status: targetBlankBad.length === 0 ? 'passed' : 'failed',
      points: targetBlankBad.length === 0 ? 2 : 0,
      maxPoints: 2,
      value: targetBlankBad.length > 0 ? `${targetBlankBad.length} links miss rel="noopener"` : 'All target="_blank" links secured',
      recommendation: 'Add rel="noopener" to target="_blank" links for security.',
      priority: 'medium'
    });

    // Images
    const missingAltCount = imgs.filter(i => !i.hasAlt || i.emptyAlt).length;
    let altPoints = 4, altStatus = 'passed';
    if (imgs.length > 0) {
      const ratio = (imgs.length - missingAltCount) / imgs.length;
      if (ratio === 1) { altPoints = 4; altStatus = 'passed'; }
      else if (ratio >= 0.8) { altPoints = 2; altStatus = 'warning'; }
      else { altPoints = 0; altStatus = 'failed'; }
    }
    opChecks.push({
      id: 'img-alt-tags',
      name: 'Image Alt Text',
      status: altStatus,
      points: altPoints,
      maxPoints: 4,
      value: imgs.length > 0 ? `${missingAltCount} of ${imgs.length} images lack alt attributes` : 'No images on page',
      recommendation: 'Provide descriptive alt tags for all image elements.',
      priority: 'high'
    });

    const lazyImgs = imgs.filter(i => i.loading === 'lazy');
    opChecks.push({
      id: 'img-lazy',
      name: 'Image Lazy Loading',
      status: (lazyImgs.length > 0 || imgs.length === 0) ? 'passed' : 'warning',
      points: (lazyImgs.length > 0 || imgs.length === 0) ? 2 : 0,
      maxPoints: 2,
      value: `${lazyImgs.length} of ${imgs.length} images use lazy loading`,
      recommendation: 'Add loading="lazy" attributes to improve page speed.',
      priority: 'medium'
    });

    const badImgNames = imgs.filter(i => {
      const filename = i.src.substring(i.src.lastIndexOf('/') + 1);
      return /^(image|img|photo|dsc|untitled|pic)[0-9-_]*\.[a-z]+$/i.test(filename);
    });
    opChecks.push({
      id: 'img-filenames',
      name: 'Descriptive Image Names',
      status: badImgNames.length === 0 || imgs.length === 0 ? 'passed' : 'warning',
      points: badImgNames.length === 0 || imgs.length === 0 ? 2 : 1,
      maxPoints: 2,
      value: badImgNames.length > 0 ? `${badImgNames.length} image files have generic names` : 'Image file naming is descriptive',
      recommendation: 'Rename image files with descriptive hyphens (e.g. red-shoe.png).',
      priority: 'low'
    });

    const nextGenImgs = imgs.filter(i => /\.(webp|avif|svg)/i.test(i.src));
    opChecks.push({
      id: 'img-nextgen',
      name: 'Next-Gen Format Images',
      status: nextGenImgs.length > 0 || imgs.length === 0 ? 'passed' : 'warning',
      points: nextGenImgs.length > 0 || imgs.length === 0 ? 1 : 0,
      maxPoints: 1,
      value: `${nextGenImgs.length} of ${imgs.length} images use webp, avif, or svg`,
      recommendation: 'Serve WebP or AVIF formats instead of traditional PNG/JPG.',
      priority: 'low'
    });

    const missingImgDim = imgs.filter(i => !i.hasDim).length;
    opChecks.push({
      id: 'img-dimensions',
      name: 'Explicit Image Sizes',
      status: missingImgDim === 0 || imgs.length === 0 ? 'passed' : 'warning',
      points: missingImgDim === 0 || imgs.length === 0 ? 1 : 0,
      maxPoints: 1,
      value: missingImgDim > 0 ? `${missingImgDim} images missing width/height attributes` : 'All images specify sizes',
      recommendation: 'Add explicit width and height tags to prevent CLS layout shifts.',
      priority: 'medium'
    });

    // Social & Metadata tags
    const ogTitle = $('meta[property="og:title" i]').length > 0;
    const ogDesc = $('meta[property="og:description" i]').length > 0;
    const ogImg = $('meta[property="og:image" i]').length > 0;
    const ogPassed = ogTitle && ogDesc && ogImg;
    opChecks.push({
      id: 'social-og',
      name: 'Open Graph Data',
      status: ogPassed ? 'passed' : (ogTitle || ogDesc || ogImg ? 'warning' : 'failed'),
      points: ogPassed ? 3 : (ogTitle || ogDesc || ogImg ? 1 : 0),
      maxPoints: 3,
      value: `og:title: ${ogTitle ? '✅' : '❌'}, og:desc: ${ogDesc ? '✅' : '❌'}, og:img: ${ogImg ? '✅' : '❌'}`,
      recommendation: 'Add meta tags for og:title, og:description, and og:image.',
      priority: 'medium'
    });

    const twCard = $('meta[name="twitter:card" i]').length > 0;
    const twTitle = $('meta[name="twitter:title" i]').length > 0;
    const twImg = $('meta[name="twitter:image" i]').length > 0;
    const twPassed = twCard && twTitle && twImg;
    opChecks.push({
      id: 'social-twitter',
      name: 'Twitter Cards',
      status: twPassed ? 'passed' : (twCard || twTitle || twImg ? 'warning' : 'failed'),
      points: twPassed ? 2 : (twCard || twTitle || twImg ? 1 : 0),
      maxPoints: 2,
      value: `twitter:card: ${twCard ? '✅' : '❌'}, title: ${twTitle ? '✅' : '❌'}`,
      recommendation: 'Add twitter:card, twitter:title, and twitter:image cards.',
      priority: 'low'
    });

    // UX fonts and modals
    const smallFontsCount = $('[style*="font-size"]').filter((_, el) => {
      const match = ($(el).attr('style') || '').match(/font-size\s*:\s*(\d+)px/i);
      return match && parseInt(match[1]) < 12;
    }).length;
    opChecks.push({
      id: 'ux-legibility',
      name: 'Inline Font Legibility',
      status: smallFontsCount === 0 ? 'passed' : 'warning',
      points: smallFontsCount === 0 ? 1 : 0,
      maxPoints: 1,
      value: smallFontsCount > 0 ? `Found ${smallFontsCount} elements with size < 12px` : 'No small inline fonts found (<12px)',
      recommendation: 'Ensure standard layout text size is at least 12px for mobile devices.',
      priority: 'medium'
    });

    opChecks.push({
      id: 'ux-spacing',
      name: 'Tap Targets Density',
      status: internalLinks.length + externalLinks.length < 100 ? 'passed' : 'warning',
      points: 1,
      maxPoints: 1,
      value: `Links profile spacing is standard`,
      recommendation: 'Check link heights and padding on mobile formats.',
      priority: 'low'
    });

    const popupClassIndicator = $('[id*="popup"], [id*="modal"], [id*="overlay"], [class*="popup"], [class*="modal"], [class*="overlay"]').length;
    opChecks.push({
      id: 'ux-interstitials',
      name: 'Intrusive Popups',
      status: popupClassIndicator === 0 ? 'passed' : 'warning',
      points: popupClassIndicator === 0 ? 1 : 0,
      maxPoints: 1,
      value: popupClassIndicator > 0 ? `Detected popup/modal containers: Found ${popupClassIndicator} matching elements` : 'No interstitial elements identified',
      recommendation: 'Avoid intrusive popups that block text views on load.',
      priority: 'low'
    });

    const opEarned = opChecks.reduce((a, c) => a + c.points, 0);
    const opMax = opChecks.reduce((a, c) => a + c.maxPoints, 0);
    const onPageScore = Math.round((opEarned / opMax) * 100);

    // ─── TECHNICAL SEO CHECKS ───────────────────────────────────────
    const techChecks = [];
    techChecks.push({
      id: 'tech-speed',
      name: 'Fetch Response Time',
      status: responseTime < 2000 ? 'passed' : (responseTime <= 4000 ? 'warning' : 'failed'),
      points: responseTime < 2000 ? 10 : (responseTime <= 4000 ? 5 : 0),
      maxPoints: 10,
      value: `Site loaded in ${responseTime}ms`,
      recommendation: 'Target server speeds under 2000ms.',
      priority: 'high'
    });

    const headStyles = $('head link[rel="stylesheet"]').length;
    const headScripts = $('head script').filter((_, el) => !$(el).attr('async') && !$(el).attr('defer') && !$(el).attr('type')?.includes('json')).length;
    const blockCount = headStyles + headScripts;
    techChecks.push({
      id: 'tech-render-blocking',
      name: 'Render-Blocking Elements',
      status: blockCount === 0 ? 'passed' : (blockCount <= 2 ? 'warning' : 'failed'),
      points: blockCount === 0 ? 10 : (blockCount <= 2 ? 6 : 0),
      maxPoints: 10,
      value: `Found ${blockCount} blocking resources in head`,
      recommendation: 'Add async/defer to script tags and load css files asynchronously.',
      priority: 'medium'
    });

    techChecks.push({
      id: 'tech-viewport',
      name: 'Responsive Viewport Meta',
      status: viewportVal ? 'passed' : 'failed',
      points: viewportVal ? 5 : 0,
      maxPoints: 5,
      value: viewportVal ? 'Viewport tag configured' : 'No viewport meta tag',
      recommendation: 'Include a viewport meta tag for responsive width scaling.',
      priority: 'high'
    });

    const fixedWidthsCount = $('[style*="width"]').filter((_, el) => {
      const match = ($(el).attr('style') || '').match(/width\s*:\s*(\d+)px/i);
      return match && parseInt(match[1]) > 600;
    }).length;
    techChecks.push({
      id: 'tech-wide-width',
      name: 'Fixed Width Containers',
      status: fixedWidthsCount === 0 ? 'passed' : 'warning',
      points: fixedWidthsCount === 0 ? 5 : 2,
      maxPoints: 5,
      value: fixedWidthsCount > 0 ? `Found ${fixedWidthsCount} elements with fixed desktop widths` : 'No hardcoded desktop dimensions',
      recommendation: 'Avoid inline styles setting widths > 600px.',
      priority: 'medium'
    });

    const tinyMobileFontsCount = $('[style*="font-size"]').filter((_, el) => {
      const match = ($(el).attr('style') || '').match(/font-size\s*:\s*(\d+)px/i);
      return match && parseInt(match[1]) < 14;
    }).length;
    techChecks.push({
      id: 'tech-fonts',
      name: 'Responsive Text Sizes',
      status: tinyMobileFontsCount === 0 ? 'passed' : 'warning',
      points: tinyMobileFontsCount === 0 ? 5 : 2,
      maxPoints: 5,
      value: tinyMobileFontsCount > 0 ? `Found ${tinyMobileFontsCount} elements styled < 14px` : 'Text fonts look mobile friendly (14px+)',
      recommendation: 'Ensure page base text sizing is at least 14px on mobile viewport stylesheets.',
      priority: 'medium'
    });

    const isHttps = targetUrl.startsWith('https://');
    techChecks.push({
      id: 'tech-ssl',
      name: 'SSL Setup (HTTPS)',
      status: isHttps ? 'passed' : 'failed',
      points: isHttps ? 10 : 0,
      maxPoints: 10,
      value: isHttps ? 'URL uses secure HTTPS protocol' : 'Insecure HTTP connection',
      recommendation: 'Install an SSL certificate. Google actively penalizes non-https locations.',
      priority: 'high'
    });

    let mixedCount = 0;
    if (isHttps) {
      $('img[src], script[src], link[href]').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('href') || '';
        if (src.startsWith('http://')) mixedCount++;
      });
    }
    techChecks.push({
      id: 'tech-mixed',
      name: 'Mixed HTTP Content',
      status: mixedCount === 0 ? 'passed' : 'failed',
      points: mixedCount === 0 ? 5 : 0,
      maxPoints: 5,
      value: mixedCount > 0 ? `Found ${mixedCount} mixed HTTP sources` : 'No mixed assets found',
      recommendation: 'Ensure all scripts, stylesheets, and images load over HTTPS link protocols.',
      priority: 'high'
    });

    techChecks.push({
      id: 'tech-canonical-presence',
      name: 'Canonical Tag',
      status: canonicalVal ? 'passed' : 'failed',
      points: canonicalVal ? 5 : 0,
      maxPoints: 5,
      value: canonicalVal ? `Canonical points to: "${canonicalVal}"` : 'Canonical tag is missing',
      recommendation: 'Add <link rel="canonical" href="..."> to head.',
      priority: 'high'
    });

    let canonSelfMatch = false;
    if (canonicalVal) {
      try {
        const cObj = new URL(canonicalVal, targetUrl);
        canonSelfMatch = cObj.href === urlObj.href;
      } catch(e) {}
    }
    techChecks.push({
      id: 'tech-canonical-match',
      name: 'Canonical Self-Match',
      status: canonSelfMatch ? 'passed' : 'warning',
      points: canonSelfMatch ? 5 : 2,
      maxPoints: 5,
      value: canonSelfMatch ? 'Canonical correctly references itself' : 'Canonical points elsewhere',
      recommendation: 'Ensure canonical tags reference the preferred index page.',
      priority: 'medium'
    });

    const isRedirected = urlObj.href.replace(/\/$/, '').toLowerCase() !== finalUrl.replace(/\/$/, '').toLowerCase();
    techChecks.push({
      id: 'tech-redirects',
      name: 'URL Redirect Chains',
      status: !isRedirected ? 'passed' : 'warning',
      points: !isRedirected ? 10 : 5,
      maxPoints: 10,
      value: isRedirected ? `Redirected to: ${finalUrl}` : 'No redirect loops detected',
      recommendation: 'Optimize redirect links. Ensure permanent 301 is configured rather than temporary 302.',
      priority: 'medium'
    });

    techChecks.push({
      id: 'tech-404',
      name: 'Broken Internal Links',
      status: brokenLinksCount === 0 ? 'passed' : 'failed',
      points: brokenLinksCount === 0 ? 10 : 0,
      maxPoints: 10,
      value: brokenLinksCount > 0 ? `Found ${brokenLinksCount} broken URL(s) in crawler sample` : 'All checked links are valid',
      recommendation: 'Review page layout anchors and replace or delete broken href targets.',
      priority: 'high'
    });

    techChecks.push({
      id: 'tech-robots-txt',
      name: 'Robots.txt Presence',
      status: (robotsPassed && !robotsDisallowAll) ? 'passed' : 'failed',
      points: (robotsPassed && !robotsDisallowAll) ? 5 : 0,
      maxPoints: 5,
      value: robotsPassed ? (robotsDisallowAll ? 'Robots.txt blocks indexing' : 'Robots.txt found and functional') : 'Robots.txt missing',
      recommendation: robotsDisallowAll ? 'Remove "Disallow: /" rule from robots.txt!' : 'Add a robots.txt file at domain root.',
      priority: 'high'
    });

    techChecks.push({
      id: 'tech-robots-sitemap',
      name: 'Sitemap in Robots.txt',
      status: robotsHasSitemap ? 'passed' : 'warning',
      points: robotsHasSitemap ? 5 : 0,
      maxPoints: 5,
      value: robotsHasSitemap ? 'Sitemap reference identified' : 'Sitemap is not referenced inside robots.txt',
      recommendation: 'Link sitemap by appending "Sitemap: [URL]" to robots.txt.',
      priority: 'low'
    });

    techChecks.push({
      id: 'tech-sitemap-xml',
      name: 'XML Sitemap Discovery',
      status: sitemapFound ? 'passed' : 'failed',
      points: sitemapFound ? 10 : 0,
      maxPoints: 10,
      value: sitemapFound ? `Sitemap matches: Contains ${sitemapUrlsCount} URLs. Last modified: ${sitemapLastMod || 'N/A'}` : 'Missing XML Sitemap',
      recommendation: 'Submit sitemaps using simplifiedseotools.',
      priority: 'high'
    });

    const techEarned = techChecks.reduce((a, c) => a + c.points, 0);
    const techMax = techChecks.reduce((a, c) => a + c.maxPoints, 0);
    const technicalScore = Math.round((techEarned / techMax) * 100);

    // ─── LOCAL SEO CHECKS ───────────────────────────────────────────
    const localChecks = [];
    if (inferredBusinessName && inferredCity) {
      const hasName = title.toLowerCase().includes(lowerName) || h1Text.toLowerCase().includes(lowerName) || pageText.toLowerCase().includes(lowerName);
      localChecks.push({
        id: 'local-name',
        name: 'Business Name on Page',
        status: hasName ? 'passed' : 'failed',
        points: hasName ? 10 : 0,
        maxPoints: 10,
        value: hasName ? `Found business name: "${inferredBusinessName}"` : 'Business Name not found in markup',
        recommendation: 'Add business name in footer, body text, or headers.',
        priority: 'high'
      });

      const mapsEmbed = $('iframe[src*="google.com/maps"], iframe[src*="maps.google.com"]').length > 0;
      localChecks.push({
        id: 'local-maps',
        name: 'Maps Embed Presence',
        status: mapsEmbed ? 'passed' : 'failed',
        points: mapsEmbed ? 10 : 0,
        maxPoints: 10,
        value: mapsEmbed ? 'Google Maps iframe embedded' : 'No maps iframe embedded',
        recommendation: 'Embed Google Maps location code in page footer.',
        priority: 'medium'
      });

      const gmbLink = $('a[href*="business.google.com"], a[href*="maps.google.com"]').length > 0;
      localChecks.push({
        id: 'local-gmb-link',
        name: 'Google My Business Hrefs',
        status: gmbLink ? 'passed' : 'failed',
        points: gmbLink ? 10 : 0,
        maxPoints: 10,
        value: gmbLink ? 'Direct link to Google maps profile exists' : 'No GMB link found',
        recommendation: 'Link directly to GMB location maps page.',
        priority: 'medium'
      });

      const phoneMatches = pageText.match(/(\+91|0)?[6-9]\d{9}|\b\d{3}[-.]?\d{3}[-.]?\d{4}\b|\b\d{10,}\b|\(\d{3}\)\s*\d{3}[-.]?\d{4}/g) || [];
      const phoneFound = phoneMatches.length > 0;
      const cityFound = pageText.toLowerCase().includes(lowerCity);
      const nameInBody = pageText.toLowerCase().includes(lowerName);
      const napPassed = phoneFound && cityFound && nameInBody;
      localChecks.push({
        id: 'local-nap',
        name: 'NAP Consistency checks',
        status: napPassed ? 'passed' : 'failed',
        points: napPassed ? 20 : (phoneFound || cityFound ? 10 : 0),
        maxPoints: 20,
        value: `Name: ${nameInBody ? '✅' : '❌'}, Phone: ${phoneFound ? `✅ (${phoneMatches[0]})` : '❌'}, City: ${cityFound ? '✅' : '❌'}`,
        recommendation: 'Ensure your Name, Address, and Phone number are written explicitly in body.',
        priority: 'high'
      });

      const cityInT = title.toLowerCase().includes(lowerCity);
      const cityInD = metaDescription.toLowerCase().includes(lowerCity);
      const cityInH = allHeadings.some(h => h.text.toLowerCase().includes(lowerCity));
      const cityInB = pageText.toLowerCase().includes(lowerCity);
      let cityPoints = 0;
      if (cityInT) cityPoints += 5;
      if (cityInD) cityPoints += 5;
      if (cityInH) cityPoints += 5;
      if (cityInB) cityPoints += 5;

      localChecks.push({
        id: 'local-keywords',
        name: 'City / Location Keywords',
        status: cityPoints === 20 ? 'passed' : (cityPoints > 0 ? 'warning' : 'failed'),
        points: cityPoints,
        maxPoints: 20,
        value: `City mentions in tags: ${cityPoints / 5} of 4 locations`,
        recommendation: 'Include city name in your title, meta description, and subheadings.',
        priority: 'high'
      });

      let sPoints = 0, sStatus = 'failed', sVal = 'Missing LocalBusiness schema';
      if (localBusinessSchema) {
        sPoints += 7;
        const reqFields = ['name', 'address', 'telephone', 'openingHours', 'geo'];
        const matched = reqFields.filter(f => localBusinessSchema[f]);
        sPoints += Math.round((matched.length / reqFields.length) * 8);
        sStatus = matched.length === reqFields.length ? 'passed' : 'warning';
        sVal = `Schema found. Matched fields: ${matched.join(', ')}`;
      }
      localChecks.push({
        id: 'local-schema-ld',
        name: 'LocalBusiness Schema',
        status: sStatus,
        points: sPoints,
        maxPoints: 15,
        value: sVal,
        recommendation: 'Create structured LocalBusiness schema tags.',
        priority: 'medium'
      });

      const proofText = pageText.toLowerCase().match(/reviews|rating|testimonial|stars/i);
      let uxSigPoints = 0;
      if (mapsEmbed) uxSigPoints += 5;
      if (proofText) uxSigPoints += 5;
      const hasLocationLink = $('a').filter((_, el) => {
        const href = ($(el).attr('href') || '').toLowerCase();
        return ['contact', 'location', 'about-us', 'find-us'].some(kw => href.includes(kw));
      }).length > 0;
      if (hasLocationLink) uxSigPoints += 5;

      localChecks.push({
        id: 'local-ux-signals',
        name: 'Local Trust / UX Signals',
        status: uxSigPoints === 15 ? 'passed' : (uxSigPoints > 0 ? 'warning' : 'failed'),
        points: uxSigPoints,
        maxPoints: 15,
        value: `UX elements: Map: ${mapsEmbed ? '✅' : '❌'}, Proof words: ${proofText ? '✅' : '❌'}, Contact page link: ${hasLocationLink ? '✅' : '❌'}`,
        recommendation: 'Add ratings widget, reviews proof, and direct links to Contact Us page.',
        priority: 'medium'
      });
    }

    const lcEarned = localChecks.reduce((a, c) => a + c.points, 0);
    const lcMax = localChecks.reduce((a, c) => a + c.maxPoints, 0);
    const localScore = lcMax > 0 ? Math.round((lcEarned / lcMax) * 100) : 0;

    // ─── AI RECOMMENDATIONS (OPENROUTER) ───────────────────────────
    let aiRecommendations = [];
    let contentScore = 0;
    
    if (openRouter.isConfigured) {
      try {
        const prompt = `Act as an Expert SEO Auditor. Analyze the following text extracted from a website: "${targetUrl}".
        Text content:
        ${pageText.substring(0, 8000)}
        
        Evaluate the text based on:
        1. Readability and User Intent
        2. Keyword clarity (does it clearly state what they do?)
        3. Content Depth
        
        Provide your response in EXACTLY this JSON format (no markdown formatting, no code blocks, just raw JSON):
        {
          "score": 85,
          "recommendations": ["Recommendation 1", "Recommendation 2", "Recommendation 3"]
        }`;

        const genRes = await openRouter.models.generateContent({
          model: openRouter.DEFAULT_MODEL,
          contents: prompt
        });

        const textResponse = genRes.text.trim().replace(/^```json/, '').replace(/```$/, '');
        const aiData = JSON.parse(textResponse);
        contentScore = aiData.score || 0;
        aiRecommendations = aiData.recommendations || [];
      } catch (aiErr) {
        console.error('OpenRouter AI error:', aiErr);
        aiRecommendations = ["AI Analysis temporarily unavailable. Check API Key credentials."];
      }
    } else {
      aiRecommendations = ["OPENROUTER_API_KEY not configured. Content analysis limited."];
    }

    // ─── OVERALL RESPONSE PAYLOAD ──────────────────────────────────
    // Internal authority estimate based only on LeadOS-owned audit and recorded
    // backlink data. This is not Moz's proprietary Domain Authority metric.
    let authorityBacklinks = { total: 0, rootDomains: 0, doFollow: 0, toxic: 0 };
    if (clientId) {
      try {
        const { rows } = await pool.query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(DISTINCT source_domain)::int AS root_domains,
                  COUNT(*) FILTER (WHERE LOWER(link_type) = 'dofollow')::int AS do_follow,
                  COUNT(*) FILTER (WHERE is_toxic = true)::int AS toxic
             FROM thedal_backlinks
            WHERE client_id = $1`,
          [clientId]
        );
        authorityBacklinks = {
          total: rows[0]?.total || 0,
          rootDomains: rows[0]?.root_domains || 0,
          doFollow: rows[0]?.do_follow || 0,
          toxic: rows[0]?.toxic || 0
        };
      } catch (authorityErr) {
        console.warn('Authority backlink metrics unavailable:', authorityErr.message);
      }
    }
    const backlinkBreadth = Math.min(30, Math.round(Math.log10(authorityBacklinks.rootDomains + 1) * 15));
    const backlinkQuality = authorityBacklinks.total
      ? Math.round((authorityBacklinks.doFollow / authorityBacklinks.total) * 10)
      : 0;
    const toxicityPenalty = authorityBacklinks.total
      ? Math.round((authorityBacklinks.toxic / authorityBacklinks.total) * 20)
      : 0;
    const authorityScore = Math.max(0, Math.min(100, Math.round(
      (onPageScore * 0.2) + (technicalScore * 0.25) + (localScore * 0.15) +
      backlinkBreadth + backlinkQuality - toxicityPenalty
    )));

    const payload = {
      url: targetUrl,
      inferredKeyword: inferredKw,
      inferredBusinessName,
      inferredCity,
      overallScore: 0, // Computed by frontend based on checklists
      onPage: { score: onPageScore, checks: opChecks },
      technical: { score: technicalScore, checks: techChecks },
      local: { score: localScore, checks: localChecks },
      authority: {
        score: authorityScore,
        totalBacklinks: authorityBacklinks.total,
        linkingRootDomains: authorityBacklinks.rootDomains,
        doFollowBacklinks: authorityBacklinks.doFollow,
        toxicBacklinks: authorityBacklinks.toxic,
        source: 'LeadOS audit and recorded backlink data'
      },
      serp: {
        title: title || 'Title tag missing',
        description: metaDescription || 'No description found. Add a meta description tag.'
      },
      linksCount: {
        internal: internalLinks.length,
        external: externalLinks.length,
        broken: brokenLinksCount,
        doFollowInt: internalLinks.length - noFollowLinks.filter(h => internalLinks.includes(h)).length,
        doFollowExt: externalLinks.length - noFollowLinks.filter(h => externalLinks.includes(h)).length,
        noFollow: noFollowLinks.length
      },
      wordCloud: topWords,
      densityInfo: {
        count: kwCount,
        percent: density
      },
      schemaInfo: {
        types: schemaTypes
      },
      robotsText: robotsTxtContent,
      phone: (pageText.match(/(\+91|0)?[6-9]\d{9}|\b\d{3}[-.]?\d{3}[-.]?\d{4}\b|\b\d{10,}\b|\(\d{3}\)\s*\d{3}[-.]?\d{4}/g) || [])[0] || '',
      aiContent: {
        score: contentScore,
        recommendations: aiRecommendations
      }
    };

    if (clientId) {
      try {
        await pool.query(
          `INSERT INTO seo_audits (client_id, url, audit_data)
           VALUES ($1, $2, $3)
           ON CONFLICT (client_id)
           DO UPDATE SET url = $2, audit_data = $3, updated_at = CURRENT_TIMESTAMP`,
          [clientId, targetUrl, payload]
        );
      } catch (dbErr) {
        console.error('Error saving audit to DB:', dbErr);
      }
    }

    res.json(payload);

  } catch (err) {
    console.error('SEO Audit crawling failed:', err);
    res.status(500).json({ error: 'Failed to analyze website. Ensure the URL is accessible.' });
  }
});

module.exports = router;
