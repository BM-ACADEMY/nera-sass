const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { sendGmbConnectEmail } = require('../utils/mafiya-email');

// GET all GMB clients
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM mafiya_gmb_clients ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('[Mafiya] GET /clients error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST new GMB client
router.post('/', async (req, res) => {
  const {
    business_name,
    display_name,
    business_category,
    custom_category,
    contact_person,
    phone_number,
    business_address,
    website_url,
    gmb_url,
    gmb_email,
    logo_url,
    ga4_property_id,
    client_type,
    plan_id,
  } = req.body;

  if (!business_name || !contact_person || !phone_number || !business_address) {
    return res.status(400).json({ error: 'business_name, contact_person, phone_number, and business_address are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO mafiya_gmb_clients
        (business_name, display_name, business_category, custom_category, contact_person, phone_number, business_address, website_url, gmb_url, gmb_email, logo_url, ga4_property_id, client_type, plan_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [business_name, display_name, business_category, custom_category, contact_person, phone_number, business_address, website_url, gmb_url, gmb_email, logo_url, ga4_property_id, client_type || 'internal', plan_id || null]
    );

    const savedClient = result.rows[0];

    // Send GMB authorization email if gmb_email is provided
    if (gmb_email) {
      sendGmbConnectEmail(savedClient).catch(err => {
        console.error('[Mafiya] Failed to send GMB connect email:', err.message);
      });
    }

    res.status(201).json({ ...savedClient, email_sent: !!gmb_email });
  } catch (err) {
    console.error('[Mafiya] POST /clients error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT: Update a GMB client
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    business_name,
    display_name,
    business_category,
    custom_category,
    contact_person,
    phone_number,
    business_address,
    website_url,
    gmb_url,
    gmb_email,
    logo_url,
    ga4_property_id,
    client_type,
    plan_id,
  } = req.body;

  if (!business_name || !contact_person || !phone_number || !business_address) {
    return res.status(400).json({ error: 'business_name, contact_person, phone_number, and business_address are required' });
  }

  try {
    const result = await pool.query(
      `UPDATE mafiya_gmb_clients
       SET business_name = $1, display_name = $2, business_category = $3, custom_category = $4, contact_person = $5, phone_number = $6, business_address = $7, website_url = $8, gmb_url = $9, gmb_email = $10, logo_url = $11, ga4_property_id = $12, client_type = $13, plan_id = $14
       WHERE id = $15
       RETURNING *`,
      [business_name, display_name, business_category, custom_category, contact_person, phone_number, business_address, website_url, gmb_url, gmb_email, logo_url, ga4_property_id, client_type || 'internal', plan_id || null, id]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Client not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Mafiya] PUT /clients/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE a GMB client
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM mafiya_gmb_clients WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Client not found' });
    res.json({ message: 'Client deleted' });
  } catch (err) {
    console.error('[Mafiya] DELETE /clients error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST: Resend GMB connect email
router.post('/:id/resend-email', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM mafiya_gmb_clients WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const client = result.rows[0];
    if (!client.gmb_email) {
      return res.status(400).json({ error: 'Client does not have a GMB email configured' });
    }

    await sendGmbConnectEmail(client);
    res.json({ success: true, message: 'Verification email sent successfully' });
  } catch (err) {
    console.error('[Mafiya] POST /clients/:id/resend-email error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST: Disconnect GMB connection for a client
router.post('/:id/disconnect-gmb', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM mafiya_gmb_tokens WHERE client_id = $1', [id]);
    const result = await pool.query(
      `UPDATE mafiya_gmb_clients 
       SET gmb_verified = false, reviews_cache = NULL, reviews_updated_at = NULL 
       WHERE id = $1 RETURNING *`, 
      [id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Client not found' });
    res.json({ success: true, message: 'GMB disconnected successfully' });
  } catch (err) {
    console.error('[Mafiya] POST /clients/:id/disconnect-gmb error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/mafiya/clients/family/dashboard
router.get('/family/dashboard', async (req, res) => {
  try {
    // 1. Fetch GMB Clients
    const clientsRes = await pool.query('SELECT * FROM mafiya_gmb_clients ORDER BY created_at DESC');
    let clients = clientsRes.rows;
 
    // 2. Fetch Plans and features to get the limits for each client
    const plansRes = await pool.query('SELECT * FROM mafiya_plans');
    const plans = plansRes.rows;
    const featuresRes = await pool.query('SELECT * FROM mafiya_plan_features');
    const planFeatures = featuresRes.rows;

    // 3. Fetch actual AI reply counts per client (last 30 days)
    const aiRepliesRes = await pool.query(
      "SELECT client_id, COUNT(*)::int as count FROM mafiya_review_replies WHERE created_at >= NOW() - INTERVAL '30 days' GROUP BY client_id"
    );
    const aiRepliesCounts = aiRepliesRes.rows.reduce((acc, row) => {
      acc[row.client_id] = row.count;
      return acc;
    }, {});

    // Fetch actual AI post suggestions counts per client (last 30 days)
    const aiSugRes = await pool.query(
      "SELECT client_id, COUNT(*)::int as count FROM mafiya_ai_suggestions_log WHERE generated_at >= NOW() - INTERVAL '30 days' GROUP BY client_id"
    );
    const aiSugCounts = aiSugRes.rows.reduce((acc, row) => {
      acc[row.client_id] = row.count;
      return acc;
    }, {});

    // Fetch actual GMB Brain AI counts per client (last 30 days)
    const brainAiRes = await pool.query(
      "SELECT client_id, COUNT(*)::int as count FROM mafiya_brain_ai_log WHERE used_at >= NOW() - INTERVAL '30 days' GROUP BY client_id"
    );
    const brainAiCounts = brainAiRes.rows.reduce((acc, row) => {
      acc[row.client_id] = row.count;
      return acc;
    }, {});

    // 4. Fetch actual ValueSERP scans counts per client (last 30 days)
    const scansRes = await pool.query(
      "SELECT client_id, COUNT(*)::int as count FROM mafiya_geogrid_scans_log WHERE scanned_at >= NOW() - INTERVAL '30 days' GROUP BY client_id"
    );
    const scansCounts = scansRes.rows.reduce((acc, row) => {
      acc[row.client_id] = row.count;
      return acc;
    }, {});

    // Daily (Today) counts
    const aiRepliesTodayRes = await pool.query("SELECT client_id, COUNT(*)::int as count FROM mafiya_review_replies WHERE created_at >= CURRENT_DATE GROUP BY client_id");
    const aiRepliesToday = aiRepliesTodayRes.rows.reduce((acc, row) => { acc[row.client_id] = row.count; return acc; }, {});

    const aiSugTodayRes = await pool.query("SELECT client_id, COUNT(*)::int as count FROM mafiya_ai_suggestions_log WHERE generated_at >= CURRENT_DATE GROUP BY client_id");
    const aiSugToday = aiSugTodayRes.rows.reduce((acc, row) => { acc[row.client_id] = row.count; return acc; }, {});

    const brainAiTodayRes = await pool.query("SELECT client_id, COUNT(*)::int as count FROM mafiya_brain_ai_log WHERE used_at >= CURRENT_DATE GROUP BY client_id");
    const brainAiToday = brainAiTodayRes.rows.reduce((acc, row) => { acc[row.client_id] = row.count; return acc; }, {});

    const scansTodayRes = await pool.query("SELECT client_id, COUNT(*)::int as count FROM mafiya_geogrid_scans_log WHERE scanned_at >= CURRENT_DATE GROUP BY client_id");
    const scansToday = scansTodayRes.rows.reduce((acc, row) => { acc[row.client_id] = row.count; return acc; }, {});

    // Map limits per plan_id
    const limitsMap = {};
    planFeatures.forEach(pf => {
      if (!limitsMap[pf.plan_id]) {
        limitsMap[pf.plan_id] = { aiRepliesLimit: 20, aiSugLimit: 10, brainAiLimit: 10, scansLimit: 3, aiRepliesDailyLimit: -1, aiSugDailyLimit: -1, brainAiDailyLimit: -1, scansDailyLimit: -1 };
      }
      if (pf.feature_key === 'mafiya_ai_replies') {
        limitsMap[pf.plan_id].aiRepliesLimit = pf.limit_value; limitsMap[pf.plan_id].aiRepliesDailyLimit = pf.daily_limit;
      }
      if (pf.feature_key === 'mafiya_ai_suggestions') {
        limitsMap[pf.plan_id].aiSugLimit = pf.limit_value; limitsMap[pf.plan_id].aiSugDailyLimit = pf.daily_limit;
      }
      if (pf.feature_key === 'mafiya_brain_ai') {
        limitsMap[pf.plan_id].brainAiLimit = pf.limit_value; limitsMap[pf.plan_id].brainAiDailyLimit = pf.daily_limit;
      }
      if (pf.feature_key === 'mafiya_geogrid_scans') {
        limitsMap[pf.plan_id].scansLimit = pf.limit_value; limitsMap[pf.plan_id].scansDailyLimit = pf.daily_limit;
      }
    });

    // Attach usage to clients
    clients = clients.map(c => {
      const planLimits = limitsMap[c.plan_id] || { aiRepliesLimit: 20, aiSugLimit: 10, brainAiLimit: 10, scansLimit: 3, aiRepliesDailyLimit: -1, aiSugDailyLimit: -1, brainAiDailyLimit: -1, scansDailyLimit: -1 };
      const currentReplies = aiRepliesCounts[c.id] || 0;
      const currentSug = aiSugCounts[c.id] || 0;
      const currentBrain = brainAiCounts[c.id] || 0;
      const currentScans = scansCounts[c.id] || 0;
      const todayReplies = aiRepliesToday[c.id] || 0;
      const todaySug = aiSugToday[c.id] || 0;
      const todayBrain = brainAiToday[c.id] || 0;
      const todayScans = scansToday[c.id] || 0;

      return {
        ...c,
        ai_replies_used: currentReplies,
        ai_replies_limit: c.client_type === 'internal' ? -1 : planLimits.aiRepliesLimit,
        ai_replies_today_used: todayReplies,
        ai_replies_daily_limit: c.client_type === 'internal' ? -1 : planLimits.aiRepliesDailyLimit,
        ai_sug_used: currentSug,
        ai_sug_limit: c.client_type === 'internal' ? -1 : planLimits.aiSugLimit,
        ai_sug_today_used: todaySug,
        ai_sug_daily_limit: c.client_type === 'internal' ? -1 : planLimits.aiSugDailyLimit,
        brain_ai_used: currentBrain,
        brain_ai_limit: c.client_type === 'internal' ? -1 : planLimits.brainAiLimit,
        brain_ai_today_used: todayBrain,
        brain_ai_daily_limit: c.client_type === 'internal' ? -1 : planLimits.brainAiDailyLimit,
        scans_used: currentScans,
        scans_limit: c.client_type === 'internal' ? -1 : planLimits.scansLimit,
        scans_today_used: todayScans,
        scans_daily_limit: c.client_type === 'internal' ? -1 : planLimits.scansDailyLimit
      };
    });
 
    // 3. Fetch Turf Keywords for calculations
    const keywordsRes = await pool.query('SELECT * FROM mafiya_turf_keywords');
    const keywords = keywordsRes.rows;
 
    // 4. Fetch open orders
    const ordersRes = await pool.query("SELECT * FROM mafiya_orders WHERE status = 'open' ORDER BY id ASC LIMIT 5");
    const orders = ordersRes.rows;
 
    const totalClientsCount = clients.length;
     
    // Territory Captured: Keywords where current_rank = 1 or current_rank <= 3
    const territoryCaptured = keywords.filter(k => parseInt(k.current_rank) === 1).length;
    const rankImprovedCount = keywords.filter(k => parseInt(k.current_rank) < parseInt(k.initial_rank) && parseInt(k.current_rank) <= 3).length;

    // Generate alerts list dynamically
    const alerts = [];
    
    // Alert 1: GMB pending alerts
    const pendingClients = clients.filter(c => !c.gmb_verified);
    pendingClients.forEach(c => {
      alerts.push({
        id: `gmb-alert-${c.id}`,
        type: 'gmb-pending',
        title: 'Connection Pending',
        description: `${c.display_name || c.business_name} GMB connection is pending.`,
        time: 'Just now',
        urgency: 'normal',
        brand: c.display_name || c.business_name
      });
    });

    // Alert 2: Rank Drops (Turf Control Keyword Risk)
    const rankDrops = keywords.filter(k => parseInt(k.current_rank) > parseInt(k.initial_rank));
    rankDrops.forEach(k => {
      const client = clients.find(c => c.id === k.client_id);
      const brandName = client ? (client.display_name || client.business_name) : 'Unknown Brand';
      alerts.push({
        id: `rank-alert-${k.id}`,
        type: 'rank-drop',
        title: 'Code Red - Rank Drop',
        description: `${brandName} dropped #${k.initial_rank} ➔ #${k.current_rank} for '${k.keyword}'`,
        time: '1h ago',
        urgency: 'urgent',
        keyword: k.keyword,
        brand: brandName,
        initialRank: k.initial_rank,
        previousRank: k.previous_rank || k.initial_rank,
        currentRank: k.current_rank
      });
    });

    res.json({
      clients,
      plans,
      orders,
      alerts,
      metrics: {
        territoryCaptured: territoryCaptured,
        territoryCapturedChange: rankImprovedCount,
        newReviews: 0,
        newReviewsChange: 0,
        codeRedAlerts: alerts.filter(a => a.urgency === 'urgent').length,
        directionRequests: 0,
        directionRequestsChange: 0
      }
    });

  } catch (err) {
    console.error('[Mafiya] GET /family/dashboard error:', err);
    res.status(500).json({ error: 'Server error loading family dashboard' });
  }
});

// GET: Get Google Maps API Key from server config
router.get('/config/maps-key', async (req, res) => {
  try {
    res.json({ apiKey: process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY });
  } catch (err) {
    console.error('[Mafiya] GET /config/maps-key error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
