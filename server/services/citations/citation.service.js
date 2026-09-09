const pool = require('../../db/connection');
const axios = require('axios');
const cheerio = require('cheerio');
const { chromium } = require('playwright');
const { logApiRequest } = require('../usage/usage.service');

// ── SUPPORTED DIRECTORIES REGISTRY ─────────────────────────────
const SUPPORTED_DIRECTORIES = [
  { name: 'Facebook', domains: ['facebook.com'] },
  { name: 'Justdial', domains: ['justdial.com'] },
  { name: 'Sulekha', domains: ['sulekha.com'] },
  { name: 'Bing Places', domains: ['bingplaces.com', 'bing.com/maps'] },
  { name: 'IndiaMART', domains: ['indiamart.com'] },
  { name: 'Yelp', domains: ['yelp.com'] },
  { name: 'Yellow Pages', domains: ['yellowpages.com', 'yellowpages.in'] },
  { name: 'Hotfrog', domains: ['hotfrog.in', 'hotfrog.com'] }
];

// Hosts that are directory/social platforms themselves, never the business's own website.
const DIRECTORY_HOST_DENYLIST = [
  'facebook.com', 'justdial.com', 'sulekha.com', 'bingplaces.com', 'bing.com',
  'indiamart.com', 'yelp.com', 'yellowpages.com', 'yellowpages.in', 'hotfrog.in', 'hotfrog.com',
  'instagram.com', 'twitter.com', 'x.com', 'linkedin.com', 'youtube.com',
  'play.google.com', 'apps.apple.com', 'google.com', 'whatsapp.com', 'wa.me', 'com.justdial'
];

function isValidBusinessWebsite(url) {
  if (!url || typeof url !== 'string') return false;
  const str = url.trim().toLowerCase();
  if (!/^https?:\/\//i.test(str)) return false;
  if (DIRECTORY_HOST_DENYLIST.some(host => str.includes(host))) return false;
  return true;
}

// ── UTILITIES ───────────────────────────────────────────────
function calculateScore(matchedCount, totalCount) {
  if (totalCount === 0) return 0;
  return Math.round((matchedCount / totalCount) * 100);
}

function normalizePhone(phone) {
  if (!phone) return '';
  return phone.replace(/\D/g, '').slice(-10);
}

function normalizeUrl(url) {
  if (!url) return '';
  return url.toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/www\./g, '')
    .replace(/\/$/g, '')
    .trim();
}

