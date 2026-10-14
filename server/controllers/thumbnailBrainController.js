/**
 * Thumbnail Brain Configuration Studio — Backend Controller
 * All DB operations for: Config Versions, Platform Profiles, Brand Styles, Analytics
 */

const { ThumbBrainConfig, ThumbBrainPlatforms, ThumbBrainBrandStyles, ThumbBrainAnalytics, BrandSocialAccounts } = require('../models');

// ── Default data ─────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  aiEngine: {
    provider: 'google',
    model: 'gemini-3.1-flash-image',
    temperature: 0.7,
    maxTokens: 2048,
    imageQuality: 'ultra_hd',
    creativityLevel: 7,
    safetyLevel: 'moderate',
  },
  subjectPreservation: {
    face: true, hair: true, expression: true,
    clothing: true, pose: true, cameraAngle: true, skinTone: true,
  },
  compositionRules: ['rule_of_thirds', 'close_up'],
  lighting: ['cinematic'],
  typography: 'bold',
  backgroundStyle: 'gradient',
  thumbnailGoal: 'highest_ctr',
  negativePrompts: ['blurry', 'low_quality', 'watermark', 'text_artifacts', 'duplicate_faces', 'distorted_anatomy'],
  promptModules: {
    systemPrompt: 'You are an expert YouTube Thumbnail Designer and Creative Director.',
    generationRules: "Keep the person's face, pose, clothing and identity exactly the same. Enhance HDR lighting, professional color grading, face sharpness, eye clarity, hair details, dynamic contrast, depth of field, ultra realistic quality. Apply subtle cinematic effects: rim lighting, lens flare, light rays, glow, floating particles.",
    outputInstructions: 'Output only the enhanced image. Do not generate text, logos, watermarks. Do not distort faces.',
  },
  defaultBrandStyleId: null,
  defaultPlatformSlug: 'youtube',
  titleSafeArea: 35,
};

const DEFAULT_PLATFORMS = [
  { name: 'YouTube', slug: 'youtube', icon: '▶', aspect_ratio: '16:9', width: 1280, height: 720, safe_margin: 5, text_scale: 1.2, optimization_notes: 'CTR optimized · Large typography · High contrast · Face prominence', sort_order: 1 },
  { name: 'Instagram Feed', slug: 'instagram_feed', icon: '📸', aspect_ratio: '1:1', width: 1080, height: 1080, safe_margin: 3, text_scale: 1.0, optimization_notes: 'Square format · Centered composition · Bold visual hook', sort_order: 2 },
  { name: 'Instagram Portrait', slug: 'instagram_portrait', icon: '📱', aspect_ratio: '4:5', width: 1080, height: 1350, safe_margin: 3, text_scale: 1.0, optimization_notes: 'Portrait format · More screen real estate in feed', sort_order: 3 },
  { name: 'Instagram Story', slug: 'instagram_story', icon: '⭕', aspect_ratio: '9:16', width: 1080, height: 1920, safe_margin: 8, text_scale: 1.1, optimization_notes: 'Full screen vertical · Keep key elements in center 80%', sort_order: 4 },
  { name: 'Facebook Feed', slug: 'facebook_feed', icon: 'f', aspect_ratio: '1.91:1', width: 1200, height: 628, safe_margin: 4, text_scale: 1.0, optimization_notes: 'Landscape · Text under 20% for organic reach', sort_order: 5 },
  { name: 'LinkedIn', slug: 'linkedin', icon: 'in', aspect_ratio: '1.91:1', width: 1200, height: 627, safe_margin: 4, text_scale: 1.0, optimization_notes: 'Professional tone · Clean composition · Industry relevant', sort_order: 6 },
  { name: 'Twitter / X', slug: 'twitter', icon: 'X', aspect_ratio: '16:9', width: 1200, height: 675, safe_margin: 4, text_scale: 1.0, optimization_notes: 'High contrast · Bold visual hook · Clear focal point', sort_order: 7 },
];

