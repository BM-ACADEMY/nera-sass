export const THUMB_BRAIN_KEY = 'thumbnail_brain_config';

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

export const DEFAULT_CONFIG = {
  defaultPrompt: DEFAULT_PROMPT,
  style: 'Cinematic',
  aspectRatio: '16:9',
  resolution: '1920x1080',
  quality: 'Ultra HD',
  titleSafeArea: 35,
  model: 'gemini-2.5-flash-image'
};

export function loadThumbnailBrainConfig() {
  try {
    const saved = localStorage.getItem(THUMB_BRAIN_KEY);
    if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
  } catch {}
  return { ...DEFAULT_CONFIG };
}

export function buildFinalPrompt(config) {
  let basePrompt = config.defaultPrompt || DEFAULT_PROMPT;

  // Strip the Output section — we always rebuild it from current settings
  const outputIdx = basePrompt.indexOf('\n\nOutput:');
  if (outputIdx !== -1) {
    basePrompt = basePrompt.substring(0, outputIdx);
  }

  // Strip any existing title-safe-area instruction so the configured value
  // is the only one Gemini sees (avoids conflicting "35% / 40%" instructions)
  basePrompt = basePrompt.replace(
    /\n\nLeave approximately \d+% empty space for title placement\./g,
    ''
  );

  // Always include style — defaults to Cinematic which the base prompt already
  // implies, but include it explicitly for all values so it's unambiguous
  const styleSection = `\n\nStyle: ${config.style || 'Cinematic'} — apply ${(config.style || 'Cinematic').toLowerCase()} visual aesthetics, color palette, and mood.`;

  // Always write the configured title safe area
  const titleSafeNote = `\n\nLeave approximately ${config.titleSafeArea ?? 35}% empty space for title text placement.`;

  const resolution = config.resolution ? config.resolution.replace('x', '×') : '1920×1080';
  const outputSection = [
    '\n\nOutput:',
    `\nAspect Ratio: ${config.aspectRatio || '16:9'}`,
    `\nResolution: ${resolution}`,
    `\nQuality: ${config.quality || 'Ultra HD'}`,
    `\nModel: ${config.model || 'gemini-2.5-flash-image'}`,
    '\nFormat: Professional YouTube Thumbnail',
  ].join('');

  return basePrompt + styleSection + titleSafeNote + outputSection;
}
