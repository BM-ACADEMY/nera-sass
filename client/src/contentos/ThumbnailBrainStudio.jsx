import { useState, useEffect, useCallback } from 'react';
import {
  Cpu, Monitor, Palette, FileText, User, LayoutGrid, Lightbulb,
  Type, ImageIcon, Droplets, Target, MinusCircle, FlaskConical,
  History, BarChart2, Save, RefreshCw, Plus, Trash2, Edit2, Check,
  X, Copy, RotateCcw, Zap, Eye, Brain, ChevronRight,
} from 'lucide-react';
import { api } from '../src/services/api.js';
import { POPULAR_GOOGLE_FONTS, loadGoogleFont, renderTextOverlayCanvas, extractPunchyHeadline } from '../src/utils/canvasTextOverlay.js';


// ── Theme ──────────────────────────────────────────────────────────────────
const C = {
  bg: '#060c17', surface: '#0c1525', card: '#101c30', border: '#1a2e4a',
  accent: '#f97316', blue: '#3b82f6', green: '#10b981', red: '#ef4444',
  purple: '#8b5cf6', text: '#e2e8f0', muted: '#475569', dim: '#1e293b',
};

// ── Static options ─────────────────────────────────────────────────────────
const TABS = [
  { id: 'ai-engine',      Icon: Cpu,          label: 'AI Engine' },
  { id: 'platforms',      Icon: Monitor,       label: 'Platform Profiles' },
  { id: 'brand-styles',   Icon: Palette,       label: 'Brand Styles' },
  { id: 'prompt-builder', Icon: FileText,      label: 'Prompt Builder' },
  { id: 'subject',        Icon: User,          label: 'Subject Preservation' },
  { id: 'composition',    Icon: LayoutGrid,    label: 'Composition Rules' },
  { id: 'lighting',       Icon: Lightbulb,     label: 'Lighting' },
  { id: 'typography',     Icon: Type,          label: 'Typography' },
  { id: 'backgrounds',    Icon: ImageIcon,     label: 'Background Styles' },
  { id: 'colors',         Icon: Droplets,      label: 'Color Presets' },
  { id: 'goals',          Icon: Target,        label: 'Thumbnail Goals' },
  { id: 'negative',       Icon: MinusCircle,   label: 'Negative Prompts' },
  { id: 'test-studio',    Icon: FlaskConical,  label: 'Test Studio' },
  { id: 'versions',       Icon: History,       label: 'Version History' },
  { id: 'analytics',      Icon: BarChart2,     label: 'Analytics' },
];

const AI_MODELS = [
  { value: 'gemini-2.0-flash-preview-image-generation', label: 'Gemini 2.0 Flash Image', badge: '⭐ Recommended', color: C.accent },
  { value: 'gemini-2.0-flash-exp',                      label: 'Gemini 2.0 Flash Exp',   badge: 'Experimental',   color: C.green },
];

const COMPOSITION_OPTIONS = [
  { id: 'rule_of_thirds', label: 'Rule of Thirds' },
  { id: 'close_up',       label: 'Close-up' },
  { id: 'medium_shot',    label: 'Medium Shot' },
  { id: 'wide_shot',      label: 'Wide Shot' },
  { id: 'dynamic_angle',  label: 'Dynamic Angle' },
  { id: 'center_focus',   label: 'Center Focus' },
  { id: 'leading_lines',  label: 'Leading Lines' },
  { id: 'negative_space', label: 'Negative Space' },
];

const LIGHTING_OPTIONS = [
  { id: 'studio',       label: 'Studio',       emoji: '💡' },
  { id: 'soft',         label: 'Soft',         emoji: '☁️' },
  { id: 'natural',      label: 'Natural',      emoji: '☀️' },
  { id: 'golden_hour',  label: 'Golden Hour',  emoji: '🌅' },
  { id: 'dramatic',     label: 'Dramatic',     emoji: '🎭' },
  { id: 'neon',         label: 'Neon',         emoji: '🌆' },
  { id: 'cinematic',    label: 'Cinematic',    emoji: '🎬' },
];

const TYPOGRAPHY_OPTIONS = [
  { id: 'minimal',     label: 'Minimal',     desc: 'Clean, lightweight' },
  { id: 'bold',        label: 'Bold',        desc: 'High impact, strong' },
  { id: 'modern',      label: 'Modern',      desc: 'Geometric, sleek' },
  { id: 'luxury',      label: 'Luxury',      desc: 'Elegant, serif' },
  { id: 'educational', label: 'Educational', desc: 'Friendly, readable' },
  { id: 'gaming',      label: 'Gaming',      desc: 'Aggressive, neon' },
];

const BACKGROUND_OPTIONS = [
  'Gradient', 'Blur', 'Technology', 'Office',
  'Classroom', 'City', 'Luxury', 'Abstract', 'Nature',
];

const GOAL_OPTIONS = [
  { id: 'highest_ctr',    label: 'Highest CTR',     emoji: '📈' },
  { id: 'educational',    label: 'Educational',      emoji: '📚' },
  { id: 'professional',   label: 'Professional',     emoji: '💼' },
  { id: 'luxury',         label: 'Luxury',           emoji: '💎' },
  { id: 'curiosity',      label: 'Curiosity',        emoji: '🤔' },
  { id: 'emotional',      label: 'Emotional',        emoji: '❤️' },
  { id: 'breaking_news',  label: 'Breaking News',    emoji: '🔴' },
  { id: 'course',         label: 'Course Promotion', emoji: '🎓' },
  { id: 'tutorial',       label: 'Tutorial',         emoji: '🛠' },
  { id: 'announcement',   label: 'Announcement',     emoji: '📣' },
];

const NEGATIVE_OPTIONS = [
  { id: 'blurry',             label: 'Blurry' },
  { id: 'low_quality',        label: 'Low Quality' },
  { id: 'duplicate_faces',    label: 'Duplicate Faces' },
  { id: 'extra_hands',        label: 'Extra Hands' },
  { id: 'cropped_face',       label: 'Cropped Face' },
  { id: 'watermark',          label: 'Watermark' },
  { id: 'distorted_anatomy',  label: 'Distorted Anatomy' },
  { id: 'text_artifacts',     label: 'Text Artifacts' },
  { id: 'oversaturated',      label: 'Oversaturated' },
  { id: 'flat_lighting',      label: 'Flat Lighting' },
  { id: 'noise',              label: 'Noise / Grain' },
  { id: 'pixelated',          label: 'Pixelated' },
];

const DEFAULT_CONFIG = {
  aiEngine: { provider: 'google', model: 'gemini-2.0-flash-preview-image-generation', temperature: 0.7, maxTokens: 2048, imageQuality: 'ultra_hd', creativityLevel: 7, safetyLevel: 'moderate' },
  subjectPreservation: { face: true, hair: true, expression: true, clothing: true, pose: true, cameraAngle: true, skinTone: true },
  compositionRules: ['rule_of_thirds', 'close_up'],
  lighting: ['cinematic'],
  typography: 'bold',
  backgroundStyle: 'Gradient',
  thumbnailGoal: 'highest_ctr',
  negativePrompts: ['blurry', 'low_quality', 'watermark', 'text_artifacts', 'duplicate_faces'],
  promptModules: {
    instructions: "You are an expert YouTube Thumbnail Designer and Creative Director.\n\nKeep the person's face, pose, clothing and identity exactly the same. Enhance HDR lighting, professional color grading, face sharpness, eye clarity, hair details, dynamic contrast, depth of field, ultra realistic quality. Apply subtle cinematic effects: rim lighting, lens flare, light rays, glow.\n\nOutput only the enhanced image. Do not generate text, logos, watermarks. Do not distort faces.",
  },
  defaultBrandStyleId: null,
  defaultPlatformSlug: 'youtube',
  titleSafeArea: 35,
};

