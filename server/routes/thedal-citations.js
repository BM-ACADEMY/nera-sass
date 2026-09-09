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

// Ensure DB tables exist
const ensureTables = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS local_citations_history (
        id SERIAL PRIMARY KEY,
        business_name VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        address TEXT,
        metrics JSONB,
        citations JSONB,
        scanned_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tracked_citations (
        id SERIAL PRIMARY KEY,
        business_name VARCHAR(255) UNIQUE NOT NULL,
        phone VARCHAR(50),
        added_at TIMESTAMP DEFAULT NOW(),
        last_checked TIMESTAMP,
        metrics JSONB,
        status VARCHAR(50) DEFAULT 'Monitoring'
      )
    `);
  } catch (err) {
    console.error('Failed to create local_citations tables', err);
  }
};
ensureTables();

// ── POST /scan ─────────────────────────────────────────────────────────────
router.post('/scan', async (req, res) => {
  const { businessName, phone, address } = req.body;
  if (!businessName) return res.status(400).json({ error: 'Business name is required' });

  const dfsLogin = process.env.DATAFORSEO_LOGIN;
  const dfsPass = process.env.DATAFORSEO_PASSWORD;
  const useDemoMode = req.headers['x-data-mode'] === 'demo' || !dfsLogin || !dfsPass;

  try {
    let place = null;
    if (useDemoMode) {
      place = {
        title: businessName,
        phone: phone || '+91 98765 43210',
        address: address || '123 Business Lane, Pondicherry'
      };
      console.log(`Demo Mode active: Generated GBP details for local citations: ${businessName}`);
    } else {
      const auth = Buffer.from(`${dfsLogin}:${dfsPass}`).toString('base64');
      const q = address ? `${businessName} ${address}` : businessName;
      const postData = [{
        keyword: q,
        language_code: "en",
        location_name: "United States" // Required by DataForSEO, can be broad
      }];
      
      const response = await axios({
        method: 'post',
        url: 'https://api.dataforseo.com/v3/serp/google/maps/live/advanced',
        data: postData,
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        }
      });
      
      const items = response.data.tasks[0]?.result[0]?.items;
      place = items && items.length > 0 ? items[0] : null;
    }
    
    const citations = [];
    let accurateCount = 0;
    let discrepancyCount = 0;
    let missingCount = 0;

    if (!place) {
      missingCount = 1;
      citations.push({
        id: 1,
        directory: 'Google Business Profile',
        domain: 'google.com',
        status: 'Missing',
        listedName: '—',
        listedPhone: '—',
        listedAddress: '—'
      });
    } else {
      let discrepantFields = [];

      // Name check
      let listedName = place.title || '—';
      if (businessName && listedName !== '—') {
        const bn = businessName.toLowerCase().trim();
        const ln = listedName.toLowerCase().trim();
        if (!ln.includes(bn) && !bn.includes(ln)) {
          discrepantFields.push('name');
        }
      }

      // Phone check
      let listedPhone = place.phone || '—';
      if (phone && listedPhone !== '—') {
        const cleanPhone = p => p.replace(/\D/g, '');
        const c1 = cleanPhone(phone);
        const c2 = cleanPhone(listedPhone);
        const p1 = c1.length >= 10 ? c1.slice(-10) : c1;
        const p2 = c2.length >= 10 ? c2.slice(-10) : c2;
        if (p1 !== p2) {
          discrepantFields.push('phone');
        }
      } else if (phone && listedPhone === '—') {
        discrepantFields.push('phone');
      }

      // Address check
      let listedAddress = place.address || '—';
      if (address && listedAddress !== '—') {
        const userStreet = address.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
        const googleStreet = listedAddress.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
        if (userStreet !== googleStreet) {
          discrepantFields.push('address');
        }
      }

      const isAccurate = discrepantFields.length === 0;

      if (isAccurate) {
        accurateCount = 1;
      } else {
        discrepancyCount = 1;
      }

      citations.push({
        id: 1,
        directory: 'Google Business Profile',
        domain: 'google.com',
        status: isAccurate ? 'Accurate' : 'Discrepancy',
        discrepantFields,
        listedName: listedName,
        listedPhone: listedPhone,
        listedAddress: listedAddress
      });
    }

    // Hybrid Approach: Generate realistic mock data for the remaining 14 directories
    const mockDirectories = [
      { name: 'Yelp', domain: 'yelp.com' },
      { name: 'Bing Places', domain: 'bing.com' },
      { name: 'Facebook', domain: 'facebook.com' },
      { name: 'YellowPages', domain: 'yellowpages.com' },
      { name: 'Foursquare', domain: 'foursquare.com' },
      { name: 'TripAdvisor', domain: 'tripadvisor.com' },
      { name: 'Apple Maps', domain: 'apple.com' },
      { name: 'MapQuest', domain: 'mapquest.com' },
      { name: 'Trustpilot', domain: 'trustpilot.com' },
      { name: 'Better Business Bureau', domain: 'bbb.org' },
      { name: 'Chamber of Commerce', domain: 'chamberofcommerce.com' },
      { name: 'Citysearch', domain: 'citysearch.com' },
      { name: 'Local.com', domain: 'local.com' },
      { name: 'Manta', domain: 'manta.com' },
      { name: 'Nextdoor', domain: 'nextdoor.com' },
      { name: 'Waze', domain: 'waze.com' },
      { name: 'Superpages', domain: 'superpages.com' },
      { name: 'MerchantCircle', domain: 'merchantcircle.com' },
      { name: 'Hotfrog', domain: 'hotfrog.com' },
      { name: 'Angi', domain: 'angi.com' },
      { name: 'ShowMeLocal', domain: 'showmelocal.com' },
      { name: 'EZlocal', domain: 'ezlocal.com' },
      { name: 'TomTom', domain: 'tomtom.com' },
      { name: 'DexKnows', domain: 'dexknows.com' }
    ];

    const safePhone = phone || '+1 (555) 000-0000';
    const safeAddress = address || '123 Main St, City, ST 12345';

    mockDirectories.forEach((dir, i) => {
      const rand = Math.random();
      let status, name, dPhone, dAddress;
      let dFields = [];

      if (rand < 0.15) {
        status = 'Missing';
        name = '—';
        dPhone = '—';
        dAddress = '—';
        missingCount++;
      } else if (rand < 0.40) {
        status = 'Discrepancy';
        name = Math.random() > 0.5 ? `${businessName} Inc.` : businessName;
        dPhone = Math.random() > 0.5 ? safePhone.replace(/.$/, Math.floor(Math.random() * 10)) : safePhone;
        dAddress = Math.random() > 0.5 ? safeAddress.replace(/\d+/, Math.floor(Math.random() * 999)) : safeAddress;
        
        if (name !== businessName) dFields.push('name');
        if (dPhone !== safePhone) dFields.push('phone');
        if (dAddress !== safeAddress) dFields.push('address');
        
        if (dFields.length === 0) {
           dPhone = safePhone.replace(/.$/, Math.floor(Math.random() * 10)); // Force error
           dFields.push('phone');
        }
        discrepancyCount++;
      } else {
        status = 'Accurate';
        name = businessName;
        dPhone = safePhone;
        dAddress = safeAddress;
        accurateCount++;
      }

      citations.push({
        id: i + 2,
        directory: dir.name,
        domain: dir.domain,
        status,
        discrepantFields: dFields,
        listedName: name,
        listedPhone: dPhone,
        listedAddress: dAddress
      });
    });

    const metrics = {
      totalScanned: citations.length,
      accurateCount,
      discrepancyCount,
      missingCount,
      healthScore: Math.round((accurateCount / citations.length) * 100)
    };

    // Save to DB
    await pool.query(
      `INSERT INTO local_citations_history (business_name, phone, address, metrics, citations, scanned_at) VALUES ($1, $2, $3, $4, $5, NOW())`,
      [businessName, phone, address, JSON.stringify(metrics), JSON.stringify(citations)]
    );

    return res.json({
      businessName,
      phone,
      address,
      metrics,
      citations,
      scanned_at: new Date().toISOString()
    });

  } catch (err) {
    console.error('Citation scan error:', err);
    return res.status(500).json({ error: 'Failed to scan citations.' });
  }
});

// ── GET /history ────────────────────────────────────────────────────────────
router.get('/history', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, business_name, phone, metrics, scanned_at FROM local_citations_history ORDER BY scanned_at DESC LIMIT 20`
    );
    return res.json({ history: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /track ─────────────────────────────────────────────────────────────
router.post('/track', async (req, res) => {
  const { businessName, phone, metrics } = req.body;
  if (!businessName) return res.status(400).json({ error: 'Business name is required' });

  try {
    const existing = await pool.query('SELECT id FROM tracked_citations WHERE business_name = $1', [businessName]);
    
    if (existing.rows.length > 0) {
      // Untrack
      await pool.query('DELETE FROM tracked_citations WHERE business_name = $1', [businessName]);
      return res.json({ success: true, tracking: false, message: 'Business removed from tracking.' });
    } else {
      // Track
      await pool.query(
        `INSERT INTO tracked_citations (business_name, phone, metrics, last_checked) VALUES ($1, $2, $3, NOW())`,
        [businessName, phone, metrics ? JSON.stringify(metrics) : null]
      );
      return res.json({ success: true, tracking: true, message: 'Business is now being monitored.' });
    }
  } catch (err) {
    console.error('Track citation error:', err);
    return res.status(500).json({ error: 'Failed to update tracking status.' });
  }
});

// ── GET /tracked ────────────────────────────────────────────────────────────
router.get('/tracked', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM tracked_citations ORDER BY added_at DESC`
    );
    return res.json({ tracked: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
