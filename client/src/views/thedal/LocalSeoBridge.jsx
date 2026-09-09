import React, { useState, useEffect } from 'react';
import SopModal from '../../components/common/SopModal.jsx';
import { C } from '../../constants/theme.js';
import { api } from '../../services/api.js';
import { useClient } from '../../contexts/ClientContext.jsx';
import toast from 'react-hot-toast';
import { 
  Loader2, 
  MapPin, 
  Star, 
  MessageCircle, 
  Eye, 
  Search, 
  MousePointerClick, 
  CheckCircle,
  Megaphone,
  Send,
  LogOut,
  Image as ImageIcon
} from 'lucide-react';

const getFriendlyGoogleError = (err) => {
  if (!err) return { title: 'Google API Connection Error', desc: 'An unknown connection error occurred.' };
  try {
    const parsed = typeof err === 'string' ? JSON.parse(err) : err;
    const errorObj = parsed?.error || parsed;
    const code = errorObj?.code;
    const message = errorObj?.message || '';

    if (code === 429 || message.toLowerCase().includes('quota') || message.toLowerCase().includes('rate limit')) {
      return {
        title: 'Google API Rate Limit Exceeded',
        desc: 'Google APIs have temporarily rate-limited requests for this account. Please wait a few minutes before trying again, or request a higher quota limit.'
      };
    }
    if (code === 403 || message.toLowerCase().includes('permission') || message.toLowerCase().includes('access denied') || message.toLowerCase().includes('forbidden')) {
      return {
        title: 'Google Profile Access Forbidden',
        desc: 'The authenticated Google account does not have the required Owner or Manager permissions to access the business reviews and insights. Please make sure the account is authorized.'
      };
    }
    if (code === 401 || message.toLowerCase().includes('unauthorized') || message.toLowerCase().includes('token expired')) {
      return {
        title: 'Google Session Expired',
        desc: 'Your Google Business Profile connection has expired. Please disconnect and re-authenticate your Google account.'
      };
    }

    return {
      title: `Google API Error (Status ${code || 'Unknown'})`,
      desc: message || 'An unexpected issue occurred while communicating with Google Business Profile. Please try again later.'
    };
  } catch (e) {
    return {
      title: 'Google API Connection Error',
      desc: typeof err === 'string' ? err : 'A connection error occurred.'
    };
  }
};

