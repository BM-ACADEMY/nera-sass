/**
 * Thumbnail Brain — Configuration Layer
 * 
 * Single responsibility: Load, save, and validate Thumbnail Brain
 * configuration from localStorage. No prompt building, no API calls.
 */

export const THUMB_BRAIN_KEY = 'thumbnail_brain_config';

/* ── Option lists (used by the UI and validation) ─────────────────── */

export const STYLES = [
  'Cinematic', 'Technology', 'AI', 'Business', 'Education',
  'Gaming', 'Podcast', 'Real Estate', 'Minimal'
];

export const ASPECT_RATIOS = ['16:9', '9:16', '4:3', '1:1'];

export const RESOLUTIONS = ['1920x1080', '1280x720', '3840x2160', '1080x1920'];

export const QUALITIES = ['Ultra HD', 'HD', 'Standard'];

export const MODELS = [
  { value: 'gemini-2.0-flash-preview-image-generation', label: 'Gemini 2.0 Flash Image' },
  { value: 'gemini-2.0-flash-exp',                      label: 'Gemini 2.0 Flash Exp' },
];

/* ── Default prompt ───────────────────────────────────────────────── */

export const DEFAULT_PROMPT = `You are an expert YouTube Thumbnail Designer and Creative Director.

Transform the selected video frame into a premium cinematic thumbnail.

Keep the person's face, pose, clothing and identity exactly the same.

Enhance:

• HDR lighting
• Professional color grading
• Face sharpness
• Eye clarity
• Hair details
• Dynamic contrast
• Depth of field
• Ultra realistic quality

Apply subtle cinematic effects:

• Rim lighting
• Lens flare
• Light rays
• Glow
• Floating particles

Keep all effects realistic.

Improve the background only if necessary while preserving realism.

Leave approximately 35% empty space for title placement.

Do not generate text.

Do not generate logos.

Do not generate watermarks.

Do not distort faces.

Output:

Aspect Ratio: 16:9

Resolution: 1920×1080

Ultra HD

Professional YouTube Thumbnail`;

export const DEFAULT_TEXT_OVERLAY = {
  enabled: true,
  mode: 'canvas', // 'canvas' | 'ai_prompt' | 'both'
  headlineSource: 'auto', // 'auto' | 'custom'
  customHeadline: 'BECOME A DATA ANALYST',
  subtitle: 'Placement in 90 Days',
  ctaBadge: 'Admissions Open',
  fontFamily: 'Anton',
  fontSize: 54,
  textColor: '#FFFFFF',
  strokeColor: '#000000',
  strokeWidth: 6,
  bgColor: 'rgba(249, 115, 22, 0.95)',
  subBgColor: 'rgba(15, 23, 42, 0.9)',
  subTextColor: '#E2E8F0',
  ctaBgColor: '#10B981',
  ctaTextColor: '#FFFFFF',
  bgPadding: 14,
  borderRadius: 8,
  shadowColor: 'rgba(0, 0, 0, 0.75)',
  shadowBlur: 14,
  position: 'top_left',
  showBgPill: true,
  showSubtitle: true,
  showCtaBadge: true,
};


/* ── Default configuration ────────────────────────────────────────── */

export const DEFAULT_CONFIG = {
  defaultPrompt: DEFAULT_PROMPT,
  style:         'Cinematic',
  aspectRatio:   '16:9',
  resolution:    '1920x1080',
  quality:       'Ultra HD',
  titleSafeArea: 35,
  model:         'gemini-2.0-flash-preview-image-generation',
  textOverlay:   { ...DEFAULT_TEXT_OVERLAY },
};

/* ── Load / Save / Validate ───────────────────────────────────────── */

/**
 * Load the Thumbnail Brain configuration from localStorage.
 * Falls back to DEFAULT_CONFIG for any missing keys.
 */
export function loadConfig() {
  try {
    const saved = localStorage.getItem(THUMB_BRAIN_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        textOverlay: { ...DEFAULT_TEXT_OVERLAY, ...(parsed.textOverlay || {}) },
      };
    }
  } catch {}
  return { ...DEFAULT_CONFIG, textOverlay: { ...DEFAULT_TEXT_OVERLAY } };
}

/**
 * Persist the current configuration to localStorage.
 */
export function saveConfig(config) {
  localStorage.setItem(THUMB_BRAIN_KEY, JSON.stringify(config));
}

/**
 * Check whether the user has ever saved a custom configuration.
 */
export function isConfigSaved() {
  return !!localStorage.getItem(THUMB_BRAIN_KEY);
}

/**
 * Validate a configuration object, filling in any missing keys
 * with defaults. Returns a clean, complete config.
 */
export function validateConfig(config) {
  return {
    defaultPrompt: config.defaultPrompt || DEFAULT_PROMPT,
    style:         STYLES.includes(config.style) ? config.style : DEFAULT_CONFIG.style,
    aspectRatio:   ASPECT_RATIOS.includes(config.aspectRatio) ? config.aspectRatio : DEFAULT_CONFIG.aspectRatio,
    resolution:    RESOLUTIONS.includes(config.resolution) ? config.resolution : DEFAULT_CONFIG.resolution,
    quality:       QUALITIES.includes(config.quality) ? config.quality : DEFAULT_CONFIG.quality,
    titleSafeArea: typeof config.titleSafeArea === 'number' ? config.titleSafeArea : DEFAULT_CONFIG.titleSafeArea,
    model:         MODELS.some(m => m.value === config.model) ? config.model : DEFAULT_CONFIG.model,
    textOverlay:   { ...DEFAULT_TEXT_OVERLAY, ...(config.textOverlay || {}) },
  };
}

