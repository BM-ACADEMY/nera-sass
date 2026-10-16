const express = require('express');
const router = express.Router();
const { ContentQueue, BrandSocialAccounts, PublishQueue } = require('../models');
const { escapeRegex } = require('../db/mongo');

const NO_ID = { _id: 0 };
const startOfUtcDay = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };
const countByStatus = async (match) => (await ContentQueue.aggregate([
  { $match: match },
  { $group: { _id: '$status', count: { $sum: 1 } } },
])).map((row) => ({ status: row._id, count: row.count }));
const ctrl = require('../controllers/contentController');
const tb = require('../controllers/thumbnailBrainController');

// ── Thumbnail Brain Studio API ─────────────────────────────────────────────
// Config versions
router.get('/thumb-brain/config',              tb.getConfig);
router.post('/thumb-brain/config',             tb.saveConfig);
router.get('/thumb-brain/versions',            tb.getVersions);
router.post('/thumb-brain/versions/:id/activate', tb.activateVersion);
router.delete('/thumb-brain/versions/:id',     tb.deleteVersion);
// Platform profiles — dynamic from social accounts
router.get('/thumb-brain/social-platforms',          tb.getPlatformsFromAccounts);
router.put('/thumb-brain/social-platforms/:slug',    tb.savePlatformOverride);
// Platform profiles — manual CRUD (legacy)
router.get('/thumb-brain/platforms',           tb.getPlatforms);
router.post('/thumb-brain/platforms',          tb.createPlatform);
router.put('/thumb-brain/platforms/:id',       tb.updatePlatform);
router.delete('/thumb-brain/platforms/:id',    tb.deletePlatform);
// Brand styles — dynamic from social accounts
router.get('/thumb-brain/social-brand-styles',          tb.getBrandStylesFromAccounts);
router.put('/thumb-brain/social-brand-styles/:slug',    tb.saveBrandStyleOverride);
// Brand style library — manual CRUD (legacy)
router.get('/thumb-brain/brand-styles',        tb.getBrandStyles);
router.post('/thumb-brain/brand-styles',       tb.createBrandStyle);
router.put('/thumb-brain/brand-styles/:id',    tb.updateBrandStyle);
router.delete('/thumb-brain/brand-styles/:id', tb.deleteBrandStyle);
// Analytics
router.get('/thumb-brain/analytics',           tb.getAnalytics);
router.post('/thumb-brain/analytics',          tb.recordAnalytics);

function safeJsonValue(val) {
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch (e) {
      return val;
    }
  }
  return val;
}