export default function LocalSeoBridge() {
  const { activeClient, clients } = useClient();
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [data, setData] = useState(null);
  
  // Post states
  const [postContent, setPostContent] = useState('');
  const [posting, setPosting] = useState(false);
  const [postSuccess, setPostSuccess] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  // Reply states
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success') === 'true') {
      toast.success('Successfully authenticated with Google!');
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get('error')) {
      toast.error('Google Authentication failed or was denied.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    checkStatus();
  }, [activeClient]);

  const checkStatus = async () => {
    try {
      const res = await api.get('/thedal/localseobridge/status');
      setConnected(res.connected);
      if (res.connected) {
        const clientInfo = activeClient || clients?.[0];
        const businessName = clientInfo?.business_name || 'Your Business';
        const dataRes = await api.get(`/thedal/localseobridge/data?name=${encodeURIComponent(businessName)}`);
        setData(dataRes);
      }
    } catch (err) {
      console.error('Failed to load status or data', err);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = () => {
    setLoading(true);
    // Redirect directly to the official Google OAuth URL on our backend
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3500';
    window.location.href = `${apiUrl}/api/thedal/localseobridge/auth/google`;
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      await api.post('/thedal/localseobridge/disconnect');
      setConnected(false);
      setData(null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handlePost = async () => {
    if (!postContent.trim()) return;
    setPosting(true);
    try {
      await api.post('/thedal/localseobridge/create-post', { content: postContent });
      setPostSuccess(true);
      setPostContent('');
      setShowPreviewModal(false);
      setTimeout(() => setPostSuccess(false), 3000);
    } catch (err) {
      console.error(err);
      toast.error('Failed to create GMB post.');
    } finally {
      setPosting(false);
    }
  };

  const submitReply = async (reviewId) => {
    if (!replyText.trim()) return;
    setSubmittingReply(true);
    try {
      await api.post('/thedal/localseobridge/reply-review', { reviewId, replyText });
      
      // Optimistic update
      const updatedReviews = data.recentReviews.map(r => 
        r.id === reviewId ? { ...r, replied: true, replyText } : r
      );
      setData({ ...data, recentReviews: updatedReviews });
      
      setReplyingTo(null);
      setReplyText('');
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingReply(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', background: C.background }}>
        <Loader2 size={32} color={C.accent} className="spin" />
      </div>
    );
  }

  // ---- NOT CONNECTED STATE ----
  if (!connected) {
    return (
      <div style={{ padding: 40, color: C.text, height: '100%', overflowY: 'auto', background: C.background, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ 
          background: C.surface, 
          border: `1px solid ${C.border}`, 
          borderRadius: 24, 
          padding: 50, 
          maxWidth: 600, 
          textAlign: 'center',
          boxShadow: '0 20px 40px rgba(0,0,0,0.4)'
        }}>
          <div style={{ background: 'rgba(255, 255, 255, 0.05)', width: 80, height: 80, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
            <MapPin size={40} color="#4285F4" />
          </div>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: '#fff', marginBottom: 16, fontFamily: "'Syne', sans-serif" }}>
            Connect Google Business Profile
          </h1>
          <p style={{ color: C.muted, fontSize: 16, lineHeight: 1.6, marginBottom: 40 }}>
            Sync your GBP to unlock the Local SEO Bridge. Manage your reviews, post updates, and track local search insights directly from this dashboard.
          </p>
          
          <button 
            onClick={handleConnect}
            style={{
              background: 'linear-gradient(90deg, #4285F4 0%, #34A853 33%, #FBBC05 66%, #EA4335 100%)',
              color: '#fff',
              border: 'none',
              padding: '16px 32px',
              borderRadius: 12,
              fontSize: 16,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              width: '100%',
              transition: 'transform 0.2s, filter 0.2s',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.filter = 'brightness(1.1)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.filter = 'brightness(1)';
            }}
          >
            Authenticate with Google
          </button>
        </div>
      </div>
    );
  }

  // ---- CONNECTED DASHBOARD ----
  return (
    <div style={{ padding: 40, color: C.text, height: '100%', overflowY: 'auto', background: C.background }}>
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ background: 'rgba(66, 133, 244, 0.1)', padding: 12, borderRadius: 12 }}>
            <MapPin size={28} color="#4285F4" />
          </div>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: '#fff', margin: 0, fontFamily: "'Syne', sans-serif" }}>
              {data?.business.name}
            </h1>
            <p style={{ color: C.muted, fontSize: 14, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              {data?.business.address}
            </p>
          </div>
        </div>
        
        <button 
          onClick={handleDisconnect}
          style={{
            background: 'transparent',
            border: `1px solid ${C.border}`,
            color: C.muted,
            padding: '10px 16px',
            borderRadius: 8,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 14,
            fontWeight: 600,
            transition: 'all 0.2s'
          }}
          onMouseOver={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = '#ef4444'; }}
          onMouseOut={e => { e.currentTarget.style.color = C.muted; e.currentTarget.style.borderColor = C.border; }}
        >
          <LogOut size={16} /> Disconnect
        </button>
      </div>

      {/* INSIGHTS CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24, marginBottom: 30 }}>
        {/* Views */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ background: 'rgba(59, 130, 246, 0.1)', padding: 10, borderRadius: 10 }}>
              <Eye size={20} color="#3b82f6" />
            </div>
            <h3 style={{ color: C.muted, fontSize: 14, fontWeight: 600, margin: 0 }}>Total Views</h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
            <span style={{ fontSize: 32, fontWeight: 800, color: '#fff' }}>{data?.insights.views.toLocaleString()}</span>
            <span style={{ color: '#10b981', fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{data?.insights.viewsTrend}</span>
          </div>
        </div>

        {/* Searches */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ background: 'rgba(168, 85, 247, 0.1)', padding: 10, borderRadius: 10 }}>
              <Search size={20} color="#a855f7" />
            </div>
            <h3 style={{ color: C.muted, fontSize: 14, fontWeight: 600, margin: 0 }}>Direct Searches</h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
            <span style={{ fontSize: 32, fontWeight: 800, color: '#fff' }}>{data?.insights.searches.toLocaleString()}</span>
            <span style={{ color: '#10b981', fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{data?.insights.searchesTrend}</span>
          </div>
        </div>

        {/* Actions */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ background: 'rgba(245, 158, 11, 0.1)', padding: 10, borderRadius: 10 }}>
              <MousePointerClick size={20} color="#f59e0b" />
            </div>
            <h3 style={{ color: C.muted, fontSize: 14, fontWeight: 600, margin: 0 }}>Customer Interactions</h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
            <span style={{ fontSize: 32, fontWeight: 800, color: '#fff' }}>{data?.insights.actions.toLocaleString()}</span>
            <span style={{ color: '#10b981', fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{data?.insights.actionsTrend}</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 24 }}>
        {/* REVIEWS MANAGER */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <MessageCircle size={20} color={C.accent} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#fff' }}>Recent Reviews</h2><SopModal /></div>
            <span style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600 }}>
              {data?.business.rating} ★ ({data?.business.totalReviews})
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {data?._debug_google_error && (() => {
              const friendly = getFriendlyGoogleError(data._debug_google_error);
              return (
                <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', padding: 18, borderRadius: 12, color: '#fca5a5', fontSize: 14, marginBottom: 20 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8, color: '#f87171', display: 'flex', alignItems: 'center', gap: 8, fontSize: 16 }}>
                    ⚠️ {friendly.title}
                  </div>
                  <div style={{ marginBottom: 12, lineHeight: 1.5 }}>
                    {friendly.desc}
                  </div>
                  <div style={{ fontSize: 13, color: '#f87171', borderTop: '1px dashed rgba(239, 68, 68, 0.2)', paddingTop: 10 }}>
                    We successfully authenticated your Google account, but Google's server blocked us from fetching the raw reviews. Please make sure the Google account you connected has Admin/Owner permissions to this Business Profile.
                  </div>
                </div>
              );
            })()}
            
            {data?.recentReviews.map(review => (
              <div key={review.id} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{review.author}</span>
                  <span style={{ color: C.muted, fontSize: 12 }}>{review.date}</span>
                </div>
                <div style={{ display: 'flex', gap: 2, marginBottom: 8 }}>
                  {[1,2,3,4,5].map(star => (
                    <Star key={star} size={14} fill={star <= review.rating ? '#facc15' : 'transparent'} color={star <= review.rating ? '#facc15' : C.border} />
                  ))}
                </div>
                <p style={{ color: '#cbd5e1', fontSize: 14, lineHeight: 1.5, margin: '0 0 16px 0', whiteSpace: 'pre-wrap' }}>
                  {review.text?.replace(/<br\s*\/?>/gi, '\n')}
                </p>
                
                {review.replied ? (
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: 16, borderRadius: 8, borderLeft: `3px solid ${C.accent}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.accent }}>Your Reply</span>
                      <CheckCircle size={12} color={C.accent} />
                    </div>
                    <p style={{ color: C.muted, fontSize: 13, margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                      {review.replyText?.replace(/<br\s*\/?>/gi, '\n')}
                    </p>
                  </div>
                ) : (
                  <div>
                    {replyingTo === review.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <textarea 
                          ref={(el) => {
                            if (el) {
                              el.style.height = 'auto';
                              el.style.height = el.scrollHeight + 'px';
                            }
                          }}
                          value={replyText}
                          onChange={e => setReplyText(e.target.value.slice(0, 1500))}
                          maxLength={1500}
                          placeholder="Write a public reply..."
                          style={{
                            width: '100%',
                            background: 'rgba(0,0,0,0.2)',
                            border: `1px solid ${C.border}`,
                            borderRadius: 8,
                            padding: 12,
                            color: '#fff',
                            fontSize: 14,
                            minHeight: 120,
                            resize: 'none',
                            overflow: 'hidden',
                            outline: 'none',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            fontFamily: 'inherit',
                            lineHeight: '1.5'
                          }}
                        />
                        <div style={{ fontSize: 11, color: C.muted, textAlign: 'right', marginTop: -4 }}>
                          {replyText.length} / 1500 characters
                        </div>
                        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                          <button 
                            onClick={() => { setReplyingTo(null); setReplyText(''); }}
                            style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => generateAiReply(review)}
                            disabled={generatingAiFor === review.id}
                            style={{ background: 'transparent', border: '1px solid rgba(236,72,153,0.3)', color: '#f472b6', padding: '6px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: generatingAiFor === review.id ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                          >
                            {generatingAiFor === review.id ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
                            {generatingAiFor === review.id ? 'Regenerating...' : 'AI Reply'}
                          </button>
                          <button 
                            onClick={() => submitReply(review.id)}
                            disabled={submittingReply}
                            style={{
                              background: C.accent,
                              color: '#fff',
                              border: 'none',
                              padding: '8px 16px',
                              borderRadius: 6,
                              fontSize: 13,
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6
                            }}
                          >
                            {submittingReply ? <Loader2 size={14} className="spin" /> : <Send size={14} />} 
                            Post Reply
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button 
                        onClick={() => setReplyingTo(review.id)}
                        style={{
                          background: 'transparent',
                          border: `1px solid ${C.border}`,
                          color: '#e2e8f0',
                          padding: '6px 16px',
                          borderRadius: 20,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                        onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                        onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                      >
                        Reply
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* POST MANAGER */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <Megaphone size={20} color={C.accent} />
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#fff' }}>Create a Post</h2>
            </div>
            
            <textarea 
              value={postContent}
              onChange={e => setPostContent(e.target.value)}
              placeholder="What's new? Share updates, offers, or events directly to Google Maps..."
              style={{
                width: '100%',
                background: 'rgba(0,0,0,0.2)',
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                padding: 16,
                color: '#fff',
                fontSize: 14,
                minHeight: 120,
                resize: 'vertical',
                outline: 'none',
                marginBottom: 16
              }}
              onFocus={e => e.currentTarget.style.borderColor = C.accent}
              onBlur={e => e.currentTarget.style.borderColor = C.border}
            />
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button style={{
                background: 'transparent',
                border: `1px dashed ${C.border}`,
                color: C.muted,
                padding: '8px 12px',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                cursor: 'pointer'
              }}>
                <ImageIcon size={16} /> Add Photo
              </button>
              
              <button 
                onClick={() => setShowPreviewModal(true)}
                disabled={posting || postSuccess || !postContent.trim()}
                style={{
                  background: postSuccess ? '#10b981' : C.accent,
                  color: '#fff',
                  border: 'none',
                  padding: '10px 24px',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: (posting || postSuccess || !postContent.trim()) ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  opacity: (!postContent.trim() && !postSuccess) ? 0.5 : 1
                }}
              >
                {posting ? <Loader2 size={16} className="spin" /> : 
                 postSuccess ? <><CheckCircle size={16} /> Posted!</> : 
                 <><Send size={16} /> Publish</>}
              </button>
            </div>
          </div>
          
          <div style={{ background: 'rgba(59, 130, 246, 0.05)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: 16, padding: 24 }}>
            <h3 style={{ color: '#60a5fa', fontSize: 14, fontWeight: 700, margin: '0 0 8px 0' }}>Pro Tip</h3>
            <p style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.6, margin: 0 }}>
              Businesses with complete profiles and regular posts are 2.7x more likely to be considered reputable by Google. Aim to post at least once a week!
            </p>
          </div>
        </div>
      </div>
      {showPreviewModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: C.surface, width: 500, borderRadius: 16, border: `1px solid ${C.border}`, overflow: 'hidden', boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#fff' }}>Confirm GMB Post Publish</h3>
              <button onClick={() => setShowPreviewModal(false)} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 20 }}>&times;</button>
            </div>
            
            <div style={{ padding: 24 }}>
              <p style={{ color: C.muted, fontSize: 13, marginBottom: 16 }}>Here is a preview of how your update will appear on Google Search and Maps:</p>
              
              {/* Google Maps Update Mockup */}
              <div style={{ background: '#fff', borderRadius: 12, padding: 20, color: '#1e293b', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#4285F4', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold', fontSize: 14 }}>
                    {(data?.business?.name || 'B').charAt(0)}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{data?.business?.name || 'Your Business'}</div>
                    <div style={{ fontSize: 11, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 4, fontWeight: 600 }}>Update</span> • Just now
                    </div>
                  </div>
                </div>
                
                <p style={{ fontSize: 14, lineHeight: 1.6, color: '#334155', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {postContent}
                </p>
              </div>
            </div>
            
            <div style={{ padding: '16px 24px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end', gap: 12, background: 'rgba(0,0,0,0.1)' }}>
              <button onClick={() => setShowPreviewModal(false)} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: '#fff', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button 
                onClick={handlePost} 
                disabled={posting}
                style={{ background: C.accent, color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: posting ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
              >
                {posting ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                Confirm & Publish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