// ── Shared UI helpers ──────────────────────────────────────────────────────
const Chip = ({ label, active, onClick, color = C.accent }) => (
  <button onClick={onClick} style={{ padding: '6px 14px', borderRadius: 20, border: `1px solid ${active ? color : C.border}`, background: active ? color + '22' : 'transparent', color: active ? color : C.muted, fontSize: 12, fontWeight: active ? 600 : 400, cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
    {label}
  </button>
);

const SectionCard = ({ title, subtitle, children }) => (
  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 22px', marginBottom: 16 }}>
    {title && <div style={{ marginBottom: 16 }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{title}</p>
      {subtitle && <p style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{subtitle}</p>}
    </div>}
    {children}
  </div>
);

const Toggle = ({ checked, onChange, label, desc }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
    <div>
      <p style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>{label}</p>
      {desc && <p style={{ fontSize: 11, color: C.muted }}>{desc}</p>}
    </div>
    <button onClick={() => onChange(!checked)} style={{ width: 44, height: 24, borderRadius: 12, border: 'none', background: checked ? C.accent : C.border, cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: 3, left: checked ? 22 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
    </button>
  </div>
);

const Input = ({ label, value, onChange, type = 'text', placeholder, min, max, step }) => (
  <div style={{ marginBottom: 12 }}>
    {label && <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{label}</label>}
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} min={min} max={max} step={step}
      style={{ width: '100%', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', color: C.text, fontSize: 13, outline: 'none', fontFamily: 'DM Sans, sans-serif' }} />
  </div>
);

// ── Main Studio Component ──────────────────────────────────────────────────
export const ThumbnailBrainStudio = () => {
  const [activeTab, setActiveTab] = useState('ai-engine');
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [platforms, setPlatforms] = useState([]);
  const [brandStyles, setBrandStyles] = useState([]);
  const [versions, setVersions] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [versionName, setVersionName] = useState('');

  // Load all data on mount
  useEffect(() => {
    const load = async () => {
      try {
        const [cfgRes, platRes, brandRes] = await Promise.all([
          api.getThumbnailBrainConfig(),
          api.getThumbnailBrainSocialPlatforms(),
          api.getThumbnailBrainSocialBrandStyles(),
        ]);
        if (cfgRes.config) setConfig({ ...DEFAULT_CONFIG, ...cfgRes.config });
        if (platRes.platforms) setPlatforms(platRes.platforms);
        if (brandRes.brandStyles) setBrandStyles(brandRes.brandStyles);
      } catch (err) {
        console.error('[ThumbnailBrainStudio] load error:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (activeTab === 'versions') {
      api.getThumbnailBrainVersions().then(r => setVersions(r.versions || [])).catch(() => {});
    }
    if (activeTab === 'analytics') {
      api.getThumbnailBrainAnalytics().then(r => setAnalytics(r)).catch(() => {});
    }
  }, [activeTab]);

  const updateConfig = useCallback((path, value) => {
    setConfig(prev => {
      const next = { ...prev };
      const parts = path.split('.');
      let obj = next;
      for (let i = 0; i < parts.length - 1; i++) {
        obj[parts[i]] = { ...obj[parts[i]] };
        obj = obj[parts[i]];
      }
      obj[parts[parts.length - 1]] = value;
      return next;
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.saveThumbnailBrainConfig(config, versionName || undefined);
      // Mirror textOverlay settings to localStorage so ApprovalRoom picks up position, font, etc.
      try {
        const existing = JSON.parse(localStorage.getItem('thumbnail_brain_config') || '{}');
        localStorage.setItem('thumbnail_brain_config', JSON.stringify({ ...existing, textOverlay: config.textOverlay }));
      } catch (_) {}
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const buildFinalPrompt = () => {
    const instructions = config.promptModules?.instructions || '';
    const subj = config.subjectPreservation || {};
    const preserved = Object.entries(subj).filter(([, v]) => v).map(([k]) => k.replace(/([A-Z])/g, ' $1').trim()).join(', ');
    const negatives = (config.negativePrompts || []).join(', ');
    const composition = (config.compositionRules || []).map(r => r.replace(/_/g, ' ')).join(', ');
    const lighting = (config.lighting || []).map(l => l.replace(/_/g, ' ')).join(', ');

    return [
      instructions,
      preserved   ? `Preserve exactly: ${preserved}.`                                         : '',
      composition ? `Composition: ${composition}.`                                             : '',
      lighting    ? `Lighting: ${lighting} style.`                                             : '',
      `Background style: ${config.backgroundStyle || 'gradient'}.`,
      `Typography style: ${config.typography || 'bold'}.`,
      `Goal: Optimized for ${(config.thumbnailGoal || 'ctr').replace(/_/g, ' ')}.`,
      `Leave approximately ${config.titleSafeArea || 35}% empty space for title text.`,
      negatives   ? `Negative prompt: ${negatives}.`                                           : '',
    ].filter(Boolean).join('\n\n');
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: C.muted }}>
      <Brain size={20} style={{ marginRight: 8 }} /> Loading Thumbnail Brain Studio...
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.bg, overflow: 'hidden' }}>

      {/* TOP BAR */}
      <div style={{ padding: '12px 24px', borderBottom: `1px solid ${C.border}`, background: C.surface, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, background: `linear-gradient(135deg, ${C.accent}, #ea580c)`, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Brain size={14} color="#fff" />
          </div>
          <div>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
              {TABS.find(t => t.id === activeTab)?.label}
            </h2>
            <p style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>Thumbnail Brain · All settings persist to database</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input value={versionName} onChange={e => setVersionName(e.target.value)} placeholder="Version name (optional)" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 12px', color: C.text, fontSize: 12, outline: 'none', width: 190 }} />
          <button onClick={handleSave} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 9, border: 'none', background: saved ? C.green : `linear-gradient(135deg, ${C.accent}, #ea580c)`, color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
            {saved ? <><Check size={14} /> Saved!</> : saving ? <><RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : <><Save size={14} /> Save Config</>}
          </button>
        </div>
      </div>

      {/* HORIZONTAL TAB NAV */}
      <div style={{ borderBottom: `1px solid ${C.border}`, background: C.surface, flexShrink: 0, overflowX: 'auto' }}>
        <div style={{ display: 'flex', padding: '0 16px', gap: 2, minWidth: 'max-content' }}>
          {TABS.map(({ id, Icon, label }) => {
            const active = activeTab === id;
            return (
              <button key={id} onClick={() => setActiveTab(id)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', border: 'none', borderBottom: `2px solid ${active ? C.accent : 'transparent'}`, background: 'transparent', color: active ? C.accent : C.muted, fontSize: 12, fontWeight: active ? 700 : 400, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s', marginBottom: -1 }}>
                <Icon size={13} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB CONTENT */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        {activeTab === 'ai-engine'      && <AIEngineTab config={config} updateConfig={updateConfig} />}
        {activeTab === 'platforms'      && <PlatformsTab platforms={platforms} setPlatforms={setPlatforms} />}
        {activeTab === 'brand-styles'   && <BrandStylesTab brandStyles={brandStyles} setBrandStyles={setBrandStyles} />}
        {activeTab === 'prompt-builder' && <PromptBuilderTab config={config} updateConfig={updateConfig} buildFinalPrompt={buildFinalPrompt} />}
        {activeTab === 'subject'        && <SubjectTab config={config} updateConfig={updateConfig} />}
        {activeTab === 'composition'    && <CompositionTab config={config} updateConfig={updateConfig} />}
        {activeTab === 'lighting'       && <LightingTab config={config} updateConfig={updateConfig} />}
        {activeTab === 'typography'     && <TypographyTab config={config} updateConfig={updateConfig} />}
        {activeTab === 'backgrounds'    && <BackgroundsTab config={config} updateConfig={updateConfig} />}
        {activeTab === 'colors'         && <ColorsTab config={config} updateConfig={updateConfig} brandStyles={brandStyles} />}
        {activeTab === 'goals'          && <GoalsTab config={config} updateConfig={updateConfig} />}
        {activeTab === 'negative'       && <NegativeTab config={config} updateConfig={updateConfig} />}
        {activeTab === 'test-studio'    && <TestStudioTab config={config} platforms={platforms} brandStyles={brandStyles} buildFinalPrompt={buildFinalPrompt} />}
        {activeTab === 'versions'       && <VersionsTab versions={versions} setVersions={setVersions} setConfig={setConfig} />}
        {activeTab === 'analytics'      && <AnalyticsTab analytics={analytics} />}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

// ── TAB: AI Engine ─────────────────────────────────────────────────────────
const AIEngineTab = ({ config, updateConfig }) => {
  const ae = config.aiEngine || {};
  return (
    <div style={{ maxWidth: 800 }}>
      <SectionCard title="AI Provider & Model" subtitle="Select which AI model powers thumbnail generation">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 16 }}>
          {AI_MODELS.map(m => (
            <button key={m.value} onClick={() => updateConfig('aiEngine.model', m.value)}
              style={{ padding: '14px 16px', borderRadius: 12, border: `2px solid ${ae.model === m.value ? m.color : C.border}`, background: ae.model === m.value ? m.color + '18' : C.card, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: ae.model === m.value ? m.color : C.text }}>{m.label}</span>
                <span style={{ fontSize: 10, background: ae.model === m.value ? m.color + '33' : C.border, color: ae.model === m.value ? m.color : C.muted, padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>{m.badge}</span>
              </div>
              <p style={{ fontSize: 11, color: C.muted, marginTop: 4, fontFamily: 'monospace' }}>{m.value}</p>
            </button>
          ))}
        </div>
      </SectionCard>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <SectionCard title="Generation Parameters">
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 8 }}>Temperature — {ae.temperature}</label>
            <input type="range" min={0} max={1} step={0.05} value={ae.temperature || 0.7} onChange={e => updateConfig('aiEngine.temperature', parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: C.accent }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.muted, marginTop: 2 }}>
              <span>Focused</span><span>Creative</span>
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 8 }}>Creativity Level — {ae.creativityLevel}/10</label>
            <input type="range" min={1} max={10} step={1} value={ae.creativityLevel || 7} onChange={e => updateConfig('aiEngine.creativityLevel', parseInt(e.target.value))}
              style={{ width: '100%', accentColor: C.purple }} />
          </div>
          <div style={{ marginTop: 16 }}>
            <Input label="Max Tokens" type="number" value={ae.maxTokens || 2048} onChange={v => updateConfig('aiEngine.maxTokens', parseInt(v))} />
          </div>
        </SectionCard>

        <SectionCard title="Quality & Safety">
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 8 }}>Image Quality</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {['standard', 'hd', 'ultra_hd'].map(q => (
                <button key={q} onClick={() => updateConfig('aiEngine.imageQuality', q)}
                  style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${ae.imageQuality === q ? C.accent : C.border}`, background: ae.imageQuality === q ? C.accent + '18' : 'transparent', color: ae.imageQuality === q ? C.accent : C.muted, fontSize: 12, cursor: 'pointer', textAlign: 'left' }}>
                  {q.replace('_', ' ').toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 8 }}>Safety Level</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {['low', 'moderate', 'high'].map(s => (
                <button key={s} onClick={() => updateConfig('aiEngine.safetyLevel', s)}
                  style={{ flex: 1, padding: '8px 4px', borderRadius: 8, border: `1px solid ${ae.safetyLevel === s ? C.blue : C.border}`, background: ae.safetyLevel === s ? C.blue + '18' : 'transparent', color: ae.safetyLevel === s ? C.blue : C.muted, fontSize: 11, cursor: 'pointer', fontWeight: 500 }}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
};

// ── TAB: Platform Profiles — dynamic from social accounts ─────────────────
const PlatformsTab = ({ platforms, setPlatforms }) => {
  const [editingSlug, setEditingSlug] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  const startEdit = (p) => {
    setForm({
      aspect_ratio: p.aspect_ratio,
      width: p.width,
      height: p.height,
      safe_margin: p.safe_margin,
      text_scale: p.text_scale,
      optimization_notes: p.optimization_notes || '',
    });
    setEditingSlug(p.slug);
  };

  const handleSave = async (slug) => {
    setSaving(true);
    try {
      await api.saveThumbnailBrainPlatformOverride(slug, form);
      setPlatforms(ps => ps.map(p => p.slug === slug ? { ...p, ...form, has_override: true } : p));
      setEditingSlug(null);
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!platforms.length) return (
    <div style={{ textAlign: 'center', padding: '60px 0', color: C.muted }}>
      <Monitor size={40} color={C.border} style={{ marginBottom: 12 }} />
      <p style={{ fontSize: 14 }}>No connected social accounts found.</p>
      <p style={{ fontSize: 12, marginTop: 6 }}>Connect accounts in <strong style={{ color: C.text }}>Social Accounts</strong> to populate platform profiles automatically.</p>
    </div>
  );

  return (
    <div style={{ maxWidth: 960 }}>
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ color: C.text, fontSize: 15, fontWeight: 700 }}>Platform Profiles</h3>
        <p style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
          Auto-detected from your connected social accounts · {platforms.length} platform{platforms.length !== 1 ? 's' : ''} · Edit thumbnail dimensions per platform
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 14 }}>
        {platforms.map(p => {
          const isEditing = editingSlug === p.slug;
          return (
            <div key={p.slug} style={{ background: C.surface, border: `1px solid ${isEditing ? C.accent + '66' : C.border}`, borderRadius: 12, padding: 16, transition: 'border-color 0.15s' }}>

              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ width: 36, height: 36, background: (p.color || C.accent) + '22', border: `1px solid ${(p.color || C.accent) + '44'}`, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                  {p.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ color: C.text, fontWeight: 700, fontSize: 13 }}>{p.name}</p>
                  <p style={{ color: C.muted, fontSize: 11 }}>{p.aspect_ratio} · {p.width}×{p.height}px</p>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: 9, background: C.green + '22', color: C.green, padding: '3px 7px', borderRadius: 10, fontWeight: 700 }}>LIVE</span>
                  {!isEditing && (
                    <button onClick={() => startEdit(p)} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: '4px 10px', color: C.muted, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Edit2 size={11} /> Edit
                    </button>
                  )}
                </div>
              </div>

              {/* Brand tags */}
              {p.brands && p.brands.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
                  {p.brands.map(b => (
                    <span key={b} style={{ fontSize: 10, background: C.accent + '18', color: C.accent, padding: '2px 7px', borderRadius: 10 }}>{b}</span>
                  ))}
                </div>
              )}

              {/* Inline edit form */}
              {isEditing ? (
                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 4 }}>Width (px)</label>
                      <input type="number" value={form.width} onChange={e => setForm(f => ({ ...f, width: parseInt(e.target.value) }))}
                        style={{ width: '100%', background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 10px', color: C.text, fontSize: 13, outline: 'none' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 4 }}>Height (px)</label>
                      <input type="number" value={form.height} onChange={e => setForm(f => ({ ...f, height: parseInt(e.target.value) }))}
                        style={{ width: '100%', background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 10px', color: C.text, fontSize: 13, outline: 'none' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 4 }}>Aspect Ratio</label>
                      <input type="text" value={form.aspect_ratio} onChange={e => setForm(f => ({ ...f, aspect_ratio: e.target.value }))}
                        style={{ width: '100%', background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 10px', color: C.text, fontSize: 13, outline: 'none' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 4 }}>Safe Margin %</label>
                      <input type="number" step="1" value={form.safe_margin} onChange={e => setForm(f => ({ ...f, safe_margin: parseFloat(e.target.value) }))}
                        style={{ width: '100%', background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 10px', color: C.text, fontSize: 13, outline: 'none' }} />
                    </div>
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 4 }}>Text Scale</label>
                    <input type="number" step="0.1" value={form.text_scale} onChange={e => setForm(f => ({ ...f, text_scale: parseFloat(e.target.value) }))}
                      style={{ width: '100%', background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 10px', color: C.text, fontSize: 13, outline: 'none' }} />
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 4 }}>Optimization Notes</label>
                    <textarea value={form.optimization_notes} onChange={e => setForm(f => ({ ...f, optimization_notes: e.target.value }))} rows={2}
                      style={{ width: '100%', background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 10px', color: C.text, fontSize: 12, outline: 'none', resize: 'none', fontFamily: 'inherit' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => handleSave(p.slug)} disabled={saving}
                      style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', background: C.accent, color: '#fff', fontSize: 12, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => setEditingSlug(null)}
                      style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, fontSize: 12, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, background: C.card, color: C.muted, padding: '3px 8px', borderRadius: 6 }}>Safe: {p.safe_margin}%</span>
                  <span style={{ fontSize: 10, background: C.card, color: C.muted, padding: '3px 8px', borderRadius: 6 }}>Scale: ×{p.text_scale}</span>
                  {p.has_override && <span style={{ fontSize: 10, background: C.blue + '22', color: C.blue, padding: '3px 8px', borderRadius: 6 }}>Custom</span>}
                  {p.optimization_notes && (
                    <p style={{ fontSize: 11, color: C.muted, lineHeight: 1.5, width: '100%', marginTop: 6 }}>{p.optimization_notes}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── TAB: Brand Styles — dynamic from brand_social_accounts ────────────────
const TYPOGRAPHY_PRESETS = ['Bold', 'Modern', 'Minimal', 'Luxury', 'Educational', 'Gaming'];
const LIGHTING_PRESETS   = ['Cinematic', 'Studio', 'Soft', 'Natural', 'Golden Hour', 'Dramatic', 'Neon'];
const BACKGROUND_PRESETS = ['Gradient', 'Blur', 'Technology', 'Office', 'Classroom', 'City', 'Luxury', 'Abstract', 'Nature'];

const BrandStylesTab = ({ brandStyles, setBrandStyles }) => {
  const [editingSlug, setEditingSlug] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  const startEdit = (b) => {
    setForm({
      primary_color:    b.primary_color    || '#000000',
      secondary_color:  b.secondary_color  || '#ffffff',
      accent_color:     b.accent_color     || '#f97316',
      typography_style: b.typography_style || 'Bold',
      lighting_preset:  b.lighting_preset  || 'Cinematic',
      background_style: b.background_style || 'Gradient',
      design_keywords:  (b.design_keywords || []).join(', '),
      prompt_injection: b.prompt_injection || '',
    });
    setEditingSlug(b.slug);
  };

  const handleSave = async (b) => {
    setSaving(true);
    try {
      const data = {
        ...form,
        name: b.name,
        design_keywords: form.design_keywords.split(',').map(s => s.trim()).filter(Boolean),
      };
      await api.saveThumbnailBrainBrandStyleOverride(b.slug, data);
      setBrandStyles(bs => bs.map(x => x.slug === b.slug
        ? { ...x, ...data, has_override: true }
        : x
      ));
      setEditingSlug(null);
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!brandStyles.length) return (
    <div style={{ textAlign: 'center', padding: '60px 0', color: C.muted }}>
      <Palette size={40} color={C.border} style={{ marginBottom: 12 }} />
      <p style={{ fontSize: 14 }}>No connected brands found.</p>
      <p style={{ fontSize: 12, marginTop: 6 }}>Connect accounts in <strong style={{ color: C.text }}>Social Accounts</strong> to populate brand styles automatically.</p>
    </div>
  );

  return (
    <div style={{ maxWidth: 960 }}>
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ color: C.text, fontSize: 15, fontWeight: 700 }}>Brand Style Library</h3>
        <p style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
          Auto-detected from your connected brands · {brandStyles.length} brand{brandStyles.length !== 1 ? 's' : ''} · Set colors, typography & prompt injection per brand
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {brandStyles.map(b => {
          const isEditing = editingSlug === b.slug;
          return (
            <div key={b.slug} style={{ background: C.surface, border: `1px solid ${isEditing ? C.accent + '66' : C.border}`, borderRadius: 12, padding: 18, transition: 'border-color 0.15s' }}>

              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: isEditing ? 16 : 12 }}>
                <div style={{ display: 'flex', gap: 5 }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: b.primary_color,   border: `2px solid ${C.border}` }} />
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: b.secondary_color, border: `2px solid ${C.border}` }} />
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: b.accent_color,    border: `2px solid ${C.border}` }} />
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>{b.name}</p>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                    {(b.platforms || []).map(p => (
                      <span key={p} style={{ fontSize: 9, background: C.card, color: C.muted, padding: '2px 6px', borderRadius: 6 }}>{p}</span>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: 9, background: C.green + '22', color: C.green, padding: '3px 7px', borderRadius: 10, fontWeight: 700 }}>LIVE</span>
                  {b.has_override && <span style={{ fontSize: 9, background: C.blue + '22', color: C.blue, padding: '3px 7px', borderRadius: 10, fontWeight: 700 }}>CUSTOM</span>}
                  {!isEditing && (
                    <button onClick={() => startEdit(b)} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: '5px 12px', color: C.muted, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Edit2 size={11} /> Edit Style
                    </button>
                  )}
                </div>
              </div>

              {/* Collapsed preview */}
              {!isEditing && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {[b.typography_style, b.lighting_preset, b.background_style].map(tag => (
                    <span key={tag} style={{ fontSize: 10, background: C.card, color: C.muted, padding: '3px 8px', borderRadius: 6 }}>{tag}</span>
                  ))}
                  {(b.design_keywords || []).map(kw => (
                    <span key={kw} style={{ fontSize: 10, background: C.accent + '18', color: C.accent, padding: '2px 7px', borderRadius: 10 }}>{kw}</span>
                  ))}
                  {b.prompt_injection && (
                    <p style={{ width: '100%', fontSize: 11, color: C.muted, lineHeight: 1.5, fontStyle: 'italic', marginTop: 6 }}>
                      "{b.prompt_injection.substring(0, 120)}{b.prompt_injection.length > 120 ? '…' : ''}"
                    </p>
                  )}
                </div>
              )}

              {/* Edit form */}
              {isEditing && (
                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
                  {/* Colors */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
                    {[['Primary Color', 'primary_color'], ['Secondary Color', 'secondary_color'], ['Accent Color', 'accent_color']].map(([label, key]) => (
                      <div key={key}>
                        <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>{label}</label>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input type="color" value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                            style={{ width: 38, height: 38, borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, cursor: 'pointer', flexShrink: 0 }} />
                          <input type="text" value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                            style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: '8px 10px', color: C.text, fontSize: 12, outline: 'none', fontFamily: 'monospace' }} />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Style presets */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 8 }}>Typography</label>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {TYPOGRAPHY_PRESETS.map(t => (
                          <button key={t} onClick={() => setForm(f => ({ ...f, typography_style: t }))}
                            style={{ padding: '4px 10px', borderRadius: 8, border: `1px solid ${form.typography_style === t ? C.accent : C.border}`, background: form.typography_style === t ? C.accent + '20' : 'transparent', color: form.typography_style === t ? C.accent : C.muted, fontSize: 11, cursor: 'pointer' }}>
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 8 }}>Lighting</label>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {LIGHTING_PRESETS.map(l => (
                          <button key={l} onClick={() => setForm(f => ({ ...f, lighting_preset: l }))}
                            style={{ padding: '4px 10px', borderRadius: 8, border: `1px solid ${form.lighting_preset === l ? C.blue : C.border}`, background: form.lighting_preset === l ? C.blue + '20' : 'transparent', color: form.lighting_preset === l ? C.blue : C.muted, fontSize: 11, cursor: 'pointer' }}>
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 8 }}>Background</label>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {BACKGROUND_PRESETS.map(bg => (
                          <button key={bg} onClick={() => setForm(f => ({ ...f, background_style: bg }))}
                            style={{ padding: '4px 10px', borderRadius: 8, border: `1px solid ${form.background_style === bg ? C.purple : C.border}`, background: form.background_style === bg ? C.purple + '20' : 'transparent', color: form.background_style === bg ? C.purple : C.muted, fontSize: 11, cursor: 'pointer' }}>
                            {bg}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Keywords */}
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>Design Keywords (comma separated)</label>
                    <input type="text" value={form.design_keywords} onChange={e => setForm(f => ({ ...f, design_keywords: e.target.value }))} placeholder="education, premium, bold..."
                      style={{ width: '100%', background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: '8px 12px', color: C.text, fontSize: 13, outline: 'none' }} />
                  </div>

                  {/* Prompt injection */}
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>Prompt Injection</label>
                    <textarea value={form.prompt_injection} onChange={e => setForm(f => ({ ...f, prompt_injection: e.target.value }))} rows={3}
                      placeholder="Auto-injected into every generation prompt for this brand..."
                      style={{ width: '100%', background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: '9px 12px', color: C.text, fontSize: 13, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }} />
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => handleSave(b)} disabled={saving}
                      style={{ padding: '9px 24px', borderRadius: 8, border: 'none', background: C.accent, color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
                      {saving ? 'Saving…' : 'Save Brand Style'}
                    </button>
                    <button onClick={() => setEditingSlug(null)}
                      style={{ padding: '9px 16px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, fontSize: 13, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── TAB: Prompt Builder ────────────────────────────────────────────────────
const PromptBuilderTab = ({ config, updateConfig, buildFinalPrompt }) => {
  const [copied, setCopied] = useState(false);
  const instructions = config.promptModules?.instructions || '';
  const finalPrompt = buildFinalPrompt();

  const copyPrompt = () => {
    navigator.clipboard.writeText(finalPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, height: '100%' }}>

      {/* LEFT — single instruction input */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <h3 style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Your Instructions</h3>
          <p style={{ color: C.muted, fontSize: 12 }}>Write your AI instructions here. The rest of the prompt is auto-assembled from the other tabs.</p>
        </div>

        <textarea
          value={instructions}
          onChange={e => updateConfig('promptModules.instructions', e.target.value)}
          placeholder={`Example:\nYou are an expert YouTube Thumbnail Designer.\n\nKeep the person's face and identity exactly the same. Enhance HDR lighting, professional color grading...\n\nOutput only the enhanced image. Do not add text or watermarks.`}
          style={{
            flex: 1,
            display: 'block',
            width: '100%',
            minHeight: 380,
            boxSizing: 'border-box',
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            outline: 'none',
            padding: '14px 16px',
            color: C.text,
            fontSize: 13,
            lineHeight: 1.8,
            resize: 'vertical',
            fontFamily: 'DM Sans, sans-serif',
          }}
        />

        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', fontSize: 11, color: C.muted, lineHeight: 1.7 }}>
          <strong style={{ color: C.text }}>Auto-appended from other tabs:</strong><br />
          Subject Preservation · Composition · Lighting · Background · Typography · Goal · Title Safe Area · Negative Prompts
        </div>
      </div>

      {/* RIGHT — assembled prompt preview */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>Final Prompt Preview</h3>
            <p style={{ color: C.muted, fontSize: 11 }}>Assembled at runtime · {finalPrompt.length} chars</p>
          </div>
          <button onClick={copyPrompt} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: copied ? C.green + '22' : 'transparent', color: copied ? C.green : C.muted, fontSize: 12, cursor: 'pointer' }}>
            {copied ? <><Check size={12} /> Copied!</> : <><Copy size={12} /> Copy</>}
          </button>
        </div>
        <textarea
          readOnly
          value={finalPrompt}
          style={{
            flex: 1,
            display: 'block',
            width: '100%',
            minHeight: 380,
            boxSizing: 'border-box',
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: '14px 16px',
            color: C.text,
            fontSize: 12,
            lineHeight: 1.8,
            outline: 'none',
            resize: 'vertical',
            fontFamily: 'monospace',
          }}
        />
      </div>
    </div>
  );
};

// ── TAB: Subject Preservation ──────────────────────────────────────────────
const SubjectTab = ({ config, updateConfig }) => {
  const sp = config.subjectPreservation || {};
  const items = [
    { key: 'face',        label: 'Preserve Face',         desc: 'Maintain facial identity, features, and structure exactly' },
    { key: 'hair',        label: 'Preserve Hair',         desc: 'Keep hairstyle, color, and texture identical' },
    { key: 'expression',  label: 'Preserve Expression',   desc: 'Maintain original facial expression and emotion' },
    { key: 'clothing',    label: 'Preserve Clothing',     desc: 'Keep clothing style, color, and pattern unchanged' },
    { key: 'pose',        label: 'Preserve Pose',         desc: 'Maintain body position and posture exactly' },
    { key: 'cameraAngle', label: 'Preserve Camera Angle', desc: 'Keep the original shooting angle and perspective' },
    { key: 'skinTone',    label: 'Preserve Skin Tone',    desc: 'Maintain natural skin tone and complexion' },
  ];

  return (
    <div style={{ maxWidth: 600 }}>
      <SectionCard title="Subject Preservation Rules" subtitle="These settings prevent AI from altering the person's identity during enhancement.">
        {items.map(item => (
          <Toggle key={item.key} checked={!!sp[item.key]} label={item.label} desc={item.desc}
            onChange={v => updateConfig(`subjectPreservation.${item.key}`, v)} />
        ))}
      </SectionCard>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px', fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
        Active preservations are auto-injected into the prompt as: <br />
        <span style={{ color: C.accent, fontFamily: 'monospace' }}>
          "Preserve exactly: {Object.entries(sp).filter(([, v]) => v).map(([k]) => k.replace(/([A-Z])/g, ' $1').trim()).join(', ') || 'none selected'}"
        </span>
      </div>
    </div>
  );
};

// ── TAB: Composition Rules ─────────────────────────────────────────────────
const CompositionTab = ({ config, updateConfig }) => {
  const active = config.compositionRules || [];
  const toggle = (id) => {
    const next = active.includes(id) ? active.filter(x => x !== id) : [...active, id];
    updateConfig('compositionRules', next);
  };

  return (
    <div style={{ maxWidth: 700 }}>
      <SectionCard title="Composition Rules" subtitle="Selected rules influence how the AI frames and composes the thumbnail.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {COMPOSITION_OPTIONS.map(opt => (
            <button key={opt.id} onClick={() => toggle(opt.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 10, border: `1px solid ${active.includes(opt.id) ? C.accent : C.border}`, background: active.includes(opt.id) ? C.accent + '15' : 'transparent', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${active.includes(opt.id) ? C.accent : C.border}`, background: active.includes(opt.id) ? C.accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {active.includes(opt.id) && <Check size={12} color="#fff" />}
              </div>
              <span style={{ color: active.includes(opt.id) ? C.text : C.muted, fontSize: 13, fontWeight: active.includes(opt.id) ? 600 : 400 }}>{opt.label}</span>
            </button>
          ))}
        </div>
      </SectionCard>
    </div>
  );
};

// ── TAB: Lighting ──────────────────────────────────────────────────────────
const LightingTab = ({ config, updateConfig }) => {
  const active = config.lighting || [];
  const toggle = (id) => {
    const next = active.includes(id) ? active.filter(x => x !== id) : [...active, id];
    updateConfig('lighting', next);
  };

  return (
    <div style={{ maxWidth: 700 }}>
      <SectionCard title="Lighting Presets" subtitle="Multi-select lighting styles to apply to thumbnail generation. Selected presets combine for a hybrid effect.">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {LIGHTING_OPTIONS.map(opt => (
            <button key={opt.id} onClick={() => toggle(opt.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px', borderRadius: 12, border: `2px solid ${active.includes(opt.id) ? C.accent : C.border}`, background: active.includes(opt.id) ? C.accent + '18' : C.card, cursor: 'pointer', transition: 'all 0.15s' }}>
              <span style={{ fontSize: 20 }}>{opt.emoji}</span>
              <span style={{ color: active.includes(opt.id) ? C.accent : C.muted, fontSize: 13, fontWeight: active.includes(opt.id) ? 700 : 400 }}>{opt.label}</span>
            </button>
          ))}
        </div>
        {active.length > 0 && (
          <p style={{ marginTop: 16, fontSize: 12, color: C.muted }}>
            Injected: <span style={{ color: C.accent, fontFamily: 'monospace' }}>Lighting: {active.map(l => l.replace('_', ' ')).join(', ')} style.</span>
          </p>
        )}
      </SectionCard>
    </div>
  );
};

// ── TAB: Typography & Marketing Thumbnail Studio ───────────────────────────
const TypographyTab = ({ config, updateConfig }) => {
  const t = config.textOverlay || {
    enabled: true,
    mode: 'canvas',
    headlineSource: 'custom',
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

  const [previewDataUrl, setPreviewDataUrl] = useState(null);

  const setT = (key, val) => {
    updateConfig(`textOverlay.${key}`, val);
  };

  const sampleBg = 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1280&q=80';

  useEffect(() => {
    let isMounted = true;
    const enabled = t.enabled !== false;

    renderTextOverlayCanvas(sampleBg, {
      title: enabled ? (t.customHeadline || 'YOUR HEADLINE') : '',
      subtitle: enabled && t.showSubtitle !== false ? (t.subtitle || 'Supporting line') : '',
      ctaBadge: enabled && t.showCtaBadge !== false ? (t.ctaBadge || 'Call to Action') : '',
      fontFamily: t.fontFamily || 'Anton',
      fontSize: t.fontSize || 54,
      textColor: t.textColor || '#FFFFFF',
      strokeColor: t.strokeColor || '#000000',
      strokeWidth: t.strokeWidth || 6,
      bgColor: t.bgColor || 'rgba(249, 115, 22, 0.95)',
      subBgColor: t.subBgColor || 'rgba(15, 23, 42, 0.9)',
      subTextColor: t.subTextColor || '#E2E8F0',
      ctaBgColor: t.ctaBgColor || '#10B981',
      ctaTextColor: t.ctaTextColor || '#FFFFFF',
      bgPadding: t.bgPadding || 14,
      borderRadius: t.borderRadius || 8,
      shadowColor: t.shadowColor || 'rgba(0, 0, 0, 0.75)',
      shadowBlur: t.shadowBlur || 14,
      position: t.position || 'top_left',
      showBgPill: enabled && t.showBgPill !== false,
      showSubtitle: enabled && t.showSubtitle !== false,
      showCtaBadge: enabled && t.showCtaBadge !== false,
      canvasWidth: 1280,
      canvasHeight: 720,
    }).then(url => {
      if (isMounted) setPreviewDataUrl(url);
    }).catch(err => console.warn('Preview overlay render err:', err));

    return () => { isMounted = false; };
  }, [
    t.enabled, t.customHeadline, t.subtitle, t.ctaBadge,
    t.fontFamily, t.fontSize, t.textColor, t.strokeColor, t.strokeWidth,
    t.bgColor, t.subBgColor, t.subTextColor, t.ctaBgColor, t.ctaTextColor,
    t.bgPadding, t.borderRadius, t.shadowColor, t.shadowBlur, t.position,
    t.showBgPill, t.showSubtitle, t.showCtaBadge,
  ]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, maxWidth: 1100 }}>
      {/* LEFT COLUMN: CONTROLS */}
      <div>
        <SectionCard title="Marketing Thumbnail Status" subtitle="Enable AI & Canvas marketing overlay suite on video frames">
          <Toggle
            checked={!!t.enabled}
            onChange={v => setT('enabled', v)}
            label="Enable Promotional Marketing Overlays"
            desc="Renders Title, Subtitle, and CTA badges directly on generated thumbnails"
          />
        </SectionCard>

        {t.enabled && (
          <>
            {/* GOOGLE FONTS SELECTOR */}
            <SectionCard title="Google Fonts Typography" subtitle="Select headline font style for marketing thumbnails">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, maxHeight: 180, overflowY: 'auto', paddingRight: 4 }}>
                {POPULAR_GOOGLE_FONTS.map(font => {
                  const isSelected = (t.fontFamily || 'Anton').toLowerCase() === font.name.toLowerCase();
                  return (
                    <button
                      key={font.name}
                      onClick={() => setT('fontFamily', font.name)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: `1px solid ${isSelected ? C.accent : C.border}`,
                        background: isSelected ? C.accent + '20' : C.card,
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s',
                      }}
                    >
                      <p style={{ color: isSelected ? C.accent : C.text, fontSize: 14, fontWeight: 700 }}>{font.name}</p>
                      <p style={{ color: C.muted, fontSize: 10 }}>{font.style} · {font.category}</p>
                    </button>
                  );
                })}
              </div>
            </SectionCard>

            {/* MARKETING COPY INPUTS */}
            <SectionCard title="Marketing Copy Stack (Title, Subtitle, CTA)" subtitle="Configure thumbnail copy generated by Caption Brain or enter custom copy">
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: C.text, display: 'block', marginBottom: 4 }}>1. Thumbnail Title (3–8 Words)</label>
                <input
                  type="text"
                  value={t.customHeadline || ''}
                  onChange={e => setT('customHeadline', e.target.value)}
                  placeholder="e.g. BECOME A DATA ANALYST"
                  style={{ width: '100%', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', color: C.text, fontSize: 13, outline: 'none', fontWeight: 700 }}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: C.text, display: 'block', marginBottom: 4 }}>2. Subtitle / Outcome (2–6 Words)</label>
                <input
                  type="text"
                  value={t.subtitle || ''}
                  onChange={e => setT('subtitle', e.target.value)}
                  placeholder="e.g. Placement in 90 Days"
                  style={{ width: '100%', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', color: C.text, fontSize: 12, outline: 'none' }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: C.text, display: 'block', marginBottom: 4 }}>3. CTA Badge Text</label>
                <input
                  type="text"
                  value={t.ctaBadge || ''}
                  onChange={e => setT('ctaBadge', e.target.value)}
                  placeholder="e.g. Admissions Open / Free Workshop"
                  style={{ width: '100%', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', color: C.accent, fontSize: 12, outline: 'none', fontWeight: 700 }}
                />
              </div>
            </SectionCard>

            {/* COLOR & STROKE & BADGE STYLING */}
            <SectionCard title="Color Palette & Badge Theme" subtitle="Customize header colors, CTA badge background, and outline strokes">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Title Fill</label>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="color" value={t.textColor || '#FFFFFF'} onChange={e => setT('textColor', e.target.value)} style={{ width: 34, height: 34, borderRadius: 6, border: 'none', cursor: 'pointer' }} />
                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: C.text }}>{t.textColor || '#FFFFFF'}</span>
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Title Pill</label>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="color" value={(t.bgColor || '#f97316').substring(0, 7)} onChange={e => setT('bgColor', e.target.value)} style={{ width: 34, height: 34, borderRadius: 6, border: 'none', cursor: 'pointer' }} />
                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: C.text }}>Title Banner</span>
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>CTA Badge</label>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="color" value={t.ctaBgColor || '#10B981'} onChange={e => setT('ctaBgColor', e.target.value)} style={{ width: 34, height: 34, borderRadius: 6, border: 'none', cursor: 'pointer' }} />
                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: C.text }}>CTA Pill</span>
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.muted, marginBottom: 4 }}>
                  <span>Title Font Size</span>
                  <span style={{ fontWeight: 700, color: C.text }}>{t.fontSize || 54}px</span>
                </div>
                <input type="range" min={30} max={90} step={2} value={t.fontSize || 54} onChange={e => setT('fontSize', parseInt(e.target.value))} style={{ width: '100%', accentColor: C.accent }} />
              </div>

              <Toggle
                checked={t.showCtaBadge !== false}
                onChange={v => setT('showCtaBadge', v)}
                label="Show CTA Badge (e.g. ★ Admissions Open)"
                desc="Displays a high-converting promotional pill badge"
              />
              <Toggle
                checked={t.showSubtitle !== false}
                onChange={v => setT('showSubtitle', v)}
                label="Show Subtitle Banner"
                desc="Displays a secondary outcome subtitle pill below the headline"
              />
            </SectionCard>

            {/* POSITION MATRIX */}
            <SectionCard title="Layout Safe Placement" subtitle="Select anchor position for text stack in negative space">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {[
                  { id: 'top_left', label: '↖ Top Left' },
                  { id: 'top_center', label: '↑ Top Center' },
                  { id: 'top_right', label: '↗ Top Right' },
                  { id: 'center', label: '• Center' },
                  { id: 'bottom_left', label: '↙ Bottom Left' },
                  { id: 'bottom_center', label: '↓ Bottom Center' },
                ].map(pos => (
                  <button
                    key={pos.id}
                    onClick={() => setT('position', pos.id)}
                    style={{
                      padding: '10px 8px', borderRadius: 8,
                      border: `1px solid ${t.position === pos.id ? C.accent : C.border}`,
                      background: t.position === pos.id ? C.accent + '20' : C.card,
                      color: t.position === pos.id ? C.accent : C.muted,
                      fontSize: 11, fontWeight: 700, cursor: 'pointer', textAlign: 'center'
                    }}
                  >
                    {pos.label}
                  </button>
                ))}
              </div>
            </SectionCard>
          </>
        )}
      </div>

      {/* RIGHT COLUMN: LIVE CANVAS PREVIEW */}
      <div style={{ position: 'sticky', top: 20 }}>
        <SectionCard title="Live Preview" subtitle="Canvas updates instantly as you change settings">

          {/* Preview frame */}
          <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', background: '#000', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', marginBottom: 12 }}>
            {/* LIVE badge */}
            <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 20, background: 'rgba(239,68,68,0.88)', color: '#fff', fontSize: 8, fontWeight: 900, padding: '3px 8px', borderRadius: 4, letterSpacing: '0.12em' }}>
              ● LIVE
            </div>

            {previewDataUrl ? (
              <img
                src={previewDataUrl}
                alt="Typography Preview"
                style={{ width: '100%', height: 'auto', display: 'block' }}
              />
            ) : (
              <div style={{ aspectRatio: '16/9', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, background: C.dim }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${C.border}`, borderTopColor: C.accent, animation: 'spin 0.9s linear infinite' }} />
                <span style={{ color: C.muted, fontSize: 11 }}>Rendering preview…</span>
              </div>
            )}
          </div>

          {/* Platform tags */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {['YouTube', 'Instagram', 'Facebook', 'LinkedIn'].map(p => (
              <span key={p} style={{ fontSize: 9, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: C.dim, color: C.muted, letterSpacing: '0.05em', border: `1px solid ${C.border}` }}>{p}</span>
            ))}
          </div>

          {/* Applied settings panel */}
          <div style={{ background: C.dim, borderRadius: 10, padding: '14px 16px', border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Applied Settings</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* CTA Badge row */}
              {t.showCtaBadge !== false && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 22, borderRadius: 11, background: t.ctaBgColor || '#10B981', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 9, color: C.muted, marginBottom: 2, letterSpacing: '0.06em' }}>CTA BADGE</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>★ {t.ctaBadge || 'Admissions Open'}</div>
                  </div>
                </div>
              )}

              {/* Headline row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 22, borderRadius: 4, background: t.bgColor || 'rgba(249,115,22,0.95)', flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 9, color: C.muted, marginBottom: 2, letterSpacing: '0.06em' }}>HEADLINE</div>
                  <div style={{ fontSize: 12, fontWeight: 900, color: C.text, fontFamily: `"${t.fontFamily || 'Anton'}", sans-serif`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.customHeadline || 'YOUR HEADLINE'}
                  </div>
                </div>
              </div>

              {/* Subtitle row */}
              {t.showSubtitle !== false && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 22, borderRadius: 4, background: t.subBgColor || 'rgba(15,23,42,0.9)', flexShrink: 0, border: `1px solid ${C.border}` }} />
                  <div>
                    <div style={{ fontSize: 9, color: C.muted, marginBottom: 2, letterSpacing: '0.06em' }}>SUBTITLE</div>
                    <div style={{ fontSize: 11, color: C.text }}>{t.subtitle || 'Supporting line'}</div>
                  </div>
                </div>
              )}

              {/* Divider */}
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, display: 'flex', gap: 20 }}>
                <div>
                  <div style={{ fontSize: 9, color: C.muted, marginBottom: 3, letterSpacing: '0.06em' }}>FONT</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.blue }}>{t.fontFamily || 'Anton'} · {t.fontSize || 54}px</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: C.muted, marginBottom: 3, letterSpacing: '0.06em' }}>POSITION</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, textTransform: 'capitalize' }}>{(t.position || 'top_left').replace('_', ' ')}</div>
                </div>
              </div>
            </div>
          </div>

        </SectionCard>
      </div>
    </div>
  );
};



