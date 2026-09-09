/**
 * Canvas Text Overlay & Google Fonts Utility for Thumbnail Brain
 * 
 * Provides:
 * 1. Dynamic Google Fonts loader
 * 2. Intelligent marketing copy extractor (Title, Subtitle, CTA Badge)
 * 3. High-resolution canvas renderer for complete promotional marketing thumbnails
 */

export const POPULAR_GOOGLE_FONTS = [
  { name: 'Anton', category: 'Display', weight: '400', style: 'Bold Impact' },
  { name: 'Bebas Neue', category: 'Display', weight: '400', style: 'Clean Tall' },
  { name: 'Montserrat', category: 'Sans-Serif', weight: '900', style: 'Modern Heavy' },
  { name: 'Outfit', category: 'Sans-Serif', weight: '800', style: 'Sleek Tech' },
  { name: 'Oswald', category: 'Sans-Serif', weight: '700', style: 'Condensed' },
  { name: 'Poppins', category: 'Sans-Serif', weight: '800', style: 'Friendly Bold' },
  { name: 'Inter', category: 'Sans-Serif', weight: '900', style: 'Clean Minimal' },
  { name: 'Playfair Display', category: 'Serif', weight: '900', style: 'Luxury Serif' },
  { name: 'Space Grotesk', category: 'Sans-Serif', weight: '700', style: 'Futuristic' },
  { name: 'Roboto', category: 'Sans-Serif', weight: '900', style: 'Standard Bold' },
];

const loadedFonts = new Set();

/**
 * Dynamically loads a Google Font into the DOM
 */
