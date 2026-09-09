/**
 * Thumbnail Brain — Public API
 *
 * This is the single entry point for all Thumbnail Brain functionality.
 * Other modules should import from here, never from internal files.
 *
 * Usage:
 *   import { generateThumbnail } from './thumbnailBrain';
 *   const res = await generateThumbnail({ contentId, frameUrl, videoTitle, description });
 */

// ── Service (the main entry point) ──────────────────────────────
export { generateThumbnail } from './thumbnailBrainService.js';

// ── Configuration ───────────────────────────────────────────────
export {
  THUMB_BRAIN_KEY,
  DEFAULT_CONFIG,
  DEFAULT_PROMPT,
  STYLES,
  ASPECT_RATIOS,
  RESOLUTIONS,
  QUALITIES,
  MODELS,
  loadConfig,
  saveConfig,
  isConfigSaved,
  validateConfig,
} from './thumbnailBrainConfig.js';

// ── Prompt Builder ──────────────────────────────────────────────
export { buildFinalPrompt } from './thumbnailPromptBuilder.js';

// ── Style Presets ───────────────────────────────────────────────
export { STYLE_PRESETS, getStylePreset, buildStyleInstruction } from './thumbnailStyles.js';
