/**
 * Thumbnail Brain Configuration Studio — Backend Controller
 * All DB operations for: Config Versions, Platform Profiles, Brand Styles, Analytics
 */

const pool = require('../db/connection');

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

// ── Auto-migration ───────────────────────────────────────────────────────────

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS thumb_brain_config (
      id SERIAL PRIMARY KEY,
      version_number INT NOT NULL DEFAULT 1,
      version_name VARCHAR(100) DEFAULT 'Untitled',
      config JSONB NOT NULL,
      is_active BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS thumb_brain_platforms (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      slug VARCHAR(50) UNIQUE NOT NULL,
      icon VARCHAR(10) DEFAULT '📱',
      aspect_ratio VARCHAR(20) NOT NULL,
      width INT NOT NULL,
      height INT NOT NULL,
      safe_margin INT DEFAULT 5,
      text_scale FLOAT DEFAULT 1.0,
      optimization_notes TEXT DEFAULT '',
      is_active BOOLEAN DEFAULT true,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS thumb_brain_brand_styles (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      slug VARCHAR(50) UNIQUE,
      primary_color VARCHAR(7) DEFAULT '#000000',
      secondary_color VARCHAR(7) DEFAULT '#ffffff',
      accent_color VARCHAR(7) DEFAULT '#f97316',
      typography_style VARCHAR(50) DEFAULT 'Bold',
      lighting_preset VARCHAR(50) DEFAULT 'Cinematic',
      background_style VARCHAR(50) DEFAULT 'Gradient',
      design_keywords TEXT[] DEFAULT '{}',
      prompt_injection TEXT DEFAULT '',
      is_active BOOLEAN DEFAULT true,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS thumb_brain_analytics (
      id SERIAL PRIMARY KEY,
      content_id INT,
      brand_style_id INT,
      platform_slug VARCHAR(50),
      model_used VARCHAR(100),
      engine_used VARCHAR(50),
      generation_time_ms INT,
      prompt_length INT,
      was_approved BOOLEAN,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

// ── Config Versions ──────────────────────────────────────────────────────────

async function getConfig(req, res) {
  try {
    await ensureTables();
    const { rows } = await pool.query(
      'SELECT * FROM thumb_brain_config WHERE is_active = true ORDER BY created_at DESC LIMIT 1'
    );
    if (rows.length === 0) {
      return res.json({ config: DEFAULT_CONFIG, version: null });
    }
    res.json({ config: rows[0].config, version: rows[0] });
  } catch (err) {
    console.error('[thumbBrain] getConfig:', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function saveConfig(req, res) {
  try {
    await ensureTables();
    const { config, version_name } = req.body;
    await pool.query('UPDATE thumb_brain_config SET is_active = false');
    const { rows: vRows } = await pool.query('SELECT COALESCE(MAX(version_number), 0) AS max_v FROM thumb_brain_config');
    const nextVersion = Number(vRows[0].max_v) + 1;
    const { rows } = await pool.query(
      'INSERT INTO thumb_brain_config (version_number, version_name, config, is_active) VALUES ($1, $2, $3, true) RETURNING *',
      [nextVersion, version_name || `Version ${nextVersion}`, JSON.stringify(config)]
    );
    res.json({ success: true, version: rows[0] });
  } catch (err) {
    console.error('[thumbBrain] saveConfig:', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function getVersions(req, res) {
  try {
    await ensureTables();
    const { rows } = await pool.query('SELECT * FROM thumb_brain_config ORDER BY created_at DESC LIMIT 50');
    res.json({ versions: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function activateVersion(req, res) {
  try {
    await pool.query('UPDATE thumb_brain_config SET is_active = false');
    const { rows } = await pool.query(
      'UPDATE thumb_brain_config SET is_active = true WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    res.json({ success: true, version: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteVersion(req, res) {
  try {
    await pool.query('DELETE FROM thumb_brain_config WHERE id = $1', [req.params.id]);
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
    const { rows: acctRows } = await pool.query(`
      SELECT platform, COUNT(DISTINCT brand_name) AS brand_count,
             array_agg(DISTINCT brand_name ORDER BY brand_name) AS brands
      FROM brand_social_accounts
      WHERE is_active = true
      GROUP BY platform
      ORDER BY platform
    `);

    // Get any saved dimension overrides from DB
    const { rows: overrides } = await pool.query(
      'SELECT * FROM thumb_brain_platforms'
    );
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
    const { rows } = await pool.query(`
      INSERT INTO thumb_brain_platforms (name, slug, icon, aspect_ratio, width, height, safe_margin, text_scale, optimization_notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (slug) DO UPDATE SET
        aspect_ratio       = EXCLUDED.aspect_ratio,
        width              = EXCLUDED.width,
        height             = EXCLUDED.height,
        safe_margin        = EXCLUDED.safe_margin,
        text_scale         = EXCLUDED.text_scale,
        optimization_notes = EXCLUDED.optimization_notes
      RETURNING *
    `, [slug, slug, '📱', aspect_ratio, Number(width), Number(height), Number(safe_margin), Number(text_scale), optimization_notes || '']);
    res.json({ success: true, platform: rows[0] });
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
    const { rows: brandRows } = await pool.query(`
      SELECT brand_name,
             array_agg(DISTINCT platform ORDER BY platform) AS platforms,
             COUNT(DISTINCT platform) AS platform_count
      FROM brand_social_accounts
      WHERE is_active = true
      GROUP BY brand_name
      ORDER BY brand_name
    `);

    // Get any saved style overrides from DB (keyed by slug = brand_name lowercased)
    const { rows: overrides } = await pool.query('SELECT * FROM thumb_brain_brand_styles');
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
    const { rows } = await pool.query(`
      INSERT INTO thumb_brain_brand_styles
        (name, slug, primary_color, secondary_color, accent_color, typography_style, lighting_preset, background_style, design_keywords, prompt_injection)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (slug) DO UPDATE SET
        primary_color    = EXCLUDED.primary_color,
        secondary_color  = EXCLUDED.secondary_color,
        accent_color     = EXCLUDED.accent_color,
        typography_style = EXCLUDED.typography_style,
        lighting_preset  = EXCLUDED.lighting_preset,
        background_style = EXCLUDED.background_style,
        design_keywords  = EXCLUDED.design_keywords,
        prompt_injection = EXCLUDED.prompt_injection,
        updated_at       = NOW()
      RETURNING *
    `, [name, slug, primary_color || '#000000', secondary_color || '#ffffff', accent_color || '#f97316',
        typography_style || 'Bold', lighting_preset || 'Cinematic', background_style || 'Gradient',
        design_keywords || [], prompt_injection || '']);
    res.json({ success: true, brandStyle: rows[0] });
  } catch (err) {
    console.error('[thumbBrain] saveBrandStyleOverride:', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function getPlatforms(req, res) {
  try {
    await ensureTables();
    const { rows } = await pool.query('SELECT * FROM thumb_brain_platforms ORDER BY sort_order, name');
    if (rows.length === 0) {
      for (const p of DEFAULT_PLATFORMS) {
        await pool.query(
          'INSERT INTO thumb_brain_platforms (name, slug, icon, aspect_ratio, width, height, safe_margin, text_scale, optimization_notes, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (slug) DO NOTHING',
          [p.name, p.slug, p.icon, p.aspect_ratio, p.width, p.height, p.safe_margin, p.text_scale, p.optimization_notes, p.sort_order]
        );
      }
      const { rows: seeded } = await pool.query('SELECT * FROM thumb_brain_platforms ORDER BY sort_order');
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
    const { rows } = await pool.query(
      'INSERT INTO thumb_brain_platforms (name, slug, icon, aspect_ratio, width, height, safe_margin, text_scale, optimization_notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [name, slug || name.toLowerCase().replace(/\s+/g, '_'), icon || '📱', aspect_ratio, Number(width), Number(height), Number(safe_margin) || 5, Number(text_scale) || 1.0, optimization_notes || '']
    );
    res.json({ success: true, platform: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updatePlatform(req, res) {
  try {
    const { name, icon, aspect_ratio, width, height, safe_margin, text_scale, optimization_notes, is_active } = req.body;
    const { rows } = await pool.query(
      'UPDATE thumb_brain_platforms SET name=$1, icon=$2, aspect_ratio=$3, width=$4, height=$5, safe_margin=$6, text_scale=$7, optimization_notes=$8, is_active=$9 WHERE id=$10 RETURNING *',
      [name, icon, aspect_ratio, Number(width), Number(height), Number(safe_margin), Number(text_scale), optimization_notes, is_active !== false, req.params.id]
    );
    res.json({ success: true, platform: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deletePlatform(req, res) {
  try {
    await pool.query('DELETE FROM thumb_brain_platforms WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Brand Style Library ──────────────────────────────────────────────────────

async function getBrandStyles(req, res) {
  try {
    await ensureTables();
    const { rows } = await pool.query('SELECT * FROM thumb_brain_brand_styles ORDER BY sort_order, name');
    if (rows.length === 0) {
      for (const b of DEFAULT_BRAND_STYLES) {
        await pool.query(
          'INSERT INTO thumb_brain_brand_styles (name, slug, primary_color, secondary_color, accent_color, typography_style, lighting_preset, background_style, design_keywords, prompt_injection, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (slug) DO NOTHING',
          [b.name, b.slug, b.primary_color, b.secondary_color, b.accent_color, b.typography_style, b.lighting_preset, b.background_style, b.design_keywords, b.prompt_injection, b.sort_order]
        );
      }
      const { rows: seeded } = await pool.query('SELECT * FROM thumb_brain_brand_styles ORDER BY sort_order');
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
    const { rows } = await pool.query(
      'INSERT INTO thumb_brain_brand_styles (name, slug, primary_color, secondary_color, accent_color, typography_style, lighting_preset, background_style, design_keywords, prompt_injection) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [name, slug, primary_color || '#000000', secondary_color || '#ffffff', accent_color || '#f97316', typography_style || 'Bold', lighting_preset || 'Cinematic', background_style || 'Gradient', design_keywords || [], prompt_injection || '']
    );
    res.json({ success: true, brandStyle: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateBrandStyle(req, res) {
  try {
    const { name, primary_color, secondary_color, accent_color, typography_style, lighting_preset, background_style, design_keywords, prompt_injection, is_active } = req.body;
    const { rows } = await pool.query(
      'UPDATE thumb_brain_brand_styles SET name=$1, primary_color=$2, secondary_color=$3, accent_color=$4, typography_style=$5, lighting_preset=$6, background_style=$7, design_keywords=$8, prompt_injection=$9, is_active=$10, updated_at=NOW() WHERE id=$11 RETURNING *',
      [name, primary_color, secondary_color, accent_color, typography_style, lighting_preset, background_style, design_keywords || [], prompt_injection, is_active !== false, req.params.id]
    );
    res.json({ success: true, brandStyle: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteBrandStyle(req, res) {
  try {
    await pool.query('DELETE FROM thumb_brain_brand_styles WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Analytics ────────────────────────────────────────────────────────────────

async function getAnalytics(req, res) {
  try {
    await ensureTables();
    const { rows: summary } = await pool.query(`
      SELECT
        COUNT(*) AS total_generated,
        COUNT(*) FILTER (WHERE was_approved = true)  AS total_approved,
        COUNT(*) FILTER (WHERE was_approved = false) AS total_rejected,
        COUNT(*) FILTER (WHERE was_approved IS NULL) AS pending_review,
        ROUND(AVG(generation_time_ms))               AS avg_generation_ms,
        ROUND(AVG(prompt_length))                    AS avg_prompt_length
      FROM thumb_brain_analytics
    `);
    const { rows: byModel }    = await pool.query(`SELECT model_used, COUNT(*) AS count FROM thumb_brain_analytics WHERE model_used IS NOT NULL GROUP BY model_used ORDER BY count DESC LIMIT 5`);
    const { rows: byPlatform } = await pool.query(`SELECT platform_slug, COUNT(*) AS count FROM thumb_brain_analytics WHERE platform_slug IS NOT NULL GROUP BY platform_slug ORDER BY count DESC`);
    const { rows: byEngine }   = await pool.query(`SELECT engine_used, COUNT(*) AS count FROM thumb_brain_analytics WHERE engine_used IS NOT NULL GROUP BY engine_used ORDER BY count DESC`);
    const { rows: recent }     = await pool.query(`SELECT * FROM thumb_brain_analytics ORDER BY created_at DESC LIMIT 20`);
    res.json({ summary: summary[0], byModel, byPlatform, byEngine, recent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function recordAnalytics(req, res) {
  try {
    await ensureTables();
    const { content_id, brand_style_id, platform_slug, model_used, engine_used, generation_time_ms, prompt_length, was_approved } = req.body;
    await pool.query(
      'INSERT INTO thumb_brain_analytics (content_id, brand_style_id, platform_slug, model_used, engine_used, generation_time_ms, prompt_length, was_approved) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [content_id || null, brand_style_id || null, platform_slug || null, model_used || null, engine_used || null, generation_time_ms || null, prompt_length || null, was_approved ?? null]
    );
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