function normalizeText(text) {
  if (!text) return '';
  return text.toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Strict Business Name Validator
 * Rejects URLs, domain names, hostnames, and generic directory boilerplate words.
 * NOTE: Used ONLY at the NAP comparison / scraping output stage.
 * Must NOT be used in the discovery / search / URL extraction pipeline.
 */
function isValidBusinessName(name) {
  if (!name || typeof name !== 'string') return false;
  const str = name.trim();
  if (str.length === 0) return false;

  // Reject URLs, domain names, hostnames
  if (/^https?:\/\//i.test(str) || /^www\./i.test(str)) return false;
  if (/\b[a-z0-9-]+\.(com|in|org|net|co|io|biz|info)\b/i.test(str)) return false;

  // Reject generic directory & boilerplate words
  const genericTerms = [
    'justdial', 'justdial.com', 'sulekha', 'sulekha.com', 'facebook', 'facebook.com',
    'bing', 'bing places', 'indiamart', 'indiamart.com', 'yelp', 'yelp.com',
    'yellow pages', 'yellowpages', 'hotfrog', 'home', 'business listing',
    'directory', 'search', 'untitled', 'untitle', 'null', 'undefined', 'top', 'best'
  ];

  const strLower = str.toLowerCase();
  if (genericTerms.includes(strLower)) return false;

  // Must contain alphanumeric characters
  if (!/[a-z0-9]/i.test(str)) return false;

  return true;
}

/**
 * Clean title strings to extract pure business names
 */
function cleanTitleString(titleStr) {
  if (!titleStr || typeof titleStr !== 'string') return null;

  let cleaned = titleStr
    .split('|')[0]
    .split(' - ')[0]
    .replace(/\b(in|near)\b.*$/i, '')
    .replace(/justdial/gi, '')
    .replace(/sulekha/gi, '')
    .replace(/facebook/gi, '')
    .replace(/bing places/gi, '')
    .replace(/indiamart/gi, '')
    .trim();

  return isValidBusinessName(cleaned) ? cleaned : null;
}

/**
 * NAP Comparison — only runs after successful scraping.
 * isValidBusinessName is used here (NAP comparison stage).
 *
 * Verified now requires every NAP field the master record actually has data
 * for to have been BOTH extracted from the listing AND matched — a listing
 * that only yields a business name (no phone/address/website) can never be
 * "Verified"; it is, at best, "Partial Data".
 */
function compareDetails(master, scraped) {
  if (!scraped || !scraped.businessName || !isValidBusinessName(scraped.businessName)) {
    return {
      status: 'Unable to Extract',
      nameMatch: false,
      phoneMatch: false,
      addressMatch: false,
      websiteMatch: false,
      phoneExtracted: false,
      addressExtracted: false,
      websiteExtracted: false
    };
  }

  const masterNameNorm = normalizeText(master.businessName);
  const displayNameNorm = normalizeText(master.displayName || master.businessName);
  const scrapedNameNorm = normalizeText(scraped.businessName);

  const nameMatch = masterNameNorm === scrapedNameNorm ||
                    masterNameNorm.includes(scrapedNameNorm) ||
                    scrapedNameNorm.includes(masterNameNorm) ||
                    displayNameNorm === scrapedNameNorm ||
                    displayNameNorm.includes(scrapedNameNorm) ||
                    scrapedNameNorm.includes(displayNameNorm);

  const masterPhoneNorm = normalizePhone(master.phone);
  const scrapedPhoneNorm = normalizePhone(scraped.phone);
  const phoneExtracted = scrapedPhoneNorm !== '';
  const phoneMatch = masterPhoneNorm !== '' && phoneExtracted && masterPhoneNorm === scrapedPhoneNorm;

  const masterAddrNorm = normalizeText(master.address);
  const scrapedAddrNorm = normalizeText(scraped.address);
  const addressExtracted = scrapedAddrNorm !== '';
  const addressMatch = masterAddrNorm !== '' && addressExtracted && (
    masterAddrNorm === scrapedAddrNorm ||
    masterAddrNorm.includes(scrapedAddrNorm) ||
    scrapedAddrNorm.includes(masterAddrNorm)
  );

  const masterWebNorm = normalizeUrl(master.website);
  const scrapedWebNorm = normalizeUrl(scraped.website);
  const websiteExtracted = scrapedWebNorm !== '';
  const websiteMatch = masterWebNorm !== '' && websiteExtracted && masterWebNorm === scrapedWebNorm;

  let status;

  if (!nameMatch) {
    // Name was extracted but doesn't correspond to the master business.
    status = 'Mismatch';
  } else {
    // Compare fields (Phone, Address) the master record actually has values for
    const masterAvailable = {
      phone: masterPhoneNorm !== '',
      address: masterAddrNorm !== ''
    };
    const masterAvailableCount = Object.values(masterAvailable).filter(Boolean).length;

    // A field that WAS extracted but does NOT match its master counterpart is a hard mismatch.
    const hasConflict =
      (phoneExtracted && masterAvailable.phone && !phoneMatch) ||
      (addressExtracted && masterAvailable.address && !addressMatch);

    if (hasConflict) {
      status = 'Mismatch';
    } else if (masterAvailableCount === 0) {
      // Master has no phone/address to check against — name match is all we can verify.
      status = phoneExtracted || addressExtracted ? 'Verified' : 'Partial Data';
    } else {
      const matchedAvailableCount = [
        masterAvailable.phone && phoneMatch,
        masterAvailable.address && addressMatch
      ].filter(Boolean).length;

      status = matchedAvailableCount === masterAvailableCount ? 'Verified' : 'Partial Data';
    }
  }

  return {
    status,
    nameMatch,
    phoneMatch,
    addressMatch,
    websiteMatch,
    phoneExtracted,
    addressExtracted,
    websiteExtracted
  };
}

/**
 * Emit Socket.io real-time progress events
 */
function emitProgress(io, clientId, progressData) {
  if (!io) return;
  try {
    io.emit('citation_progress', { clientId, ...progressData });
  } catch (err) {
    console.warn('[Socket.io Emit Error]', err.message);
  }
}

/**
 * Fast Axios HTML + JSON-LD + OpenGraph Parser (Bypasses HTTP/2 Protocol Block)
 */
async function fetchListingHtmlData(url, expectedDetails = {}) {
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.google.com/'
      },
      timeout: 8000
    });

    const html = res.data || '';
    if (!html || typeof html !== 'string') return null;

    const $ = cheerio.load(html);

    let extractedName = null;
    let extractedPhone = null;
    let extractedAddr = null;
    let extractedWeb = null;

    // 1. JSON-LD Schema (LocalBusiness.name / Organization.name)
    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const content = $(el).html();
        if (!content) return;
        const json = JSON.parse(content);
        const items = Array.isArray(json) ? json : [json];

        for (const item of items) {
          if (!item) continue;
          const targetNode = item['@graph']
            ? item['@graph'].find(g => (g['@type'] === 'LocalBusiness' || g['@type'] === 'Organization' || g.name))
            : item;

          if (targetNode) {
            if (targetNode.name && isValidBusinessName(targetNode.name)) {
              extractedName = targetNode.name.trim();
            }
            if (targetNode.telephone) extractedPhone = String(targetNode.telephone).trim();
            if (targetNode.url && isValidBusinessWebsite(targetNode.url)) {
              extractedWeb = String(targetNode.url).trim();
            }
            // sameAs often carries the business's real external website alongside social profile links
            if (!extractedWeb && Array.isArray(targetNode.sameAs)) {
              const externalSite = targetNode.sameAs.find(link => typeof link === 'string' && isValidBusinessWebsite(link));
              if (externalSite) extractedWeb = externalSite.trim();
            }
            if (targetNode.address) {
              if (typeof targetNode.address === 'string') {
                extractedAddr = targetNode.address.trim();
              } else if (typeof targetNode.address === 'object') {
                const parts = [
                  targetNode.address.streetAddress,
                  targetNode.address.addressLocality,
                  targetNode.address.addressRegion,
                  targetNode.address.postalCode
                ].filter(Boolean);
                if (parts.length > 0) extractedAddr = parts.join(', ');
              }
            }
          }
        }
      } catch (e) {}
    });

    // 2. OpenGraph Meta Tags (og:title)
    if (!extractedName) {
      const ogTitle = $('meta[property="og:title"]').attr('content') || $('meta[name="og:title"]').attr('content');
      if (ogTitle) {
        extractedName = cleanTitleString(ogTitle);
      }
    }

    // 3. Main Business Heading (<h1> or structured title selectors)
    if (!extractedName) {
      const h1Text = $('h1').first().text().trim();
      if (isValidBusinessName(h1Text)) {
        extractedName = cleanTitleString(h1Text);
      } else {
        const selectorName = $('.fn, .heading, [itemprop="name"], .lng_bnd, .store-name, .title').first().text().trim();
        if (isValidBusinessName(selectorName)) {
          extractedName = cleanTitleString(selectorName);
        }
      }
    }

    // 4. Page Title (<title>)
    if (!extractedName) {
      const pageTitle = $('title').text();
      if (pageTitle) {
        extractedName = cleanTitleString(pageTitle);
      }
    }

    // Extract phone from explicit tel: links first — far more reliable than free-text regex
    if (!extractedPhone) {
      const telHref = $('a[href^="tel:"]').first().attr('href');
      if (telHref) extractedPhone = telHref.replace('tel:', '').trim();
    }

    // Extract phone fallback from body text
    if (!extractedPhone) {
      const bodyText = $.text();
      const m = bodyText.match(/\b[6-9]\d{9}\b|\b\d{3}[-\s]?\d{3}[-\s]?\d{4}\b/);
      if (m) extractedPhone = m[0];
    }

    // Extract website from an explicit "external site" style link Facebook/Justdial-type
    // pages expose (e.g. rel="me" or a plain external anchor), before falling back to og:description text.
    if (!extractedWeb) {
      const externalLink = $('a[rel="me"], a.website, [itemprop="url"]').filter((_, el) => {
        const href = $(el).attr('href') || '';
        return isValidBusinessWebsite(href);
      }).first().attr('href');
      if (externalLink) extractedWeb = externalLink.trim();
    }

    // Extract address fallback from og:description
    if (!extractedAddr) {
      const ogDesc = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content');
      if (ogDesc) {
        extractedAddr = ogDesc.trim();
        // Facebook-style descriptions often read "Category · +91 99449 40051" — pull phone out too.
        if (!extractedPhone) {
          const descPhoneMatch = ogDesc.match(/\b[6-9]\d{9}\b|\b\+?\d{1,3}[-\s]?\d{3,5}[-\s]?\d{3,5}\b/);
          if (descPhoneMatch) extractedPhone = descPhoneMatch[0].trim();
        }
      }
    }

    if (extractedName && isValidBusinessName(extractedName)) {
      console.log(`[Fast HTML Scraper Success for ${url}]: Business="${extractedName}", Phone="${extractedPhone || 'N/A'}"`);
      return {
        businessName: extractedName.trim(),
        phone: extractedPhone ? extractedPhone.trim() : null,
        address: extractedAddr ? extractedAddr.trim().replace(/\s+/g, ' ') : null,
        website: (extractedWeb && isValidBusinessWebsite(extractedWeb)) ? extractedWeb.trim() : null
      };
    }
  } catch (err) {
    console.warn(`[Axios Fast Scrape Warning for ${url}]:`, err.message);
  }
  return null;
}

