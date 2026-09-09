const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
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
    const { rows } = await pool.query('SELECT * FROM brand_social_accounts WHERE is_active = true ORDER BY brand_name, platform');
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
    let q = 'SELECT * FROM content_queue WHERE 1=1';
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      q += ` AND status = $${params.length}`;
    } else {
      q += " AND status != 'deleted_from_drive'";
    }
    
    if (brand && brand !== 'All Brands') {
      params.push(`%${brand}%`);
      q += ` AND brand_name ILIKE $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      q += ` AND (thumbnail_title ILIKE $${params.length} OR brand_name ILIKE $${params.length} OR caption ILIKE $${params.length} OR file_name ILIKE $${params.length})`;
    }

    if (startDate && endDate) {
      params.push(startDate, endDate);
      q += ` AND created_at BETWEEN $${params.length - 1} AND $${params.length}`;
    }

    q += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(q, params);
    
    // Global stats
    const statsRes = await pool.query(`
      SELECT status, count(*) 
      FROM content_queue 
      GROUP BY status
    `);
    
    const stats = { PENDING: 0, APPROVED: 0, REJECTED: 0, PUBLISHED: 0, FAILED: 0 };
    statsRes.rows.forEach(r => { stats[r.status] = parseInt(r.count); });

    // Today's stats
    const todayRes = await pool.query(`
      SELECT status, count(*) 
      FROM content_queue 
      WHERE DATE(updated_at) = CURRENT_DATE AND status IN ('PUBLISHED', 'FAILED')
      GROUP BY status
    `);
    const todayStats = { PUBLISHED: 0, FAILED: 0 };
    todayRes.rows.forEach(r => { todayStats[r.status] = parseInt(r.count); });

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
    const { rows } = await pool.query('SELECT * FROM content_queue WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Content not found' });
    const item = rows[0];
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

    const { rows } = await pool.query(`
      UPDATE content_queue 
      SET 
        caption = COALESCE($1, caption),
        x_caption = COALESCE($2, x_caption),
        linkedin_caption = COALESCE($3, linkedin_caption),
        thumbnail_title = COALESCE($4, thumbnail_title),
        story_1 = COALESCE($5, story_1),
        story_2 = COALESCE($6, story_2),
        story_3 = COALESCE($7, story_3),
        scheduled_at = COALESCE($8, scheduled_at),
        platforms = COALESCE($9, platforms),
        selected_channels = COALESCE($9, selected_channels),
        selected_accounts = COALESCE($10, selected_accounts),
        updated_at = NOW()
      WHERE id = $11
      RETURNING *
    `, [
      caption, x_caption, linkedin_caption, thumbnail_title, 
      story_1, story_2, story_3, scheduled_at, 
      platforms ? JSON.stringify(safeJsonValue(platforms)) : null,
      selected_accounts ? JSON.stringify(safeJsonValue(selected_accounts)) : null,
      id
    ]);

    if (!rows.length) return res.status(404).json({ error: 'Content not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Update content error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/content/:id/edit', ctrl.updateContent);

// POST /api/content-os/content/:id/approve
// POST /api/content/:id/approve
router.post('/content/:id/approve', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Fetch post to validate before approving
    const postRes = await client.query(`
      SELECT id, brand_name, platforms, selected_channels 
      FROM content_queue 
      WHERE id = $1
    `, [req.params.id]);

    if (!postRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Content not found' });
    }

    const post = postRes.rows[0];

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
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cannot approve content. No publishing channels are selected.' });
    }

    // 2. Fetch connected social accounts for this brand
    const accsRes = await client.query(`
      SELECT platform 
      FROM brand_social_accounts 
      WHERE brand_name = $1 AND is_active = true
    `, [post.brand_name]);
    
    const connectedPlatforms = new Set(accsRes.rows.map(r => r.platform.toLowerCase()));

    // 3. Validate accounts for each selected channel
    for (const channel of channels) {
      let requiredPlatform = channel.toLowerCase();
      if (requiredPlatform.includes('instagram')) requiredPlatform = 'instagram';
      if (requiredPlatform.includes('facebook')) requiredPlatform = 'facebook';
      if (requiredPlatform === 'x_twitter') requiredPlatform = 'x_twitter';

      if (!connectedPlatforms.has(requiredPlatform)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          error: `Cannot approve content. No valid publishing channels are configured for this brand. Missing account for ${channel}.` 
        });
      }
    }

    // 4. Update status and approve
    const approver = req.user?.name || req.user?.email || 'Admin';
    const { rows } = await client.query(`
      UPDATE content_queue 
      SET status = 'APPROVED', approved_by = $2, approved_at = NOW(), updated_at = NOW() 
      WHERE id = $1 RETURNING *
    `, [req.params.id, approver]);

    // Insert pending publishing jobs for each channel
    for (const channel of channels) {
      let normalizedChannel = channel.toLowerCase();
      if (normalizedChannel === 'instagram') normalizedChannel = 'instagram_post';
      if (normalizedChannel === 'facebook') normalizedChannel = 'facebook_post';

      await client.query(`
        INSERT INTO publish_queue (content_id, brand_name, channel, status)
        VALUES ($1, $2, $3, 'pending')
        ON CONFLICT (content_id, channel) DO UPDATE SET status = 'pending', updated_at = NOW()
      `, [post.id, post.brand_name, normalizedChannel]);
    }

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Approve content error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// POST /api/content-os/content/:id/reject
router.post('/content/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body;
    const rejector = req.user?.name || req.user?.email || 'Admin';
    const { rows } = await pool.query(`
      UPDATE content_queue 
      SET status = 'REJECTED', rejection_reason = $2, rejected_by = $3, rejected_at = NOW(), updated_at = NOW() 
      WHERE id = $1 RETURNING *
    `, [req.params.id, reason, rejector]);

    if (!rows.length) return res.status(404).json({ error: 'Content not found' });
    res.json(rows[0]);
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
    const { rows } = await pool.query(`
      UPDATE content_queue 
      SET status = 'published', published_at = NOW(), platform_post_ids = $2, updated_at = NOW() 
      WHERE id = $1 RETURNING *
    `, [req.params.id, platform_post_ids ? JSON.stringify(platform_post_ids) : '[]']);

    if (!rows.length) return res.status(404).json({ error: 'Content not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Publish success webhook error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/content-os/content/:id/publish-fail
router.post('/content/:id/publish-fail', async (req, res) => {
  try {
    const { error_message, error_response } = req.body;
    const { rows } = await pool.query(`
      UPDATE content_queue 
      SET status = 'failed', failed_at = NOW(), error_message = $2, error_response = $3, updated_at = NOW() 
      WHERE id = $1 RETURNING *
    `, [req.params.id, error_message, error_response ? JSON.stringify(error_response) : '{}']);

    if (!rows.length) return res.status(404).json({ error: 'Content not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Publish fail webhook error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Folders API for Google Drive Folder Monitors
router.get('/folders', ctrl.getFolderMonitors);
router.post('/folders', ctrl.upsertFolderMonitor);

module.exports = router;