const DEFAULT_BRAND_STYLES = [
  { name: 'BM Academy', slug: 'bm_academy', primary_color: '#000000', secondary_color: '#FFD700', accent_color: '#f97316', typography_style: 'Bold', lighting_preset: 'Dramatic', background_style: 'Gradient', design_keywords: ['education', 'premium', 'high contrast', 'bold'], prompt_injection: 'Black and yellow color scheme, bold typography, educational premium aesthetic, high contrast visuals', sort_order: 1 },
  { name: 'Corporate', slug: 'corporate', primary_color: '#1e40af', secondary_color: '#ffffff', accent_color: '#3b82f6', typography_style: 'Modern', lighting_preset: 'Studio', background_style: 'Office', design_keywords: ['professional', 'clean', 'minimal', 'business'], prompt_injection: 'Corporate professional style, clean blue and white palette, minimal and polished design', sort_order: 2 },
  { name: 'Luxury', slug: 'luxury', primary_color: '#000000', secondary_color: '#D4AF37', accent_color: '#c9a84c', typography_style: 'Luxury', lighting_preset: 'Golden Hour', background_style: 'Luxury', design_keywords: ['luxury', 'gold', 'black', 'elegant', 'premium'], prompt_injection: 'Luxury brand aesthetic, gold and black palette, elegant sophisticated composition, premium feel', sort_order: 3 },
  { name: 'Gaming', slug: 'gaming', primary_color: '#7c3aed', secondary_color: '#06b6d4', accent_color: '#f59e0b', typography_style: 'Gaming', lighting_preset: 'Neon', background_style: 'Abstract', design_keywords: ['gaming', 'vibrant', 'neon', 'glow', 'dynamic'], prompt_injection: 'Gaming aesthetic, vibrant purple and cyan, neon glow effects, dynamic high-energy composition', sort_order: 4 },
  { name: 'Podcast', slug: 'podcast', primary_color: '#f97316', secondary_color: '#1e293b', accent_color: '#fb923c', typography_style: 'Bold', lighting_preset: 'Soft', background_style: 'Blur', design_keywords: ['podcast', 'conversational', 'warm', 'intimate'], prompt_injection: 'Podcast style, orange and dark theme, warm intimate atmosphere, conversational studio feel', sort_order: 5 },
  { name: 'Real Estate', slug: 'real_estate', primary_color: '#14532d', secondary_color: '#f0fdf4', accent_color: '#16a34a', typography_style: 'Modern', lighting_preset: 'Golden Hour', background_style: 'City', design_keywords: ['modern', 'premium', 'bright', 'aspirational'], prompt_injection: 'Premium real estate aesthetic, golden hour lighting, architectural composition, aspirational luxury property feel', sort_order: 6 },
];

// ── Collection setup ─────────────────────────────────────────────────────────

let tablesReady;
function ensureTables() {
  if (!tablesReady) {
    tablesReady = Promise.all([ThumbBrainConfig, ThumbBrainPlatforms, ThumbBrainBrandStyles, ThumbBrainAnalytics].map((m) => m.createIndexes()))
      .catch((error) => { tablesReady = null; throw error; });
  }
  return tablesReady;
}

const NO_ID = { _id: 0 };
const isDuplicate = (error) => error && error.code === 11000;

// ── Config Versions ──────────────────────────────────────────────────────────

