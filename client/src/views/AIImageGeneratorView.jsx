import { useState, useRef } from 'react';
import { Wand2, Download, RefreshCw, Sparkles, ImageIcon } from 'lucide-react';
import { C } from '../constants/theme.js';
import { api } from '../services/api.js';

const MODELS = [
  { value: 'gemini-3.1-flash-image',      label: 'Gemini 3.1 Flash', badge: '⭐ Recommended', desc: 'General-purpose, fast' },
  { value: 'gemini-3.1-flash-lite-image', label: 'Gemini 3.1 Flash Lite', badge: 'Fast', desc: 'Low-cost, quick' },
  { value: 'gemini-3-pro-image',          label: 'Gemini 3 Pro', badge: 'Pro', desc: 'Highest quality' },
  { value: 'gemini-2.5-flash-image',      label: 'Gemini 2.5 Flash', badge: 'Legacy', desc: 'Previous generation' },
];

const STYLES = [
  'Photorealistic', 'Cinematic', 'Digital Art', 'Anime',
  'Oil Painting', 'Watercolor', 'Sketch', '3D Render',
];

const ASPECT_RATIOS = [
  { label: '1:1', desc: 'Square' },
  { label: '16:9', desc: 'Landscape' },
  { label: '9:16', desc: 'Portrait' },
  { label: '4:3', desc: 'Classic' },
];

const EXAMPLE_PROMPTS = [
  'A futuristic city skyline at golden hour, flying cars, neon lights reflecting on glass towers',
  'A lone astronaut standing on Mars, looking back at Earth, dramatic lighting',
  'A cozy coffee shop interior with rain outside the window, warm ambient lighting',
  'A majestic dragon perched on a mountain peak, lightning storm in the background',
  'A minimalist product shot of a sleek smartphone on a dark gradient background',
];

