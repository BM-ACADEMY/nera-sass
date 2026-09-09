import React, { useState, useEffect, useCallback } from 'react';
import SopModal from '../../components/common/SopModal.jsx';
import { C } from '../../constants/theme.js';
import {
  Search, Loader2, Star, MessageSquare, Globe, Phone,
  MapPin, Clock, Zap, ChevronDown, ChevronUp, Shield,
  AlertTriangle, ExternalLink, RefreshCw, History, Award,
  Building2, Images, X, ChevronLeft, ChevronRight, User
} from 'lucide-react';
import { api } from '../../services/api.js';
import { useClient } from '../../contexts/ClientContext.jsx';

// ── Sub-components ─────────────────────────────────────────────────────────

const ScoreBadge = ({ score }) => {
  const color = score >= 70 ? '#22c55e' : score >= 45 ? '#eab308' : '#ef4444';
  const bg    = score >= 70 ? 'rgba(34,197,94,0.12)' : score >= 45 ? 'rgba(234,179,8,0.12)' : 'rgba(239,68,68,0.12)';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', width: 56, height: 56,
      borderRadius: '50%', background: bg,
      border: `2px solid ${color}40`, flexShrink: 0
    }}>
      <span style={{ fontSize: 16, fontWeight: 800, color, lineHeight: 1 }}>{score}</span>
      <span style={{ fontSize: 8, color, textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.5 }}>GMB</span>
    </div>
  );
};

const StarRating = ({ rating }) => {
  const stars = Math.round(rating * 2) / 2;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} size={12} fill={i <= stars ? '#eab308' : 'transparent'} color={i <= stars ? '#eab308' : '#475569'} />
      ))}
      <span style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 700, marginLeft: 2 }}>{rating.toFixed(1)}</span>
    </div>
  );
};

const Tag = ({ children, color = '#64748b', bg = 'rgba(100,116,139,0.1)' }) => (
  <span style={{
    fontSize: 10, fontWeight: 700, color, background: bg,
    border: `1px solid ${color}40`, padding: '2px 7px', borderRadius: 4,
    textTransform: 'uppercase', letterSpacing: 0.5, display: 'inline-flex', alignItems: 'center'
  }}>
    {children}
  </span>
);

// ── Photo Lightbox ─────────────────────────────────────────────────────────