// GET /api/content-os/social-accounts
router.get('/social-accounts', async (req, res) => {
  try {
    const rows = await BrandSocialAccounts.find({ is_active: true }, NO_ID).sort({ brand_name: 1, platform: 1 }).lean();
    res.json(rows);
  } catch (err) {
    console.error('Fetch social accounts error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/content-os/content-queue
router.get('/content-queue', async (req, res) => {
  try {
    const { status, search, brand, startDate, endDate, limit = 100, offset = 0 } = req.query;
    const filter = {};

    if (status && status !== 'all') {
      filter.status = status;
    } else {
      filter.status = { $ne: 'deleted_from_drive' };
    }

    const and = [];
    if (brand && brand !== 'All Brands') {
      filter.brand_name = new RegExp(escapeRegex(brand), 'i');
    }

    if (search) {
      const pattern = new RegExp(escapeRegex(search), 'i');
      and.push({ $or: [{ thumbnail_title: pattern }, { brand_name: pattern }, { caption: pattern }, { file_name: pattern }] });
    }

    if (startDate && endDate) {
      filter.created_at = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }
    if (and.length) filter.$and = and;

    const rows = await ContentQueue.find(filter, NO_ID)
      .sort({ created_at: -1 })
      .skip(Number(offset) || 0)
      .limit(Number(limit) || 100)
      .lean();

    // Global stats
    const stats = { PENDING: 0, APPROVED: 0, REJECTED: 0, PUBLISHED: 0, FAILED: 0 };
    (await countByStatus({})).forEach(r => { stats[r.status] = parseInt(r.count); });

    // Today's stats
    const todayStart = startOfUtcDay();
    const todayRows = await countByStatus({
      updated_at: { $gte: todayStart, $lt: new Date(todayStart.getTime() + 24 * 60 * 60 * 1000) },
      status: { $in: ['PUBLISHED', 'FAILED'] },
    });
    const todayStats = { PUBLISHED: 0, FAILED: 0 };
    todayRows.forEach(r => { todayStats[r.status] = parseInt(r.count); });

    const resolvedRows = rows.map(item => {
      if (ctrl.resolvePublicUrl) {
        return {
          ...item,
          public_video_url: ctrl.resolvePublicUrl(item.public_video_url, req),
          thumbnail_url: ctrl.resolvePublicUrl(item.thumbnail_url, req)
        };
      }
      return item;
    });

    res.json({ 
      data: resolvedRows, 
      stats, 
      analytics: {
        total: Object.values(stats).reduce((a, b) => a + b, 0),
        pending: stats.PENDING,
        publishedToday: todayStats.PUBLISHED,
        failedToday: todayStats.FAILED
      }
    });
  } catch (err) {
    console.error('Fetch queue error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/content-os/content/:id
router.get('/content/:id', async (req, res) => {
  try {
    const item = await ContentQueue.findOne({ id: req.params.id }, NO_ID).lean();
    if (!item) return res.status(404).json({ error: 'Content not found' });
    if (ctrl.resolvePublicUrl) {
      item.public_video_url = ctrl.resolvePublicUrl(item.public_video_url, req);
      item.thumbnail_url = ctrl.resolvePublicUrl(item.thumbnail_url, req);
    }
    res.json(item);
  } catch (err) {
    console.error('Fetch single content error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/content-os/content/:id
router.put('/content/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      caption, x_caption, linkedin_caption, thumbnail_title, 
      story_1, story_2, story_3, scheduled_at, platforms, selected_accounts 
    } = req.body;

    // COALESCE(new, old): only provided values overwrite stored ones
    const changes = Object.fromEntries(Object.entries({
      caption, x_caption, linkedin_caption, thumbnail_title, story_1, story_2, story_3, scheduled_at,
    }).filter(([, value]) => value !== undefined && value !== null));
    if (platforms) {
      changes.platforms = safeJsonValue(platforms);
      changes.selected_channels = safeJsonValue(platforms);
    }
    if (selected_accounts) changes.selected_accounts = safeJsonValue(selected_accounts);
    changes.updated_at = new Date();

    const updated = await ContentQueue.findOneAndUpdate({ id }, { $set: changes }, { new: true, projection: NO_ID }).lean();

    if (!updated) return res.status(404).json({ error: 'Content not found' });
    res.json(updated);
  } catch (err) {
    console.error('Update content error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/content/:id/edit', ctrl.updateContent);

// POST /api/content-os/content/:id/approve
// POST /api/content/:id/approve
router.post('/content/:id/approve', async (req, res) => {
  try {
    // 1. Fetch post to validate before approving
    const post = await ContentQueue.findOne(
      { id: req.params.id },
      { _id: 0, id: 1, brand_name: 1, platforms: 1, selected_channels: 1 }
    ).lean();

    if (!post) {
      return res.status(404).json({ error: 'Content not found' });
    }

    // Determine channels
    let channels = [];
    if (Array.isArray(post.selected_channels)) {
      channels = post.selected_channels;
    } else if (Array.isArray(post.platforms)) {
      channels = post.platforms;
    } else if (typeof post.platforms === 'string') {
      try {
        channels = JSON.parse(post.platforms);
      } catch (e) {
        channels = [];
      }
    }

    if (!channels || channels.length === 0) {
      return res.status(400).json({ error: 'Cannot approve content. No publishing channels are selected.' });
    }

    // 2. Fetch connected social accounts for this brand
    const accounts = await BrandSocialAccounts.find({ brand_name: post.brand_name, is_active: true }, { platform: 1 }).lean();

    const connectedPlatforms = new Set(accounts.map(r => r.platform.toLowerCase()));

    // 3. Validate accounts for each selected channel
    for (const channel of channels) {
      let requiredPlatform = channel.toLowerCase();
      if (requiredPlatform.includes('instagram')) requiredPlatform = 'instagram';
      if (requiredPlatform.includes('facebook')) requiredPlatform = 'facebook';
      if (requiredPlatform === 'x_twitter') requiredPlatform = 'x_twitter';

      if (!connectedPlatforms.has(requiredPlatform)) {
        return res.status(400).json({ 
          error: `Cannot approve content. No valid publishing channels are configured for this brand. Missing account for ${channel}.` 
        });
      }
    }

    // 4. Update status and approve
    const approver = req.user?.name || req.user?.email || 'Admin';
    const approved = await ContentQueue.findOneAndUpdate(
      { id: req.params.id },
      { $set: { status: 'APPROVED', approved_by: approver, approved_at: new Date(), updated_at: new Date() } },
      { new: true, projection: NO_ID }
    ).lean();

    // Insert pending publishing jobs for each channel
    for (const channel of channels) {
      let normalizedChannel = channel.toLowerCase();
      if (normalizedChannel === 'instagram') normalizedChannel = 'instagram_post';
      if (normalizedChannel === 'facebook') normalizedChannel = 'facebook_post';

      const job = await PublishQueue.updateOne(
        { content_id: post.id, channel: normalizedChannel },
        { $set: { status: 'pending', updated_at: new Date() } }
      );
      if (!job.matchedCount) {
        await PublishQueue.create({ content_id: post.id, brand_name: post.brand_name, channel: normalizedChannel, status: 'pending' });
      }
    }

    res.json(approved);
  } catch (err) {
    console.error('Approve content error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/content-os/content/:id/reject
router.post('/content/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body;
    const rejector = req.user?.name || req.user?.email || 'Admin';
    const updated = await ContentQueue.findOneAndUpdate(
      { id: req.params.id },
      { $set: { status: 'REJECTED', rejection_reason: reason, rejected_by: rejector, rejected_at: new Date(), updated_at: new Date() } },
      { new: true, projection: NO_ID }
    ).lean();

    if (!updated) return res.status(404).json({ error: 'Content not found' });
    res.json(updated);
  } catch (err) {
    console.error('Reject content error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── N8N WEBHOOKS ──

// POST /api/content-os/content/:id/publish-success
router.post('/content/:id/publish-success', async (req, res) => {
  try {
    const { platform_post_ids } = req.body;
    const updated = await ContentQueue.findOneAndUpdate(
      { id: req.params.id },
      { $set: { status: 'published', published_at: new Date(), platform_post_ids: platform_post_ids || [], updated_at: new Date() } },
      { new: true, projection: NO_ID }
    ).lean();

    if (!updated) return res.status(404).json({ error: 'Content not found' });
    res.json(updated);
  } catch (err) {
    console.error('Publish success webhook error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/content-os/content/:id/publish-fail
router.post('/content/:id/publish-fail', async (req, res) => {
  try {
    const { error_message, error_response } = req.body;
    const updated = await ContentQueue.findOneAndUpdate(
      { id: req.params.id },
      { $set: { status: 'failed', failed_at: new Date(), error_message, error_response: error_response || {}, updated_at: new Date() } },
      { new: true, projection: NO_ID }
    ).lean();

    if (!updated) return res.status(404).json({ error: 'Content not found' });
    res.json(updated);
  } catch (err) {
    console.error('Publish fail webhook error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Folders API for Google Drive Folder Monitors
router.get('/folders', ctrl.getFolderMonitors);
router.post('/folders', ctrl.upsertFolderMonitor);

module.exports = router;