async function getConfig(req, res) {
  try {
    await ensureTables();
    const active = await ThumbBrainConfig.findOne({ is_active: true }, NO_ID).sort({ created_at: -1 }).lean();
    if (!active) {
      return res.json({ config: DEFAULT_CONFIG, version: null });
    }
    res.json({ config: active.config, version: active });
  } catch (err) {
    console.error('[thumbBrain] getConfig:', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function saveConfig(req, res) {
  try {
    await ensureTables();
    const { config, version_name } = req.body;
    await ThumbBrainConfig.updateMany({}, { $set: { is_active: false } });
    const latest = await ThumbBrainConfig.findOne({}, { version_number: 1 }).sort({ version_number: -1 }).lean();
    const nextVersion = Number(latest?.version_number || 0) + 1;
    const version = await ThumbBrainConfig.create({
      version_number: nextVersion,
      version_name: version_name || `Version ${nextVersion}`,
      config,
      is_active: true,
    });
    res.json({ success: true, version: version.toObject() });
  } catch (err) {
    console.error('[thumbBrain] saveConfig:', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function getVersions(req, res) {
  try {
    await ensureTables();
    const versions = await ThumbBrainConfig.find({}, NO_ID).sort({ created_at: -1 }).limit(50).lean();
    res.json({ versions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function activateVersion(req, res) {
  try {
    await ThumbBrainConfig.updateMany({}, { $set: { is_active: false } });
    const version = await ThumbBrainConfig.findOneAndUpdate(
      { id: req.params.id },
      { $set: { is_active: true } },
      { new: true, projection: NO_ID }
    ).lean();
    res.json({ success: true, version: version || undefined });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteVersion(req, res) {
  try {
    await ThumbBrainConfig.deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Platform Profiles — dynamic from brand_social_accounts ───────────────────

const PLATFORM_SPECS = {
  youtube: {
    name: 'YouTube', icon: '▶', color: '#FF0000',
    aspect_ratio: '16:9', width: 1280, height: 720,
    safe_margin: 15, text_scale: 1.2,
    optimization_notes: 'High contrast, clear face, bold typography. Leave 15% bottom for title overlay.',
  },
  instagram: {
    name: 'Instagram Reel', icon: '📸', color: '#DD2A7B',
    aspect_ratio: '9:16', width: 1080, height: 1920,
    safe_margin: 8, text_scale: 1.1,
    optimization_notes: 'Vertical format, bold visual impact, eye-catching in small feed preview.',
  },
  instagram_post: {
    name: 'Instagram Post', icon: '📸', color: '#DD2A7B',
    aspect_ratio: '1:1', width: 1080, height: 1080,
    safe_margin: 5, text_scale: 1.0,
    optimization_notes: 'Square format, clean centered composition, strong subject.',
  },
  instagram_story: {
    name: 'Instagram Story', icon: '📱', color: '#DD2A7B',
    aspect_ratio: '9:16', width: 1080, height: 1920,
    safe_margin: 10, text_scale: 1.2,
    optimization_notes: 'Full-screen vertical. Leave top/bottom 10% for UI overlays.',
  },
  facebook: {
    name: 'Facebook Reel', icon: '👍', color: '#1877F2',
    aspect_ratio: '9:16', width: 1080, height: 1920,
    safe_margin: 8, text_scale: 1.0,
    optimization_notes: 'Vertical reel format, engaging first frame, bold visuals.',
  },
  facebook_post: {
    name: 'Facebook Post', icon: '👍', color: '#1877F2',
    aspect_ratio: '1.91:1', width: 1200, height: 630,
    safe_margin: 5, text_scale: 1.0,
    optimization_notes: 'Landscape, high contrast. Keep text under 20% for organic reach.',
  },
  facebook_story: {
    name: 'Facebook Story', icon: '📱', color: '#1877F2',
    aspect_ratio: '9:16', width: 1080, height: 1920,
    safe_margin: 10, text_scale: 1.2,
    optimization_notes: 'Full-screen vertical, immersive format.',
  },
  x_twitter: {
    name: 'X (Twitter)', icon: '𝕏', color: '#000000',
    aspect_ratio: '16:9', width: 1200, height: 675,
    safe_margin: 5, text_scale: 0.9,
    optimization_notes: 'Shown as card preview. Bold visual, minimal text.',
  },
  linkedin: {
    name: 'LinkedIn', icon: 'in', color: '#0A66C2',
    aspect_ratio: '1.91:1', width: 1200, height: 627,
    safe_margin: 5, text_scale: 1.0,
    optimization_notes: 'Professional tone, clean design, B2B audience.',
  },
};

async function getPlatformsFromAccounts(req, res) {
  try {
    await ensureTables();

    // Get all distinct active platforms with brand counts
    const acctRows = (await BrandSocialAccounts.aggregate([
      { $match: { is_active: true } },
      { $group: { _id: '$platform', brands: { $addToSet: '$brand_name' } } },
      { $sort: { _id: 1 } },
    ])).map((row) => {
      const brands = row.brands.filter((b) => b !== null && b !== undefined).sort();
      return { platform: row._id, brand_count: brands.length, brands: row.brands.some((b) => b == null) ? [...brands, null] : brands };
    });

    // Get any saved dimension overrides from DB
    const overrides = await ThumbBrainPlatforms.find({}, NO_ID).lean();
    const overrideMap = {};
    overrides.forEach(o => { overrideMap[o.slug] = o; });

    const platforms = acctRows.map(row => {
      const spec = PLATFORM_SPECS[row.platform] || {
        name: row.platform, icon: '🌐', color: '#454A58',
        aspect_ratio: '16:9', width: 1280, height: 720,
        safe_margin: 5, text_scale: 1.0, optimization_notes: '',
      };
      const override = overrideMap[row.platform] || {};
      return {
        slug: row.platform,
        brand_count: parseInt(row.brand_count),
        brands: row.brands,
        connected: true,
        // Spec defaults, then DB overrides on top
        name:               override.name               || spec.name,
        icon:               override.icon               || spec.icon,
        color:              spec.color,
        aspect_ratio:       override.aspect_ratio       || spec.aspect_ratio,
        width:              override.width               || spec.width,
        height:             override.height              || spec.height,
        safe_margin:        override.safe_margin         != null ? override.safe_margin : spec.safe_margin,
        text_scale:         override.text_scale          != null ? override.text_scale  : spec.text_scale,
        optimization_notes: override.optimization_notes || spec.optimization_notes,
        has_override:       !!override.id,
      };
    });

    res.json({ platforms });
  } catch (err) {
    console.error('[thumbBrain] getPlatformsFromAccounts:', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function savePlatformOverride(req, res) {
  try {
    const { slug } = req.params;
    const { aspect_ratio, width, height, safe_margin, text_scale, optimization_notes } = req.body;
    const fields = {
      aspect_ratio,
      width: Number(width),
      height: Number(height),
      safe_margin: Number(safe_margin),
      text_scale: Number(text_scale),
      optimization_notes: optimization_notes || '',
    };
    let platform = await ThumbBrainPlatforms.findOneAndUpdate({ slug }, { $set: fields }, { new: true, projection: NO_ID }).lean();
    if (!platform) {
      platform = (await ThumbBrainPlatforms.create({ name: slug, slug, icon: '📱', ...fields })).toObject();
    }
    res.json({ success: true, platform });
  } catch (err) {
    console.error('[thumbBrain] savePlatformOverride:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ── Brand Styles — dynamic from brand_social_accounts ────────────────────────

async function getBrandStylesFromAccounts(req, res) {
  try {
    await ensureTables();

    // Get all distinct active brands
    const brandRows = (await BrandSocialAccounts.aggregate([
      { $match: { is_active: true } },
      { $group: { _id: '$brand_name', platforms: { $addToSet: '$platform' } } },
      { $sort: { _id: 1 } },
    ])).map((row) => {
      const platforms = row.platforms.filter((p) => p !== null && p !== undefined).sort();
      return { brand_name: row._id, platforms, platform_count: platforms.length };
    });

    // Get any saved style overrides from DB (keyed by slug = brand_name lowercased)
    const overrides = await ThumbBrainBrandStyles.find({}, NO_ID).lean();
    const overrideMap = {};
    overrides.forEach(o => { overrideMap[o.slug] = o; });

    const brandStyles = brandRows.map(row => {
      const slug = row.brand_name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      const override = overrideMap[slug] || {};
      return {
        slug,
        name:             row.brand_name,
        platforms:        row.platforms,
        platform_count:   parseInt(row.platform_count),
        connected:        true,
        // Defaults, then DB overrides on top
        primary_color:    override.primary_color    || '#000000',
        secondary_color:  override.secondary_color  || '#ffffff',
        accent_color:     override.accent_color     || '#f97316',
        typography_style: override.typography_style || 'Bold',
        lighting_preset:  override.lighting_preset  || 'Cinematic',
        background_style: override.background_style || 'Gradient',
        design_keywords:  override.design_keywords  || [],
        prompt_injection: override.prompt_injection || '',
        has_override:     !!override.id,
        id:               override.id || null,
      };
    });

    res.json({ brandStyles });
  } catch (err) {
    console.error('[thumbBrain] getBrandStylesFromAccounts:', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function saveBrandStyleOverride(req, res) {
  try {
    const { slug } = req.params;
    const { name, primary_color, secondary_color, accent_color, typography_style, lighting_preset, background_style, design_keywords, prompt_injection } = req.body;
    const fields = {
      primary_color: primary_color || '#000000',
      secondary_color: secondary_color || '#ffffff',
      accent_color: accent_color || '#f97316',
      typography_style: typography_style || 'Bold',
      lighting_preset: lighting_preset || 'Cinematic',
      background_style: background_style || 'Gradient',
      design_keywords: design_keywords || [],
      prompt_injection: prompt_injection || '',
    };
    let brandStyle = await ThumbBrainBrandStyles.findOneAndUpdate(
      { slug },
      { $set: { ...fields, updated_at: new Date() } },
      { new: true, projection: NO_ID }
    ).lean();
    if (!brandStyle) {
      brandStyle = (await ThumbBrainBrandStyles.create({ name, slug, ...fields })).toObject();
    }
    res.json({ success: true, brandStyle });
  } catch (err) {
    console.error('[thumbBrain] saveBrandStyleOverride:', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function getPlatforms(req, res) {
  try {
    await ensureTables();
    const rows = await ThumbBrainPlatforms.find({}, NO_ID).sort({ sort_order: 1, name: 1 }).lean();
    if (rows.length === 0) {
      for (const p of DEFAULT_PLATFORMS) {
        await ThumbBrainPlatforms.create(p).catch((error) => { if (!isDuplicate(error)) throw error; });
      }
      const seeded = await ThumbBrainPlatforms.find({}, NO_ID).sort({ sort_order: 1 }).lean();
      return res.json({ platforms: seeded });
    }
    res.json({ platforms: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createPlatform(req, res) {
  try {
    const { name, slug, icon, aspect_ratio, width, height, safe_margin, text_scale, optimization_notes } = req.body;
    const platform = await ThumbBrainPlatforms.create({
      name,
      slug: slug || name.toLowerCase().replace(/\s+/g, '_'),
      icon: icon || '📱',
      aspect_ratio,
      width: Number(width),
      height: Number(height),
      safe_margin: Number(safe_margin) || 5,
      text_scale: Number(text_scale) || 1.0,
      optimization_notes: optimization_notes || '',
    });
    res.json({ success: true, platform: platform.toObject() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updatePlatform(req, res) {
  try {
    const { name, icon, aspect_ratio, width, height, safe_margin, text_scale, optimization_notes, is_active } = req.body;
    const platform = await ThumbBrainPlatforms.findOneAndUpdate(
      { id: req.params.id },
      { $set: {
        name, icon, aspect_ratio,
        width: Number(width), height: Number(height), safe_margin: Number(safe_margin), text_scale: Number(text_scale),
        optimization_notes, is_active: is_active !== false,
      } },
      { new: true, projection: NO_ID }
    ).lean();
    res.json({ success: true, platform: platform || undefined });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deletePlatform(req, res) {
  try {
    await ThumbBrainPlatforms.deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Brand Style Library ──────────────────────────────────────────────────────

async function getBrandStyles(req, res) {
  try {
    await ensureTables();
    const rows = await ThumbBrainBrandStyles.find({}, NO_ID).sort({ sort_order: 1, name: 1 }).lean();
    if (rows.length === 0) {
      for (const b of DEFAULT_BRAND_STYLES) {
        await ThumbBrainBrandStyles.create(b).catch((error) => { if (!isDuplicate(error)) throw error; });
      }
      const seeded = await ThumbBrainBrandStyles.find({}, NO_ID).sort({ sort_order: 1 }).lean();
      return res.json({ brandStyles: seeded });
    }
    res.json({ brandStyles: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createBrandStyle(req, res) {
  try {
    const { name, primary_color, secondary_color, accent_color, typography_style, lighting_preset, background_style, design_keywords, prompt_injection } = req.body;
    const slug = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const brandStyle = await ThumbBrainBrandStyles.create({
      name,
      slug,
      primary_color: primary_color || '#000000',
      secondary_color: secondary_color || '#ffffff',
      accent_color: accent_color || '#f97316',
      typography_style: typography_style || 'Bold',
      lighting_preset: lighting_preset || 'Cinematic',
      background_style: background_style || 'Gradient',
      design_keywords: design_keywords || [],
      prompt_injection: prompt_injection || '',
    });
    res.json({ success: true, brandStyle: brandStyle.toObject() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateBrandStyle(req, res) {
  try {
    const { name, primary_color, secondary_color, accent_color, typography_style, lighting_preset, background_style, design_keywords, prompt_injection, is_active } = req.body;
    const brandStyle = await ThumbBrainBrandStyles.findOneAndUpdate(
      { id: req.params.id },
      { $set: {
        name, primary_color, secondary_color, accent_color, typography_style, lighting_preset, background_style,
        design_keywords: design_keywords || [], prompt_injection, is_active: is_active !== false, updated_at: new Date(),
      } },
      { new: true, projection: NO_ID }
    ).lean();
    res.json({ success: true, brandStyle: brandStyle || undefined });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteBrandStyle(req, res) {
  try {
    await ThumbBrainBrandStyles.deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Analytics ────────────────────────────────────────────────────────────────

const countBy = (field, limit) => ThumbBrainAnalytics.aggregate([
  { $match: { [field]: { $ne: null } } },
  { $group: { _id: `$${field}`, count: { $sum: 1 } } },
  { $sort: { count: -1 } },
  ...(limit ? [{ $limit: limit }] : []),
  { $project: { _id: 0, [field]: '$_id', count: 1 } },
]);

async function getAnalytics(req, res) {
  try {
    await ensureTables();
    const [summary = {
      total_generated: 0, total_approved: 0, total_rejected: 0, pending_review: 0, avg_generation_ms: null, avg_prompt_length: null,
    }] = await ThumbBrainAnalytics.aggregate([
      {
        $group: {
          _id: null,
          total_generated: { $sum: 1 },
          total_approved: { $sum: { $cond: [{ $eq: ['$was_approved', true] }, 1, 0] } },
          total_rejected: { $sum: { $cond: [{ $eq: ['$was_approved', false] }, 1, 0] } },
          pending_review: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$was_approved', null] }, null] }, 1, 0] } },
          avg_generation_ms: { $avg: '$generation_time_ms' },
          avg_prompt_length: { $avg: '$prompt_length' },
        },
      },
      {
        $project: {
          _id: 0, total_generated: 1, total_approved: 1, total_rejected: 1, pending_review: 1,
          avg_generation_ms: { $round: ['$avg_generation_ms', 0] },
          avg_prompt_length: { $round: ['$avg_prompt_length', 0] },
        },
      },
    ]);
    const byModel = await countBy('model_used', 5);
    const byPlatform = await countBy('platform_slug');
    const byEngine = await countBy('engine_used');
    const recent = await ThumbBrainAnalytics.find({}, NO_ID).sort({ created_at: -1 }).limit(20).lean();
    res.json({ summary, byModel, byPlatform, byEngine, recent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function recordAnalytics(req, res) {
  try {
    await ensureTables();
    const { content_id, brand_style_id, platform_slug, model_used, engine_used, generation_time_ms, prompt_length, was_approved } = req.body;
    await ThumbBrainAnalytics.create({
      content_id: content_id || null,
      brand_style_id: brand_style_id || null,
      platform_slug: platform_slug || null,
      model_used: model_used || null,
      engine_used: engine_used || null,
      generation_time_ms: generation_time_ms || null,
      prompt_length: prompt_length || null,
      was_approved: was_approved ?? null,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getConfig, saveConfig,
  getVersions, activateVersion, deleteVersion,
  getPlatformsFromAccounts, savePlatformOverride,
  getBrandStylesFromAccounts, saveBrandStyleOverride,
  getPlatforms, createPlatform, updatePlatform, deletePlatform,
  getBrandStyles, createBrandStyle, updateBrandStyle, deleteBrandStyle,
  getAnalytics, recordAnalytics,
};