const PhotoLightbox = ({ photos, startIndex, onClose }) => {
  const [idx, setIdx] = useState(startIndex);

  const prev = useCallback(() => setIdx(i => (i - 1 + photos.length) % photos.length), [photos.length]);
  const next = useCallback(() => setIdx(i => (i + 1) % photos.length), [photos.length]);

  useEffect(() => {
    const handler = e => {
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [prev, next, onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
    >
      {/* Close */}
      <button onClick={onClose} style={{
        position: 'absolute', top: 20, right: 20,
        background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff',
        width: 40, height: 40, borderRadius: '50%', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        <X size={18} />
      </button>

      {/* Counter */}
      <div style={{
        position: 'absolute', top: 22, left: '50%', transform: 'translateX(-50%)',
        color: '#94a3b8', fontSize: 13
      }}>
        {idx + 1} / {photos.length}
      </div>

      {/* Image */}
      <div onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '80vh', position: 'relative' }}>
        <img
          src={photos[idx].url}
          alt={photos[idx].title || ''}
          style={{ maxWidth: '90vw', maxHeight: '80vh', borderRadius: 12, objectFit: 'contain' }}
        />
        {photos[idx].title && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
            padding: '20px 16px 12px', borderRadius: '0 0 12px 12px',
            color: '#e2e8f0', fontSize: 13
          }}>
            {photos[idx].title}
          </div>
        )}
      </div>

      {/* Nav Arrows */}
      {photos.length > 1 && (
        <>
          <button onClick={e => { e.stopPropagation(); prev(); }} style={{
            position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)',
            background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff',
            width: 44, height: 44, borderRadius: '50%', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <ChevronLeft size={22} />
          </button>
          <button onClick={e => { e.stopPropagation(); next(); }} style={{
            position: 'absolute', right: 20, top: '50%', transform: 'translateY(-50%)',
            background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff',
            width: 44, height: 44, borderRadius: '50%', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <ChevronRight size={22} />
          </button>
        </>
      )}

      {/* Thumbnail strip */}
      {photos.length > 1 && (
        <div style={{
          position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', gap: 6, maxWidth: '80vw', overflowX: 'auto',
          padding: '6px 10px', background: 'rgba(0,0,0,0.5)', borderRadius: 10
        }}>
          {photos.map((p, i) => (
            <img
              key={i}
              src={p.thumbnail || p.url}
              onClick={e => { e.stopPropagation(); setIdx(i); }}
              alt=""
              style={{
                width: 52, height: 40, borderRadius: 6, objectFit: 'cover',
                cursor: 'pointer', flexShrink: 0,
                border: `2px solid ${i === idx ? C.accent : 'transparent'}`,
                opacity: i === idx ? 1 : 0.6, transition: 'all 0.15s'
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Photo Gallery Panel ─────────────────────────────────────────────────────

const PhotoGallery = ({ comp, location }) => {
  const [state, setState]       = useState('idle'); // idle | loading | loaded | error
  const [details, setDetails]   = useState(null);
  const [lightbox, setLightbox] = useState(null);   // index or null

  const loadPhotos = async () => {
    setState('loading');
    try {
      const params = new URLSearchParams();

      // comp.placeId is the decimal CID from google_local
      // backend converts it to hex data_id for google_maps
      if (comp.placeId) params.set('placeId', comp.placeId);
      params.set('name', comp.name);
      if (location) params.set('location', location);

      const res = await api.get(`/thedal/competitorspy/place-details?${params.toString()}`);
      const data = res.data || res;
      setDetails(data);
      setState('loaded');
    } catch (err) {
      console.error(err);
      setState('error');
    }
  };

  const photos = details?.photos || [];

  if (state === 'idle') {
    return (
      <button
        onClick={loadPhotos}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          background: 'rgba(249,115,22,0.1)', border: `1px solid ${C.accent}50`,
          color: C.accent, padding: '8px 14px', borderRadius: 8,
          fontSize: 12, fontWeight: 700, cursor: 'pointer', marginTop: 12
        }}
      >
        <Images size={14} /> View Real Photos
      </button>
    );
  }

  if (state === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, color: '#94a3b8', fontSize: 13 }}>
        <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
        Fetching photos from Google Maps...
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div style={{ marginTop: 12, color: '#ef4444', fontSize: 12 }}>
        ⚠ Could not load photos — try again.
        <button onClick={() => setState('idle')} style={{ marginLeft: 8, color: C.accent, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      {/* Photo count header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>
          {photos.length > 0 ? `${photos.length} Photos Found` : 'Photos'}
        </p>
        <button onClick={() => setState('idle')} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 11 }}>
          Hide
        </button>
      </div>

      {photos.length === 0 ? (
        <div style={{
          padding: '30px 20px', borderRadius: 12, background: 'rgba(255,255,255,0.02)',
          border: `1px dashed ${C.border}`, textAlign: 'center', color: C.muted, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10
        }}>
          <Images size={28} color={C.muted} style={{ opacity: 0.4 }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>No Places Photos Available</div>
          <div style={{ fontSize: 12, maxWidth: 360, margin: '0 auto', lineHeight: 1.5 }}>
            No public photos were returned by the Google Maps API for this listing.
          </div>
        </div>
      ) : (
        <>
          {/* Photo grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
            gap: 6
          }}>
            {photos.map((photo, i) => (
              <div
                key={i}
                onClick={() => setLightbox(i)}
                style={{
                  position: 'relative', paddingBottom: '75%', borderRadius: 8,
                  overflow: 'hidden', cursor: 'pointer', background: '#1e293b'
                }}
              >
                <img
                  src={photo.thumbnail || photo.url}
                  alt={photo.title || `Photo ${i + 1}`}
                  style={{
                    position: 'absolute', inset: 0, width: '100%', height: '100%',
                    objectFit: 'cover', transition: 'transform 0.2s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                  onError={e => { e.target.style.display = 'none'; }}
                />
              </div>
            ))}
          </div>

          {/* Recent reviews if available */}
          {details?.reviews?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                Recent Reviews
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {details.reviews.map((r, i) => (
                  <div key={i} style={{
                    background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`,
                    borderRadius: 8, padding: '10px 12px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      {r.avatar
                        ? <img src={r.avatar} alt={r.author} style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} />
                        : <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><User size={12} color='#64748b' /></div>
                      }
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>{r.author}</span>
                      {r.rating && <StarRating rating={r.rating} />}
                      {r.date && <span style={{ fontSize: 10, color: '#475569', marginLeft: 'auto' }}>{r.date}</span>}
                    </div>
                    {r.text && <p style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6, margin: 0 }}>{r.text}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Lightbox */}
      {lightbox !== null && (
        <PhotoLightbox
          photos={photos}
          startIndex={lightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
};

// ── Competitor Card ─────────────────────────────────────────────────────────

const CompetitorCard = ({ comp, isExpanded, onToggle, location }) => {
  const rankColor = comp.rank === 1 ? '#f59e0b' : comp.rank === 2 ? '#94a3b8' : comp.rank === 3 ? '#cd7c2f' : '#475569';

  return (
    <div style={{
      background: comp.isClient ? 'rgba(249,115,22,0.06)' : C.surface,
      border: `1px solid ${comp.isClient ? C.accent : C.border}`,
      borderRadius: 12, overflow: 'hidden',
      boxShadow: comp.isClient ? `0 0 0 1px ${C.accent}40` : 'none',
      transition: 'all 0.2s'
    }}>
      {/* Header Row */}
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '18px 20px', cursor: 'pointer', userSelect: 'none' }}>
        {/* Rank */}
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: `${rankColor}20`, border: `2px solid ${rankColor}50`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 800, color: rankColor, flexShrink: 0
        }}>
          {comp.rank}
        </div>

        {/* Thumbnail */}
        {comp.thumbnail ? (
          <img
            src={comp.thumbnail} alt={comp.name}
            onError={e => { e.target.style.display = 'none'; }}
            style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
          />
        ) : (
          <div style={{
            width: 44, height: 44, borderRadius: 8, background: 'rgba(255,255,255,0.05)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
          }}>
            <Building2 size={20} color='#475569' />
          </div>
        )}

        {/* Name & Category */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>{String(comp.name || '')}</span>
            {comp.isClient && <Tag color={C.accent} bg={`${C.accent}15`}>Your Client</Tag>}
            {comp.isOpen === true && <Tag color='#22c55e' bg='rgba(34,197,94,0.1)'>Open Now</Tag>}
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>{String(comp.category || '')}</div>
        </div>

        {/* Rating */}
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          <StarRating rating={comp.rating} />
          <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
            {comp.reviews.toLocaleString()} reviews
          </div>
        </div>

        {/* GMB Score */}
        <ScoreBadge score={comp.gmbScore} />

        {/* Expand toggle */}
        <div style={{ color: C.muted, flexShrink: 0 }}>
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div style={{ padding: '0 20px 20px', borderTop: `1px solid ${C.border}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 18 }}>
            {/* Listing Info */}
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Listing Details</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {comp.address && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <MapPin size={13} color={C.muted} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>{String(comp.address || '')}</span>
                  </div>
                )}
                {comp.phone && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Phone size={13} color={C.muted} />
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>{String(comp.phone || '')}</span>
                  </div>
                )}
                {comp.website && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Globe size={13} color={C.muted} />
                    <a
                      href={String(comp.website).startsWith('http') ? String(comp.website) : 'https://' + String(comp.website)}
                      target='_blank' rel='noreferrer'
                      style={{ fontSize: 12, color: C.accent, textDecoration: 'none' }}
                    >
                      {String(comp.website || '')}
                    </a>
                  </div>
                )}
                {comp.hours && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Clock size={13} color={C.muted} />
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>{String(comp.hours || '')}</span>
                  </div>
                )}
                {comp.mapsUrl && (
                  <a
                    href={comp.mapsUrl} target='_blank' rel='noreferrer'
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#3b82f6', textDecoration: 'none', marginTop: 4 }}
                  >
                    <ExternalLink size={12} /> View on Google Maps
                  </a>
                )}
              </div>
            </div>

            {/* Strengths & Weaknesses */}
            <div>
              {comp.strengths.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#22c55e', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Shield size={11} /> Strengths
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {comp.strengths.map((s, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#86efac' }}>
                        <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                        {String(s || '')}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {comp.weaknesses.length > 0 && (
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <AlertTriangle size={11} /> Weak Spots
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {comp.weaknesses.map((w, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#fca5a5' }}>
                        <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
                        {String(w || '')}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Photo Gallery (on-demand) ───────────────────────────── */}
          <div style={{ marginTop: 4, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
            <PhotoGallery comp={comp} location={location} />
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main Page ───────────────────────────────────────────────────────────────

export default function CompetitorSpy() {
  const { activeClient } = useClient();
  const [keyword, setKeyword]         = useState('');
  const [location, setLocation]       = useState('');
  const [clientName, setClientName]   = useState('');
  const [language, setLanguage]       = useState('en');
  const [resultCount, setResultCount] = useState(20);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [data, setData]               = useState(null);
  const [history, setHistory]         = useState([]);
  const [expandedId, setExpandedId]   = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const qs = activeClient?.id ? `?clientId=${encodeURIComponent(activeClient.id)}` : '';
        const res = await api.get(`/thedal/competitorspy/history${qs}`);
        setHistory(res.data?.history || []);
      } catch (_) {}
    };
    fetchHistory();
  }, [data, activeClient?.id]);

  const handleScan = async () => {
    if (!keyword.trim() || !location.trim()) {
      setError('Please enter both a keyword and a location.');
      return;
    }
    setLoading(true);
    setError('');
    setData(null);
    setExpandedId(null);

    try {
      const res = await api.post('/thedal/competitorspy/scan', {
        keyword:      keyword.trim(),
        location:     location.trim(),
        clientGmbName: clientName.trim() || undefined,
        clientId:     activeClient?.id || null,
        language,
        resultCount,
      });
      setData(res.data || res);
      if ((res.data?.competitors?.length > 0) || (res.competitors?.length > 0)) {
        setExpandedId(1);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Scan failed. Check your API configuration.');
    } finally {
      setLoading(false);
    }
  };

  const competitors = data?.competitors || [];
  const topScore    = competitors.length > 0 ? Math.max(...competitors.map(c => c.gmbScore)) : 0;
  const avgRating   = competitors.length > 0 ? (competitors.reduce((s, c) => s + c.rating, 0) / competitors.length).toFixed(1) : 0;
  const avgReviews  = competitors.length > 0 ? Math.round(competitors.reduce((s, c) => s + c.reviews, 0) / competitors.length) : 0;

  return (
    <div style={{ padding: 40, color: C.text, height: '100%', overflowY: 'auto', background: C.background }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <h1 style={{ fontSize: 30, fontWeight: 800, color: '#e2e8f0', margin: 0, fontFamily: "'Syne', sans-serif", display: 'flex', alignItems: 'center', gap: 12 }}>
            <Zap size={26} color={C.accent} /> GMB Competitor Spy
          </h1>
          <p style={{ color: C.muted, fontSize: 14, marginTop: 6 }}>
            Reveal what your client's Google Maps competitors are doing — ratings, reviews, photos, and weak spots.
          </p>
          <p style={{ color: activeClient ? C.muted : '#f87171', fontSize: 12, marginTop: 4 }}>
            {activeClient
              ? <>Scans will be saved under <strong style={{ color: C.accent }}>{activeClient.business_name || activeClient.domain}</strong>, so they show up in that client's Monthly Report.</>
              : 'No active client selected — this scan will be saved unassigned and won\'t appear in any client\'s Monthly Report.'}
          </p>
        </div>
        <button onClick={() => setShowHistory(h => !h)} style={{
          display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(255,255,255,0.05)',
          border: `1px solid ${C.border}`, color: C.muted, padding: '8px 14px',
          borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer'
        }}>
          <History size={14} /> Recent Scans ({history.length})
        </button>
      </div>

      {/* History Panel */}
      {showHistory && history.length > 0 && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 24 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Scan History</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {history.map(h => (
              <button key={h.id} onClick={() => { setKeyword(h.query); setLocation(h.location); setShowHistory(false); }}
                style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, color: '#94a3b8', padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{h.query}</span>
                <span style={{ color: C.muted }}> · {h.location}</span>
                <span style={{ color: '#475569', marginLeft: 8, fontSize: 10 }}>{new Date(h.scanned_at).toLocaleDateString()}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Scan Form */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 28, marginBottom: 30 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Search size={16} color={C.accent} /> Configure Competitor Scan
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: 16, alignItems: 'flex-end' }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Target Keyword *</label>
            <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="e.g., dentist, gym, restaurant"
              onKeyDown={e => e.key === 'Enter' && handleScan()}
              style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, color: '#fff', fontSize: 14, padding: '11px 14px', borderRadius: 8, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Location / City *</label>
            <input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g., Chennai, India"
              onKeyDown={e => e.key === 'Enter' && handleScan()}
              style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, color: '#fff', fontSize: 14, padding: '11px 14px', borderRadius: 8, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Client's GMB Name (Optional)</label>
            <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g., Apollo Dental Chennai"
              style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, color: '#fff', fontSize: 14, padding: '11px 14px', borderRadius: 8, outline: 'none', boxSizing: 'border-box' }} />
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Lang</label>
              <select value={language} onChange={e => setLanguage(e.target.value)}
                style={{ width: '100%', background: '#1e293b', border: `1px solid ${C.border}`, color: '#fff', fontSize: 13, padding: '11px 10px', borderRadius: 8, outline: 'none' }}>
                <option value="en">EN</option>
                <option value="ta">Tamil</option>
                <option value="hi">Hindi</option>
                <option value="te">Telugu</option>
                <option value="ml">Malayalam</option>
                <option value="kn">Kannada</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="ar">Arabic</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Results</label>
              <select value={resultCount} onChange={e => setResultCount(Number(e.target.value))}
                style={{ width: '100%', background: '#1e293b', border: `1px solid ${C.border}`, color: '#fff', fontSize: 13, padding: '11px 10px', borderRadius: 8, outline: 'none' }}>
                <option value={10}>Top 10</option>
                <option value={15}>Top 15</option>
                <option value={20}>Top 20</option>
                <option value={30}>Top 30</option>
                <option value={40}>Top 40</option>
              </select>
            </div>
          </div>

          <button onClick={handleScan} disabled={loading || !keyword.trim() || !location.trim()}
            style={{ background: loading ? '#374151' : `linear-gradient(135deg, ${C.accent}, #ea580c)`, color: '#fff', border: 'none', padding: '11px 26px', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: (loading || !keyword || !location) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, opacity: (loading || !keyword || !location) ? 0.7 : 1, whiteSpace: 'nowrap' }}>
            {loading ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={16} />}
            {loading ? 'Scanning...' : 'Spy Now'}
          </button>
        </div>

        {error && (
          <div style={{ marginTop: 16, padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: 8, color: '#ef4444', fontSize: 13 }}>
            ⚠ {error}
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 260, gap: 16 }}>
          <Loader2 size={40} color={C.accent} style={{ animation: 'spin 1s linear infinite' }} />
          <p style={{ fontSize: 16, color: '#94a3b8', fontWeight: 600 }}>Fetching live GMB data from Google Maps...</p>
          <p style={{ fontSize: 13, color: C.muted, textAlign: 'center', maxWidth: 440 }}>
            Pulling rankings, ratings, reviews, and business details for <strong style={{ color: '#e2e8f0' }}>"{keyword}"</strong> in <strong style={{ color: '#e2e8f0' }}>{location}</strong>
          </p>
        </div>
      )}

      {/* Results */}
      {data && !loading && (
        <>
          {/* Summary Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
            {[
              { label: 'Competitors Found', value: competitors.length, icon: <Building2 size={16} />, color: C.accent },
              { label: 'Avg Rating', value: avgRating + '★', icon: <Star size={16} />, color: '#eab308' },
              { label: 'Avg Reviews', value: avgReviews.toLocaleString(), icon: <MessageSquare size={16} />, color: '#3b82f6' },
              { label: 'Top GMB Score', value: topScore, icon: <Award size={16} />, color: '#22c55e' },
            ].map(stat => (
              <div key={stat.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ color: stat.color }}>{stat.icon}</div>
                <div>
                  <p style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3, fontWeight: 700 }}>{stat.label}</p>
                  <p style={{ fontSize: 20, fontWeight: 800, color: stat.color, fontFamily: "'Syne', sans-serif" }}>{stat.value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Client position banner */}
          {data.clientPosition && (
            <div style={{ background: 'rgba(249,115,22,0.08)', border: `1px solid ${C.accent}40`, borderRadius: 10, padding: '12px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: '#fdba74' }}>
              <Award size={16} color={C.accent} />
              <strong style={{ color: C.accent }}>{clientName}</strong> is ranked <strong style={{ color: '#e2e8f0' }}>#{data.clientPosition}</strong> on Google Maps for "{keyword}" in {location}
            </div>
          )}

          {/* Scan meta */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <p style={{ fontSize: 13, color: C.muted }}>
              Showing top {competitors.length} GMB results · Scanned {new Date(data.scanned_at).toLocaleString()}
            </p>
            <button onClick={handleScan} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
              <RefreshCw size={12} /> Rescan
            </button>
          </div>

          {/* Competitors List */}
          {competitors.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: C.muted }}>
              <Search size={40} style={{ opacity: 0.3, marginBottom: 16 }} />
              <p style={{ fontSize: 16, color: '#e2e8f0', fontWeight: 600 }}>No GMB listings found</p>
              <p style={{ fontSize: 13 }}>Try a broader keyword or different city.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {competitors.map(comp => (
                <CompetitorCard
                  key={comp.rank}
                  comp={comp}
                  location={location}
                  isExpanded={expandedId === comp.rank}
                  onToggle={() => setExpandedId(expandedId === comp.rank ? null : comp.rank)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!data && !loading && !error && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: C.muted }}>
          <div style={{ width: 80, height: 80, borderRadius: '50%', background: `${C.accent}15`, border: `1px solid ${C.accent}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <Search size={32} color={C.accent} />
          </div>
          <p style={{ fontSize: 18, color: '#e2e8f0', fontWeight: 700, marginBottom: 8 }}>Enter a keyword & location to begin</p>
          <p style={{ fontSize: 14, maxWidth: 420, margin: '0 auto', lineHeight: 1.6 }}>
            Example: <span style={{ color: '#e2e8f0' }}>"dentist"</span> in <span style={{ color: '#e2e8f0' }}>"Chennai, India"</span> — then click <strong style={{ color: C.accent }}>View Real Photos</strong> on any result to see their actual GMB images.
          </p>
        </div>
      )}
    </div>
  );
}
