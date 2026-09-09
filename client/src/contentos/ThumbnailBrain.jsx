import { useState, useEffect, useRef } from 'react';
import {
  DEFAULT_CONFIG,
  STYLES,
  ASPECT_RATIOS,
  RESOLUTIONS,
  QUALITIES,
  MODELS,
  loadConfig,
  saveConfig,
} from './thumbnailBrain/thumbnailBrainConfig.js';
import { buildFinalPrompt } from './thumbnailBrain/thumbnailPromptBuilder.js';
import ThumbnailGenerationFlow from './ThumbnailGenerationFlow.jsx';

export function ThumbnailBrain() {
  const [activeTab, setActiveTab] = useState('flow'); // 'flow' | 'config'
  const [config, setConfig] = useState(loadConfig);
  const [saved, setSaved] = useState(false);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (activeTab !== 'config') return;
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.max(450, ta.scrollHeight) + 'px';
  }, [config.defaultPrompt, activeTab]);

  const finalPrompt = buildFinalPrompt(config);

  function handleSave() {
    try {
      saveConfig(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (e) {
      console.error('Failed to save Thumbnail Brain config', e);
    }
  }

  function handleReset() {
    setConfig({ ...DEFAULT_CONFIG });
  }

  function updateConfig(key, value) {
    setConfig(prev => ({ ...prev, [key]: value }));
  }

  const labelStyle = {
    fontSize: 10, fontWeight: 700, color: 'var(--t3)',
    textTransform: 'uppercase', letterSpacing: '0.06em',
    display: 'block', marginBottom: 6
  };

  const selectStyle = {
    width: '100%', background: 'var(--bg)', color: 'var(--t1)',
    border: '1px solid var(--b2)', borderRadius: 7,
    padding: '9px 12px', fontSize: 12.5, outline: 'none', cursor: 'pointer'
  };

  return (
    <div className="page on" style={{ paddingBottom: 48 }}>
      {/* Top View Selector Tabs */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyBetween: 'space-between',
        marginBottom: 24, borderBottom: '1px solid rgba(226,232,240,0.8)', paddingBottom: 12
      }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => setActiveTab('flow')}
            style={{
              padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
              cursor: 'pointer', border: '1px solid',
              background: activeTab === 'flow' ? '#0F172A' : '#FFFFFF',
              color: activeTab === 'flow' ? '#FFFFFF' : '#475569',
              borderColor: activeTab === 'flow' ? '#0F172A' : '#CBD5E1',
              display: 'flex', alignItems: 'center', gap: 8
            }}
          >
            <span>⚡ Generation Pipeline Flow</span>
          </button>

          <button
            onClick={() => setActiveTab('config')}
            style={{
              padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
              cursor: 'pointer', border: '1px solid',
              background: activeTab === 'config' ? '#0F172A' : '#FFFFFF',
              color: activeTab === 'config' ? '#FFFFFF' : '#475569',
              borderColor: activeTab === 'config' ? '#0F172A' : '#CBD5E1',
              display: 'flex', alignItems: 'center', gap: 8
            }}
          >
            <span>🧠 Prompt & Engine Config</span>
          </button>
        </div>
      </div>

      {activeTab === 'flow' ? (
        <ThumbnailGenerationFlow />
      ) : (
        <>
          {/* Page Header */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 42, height: 42, borderRadius: 11, flexShrink: 0,
                background: 'linear-gradient(135deg, rgba(139,114,240,0.25), rgba(0,196,160,0.2))',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20
              }}>🧠</div>
              <div>
                <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--t1)', fontFamily: "'Syne', sans-serif", letterSpacing: '-0.3px' }}>
                  🧠 Thumbnail Brain Configuration
                </h1>
                <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 3 }}>
                  Manage the default AI prompt and settings used for thumbnail generation across ContentOS.
                </div>
              </div>
            </div>
          </div>

      {/* Two-column grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 370px', gap: 20, alignItems: 'start' }}>

        {/* ── Left Column ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Section 1 — Default AI Prompt */}
          <div className="panel" style={{ margin: 0 }}>
            <div className="panel-h" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#8B72F0', fontSize: 13 }}>✦</span>
                Default AI Prompt
              </div>
              <span className="mono" style={{ fontSize: 10, color: 'var(--t3)' }}>
                {config.defaultPrompt.length} chars
              </span>
            </div>
            <div className="panel-b">
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 10, lineHeight: 1.5 }}>
                This is the base prompt sent to the AI image model every time a poster is generated using Thumbnail Brain in Approval Room. Edit it to change how thumbnails are generated across all brands.
              </div>
              <textarea
                ref={textareaRef}
                value={config.defaultPrompt}
                onChange={e => updateConfig('defaultPrompt', e.target.value)}
                spellCheck={false}
                style={{
                  width: '100%',
                  minHeight: 450,
                  background: 'var(--bg)',
                  color: 'var(--t1)',
                  border: '1px solid var(--b2)',
                  borderRadius: 8,
                  padding: 16,
                  fontSize: 12,
                  lineHeight: 1.75,
                  fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
                  outline: 'none',
                  resize: 'none',
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                }}
              />
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button
                  onClick={handleSave}
                  style={{
                    padding: '9px 22px', fontSize: 12, fontWeight: 700, borderRadius: 8,
                    background: saved ? 'var(--grn, #34C77B)' : 'var(--teal)',
                    color: 'var(--bg)', border: 'none', cursor: 'pointer',
                    transition: 'background 0.2s'
                  }}
                >
                  {saved ? '✓ Saved!' : '✓ Save Configuration'}
                </button>
                <button
                  onClick={handleReset}
                  style={{
                    padding: '9px 16px', fontSize: 12, fontWeight: 600, borderRadius: 8,
                    background: 'transparent', color: 'var(--t3)',
                    border: '1px solid var(--b2)', cursor: 'pointer'
                  }}
                >
                  ↺ Reset to Default
                </button>
              </div>
            </div>
          </div>

          {/* Section 6 — Final Prompt Preview */}
          <div className="panel" style={{ margin: 0 }}>
            <div className="panel-h" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--gold)', fontSize: 13 }}>◎</span>
                Final Prompt Preview
                <span style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 400 }}>— auto-generated from all settings</span>
              </div>
              <span className="mono" style={{ fontSize: 10, color: 'var(--t3)' }}>
                {finalPrompt.length} chars
              </span>
            </div>
            <div className="panel-b">
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 10 }}>
                This is exactly what gets sent to the AI model when generating a thumbnail in Approval Room.
              </div>
              <textarea
                value={finalPrompt}
                readOnly
                style={{
                  width: '100%',
                  minHeight: 260,
                  background: 'rgba(0,0,0,0.25)',
                  color: 'var(--t2)',
                  border: '1px solid var(--b1)',
                  borderRadius: 8,
                  padding: 14,
                  fontSize: 11,
                  lineHeight: 1.7,
                  fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
                  outline: 'none',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  cursor: 'default',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button
                  onClick={() => navigator.clipboard?.writeText(finalPrompt)}
                  style={{
                    padding: '5px 12px', fontSize: 10, fontWeight: 600, borderRadius: 6,
                    background: 'transparent', color: 'var(--teal)',
                    border: '1px solid rgba(0,196,160,0.25)', cursor: 'pointer'
                  }}
                >
                  Copy Prompt
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right Column — Settings ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Section 2 — Style */}
          <div className="panel" style={{ margin: 0 }}>
            <div className="panel-h">
              <span style={{ color: '#8B72F0' }}>◈</span>&nbsp;Thumbnail Style
            </div>
            <div className="panel-b">
              <select value={config.style} onChange={e => updateConfig('style', e.target.value)} style={selectStyle}>
                {STYLES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <div style={{ marginTop: 9, fontSize: 11, color: 'var(--t3)', lineHeight: 1.5 }}>
                Adjusts the visual mood and color palette applied to the generated thumbnail.
              </div>
            </div>
          </div>

          {/* Section 3 — Output Settings */}
          <div className="panel" style={{ margin: 0 }}>
            <div className="panel-h">
              <span style={{ color: 'var(--teal)' }}>▲</span>&nbsp;Output Settings
            </div>
            <div className="panel-b" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={labelStyle}>Aspect Ratio</label>
                <select value={config.aspectRatio} onChange={e => updateConfig('aspectRatio', e.target.value)} style={selectStyle}>
                  {ASPECT_RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Resolution</label>
                <select value={config.resolution} onChange={e => updateConfig('resolution', e.target.value)} style={selectStyle}>
                  {RESOLUTIONS.map(r => <option key={r} value={r}>{r.replace('x', ' × ')}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Quality</label>
                <select value={config.quality} onChange={e => updateConfig('quality', e.target.value)} style={selectStyle}>
                  {QUALITIES.map(q => <option key={q} value={q}>{q}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Section 4 — Title Safe Area */}
          <div className="panel" style={{ margin: 0 }}>
            <div className="panel-h">
              <span style={{ color: 'var(--gold)' }}>◷</span>&nbsp;Title Safe Area
            </div>
            <div className="panel-b">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 12, color: 'var(--t2)' }}>Empty space reserved for title overlay</span>
                <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--gold)', fontFamily: "'Syne', sans-serif", lineHeight: 1 }}>
                  {config.titleSafeArea}%
                </span>
              </div>
              <input
                type="range"
                min="20"
                max="50"
                step="1"
                value={config.titleSafeArea}
                onChange={e => updateConfig('titleSafeArea', Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--gold)', cursor: 'pointer', margin: '4px 0' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--t3)' }}>20% min</span>
                <span style={{ fontSize: 10, color: 'var(--t3)' }}>50% max</span>
              </div>
            </div>
          </div>

          {/* Section 5 — AI Model */}
          <div className="panel" style={{ margin: 0 }}>
            <div className="panel-h">
              <span style={{ color: 'var(--teal)', fontSize: 12 }}>⟡</span>&nbsp;AI Model
            </div>
            <div className="panel-b">
              <select value={config.model} onChange={e => updateConfig('model', e.target.value)} style={selectStyle}>
                {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <div style={{
                marginTop: 10, padding: '8px 12px',
                background: 'rgba(0,196,160,0.06)', border: '1px solid rgba(0,196,160,0.15)',
                borderRadius: 7, fontSize: 11, color: 'var(--t3)', lineHeight: 1.5
              }}>
                <span style={{ color: 'var(--teal)', fontWeight: 700 }}>Active: </span>
                {MODELS.find(m => m.value === config.model)?.label || config.model}
              </div>
            </div>
          </div>

          {/* Save All button */}
          <button
            onClick={handleSave}
            style={{
              width: '100%', padding: '13px', fontSize: 13, fontWeight: 700, borderRadius: 9,
              background: saved
                ? 'var(--grn, #34C77B)'
                : 'linear-gradient(135deg, rgba(139,114,240,0.3), rgba(0,196,160,0.2))',
              color: saved ? 'var(--bg)' : 'var(--t1)',
              border: saved ? 'none' : '1px solid rgba(139,114,240,0.3)',
              cursor: 'pointer', transition: 'all 0.2s'
            }}
          >
            {saved ? '✓ Configuration Saved!' : '✦ Save All Settings'}
          </button>

          {/* Config summary */}
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--b1)', borderRadius: 9, padding: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
              Active Configuration
            </div>
            <pre style={{
              fontSize: 10, color: 'var(--t2)', margin: 0, lineHeight: 1.65,
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-all'
            }}>
{JSON.stringify({
  style: config.style,
  aspectRatio: config.aspectRatio,
  resolution: config.resolution,
  quality: config.quality,
  titleSafeArea: config.titleSafeArea,
  model: config.model
}, null, 2)}
            </pre>
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
