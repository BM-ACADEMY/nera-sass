/**
 * Thumbnail Brain — Service Layer
 *
 * Single responsibility: Orchestrate thumbnail generation.
 * This is the ONLY entry point for generating thumbnails.
 *
 * Flow:
 *   1. Load the latest saved configuration
 *   2. Validate configuration
 *   3. Build the final prompt (with style, output settings, etc.)
 *   4. Call the Gemini Image API via the API client
 *   5. Return the result
 *
 * No component in the app should ever build prompts or select models
 * for thumbnail generation. They should call generateThumbnail() instead.
 */

import { api } from '../../src/services/api.js';
import { loadConfig, validateConfig, isConfigSaved } from './thumbnailBrainConfig.js';
import { buildFinalPrompt } from './thumbnailPromptBuilder.js';

/**
 * Generate a thumbnail from a selected video frame.
 *
 * This is the single public API that Approval Room (or any other
 * consumer) should call. It encapsulates the entire Thumbnail Brain
 * pipeline: config → prompt → style → context → output → API call.
 *
 * Approval Room must never build prompts, select models, or apply styles.
 * It only supplies the selected frame and content context.
 *
 * @param {Object} params
 * @param {string|number} params.contentId — The content queue item ID
 * @param {string} params.frameUrl — URL of the user-selected video frame
 * @param {string} [params.videoTitle] — Video title for prompt context
 * @param {string} [params.description] — Video description or caption for prompt context
 * @param {string} [params.category] — Optional content category
 * @returns {Promise<{success: boolean, poster_url?: string}>}
 */
export async function generateThumbnail({ contentId, frameUrl, videoTitle = '', description = '', category = '' }) {
  // ── Step 1: Load the latest saved configuration ───────────────
  // Prefer server API (Studio config) over localStorage (classic config).
  // validateConfig() applies correct defaults (Cinematic, 16:9, etc.) for any
  // fields not present in the Studio format, so old localStorage values are bypassed.
  let rawConfig;
  let configSource = 'defaults';
  try {
    const { config: serverCfg } = await api.getThumbnailBrainConfig();
    if (serverCfg && typeof serverCfg === 'object') {
      rawConfig = serverCfg;
      configSource = 'server';
    } else {
      rawConfig = loadConfig();
      configSource = isConfigSaved() ? 'localStorage' : 'defaults';
    }
  } catch (_) {
    rawConfig = loadConfig();
    configSource = isConfigSaved() ? 'localStorage' : 'defaults';
  }
  // Studio format stores model under aiEngine.model; classic format stores it under model.
  // Normalise so validateConfig always sees config.model.
  if (rawConfig.aiEngine?.model && !rawConfig.model) {
    rawConfig = { ...rawConfig, model: rawConfig.aiEngine.model };
  }
  const config = validateConfig(rawConfig);

  // ── Step 2: Build the final prompt (with style, output settings, and content context) ──
  const runtimeVars = { videoTitle, description, category };
  const prompt = buildFinalPrompt(config, runtimeVars);

  // ── Step 3: Debug logs ────────────────────────────────────────
  console.log('────────────────────────────────────────────────────────');
  console.log('[ThumbnailBrain] Config Loaded:');
  console.log('  Source:         ', configSource);
  console.log('  Style:          ', config.style);
  console.log('  Aspect Ratio:   ', config.aspectRatio);
  console.log('  Resolution:     ', config.resolution);
  console.log('  Quality:        ', config.quality);
  console.log('  Title Safe Area:', config.titleSafeArea + '%');
  console.log('  Model:          ', config.model);
  console.log('');
  console.log('[ThumbnailBrain] Content Context:');
  console.log('  Video Title:', videoTitle || '(none)');
  console.log('  Description:', description ? description.substring(0, 80) + '…' : '(none)');
  console.log('  Category:   ', category || '(none)');
  console.log('');
  console.log('[ThumbnailBrain] Final Prompt:');
  console.log(prompt);
  console.log('');
  console.log('[ThumbnailBrain] Request Payload:');
  console.log('  Content ID:', contentId);
  console.log('  Frame URL: ', frameUrl);
  console.log('  Prompt:    ', prompt.length, 'chars');
  console.log('  Model:     ', config.model);
  console.log('────────────────────────────────────────────────────────');

  // ── Step 4: Call the Gemini Image API ────────────────────────
  const res = await api.generatePoster(contentId, frameUrl, prompt, config.model, config, description);

  return res;
}