export const AIImageGeneratorView = () => {
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('gemini-3.1-flash-image');
  const [style, setStyle] = useState('Photorealistic');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const textareaRef = useRef(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('Please enter a prompt to generate an image.');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const res = await api.generateAIImage(prompt.trim(), aspectRatio, style, model);
      if (res.success && res.image_url) {
        setImageUrl(res.image_url);
        setHistory(prev => [{ url: res.image_url, prompt: prompt.trim(), style, aspectRatio }, ...prev.slice(0, 7)]);
      } else {
        setError('Generation failed. Please try again.');
      }
    } catch (err) {
      setError(err.message || 'Failed to generate image. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleGenerate();
    }
  };

  const handleDownload = async () => {
    if (!imageUrl) return;
    try {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-image-${Date.now()}.jpg`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      window.open(imageUrl, '_blank');
    }
  };

  const useExample = (ex) => {
    setPrompt(ex);
    textareaRef.current?.focus();
  };

  return (
    <div style={{ height: '100%', overflow: 'auto', background: C.bg, padding: '28px 32px' }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: `linear-gradient(135deg, ${C.purple}, #6d28d9)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Wand2 size={20} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, fontFamily: "'Syne', sans-serif" }}>AI Image Generator</h1>
            <p style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Generate stunning images from any text description · Powered by Gemini</p>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 420px', gap: 24, alignItems: 'start' }}>

        {/* Left — Prompt + Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Prompt Input */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={14} color={C.purple} />
              <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Your Prompt</span>
            </div>
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe the image you want to create in detail...&#10;&#10;Example: A futuristic city skyline at golden hour with flying cars and neon lights"
              style={{
                width: '100%',
                minHeight: 160,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                resize: 'vertical',
                color: C.text,
                fontSize: 14,
                lineHeight: 1.6,
                padding: '8px 16px 16px',
                fontFamily: "'DM Sans', sans-serif",
              }}
            />
            <div style={{ borderTop: `1px solid ${C.border}`, padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: C.muted }}>{prompt.length} chars · Ctrl+Enter to generate</span>
              <button
                onClick={() => setPrompt('')}
                style={{ background: 'transparent', border: 'none', color: C.muted, fontSize: 11, cursor: 'pointer', padding: '2px 6px', borderRadius: 4 }}
              >
                Clear
              </button>
            </div>
          </div>

          {/* Model Selector */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px' }}>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>AI Model</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {MODELS.map(m => (
                <button
                  key={m.value}
                  onClick={() => setModel(m.value)}
                  style={{
                    padding: '10px 8px',
                    borderRadius: 10,
                    border: `1px solid ${model === m.value ? C.purple : C.border}`,
                    background: model === m.value ? C.purple + '22' : 'transparent',
                    color: model === m.value ? '#a78bfa' : C.muted,
                    fontSize: 11,
                    fontWeight: model === m.value ? 700 : 400,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                    textAlign: 'center',
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 8, background: model === m.value ? C.purple + '33' : C.border + '55', color: model === m.value ? '#c4b5fd' : C.muted, fontWeight: 700 }}>{m.badge}</span>
                  <span style={{ lineHeight: 1.3 }}>{m.label}</span>
                  <span style={{ fontSize: 9, color: C.dim }}>{m.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Options Row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

            {/* Style */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px' }}>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Art Style</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {STYLES.map(s => (
                  <button
                    key={s}
                    onClick={() => setStyle(s)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 20,
                      border: `1px solid ${style === s ? C.purple : C.border}`,
                      background: style === s ? C.purple + '22' : 'transparent',
                      color: style === s ? '#a78bfa' : C.muted,
                      fontSize: 11,
                      fontWeight: style === s ? 600 : 400,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Aspect Ratio */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px' }}>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Aspect Ratio</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {ASPECT_RATIOS.map(r => (
                  <button
                    key={r.label}
                    onClick={() => setAspectRatio(r.label)}
                    style={{
                      flex: 1,
                      padding: '8px 4px',
                      borderRadius: 10,
                      border: `1px solid ${aspectRatio === r.label ? C.purple : C.border}`,
                      background: aspectRatio === r.label ? C.purple + '22' : 'transparent',
                      color: aspectRatio === r.label ? '#a78bfa' : C.muted,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 2,
                      transition: 'all 0.15s',
                    }}
                  >
                    <span>{r.label}</span>
                    <span style={{ fontSize: 9, fontWeight: 400 }}>{r.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={loading || !prompt.trim()}
            style={{
              width: '100%',
              padding: '14px',
              borderRadius: 12,
              border: 'none',
              background: loading || !prompt.trim()
                ? C.border
                : `linear-gradient(135deg, ${C.purple}, #6d28d9)`,
              color: loading || !prompt.trim() ? C.muted : '#fff',
              fontSize: 14,
              fontWeight: 700,
              cursor: loading || !prompt.trim() ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              transition: 'all 0.2s',
              boxShadow: loading || !prompt.trim() ? 'none' : '0 4px 20px rgba(139,92,246,0.35)',
            }}
          >
            {loading ? (
              <>
                <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid #fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                Generating your image...
              </>
            ) : (
              <>
                <Wand2 size={16} />
                Generate Image
              </>
            )}
          </button>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

          {/* Error */}
          {error && (
            <div style={{ background: '#2d1010', border: `1px solid ${C.red}33`, borderRadius: 10, padding: '12px 14px', color: C.red, fontSize: 13 }}>
              {error}
            </div>
          )}

          {/* Example Prompts */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px' }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Example Prompts</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {EXAMPLE_PROMPTS.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => useExample(ex)}
                  style={{
                    background: 'transparent',
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    padding: '8px 12px',
                    color: C.muted,
                    fontSize: 12,
                    textAlign: 'left',
                    cursor: 'pointer',
                    lineHeight: 1.4,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = C.purple; e.currentTarget.style.color = C.text; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
                >
                  "{ex}"
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right — Generated Image */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 0 }}>

          {/* Image Preview */}
          <div style={{
            background: C.surface,
            border: `1px solid ${imageUrl ? C.purple + '44' : C.border}`,
            borderRadius: 16,
            overflow: 'hidden',
            minHeight: 360,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}>
            {loading && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: C.surface, zIndex: 2, gap: 16 }}>
                <div style={{ width: 48, height: 48, border: `3px solid ${C.border}`, borderTop: `3px solid ${C.purple}`, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <div style={{ textAlign: 'center' }}>
                  <p style={{ color: C.text, fontSize: 14, fontWeight: 600 }}>Creating your image...</p>
                  <p style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>This may take 10–30 seconds</p>
                </div>
              </div>
            )}

            {imageUrl && !loading ? (
              <img
                src={imageUrl}
                alt="AI Generated"
                style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 16 }}
              />
            ) : !loading ? (
              <div style={{ textAlign: 'center', padding: 32 }}>
                <ImageIcon size={48} color={C.border} style={{ marginBottom: 12 }} />
                <p style={{ color: C.muted, fontSize: 14 }}>Your generated image will appear here</p>
                <p style={{ color: C.dim, fontSize: 12, marginTop: 4 }}>Enter a prompt and click Generate</p>
              </div>
            ) : null}
          </div>

          {/* Action Buttons */}
          {imageUrl && !loading && (
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={handleGenerate}
                style={{
                  flex: 1,
                  padding: '11px',
                  borderRadius: 10,
                  border: `1px solid ${C.border}`,
                  background: C.surface,
                  color: C.text,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <RefreshCw size={14} />
                Regenerate
              </button>
              <button
                onClick={handleDownload}
                style={{
                  flex: 1,
                  padding: '11px',
                  borderRadius: 10,
                  border: 'none',
                  background: `linear-gradient(135deg, ${C.purple}, #6d28d9)`,
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  boxShadow: '0 4px 16px rgba(139,92,246,0.3)',
                }}
              >
                <Download size={14} />
                Download
              </button>
            </div>
          )}

          {/* History */}
          {history.length > 1 && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px' }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Recent Generations</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {history.slice(1).map((item, i) => (
                  <button
                    key={i}
                    onClick={() => setImageUrl(item.url)}
                    style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', cursor: 'pointer', padding: 0, background: 'transparent' }}
                    title={item.prompt}
                  >
                    <img src={item.url} alt="" style={{ width: '100%', height: 60, objectFit: 'cover', display: 'block' }} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
