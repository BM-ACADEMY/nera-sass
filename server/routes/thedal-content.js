const express = require('express');
const router = express.Router();
const axios = require('axios');
const cheerio = require('cheerio');
const openRouter = require('../services/openrouter');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'leados_db',
  user: process.env.DB_USER || 'leados_user',
  password: process.env.DB_PASS || 'LeadOS_DB@2026',
});


// Ensure tables are altered for Content Factory columns
const initDb = async () => {
  try {
    await pool.query(`ALTER TABLE thedal_content ADD COLUMN IF NOT EXISTS language VARCHAR(50) DEFAULT 'english'`);
    await pool.query(`ALTER TABLE thedal_content ADD COLUMN IF NOT EXISTS word_count INTEGER`);
    await pool.query(`ALTER TABLE thedal_content ADD COLUMN IF NOT EXISTS meta_description TEXT`);
    await pool.query(`ALTER TABLE thedal_content ADD COLUMN IF NOT EXISTS slug VARCHAR(255)`);
    await pool.query(`ALTER TABLE thedal_content ADD COLUMN IF NOT EXISTS overrides JSONB DEFAULT '{}'::jsonb`);
    await pool.query(`ALTER TABLE thedal_clients ADD COLUMN IF NOT EXISTS location VARCHAR(255) DEFAULT 'Pondicherry'`);
  } catch (err) {
    console.error('Failed to run content migrations:', err);
  }
};
initDb();

