/**
 * Thumbnail Brain — Style Presets
 *
 * Single responsibility: Define style presets that map style names
 * to descriptive aesthetic instructions for the AI model.
 */

const STYLE_PRESETS = {
  Cinematic: {
    name: 'Cinematic',
    aesthetic: 'dramatic cinematic lighting, film-grade color grading, rich shadows, lens flares, and depth of field',
    palette: 'warm tones with deep blacks and golden highlights',
  },
  Technology: {
    name: 'Technology',
    aesthetic: 'clean futuristic aesthetics, neon accents, digital overlays, and tech-inspired compositions',
    palette: 'cool blues, electric cyans, and dark metallic backgrounds',
  },
  AI: {
    name: 'AI',
    aesthetic: 'neural network inspired visuals, data-flow patterns, holographic effects, and futuristic AI aesthetics',
    palette: 'deep purples, glowing teals, and matrix-style greens',
  },
  Business: {
    name: 'Business',
    aesthetic: 'clean professional look, corporate elegance, sharp lighting, and polished presentation',
    palette: 'navy blues, whites, golds, and neutral tones',
  },
  Education: {
    name: 'Education',
    aesthetic: 'bright inviting visuals, clear focused composition, warm approachable lighting, and academic feel',
    palette: 'warm yellows, greens, sky blues, and soft whites',
  },
  Gaming: {
    name: 'Gaming',
    aesthetic: 'high-energy dynamic effects, RGB glow, action-packed composition, and bold visual impact',
    palette: 'neon reds, electric blues, vibrant purples, and dark backgrounds',
  },
  Podcast: {
    name: 'Podcast',
    aesthetic: 'intimate studio atmosphere, soft bokeh backgrounds, warm microphone-side lighting, and conversational mood',
    palette: 'warm ambers, deep browns, soft oranges, and muted backgrounds',
  },
  'Real Estate': {
    name: 'Real Estate',
    aesthetic: 'luxury property showcase, golden hour lighting, architectural composition, and aspirational feel',
    palette: 'warm golds, sky blues, lush greens, and cream whites',
  },
  Minimal: {
    name: 'Minimal',
    aesthetic: 'clean minimalist design, generous whitespace, subtle shadows, and focused subject emphasis',
    palette: 'monochrome with a single accent color, clean whites and soft grays',
  },
};

/**
 * Get the style preset for a given style name.
 * Falls back to Cinematic if the style is unknown.
 */
export function getStylePreset(styleName) {
  return STYLE_PRESETS[styleName] || STYLE_PRESETS.Cinematic;
}

/**
 * Build the style instruction string for the prompt.
 */
export function buildStyleInstruction(styleName) {
  const preset = getStylePreset(styleName);
  return `Style: ${preset.name} — apply ${preset.aesthetic}. Use a color palette of ${preset.palette}.`;
}

export { STYLE_PRESETS };