export async function loadGoogleFont(fontFamily) {
  if (!fontFamily || loadedFonts.has(fontFamily)) return true;
  
  const fontObj = POPULAR_GOOGLE_FONTS.find(f => f.name.toLowerCase() === fontFamily.toLowerCase());
  const weight = fontObj ? fontObj.weight : '700';

  return new Promise((resolve) => {
    try {
      const linkId = `google-font-${fontFamily.replace(/\s+/g, '-').toLowerCase()}`;
      if (!document.getElementById(linkId)) {
        const link = document.createElement('link');
        link.id = linkId;
        link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontFamily)}:wght@${weight}&display=swap`;
        document.head.appendChild(link);
      }

      if (document.fonts) {
        document.fonts.load(`1em "${fontFamily}"`).then(() => {
          loadedFonts.add(fontFamily);
          resolve(true);
        }).catch(() => {
          loadedFonts.add(fontFamily);
          resolve(true);
        });
      } else {
        setTimeout(() => {
          loadedFonts.add(fontFamily);
          resolve(true);
        }, 300);
      }
    } catch (e) {
      console.warn('Font loading fallback triggered:', e);
      resolve(false);
    }
  });
}

/**
 * Extracts a short punchy headline from text — used by ThumbnailBrainStudio live preview.
 * For actual thumbnail generation, text comes from the AI (server-side Gemini call).
 */
export function extractPunchyHeadline(text, fallback = 'HOW TO SETUP') {
  if (!text || typeof text !== 'string' || !text.trim()) return fallback;
  const cleaned = text.replace(/http[s]?:\/\/\S+/g, '').replace(/[#@]\w+/g, '').replace(/[^\w\s-]/g, ' ').trim();
  if (!cleaned) return fallback;
  const lower = cleaned.toLowerCase();
  if (lower.includes('how to setup') || lower.includes('setup guide') || lower.includes('how to set up')) return 'HOW TO SETUP';
  if (lower.includes('step by step') || lower.includes('full tutorial')) return 'STEP BY STEP';
  if (lower.includes('masterclass') || lower.includes('complete guide')) return 'COMPLETE GUIDE';
  if (lower.includes('secret') || lower.includes('hacks')) return 'PRO SECRETS';
  const words = cleaned.split(/\s+/).filter(w => w.length > 1);
  if (words.length === 0) return fallback;
  const headline = words.slice(0, Math.min(words.length, 4)).join(' ').toUpperCase();
  return headline.length > 28 ? headline.substring(0, 28) + '...' : headline;
}

/**
 * Keyword-based fallback text extractor — used by ThumbnailGenerationFlow/Studio live preview only.
 * For actual thumbnail generation, text comes from the AI (server-side Gemini call).
 */
export function extractMarketingCopy(text) {
  const title = extractPunchyHeadline(text, 'BECOME AN EXPERT');
  let subtitle = 'Step-by-Step Masterclass';
  let cta = 'Admissions Open';
  if (text && typeof text === 'string') {
    const lower = text.toLowerCase();
    if (lower.includes('placement') || lower.includes('job') || lower.includes('career')) {
      subtitle = 'Placement Assistance Included';
    } else if (lower.includes('free') || lower.includes('workshop')) {
      subtitle = 'Free Live Masterclass';
      cta = 'Free Workshop';
    } else if (lower.includes('discount') || lower.includes('offer') || lower.includes('scholarship')) {
      cta = '85% Scholarship';
    } else if (lower.includes('limited') || lower.includes('seats')) {
      cta = 'Limited Seats';
    }
  }
  return { title, subtitle, cta };
}

/**
 * Renders full marketing thumbnail text stack (Title + Subtitle + CTA Badge) onto base frame.
 */
export async function renderTextOverlayCanvas(imageSrc, textConfig = {}) {
  const {
    text = '',
    title = '',
    subtitle = '',
    ctaBadge = '',
    fontFamily = 'Anton',
    fontSize = 54,
    textColor = '#FFFFFF',
    strokeColor = '#000000',
    strokeWidth = 6,
    bgColor = 'rgba(249, 115, 22, 0.95)', // Orange accent pill for title
    subBgColor = 'rgba(15, 23, 42, 0.9)', // Slate dark pill for subtitle
    subTextColor = '#E2E8F0',
    ctaBgColor = '#10B981', // Emerald green badge for CTA
    ctaTextColor = '#FFFFFF',
    bgPadding = 14,
    borderRadius = 8,
    shadowColor = 'rgba(0, 0, 0, 0.75)',
    shadowBlur = 14,
    position = 'top_left',
    canvasWidth = 0,
    canvasHeight = 0,
    showBgPill = true,
    showSubtitle = true,
    showCtaBadge = true,
  } = textConfig;

  const mainTitle = (title || text || '').trim().toUpperCase();
  const subText = (subtitle || '').trim();
  const ctaText = (ctaBadge || '').trim().toUpperCase();

  await loadGoogleFont(fontFamily);
  await loadGoogleFont('Montserrat');

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const w = canvasWidth || img.naturalWidth;
      const h = canvasHeight || img.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');

      // Draw base frame image
      ctx.drawImage(img, 0, 0, w, h);

      if (!mainTitle) {
        resolve(canvas.toDataURL('image/png'));
        return;
      }

      const fontObj = POPULAR_GOOGLE_FONTS.find(f => f.name.toLowerCase() === fontFamily.toLowerCase());
      const fontWeight = fontObj ? fontObj.weight : '800';

      const scale = w / 1280;
      const scaledTitleSize = fontSize * scale;
      const scaledSubSize = Math.max(18, Math.round(fontSize * 0.42)) * scale;
      const scaledCtaSize = 16 * scale;

      ctx.font = `${fontWeight} ${scaledTitleSize}px "${fontFamily}", sans-serif`;
      ctx.textBaseline = 'top';

      const titleMetrics = ctx.measureText(mainTitle);
      const titleWidth = titleMetrics.width;
      const titleHeight = scaledTitleSize * 1.1;

      // Calculate base position margins
      const marginX = w * 0.05;
      const marginY = h * 0.06;

      // Pre-calculate each layer's height so bottom/center positions
      // anchor the ENTIRE stack, not just the title.
      const ctaLayerH = showCtaBadge && ctaText
        ? (scaledCtaSize + (14 * scale)) + (12 * scale)
        : 0;
      const subLayerH = showSubtitle && subText
        ? (scaledSubSize + (12 * scale))
        : 0;
      const stackH = ctaLayerH + titleHeight + (10 * scale) + subLayerH;

      let startX = marginX;
      let startY = marginY;

      switch (position) {
        case 'top_center':
          startX = (w - titleWidth) / 2;
          startY = marginY;
          break;
        case 'top_right':
          startX = w - titleWidth - marginX - (bgPadding * 2);
          startY = marginY;
          break;
        case 'center':
          startX = (w - titleWidth) / 2;
          startY = (h - stackH) / 2;
          break;
        case 'bottom_left':
          startX = marginX;
          startY = h - stackH - marginY;
          break;
        case 'bottom_center':
          startX = (w - titleWidth) / 2;
          startY = h - stackH - marginY;
          break;
        case 'top_left':
        default:
          startX = marginX;
          startY = marginY;
          break;
      }

      let currentY = startY;

      // ── 1. DRAW CTA BADGE (IF ENABLED) ─────────────────────────────────
      if (showCtaBadge && ctaText) {
        ctx.font = `800 ${scaledCtaSize}px "Montserrat", sans-serif`;
        const fullCtaLabel = `★  ${ctaText}`;
        const ctaMetrics = ctx.measureText(fullCtaLabel);
        const ctaW = ctaMetrics.width + (24 * scale);
        const ctaH = scaledCtaSize + (14 * scale);
        const ctaR = ctaH / 2;

        const ctaX = startX;
        const ctaY = currentY;

        // Shadow
        ctx.shadowColor = shadowColor;
        ctx.shadowBlur = shadowBlur * scale;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 3;

        // CTA Pill Background
        ctx.fillStyle = ctaBgColor;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(ctaX, ctaY, ctaW, ctaH, ctaR) : ctx.rect(ctaX, ctaY, ctaW, ctaH);
        ctx.fill();

        // CTA Text
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = ctaTextColor;
        ctx.fillText(fullCtaLabel, ctaX + (12 * scale), ctaY + (7 * scale));

        currentY += ctaH + (12 * scale);
      }

      // ── 2. DRAW MAIN TITLE ──────────────────────────────────────────────
      ctx.font = `${fontWeight} ${scaledTitleSize}px "${fontFamily}", sans-serif`;

      // Draw Title Shadow
      if (shadowColor && shadowBlur > 0) {
        ctx.shadowColor = shadowColor;
        ctx.shadowBlur = shadowBlur * scale;
        ctx.shadowOffsetX = 3;
        ctx.shadowOffsetY = 5;
      }

      // Draw Title Pill Banner if enabled
      if (showBgPill && bgColor) {
        const pillX = startX - bgPadding;
        const pillY = currentY - (bgPadding / 2);
        const pillW = titleWidth + (bgPadding * 2);
        const pillH = titleHeight + bgPadding;
        const r = borderRadius;

        ctx.fillStyle = bgColor;
        ctx.beginPath();
        ctx.moveTo(pillX + r, pillY);
        ctx.lineTo(pillX + pillW - r, pillY);
        ctx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + r);
        ctx.lineTo(pillX + pillW, pillY + pillH - r);
        ctx.quadraticCurveTo(pillX + pillW, pillY + pillH, pillX + pillW - r, pillY + pillH);
        ctx.lineTo(pillX + r, pillY + pillH);
        ctx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - r);
        ctx.lineTo(pillX, pillY + r);
        ctx.quadraticCurveTo(pillX, pillY, pillX + r, pillY);
        ctx.closePath();
        ctx.fill();
      }

      ctx.shadowColor = 'transparent';

      // Draw Title Stroke Outline
      if (strokeWidth > 0 && strokeColor) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth * scale;
        ctx.lineJoin = 'round';
        ctx.strokeText(mainTitle, startX, currentY);
      }

      // Draw Title Text Fill
      ctx.fillStyle = textColor;
      ctx.fillText(mainTitle, startX, currentY);

      currentY += titleHeight + (10 * scale);

      // ── 3. DRAW SUBTITLE BANNER (IF ENABLED) ─────────────────────────────
      if (showSubtitle && subText) {
        ctx.font = `700 ${scaledSubSize}px "Montserrat", sans-serif`;
        const subMetrics = ctx.measureText(subText);
        const subW = subMetrics.width + (20 * scale);
        const subH = scaledSubSize + (12 * scale);

        const subX = startX;
        const subY = currentY;

        // Subtitle Pill Fill
        ctx.fillStyle = subBgColor;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(subX, subY, subW, subH, 6) : ctx.rect(subX, subY, subW, subH);
        ctx.fill();

        // Subtitle Text
        ctx.fillStyle = subTextColor;
        ctx.fillText(subText, subX + (10 * scale), subY + (6 * scale));
      }

      resolve(canvas.toDataURL('image/png'));
    };

    img.onerror = (err) => {
      console.error('Failed to load image for canvas overlay:', err);
      reject(err);
    };

    img.src = imageSrc;
  });
}
