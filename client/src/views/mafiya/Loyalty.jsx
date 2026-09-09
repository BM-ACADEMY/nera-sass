import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '';
import { C } from '../../constants/theme.js';
import {
  Loader2, MapPin, Star, MessageCircle, Eye, Search,
  MousePointerClick, CheckCircle, Megaphone, Send, LogOut,
  Image as ImageIcon, Shield, Sparkles, AlertTriangle, RefreshCw, Heart,
  Filter, Calendar, X
} from 'lucide-react';
import toast from 'react-hot-toast';

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
        desc: 'Google APIs have temporarily rate-limited requests for this account. Please wait a few minutes before trying again.'
      };

    }
    if (code === 403 || message.toLowerCase().includes('permission') || message.toLowerCase().includes('access denied') || message.toLowerCase().includes('forbidden')) {
      return {
        title: 'Google Profile Access Forbidden',
        desc: 'The authenticated Google account does not have Owner or Manager permissions to access these reviews. Please make sure the account is authorized.'
      };
    }
    if (code === 401 || message.toLowerCase().includes('unauthorized') || message.toLowerCase().includes('token expired')) {
      return {
        title: 'Google Session Expired',
        desc: 'Your Google Business Profile connection has expired. Please re-authenticate the Google account.'
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

const parseRelativeTime = (timeStr) => {
  if (!timeStr) return 0;
  const now = new Date();
  const lower = timeStr.toLowerCase().trim();

  if (lower.includes('second')) {
    const val = parseInt(lower) || 1;
    return now.setSeconds(now.getSeconds() - val);
  }
  if (lower.includes('minute')) {
    const val = parseInt(lower) || 1;
    return now.setMinutes(now.getMinutes() - val);
  }
  if (lower.includes('hour')) {
    const val = parseInt(lower) || 1;
    return now.setHours(now.getHours() - val);
  }
  if (lower.includes('day')) {
    const val = parseInt(lower) || 1;
    return now.setDate(now.getDate() - val);
  }
  if (lower.includes('week')) {
    const val = parseInt(lower) || 1;
    return now.setDate(now.getDate() - val * 7);
  }
  if (lower.includes('month')) {
    const val = parseInt(lower) || 1;
    return now.setMonth(now.getMonth() - val);
  }
  if (lower.includes('year')) {
    const val = parseInt(lower) || 1;
    return now.setFullYear(now.getFullYear() - val);
  }

  const parsed = Date.parse(timeStr);
  return isNaN(parsed) ? 0 : parsed;
};

export default function Loyalty() {
  const [clients, setClients] = useState([]);
  const [activeClient, setActiveClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [data, setData] = useState(null);


  // Reply states
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const reviewsPerPage = 5;

  // Filter states
  const [filterType, setFilterType] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [searchName, setSearchName] = useState('');

  const [generatingAiFor, setGeneratingAiFor] = useState(null);

  const generateAiReply = async (review) => {
    setReplyingTo(review.id);
    setGeneratingAiFor(review.id);
    setReplyText('Generating AI reply...');
    try {
      const token = localStorage.getItem('leados_token');
      const { data } = await axios.post(`${API_URL}/api/mafiya/reviews/generate-ai-reply`, {
        clientId: activeClient.id,
        author: review.author,
        rating: review.rating,
        text: review.text
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const businessName = activeClient?.display_name || activeClient?.business_name || 'our company';
      const author = review.author || 'customer';
      const wrappedReply = `Dear ${author},\n\n${data.reply}\n\nWarm Regards,\nTeam ${businessName}`;
      setReplyText(wrappedReply);
    } catch (e) {
      console.error("AI Generation failed, falling back to template:", e);
      toast.error(`AI API Limit Exceeded / Error: ${e.message}`);
      const businessName = activeClient?.display_name || activeClient?.business_name || 'our company';
      const author = review.author || 'customer';
      let text = '';
      if (review.rating >= 5) {
        text = `${author},\n\nThank you so much for your wonderful 5-star review! 🌟 We appreciate your support and are glad you had a great experience with us. 😊\n\nWarm Regards,\nTeam ${businessName}`;
      } else if (review.rating >= 4) {
        text = `${author},\n\nThank you for the feedback! 👍 We are glad you had a positive experience and will keep working to make it a perfect 5-star next time! 🚀\n\nWarm Regards,\nTeam ${businessName}`;
      } else {
        text = `${author},\n\nWe sincerely apologize for the inconvenience. 😔 We take your feedback seriously. Please reach out to us directly so we can make this right. 🙏\n\nWarm Regards,\nTeam ${businessName}`;
      }
      setReplyText(text);
    } finally {
      setGeneratingAiFor(null);
    }
  };

  // 1. Fetch GMB Clients list
  const fetchClients = async () => {
    try {
      const token = localStorage.getItem('leados_token');
      const { data: clientsData } = await axios.get(`${API_URL}/api/mafiya/clients`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setClients(clientsData);
      if (clientsData.length > 0) {
        setActiveClient(clientsData[0]);
      }
    } catch (err) {
      console.error('Fetch clients error:', err);
      toast.error('Failed to load GMB clients');
    } finally {
      setLoading(false);
    }
  };

  // 2. Fetch Review data for selected client
  const fetchReviewData = async (clientId, mode, refresh = false) => {
    if (!clientId) return;
    setDataLoading(true);
    try {
      const token = localStorage.getItem('leados_token');

      // Get Status
      const { data: statusData } = await axios.get(`${API_URL}/api/mafiya/reviews/status?clientId=${clientId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-data-mode': mode
        }
      });
      setConnected(statusData.connected);

      // Get Data
      try {
        const { data: details } = await axios.get(`${API_URL}/api/mafiya/reviews/data?clientId=${clientId}${refresh ? '&refresh=true' : ''}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'x-data-mode': mode
          }
        });
        setData(details);
      } catch (e) {
        setData(null);
      }
    } catch (err) {
      console.error('Fetch review data error:', err);
      toast.error('Failed to load reviews');
    } finally {
      setDataLoading(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  useEffect(() => {
    if (activeClient) {
      setCurrentPage(1);
      fetchReviewData(activeClient.id, 'real');
    }
  }, [activeClient]);

  const submitReply = async (reviewId) => {
    if (!replyText.trim()) return;
    setSubmittingReply(true);
    try {
      const token = localStorage.getItem('leados_token');
      await axios.post(`${API_URL}/api/mafiya/reviews/reply-review`, {
        clientId: activeClient.id,
        reviewId,
        replyText
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      // Optimistic update
      const updatedReviews = data.recentReviews.map(r =>
        r.id === reviewId ? { ...r, replied: true, replyText } : r
      );
      setData({ ...data, recentReviews: updatedReviews });
      toast.success('Reply submitted successfully!');
      setReplyingTo(null);
      setReplyText('');

      // Refresh backend reviews cache immediately
      fetchReviewData(activeClient.id, 'real');
    } catch (err) {
      console.error(err);
      toast.error('Failed to submit reply.');
    } finally {
      setSubmittingReply(false);
    }
  };


  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.text }}>
        <div style={{ textAlign: 'center' }}>
          <Heart size={42} className="animate-pulse" style={{ color: C.accent, marginBottom: 12 }} />
          <p style={{ fontSize: 14 }}>Loading Loyalty & Reviews...</p>
        </div>
      </div>
    );
  }

  if (clients.length === 0) {
    return (
      <div style={{ padding: 40, color: C.text, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: C.background }}>
        <Shield size={48} style={{ opacity: 0.15, marginBottom: 16 }} color="#fff" />
        <h2 style={{ fontSize: 20, color: '#fff', marginBottom: 8 }}>No GMB Clients Configured</h2>
        <p style={{ color: C.muted, textAlign: 'center', maxWidth: 400 }}>Please onboard GMB clients in the Mafiya OS section first to start managing reviews.</p>
      </div>
    );
  }

  let filteredReviews = data?.recentReviews ? [...data.recentReviews] : [];

  if (searchName) {
    filteredReviews = filteredReviews.filter(r => r.author?.toLowerCase().includes(searchName.toLowerCase()));
  }
  
  if (filterType === 'unreplied') {
    filteredReviews = filteredReviews.filter(r => !r.replied);
  } else if (filterType === 'replied') {
    filteredReviews = filteredReviews.filter(r => r.replied);
  }
  
  if (filterType === 'custom_date') {
    if (startDate) {
      filteredReviews = filteredReviews.filter(r => {
        const time = (r.timestamp && !isNaN(new Date(r.timestamp).getTime())) ? new Date(r.timestamp).getTime() : parseRelativeTime(r.date);
        return time >= new Date(startDate).getTime();
      });
    }
    if (endDate) {
      filteredReviews = filteredReviews.filter(r => {
        const time = (r.timestamp && !isNaN(new Date(r.timestamp).getTime())) ? new Date(r.timestamp).getTime() : parseRelativeTime(r.date);
        return time <= new Date(endDate).getTime() + 86400000;
      });
    }
  }

  const sortedReviews = filteredReviews.sort((a, b) => {
    const timeA = (a.timestamp && !isNaN(new Date(a.timestamp).getTime())) ? new Date(a.timestamp).getTime() : parseRelativeTime(a.date);
    const timeB = (b.timestamp && !isNaN(new Date(b.timestamp).getTime())) ? new Date(b.timestamp).getTime() : parseRelativeTime(b.date);
    return timeB - timeA;
  });

  return (
    <div style={{ padding: 40, color: C.text, height: '100%', overflowY: 'auto', background: C.background }}>
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .spin {
          animation: spin 1s linear infinite;
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .skeleton-shimmer {
          background: linear-gradient(90deg, #1c1c1f 25%, #27272a 50%, #1c1c1f 75%);
          background-size: 200% 100%;
          animation: shimmer 1.5s infinite linear;
          border-radius: 8px;
        }
      `}</style>

      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 30 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: '#e2e8f0', margin: 0, fontFamily: "'Syne', sans-serif", display: 'flex', alignItems: 'center', gap: 10 }}>
              🤝 Loyalty (Review)
            </h1>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#10b981', background: 'rgba(16,185,129,0.1)', padding: '4px 10px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 0.5, border: '1px solid rgba(16,185,129,0.2)' }}>
              Reputation
            </span>
          </div>
          <p style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
            Manage GMB reviews, ratings, and customer sentiment for <strong style={{ color: '#fff' }}>{activeClient?.display_name || activeClient?.business_name}</strong>
          </p>
        </div>

        {/* Dropdown & Demo Mode controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => fetchReviewData(activeClient.id, 'real', true)}
            disabled={dataLoading}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: '8px 16px',
              color: '#e2e8f0',
              fontSize: 13,
              cursor: 'pointer',
              height: 38,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'background 0.2s'
            }}
            onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseOut={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
          >
            <RefreshCw size={14} className={dataLoading ? 'spin' : ''} />
            Sync Now
          </button>

          <select
            value={activeClient?.id || ''}
            onChange={(e) => {
              const selected = clients.find(c => c.id === parseInt(e.target.value, 10));
              if (selected) setActiveClient(selected);
            }}
            style={{
              background: '#0f172a',
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: '8px 16px',
              color: '#e2e8f0',
              fontSize: 13,
              outline: 'none',
              cursor: 'pointer',
              height: 38
            }}
          >
            {clients.map(c => (
              <option key={c.id} value={c.id}>
                 {c.display_name || c.business_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <>
          {/* GMB Warning notice if not connected */}
          {!connected && (
            <div style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.2)', padding: 16, borderRadius: 12, display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <AlertTriangle size={20} color="#f59e0b" />
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 700, color: '#f59e0b', fontSize: 14 }}>GMB Authorization Required</span>
                <p style={{ margin: '4px 0 0 0', color: C.muted, fontSize: 13 }}>
                  This client has not authenticated their Google Business Profile yet. Email verification was sent to <strong style={{ color: '#fff' }}>{activeClient?.gmb_email || 'configured email'}</strong>. Currently showing public listings via search scrape.
                </p>
              </div>
            </div>
          )}

          {/* INSIGHTS CARDS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24, marginBottom: 30 }}>
            {/* Total Reviews */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{ background: 'rgba(59, 130, 246, 0.1)', padding: 10, borderRadius: 10 }}>
                  <MessageCircle size={20} color="#3b82f6" />
                </div>
                <h3 style={{ color: C.muted, fontSize: 14, fontWeight: 600, margin: 0 }}>Total Reviews</h3>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
                <span style={{ fontSize: 32, fontWeight: 800, color: '#fff' }}>{data?.business?.totalReviews?.toLocaleString() || '0'}</span>
              </div>
            </div>

            {/* Average Rating */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{ background: 'rgba(245, 158, 11, 0.1)', padding: 10, borderRadius: 10 }}>
                  <Star size={20} color="#f59e0b" fill="#f59e0b" />
                </div>
                <h3 style={{ color: C.muted, fontSize: 14, fontWeight: 600, margin: 0 }}>Average Rating</h3>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
                <span style={{ fontSize: 32, fontWeight: 800, color: '#fff' }}>{data?.business?.rating || '0.0'}</span>
                <span style={{ color: C.muted, fontSize: 14, fontWeight: 600, marginBottom: 6 }}>/ 5.0</span>
              </div>
            </div>

            {/* Unreplied Reviews */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', padding: 10, borderRadius: 10 }}>
                  <MessageCircle size={20} color="#ef4444" />
                </div>
                <h3 style={{ color: C.muted, fontSize: 14, fontWeight: 600, margin: 0 }}>Unreplied Reviews</h3>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
                <span style={{ fontSize: 32, fontWeight: 800, color: '#fff' }}>
                  {data?.recentReviews ? data.recentReviews.filter(r => !r.replied).length : '0'}
                </span>
                <span style={{ color: '#ef4444', fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Action needed</span>
              </div>
            </div>
          </div>

          <div style={{ width: '100%' }}>
            {/* REVIEWS MANAGER */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <MessageCircle size={20} color={C.accent} />
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#fff' }}>Recent Reviews</h2>
                <span style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600 }}>
                  {data?.business?.rating || '0.0'} ★ ({data?.business?.totalReviews || 0})
                </span>
              </div>

              {/* FILTERS */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
                {/* Search */}
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <Search size={14} color={C.muted} style={{ position: 'absolute', left: 12 }} />
                  <input 
                    type="text" 
                    placeholder="Search by name..." 
                    value={searchName}
                    onChange={e => { setSearchName(e.target.value); setCurrentPage(1); }}
                    style={{ 
                      background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, borderRadius: 8, 
                      padding: '0 12px 0 34px', color: '#fff', fontSize: 13, outline: 'none',
                      width: 200, height: 38, boxSizing: 'border-box', transition: 'all 0.2s'
                    }}
                  />
                </div>

                {/* Status Filter */}
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <Filter size={14} color={C.muted} style={{ position: 'absolute', left: 12 }} />
                  <select
                    value={filterType}
                    onChange={e => { setFilterType(e.target.value); setCurrentPage(1); }}
                    style={{ 
                      background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, borderRadius: 8, 
                      padding: '0 32px 0 34px', color: '#fff', fontSize: 13, outline: 'none',
                      appearance: 'none', cursor: 'pointer', minWidth: 160, height: 38, boxSizing: 'border-box'
                    }}
                  >
                    <option style={{ background: C.surface, color: '#fff' }} value="all">All Reviews</option>
                    <option style={{ background: C.surface, color: '#fff' }} value="unreplied">New / Unreplied</option>
                    <option style={{ background: C.surface, color: '#fff' }} value="replied">Replied</option>
                    <option style={{ background: C.surface, color: '#fff' }} value="custom_date">Custom Date</option>
                  </select>
                  <div style={{ position: 'absolute', right: 12, pointerEvents: 'none', display: 'flex', alignItems: 'center' }}>
                    <svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke={C.muted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                </div>

                {/* Date Filter */}
                {filterType === 'custom_date' && (
                  <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, borderRadius: 8, padding: '0 12px', height: 38, boxSizing: 'border-box' }}>
                    <Calendar size={14} color={C.muted} style={{ marginRight: 8 }} />
                    <input 
                      type="date" 
                      value={startDate}
                      onChange={e => { setStartDate(e.target.value); setCurrentPage(1); }}
                      style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 13, outline: 'none', colorScheme: 'dark', height: '100%' }}
                    />
                    <span style={{ color: C.muted, margin: '0 8px', fontSize: 12 }}>to</span>
                    <input 
                      type="date" 
                      value={endDate}
                      onChange={e => { setEndDate(e.target.value); setCurrentPage(1); }}
                      style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 13, outline: 'none', colorScheme: 'dark', height: '100%' }}
                    />
                  </div>
                )}

                {/* Clear Filters */}
                { (searchName || filterType !== 'all' || startDate || endDate) && (
                  <button 
                    onClick={() => { setSearchName(''); setFilterType('all'); setStartDate(''); setEndDate(''); setCurrentPage(1); }}
                    style={{ 
                      background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#f87171', 
                      fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '0 16px', borderRadius: 8,
                      display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.2s', height: 38, boxSizing: 'border-box'
                    }}
                    onMouseOver={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'}
                    onMouseOut={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
                  >
                    <X size={14} /> Clear
                  </button>
                )}
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
                        We successfully authenticated your Google account, but Google's server blocked us from fetching the reviews. Please make sure the Google account you connected has Owner/Manager permissions for this Business Profile.
                      </div>
                    </div>
                  );
                })()}

                {dataLoading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
                    <Loader2 size={28} color={C.accent} className="spin" />
                  </div>
                ) : sortedReviews && sortedReviews.length > 0 ? (
                  sortedReviews.slice((currentPage - 1) * reviewsPerPage, currentPage * reviewsPerPage).map(review => (
                    <div key={review.id} style={{ borderBottom: `1px solid ${C.border}50`, paddingBottom: 20 }}>
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

                      {review.replied && replyingTo !== review.id ? (
                        <div style={{ background: 'rgba(255,255,255,0.03)', padding: 16, borderRadius: 8, borderLeft: `3px solid ${C.accent}` }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: C.accent }}>Your Reply</span>
                              <CheckCircle size={12} color={C.accent} />
                            </div>
                            <button
                              onClick={() => {





                                setReplyingTo(review.id);
                                setReplyText(review.replyText || '');
                              }}
                              style={{ background: 'transparent', border: 'none', color: '#38bdf8', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                            >
                              Edit Reply
                            </button>
                          </div>
                          <p style={{ color: C.muted, fontSize: 13, margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                            {review.replyText?.replace(/<br\s*\/?>/gi, '\n')}
                          </p>
                        </div>
                      ) : (
                        <div>
                          {replyingTo === review.id ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                              {generatingAiFor === review.id ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 20px', background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)', minHeight: 92 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                    <Sparkles size={13} className="spin" color="#f97316" />
                                    <span style={{ fontSize: 11.5, color: '#f97316', fontWeight: 600 }}>AI is drafting a reply...</span>
                                  </div>
                                  <div className="skeleton-shimmer" style={{ height: 10, width: '40%' }} />
                                  <div className="skeleton-shimmer" style={{ height: 10, width: '90%' }} />
                                  <div className="skeleton-shimmer" style={{ height: 10, width: '75%' }} />
                                </div>
                              ) : (
                                <>
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
                                </>
                              )}
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
                            <div style={{ display: 'flex', gap: 12 }}>
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

                              <button
                                onClick={() => generateAiReply(review)}
                                disabled={generatingAiFor === review.id}
                                style={{
                                  background: 'linear-gradient(135deg, rgba(236,72,153,0.15) 0%, rgba(239,68,68,0.15) 100%)',
                                  border: '1px solid rgba(236,72,153,0.3)',
                                  color: '#f472b6',
                                  padding: '6px 16px',
                                  borderRadius: 20,
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: generatingAiFor === review.id ? 'not-allowed' : 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  transition: 'all 0.2s',
                                  opacity: generatingAiFor === review.id ? 0.7 : 1
                                }}
                                onMouseOver={e => { if (generatingAiFor !== review.id) e.currentTarget.style.background = 'linear-gradient(135deg, rgba(236,72,153,0.25) 0%, rgba(239,68,68,0.25) 100%)'; }}
                                onMouseOut={e => { if (generatingAiFor !== review.id) e.currentTarget.style.background = 'linear-gradient(135deg, rgba(236,72,153,0.15) 0%, rgba(239,68,68,0.15) 100%)'; }}
                              >
                                {generatingAiFor === review.id ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
                                {generatingAiFor === review.id ? 'Generating...' : 'AI Reply'}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div style={{ padding: '40px 0', textAlign: 'center', color: C.muted, fontSize: 14 }}>
                    No reviews found for this client.
                  </div>
                )}

                {/* PAGINATION CONTROLS */}
                {sortedReviews && sortedReviews.length > reviewsPerPage && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, paddingTop: 16, borderTop: `1px solid ${C.border}30` }}>
                    <button
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                      style={{
                        background: currentPage === 1 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)',
                        color: currentPage === 1 ? C.muted : '#fff',
                        border: `1px solid ${C.border}`,
                        padding: '6px 16px',
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: currentPage === 1 ? 'not-allowed' : 'pointer'
                      }}
                    >
                      Previous
                    </button>
                    <span style={{ fontSize: 13, color: C.muted }}>
                      Page <strong style={{ color: '#fff' }}>{currentPage}</strong> of <strong style={{ color: '#fff' }}>{Math.ceil(sortedReviews.length / reviewsPerPage)}</strong>
                    </span>
                    <button
                      disabled={currentPage === Math.ceil(sortedReviews.length / reviewsPerPage)}
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(sortedReviews.length / reviewsPerPage)))}
                      style={{
                        background: currentPage === Math.ceil(sortedReviews.length / reviewsPerPage) ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)',
                        color: currentPage === Math.ceil(sortedReviews.length / reviewsPerPage) ? C.muted : '#fff',
                        border: `1px solid ${C.border}`,
                        padding: '6px 16px',
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: currentPage === Math.ceil(sortedReviews.length / reviewsPerPage) ? 'not-allowed' : 'pointer'
                      }}
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
    </div>
  );
}