// ── TAB: Background Styles ─────────────────────────────────────────────────
const BackgroundsTab = ({ config, updateConfig }) => (
  <div style={{ maxWidth: 700 }}>
    <SectionCard title="Background Style" subtitle="The AI uses this as the primary background composition guidance.">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {BACKGROUND_OPTIONS.map(bg => (
          <Chip key={bg} label={bg} active={config.backgroundStyle === bg} onClick={() => updateConfig('backgroundStyle', bg)} />
        ))}
      </div>
    </SectionCard>
  </div>
);

// ── TAB: Color Presets ─────────────────────────────────────────────────────
const ColorsTab = ({ config, updateConfig, brandStyles }) => (
  <div style={{ maxWidth: 700 }}>
    <SectionCard title="Active Brand Color Scheme" subtitle="Select a brand style to inherit its color palette, or set a custom default.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
        <button onClick={() => updateConfig('defaultBrandStyleId', null)}
          style={{ padding: 14, borderRadius: 12, border: `2px solid ${!config.defaultBrandStyleId ? C.accent : C.border}`, background: !config.defaultBrandStyleId ? C.accent + '15' : C.card, cursor: 'pointer', textAlign: 'center' }}>
          <p style={{ color: !config.defaultBrandStyleId ? C.accent : C.muted, fontSize: 13, fontWeight: 700 }}>No Brand Default</p>
          <p style={{ color: C.muted, fontSize: 11 }}>Use prompt-level colors</p>
        </button>
        {brandStyles.map(b => (
          <button key={b.id} onClick={() => updateConfig('defaultBrandStyleId', b.id)}
            style={{ padding: 14, borderRadius: 12, border: `2px solid ${config.defaultBrandStyleId === b.id ? C.accent : C.border}`, background: config.defaultBrandStyleId === b.id ? C.accent + '15' : C.card, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: b.primary_color }} />
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: b.secondary_color }} />
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: b.accent_color }} />
            </div>
            <p style={{ color: config.defaultBrandStyleId === b.id ? C.accent : C.text, fontSize: 12, fontWeight: 700 }}>{b.name}</p>
          </button>
        ))}
      </div>
    </SectionCard>
  </div>
);

