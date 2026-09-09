/* eslint-env node */
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST || 'localhost',
  port:     process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'leados_db',
  user:     process.env.DB_USER || 'leados_user',
  password: process.env.DB_PASS || 'LeadOS_DB@2026',
});

const ensureTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS competitor_spy_history (
      id SERIAL PRIMARY KEY,
      query VARCHAR(255) NOT NULL,
      location VARCHAR(255),
      results_json JSONB,
      scanned_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Scans were never tied to a client — every consumer (like the Monthly
  // Report) had to guess relevance by string-matching the client's domain
  // or business name against the free-text search query, which missed any
  // scan phrased differently. Nullable so older, pre-existing rows stay valid.
  await pool.query(`ALTER TABLE competitor_spy_history ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES thedal_clients(id) ON DELETE CASCADE`);
};
ensureTable().catch(console.error);

/// Helper to generate mock local search competitors for testing/sandbox
function generateMockCompetitors(keyword, location, clientGmbName, safeCount, t) {
  const categories = ['Dental Clinic', 'Dentist', 'Cosmetic Dentist', 'Orthodontist', 'Dental Office'];
  const baseNames = ['Apex', 'Smile Care', 'Family Dental', 'Bright Smile', 'Elite Dentistry', 'Metro Dental', 'Modern Dental', 'Pearl Dental', 'Gentle Dental', 'Valley Dentistry'];
  
  const competitors = [];
  for (let idx = 0; idx < safeCount; idx++) {
    const isClient = clientGmbName && idx === 3; // Put GMB client at index 3
    const name = isClient ? clientGmbName : `${baseNames[idx % baseNames.length]} - ${location}`;
    const rating = parseFloat((4.0 + Math.random() * 1.0).toFixed(1));
    const reviews = Math.floor(Math.random() * 450) + 12;
    const category = categories[idx % categories.length];
    const phone = `+91 98765 ${Math.floor(10000 + Math.random() * 90000)}`;
    const address = `${Math.floor(idx * 15 + 12)} Tech Plaza, Sector ${Math.floor(idx * 2 + 1)}, ${location}`;
    const website = isClient ? null : `https://www.${name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
    const thumbnail = `https://images.unsplash.com/photo-1598256989800-fe5f95da9787?w=120&h=120&fit=crop`;
    const placeId = `place-mock-${idx}`;
    const hours = 'Open 24 hours';

    let score = 0;
    if (rating >= t.ratingExcellent) score += 30;
    else if (rating >= t.ratingGood) score += 20;
    else if (rating >= t.ratingFair) score += 10;
    if (reviews >= t.reviewsMassive) score += 30;
    else if (reviews >= t.reviewsHigh) score += 25;
    else if (reviews >= t.reviewsGood) score += 20;
    else if (reviews >= t.reviewsFair) score += 15;
    else if (reviews >= t.reviewsLow) score += 8;
    else score += 3;
    score += 10; // Hours
    if (website) score += 10;
    if (phone) score += 10;
    score += 5; // Thumbnail
    score += 5; // Type

    const resolved = { title: name, rating, reviews, website, phone, thumbnail, hours, address, place_id: placeId, type: category };

    competitors.push({
      rank: idx + 1,
      name,
      placeId,
      rating,
      reviews,
      category,
      address,
      phone,
      website,
      thumbnail,
      hours,
      isOpen: true,
      gmbScore: Math.min(100, score),
      mapsUrl: `https://www.google.com/maps/place/?q=place_id:${placeId}`,
      isClient,
      strengths: buildStrengths(rating, reviews, resolved, t),
      weaknesses: buildWeaknesses(rating, reviews, resolved, t),
    });
  }

  return competitors;
}

// ── POST /scan ─────────────────────────────────────────────────────────────

router.post('/scan', async (req, res) => {
  const {
    keyword,
    location,
    clientGmbName,
    clientId    = null,
    language    = 'en',
    resultCount = 20,
  } = req.body;

  const t = {
    ratingExcellent:  4.5,
    ratingGood:       4.0,
    ratingFair:       3.5,
    reviewsMassive:   500,
    reviewsHigh:      200,
    reviewsGood:      100,
    reviewsFair:      50,
    reviewsLow:       20,
    weakRatingBelow:  4.0,
    weakReviewsBelow: 50,
    ...(req.body.thresholds || {}),
  };

  if (!keyword || !location) {
    return res.status(400).json({ error: 'keyword and location are required.' });
  }

  const safeCount = Math.min(Math.max(parseInt(resultCount) || 20, 5), 40);
  const SERP_API_KEY = process.env.VALUESERP_API_KEY || process.env.SERP_RADAR_API_KEY || process.env.SERP_API_KEY || process.env.SERPKEY;
  const isDemoMode = req.headers['x-data-mode'] === 'demo' || !SERP_API_KEY;

  if (isDemoMode) {
    const competitors = generateMockCompetitors(keyword, location, clientGmbName, safeCount, t);
    const clientEntry = competitors.find(c => c.isClient);
    const clientPosition = clientEntry ? clientEntry.rank : null;

    pool.query(
      `INSERT INTO competitor_spy_history (query, location, results_json, client_id, scanned_at) VALUES ($1, $2, $3, $4, NOW())`,
      [keyword, location, JSON.stringify(competitors), clientId]
    ).catch(e => console.error('History save error:', e.message));

    return res.json({
      keyword, location, language,
      resultCount: safeCount,
      thresholds: t,
      competitors,
      clientPosition,
      scanned_at: new Date().toISOString(),
      total: competitors.length,
    });
  }

  try {
    const response = await axios.get('https://api.valueserp.com/search', {
      params: {
        engine:   'google_local',
        q:        keyword,
        location: location,
        api_key:  SERP_API_KEY,
        hl:       language,
        num:      safeCount,
      },
      timeout: 30000,
    });

    const raw        = response.data;
    const mapResults = raw.local_results || [];

    if (mapResults.length === 0) {
      return res.json({
        keyword, location, competitors: [],
        clientPosition: null,
        scanned_at: new Date().toISOString(),
        thresholds: t,
        message: 'No local business results found for this keyword and location.',
      });
    }

    const competitors = mapResults.slice(0, safeCount).map((place, idx) => {
      const rating  = parseFloat(place.rating) || 0;
      const reviews = parseInt(place.reviews)  || 0;
      const website = place.links?.website || place.website || null;
      const phone   = place.phone
        || place.extensions?.find(e => /^[+0-9][\d\s\-().]{6,}$/.test(e))
        || null;
      const thumbnail = place.thumbnail || null;

      let score = 0;
      if      (rating >= t.ratingExcellent) score += 30;
      else if (rating >= t.ratingGood)      score += 20;
      else if (rating >= t.ratingFair)      score += 10;
      if      (reviews >= t.reviewsMassive) score += 30;
      else if (reviews >= t.reviewsHigh)    score += 25;
      else if (reviews >= t.reviewsGood)    score += 20;
      else if (reviews >= t.reviewsFair)    score += 15;
      else if (reviews >= t.reviewsLow)     score += 8;
      else                                  score += 3;
      if (place.hours) score += 10;
      if (website)     score += 10;
      if (phone)       score += 10;
      if (thumbnail)   score += 5;
      if (place.type)  score += 5;

      const isClient = clientGmbName
        ? place.title?.toLowerCase().includes(clientGmbName.toLowerCase())
        : false;
      const resolved = { ...place, website, phone, thumbnail };

      return {
        rank:      idx + 1,
        name:      place.title   || 'Unknown',
        placeId:   place.place_id ? String(place.place_id) : null,
        rating,
        reviews,
        category:  place.type    || 'N/A',
        address:   place.address || 'N/A',
        phone,
        website,
        thumbnail,
        hours:     place.hours || null,
        isOpen:    place.hours
          ? (place.hours.toLowerCase().includes('open') || place.hours.toLowerCase().includes('closes'))
          : null,
        gmbScore:  Math.min(100, score),
        mapsUrl:   place.place_id
          ? `https://www.google.com/maps/place/?q=place_id:${place.place_id}`
          : place.links?.directions || null,
        isClient,
        strengths:  buildStrengths(rating, reviews, resolved, t),
        weaknesses: buildWeaknesses(rating, reviews, resolved, t),
      };
    });

    const clientEntry    = competitors.find(c => c.isClient);
    const clientPosition = clientEntry ? clientEntry.rank : null;

    pool.query(
      `INSERT INTO competitor_spy_history (query, location, results_json, client_id, scanned_at) VALUES ($1, $2, $3, $4, NOW())`,
      [keyword, location, JSON.stringify(competitors), clientId]
    ).catch(e => console.error('History save error:', e.message));

    return res.json({
      keyword, location, language,
      resultCount: safeCount,
      thresholds: t,
      competitors,
      clientPosition,
      scanned_at: new Date().toISOString(),
      total: competitors.length,
    });

  } catch (err) {
    console.error('Competitor Spy error:', err.response?.data || err.message);
    return res.status(500).json({ error: err.response?.data?.error || err.message || 'Failed to fetch GMB data.' });
  }
});

// ── GET /history ────────────────────────────────────────────────────────────

router.get('/history', async (req, res) => {
  const { clientId } = req.query;
  try {
    const { rows } = clientId
      ? await pool.query(
          `SELECT id, query, location, scanned_at FROM competitor_spy_history WHERE client_id = $1 ORDER BY scanned_at DESC LIMIT 20`,
          [clientId]
        )
      : await pool.query(
          `SELECT id, query, location, scanned_at FROM competitor_spy_history ORDER BY scanned_at DESC LIMIT 20`
        );
    return res.json({ history: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildStrengths(rating, reviews, place, t) {
  const s = [];
  if      (rating >= t.ratingExcellent) s.push(`Excellent rating (${rating}/5)`);
  else if (rating >= t.ratingGood)      s.push(`Good rating (${rating}/5)`);
  if      (reviews >= t.reviewsMassive) s.push(`Massive review count (${reviews.toLocaleString()})`);
  else if (reviews >= t.reviewsHigh)    s.push(`High review count (${reviews.toLocaleString()})`);
  else if (reviews >= t.reviewsFair)    s.push(`Decent review count (${reviews})`);
  if (place.website)   s.push('Website linked to GMB');
  if (place.phone)     s.push('Phone number listed');
  if (place.hours)     s.push('Business hours set');
  if (place.thumbnail) s.push('Photos on listing');
  if (s.length === 0)  s.push('Active GMB listing');
  return s;
}

function buildWeaknesses(rating, reviews, place, t) {
  const w = [];
  if      (rating > 0 && rating < t.weakRatingBelow)   w.push(`Low rating (${rating}/5) — needs reputation work`);
  else if (rating >= t.weakRatingBelow && rating < t.ratingExcellent) w.push(`Rating improvable (${rating}/5) — aim for ${t.ratingExcellent}+`);
  if      (reviews < t.reviewsLow)       w.push(`Very few reviews (<${t.reviewsLow}) — easy to outrank`);
  else if (reviews < t.weakReviewsBelow) w.push(`Low review count (<${t.weakReviewsBelow}) — room to grow`);
  if (!place.website) w.push('No website linked on GMB');
  if (!place.phone)   w.push('No phone number on listing');
  if (!place.hours)   w.push('Business hours not set');
  // NOTE: NOT checking photos — SerpAPI google_local can't confirm absence of photos
  return w;
}

// ── GET /place-details ───────────────────────────────────────────────────────
//
// Fetches real business photos + reviews for a specific competitor.
//
// KEY INSIGHT: google_maps type:place (data_cid) returns business info but
// NEVER includes photos. We fetch photos separately via google_images in
// parallel. Both calls run simultaneously via Promise.all.

router.get('/place-details', async (req, res) => {
  const { placeId, name, location } = req.query;
  if (!placeId && !name) {
    return res.status(400).json({ error: 'placeId or name is required.' });
  }

  const SERP_API_KEY = process.env.VALUESERP_API_KEY || process.env.SERP_RADAR_API_KEY || process.env.SERP_API_KEY || process.env.SERPKEY;
  const isDemoMode = req.headers['x-data-mode'] === 'demo' || !SERP_API_KEY;

  if (isDemoMode) {
    return res.json({
      placeId,
      name: name || 'Mock Business',
      rating: 4.6,
      reviews_count: 142,
      address: '102 Tech Plaza, Sector 4, Pondicherry',
      phone: '+91 98765 12345',
      website: 'https://example.com',
      category: 'Dentist',
      photos: [
        { url: 'https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=800', thumbnail: 'https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=200', title: 'Clinic Front', source: 'Google Maps' },
        { url: 'https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?w=800', thumbnail: 'https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?w=200', title: 'Treatment Room', source: 'Google Maps' },
        { url: 'https://images.unsplash.com/photo-1598256989800-fe5f95da9787?w=800', thumbnail: 'https://images.unsplash.com/photo-1598256989800-fe5f95da9787?w=200', title: 'Lobby', source: 'Google Maps' }
      ],
      reviews: [
        { author: 'Jane Smith', rating: 5, text: 'Clean and professional environment. High GMB standards!', date: 'Just now', avatar: null },
        { author: 'Vikram Singh', rating: 4, text: 'Friendly staff and quick appointment scheduling.', date: 'Yesterday', avatar: null },
        { author: 'Sarah Connor', rating: 5, text: 'Best local service in Pondicherry. Will visit again.', date: '3 days ago', avatar: null }
      ],
      hoursTable: null,
      services: ['Dentist', 'Orthodontist', 'Implants']
    });
  }

  try {
    // Build the image search query — quoted business name for precision
    const photoQuery = location ? `"${name}" ${location}` : `"${name}"`;

    // Run business-detail fetch and photo fetch in parallel
    const [detailRes, imageRes] = await Promise.all([
      // Strategy A: google_maps type:place with data_cid (decimal CID)
      placeId
        ? axios.get('https://api.valueserp.com/search', {
            params: {
              engine:   'google_maps',
              type:     'place',
              data_cid: placeId,   // decimal CID from google_local — e.g. "3888441939919475202"
              api_key:  SERP_API_KEY,
              hl:       'en',
            },
            timeout: 30000,
          }).catch(() => null)
        : Promise.resolve(null),

      // Strategy B: google_images for real business photos
      axios.get('https://api.valueserp.com/search', {
        params: {
          engine:  'google_images',
          q:       photoQuery,
          ijn:     '0',
          api_key: SERP_API_KEY,
          hl:      'en',
        },
        timeout: 30000,
      }).catch(() => null),
    ]);

    let place = detailRes?.data?.place_results || null;

    // Fallback: if data_cid returned nothing, search by name
    if (!place && name) {
      const q = location ? `${name} ${location}` : name;
      const fallback = await axios.get('https://api.valueserp.com/search', {
        params: { engine: 'google_maps', q, type: 'search', api_key: SERP_API_KEY, hl: 'en' },
        timeout: 30000,
      }).catch(() => null);

      const results = fallback?.data?.local_results || [];
      place = results.find(p => p.title?.toLowerCase().includes(name.toLowerCase()))
           || results[0]
           || null;
    }

    if (!place) {
      return res.json({
        placeId, name,
        photos: [], reviews: [], hoursTable: null, services: [],
        message: 'No detailed data found for this business.',
      });
    }

    // ── Photos: from google_images ─────────────────────────────────────────
    const imagesResults = imageRes?.data?.images_results || [];
    const photos = imagesResults.slice(0, 24).map(img => ({
      url:       img.original  || img.link || null,
      thumbnail: img.thumbnail || img.original || null,
      title:     img.title     || null,
      source:    img.source    || null,
    })).filter(p => p.url && p.thumbnail);

    // ── Reviews ────────────────────────────────────────────────────────────
    const rawReviews = place.reviews_results?.reviews
      || place.user_reviews?.most_relevant
      || [];
    const reviews = rawReviews.slice(0, 6).map(r => ({
      author: r.user?.name || r.username || 'Anonymous',
      rating: r.rating     || null,
      text:   r.snippet    || r.description || r.text || '',
      date:   r.date       || r.iso_date    || null,
      avatar: r.user?.thumbnail || r.avatar || null,
    }));

    const hoursTable = place.hours?.graph || place.hours_extended || place.weekly_hours || null;
    const services   = place.service_options || place.offered_services || place.amenities || [];

    return res.json({
      placeId,
      name:          place.title  || name,
      rating:        place.rating || null,
      reviews_count: place.reviews || null,
      address:       place.address || null,
      phone:         place.phone   || null,
      website:       place.links?.website || place.website || null,
      category:      place.type    || null,
      photos,
      reviews,
      hoursTable,
      services,
    });

  } catch (err) {
    console.error('Place details error:', err.response?.data || err.message);
    return res.status(500).json({
      error: err.response?.data?.error || err.message || 'Failed to fetch place details.',
    });
  }
});

module.exports = router;
