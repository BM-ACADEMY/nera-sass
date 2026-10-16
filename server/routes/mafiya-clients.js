const express = require('express');
const router = express.Router();
const {
  MafiyaGmbClients,
  MafiyaGmbTokens,
  MafiyaPlans,
  MafiyaPlanFeatures,
  MafiyaReviewReplies,
  MafiyaAiSuggestionsLog,
  MafiyaBrainAiLog,
  MafiyaGeogridScansLog,
  MafiyaTurfKeywords,
  MafiyaOrders,
} = require('../models');
const { deleteCascade } = require('../db/cascade');

const NO_ID = { _id: 0 };
const startOfUtcDay = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };

// { client_id: count } for rows of `model` whose `dateField` is on/after `since`
async function countsByClient(model, dateField, since) {
  const rows = await model.aggregate([
    { $match: { [dateField]: { $gte: since } } },
    { $group: { _id: '$client_id', count: { $sum: 1 } } },
  ]);
  return rows.reduce((acc, row) => { acc[row._id] = row.count; return acc; }, {});
}
const { sendGmbConnectEmail } = require('../utils/mafiya-email');

// GET all GMB clients
router.get('/', async (req, res) => {
  try {
    const clients = await MafiyaGmbClients.find({}, NO_ID).sort({ created_at: -1 }).lean();
    res.json(clients);
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
    const savedClient = (await MafiyaGmbClients.create({
      business_name, display_name, business_category, custom_category, contact_person, phone_number, business_address,
      website_url, gmb_url, gmb_email, logo_url, ga4_property_id, client_type: client_type || 'internal', plan_id: plan_id || null,
    })).toObject();

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
    const updated = await MafiyaGmbClients.findOneAndUpdate(
      { id },
      { $set: {
        business_name, display_name: display_name ?? null, business_category: business_category ?? null, custom_category: custom_category ?? null,
        contact_person, phone_number, business_address, website_url: website_url ?? null, gmb_url: gmb_url ?? null, gmb_email: gmb_email ?? null,
        logo_url: logo_url ?? null, ga4_property_id: ga4_property_id ?? null, client_type: client_type || 'internal', plan_id: plan_id || null,
      } },
      { new: true, projection: NO_ID }
    ).lean();

    if (!updated) return res.status(404).json({ error: 'Client not found' });
    res.json(updated);
  } catch (err) {
    console.error('[Mafiya] PUT /clients/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE a GMB client
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const deleted = await deleteCascade('mafiya_gmb_clients', { id });
    if (deleted.length === 0) return res.status(404).json({ error: 'Client not found' });
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
    const client = await MafiyaGmbClients.findOne({ id }, NO_ID).lean();
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
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
    await MafiyaGmbTokens.deleteMany({ client_id: id });
    const result = await MafiyaGmbClients.updateOne(
      { id },
      { $set: { gmb_verified: false, reviews_cache: null, reviews_updated_at: null } }
    );
    if (result.matchedCount === 0) return res.status(404).json({ error: 'Client not found' });
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
    let clients = await MafiyaGmbClients.find({}, NO_ID).sort({ created_at: -1 }).lean();

    // 2. Fetch Plans and features to get the limits for each client
    const plans = await MafiyaPlans.find({}, NO_ID).lean();
    const planFeatures = await MafiyaPlanFeatures.find({}, NO_ID).lean();

    // 3. Usage counts per client (last 30 days, and today)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const today = startOfUtcDay();
    const [
      aiRepliesCounts, aiSugCounts, brainAiCounts, scansCounts,
      aiRepliesToday, aiSugToday, brainAiToday, scansToday,
    ] = await Promise.all([
      countsByClient(MafiyaReviewReplies, 'created_at', thirtyDaysAgo),
      countsByClient(MafiyaAiSuggestionsLog, 'generated_at', thirtyDaysAgo),
      countsByClient(MafiyaBrainAiLog, 'used_at', thirtyDaysAgo),
      countsByClient(MafiyaGeogridScansLog, 'scanned_at', thirtyDaysAgo),
      countsByClient(MafiyaReviewReplies, 'created_at', today),
      countsByClient(MafiyaAiSuggestionsLog, 'generated_at', today),
      countsByClient(MafiyaBrainAiLog, 'used_at', today),
      countsByClient(MafiyaGeogridScansLog, 'scanned_at', today),
    ]);

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
    const keywords = await MafiyaTurfKeywords.find({}, NO_ID).lean();

    // 4. Fetch open orders
    const orders = await MafiyaOrders.find({ status: 'open' }, NO_ID).sort({ id: 1 }).limit(5).lean();
 
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