// ── TAB: Thumbnail Goals ───────────────────────────────────────────────────
const GoalsTab = ({ config, updateConfig }) => (
  <div style={{ maxWidth: 700 }}>
    <SectionCard title="Thumbnail Goal" subtitle="The selected goal adjusts prompt emphasis, composition priority, and visual hierarchy.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        {GOAL_OPTIONS.map(goal => (
          <button key={goal.id} onClick={() => updateConfig('thumbnailGoal', goal.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 10, border: `2px solid ${config.thumbnailGoal === goal.id ? C.accent : C.border}`, background: config.thumbnailGoal === goal.id ? C.accent + '15' : C.card, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}>
            <span style={{ fontSize: 22 }}>{goal.emoji}</span>
            <div>
              <p style={{ color: config.thumbnailGoal === goal.id ? C.accent : C.text, fontSize: 13, fontWeight: config.thumbnailGoal === goal.id ? 700 : 500 }}>{goal.label}</p>
            </div>
            {config.thumbnailGoal === goal.id && <Check size={16} color={C.accent} style={{ marginLeft: 'auto' }} />}
          </button>
        ))}
      </div>
    </SectionCard>
  </div>
);

// ── TAB: Negative Prompts ──────────────────────────────────────────────────
const NegativeTab = ({ config, updateConfig }) => {
  const [customInput, setCustomInput] = useState('');
  const active = config.negativePrompts || [];

  const toggle = (id) => {
    const next = active.includes(id) ? active.filter(x => x !== id) : [...active, id];
    updateConfig('negativePrompts', next);
  };

  const addCustom = () => {
    const val = customInput.trim().toLowerCase().replace(/\s+/g, '_');
    if (val && !active.includes(val)) {
      updateConfig('negativePrompts', [...active, val]);
    }
    setCustomInput('');
  };

  return (
    <div style={{ maxWidth: 700 }}>
      <SectionCard title="Negative Prompt Library" subtitle="Selected items are automatically appended to every generation request to prevent common defects.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 20 }}>
          {NEGATIVE_OPTIONS.map(opt => (
            <button key={opt.id} onClick={() => toggle(opt.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 9, border: `1px solid ${active.includes(opt.id) ? C.red + '88' : C.border}`, background: active.includes(opt.id) ? C.red + '12' : 'transparent', cursor: 'pointer', transition: 'all 0.15s' }}>
              <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${active.includes(opt.id) ? C.red : C.border}`, background: active.includes(opt.id) ? C.red : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {active.includes(opt.id) && <X size={10} color="#fff" />}
              </div>
              <span style={{ color: active.includes(opt.id) ? C.red : C.muted, fontSize: 12, fontWeight: active.includes(opt.id) ? 600 : 400 }}>{opt.label}</span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input value={customInput} onChange={e => setCustomInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCustom()} placeholder="Add custom negative prompt..."
            style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', color: C.text, fontSize: 13, outline: 'none' }} />
          <button onClick={addCustom} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: C.red + '33', color: C.red, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Add</button>
        </div>
        {active.filter(a => !NEGATIVE_OPTIONS.find(o => o.id === a)).length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {active.filter(a => !NEGATIVE_OPTIONS.find(o => o.id === a)).map(a => (
              <span key={a} style={{ display: 'flex', alignItems: 'center', gap: 4, background: C.red + '22', color: C.red, padding: '3px 10px', borderRadius: 20, fontSize: 11 }}>
                {a.replace(/_/g, ' ')}
                <button onClick={() => toggle(a)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.red, padding: 0, display: 'flex' }}><X size={10} /></button>
              </span>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
};

// ── TAB: Test Studio ───────────────────────────────────────────────────────
const TestStudioTab = ({ config, platforms, brandStyles, buildFinalPrompt }) => {
  const [frameUrl, setFrameUrl] = useState('');
  const [brandId, setBrandId] = useState(config.defaultBrandStyleId || null);
  const [platformSlug, setPlatformSlug] = useState(config.defaultPlatformSlug || 'youtube');
  const [goal, setGoal] = useState(config.thumbnailGoal || 'highest_ctr');
  const [result, setResult] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);

  const finalPrompt = buildFinalPrompt();

  const handleGenerate = async () => {
    if (!frameUrl.trim()) return setError('Please enter a frame URL');
    setGenerating(true); setError(null);
    const start = Date.now();
    try {
      const platform = platforms.find(p => p.slug === platformSlug);
      const res = await api.generatePoster(0, frameUrl.trim(), finalPrompt, config.aiEngine?.model || 'gemini-2.0-flash-preview-image-generation', {
        aspectRatio: platform?.aspect_ratio || '16:9',
        style: brandStyles.find(b => b.id === brandId)?.typography_style || 'Cinematic',
        titleSafeArea: config.titleSafeArea || 35,
      });
      if (res.poster_url) {
        setResult(res);
        const ms = Date.now() - start;
        api.recordThumbnailBrainAnalytics({ brand_style_id: brandId, platform_slug: platformSlug, model_used: config.aiEngine?.model, engine_used: res.engine, generation_time_ms: ms, prompt_length: finalPrompt.length }).catch(() => {});
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 24, height: '100%' }}>
      <div>
        <SectionCard title="Test Configuration" subtitle="Generate a test thumbnail using current Brain settings.">
          <Input label="Frame URL" value={frameUrl} onChange={setFrameUrl} placeholder="https://...server/uploads/frame_123_1.jpg" />
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>Platform Profile</label>
            <select value={platformSlug} onChange={e => setPlatformSlug(e.target.value)} style={{ width: '100%', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', color: C.text, fontSize: 13, outline: 'none' }}>
              {platforms.map(p => <option key={p.slug} value={p.slug}>{p.icon} {p.name} · {p.aspect_ratio}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>Brand Style</label>
            <select value={brandId || ''} onChange={e => setBrandId(e.target.value ? parseInt(e.target.value) : null)} style={{ width: '100%', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', color: C.text, fontSize: 13, outline: 'none' }}>
              <option value="">No Brand Style</option>
              {brandStyles.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>Goal</label>
            <select value={goal} onChange={e => setGoal(e.target.value)} style={{ width: '100%', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', color: C.text, fontSize: 13, outline: 'none' }}>
              {GOAL_OPTIONS.map(g => <option key={g.id} value={g.id}>{g.emoji} {g.label}</option>)}
            </select>
          </div>
          <button onClick={() => setShowPrompt(!showPrompt)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, fontSize: 12, cursor: 'pointer', marginBottom: 10 }}>
            <span><Eye size={13} style={{ marginRight: 6, verticalAlign: 'middle' }} />Preview Final Prompt</span>
            <span>{finalPrompt.length} chars</span>
          </button>
          {showPrompt && (
            <textarea readOnly value={finalPrompt} style={{ width: '100%', minHeight: 140, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, color: C.muted, fontSize: 11, lineHeight: 1.6, outline: 'none', resize: 'vertical', marginBottom: 10, fontFamily: 'monospace' }} />
          )}
          <button onClick={handleGenerate} disabled={generating} style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: generating ? C.border : `linear-gradient(135deg, ${C.accent}, #ea580c)`, color: generating ? C.muted : '#fff', fontSize: 14, fontWeight: 700, cursor: generating ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {generating ? <><RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} /> Generating…</> : <><Zap size={15} /> Generate Thumbnail</>}
          </button>
          {error && <div style={{ marginTop: 10, background: '#2d1010', border: `1px solid ${C.red}44`, borderRadius: 8, padding: '10px 12px', color: C.red, fontSize: 12 }}>{error}</div>}
        </SectionCard>
      </div>
      <div>
        {result ? (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>Generated Result</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ fontSize: 11, background: result.engine === 'gemini' ? C.green + '22' : C.muted + '22', color: result.engine === 'gemini' ? C.green : C.muted, padding: '3px 10px', borderRadius: 10 }}>Engine: {result.engine}</span>
                <button onClick={handleGenerate} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, fontSize: 11, cursor: 'pointer' }}>
                  <RefreshCw size={11} /> Regenerate
                </button>
              </div>
            </div>
            <img src={result.poster_url} alt="Generated thumbnail" style={{ width: '100%', display: 'block' }} />
          </div>
        ) : (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: C.muted }}>
            <FlaskConical size={40} color={C.border} />
            <p style={{ fontSize: 14 }}>Enter a frame URL and click Generate</p>
            <p style={{ fontSize: 12 }}>Results appear here — no need to switch to Approval Room</p>
          </div>
        )}
      </div>
    </div>
  );
};