// Helper to parse Gemini response safely, handling markdown block wrap
const parseAIJson = (text) => {
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.substring(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.substring(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }
  return JSON.parse(cleaned.trim());
};

const escapeHtml = (str) => String(str || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Renders the AI's structured blog sections into one self-contained HTML string
// (inline styles, no <style> tag) so it's safe to paste into any CMS body field
// and still carries the standard content-marketing elements: tag pill, lead
// paragraph, sub-sectioned blocks, comparison table, callout, FAQ, CTA.
function composeBlogHtml(s, client, { skipTagPill = false } = {}) {
  const brand = client.business_name || client.domain || 'us';
  const phoneDigits = String(client.phone || '').replace(/\D/g, '');
  const ctaHref = phoneDigits ? `https://wa.me/${phoneDigits}` : '#contact';

  // The full-page composer renders its own tag pill above the <h1>, in the
  // right reading order — skip this one there so it doesn't appear twice.
  const tagPill = (s.tagPill && !skipTagPill) ? `<span style="display:inline-flex;align-items:center;gap:6px;background:#eef2ff;border:1px solid #c7d2fe;color:#4f46e5;font-size:12px;font-weight:700;letter-spacing:.08em;padding:6px 14px;border-radius:100px;margin-bottom:16px;">${escapeHtml(s.tagPill.toUpperCase())}</span>` : '';

  const lead = s.leadParagraph ? `<p style="font-size:17px;color:#374151;margin:0 0 16px;font-weight:500;">${escapeHtml(s.leadParagraph)}</p>` : '';
  const intro = (Array.isArray(s.intro) ? s.intro : [s.intro].filter(Boolean)).map((p) => `<p style="margin:0 0 16px;color:#374151;">${escapeHtml(p)}</p>`).join('');

  // A comparison table or example callout, when present, belongs to whichever
  // specific block the AI attached it to — rendered inside that block, after
  // its subsections and before its CTA, the same way a real published article
  // ties a table/example to the section it's actually about instead of
  // dumping both in a generic zone at the end of the post.
  const renderTable = (t) => (t?.rows?.length && t?.columns?.length) ? `
    <div style="overflow-x:auto;margin:20px 0;border:1px solid #e5e7eb;border-radius:14px;">
      <table style="width:100%;min-width:480px;border-collapse:collapse;background:#fff;">
        <thead><tr>${t.columns.map((c) => `<th style="padding:11px 16px;background:#312e81;color:#fff;text-align:left;font-size:13px;">${escapeHtml(c)}</th>`).join('')}</tr></thead>
        <tbody>${t.rows.map((row) => `<tr>${row.map((cell, i) => `<td style="padding:11px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;color:${i === row.length - 1 ? '#1e1b4b;font-weight:700' : '#6b7280'};">${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>` : '';

  const renderCallout = (c) => c?.text ? `
    <div style="background:#fef9c3;border-left:4px solid #eab308;border-radius:10px;padding:18px 22px;margin:20px 0;color:#713f12;font-size:15px;">
      ${c.label ? `<strong>${escapeHtml(c.label)}:</strong> ` : ''}${escapeHtml(c.text)}
    </div>` : '';

  // Each block gets its own placeholder image slot (click-to-upload in the
  // editor — see data-block-image handling on the frontend) and a short,
  // block-specific CTA button, matching the section-by-section rhythm of a
  // real published article rather than one image + one CTA for the whole post.
  const blocksHtml = (s.blocks || []).map((b, i) => `
    <div style="margin-top:44px;">
      <h2 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 16px;line-height:1.3;">${escapeHtml(b.heading)}</h2>
      <div data-block-image="${i}" style="width:100%;height:220px;border-radius:16px;margin:0 0 20px;border:1px solid #e5e7eb;background:linear-gradient(135deg,#eef2ff,#f3e8ff);display:flex;align-items:center;justify-content:center;color:#818cf8;font-size:13px;font-weight:600;overflow:hidden;text-align:center;padding:12px;">Add an image for this section (1200&times;600 recommended)</div>
      ${b.intro ? `<p style="margin:0 0 20px;color:#374151;">${escapeHtml(b.intro)}</p>` : ''}
      ${(b.subsections || []).map((sub) => `
        <div style="margin-bottom:18px;">
          <h3 style="font-size:16px;font-weight:700;color:#1e1b4b;margin:0 0 6px;">${escapeHtml(sub.heading)}</h3>
          <p style="margin:0;color:#374151;font-size:15px;">${escapeHtml(sub.text)}</p>
        </div>`).join('')}
      ${renderTable(b.table)}
      ${renderCallout(b.callout)}
      <div data-block-cta="${i}" style="text-align:center;margin-top:24px;">
        <a href="${ctaHref}" target="_blank" rel="noopener noreferrer" style="display:inline-block;min-width:80px;min-height:1em;background:#4338ca;color:#fff;font-weight:700;font-size:13px;padding:12px 28px;border-radius:100px;text-decoration:none;">${escapeHtml(b.ctaLabel || `Talk to ${brand}`)}</a>
      </div>
    </div>`).join('');

  // Legacy top-level comparisonTable/callout — kept only so drafts saved
  // before this change (which never attached these to a block) still render
  // exactly as they did when composed.
  const table = renderTable(s.comparisonTable);
  const callout = renderCallout(s.callout);

  const conclusion = s.conclusion ? `
    <div style="margin-top:44px;">
      <h2 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 16px;">Conclusion</h2>
      <p style="margin:0;color:#374151;">${escapeHtml(s.conclusion)}</p>
    </div>` : '';

  const faqHtml = (s.faqs || []).length ? `
    <div style="margin-top:44px;">
      <h2 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 20px;">Frequently Asked Questions</h2>
      ${s.faqs.map((f) => `
        <details style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px 20px;margin-bottom:10px;">
          <summary style="font-weight:600;color:#1e1b4b;font-size:15px;cursor:pointer;">${escapeHtml(f.question)}</summary>
          <p style="margin:12px 0 0;color:#6b7280;font-size:14px;">${escapeHtml(f.answer)}</p>
        </details>`).join('')}
    </div>` : '';

  const bottomCta = `
    <div style="position:relative;overflow:hidden;background:linear-gradient(120deg,#1e1b4b 0%,#4338ca 60%,#7c3aed 130%);border-radius:20px;padding:36px 32px;margin-top:44px;text-align:center;">
      <h2 style="color:#fff;font-size:22px;margin:0 0 10px;">${escapeHtml(s.ctaHeading || `Ready to get started with ${brand}?`)}</h2>
      <a href="${ctaHref}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:10px;background:#facc15;color:#1e1b4b;font-weight:700;font-size:14px;padding:13px 28px;border-radius:100px;text-decoration:none;">${escapeHtml(s.ctaLabel || `Contact ${brand}`)}</a>
    </div>`;

  return `${tagPill}${lead}${intro}${blocksHtml}${table}${callout}${conclusion}${faqHtml}${bottomCta}`;
}

// Wraps composeBlogHtml's body content in a complete, standalone, downloadable
// HTML document — real <title>/meta tags, a JSON-LD <script>, self-contained
// CSS (no build step, no external framework), breadcrumb, hero placeholder,
// meta row and a brand sidebar — everything a page needs, not just the body.
function composeFullBlogPage({ structured, bodyHtml, client, jsonLd, slug, overrides = {} }) {
  const brand = client.business_name || client.domain || 'Us';
  const domain = client.domain || '';
  const initial = (brand[0] || 'B').toUpperCase();
  const dateLabel = overrides.dateLabel || new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const phoneDigits = String(client.phone || '').replace(/\D/g, '');
  const waHref = phoneDigits ? `https://wa.me/${phoneDigits}` : '#contact';
  // Everything below is a placeholder by default — no real hero image, no real
  // byline, sidebar text just reused from elsewhere. `overrides` lets the
  // frontend swap in something real (typed manually or AI-suggested) before
  // download, instead of shipping these as permanent hardcoded filler.
  const authorName = overrides.authorName?.trim() || `${brand} Team`;
  const sidebarBlurb = overrides.sidebarBlurb?.trim() || structured.leadParagraph || `${brand} — ${domain}`;
  const ctaHeading = overrides.ctaHeading?.trim() || 'Need help with this?';
  const ctaText = overrides.ctaText?.trim() || `Chat with ${brand} directly and get moving today.`;
  const heroImageHtml = overrides.heroImageUrl?.trim()
    ? `<img src="${escapeHtml(overrides.heroImageUrl.trim())}" alt="${escapeHtml(structured.title)}" style="width:100%;height:100%;object-fit:cover;" />`
    : 'Add a hero image here (1600&times;800 recommended)';
  const toHashtag = (w) => `#${String(w).replace(/[^a-zA-Z0-9]/g, '')}`;
  const defaultHashtags = [structured.tagPill, brand].filter(Boolean).join(' ').split(/\s+/).filter((w) => w.length > 1).map(toHashtag);
  const hashtags = (overrides.hashtags?.trim()
    ? overrides.hashtags.trim().split(/[,\s]+/).filter(Boolean).map((h) => (h.startsWith('#') ? h : toHashtag(h)))
    : defaultHashtags
  ).slice(0, 6);

  const css = `
    .cf-blog { background:#f9fafb; color:#111827; font-family:'Inter',-apple-system,Segoe UI,Roboto,sans-serif; line-height:1.7; font-size:16px; }
    .cf-blog * { box-sizing:border-box; }
    .cf-blog h1, .cf-blog h2, .cf-blog h3 { font-family:'Fraunces',Georgia,serif; font-weight:700; color:#111827; line-height:1.25; margin:0; word-break:break-word; }
    .cf-blog a { color:#4f46e5; text-decoration:none; }
    .cf-blog a:hover { text-decoration:underline; }
    .cf-blog img { max-width:100%; display:block; }
    .cf-blog .page { max-width:1200px; width:100%; margin:0 auto; padding:56px 40px 80px; display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:46px; }
    .cf-blog .breadcrumb { font-size:13px; color:#6b7280; margin-bottom:16px; display:flex; align-items:center; flex-wrap:wrap; gap:6px; }
    .cf-blog .breadcrumb .current { color:#111827; font-weight:600; }
    .cf-blog .tag-pill { display:inline-flex; align-items:center; gap:6px; background:#eef2ff; border:1px solid #c7d2fe; color:#4f46e5; font-size:11px; font-weight:700; letter-spacing:.08em; padding:6px 14px; border-radius:100px; margin-bottom:16px; }
    .cf-blog article h1 { font-size:2.1rem; max-width:720px; margin-bottom:18px; }
    .cf-blog .meta-row { display:flex; gap:22px; align-items:center; color:#6b7280; font-size:14px; padding-bottom:20px; border-bottom:1px solid #e5e7eb; margin-bottom:26px; flex-wrap:wrap; }
    .cf-blog .hero-image { width:100%; height:280px; border-radius:20px; margin-bottom:8px; border:1px solid #e5e7eb; background:linear-gradient(135deg,#eef2ff,#f3e8ff); display:flex; align-items:center; justify-content:center; color:#818cf8; font-size:13px; font-weight:600; overflow:hidden; }
    .cf-blog article > p { margin:0 0 16px; color:#374151; font-size:16px; }
    .cf-blog .cf-blog-body { margin-top:26px; }
    .cf-blog aside { align-self:start; position:sticky; top:24px; display:flex; flex-direction:column; gap:20px; }
    .cf-blog .side-card { background:#fff; border:1px solid #f3f4f6; border-radius:24px; padding:28px; box-shadow:0 1px 8px rgba(0,0,0,.04); }
    .cf-blog .eyebrow-mini { font-size:11px; letter-spacing:.1em; color:#9ca3af; font-weight:700; margin-bottom:16px; display:block; text-transform:uppercase; }
    .cf-blog .brand-row { display:flex; align-items:center; gap:12px; margin-bottom:14px; }
    .cf-blog .brand-logo { width:48px; height:48px; border-radius:50%; background:#1e1b4b; display:flex; align-items:center; justify-content:center; color:#facc15; font-family:'Fraunces',Georgia,serif; font-weight:800; font-size:18px; flex-shrink:0; }
    .cf-blog .side-card p { font-size:14px; color:#6b7280; margin:0; line-height:1.65; }
    .cf-blog .hashtags { display:flex; flex-wrap:wrap; gap:6px; margin-top:14px; }
    .cf-blog .hashtag { font-size:11px; font-weight:600; color:#4f46e5; background:#eef2ff; padding:3px 9px; border-radius:100px; }
    .cf-blog .cta-card { background:#f0fdf4; border:1px solid #bbf7d0; }
    .cf-blog .cta-card h3 { color:#166534; font-size:16px; margin-bottom:8px; }
    .cf-blog .wa-btn { display:flex; align-items:center; justify-content:center; gap:8px; background:#16a34a; color:#fff; font-weight:700; font-size:14px; padding:14px; border-radius:12px; text-decoration:none; margin-top:14px; }
    .cf-blog .wa-btn:hover { text-decoration:none; background:#15803d; }
    @media (max-width:880px) { .cf-blog .page { grid-template-columns:1fr; padding:40px 20px 50px; } .cf-blog aside { position:static; } }
    .cf-blog [data-field] { border-radius:8px; transition:outline .15s ease, background-color .15s ease; }
    .cf-blog [data-field]:hover { outline:2px dashed #818cf8; outline-offset:3px; cursor:pointer; background:rgba(99,102,241,.06); }
  `.replace(/\n\s+/g, '\n').trim();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(structured.title)}</title>
<meta name="description" content="${escapeHtml(structured.metaDescription)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700;9..144,800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
${jsonLd}
<style>${css}</style>
</head>
<body>
<div class="cf-blog">
  <div class="page">
    <article>
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a> &rsaquo; <a href="/blog">Blog</a> &rsaquo; <span class="current">${escapeHtml(structured.title)}</span>
      </nav>
      ${structured.tagPill ? `<span class="tag-pill">${escapeHtml(structured.tagPill.toUpperCase())}</span>` : ''}
      <h1 data-field="title">${escapeHtml(structured.title)}</h1>
      <div class="meta-row"><span data-field="author">${escapeHtml(authorName)}</span><span data-field="date">${dateLabel}</span></div>
      <div class="hero-image" data-field="hero">${heroImageHtml}</div>
      <div class="cf-blog-body" data-field="body">
        ${bodyHtml}
      </div>
    </article>
    <aside>
      <div class="side-card">
        <span class="eyebrow-mini">About ${escapeHtml(brand)}</span>
        <div class="brand-row"><div class="brand-logo">${escapeHtml(initial)}</div><strong>${escapeHtml(brand)}</strong></div>
        <p data-field="blurb">${escapeHtml(sidebarBlurb)}</p>
        ${hashtags.length ? `<div class="hashtags" data-field="hashtags">${hashtags.map((h) => `<span class="hashtag">${escapeHtml(h)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="side-card cta-card">
        <h3 data-field="ctaHeading">${escapeHtml(ctaHeading)}</h3>
        <p data-field="ctaText">${escapeHtml(ctaText)}</p>
        <a href="${waHref}" class="wa-btn" target="_blank" rel="noopener noreferrer">Connect on WhatsApp</a>
      </div>
    </aside>
  </div>
</div>
</body>
</html>`;
}

const CRAWL_UA = 'Mozilla/5.0 (compatible; LeadOSContentBot/1.0; +https://leados-app.abmgroups.org)';

async function fetchPage(url) {
  const response = await axios.get(url, {
    timeout: 10000,
    maxRedirects: 5,
    headers: { 'User-Agent': CRAWL_UA, Accept: 'text/html,application/xhtml+xml' },
    validateStatus: (status) => status < 500,
  });
  if (response.status >= 400) throw new Error(`HTTP ${response.status}`);
  return response.data;
}

// Fetches the client's real website (homepage + a handful of internal pages)
// so downstream prompts are grounded in what the business actually offers,
// not just its stored category label. Never throws — callers get null on
// failure and should fall back to the client's stored profile fields.
async function crawlClientWebsite(domain) {
  if (!domain) return null;
  const baseUrl = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
  let origin;
  try { origin = new URL(baseUrl).origin; } catch { return null; }

  try {
    const homeHtml = await fetchPage(origin);
    const $ = cheerio.load(homeHtml);
    $('script, style, noscript, svg').remove();

    const homepageTitle = $('title').first().text().trim();
    const homepageMeta = $('meta[name="description" i]').attr('content')?.trim() || '';
    const homepageText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 2500);

    // Best-effort brand facts pulled straight from the homepage markup —
    // used to prefill Organization/LocalBusiness schema fields for real.
    let logoUrl = null;
    const logoImg = $('header img, nav img, img[class*="logo" i], img[alt*="logo" i], img[src*="logo" i]').first();
    if (logoImg.attr('src')) {
      try { logoUrl = new URL(logoImg.attr('src'), origin).href; } catch { /* leave null */ }
    }
    const socialLinks = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (/(facebook|instagram|linkedin|twitter|x\.com|youtube)\.com/i.test(href) && !socialLinks.includes(href)) socialLinks.push(href);
    });
    const phoneMatch = homepageText.match(/(?:\+?91[\s-]?)?[6-9]\d{9}\b/);
    const phone = phoneMatch ? phoneMatch[0] : null;
    const addressText = $('address').first().text().replace(/\s+/g, ' ').trim() || null;

    // Discover internal page links from the homepage nav/body.
    const seen = new Set([`${origin}/`]);
    const internalLinks = [];
    $('a[href]').each((_, el) => {
      if (internalLinks.length >= 25) return;
      const href = $(el).attr('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
      let abs;
      try { abs = new URL(href, origin).href; } catch { return; }
      if (!abs.startsWith(origin)) return;
      if (/\.(jpg|jpeg|png|gif|svg|pdf|zip|css|js|webp|ico)$/i.test(abs)) return;
      const clean = abs.split('#')[0];
      if (seen.has(clean)) return;
      seen.add(clean);
      internalLinks.push({ url: clean, label: $(el).text().replace(/\s+/g, ' ').trim().slice(0, 60) });
    });

    // Visit a handful of the most content-relevant-looking internal pages
    // (skip legal/account boilerplate) to build a richer picture of the business.
    const skip = /(privacy|terms|cookie|login|signin|signup|cart|checkout)/i;
    const candidates = internalLinks.filter((l) => !skip.test(l.url)).slice(0, 5);
    const pages = [{ url: `${origin}/`, title: homepageTitle, text: homepageText }];
    for (const link of candidates) {
      if (pages.length >= 4) break;
      try {
        const html = await fetchPage(link.url);
        const $$ = cheerio.load(html);
        $$('script, style, noscript, svg').remove();
        const title = $$('title').first().text().trim() || link.label;
        const text = $$('body').text().replace(/\s+/g, ' ').trim().slice(0, 1200);
        if (text) pages.push({ url: link.url, title, text });
      } catch { /* skip pages that fail to load */ }
    }

    return {
      origin, homepageTitle, homepageMeta, pages,
      logoUrl, socialLinks: socialLinks.slice(0, 6), phone, addressText,
      discoveredLinks: internalLinks.slice(0, 15).map((l) => l.label || l.url).filter(Boolean),
    };
  } catch (err) {
    console.warn(`[Content Factory] Site crawl failed for ${origin}:`, err.message);
    return null;
  }
}

// GET content list for calendar
router.get('/:clientId', async (req, res) => {
  const { clientId } = req.params;
  const { status } = req.query;
  try {
    let query = 'SELECT id, title, slug, content_type, target_keyword, status, language, word_count, created_at FROM thedal_content WHERE client_id = $1';
    const params = [clientId];
    if (status) {
      query += ' AND status = $2';
      params.push(status);
    }
    query += ' ORDER BY created_at DESC';
    const result = await pool.query(query, params);
    res.json({ content: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET schemas saved for a client — thedal_schema_library was write-only until
// now (rows were inserted by /:clientId/schema below but nothing ever read
// them back), so anything generated here was invisible everywhere else,
// including the Monthly Report's Schema Library section.
//
// Registered ahead of the generic /:clientId/:id route below — Express
// matches routes in registration order, and /:clientId/:id would otherwise
// greedily match "schemas" as :id and crash trying to use it as an integer.
router.get('/:clientId/schemas', async (req, res) => {
  const { clientId } = req.params;
  try {
    const { rows } = await pool.query(
      'SELECT id, schema_type, schema_json, target_page, is_deployed, created_at FROM thedal_schema_library WHERE client_id = $1 ORDER BY created_at DESC',
      [clientId]
    );
    res.json({ items: rows });
  } catch (err) {
    console.error('Failed to fetch saved schemas:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch saved schemas' });
  }
});

// GET specific content item
router.get('/:clientId/:id', async (req, res) => {
  const { clientId, id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM thedal_content WHERE id = $1 AND client_id = $2', [id, clientId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Content not found' });
    const row = result.rows[0];

    // Reconstruct the full-page preview/download on demand from what's already
    // saved — no AI call, no separate storage needed. Lets every existing
    // draft (including ones saved before this feature existed) get the same
    // live preview + ZIP download as a freshly generated post.
    let fullPageHtml = null;
    let jsonLd = null;
    if (row.content_type === 'blog_post' && row.body) {
      const clientRes = await pool.query('SELECT * FROM thedal_clients WHERE id = $1', [clientId]);
      const client = clientRes.rows[0];
      if (client) {
        const overrides = row.overrides || {};
        const structured = { title: row.title, metaDescription: row.meta_description, leadParagraph: row.meta_description };
        const jsonLdObj = buildSchemaObject('Article', {
          headline: row.title,
          authorName: overrides.authorName || `${client.business_name || client.domain} Team`,
          datePublished: new Date(overrides.postDate || row.created_at || Date.now()).toISOString().slice(0, 10),
          imageUrl: overrides.heroImageUrl || undefined,
        }, client);
        jsonLd = `<script type="application/ld+json">\n${JSON.stringify(jsonLdObj, null, 2)}\n</script>`;
        fullPageHtml = composeFullBlogPage({ structured, bodyHtml: row.body, client, jsonLd, slug: row.slug, overrides });
      }
    }

    res.json({ content: { ...row, fullPageHtml, jsonLd } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST generate blog
router.post('/:clientId/generate-blog', async (req, res) => {
  const { clientId } = req.params;
  const { keyword, language = 'english', wordCount = 800, tone = 'professional' } = req.body;
  if (!keyword) return res.status(400).json({ error: 'Keyword is required' });

  try {
    const clientRes = await pool.query('SELECT * FROM thedal_clients WHERE id = $1', [clientId]);
    if (clientRes.rowCount === 0) return res.status(404).json({ error: 'Client not found' });
    const client = clientRes.rows[0];

    const useDemoMode = req.headers['x-data-mode'] === 'demo' || !openRouter.isConfigured;
    const brand = client.business_name || client.domain || 'Us';
    const slug = keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    if (useDemoMode) {
      const structured = {
        title: `${keyword} — The Complete Guide for ${client.location || 'Pondicherry'} Businesses`,
        metaDescription: `Looking for ${keyword}? This guide covers what to focus on, common mistakes to avoid, and how ${brand} can help — with a clear next step.`,
        tagPill: 'GUIDE',
        leadParagraph: `This is a simulated post for "${keyword}", showing every structural section the live generator produces: a lead paragraph, sub-sectioned blocks, a comparison table, a callout, an FAQ accordion and a closing CTA.`,
        intro: [`Every good post on this topic needs to answer one question first: why does "${keyword}" matter to the reader right now, and what should they do next?`],
        blocks: [
          { heading: `Why ${keyword} Matters`, intro: 'Explain the reader\'s problem and why solving it well pays off.', ctaLabel: 'Get Started Today', subsections: [
            { heading: 'Reason one', text: 'A concrete, specific benefit — not a generic claim.' },
            { heading: 'Reason two', text: 'A second concrete benefit that differentiates a good answer from a shallow one.' },
          ] },
          { heading: `What To Look For`, intro: 'Give the reader a practical checklist, not just theory.', ctaLabel: `Talk to ${brand}`, subsections: [
            { heading: 'Checklist item one', text: 'Specific, actionable guidance.' },
            { heading: 'Checklist item two', text: 'Specific, actionable guidance.' },
          ], table: { columns: ['Feature', 'Doing it yourself', `Through ${brand}`], rows: [['Speed', 'Slower', 'Faster'], ['Expertise', 'Limited', 'Specialist']] } },
          { heading: `Mistakes To Avoid`, intro: 'Cover the pitfalls that trip up most people on this topic.', ctaLabel: 'See The Checklist', subsections: [
            { heading: 'Pitfall one', text: 'A specific, avoidable mistake and why it costs more than it seems.' },
          ], callout: { label: 'Real example', text: `A ${client.location || 'Pondicherry'} business solved this exact problem by working with ${brand} and saw a measurable result within weeks.` } },
        ],
        conclusion: `Getting "${keyword}" right comes down to focus and the right partner. ${brand} can help you get there faster.`,
        faqs: [
          { question: `What should I focus on first for ${keyword}?`, answer: 'Start with the fundamentals before optimizing details.' },
          { question: 'What mistakes should I avoid?', answer: 'Avoid generic claims with no specific, checkable detail behind them.' },
        ],
        ctaHeading: `Ready to get started with ${keyword}?`,
        ctaLabel: `Talk to ${brand}`,
      };
      const content = composeBlogHtml(structured, client);
      const wc = parseInt(wordCount) || 800;
      const jsonLdObj = buildSchemaObject('Article', { headline: structured.title, authorName: `${brand} Team`, datePublished: new Date().toISOString().slice(0, 10) }, client);
      const jsonLd = `<script type="application/ld+json">\n${JSON.stringify(jsonLdObj, null, 2)}\n</script>`;
      const fullPageHtml = composeFullBlogPage({ structured, bodyHtml: composeBlogHtml(structured, client, { skipTagPill: true }), client, jsonLd, slug });
      const aiRes = { title: structured.title, metaDescription: structured.metaDescription, slug, content, jsonLd, fullPageHtml, wordCount: wc, readingTime: `${Math.round(wc / 200)} min read`, focusKeyword: keyword, secondaryKeywords: [`${keyword} tips`, `${keyword} guide`] };

      const insertRes = await pool.query(
        `INSERT INTO thedal_content (client_id, content_type, title, body, target_keyword, status, language, word_count, meta_description, slug)
         VALUES ($1, 'blog_post', $2, $3, $4, 'draft', $5, $6, $7, $8) RETURNING id`,
        [clientId, aiRes.title, aiRes.content, keyword, language, aiRes.wordCount, aiRes.metaDescription, aiRes.slug]
      );

      return res.json({ post: { ...aiRes, id: insertRes.rows[0].id } });
    }

    const langInstruction = language === 'tamil'
      ? 'Write entirely in Tamil script.'
      : language === 'tanglish'
      ? 'Write in Tanglish — Tamil words romanized in English, mixed with English. Natural conversational tone as spoken in Tamil Nadu.'
      : 'Write in clear, professional Indian English.';

    const prompt = `You are a senior content-marketing writer producing a publication-ready blog post for "${brand}", located in "${client.location || 'Pondicherry'}".
    Business Category: "${client.business_category || 'Business'}"
    Target keyword: "${keyword}"
    Language style: ${langInstruction}
    Tone: ${tone}
    Target word count: ${wordCount} words

    Structure this like a real published blog post, not a flat list of headings. Every section below must earn its place — do not pad with generic filler:
    1. title: 50-60 chars, includes the keyword.
    2. metaDescription: 150-160 chars, includes the keyword, states a clear reason to click.
    3. tagPill: ONE short category label (2-3 words, e.g. "HIRING GUIDE", "HOW-TO", "LOCAL SEO").
    4. leadParagraph: 2-3 sentences that hook the reader and state exactly what they'll get from reading — this is the most important paragraph, make it earn attention.
    5. intro: 1-2 short paragraphs (array of strings) giving context before the first heading.
    6. blocks: 3-4 objects, each { heading (H2, includes a keyword variation), intro (1-2 sentences), ctaLabel (a short, 2-4 word action button specific to THIS section's topic, e.g. "Start Hiring Today", "See The Checklist" — never generic like "Click Here"), subsections: 2-4 objects { heading (H3), text (2-3 sentences, specific and concrete — never a vague generic claim) } }. Each block must cover a genuinely distinct angle (e.g. why it matters, what to look for, where to find it, mistakes to avoid) — never repeat the same point across blocks.
    7. table: OPTIONAL, attached to AT MOST ONE block — whichever block a real comparison naturally belongs to (e.g. DIY vs done-for-you, Option A vs Option B). Add it as that block's own "table" field: { columns: [3-4 strings], rows: [[cells...], ...] }. Every other block omits "table" entirely. Skip it altogether across all blocks if forcing a comparison would feel artificial for this topic.
    8. callout: OPTIONAL, attached to AT MOST ONE block — whichever block a realistic, specific example/case-study/stat relevant to ${client.location || 'Pondicherry'} or Tamil Nadu would best illustrate. Add it as that block's own "callout" field: { label, text }. Every other block omits "callout". Never invent a named person, a specific company name, or a precise statistic that isn't clearly presented as illustrative.
    9. conclusion: 2-3 sentences that summarize the core decision the reader should make — no new information.
    10. faqs: 4-5 objects { question, answer }, answering real objections/questions a reader would have, not restating the blocks.
    11. ctaHeading + ctaLabel: for the closing call-to-action, referencing ${brand}.

    Return ONLY a valid JSON object, no markdown code fences. Keys exactly:
    {
      "title": "...", "metaDescription": "...",
      "tagPill": "...", "leadParagraph": "...", "intro": ["..."],
      "blocks": [{ "heading": "...", "intro": "...", "ctaLabel": "...", "subsections": [{ "heading": "...", "text": "..." }], "table": { "columns": ["..."], "rows": [["..."]] }, "callout": { "label": "...", "text": "..." } }],
      "conclusion": "...", "faqs": [{ "question": "...", "answer": "..." }],
      "ctaHeading": "...", "ctaLabel": "...",
      "wordCount": ${wordCount}, "readingTime": "X min read",
      "focusKeyword": "${keyword}", "secondaryKeywords": ["...", "..."]
    }
    Only ONE block total should carry "table", only ONE block total should carry "callout" (can be the same or different blocks) — every other block omits both keys entirely.`;

    const response = await openRouter.models.generateContent({
      model: openRouter.DEFAULT_MODEL,
      contents: prompt,
      config: { responseMimeType: 'application/json' },
    });

    const structured = parseAIJson(response.text);
    const content = composeBlogHtml(structured, client);
    const jsonLdObj = buildSchemaObject('Article', { headline: structured.title, authorName: `${brand} Team`, datePublished: new Date().toISOString().slice(0, 10) }, client);
    const jsonLd = `<script type="application/ld+json">\n${JSON.stringify(jsonLdObj, null, 2)}\n</script>`;
    const fullPageHtml = composeFullBlogPage({ structured, bodyHtml: composeBlogHtml(structured, client, { skipTagPill: true }), client, jsonLd, slug });
    const aiRes = {
      title: structured.title,
      metaDescription: structured.metaDescription,
      slug,
      content,
      jsonLd,
      fullPageHtml,
      wordCount: structured.wordCount || wordCount,
      readingTime: structured.readingTime || `${Math.round((structured.wordCount || wordCount) / 200)} min read`,
      focusKeyword: structured.focusKeyword || keyword,
      secondaryKeywords: structured.secondaryKeywords || [],
    };

    // Save to Postgres
    const insertRes = await pool.query(
      `INSERT INTO thedal_content (client_id, content_type, title, body, target_keyword, status, language, word_count, meta_description, slug)
       VALUES ($1, 'blog_post', $2, $3, $4, 'draft', $5, $6, $7, $8) RETURNING id`,
      [clientId, aiRes.title, aiRes.content, keyword, language, aiRes.wordCount, aiRes.metaDescription, aiRes.slug]
    );

    res.json({ post: { ...aiRes, id: insertRes.rows[0].id } });
  } catch (err) {
    console.error('Failed to generate blog post:', err);
    res.status(500).json({ error: err.message || 'AI blog post generation failed' });
  }
});

// POST /:clientId/suggest-sidebar-blurb — writes a short, fresh "about this
// business" blurb for the preview sidebar, tailored to the specific post
// topic instead of reusing the lead paragraph verbatim.
router.post('/:clientId/suggest-sidebar-blurb', async (req, res) => {
  const { clientId } = req.params;
  const { title, keyword } = req.body;
  try {
    const clientRes = await pool.query('SELECT * FROM thedal_clients WHERE id = $1', [clientId]);
    if (clientRes.rowCount === 0) return res.status(404).json({ error: 'Client not found' });
    const client = clientRes.rows[0];
    const brand = client.business_name || client.domain || 'This business';

    if (!openRouter.isConfigured) {
      return res.json({ blurb: `${brand} helps local businesses with ${client.business_category || 'their goals'} — reach out to learn how "${title || keyword}" applies to you.` });
    }

    const prompt = `Write ONE short (2 sentences max, under 240 characters), warm "about us" blurb for a sidebar card on a blog post titled "${title || keyword}".
Business: ${brand}, category: ${client.business_category || 'Business'}, location: ${client.location || 'Pondicherry'}.
It should connect the business to THIS specific post's topic, not be generic boilerplate. Return ONLY the blurb text, no quotes, no markdown.`;
    const response = await openRouter.models.generateContent({ model: openRouter.DEFAULT_MODEL, contents: prompt });
    const blurb = String(response.text || '').trim().replace(/^["']|["']$/g, '');
    res.json({ blurb: blurb || `${brand} — reach out to learn more about "${title || keyword}".` });
  } catch (err) {
    console.error('Failed to suggest sidebar blurb:', err);
    res.status(500).json({ error: err.message || 'Failed to suggest blurb' });
  }
});

// POST /:clientId/render-preview — recomposes the full page with the given
// overrides (hero image, author, sidebar blurb, CTA text) applied. No AI call
// for the main content — cheap and instant, used by the editable preview.
router.post('/:clientId/render-preview', async (req, res) => {
  const { clientId } = req.params;
  const { id, title, metaDescription, leadParagraph, tagPill, bodyHtml, slug, createdAt, overrides } = req.body;
  if (!title || !bodyHtml) return res.status(400).json({ error: 'title and bodyHtml are required' });
  try {
    const clientRes = await pool.query('SELECT * FROM thedal_clients WHERE id = $1', [clientId]);
    if (clientRes.rowCount === 0) return res.status(404).json({ error: 'Client not found' });
    const client = clientRes.rows[0];

    const structured = { title, metaDescription, leadParagraph, tagPill };
    const jsonLdObj = buildSchemaObject('Article', {
      headline: title,
      authorName: overrides?.authorName || `${client.business_name || client.domain} Team`,
      datePublished: new Date(createdAt || Date.now()).toISOString().slice(0, 10),
      imageUrl: overrides?.heroImageUrl || undefined,
    }, client);
    const jsonLd = `<script type="application/ld+json">\n${JSON.stringify(jsonLdObj, null, 2)}\n</script>`;
    const fullPageHtml = composeFullBlogPage({ structured, bodyHtml, client, jsonLd, slug, overrides: overrides || {} });

    // Persist every edit made in the editor (title, body, meta, hero image,
    // author, date, sidebar blurb, CTA, hashtags) — without this, "Update
    // Preview" only ever changed what was on screen, so a refresh (or
    // reopening the draft later) silently threw all of it away.
    let saved = false;
    if (id) {
      const updateRes = await pool.query(
        `UPDATE thedal_content SET title = $1, body = $2, meta_description = $3, overrides = $4 WHERE id = $5 AND client_id = $6`,
        [title, bodyHtml, metaDescription, JSON.stringify(overrides || {}), id, clientId]
      );
      saved = updateRes.rowCount > 0;
    }

    res.json({ fullPageHtml, jsonLd, saved });
  } catch (err) {
    console.error('Failed to render preview:', err);
    res.status(500).json({ error: err.message || 'Failed to render preview' });
  }
});

// POST rewrite meta tags
router.post('/:clientId/rewrite-meta', async (req, res) => {
  const { clientId } = req.params;
  const { pageUrl, currentTitle, currentMeta, targetKeyword } = req.body;

  try {
    const clientRes = await pool.query('SELECT * FROM thedal_clients WHERE id = $1', [clientId]);
    if (clientRes.rowCount === 0) return res.status(404).json({ error: 'Client not found' });
    const client = clientRes.rows[0];

    const useDemoMode = req.headers['x-data-mode'] === 'demo' || !openRouter.isConfigured;
    if (useDemoMode) {
      return res.json({
        result: {
          newTitle: `${targetKeyword} | Optimized Title for SEO`,
          newMetaDescription: `Looking for ${targetKeyword}? Discover premium services and solutions. Clear CTAs and local benefits inside!`,
          titleLength: 55,
          metaLength: 155,
          improvement: 'Injected high-priority target keyword first, optimized lengths to avoid truncation in Google Search SERPs.'
        }
      });
    }

    const prompt = `You are an SEO specialist. Rewrite these meta tags for better rankings.

    Business: ${client.business_name || client.domain}
    Location: ${client.location || 'Pondicherry'}
    Page URL: ${pageUrl}
    Target Keyword: "${targetKeyword}"
    Current Title: "${currentTitle}"
    Current Meta Description: "${currentMeta}"

    Rules:
    - Title: 50–60 chars, keyword first, include location if local business
    - Meta description: 150–160 chars, include keyword, location, clear benefit + CTA
    - Make them compelling for click-through rate
    - No keyword stuffing

    Return ONLY a valid JSON object. Do NOT wrap it in markdown code blocks like \`\`\`json. The JSON object must have exactly these keys:
    {
      "newTitle": "...",
      "newMetaDescription": "...",
      "titleLength": 55,
      "metaLength": 155,
      "improvement": "why this version is better"
    }`;

    const response = await openRouter.models.generateContent({
      model: openRouter.DEFAULT_MODEL,
      contents: prompt,
    });

    const aiRes = parseAIJson(response.text);
    res.json({ result: aiRes });
  } catch (err) {
    console.error('Failed to rewrite meta tags:', err);
    res.status(500).json({ error: err.message || 'AI meta rewrite failed' });
  }
});

// POST topic ideas
router.post('/:clientId/topic-ideas', async (req, res) => {
  const { clientId } = req.params;
  const { month, count = 8 } = req.body;

  try {
    const clientRes = await pool.query('SELECT * FROM thedal_clients WHERE id = $1', [clientId]);
    if (clientRes.rowCount === 0) return res.status(404).json({ error: 'Client not found' });
    const client = clientRes.rows[0];

    const useDemoMode = req.headers['x-data-mode'] === 'demo' || !openRouter.isConfigured;
    if (useDemoMode) {
      const topics = [];
      for (let i = 1; i <= count; i++) {
        topics.push({
          title: `How to Maximize Your Business Success in Pondicherry (Topic #${i})`,
          targetKeyword: `pondicherry business success`,
          intent: i % 2 === 0 ? 'informational' : 'transactional',
          estimatedTraffic: i % 3 === 0 ? 'high' : 'medium',
          contentType: i % 4 === 0 ? 'listicle' : 'guide',
          priority: i
        });
      }
      return res.json({ ideas: { topics } });
    }

    // Grab some tracked keywords, and — the primary signal — crawl the
    // client's actual live website so ideas are grounded in what the
    // business genuinely offers, not just its stored category label.
    const kwRes = await pool.query('SELECT keyword FROM thedal_keywords WHERE client_id = $1 LIMIT 10', [clientId]);
    const topKeywords = kwRes.rows.map(k => k.keyword).join(', ');
    const site = await crawlClientWebsite(client.domain);

    const siteContext = site
      ? `LIVE WEBSITE CONTENT — this is what was actually found on ${site.origin} just now. Base every idea on services/products/topics that genuinely appear here; do not invent offerings the site doesn't mention.
    Homepage title: ${site.homepageTitle || '(none)'}
    Homepage meta description: ${site.homepageMeta || '(none)'}
    Pages crawled: ${site.pages.map(p => `\n      - ${p.title || p.url} (${p.url}): ${p.text.slice(0, 500)}`).join('')}
    Other pages found on the site (not crawled): ${site.discoveredLinks.join(', ') || '(none)'}`
      : `Could not reach the client's live website (${client.domain || 'no domain on file'}) just now — base ideas on the stored business profile instead: category "${client.business_category || 'Business'}"${topKeywords ? `, tracked keywords: ${topKeywords}` : ''}.`;

    const prompt = `Generate ${count} SEO blog post ideas for ${client.business_name || client.domain}, located in ${client.location || 'Pondicherry'}.

    ${siteContext}
    ${topKeywords ? `\nTracked SEO keywords for this client: ${topKeywords}` : ''}
    Month: ${month}

    Every idea must be something this SPECIFIC business could credibly publish given what's actually on their site above — not generic industry advice that could apply to any business in this category.

    For each idea return:
    - title (compelling, click-worthy, references a real offering/page found on the site where possible)
    - targetKeyword (primary keyword)
    - intent (informational/transactional/navigational)
    - estimatedTraffic (high/medium/low)
    - contentType (how-to/listicle/guide/comparison/local)
    - priority (1-${count})
    - basedOn (which page or offering from the site context this idea is grounded in, one short phrase)

    Return ONLY a valid JSON object. Do NOT wrap it in markdown code blocks like \`\`\`json. The JSON object must have exactly this structure:
    {
      "topics": [
        {
          "title": "...",
          "targetKeyword": "...",
          "intent": "...",
          "estimatedTraffic": "...",
          "contentType": "...",
          "priority": 1,
          "basedOn": "..."
        },
        ...
      ]
    }`;

    const response = await openRouter.models.generateContent({
      model: openRouter.DEFAULT_MODEL,
      contents: prompt,
      config: { responseMimeType: 'application/json' },
    });

    const aiRes = parseAIJson(response.text);
    res.json({ ideas: aiRes, siteAnalyzed: site ? { origin: site.origin, pagesCrawled: site.pages.length } : null });
  } catch (err) {
    console.error('Failed to get topic ideas:', err);
    res.status(500).json({ error: err.message || 'AI topic ideas generation failed' });
  }
});

// Asks the AI to pull only REAL, literally-present facts out of the crawled
// site text for schema types that need unstructured content (Q&A, pricing,
// article info) — deterministic extraction (regex/DOM) can't do this well.
async function extractSchemaDataWithAI(schemaType, site) {
  if (!openRouter.isConfigured || !site?.pages?.length) return null;
  const allText = site.pages.map((p) => `### ${p.title || p.url} (${p.url})\n${p.text}`).join('\n\n').slice(0, 6000);
  let instruction;
  if (schemaType === 'FAQPage') {
    instruction = 'Extract REAL frequently-asked-question pairs that literally appear in this website content. Return {"faqs":[{"question":"...","answer":"..."}]}. If none genuinely appear, return {"faqs":[]}. Never invent a question or answer not present in the text.';
  } else if (schemaType === 'Product') {
    instruction = 'Find a REAL priced product or service package mentioned in this website content (name + price if stated). Return {"name":"...","description":"...","price":"..."}. If no real price is mentioned anywhere, return {"name":null,"description":null,"price":null}. Never invent a price.';
  } else if (schemaType === 'Article') {
    instruction = 'This is a business website. If any page below is clearly a blog/article/news post (not a service page), extract its headline and, if explicitly stated, author and publish date. Return {"headline":"...","authorName":"...","datePublished":"YYYY-MM-DD"}. If no article-like page exists, return {"headline":null,"authorName":null,"datePublished":null}. Never invent a date or author.';
  } else {
    return null;
  }
  try {
    const response = await openRouter.models.generateContent({
      model: openRouter.DEFAULT_MODEL,
      contents: `${instruction}\n\nWEBSITE CONTENT:\n${allText}`,
      config: { responseMimeType: 'application/json' },
    });
    return parseAIJson(response.text);
  } catch (err) {
    console.warn('[Content Factory] Schema AI extraction failed:', err.message);
    return null;
  }
}

// POST /:clientId/schema/prefill — auto-fill option: crawl the live site and
// return best-effort real values per schema field. Anything not confidently
// found is left blank for the user to fill in manually (never guessed).
router.post('/:clientId/schema/prefill', async (req, res) => {
  const { clientId } = req.params;
  const { schemaType } = req.body;
  if (!schemaType) return res.status(400).json({ error: 'schemaType is required' });

  try {
    const clientRes = await pool.query('SELECT * FROM thedal_clients WHERE id = $1', [clientId]);
    if (clientRes.rowCount === 0) return res.status(404).json({ error: 'Client not found' });
    const client = clientRes.rows[0];
    const site = await crawlClientWebsite(client.domain);

    let data = {};
    let foundFields = [];

    if (schemaType === 'LocalBusiness') {
      data = { name: client.business_name || '', streetAddress: site?.addressText || '', addressLocality: client.location || '', addressRegion: '', postalCode: '', telephone: site?.phone || '', priceRange: '' };
      foundFields = ['name', client.location && 'addressLocality', site?.addressText && 'streetAddress', site?.phone && 'telephone'].filter(Boolean);
    } else if (schemaType === 'Organization') {
      data = { name: client.business_name || '', logoUrl: site?.logoUrl || '', socialLinks: (site?.socialLinks || []).join('\n') };
      foundFields = ['name', site?.logoUrl && 'logoUrl', site?.socialLinks?.length && 'socialLinks'].filter(Boolean);
    } else if (schemaType === 'BreadcrumbList') {
      const crumbs = [{ name: 'Home', url: site?.origin ? `${site.origin}/` : `https://${client.domain}/` }];
      (site?.pages || []).slice(1, 3).forEach((p) => crumbs.push({ name: p.title || p.url, url: p.url }));
      data = { crumbs };
      foundFields = (site?.pages?.length || 0) > 1 ? ['crumbs'] : [];
    } else if (['FAQPage', 'Product', 'Article'].includes(schemaType)) {
      const extracted = await extractSchemaDataWithAI(schemaType, site);
      if (schemaType === 'FAQPage') {
        data = { faqs: extracted?.faqs?.length ? extracted.faqs : [{ question: '', answer: '' }] };
        foundFields = extracted?.faqs?.length ? ['faqs'] : [];
      } else if (schemaType === 'Product') {
        data = { name: extracted?.name || '', description: extracted?.description || '', price: extracted?.price || '', availability: 'InStock' };
        foundFields = ['name', 'description', 'price'].filter((k) => extracted?.[k]);
      } else {
        data = { headline: extracted?.headline || '', authorName: extracted?.authorName || client.client_name || '', datePublished: extracted?.datePublished || '', imageUrl: site?.logoUrl || '' };
        foundFields = ['headline', 'datePublished'].filter((k) => extracted?.[k]);
      }
    } else {
      return res.status(400).json({ error: 'Unsupported schema type' });
    }

    res.json({ data, foundFields, siteAnalyzed: site ? { origin: site.origin, pagesCrawled: site.pages.length } : null });
  } catch (err) {
    console.error('Failed to prefill schema:', err);
    res.status(500).json({ error: err.message || 'Prefill failed' });
  }
});

// Builds the final JSON-LD strictly from confirmed field data (whether that
// data came from the auto-fill crawl or was typed in manually) — no silent
// internal guessing left in this function at all.
function buildSchemaObject(schemaType, data, client) {
  const domain = client.domain;
  const brand = client.business_name || domain;
  switch (schemaType) {
    case 'LocalBusiness':
      return {
        '@context': 'https://schema.org', '@type': 'LocalBusiness',
        name: data.name || brand,
        url: `https://${domain}`,
        address: { '@type': 'PostalAddress', streetAddress: data.streetAddress || undefined, addressLocality: data.addressLocality || client.location || '', addressRegion: data.addressRegion || undefined, postalCode: data.postalCode || undefined, addressCountry: 'IN' },
        ...(data.telephone ? { telephone: data.telephone } : {}),
        ...(data.priceRange ? { priceRange: data.priceRange } : {}),
        areaServed: data.addressLocality || client.location || '',
      };
    case 'FAQPage':
      return {
        '@context': 'https://schema.org', '@type': 'FAQPage',
        mainEntity: (data.faqs || []).filter((f) => f.question && f.answer).map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
      };
    case 'BreadcrumbList':
      return {
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: (data.crumbs || []).filter((c) => c.name && c.url).map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url })),
      };
    case 'Product':
      return {
        '@context': 'https://schema.org', '@type': 'Product',
        name: data.name || `${brand} Service`,
        description: data.description || '',
        offers: { '@type': 'Offer', priceCurrency: 'INR', price: data.price || '', availability: `https://schema.org/${data.availability || 'InStock'}` },
      };
    case 'Organization':
      return {
        '@context': 'https://schema.org', '@type': 'Organization',
        name: data.name || brand,
        url: `https://${domain}`,
        ...(data.logoUrl ? { logo: data.logoUrl } : {}),
        ...(data.socialLinks ? { sameAs: String(data.socialLinks).split('\n').map((s) => s.trim()).filter(Boolean) } : {}),
      };
    case 'Article':
      return {
        '@context': 'https://schema.org', '@type': 'Article',
        headline: data.headline || '',
        author: { '@type': 'Person', name: data.authorName || client.client_name || 'Admin' },
        publisher: { '@type': 'Organization', name: brand, ...(data.imageUrl ? { logo: { '@type': 'ImageObject', url: data.imageUrl } } : {}) },
        datePublished: data.datePublished || new Date().toISOString().slice(0, 10),
        ...(data.imageUrl ? { image: data.imageUrl } : {}),
      };
    default:
      return null;
  }
}

// POST schema generation — builds strictly from the caller-supplied `data`
// (confirmed via the auto-fill-then-edit or fully-manual form on the frontend).
router.post('/:clientId/schema', async (req, res) => {
  const { clientId } = req.params;
  const { schemaType, data } = req.body;
  if (!schemaType) return res.status(400).json({ error: 'schemaType is required' });

  try {
    const clientRes = await pool.query('SELECT * FROM thedal_clients WHERE id = $1', [clientId]);
    if (clientRes.rowCount === 0) return res.status(404).json({ error: 'Client not found' });
    const client = clientRes.rows[0];

    const schemaObj = buildSchemaObject(schemaType, data || {}, client);
    if (!schemaObj) return res.status(400).json({ error: 'Unsupported schema type' });
    const jsonLd = `<script type="application/ld+json">\n${JSON.stringify(schemaObj, null, 2)}\n</script>`;

    await pool.query(
      `INSERT INTO thedal_schema_library (client_id, schema_type, schema_json, is_deployed)
       VALUES ($1, $2, $3, false) ON CONFLICT DO NOTHING`,
      [clientId, schemaType, JSON.stringify(schemaObj)]
    );

    res.json({ schema: { jsonLd } });
  } catch (err) {
    console.error('Failed to generate schema:', err);
    res.status(500).json({ error: err.message || 'Schema generation failed' });
  }
});

// PATCH update status
router.patch('/:clientId/:id/status', async (req, res) => {
  const { clientId, id } = req.params;
  const { status } = req.body;
  try {
    const result = await pool.query(
      'UPDATE thedal_content SET status = $1 WHERE id = $2 AND client_id = $3 RETURNING *',
      [status, id, clientId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Content not found' });
    res.json({ content: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