/**
 * Single Search Architecture with Detailed Debug Mode Data Logging
 * NOTE: This function must NOT use isValidBusinessName or any NAP
 * comparison logic. It is purely for URL discovery.
 */
async function discoverListingUrlsSingleSearch(masterDetails) {
  const { clientId, clientName, businessName, displayName, phone, city } = masterDetails;
  const apiKey = process.env.VALUESERP_API_KEY;

  // Prioritize DISPLAY NAME (Internal Name e.g. "BM Academy") over long GBP Official Name
  const brandTerm = (displayName && displayName.trim())
    ? displayName.trim()
    : (businessName || '').split('-')[0].split('|')[0].trim();

  const cleanPhone = (phone || '').replace(/\D/g, '').slice(-10);
  const searchQuery = `${brandTerm} ${city || ''} ${cleanPhone || ''}`.trim();

  // ── DEBUG LOG: Stage 1 — Search Query ──────────────────────────
  console.log('====================================================');
  console.log('[CITATION DEBUG] ── STAGE 1: SEARCH QUERY ──');
  console.log(`  Raw Business Name:  "${businessName}"`);
  console.log(`  Raw Display Name:   "${displayName || 'N/A'}"`);
  console.log(`  Brand Term Used:    "${brandTerm}"`);
  console.log(`  City:               "${city || 'N/A'}"`);
  console.log(`  Phone (cleaned):    "${cleanPhone || 'N/A'}"`);
  console.log(`  Final Search Query: "${searchQuery}"`);
  console.log('====================================================');

  const discoveredMap = {};
  SUPPORTED_DIRECTORIES.forEach(dir => {
    discoveredMap[dir.name] = null;
  });

  const rawOrganicList = [];
  let requestsUsed = 0;
  const startTime = Date.now();
  let responseDataRaw = null;
  // apiStatus distinguishes "we searched and found nothing" from "we never got an answer"
  // so the per-directory loop downstream never conflates API failure with Missing Listing.
  let apiStatus = 'success';
  let apiStatusReason = null;

  if (!apiKey) {
    console.error('[CITATION DEBUG] ── STAGE 2: VALUESERP ERROR ──');
    console.error('  VALUESERP_API_KEY is missing from environment variables!');
    console.error('  Marking as API Error (not Missing Listing) — no search was ever performed.');
    console.error('====================================================');
    return {
      discoveredMap,
      requestsUsed: 0,
      searchQuery,
      apiStatus: 'error',
      apiStatusReason: 'VALUESERP_API_KEY missing',
      debugData: {
        queryDetails: { businessName, city, phone, searchQuery },
        responseSummary: { totalOrganic: 0, searchTimeMs: 0, requestsUsed: 0 },
        organicResults: [],
        detectionList: [],
        error: 'VALUESERP_API_KEY missing'
      }
    };
  }

  const MAX_ATTEMPTS = 3;
  const REQUEST_TIMEOUT_MS = 30000;

  // Retries with exponential backoff (1s, 2s, 4s) so a single slow ValueSERP
  // response doesn't get misreported as "no listing exists" for every directory.
  const fetchResults = async (num = 10) => {
    requestsUsed++;
    const thisRequestNum = requestsUsed;
    let lastErr = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const attemptStart = Date.now();
      console.log(`[CITATION DEBUG] ── STAGE 2: VALUESERP REQUEST #${thisRequestNum} (Attempt ${attempt}/${MAX_ATTEMPTS}) ──`);
      console.log(`  Request URL: https://api.valueserp.com/search?q=${encodeURIComponent(searchQuery)}&num=${num}`);
      console.log(`  (API key hidden from log)`);
      console.log(`  Request Start Time: ${new Date(attemptStart).toISOString()}`);
      console.log(`  Timeout:            ${REQUEST_TIMEOUT_MS}ms`);

      try {
        const response = await axios.get('https://api.valueserp.com/search', {
          params: {
            api_key: apiKey,
            q: searchQuery,
            num
          },
          timeout: REQUEST_TIMEOUT_MS
        });
        const attemptEnd = Date.now();
        responseDataRaw = response.data;
        const rawSize = JSON.stringify(response.data || {}).length;

        console.log(`[CITATION DEBUG] ── STAGE 3: VALUESERP RESPONSE #${thisRequestNum} (Attempt ${attempt}) ──`);
        console.log(`  Request End Time:    ${new Date(attemptEnd).toISOString()}`);
        console.log(`  Response Time:       ${attemptEnd - attemptStart}ms`);
        console.log(`  HTTP Status:         ${response.status}`);
        console.log(`  Raw Response Size:   ${rawSize} bytes`);
        console.log(`  Request Info:        ${JSON.stringify(responseDataRaw?.request_info || {})}`);
        console.log(`  Search Information:  ${JSON.stringify(responseDataRaw?.search_information || {})}`);
        console.log(`  Organic Results:     ${(responseDataRaw?.organic_results || []).length} items returned`);

        const organicResults = response.data?.organic_results || [];
        if (organicResults.length === 0) {
          apiStatus = 'no_results';
          apiStatusReason = 'ValueSERP request succeeded but returned zero organic results.';
        }
        return organicResults;
      } catch (err) {
        lastErr = err;
        const attemptEnd = Date.now();
        const isTimeout = err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '');
        console.error(`[CITATION DEBUG] ── STAGE 2/3: VALUESERP ${isTimeout ? 'TIMEOUT' : 'ERROR'} #${thisRequestNum} (Attempt ${attempt}/${MAX_ATTEMPTS}) ──`);
        console.error(`  Request End Time: ${new Date(attemptEnd).toISOString()}`);
        console.error(`  Response Time:    ${attemptEnd - attemptStart}ms`);
        console.error(`  Error:            ${err.message}`);
        console.error(`  HTTP Status:      ${err.response?.status || 'N/A'}`);

        if (attempt < MAX_ATTEMPTS) {
          const backoffMs = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
          console.warn(`  → Retrying in ${backoffMs}ms (Retry ${attempt + 1}/${MAX_ATTEMPTS})...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        } else {
          console.error(`  → All ${MAX_ATTEMPTS} attempts exhausted. Giving up on this request.`);
          apiStatus = isTimeout ? 'timeout' : 'error';
          apiStatusReason = `ValueSERP failed after ${MAX_ATTEMPTS} attempts: ${err.message}`;
        }
      }
    }

    throw lastErr;
  };

  try {
    let organic = await fetchResults(10);

    organic.forEach((item, idx) => {
      rawOrganicList.push({
        index: idx + 1,
        title: item.title || 'Untitled',
        link: item.link || '',
        snippet: item.snippet || ''
      });
    });

    // ── DEBUG LOG: Stage 4 — Raw Organic URLs ──
    console.log('[CITATION DEBUG] ── STAGE 4: RAW ORGANIC RESULTS ──');
    console.log(`  Total organic results: ${rawOrganicList.length}`);
    rawOrganicList.forEach(item => {
      console.log(`  ${item.index}. [${item.title}]`);
      console.log(`     URL: ${item.link}`);
    });
    console.log('====================================================');

    const parseOrganic = (results) => {
      results.forEach(item => {
        const link = (item.link || '').toLowerCase();
        if (!link) return;

        SUPPORTED_DIRECTORIES.forEach(dir => {
          if (!discoveredMap[dir.name]) {
            const matchesDomain = dir.domains.some(dom => link.includes(dom));
            if (matchesDomain) {
              // Exclude non-profile links — DISCOVERY FILTERS ONLY
              if (dir.name === 'Facebook' && (link.includes('/posts/') || link.includes('/videos/') || link.includes('/photos/') || link.includes('/groups/'))) {
                console.log(`  [FILTER REJECTED] Facebook URL excluded (non-profile link): ${item.link}`);
                return;
              }
              if (dir.name === 'Justdial' && (link.includes('/nct-') || link.includes('/ct-') || link.includes('/all-cities'))) {
                console.log(`  [FILTER REJECTED] Justdial URL excluded (category/city page): ${item.link}`);
                return;
              }
              if (dir.name === 'Sulekha' && (link.includes('/best-') || link.includes('/directory'))) {
                console.log(`  [FILTER REJECTED] Sulekha URL excluded (directory/listing page): ${item.link}`);
                return;
              }

              discoveredMap[dir.name] = item.link; // Always use original-case URL from ValueSERP
              console.log(`  [DETECTED] ${dir.name} → ${item.link}`);
            }
          }
        });
      });
    };

    // ── DEBUG LOG: Stage 5 — Directory Detection ──
    console.log('[CITATION DEBUG] ── STAGE 5: DIRECTORY URL DETECTION ──');
    parseOrganic(organic);

    // If missing directories, retry once with num=20
    const missingAny = SUPPORTED_DIRECTORIES.some(dir => !discoveredMap[dir.name]);
    if (missingAny && organic.length >= 10) {
      console.log('[CITATION DEBUG] Some directories missing, retrying with num=20...');
      try {
        const organic20 = await fetchResults(20);
        organic20.forEach((item, idx) => {
          if (idx >= 10) {
            rawOrganicList.push({
              index: idx + 1,
              title: item.title || 'Untitled',
              link: item.link || '',
              snippet: item.snippet || ''
            });
          }
        });
        parseOrganic(organic20);
      } catch (retryErr) {
        console.warn('[ValueSERP Retry Warning]:', retryErr.message);
      }
    } else if (missingAny) {
      console.log(`[CITATION DEBUG] Skipping retry — only ${organic.length} results returned (threshold: 10)`);
    }

    const durationMs = Date.now() - startTime;
    await logApiRequest({
      provider: 'valueserp',
      clientId,
      clientName,
      searchQuery,
      directory: 'Google Search (Single Search)',
      creditsConsumed: requestsUsed,
      responseStatus: 200,
      scanDurationMs: durationMs,
      isCached: false
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const isTimeout = err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '');
    if (apiStatus === 'success') {
      apiStatus = isTimeout ? 'timeout' : 'error';
      apiStatusReason = `ValueSERP request failed: ${err.message}`;
    }
    console.error('[CITATION DEBUG] ── VALUESERP REQUEST FAILED (ROOT CAUSE) ──');
    console.error(`  Stage of failure: STAGE 2/3 — ValueSERP Request`);
    console.error(`  Error:            ${err.message}`);
    console.error(`  HTTP Status:      ${err.response?.status || 'N/A'}`);
    console.error(`  Resolved Status:  ${apiStatus.toUpperCase()}`);
    console.error(`  Directories will be marked '${apiStatus === 'timeout' ? 'API Timeout' : 'API Error'}' — NOT Missing Listing.`);
    console.error('====================================================');
    await logApiRequest({
      provider: 'valueserp',
      clientId,
      clientName,
      searchQuery,
      directory: 'Google Search (Single Search)',
      creditsConsumed: 0,
      responseStatus: err.response?.status || 'ERROR',
      scanDurationMs: durationMs,
      isCached: false
    });
  }

  // ── DEBUG LOG: Stage 6 — Final discoveredMap ──
  console.log('[CITATION DEBUG] ── STAGE 6: FINAL DISCOVERED URLS ──');
  SUPPORTED_DIRECTORIES.forEach(dir => {
    console.log(`  ${dir.name}: ${discoveredMap[dir.name] || 'NOT FOUND'}`);
  });
  console.log('====================================================');

  // Generate complete Detection List
  // NOTE: apiStatus !== 'success' means we never got a trustworthy set of organic
  // results, so a missing directory here means "we don't know" — not "confirmed absent".
  const detectionList = SUPPORTED_DIRECTORIES.map(dir => {
    const matchedUrl = discoveredMap[dir.name];
    const rawDomainMatch = rawOrganicList.find(item => dir.domains.some(dom => (item.link || '').toLowerCase().includes(dom)));

    let status = 'Not Found';
    let reason = null;

    if (matchedUrl) {
      status = 'Detected ✓';
      reason = 'URL successfully matched directory domain and passed filter rules.';
    } else if (apiStatus === 'timeout') {
      status = 'API Timeout ⏱';
      reason = apiStatusReason || 'ValueSERP request timed out after all retry attempts.';
    } else if (apiStatus === 'error') {
      status = 'API Error ⚠';
      reason = apiStatusReason || 'ValueSERP request failed after all retry attempts.';
    } else if (apiStatus === 'no_results') {
      status = 'No Organic Results ○';
      reason = apiStatusReason || 'ValueSERP request succeeded but returned zero organic results.';
    } else if (rawDomainMatch) {
      status = 'Parser Detection Failure ⚠️';
      reason = `URL (${rawDomainMatch.link}) was found in Google search results, but was excluded by directory filter rules.`;
    } else {
      status = 'Missing Listing ✕';
      reason = 'No supported directory URLs found in Google search results.';
    }

    return {
      directory: dir.name,
      status,
      matchedUrl: matchedUrl || (rawDomainMatch ? rawDomainMatch.link : null),
      reason
    };
  });

  const debugData = {
    queryDetails: {
      businessName,
      city: city || 'N/A',
      phone: phone || 'N/A',
      searchQuery
    },
    responseSummary: {
      totalOrganic: rawOrganicList.length,
      searchTimeMs: Date.now() - startTime,
      creditsUsed: requestsUsed,
      totalResultsReturned: responseDataRaw?.search_information?.total_results || rawOrganicList.length
    },
    organicResults: rawOrganicList,
    detectionList,
    apiStatus,
    apiStatusReason,
    rawResponseSnippet: responseDataRaw ? {
      request_info: responseDataRaw.request_info,
      search_information: responseDataRaw.search_information
    } : null
  };

  console.log('[CITATION DEBUG] ── STAGE 7: DETECTION SUMMARY ──');
  console.log(`  Overall API Status: ${apiStatus.toUpperCase()}${apiStatusReason ? ` (${apiStatusReason})` : ''}`);
  detectionList.forEach(d => {
    console.log(`  ${d.directory}: ${d.status} → ${d.matchedUrl || 'None'}`);
    if (d.reason) console.log(`    Reason: ${d.reason}`);
  });
  console.log('====================================================');

  return { discoveredMap, requestsUsed, searchQuery, apiStatus, apiStatusReason, debugData };
}

/**
 * Scrape individual Directory listing with Hybrid Fast HTML + Playwright 15s Fallback
 * NOTE: isValidBusinessName is used here for scraping output only.
 * Never used in the discovery pipeline above.
 */
async function scrapeListingWithTimeout(directory, url, expectedDetails = {}) {
  if (!url) {
    return {
      businessName: null,
      phone: null,
      address: null,
      website: null,
      status: 'Missing Listing'
    };
  }

  console.log(`[CITATION DEBUG] ── SCRAPING: ${directory} ──`);
  console.log(`  URL: ${url}`);

  // Step 1: Fast Axios HTML + JSON-LD Parser (8 seconds)
  const fastData = await fetchListingHtmlData(url, expectedDetails);

  // Only trust the fast path alone when it got the name AND at least phone+address —
  // a name-only result is exactly the "Verified with nothing to back it up" bug we're fixing,
  // so it must fall through to Playwright to try to fill the missing NAP fields.
  const fastDataIsComplete = !!(fastData && fastData.businessName && fastData.phone && fastData.address);
  if (fastDataIsComplete) {
    console.log(`  [Fast HTML] SUCCESS (complete NAP) → BusinessName="${fastData.businessName}", Phone="${fastData.phone}", Address="${fastData.address}"`);
    return fastData;
  }
  if (fastData && fastData.businessName) {
    console.log(`  [Fast HTML] Partial data only (Name="${fastData.businessName}", Phone="${fastData.phone || 'N/A'}", Address="${fastData.address || 'N/A'}") — falling back to Playwright to fill gaps...`);
  } else {
    console.log(`  [Fast HTML] Could not extract valid business name, falling back to Playwright...`);
  }

  // Step 2: Playwright Headless Scraper Fallback (15 seconds)
  let browser = null;
  const attemptScrape = async (maxTimeoutMs = 15000) => {
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-http2', '--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 }
    });
    const page = await context.newPage();

    await page.route('**/*', (route) => {
      if (['image', 'font', 'media'].includes(route.request().resourceType())) {
        route.abort().catch(() => {});
      } else {
        route.continue().catch(() => {});
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: maxTimeoutMs });
    await page.waitForTimeout(1000).catch(() => {});

    let pName = null;

    // 1. JSON-LD Schema
    const jsonLdName = await page.evaluate(() => {
      try {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const s of scripts) {
          const json = JSON.parse(s.innerHTML);
          const items = Array.isArray(json) ? json : [json];
          for (const item of items) {
            const target = item['@graph']
              ? item['@graph'].find(g => (g['@type'] === 'LocalBusiness' || g['@type'] === 'Organization' || g.name))
              : item;
            if (target && target.name) return target.name;
          }
        }
      } catch (e) {}
      return null;
    }).catch(() => null);

    if (jsonLdName && isValidBusinessName(jsonLdName)) {
      pName = cleanTitleString(jsonLdName);
      console.log(`  [Playwright] JSON-LD name: "${jsonLdName}" → cleaned: "${pName}"`);
    }

    // 2. Open Graph Title
    if (!pName) {
      const ogTitle = await page.getAttribute('meta[property="og:title"]', 'content').catch(() => null);
      if (ogTitle) {
        pName = cleanTitleString(ogTitle);
        console.log(`  [Playwright] og:title: "${ogTitle}" → cleaned: "${pName}"`);
      }
    }

    // 3. Main Business Heading
    if (!pName) {
      const h1Text = await page.locator('h1, .fn, .heading, [itemprop="name"], .lng_bnd, .store-name, .title').first().textContent().catch(() => null);
      if (h1Text) {
        pName = cleanTitleString(h1Text);
        console.log(`  [Playwright] h1/heading: "${h1Text?.trim()}" → cleaned: "${pName}"`);
      }
    }

    // 4. Page Title
    if (!pName) {
      const pageTitle = await page.title().catch(() => null);
      if (pageTitle) {
        pName = cleanTitleString(pageTitle);
        console.log(`  [Playwright] <title>: "${pageTitle}" → cleaned: "${pName}"`);
      }
    }

    // Phone: prefer explicit tel: links over free-text regex
    let pPhone = await page.getAttribute('a[href^="tel:"]', 'href').catch(() => null);
    if (pPhone) pPhone = pPhone.replace('tel:', '').trim();
    if (!pPhone) {
      pPhone = await page.evaluate(() => {
        const txt = document.body.innerText || '';
        const m = txt.match(/\b[6-9]\d{9}\b|\b\d{3}[-\s]?\d{3}[-\s]?\d{4}\b/);
        return m ? m[0] : null;
      }).catch(() => null);
    }

    let aAddr = await page.locator('[itemprop="address"], [class*="address" i]').first().textContent().catch(() => null);

    // Website: first explicit external link/rel="me", else og:url/JSON-LD sameAs already handled by fast pass
    let pWeb = await page.evaluate((denylist) => {
      const links = Array.from(document.querySelectorAll('a[rel="me"], a.website, [itemprop="url"]'));
      for (const a of links) {
        const href = a.getAttribute('href') || '';
        if (/^https?:\/\//i.test(href) && !denylist.some(host => href.toLowerCase().includes(host))) {
          return href;
        }
      }
      return null;
    }, DIRECTORY_HOST_DENYLIST).catch(() => null);

    if (pName && isValidBusinessName(pName)) {
      const validWeb = (pWeb && isValidBusinessWebsite(pWeb)) ? pWeb.trim() : null;
      console.log(`  [Playwright] SUCCESS → BusinessName="${pName}", Phone="${pPhone || 'N/A'}", Address="${aAddr ? 'found' : 'N/A'}", Website="${validWeb || 'N/A'}"`);
      return {
        businessName: pName.trim(),
        phone: pPhone ? pPhone.trim() : null,
        address: aAddr ? aAddr.trim().replace(/\s+/g, ' ') : null,
        website: validWeb
      };
    }

    console.log(`  [Playwright] Could not extract valid business name. Returning Unable to Extract.`);
    return {
      businessName: null,
      phone: pPhone ? pPhone.trim() : null,
      address: aAddr ? aAddr.trim().replace(/\s+/g, ' ') : null,
      website: pWeb ? pWeb.trim() : null,
      status: 'Unable to Extract'
    };
  };

  // Merge fast-HTML and Playwright results, taking whichever source found each field
  // (fast HTML first since it's cheaper/faster and JSON-LD-sourced data tends to be cleaner).
  const mergeResults = (fast, pw) => {
    if (!pw) return fast;
    return {
      businessName: (fast && fast.businessName) || pw.businessName || null,
      phone: (fast && fast.phone) || pw.phone || null,
      address: (fast && fast.address) || pw.address || null,
      website: (fast && fast.website) || pw.website || null,
      status: pw.status // 'Unable to Extract' only if Playwright itself found no name
    };
  };

  try {
    const pwData = await attemptScrape(15000);
    const merged = mergeResults(fastData, pwData);

    // A name was found by one of the two passes — that's a usable result, not "Unable to Extract",
    // even if the Playwright pass alone couldn't find a name.
    if (merged.businessName && isValidBusinessName(merged.businessName)) {
      delete merged.status;
      console.log(`  [Merged Result] BusinessName="${merged.businessName}", Phone="${merged.phone || 'N/A'}", Address="${merged.address || 'N/A'}", Website="${merged.website || 'N/A'}"`);
      return merged;
    }
    return merged;
  } catch (firstErr) {
    console.warn(`  [Playwright] SCRAPE FAILED for ${directory}: ${firstErr.message}`);
    // Playwright failed outright — fall back to whatever the fast pass found, if anything.
    if (fastData && fastData.businessName && isValidBusinessName(fastData.businessName)) {
      console.log(`  [Fallback] Using partial Fast HTML data after Playwright failure.`);
      return fastData;
    }
    return {
      businessName: null,
      phone: null,
      address: null,
      website: null,
      status: 'Unable to Extract'
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ── MAIN ORCHESTRATION ─────────────────────────────────────
async function runCheckForBusiness(businessId, forceRefresh = false, io = null) {
  const startTime = Date.now();
  console.log('====================================================');
  console.log('[CITATION DEBUG] ── ORCHESTRATION START ──');
  console.log(`  Business ID:    ${businessId}`);
  console.log(`  Force Refresh:  ${forceRefresh}`);
  console.log(`  Timestamp:      ${new Date().toISOString()}`);
  console.log('====================================================');

  emitProgress(io, businessId, {
    progress: 10,
    step: 'Loading Client Details',
    directoriesProcessed: 0,
    totalDirectories: SUPPORTED_DIRECTORIES.length,
    currentDirectory: 'Client Info',
    directoryStatuses: SUPPORTED_DIRECTORIES.map(d => ({ name: d.name, status: 'Pending', type: 'Pending' }))
  });

  const clientRes = await pool.query('SELECT * FROM mafiya_gmb_clients WHERE id = $1', [businessId]);
  if (clientRes.rowCount === 0) {
    throw new Error('Business client not found');
  }
  const client = clientRes.rows[0];

  const businessName = client.business_name;
  const phone = client.phone_number;
  const website = client.website_url;
  const city = client.city || 'Pondicherry';
  const category = client.custom_category || client.business_category || 'Business';
  const address = client.business_address || client.address || 'Pondicherry';

  console.log('[CITATION DEBUG] ── CLIENT DATA LOADED ──');
  console.log(`  business_name:    "${businessName}"`);
  console.log(`  display_name:     "${client.display_name || 'N/A'}"`);
  console.log(`  phone_number:     "${phone || 'N/A'}"`);
  console.log(`  website_url:      "${website || 'N/A'}"`);
  console.log(`  city:             "${city}"`);
  console.log(`  business_address: "${address}"`);
  console.log('====================================================');

  const masterDetails = {
    clientId: businessId,
    clientName: client.contact_person || client.display_name || businessName,
    businessName,
    displayName: client.display_name,
    phone,
    website,
    address,
    city,
    category
  };

  emitProgress(io, businessId, {
    progress: 25,
    step: 'Preparing Master NAP',
    directoriesProcessed: 0,
    totalDirectories: SUPPORTED_DIRECTORIES.length,
    currentDirectory: 'NAP Assembly'
  });

  // ── FIX: Cache HIT condition — only count rows with a real listing_url ──
  // Rows with listing_url = NULL are Missing Listing entries that should
  // NOT block a fresh search from running.
  const cacheRes = await pool.query(`
    SELECT * FROM client_directory_cache
    WHERE client_id = $1 AND updated_at >= NOW() - INTERVAL '7 days'
  `, [businessId]);

  const cacheRowsWithUrl = cacheRes.rows.filter(r => r.listing_url && r.listing_url.trim() !== '');
  const cacheMissingRows = cacheRes.rows.filter(r => !r.listing_url || r.listing_url.trim() === '');

  console.log('[CITATION DEBUG] ── CACHE LOOKUP ──');
  console.log(`  Total cache rows for this client: ${cacheRes.rowCount}`);
  console.log(`  Rows WITH listing_url:            ${cacheRowsWithUrl.length}`);
  console.log(`  Rows WITHOUT listing_url (null):  ${cacheMissingRows.length}`);
  console.log(`  Required directories:             ${SUPPORTED_DIRECTORIES.length}`);

  let cacheUsed = false;
  let cacheAge = null;
  let discoveredMap = {};
  let requestsUsed = 0;
  let searchQuery = `${client.display_name || businessName} ${city} ${phone}`;
  let debugData = null;
  // 'success' when cache is used, since a cached URL means a prior search already succeeded.
  let apiStatus = 'success';
  let apiStatusReason = null;

  // ── FIX: Cache HIT only if ALL directories have real URLs in cache ──
  // Previously: used total rowCount (includes null-url rows → false cache hit → all Missing)
  // Fixed: require cacheRowsWithUrl.length === SUPPORTED_DIRECTORIES.length
  if (!forceRefresh && cacheRowsWithUrl.length >= SUPPORTED_DIRECTORIES.length) {
    console.log(`  → CACHE HIT (${cacheRowsWithUrl.length} valid directory URLs found in cache)`);
    console.log('====================================================');
    cacheUsed = true;
    const latestDate = new Date(Math.max(...cacheRes.rows.map(r => new Date(r.updated_at))));
    const diffDays = Math.max(0, Math.floor((Date.now() - latestDate.getTime()) / (1000 * 60 * 60 * 24)));
    cacheAge = diffDays === 0 ? 'Today' : `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

    // Populate discoveredMap from cache — only non-null URLs
    cacheRes.rows.forEach(r => {
      discoveredMap[r.directory] = r.listing_url || null;
    });

    console.log('[CITATION DEBUG] ── CACHE MAP (from DB) ──');
    SUPPORTED_DIRECTORIES.forEach(dir => {
      console.log(`  ${dir.name}: ${discoveredMap[dir.name] || 'NULL (will show Missing Listing)'}`);
    });
    console.log('====================================================');

    debugData = {
      queryDetails: { businessName, city, phone, searchQuery },
      responseSummary: { totalOrganic: cacheRes.rowCount, searchTimeMs: 0, creditsUsed: 0 },
      organicResults: cacheRes.rows.map((r, i) => ({ index: i + 1, title: r.directory, link: r.listing_url || 'N/A' })),
      detectionList: SUPPORTED_DIRECTORIES.map(d => ({
        directory: d.name,
        status: discoveredMap[d.name] ? 'Detected (Cached) ✓' : 'Missing (Cached) ✕',
        matchedUrl: discoveredMap[d.name]
      }))
    };

    emitProgress(io, businessId, {
      progress: 40,
      step: `Loaded 7-Day Cache (${cacheAge})`,
      directoriesProcessed: 0,
      totalDirectories: SUPPORTED_DIRECTORIES.length,
      debugData
    });
  } else {
    if (forceRefresh) {
      console.log(`  → CACHE BYPASSED (Force Refresh requested)`);
    } else {
      console.log(`  → CACHE MISS (only ${cacheRowsWithUrl.length}/${SUPPORTED_DIRECTORIES.length} directories have cached URLs)`);
    }
    console.log('====================================================');

    emitProgress(io, businessId, {
      progress: 35,
      step: 'Searching Google (1 API Request)',
      directoriesProcessed: 0,
      totalDirectories: SUPPORTED_DIRECTORIES.length
    });

    const singleSearchResult = await discoverListingUrlsSingleSearch(masterDetails);
    discoveredMap = singleSearchResult.discoveredMap;
    requestsUsed = singleSearchResult.requestsUsed;
    searchQuery = singleSearchResult.searchQuery;
    debugData = singleSearchResult.debugData;
    apiStatus = singleSearchResult.apiStatus || 'success';
    apiStatusReason = singleSearchResult.apiStatusReason || null;

    if (apiStatus !== 'success') {
      console.error('[CITATION DEBUG] ── ROOT CAUSE: PIPELINE STOPPED AT STAGE 2/3 (VALUESERP REQUEST) ──');
      console.error(`  apiStatus: ${apiStatus.toUpperCase()}`);
      console.error(`  Reason:    ${apiStatusReason}`);
      console.error(`  Directory URL detection could not run — all directories will be reported`);
      console.error(`  as '${apiStatus === 'timeout' ? 'API Timeout' : apiStatus === 'error' ? 'API Error' : 'No Organic Results'}', NOT 'Missing Listing'.`);
      console.error('====================================================');
    }

    emitProgress(io, businessId, {
      progress: 45,
      step: 'Parsing Search Results',
      directoriesProcessed: 0,
      totalDirectories: SUPPORTED_DIRECTORIES.length,
      debugData
    });
  }

  const scanInsertRes = await pool.query(
    `INSERT INTO citation_scans ("businessId", score, "totalDirectories", matched, mismatched, missing)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [businessId, 0, SUPPORTED_DIRECTORIES.length, 0, 0, 0]
  );
  const scanId = scanInsertRes.rows[0].id;

  let verifiedCount = 0;
  let mismatchCount = 0;
  let missingCount = 0;
  let unableToExtractCount = 0;
  let apiTimeoutCount = 0;
  let apiErrorCount = 0;
  let noResultsCount = 0;
  let partialDataCount = 0;

  const results = [];
  const directoryStatuses = [];
  const totalDirs = SUPPORTED_DIRECTORIES.length;
  let processedCount = 0;

  console.log('[CITATION DEBUG] ── STAGE 8: PER-DIRECTORY PROCESSING ──');

  for (let i = 0; i < totalDirs; i++) {
    const dir = SUPPORTED_DIRECTORIES[i];
    const listingUrl = discoveredMap[dir.name] || null;

    processedCount = i + 1;
    const stepPct = Math.round(45 + (processedCount / totalDirs) * 45);

    console.log(`\n  [${dir.name}]`);
    console.log(`    listingUrl:    ${listingUrl || 'null'}`);
    console.log(`    cacheUsed:     ${cacheUsed}`);

    emitProgress(io, businessId, {
      progress: stepPct,
      step: `${dir.name} Processing`,
      directoriesProcessed: processedCount,
      totalDirectories: totalDirs,
      currentDirectory: dir.name,
      directoryStatuses,
      debugData
    });

    let finalStatus = 'Missing Listing';
    let scraped = null;

    if (!listingUrl) {
      // ── No URL found. Only call this "Missing Listing" if the ValueSERP
      // request actually succeeded and searched — otherwise we never looked,
      // so report the real reason instead of a false negative. ──
      if (apiStatus === 'timeout') {
        finalStatus = 'API Timeout';
        apiTimeoutCount++;
        console.log(`    → Status: API Timeout (ValueSERP request timed out — never searched)`);
      } else if (apiStatus === 'error') {
        finalStatus = 'API Error';
        apiErrorCount++;
        console.log(`    → Status: API Error (ValueSERP request failed — never searched)`);
      } else if (apiStatus === 'no_results') {
        finalStatus = 'No Organic Results';
        noResultsCount++;
        console.log(`    → Status: No Organic Results (search ran but Google returned nothing)`);
      } else {
        finalStatus = 'Missing Listing';
        missingCount++;
        console.log(`    → Status: Missing Listing (search succeeded, no URL available)`);
      }
    } else if (cacheUsed) {
      // ── Cache path: re-derive status from cached NAP via compareDetails ──
      const cachedItem = cacheRes.rows.find(r => r.directory === dir.name);
      const cachedStatus = cachedItem ? (cachedItem.status || 'Verified') : 'Verified';
      
      scraped = {
        businessName: cachedItem?.business_name || null,
        phone: cachedItem?.phone || null,
        address: cachedItem?.address || null,
        website: cachedItem?.website || null
      };

      if (cachedStatus === 'Missing Listing') {
        finalStatus = 'Missing Listing';
        missingCount++;
      } else if (cachedStatus === 'Unable to Extract') {
        finalStatus = 'Unable to Extract';
        unableToExtractCount++;
      } else {
        // Re-run compareDetails with cached NAP to get the correct status
        if (!scraped.businessName) {
          finalStatus = 'Unable to Extract';
          unableToExtractCount++;
        } else {
          const comp = compareDetails(masterDetails, scraped);
          finalStatus = comp.status;
          if (finalStatus === 'Verified') verifiedCount++;
          else if (finalStatus === 'Mismatch') mismatchCount++;
          else if (finalStatus === 'Unable to Extract') unableToExtractCount++;
          else if (finalStatus === 'Partial Data') partialDataCount++;
          else missingCount++;
        }
      }

      console.log(`    → Status (re-derived from cached NAP): ${finalStatus}`);
      console.log(`    → Cached NAP: name="${scraped.businessName || 'N/A'}", phone="${scraped.phone || 'N/A'}", address="${scraped.address || 'N/A'}"`);
    } else {
      // ── Live scrape path ──
      scraped = await scrapeListingWithTimeout(dir.name, listingUrl, masterDetails);

      console.log(`    [Scrape Result]`);
      console.log(`      businessName: "${scraped?.businessName || 'null'}"`);
      console.log(`      phone:        "${scraped?.phone || 'null'}"`);
      console.log(`      address:      "${scraped?.address || 'null'}"`);
      console.log(`      status flag:  "${scraped?.status || 'none'}"`);

      // ── FIX: Restore explicit status check from scraper ──
      // Previously this was changed to: !scraped || !scraped.businessName || !isValidBusinessName(...)
      // That was wrong — it incorrectly classified Missing Listing as Unable to Extract
      // and bypassed compareDetails for scraped results that had phone/address but no name.
      // The correct check is: use the explicit status returned by the scraper,
      // then let compareDetails do the NAP validation (it has its own isValidBusinessName guard).
      if (scraped?.status === 'Unable to Extract') {
        finalStatus = 'Unable to Extract';
        unableToExtractCount++;
        console.log(`    → Status: Unable to Extract (scraper returned explicit Unable to Extract)`);
      } else {
        // compareDetails will internally check isValidBusinessName and return Unable to Extract if needed
        const comp = compareDetails(masterDetails, scraped);
        finalStatus = comp.status;
        console.log(`    [compareDetails Result]`);
        console.log(`      nameMatch:    ${comp.nameMatch}`);
        console.log(`      phoneMatch:   ${comp.phoneMatch}`);
        console.log(`      addressMatch: ${comp.addressMatch}`);
        console.log(`      websiteMatch: ${comp.websiteMatch}`);
        console.log(`      phoneExtracted:   ${comp.phoneExtracted}`);
        console.log(`      addressExtracted: ${comp.addressExtracted}`);
        console.log(`      websiteExtracted: ${comp.websiteExtracted}`);
        console.log(`    → Status: ${finalStatus}`);
        if (finalStatus === 'Verified') verifiedCount++;
        else if (finalStatus === 'Mismatch') mismatchCount++;
        else if (finalStatus === 'Unable to Extract') unableToExtractCount++;
        else if (finalStatus === 'Partial Data') partialDataCount++;
        else missingCount++;
      }

      // Upsert into client_directory_cache (only for live scrapes with real URLs)
      const cacheBName = (scraped && isValidBusinessName(scraped.businessName)) ? scraped.businessName : null;
      await pool.query(`
        INSERT INTO client_directory_cache
          (client_id, directory, listing_url, business_name, address, phone, website, status, last_scraped_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        ON CONFLICT (client_id, directory) DO UPDATE SET
          listing_url = EXCLUDED.listing_url,
          business_name = EXCLUDED.business_name,
          address = EXCLUDED.address,
          phone = EXCLUDED.phone,
          website = EXCLUDED.website,
          status = EXCLUDED.status,
          last_scraped_at = NOW(),
          updated_at = NOW()
      `, [businessId, dir.name, listingUrl, cacheBName, scraped?.address || null, scraped?.phone || null, scraped?.website || null, finalStatus]);

      console.log(`    → Cached: listing_url="${listingUrl}", status="${finalStatus}"`);
    }

    const bName = (scraped && isValidBusinessName(scraped.businessName)) ? scraped.businessName : null;
    const pPhone = scraped?.phone || null;
    const aAddr = scraped?.address || null;
    const wWeb = scraped?.website || null;

    const resultRes = await pool.query(
      `INSERT INTO citation_results (
        "scanId", directory, "listingUrl", "businessName", phone, address, website, status, confidence
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [scanId, dir.name, listingUrl, bName, pPhone, aAddr, wWeb, finalStatus, 100]
    );

    results.push(resultRes.rows[0]);
    directoryStatuses.push({
      name: dir.name,
      status: finalStatus,
      type: finalStatus
    });

    emitProgress(io, businessId, {
      progress: stepPct,
      step: `${dir.name} ${finalStatus}`,
      directoriesProcessed: processedCount,
      totalDirectories: totalDirs,
      currentDirectory: dir.name,
      directoryStatuses,
      debugData
    });
  }

  console.log('\n[CITATION DEBUG] ── STAGE 9: FINAL SUMMARY ──');
  console.log(`  API Status:        ${apiStatus.toUpperCase()}${apiStatusReason ? ` (${apiStatusReason})` : ''}`);
  console.log(`  Verified:          ${verifiedCount}`);
  console.log(`  Mismatch:          ${mismatchCount}`);
  console.log(`  Missing Listing:   ${missingCount}`);
  console.log(`  Unable to Extract: ${unableToExtractCount}`);
  console.log(`  Partial Data:      ${partialDataCount}`);
  console.log(`  API Timeout:       ${apiTimeoutCount}`);
  console.log(`  API Error:         ${apiErrorCount}`);
  console.log(`  No Organic Results:${noResultsCount}`);
  console.log('====================================================');

  emitProgress(io, businessId, {
    progress: 92,
    step: 'Comparing NAP Data',
    directoriesProcessed: totalDirs,
    totalDirectories: totalDirs,
    debugData
  });

  const score = calculateScore(verifiedCount, totalDirs);

  const scanUpdateRes = await pool.query(
    `UPDATE citation_scans
     SET score = $1, matched = $2, mismatched = $3, missing = $4, "debugData" = $5
     WHERE id = $6 RETURNING *`,
    [score, verifiedCount, mismatchCount, missingCount, debugData || null, scanId]
  );

  const totalScanTimeSeconds = parseFloat(((Date.now() - startTime) / 1000).toFixed(1));

  const summary = {
    totalDirs,
    directoriesFound: Object.values(discoveredMap).filter(Boolean).length,
    directoriesScanned: Object.values(discoveredMap).filter(Boolean).length,
    verifiedCount,
    mismatchCount,
    missingCount,
    unableToExtractCount,
    partialDataCount,
    apiTimeoutCount,
    apiErrorCount,
    noResultsCount,
    apiStatus,
    apiStatusReason,
    citationScore: score,
    requestsUsed: cacheUsed ? 0 : requestsUsed,
    creditsConsumed: cacheUsed ? 0 : requestsUsed,
    cacheUsed,
    cacheAge,
    totalScanTimeSeconds
  };

  emitProgress(io, businessId, {
    progress: 100,
    step: 'Citation Audit Completed',
    directoriesProcessed: totalDirs,
    totalDirectories: totalDirs,
    directoryStatuses,
    summary,
    debugData
  });

  return {
    scan: scanUpdateRes.rows[0],
    results,
    summary,
    debugData
  };
}

module.exports = { runCheckForBusiness };