// ── TAB: Version History ───────────────────────────────────────────────────
const VersionsTab = ({ versions, setVersions, setConfig }) => {
  const handleActivate = async (id) => {
    const res = await api.activateThumbnailBrainVersion(id);
    if (res.success) {
      setVersions(vs => vs.map(v => ({ ...v, is_active: v.id === id })));
      if (res.version?.config) setConfig(c => ({ ...c, ...res.version.config }));
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this version?')) return;
    await api.deleteThumbnailBrainVersion(id);
    setVersions(vs => vs.filter(v => v.id !== id));
  };

  if (versions.length === 0) return (
    <div style={{ textAlign: 'center', padding: '60px 0', color: C.muted }}>
      <History size={40} color={C.border} style={{ marginBottom: 12 }} />
      <p>No saved versions yet. Save your configuration to create the first version.</p>
    </div>
  );

  return (
    <div style={{ maxWidth: 700 }}>
      <h3 style={{ color: C.text, fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Version History</h3>
      <p style={{ color: C.muted, fontSize: 12, marginBottom: 20 }}>Every Save creates a new version. Activate any version to restore it as the active configuration.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {versions.map(v => (
          <div key={v.id} style={{ background: C.surface, border: `1px solid ${v.is_active ? C.accent + '55' : C.border}`, borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: v.is_active ? C.accent + '22' : C.card, border: `2px solid ${v.is_active ? C.accent : C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: v.is_active ? C.accent : C.muted }}>v{v.version_number}</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <p style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>{v.version_name}</p>
                {v.is_active && <span style={{ fontSize: 10, background: C.green + '22', color: C.green, padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>ACTIVE</span>}
              </div>
              <p style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{new Date(v.created_at).toLocaleString()}</p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {!v.is_active && (
                <button onClick={() => handleActivate(v.id)} style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${C.accent}`, background: 'transparent', color: C.accent, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  <RotateCcw size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />Activate
                </button>
              )}
              <button onClick={() => handleDelete(v.id)} style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.red + 'aa', fontSize: 12, cursor: 'pointer' }}>
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── TAB: Analytics ─────────────────────────────────────────────────────────
const AnalyticsTab = ({ analytics }) => {
  if (!analytics) return <div style={{ color: C.muted, padding: '40px 0', textAlign: 'center' }}>Loading analytics...</div>;

  const s = analytics.summary || {};
  const approvalRate = s.total_generated > 0
    ? Math.round((s.total_approved / s.total_generated) * 100) : 0;

  const StatCard = ({ label, value, sub, color = C.accent }) => (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 20px' }}>
      <p style={{ fontSize: 11, color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</p>
      <p style={{ fontSize: 28, fontWeight: 800, color, fontFamily: 'Syne, sans-serif' }}>{value ?? '—'}</p>
      {sub && <p style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{sub}</p>}
    </div>
  );

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        <StatCard label="Total Generated" value={s.total_generated || 0} color={C.accent} />
        <StatCard label="Approved" value={s.total_approved || 0} color={C.green} />
        <StatCard label="Rejected" value={s.total_rejected || 0} color={C.red} />
        <StatCard label="Approval Rate" value={`${approvalRate}%`} color={C.blue} sub="approved / total" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
        <StatCard label="Avg Generation Time" value={s.avg_generation_ms ? `${Math.round(s.avg_generation_ms / 1000)}s` : '—'} color={C.purple} />
        <StatCard label="Avg Prompt Length" value={s.avg_prompt_length ? `${Math.round(s.avg_prompt_length)} chars` : '—'} color={C.muted} />
        <StatCard label="Pending Review" value={s.pending_review || 0} color={C.muted} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
        {[{ title: 'By Model', data: analytics.byModel, key: 'model_used' },
          { title: 'By Platform', data: analytics.byPlatform, key: 'platform_slug' },
          { title: 'By Engine', data: analytics.byEngine, key: 'engine_used' }
        ].map(({ title, data, key }) => (
          <div key={title} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 12 }}>{title}</p>
            {(data || []).length === 0
              ? <p style={{ fontSize: 12, color: C.muted }}>No data yet</p>
              : (data || []).map(row => (
                  <div key={row[key]} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: C.muted }}>{(row[key] || '—').replace(/_/g, ' ')}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{row.count}</span>
                  </div>
                ))}
          </div>
        ))}
      </div>
    </div>
  );
};
