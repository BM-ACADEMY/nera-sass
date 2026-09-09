import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { BookOpen, X, ChevronRight, CheckCircle2, Lightbulb, AlertCircle } from 'lucide-react';
import { C } from '../../constants/theme.js';
import { getSopForPath } from '../../constants/sopContent.js';

// sopKey lets a page override which SOP entry to show — e.g. a page with
// multiple tabs (Content Factory) passes a per-tab key instead of relying on
// the route, since switching tabs there doesn't change location.pathname.
export default function SopModal({ sopKey } = {}) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const sop = getSopForPath(sopKey || location.pathname);

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  if (!sop) return null;

  return (
    <>
      {/* SOP Trigger Button */}
      <button
        id="sop-button"
        onClick={() => setOpen(true)}
        title="Standard Operating Procedure"
        style={{
          width: 34,
          height: 34,
          borderRadius: 7,
          background: 'linear-gradient(135deg, rgba(37,99,235,0.15), rgba(124,58,237,0.15))',
          border: '1px solid rgba(37,99,235,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'all 0.2s',
          flexShrink: 0,
          position: 'relative',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'linear-gradient(135deg, rgba(37,99,235,0.3), rgba(124,58,237,0.3))';
          e.currentTarget.style.borderColor = '#2563eb';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'linear-gradient(135deg, rgba(37,99,235,0.15), rgba(124,58,237,0.15))';
          e.currentTarget.style.borderColor = 'rgba(37,99,235,0.4)';
        }}
      >
        <BookOpen size={15} color="#60a5fa" />
        <span style={{
          position: 'absolute',
          top: -4,
          right: -4,
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: '#7c3aed',
          border: '2px solid ' + C.surface,
          fontSize: 6,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 900,
        }}>?</span>
      </button>

      {/* SOP Modal Overlay */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.65)',
            backdropFilter: 'blur(5px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            animation: 'fadeIn 0.15s ease-out',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'linear-gradient(145deg, #161b22, #0d1117)',
              border: '1px solid #30363d',
              borderRadius: 16,
              width: '100%',
              maxWidth: 640,
              maxHeight: '88vh',
              overflowY: 'auto',
              boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
              animation: 'slideUp 0.2s ease-out',
            }}
          >
            {/* Header */}
            <div style={{
              background: '#161b22', // solid background to prevent scroll overlap
              borderBottom: '1px solid #30363d',
              padding: '20px 24px',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              borderRadius: '16px 16px 0 0',
              position: 'sticky',
              top: 0,
              zIndex: 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, paddingRight: 16 }}>
                <div style={{
                  width: 42,
                  height: 42,
                  borderRadius: 10,
                  background: 'rgba(37,99,235,0.2)',
                  border: '1px solid rgba(37,99,235,0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 22,
                  flexShrink: 0
                }}>
                  {sop.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: 1 }}>SOP Guide</span>
                  </div>
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: '#f0f6fc', margin: 0, lineHeight: 1.3 }}>{sop.title}</h2>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#8b949e', display: 'flex', padding: 4, borderRadius: 6, flexShrink: 0 }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '24px' }}>

              {/* Overview */}
              <div style={{
                background: 'rgba(37,99,235,0.08)',
                border: '1px solid rgba(37,99,235,0.2)',
                borderRadius: 10,
                padding: '14px 16px',
                marginBottom: 24,
                display: 'flex',
                gap: 12,
              }}>
                <AlertCircle size={18} color="#60a5fa" style={{ flexShrink: 0, marginTop: 1 }} />
                <p style={{ fontSize: 14, color: '#c9d1d9', lineHeight: 1.6, margin: 0 }}>{sop.overview}</p>
              </div>

              {/* Steps */}
              <h3 style={{ fontSize: 13, fontWeight: 700, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>
                Step-by-Step Procedure
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                {sop.steps.map((s, idx) => (
                  <div key={idx} style={{
                    display: 'flex',
                    gap: 14,
                    background: '#161b22',
                    border: '1px solid #21262d',
                    borderRadius: 10,
                    padding: '14px 16px',
                    alignItems: 'flex-start',
                    transition: 'border-color 0.2s',
                  }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(37,99,235,0.4)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = '#21262d'}
                  >
                    <div style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 900,
                      color: '#fff',
                      flexShrink: 0,
                    }}>
                      {s.step}
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <ChevronRight size={13} color="#2563eb" />
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#f0f6fc' }}>{s.title}</span>
                      </div>
                      <p style={{ fontSize: 13, color: '#8b949e', margin: 0, lineHeight: 1.6 }}>{s.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Tips */}
              {sop.tips && sop.tips.length > 0 && (
                <>
                  <h3 style={{ fontSize: 13, fontWeight: 700, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
                    💡 Pro Tips
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {sop.tips.map((tip, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <CheckCircle2 size={15} color="#22c55e" style={{ flexShrink: 0, marginTop: 2 }} />
                        <p style={{ fontSize: 13, color: '#c9d1d9', margin: 0, lineHeight: 1.6 }}>{tip}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div style={{
              borderTop: '1px solid #30363d',
              padding: '12px 24px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'rgba(13,17,23,0.6)',
              borderRadius: '0 0 16px 16px',
            }}>
              <span style={{ fontSize: 11, color: '#8b949e' }}>LeadOS SOP Guide • Internal Use</span>
              <button
                onClick={() => setOpen(false)}
                style={{
                  background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 20px',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Got it!
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </>
  );
}
