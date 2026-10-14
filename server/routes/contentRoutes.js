const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/contentController");
const { ContentQueue, BrandSocialAccounts } = require("../models");

// Stats for the dashboard top cards
router.get("/stats", ctrl.getStats);

// Expose public Meta configuration
router.get("/config", (req, res) => {
  res.json({ appId: process.env.META_CONTENT_OS_APP_ID || "" });
});

// Brand social accounts
router.get("/social-accounts", ctrl.getSocialAccounts);

// List content by status: /api/content?status=PENDING
router.get("/", ctrl.getContent);

// Approve / Reject / Schedule
router.post("/:id/approve", ctrl.approveContent);
router.post("/:id/reject", ctrl.rejectContent);
router.post("/:id/schedule", ctrl.scheduleContent);

// AI caption suggestions
router.post("/:id/suggest-captions", ctrl.suggestCaptions);

// AI story suggestions
router.post("/:id/suggest-stories", ctrl.suggestStories);

// Save edits (caption, schedule, platforms)
router.patch("/:id", ctrl.updateContent);
router.put("/:id/edit", ctrl.updateContent);

// AI caption generation
router.post("/generate-captions", ctrl.generateCaptions);

// Batch create queue items
router.post("/batch", ctrl.createBatchContent);

// Meta OAuth callback and account linking
router.post("/meta/callback", ctrl.handleMetaCallback);
router.post("/meta/link-account", ctrl.linkBrandAccount);
router.delete("/meta/account/:id", ctrl.deleteBrandAccount);

// YouTube OAuth routes
router.get("/youtube/auth", ctrl.handleYoutubeAuth);
router.get("/youtube/callback", ctrl.handleYoutubeCallback);

// LinkedIn OAuth routes
router.get("/linkedin/auth", ctrl.handleLinkedInAuth);
router.get("/linkedin/callback", ctrl.handleLinkedInCallback);


// Generate thumbnail options from video
router.post("/:id/generate-thumbnails", ctrl.generateThumbnails);

// AI-enhance selected frame into a poster
router.post("/:id/generate-poster", ctrl.generatePoster);

// Upload canvas-rendered poster overlay (with typography) as a permanent file
router.post("/:id/upload-poster-overlay", ctrl.uploadPosterOverlay);

// Standalone AI image generation from text prompt
router.post("/generate-ai-image", ctrl.generateAIImage);

// Trigger publishing
router.post("/:id/publish", ctrl.publishPost);

// Delete post from all platforms
router.delete("/:id", ctrl.deletePost);

// Called by n8n after successful publish
router.post('/:id/publish-success', async (req, res) => {
  const { id } = req.params;
  const { platform_post_ids } = req.body;
  try {
    await ContentQueue.updateOne(
      { id },
      { $set: { status: 'PUBLISHED', published_at: new Date(), platform_post_ids: platform_post_ids ?? null } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Called by n8n when publish fails
router.post('/:id/publish-fail', async (req, res) => {
  const { id } = req.params;
  const { error_message, error_response } = req.body;
  try {
    await ContentQueue.updateOne(
      { id },
      { $set: { status: 'FAILED', failure_reason: error_message, failed_at: new Date() } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Google Drive monitors settings
router.get("/monitors", ctrl.getFolderMonitors);
router.post("/monitors", ctrl.upsertFolderMonitor);

// Debug endpoint to clean up transcoded video/thumbnail from server disk
router.post("/debug/delete-transcode", async (req, res) => {
  const { fileId } = req.body;
  if (!fileId) return res.status(400).json({ error: 'fileId is required' });
  try {
    const fs = require('fs');
    const path = require('path');
    const uploadsDir = path.join(__dirname, '../uploads');
    const transcodedPath = path.join(uploadsDir, `transcoded_${fileId}.mp4`);
    const thumbPath = path.join(uploadsDir, `thumbnail_${fileId}.jpg`);
    let deletedVideo = false;
    let deletedThumb = false;
    if (fs.existsSync(transcodedPath)) {
      fs.unlinkSync(transcodedPath);
      deletedVideo = true;
    }
    if (fs.existsSync(thumbPath)) {
      fs.unlinkSync(thumbPath);
      deletedThumb = true;
    }
    res.json({ success: true, deletedVideo, deletedThumb });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// One-time fix: fetch Instagram permalinks for all existing published posts
router.post('/fix-instagram-urls', async (req, res) => {
  const axios = require('axios');
  const cryptoHelper = require('../utils/crypto');
  let fixed = 0, skipped = 0, failed = 0;
  const errors = [];
  try {
    const posts = await ContentQueue.find(
      {
        status: { $in: ['PUBLISHED', 'PARTIAL', 'published', 'partial'] },
        platform_post_ids: { $nin: [null, []] },
      },
      { _id: 0, id: 1, brand_id: 1, platform_post_ids: 1 }
    ).lean();

    for (const post of posts) {
      let ids = [];
      try { ids = typeof post.platform_post_ids === 'string' ? JSON.parse(post.platform_post_ids) : post.platform_post_ids; } catch(_) { continue; }
      if (!Array.isArray(ids)) continue;

      const igEntry = ids.find(e => e && e.platform && e.platform.includes('instagram') && !e.platform.includes('story') && e.post_id);
      if (!igEntry || igEntry.url) { skipped++; continue; }

      try {
        const brandKey = (value) => String(value ?? '').replace(/[ -]/g, '_').toLowerCase();
        const accs = (await BrandSocialAccounts.find({ platform: 'instagram' }, { _id: 0, access_token: 1, brand_name: 1 }).lean())
          .filter((acc) => brandKey(acc.brand_name) === String(post.brand_id ?? '').toLowerCase())
          .slice(0, 1);
        if (!accs.length) { skipped++; errors.push({ id: post.id, reason: `no instagram account found for brand_id=${post.brand_id}` }); continue; }

        const tok = cryptoHelper.decrypt(accs[0].access_token);
        const plRes = await axios.get(`https://graph.facebook.com/v19.0/${igEntry.post_id}`, {
          params: { fields: 'permalink', access_token: tok }
        });
        if (!plRes.data.permalink) { skipped++; errors.push({ id: post.id, reason: `no permalink in API response`, data: plRes.data }); continue; }

        igEntry.url = plRes.data.permalink;
        await ContentQueue.updateOne({ id: post.id }, { $set: { platform_post_ids: ids } });
        fixed++;
      } catch(e) {
        const detail = e.response?.data || e.message;
        errors.push({ id: post.id, brand_id: post.brand_id, post_id: igEntry?.post_id, error: detail });
        failed++;
      }
    }

    res.json({ success: true, fixed, skipped, failed, errors });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
