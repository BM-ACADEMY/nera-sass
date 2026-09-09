import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL || '';
import { C } from '../../constants/theme.js';
import {
  Megaphone, Plus, Trash2, Download, Sparkles,
  Loader2, Check, Star, X, MoreVertical, ImagePlus,
  Play, Link, BarChart2, ArrowLeft, Calendar, TrendingUp, RefreshCw, Eye, MousePointer
} from 'lucide-react';
import toast from 'react-hot-toast';

const formatTimeAgo = (dateStr) => {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Published just now';
  if (diffMins < 60) return `Published ${diffMins}m ago`;
  if (diffHours < 24) return `Published ${diffHours}h ago`;
  if (diffDays === 1) return 'Published yesterday';
  if (diffDays < 30) return `Published ${diffDays} days ago`;

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths === 1) return 'Published last month';
  return `Published ${diffMonths} months ago`;
};

const PostCountdown = ({ scheduledAt }) => {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const calculateTime = () => {
      const diff = new Date(scheduledAt) - new Date();
      if (diff <= 0) {
        setTimeLeft('Publishing...');
        return;
      }
      const hrs = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);

      let str = '';
      if (hrs > 0) str += `${hrs}h `;
      if (mins > 0 || hrs > 0) str += `${mins}m `;
      str += `${secs}s`;
      setTimeLeft(`Scheduled in ${str}`);
    };

    calculateTime();
    const interval = setInterval(calculateTime, 1000);
    return () => clearInterval(interval);
  }, [scheduledAt]);

  return <span style={{ color: '#f97316', fontWeight: 600, fontSize: 13 }}>{timeLeft}</span>;
};

const GmbPostModal = ({ activeClient, fetchGmbPosts, showModal, setShowModal, editingPost, setEditingPost }) => {
  const [saving, setSaving] = useState(false);
  // Upload Poster states
  const [postType, setPostType] = useState('Update');
  const [description, setDescription] = useState('');
  const [schedulePost, setSchedulePost] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [hasButton, setHasButton] = useState(false);
  const [buttonType, setButtonType] = useState('None');
  const [buttonLink, setButtonLink] = useState('');

  // Offer & Event specific states
  const [postTitle, setPostTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [redeemLink, setRedeemLink] = useState('');
  const [terms, setTerms] = useState('');
  const [repeats, setRepeats] = useState('Does not repeat');
  const [customDays, setCustomDays] = useState([]);
  const [repeatEndDate, setRepeatEndDate] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');

  const [showCoupon, setShowCoupon] = useState(false);
  const [showRedeem, setShowRedeem] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [locations, setLocations] = useState([]);
  const [fetchingLocations, setFetchingLocations] = useState(false);
  const [selectedLocationStr, setSelectedLocationStr] = useState('');
  const [generatingAi, setGeneratingAi] = useState(false);

  const handleGenerateAiSuggestion = async () => {
    if (!selectedImage) {
      toast.error('Please upload an image first');
      return;
    }
    
    setGeneratingAi(true);
    const aiToast = toast.loading('AI analyzing poster to generate title & description...');
    try {
      const token = localStorage.getItem('leados_token');
      const res = await axios.post(`${API_URL}/api/mafiya/reviews/posts/generate-from-image`, {
        clientId: activeClient.id,
        imageBase64: selectedImage
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.data.title) setPostTitle(res.data.title);
      if (res.data.description) setDescription(res.data.description);
      if (res.data.actionButton) {
        const actionMap = {
          'BOOK': 'Book',
          'ORDER': 'Order online',
          'SHOP': 'Buy',
          'LEARN_MORE': 'Learn more',
          'SIGN_UP': 'Sign up',
          'CALL': 'Call now'
        };
        const mappedAction = actionMap[res.data.actionButton] || res.data.actionButton;
        if (mappedAction !== 'None') {
          setHasButton(true);
          setButtonType(mappedAction);
          setButtonLink('');
        }
      }
      toast.success('AI suggestions loaded successfully!', { id: aiToast });
    } catch (err) {
      console.error('[AI Generation error]:', err);
      const errMsg = err.response?.data?.message || err.response?.data?.error || 'AI failed to parse image details.';
      toast.error(errMsg, { id: aiToast });
    } finally {
      setGeneratingAi(false);
    }
  };

  useEffect(() => {
    if (showModal && activeClient && !activeClient.google_location_id) {
      const fetchLocs = async () => {
        setFetchingLocations(true);
        try {
          const token = localStorage.getItem('leados_token');
          const res = await axios.get(`${API_URL}/api/mafiya/reviews/google-locations?clientId=${activeClient.id}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          const data = res.data;
          setLocations(data);
          if (data.length > 0) setSelectedLocationStr(data[0].accountId + '|' + data[0].locationId);
        } catch (e) {
          console.error(e);
        } finally {
          setFetchingLocations(false);
        }
      };
      fetchLocs();
    }
  }, [showModal, activeClient]);

  useEffect(() => {
    setRepeats('Does not repeat');
  }, [startDate]);

  // Pre-populate state fields when editing a post
  useEffect(() => {
    if (showModal) {
      if (editingPost) {
        setPostType(editingPost.post_type || 'Update');
        setDescription(editingPost.caption || '');
        setSelectedImage(editingPost.image_url || null);
        setPostTitle(editingPost.post_title || editingPost.poster_title || '');

        const formatDate = (dateVal) => {
          if (!dateVal) return '';
          const d = new Date(dateVal);
          return d.toISOString().split('T')[0];
        };
        const formatTime = (timeVal) => {
          if (!timeVal) return '';
          return timeVal.substring(0, 5); // HH:MM
        };

        setStartDate(formatDate(editingPost.start_date));
        setEndDate(formatDate(editingPost.end_date));
        setStartTime(formatTime(editingPost.start_time));
        setEndTime(formatTime(editingPost.end_time));
        setCouponCode(editingPost.coupon_code || '');
        setRedeemLink(editingPost.redeem_link || '');
        setTerms(editingPost.terms || '');
        setRepeats(editingPost.repeats || 'Does not repeat');
        setCustomDays(editingPost.custom_days ? editingPost.custom_days.split(',') : []);
        setRepeatEndDate(formatDate(editingPost.repeat_end_date));

        if (editingPost.scheduled_at) {
          setSchedulePost(true);
          const d = new Date(editingPost.scheduled_at);
          const localISO = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
          setScheduledDate(localISO.split('T')[0]);
          setScheduledTime(localISO.split('T')[1].substring(0, 5));
        } else {
          setSchedulePost(false);
          setScheduledDate('');
          setScheduledTime('');
        }

        if (editingPost.poster_subtitle && editingPost.poster_subtitle.includes('|')) {
          const [bType, bLink] = editingPost.poster_subtitle.split('|');
          setHasButton(true);
          setButtonType(bType);
          setButtonLink(bLink || '');
        } else if (editingPost.action_button) {
          const actionMap = {
            'BOOK': 'Book',
            'ORDER': 'Order online',
            'SHOP': 'Buy',
            'LEARN_MORE': 'Learn more',
            'SIGN_UP': 'Sign up',
            'CALL': 'Call now'
          };
          const mappedAction = actionMap[editingPost.action_button] || editingPost.action_button;
          if (mappedAction !== 'None') {
            setHasButton(true);
            setButtonType(mappedAction);
            setButtonLink('');
          } else {
            setHasButton(false);
            setButtonType('None');
            setButtonLink('');
          }
        } else {
          setHasButton(false);
          setButtonType('None');
          setButtonLink('');
        }

        setShowCoupon(!!editingPost.coupon_code);
        setShowRedeem(!!editingPost.redeem_link);
        setShowTerms(!!editingPost.terms);
      } else {
        // Reset states for new post
        setPostType('Update');
        setDescription('');
        setSelectedImage(null);
        setPostTitle('');
        setStartDate('');
        setEndDate('');
        setStartTime('');
        setEndTime('');
        setCouponCode('');
        setRedeemLink('');
        setTerms('');
        setRepeats('Does not repeat');
        setCustomDays([]);
        setRepeatEndDate('');
        setSchedulePost(false);
        setScheduledDate('');
        setScheduledTime('');
        setHasButton(false);
        setButtonType('None');
        setButtonLink('');
        setShowCoupon(false);
        setShowRedeem(false);
        setShowTerms(false);
      }
    }
  }, [showModal, editingPost]);

  const handleSaveConnection = async () => {
    if (!selectedLocationStr) return;
    const [accId, locId] = selectedLocationStr.split('|');
    setSaving(true);
    try {
      const token = localStorage.getItem('leados_token');
      await axios.put(`${API_URL}/api/mafiya/reviews/google-locations`, {
          clientId: activeClient.id,
          google_account_id: accId,
          google_location_id: locId
        }, {
          headers: { Authorization: `Bearer ${token}` }
        });
        toast.success('Connected to GMB Location!');
        activeClient.google_account_id = accId;
        activeClient.google_location_id = locId;
        setLocations([...locations]); // force re-render
    } catch(err) {
      toast.error('Failed to connect location');
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const limit = 5 * 1024 * 1024;

      if (file.size > limit) {
        toast.error('Upload 5MB only');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  // Save Uploaded / Edited Post
  const handleSavePost = async () => {
    if (!description) {
      toast.error('Description is required');
      return;
    }
    if ((postType === 'Offer' || postType === 'Event') && !postTitle) {
      toast.error('Title is required for Offer/Event');
      return;
    }
    if ((postType === 'Offer' || postType === 'Event') && (!startDate || !endDate)) {
      toast.error('Start and End dates are required');
      return;
    }
    if (postType === 'Offer' || postType === 'Event') {
      const startDateTime = new Date(`${startDate}T${startTime || '00:00'}`);
      const endDateTime = new Date(`${endDate}T${endTime || '00:00'}`);
      if (startDateTime >= endDateTime) {
        toast.error('End date/time must be strictly after start date/time');
        return;
      }
    }
    if (postType !== 'Offer' && hasButton && buttonType !== 'None' && buttonType !== 'Call now') {
      if (!buttonLink) {
        toast.error('Button Link is required');
        return;
      }
      try {
        new URL(buttonLink);
      } catch (_) {
        toast.error('Please enter a valid URL (starting with http:// or https://) for the button link');
        return;
      }
    }
    if (schedulePost) {
      if (!scheduledDate || !scheduledTime) {
        toast.error('Schedule Date and Time are required');
        return;
      }
      const scheduledDateTime = new Date(`${scheduledDate}T${scheduledTime}`);
      if (scheduledDateTime <= new Date()) {
        toast.error('Scheduled date/time must be in the future');
        return;
      }
    }
    setSaving(true);
    try {
      const token = localStorage.getItem('leados_token');
      const url = editingPost
        ? `${API_URL}/api/mafiya/reviews/posts/${editingPost.id}`
        : `${API_URL}/api/mafiya/reviews/posts`;
      const method = editingPost ? 'put' : 'post';

      await axios[method](url, {
          clientId: activeClient.id,
          postType: postType,
          caption: description,
          posterTitle: (postType === 'Offer' || postType === 'Event') ? postTitle : postType.toUpperCase(),
          posterSubtitle: (hasButton && buttonType !== 'None') ? `${buttonType}|${buttonLink}` : '',
          bgTheme: 'custom_stock',
          imageUrl: selectedImage || '',
          status: schedulePost ? 'scheduled' : 'published',
          scheduledAt: schedulePost ? new Date(`${scheduledDate}T${scheduledTime}`).toISOString() : null,
          clientNow: new Date().toISOString(),
          postTitle: postTitle,
          startDate: startDate || null,
          endDate: endDate || null,
          startTime: startTime || null,
          endTime: endTime || null,
          couponCode: couponCode || null,
          redeemLink: redeemLink || null,
          terms: terms || null,
          repeats: repeats,
          customDays: customDays.join(','),
          repeatEndDate: repeatEndDate || null
        }, {
          headers: { Authorization: `Bearer ${token}` }
        });
        toast.success(editingPost ? 'Post updated successfully!' : (schedulePost ? 'Post scheduled successfully!' : 'Published to GMB Successfully!'));
        setShowModal(false);
        if (setEditingPost) setEditingPost(null);
        fetchGmbPosts(activeClient.id);
        setDescription('');
        setSelectedImage(null);
        setPostTitle('');
        setStartDate('');
        setEndDate('');
        setStartTime('');
        setEndTime('');
        setCouponCode('');
        setRedeemLink('');
        setTerms('');
        setRepeats('Does not repeat');
        setCustomDays([]);
        setRepeatEndDate('');
        setSchedulePost(false);
        setScheduledDate('');
        setScheduledTime('');
        setHasButton(false);
        setButtonType('None');
        setButtonLink('');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };




  const getLocalDayAndOccurrence = (dateStr) => {
    if (!dateStr) return { dayName: 'Wednesday', occurrence: 'the first Wednesday' };
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
    const dayNum = date.getDate();
    const index = Math.ceil(dayNum / 7);
    const ordinal = ['first', 'second', 'third', 'fourth', 'fifth'][index - 1] || 'first';
    return {
      dayName,
      occurrence: `the ${ordinal} ${dayName}`
    };
  };

  const { dayName, occurrence } = getLocalDayAndOccurrence(startDate);

  const toggleDay = (day) => {
    if (customDays.includes(day)) {
      setCustomDays(customDays.filter(d => d !== day));
    } else {
      setCustomDays([...customDays, day]);
    }
  };

  const clientName = activeClient?.display_name || activeClient?.business_name || 'GMB Profile';
  const contactPhone = activeClient?.phone_number || '';

  return (
    <>
      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .skeleton-shimmer {
          background: linear-gradient(90deg, #27272a 25%, #3f3f46 50%, #27272a 75%);
          background-size: 200% 100%;
          animation: shimmer 1.5s infinite linear;
        }

      `}</style>
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(9, 9, 11, 0.8)', backdropFilter: 'blur(8px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999, padding: 20 }}>
          <div style={{ background: '#18181b', width: '100%', maxWidth: 840, maxHeight: '90vh', borderRadius: 16, border: '1px solid rgba(255, 255, 255, 0.08)', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column' }}>

            {/* Header */}
            <div style={{ padding: '20px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ background: 'rgba(249,115,22,0.1)', padding: 8, borderRadius: 8 }}>
                  <Megaphone size={20} color="#f97316" />
                </div>
                <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: '#f4f4f5', fontFamily: "'Syne', sans-serif" }}>Create GMB Post</h2>
              </div>
              <button
                onClick={() => setShowModal(false)}
                style={{ background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.2s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
              >
                <X size={18} color="#a1a1aa" />
              </button>
            </div>

            <div style={{ padding: '28px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 24 }}>

              {!activeClient?.google_location_id ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '40px 20px', textAlign: 'center' }}>
                  <div style={{ background: 'rgba(249,115,22,0.1)', padding: 20, borderRadius: '50%', marginBottom: 20, border: '1px solid rgba(249,115,22,0.2)' }}>
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                  </div>
                  <h3 style={{ color: '#f4f4f5', fontSize: 20, fontWeight: 700, margin: '0 0 12px 0' }}>Connect Google Business Location</h3>
                  <p style={{ color: '#a1a1aa', fontSize: 14, maxWidth: 440, marginBottom: 28, lineHeight: 1.6 }}>
                    To publish posts directly to Google, please connect the specific business location for <strong style={{ color: '#fff' }}>{clientName}</strong>.
                  </p>

                  {fetchingLocations ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#f97316' }}>
                      <Loader2 size={18} className="animate-spin" />
                      <span>Fetching verified locations...</span>
                    </div>
                  ) : locations.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 380 }}>
                      <select
                        value={selectedLocationStr}
                        onChange={e => setSelectedLocationStr(e.target.value)}
                        style={{ background: '#27272a', border: '1px solid rgba(255,255,255,0.1)', color: '#f4f4f5', padding: '14px 18px', borderRadius: 8, fontSize: 14, outline: 'none', cursor: 'pointer' }}
                      >
                        {locations.map((loc, i) => (
                          <option key={i} value={loc.accountId + '|' + loc.locationId}>{loc.title}</option>
                        ))}
                      </select>
                      <button
                        onClick={handleSaveConnection}
                        disabled={saving}
                        style={{ background: 'linear-gradient(135deg, #f97316, #ea580c)', color: '#fff', border: 'none', padding: '14px', borderRadius: 8, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', boxShadow: '0 4px 14px rgba(249,115,22,0.3)', transition: 'all 0.2s' }}
                      >
                        {saving ? 'Connecting...' : 'Connect Location'}
                      </button>
                    </div>
                  ) : (
                    <div style={{ background: 'rgba(239,68,68,0.06)', padding: 20, borderRadius: 12, border: '1px solid rgba(239,68,68,0.2)', width: '100%', maxWidth: 460 }}>
                      <p style={{ color: '#ef4444', margin: 0, fontSize: 13.5, lineHeight: 1.6 }}>
                        We couldn't find any locations in your Google Account. Please ensure you have connected an account that manages Google Business Profiles in the Local SEO Bridge.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* Tabs */}
                  <div style={{ display: 'flex', gap: 10, background: '#27272a', padding: 6, borderRadius: 10, width: 'fit-content' }}>
                    {['Update', 'Offer', 'Event'].map(tab => {
                      const isActive = postType === tab;
                      return (
                        <button
                          key={tab}
                          onClick={() => setPostType(tab)}
                          style={{
                            background: isActive ? 'linear-gradient(135deg, #f97316, #ea580c)' : 'transparent',
                            border: 'none',
                            color: isActive ? '#fff' : '#a1a1aa',
                            padding: '8px 20px',
                            borderRadius: 8,
                            fontSize: 13.5,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            transition: 'all 0.2s',
                            boxShadow: isActive ? '0 4px 12px rgba(249,115,22,0.2)' : 'none'
                          }}
                        >
                          {isActive && <Check size={14} strokeWidth={3} />}
                          {tab}
                        </button>
                      );
                    })}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 32 }} className="grid-responsive">

                    {/* Left Column (Inputs) */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                      {/* Dynamic Title for Offer & Event */}
                      {(postType === 'Offer' || postType === 'Event') && (
                        generatingAi ? (
                          <div
                            className="skeleton-shimmer"
                            style={{
                              width: '100%',
                              height: 58,
                              borderRadius: 8,
                              border: '1px solid rgba(255,255,255,0.08)',
                              boxSizing: 'border-box'
                            }}
                          />
                        ) : (
                          <div style={{ position: 'relative' }}>
                            <input
                              type="text"
                              value={postTitle}
                              onChange={(e) => setPostTitle(e.target.value.slice(0, 58))}
                              placeholder="Title*"
                              style={{
                                width: '100%',
                                background: '#27272a',
                                border: '1px solid rgba(255,255,255,0.12)',
                                borderRadius: 8,
                                padding: '16px 16px 20px 16px',
                                color: '#fff',
                                fontSize: 14,
                                outline: 'none',
                                boxSizing: 'border-box',
                                transition: 'border-color 0.2s'
                              }}
                              onFocus={e => e.target.style.borderColor = '#f97316'}
                              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.12)'}
                            />
                            <div style={{ position: 'absolute', bottom: 6, right: 12, fontSize: 10, color: '#71717a' }}>
                              {postTitle.length}/58
                            </div>
                          </div>
                        )
                      )}

                      {/* Description */}
                      {generatingAi ? (
                        <div style={{
                          width: '100%',
                          height: 120,
                          background: '#1c1c1e',
                          border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: 8,
                          padding: '16px',
                          boxSizing: 'border-box',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 12
                        }}>
                          <div className="skeleton-shimmer" style={{ width: '80%', height: 14, borderRadius: 4 }} />
                          <div className="skeleton-shimmer" style={{ width: '95%', height: 14, borderRadius: 4 }} />
                          <div className="skeleton-shimmer" style={{ width: '60%', height: 14, borderRadius: 4 }} />
                          <div className="skeleton-shimmer" style={{ width: '75%', height: 14, borderRadius: 4 }} />
                        </div>
                      ) : (
                        <div style={{ position: 'relative' }}>
                          <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value.slice(0, 1500))}
                            placeholder="What's new? (Description)*"
                            style={{
                              width: '100%',
                              height: 120,
                              background: '#27272a',
                              border: '1px solid rgba(255,255,255,0.12)',
                              borderRadius: 8,
                              padding: '16px 16px 24px 16px',
                              color: '#fff',
                              fontSize: 14,
                              outline: 'none',
                              resize: 'none',
                              boxSizing: 'border-box',
                              lineHeight: 1.5,
                              transition: 'border-color 0.2s'
                            }}
                            onFocus={e => e.target.style.borderColor = '#f97316'}
                            onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.12)'}
                          />
                          <div style={{ position: 'absolute', bottom: 8, right: 12, fontSize: 10, color: '#71717a' }}>
                            {description.length}/1,500
                          </div>
                        </div>
                      )}

                      {/* Date and Time Fields for Offer / Event */}
                      {(postType === 'Offer' || postType === 'Event') && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, background: '#27272a4d', padding: 16, borderRadius: 12, border: '1px solid rgba(255,255,255,0.04)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }} className="grid-responsive">
                            <div style={{ position: 'relative' }}>
                              <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 6 }}>Start Date*</label>
                              <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                style={{ width: '100%', boxSizing: 'border-box', background: '#27272a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '12px 14px', color: '#fff', fontSize: 13.5, outline: 'none' }}
                              />
                            </div>
                            <div style={{ position: 'relative' }}>
                              <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 6 }}>Start Time</label>
                              <input
                                type="time"
                                value={startTime}
                                onChange={(e) => setStartTime(e.target.value)}
                                style={{ width: '100%', boxSizing: 'border-box', background: '#27272a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '12px 14px', color: '#fff', fontSize: 13.5, outline: 'none' }}
                              />
                            </div>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }} className="grid-responsive">
                            <div style={{ position: 'relative' }}>
                              <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 6 }}>End Date*</label>
                              <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                style={{ width: '100%', boxSizing: 'border-box', background: '#27272a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '12px 14px', color: '#fff', fontSize: 13.5, outline: 'none' }}
                              />
                            </div>
                            <div style={{ position: 'relative' }}>
                              <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 6 }}>End Time</label>
                              <input
                                type="time"
                                value={endTime}
                                onChange={(e) => setEndTime(e.target.value)}
                                style={{ width: '100%', boxSizing: 'border-box', background: '#27272a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '12px 14px', color: '#fff', fontSize: 13.5, outline: 'none' }}
                              />
                            </div>
                          </div>

                          {/* Repeats Cadence */}
                          <div style={{ position: 'relative' }}>
                            <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 6 }}>Repeats</label>
                            <select
                              value={repeats}
                              onChange={(e) => setRepeats(e.target.value)}
                              style={{ width: '100%', boxSizing: 'border-box', background: '#27272a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '12px 14px', color: '#fff', fontSize: 13.5, outline: 'none', cursor: 'pointer' }}
                            >
                              <option value="Does not repeat" style={{background: '#202124'}}>Does not repeat</option>
                              <option value="Daily" style={{background: '#202124'}}>Daily</option>
                              <option value={`Weekly on ${dayName}`} style={{background: '#202124'}}>{`Weekly on ${dayName}`}</option>
                              <option value="Custom weekly" style={{background: '#202124'}}>Custom weekly</option>
                              <option value={`Monthly on ${occurrence}`} style={{background: '#202124'}}>{`Monthly on ${occurrence}`}</option>
                            </select>
                          </div>

                          {/* Custom Repeat Days */}
                          {repeats === 'Custom weekly' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4, background: '#1e1e21', padding: 14, borderRadius: 8 }}>
                              <label style={{ fontSize: 12, color: '#a1a1aa', fontWeight: 600 }}>Select days that the post repeats on</label>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => {
                                  const isSelected = customDays.includes(day);
                                  return (
                                    <button
                                      key={day}
                                      type="button"
                                      onClick={() => toggleDay(day)}
                                      style={{
                                        background: isSelected ? 'linear-gradient(135deg, #f97316, #ea580c)' : 'rgba(255,255,255,0.05)',
                                        border: isSelected ? 'none' : '1px solid rgba(255,255,255,0.08)',
                                        color: isSelected ? '#fff' : '#a1a1aa',
                                        padding: '6px 12px',
                                        borderRadius: 6,
                                        fontSize: 12,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s'
                                      }}
                                    >
                                      {day}
                                    </button>
                                  );
                                })}
                              </div>

                              <div style={{ position: 'relative', marginTop: 8 }}>
                                <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 6 }}>Repeating post will end on</label>
                                <input
                                  type="date"
                                  value={repeatEndDate}
                                  onChange={(e) => setRepeatEndDate(e.target.value)}
                                  style={{ width: '100%', boxSizing: 'border-box', background: '#27272a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none' }}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Schedule switch */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#27272a4d', padding: '14px 18px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.04)' }}>
                        <div>
                          <span style={{ fontSize: 14.5, color: '#fff', fontWeight: 600, display: 'block' }}>Schedule this post</span>
                          <span style={{ fontSize: 11.5, color: '#71717a' }}>Publish at a customized future date</span>
                        </div>
                        <div
                          onClick={() => setSchedulePost(!schedulePost)}
                          style={{
                            width: 40, height: 22,
                            background: schedulePost ? '#f97316' : '#3f3f46',
                            borderRadius: 100,
                            position: 'relative',
                            cursor: 'pointer',
                            transition: 'background 0.2s'
                          }}
                        >
                          <div style={{
                            width: 16, height: 16,
                            background: '#fff',
                            borderRadius: '50%',
                            position: 'absolute',
                            top: 3, left: schedulePost ? 21 : 3,
                            transition: 'left 0.2s',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                          }} />
                        </div>
                      </div>

                      {schedulePost && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, background: '#27272a4d', padding: 16, borderRadius: 12, border: '1px solid rgba(255,255,255,0.04)', marginTop: -8 }}>
                          <div>
                            <label style={{ fontSize: 11.5, color: '#a1a1aa', display: 'block', marginBottom: 6 }}>Schedule Date*</label>
                            <input
                              type="date"
                              value={scheduledDate}
                              onChange={(e) => setScheduledDate(e.target.value)}
                              style={{ width: '100%', boxSizing: 'border-box', background: '#27272a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '12px 14px', color: '#fff', fontSize: 13.5, outline: 'none' }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: 11.5, color: '#a1a1aa', display: 'block', marginBottom: 6 }}>Schedule Time*</label>
                            <input
                              type="time"
                              value={scheduledTime}
                              onChange={(e) => setScheduledTime(e.target.value)}
                              style={{ width: '100%', boxSizing: 'border-box', background: '#27272a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '12px 14px', color: '#fff', fontSize: 13.5, outline: 'none' }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Add more details (Buttons/Offers specific) */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, background: '#27272a4d', padding: 18, borderRadius: 12, border: '1px solid rgba(255,255,255,0.04)' }}>
                        <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: '#fff' }}>Add more details</h3>

                        {postType === 'Offer' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                              <button onClick={() => setShowTerms(!showTerms)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: showTerms ? 'rgba(249,115,22,0.1)' : 'rgba(255,255,255,0.04)', border: `1px solid ${showTerms ? '#f97316' : 'rgba(255,255,255,0.1)'}`, borderRadius: 20, padding: '6px 14px', color: showTerms ? '#f97316' : '#a1a1aa', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}>
                                {showTerms ? <X size={13}/> : <Plus size={13}/>} Terms
                              </button>
                              <button onClick={() => setShowCoupon(!showCoupon)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: showCoupon ? 'rgba(249,115,22,0.1)' : 'rgba(255,255,255,0.04)', border: `1px solid ${showCoupon ? '#f97316' : 'rgba(255,255,255,0.1)'}`, borderRadius: 20, padding: '6px 14px', color: showCoupon ? '#f97316' : '#a1a1aa', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}>
                                {showCoupon ? <X size={13}/> : <Plus size={13}/>} Coupon code
                              </button>
                              <button onClick={() => setShowRedeem(!showRedeem)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: showRedeem ? 'rgba(249,115,22,0.1)' : 'rgba(255,255,255,0.04)', border: `1px solid ${showRedeem ? '#f97316' : 'rgba(255,255,255,0.1)'}`, borderRadius: 20, padding: '6px 14px', color: showRedeem ? '#f97316' : '#a1a1aa', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}>
                                {showRedeem ? <X size={13}/> : <Plus size={13}/>} Link to redeem
                              </button>
                            </div>

                            {showTerms && (
                              <input type="text" value={terms} onChange={e => setTerms(e.target.value)} placeholder="Terms and conditions" style={{ width: '100%', boxSizing: 'border-box', background: '#27272a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '12px 14px', color: '#fff', fontSize: 13.5, outline: 'none' }} />
                            )}
                            {showCoupon && (
                              <input type="text" value={couponCode} onChange={e => setCouponCode(e.target.value)} placeholder="Coupon code" style={{ width: '100%', boxSizing: 'border-box', background: '#27272a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '12px 14px', color: '#fff', fontSize: 13.5, outline: 'none' }} />
                            )}
                            {showRedeem && (
                              <input type="url" value={redeemLink} onChange={e => setRedeemLink(e.target.value)} placeholder="Link to redeem offer (e.g. https://yourstore.com/offer)" style={{ width: '100%', boxSizing: 'border-box', background: '#27272a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '12px 14px', color: '#fff', fontSize: 13.5, outline: 'none' }} />
                            )}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                            <button
                              onClick={() => { setHasButton(!hasButton); if(!hasButton) setButtonType('Call now'); }}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                background: hasButton ? 'rgba(249,115,22,0.1)' : 'rgba(255,255,255,0.04)',
                                border: `1px solid ${hasButton ? '#f97316' : 'rgba(255,255,255,0.1)'}`,
                                borderRadius: 20, padding: '6px 14px',
                                color: hasButton ? '#f97316' : '#a1a1aa',
                                fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                                alignSelf: 'flex-start',
                                transition: 'all 0.2s'
                              }}
                            >
                              {hasButton ? <X size={13}/> : <Plus size={13}/>} Action Button
                            </button>

                            {hasButton && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, background: '#1e1e21', padding: 16, borderRadius: 8 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  <label style={{ fontSize: 12, color: '#a1a1aa' }}>Select Button Type</label>
                                  <select
                                    value={buttonType}
                                    onChange={(e) => setButtonType(e.target.value)}
                                    style={{
                                      background: '#27272a',
                                      border: '1px solid rgba(255,255,255,0.1)',
                                      borderRadius: 6,
                                      padding: '12px 14px',
                                      color: '#fff',
                                      fontSize: 13.5,
                                      outline: 'none',
                                      cursor: 'pointer',
                                      width: '100%',
                                      boxSizing: 'border-box'
                                    }}
                                  >
                                    <option value="None" style={{ background: '#202124' }}>None</option>
                                    <option value="Book" style={{ background: '#202124' }}>Book</option>
                                    <option value="Order online" style={{ background: '#202124' }}>Order online</option>
                                    <option value="Buy" style={{ background: '#202124' }}>Buy</option>
                                    <option value="Learn more" style={{ background: '#202124' }}>Learn more</option>
                                    <option value="Sign up" style={{ background: '#202124' }}>Sign up</option>
                                    <option value="Call now" style={{ background: '#202124' }}>Call now</option>
                                  </select>
                                </div>

                                {buttonType === 'Call now' ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <label style={{ fontSize: 11.5, color: '#a1a1aa' }}>Connected Number</label>
                                    <div style={{ width: '100%', boxSizing: 'border-box', background: '#27272a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '12px 14px', color: '#fff', fontSize: 13.5 }}>
                                      {contactPhone || 'No phone number available'}
                                    </div>
                                    <span style={{ fontSize: 11, color: '#71717a' }}>Customers will call this number directly from Google.</span>
                                  </div>
                                ) : buttonType !== 'None' ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <label style={{ fontSize: 11.5, color: '#a1a1aa' }}>Button Link Destination*</label>
                                    <input
                                      type="url"
                                      value={buttonLink}
                                      onChange={(e) => setButtonLink(e.target.value)}
                                      placeholder="https://example.com/link"
                                      style={{ width: '100%', boxSizing: 'border-box', background: '#27272a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '12px 14px', color: '#fff', fontSize: 13.5, outline: 'none' }}
                                    />
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                    </div>

                    {/* Right Column (Image/Media Upload) */}
                    <div style={{ width: '100%' }}>
                      <div style={{ position: 'sticky', top: 0, width: '100%' }}>
                        <label style={{ fontSize: 13.5, color: '#a1a1aa', display: 'block', marginBottom: 8, fontWeight: 600 }}>Media (Image / Video)</label>
                        <label style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          height: 240,
                          width: '100%',
                          boxSizing: 'border-box',
                          border: '2px dashed rgba(255,255,255,0.15)',
                          borderRadius: 12,
                          background: 'rgba(255,255,255,0.02)',
                          cursor: 'pointer',
                          overflow: 'hidden',
                          position: 'relative',
                          transition: 'all 0.2s'
                        }}
                          onMouseEnter={e => e.currentTarget.style.borderColor = '#f97316'}
                          onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'}
                        >
                          {selectedImage ? (
                            <>
                              {selectedImage.startsWith('data:video/') ? (
                                <video src={selectedImage} style={{ width: '100%', height: '100%', objectFit: 'cover' }} controls />
                              ) : (
                                <img src={selectedImage} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              )}
                              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.2s' }} onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = 0}>
                                <span style={{ color: '#fff', fontSize: 13, fontWeight: 600, background: '#f97316', padding: '6px 14px', borderRadius: 6 }}>Change Media</span>
                              </div>
                            </>
                          ) : (
                            <div style={{ textAlign: 'center', padding: 20 }}>
                              <div style={{ background: 'rgba(249,115,22,0.08)', padding: 12, borderRadius: '50%', width: 'fit-content', margin: '0 auto 16px auto' }}>
                                <ImagePlus size={24} color="#f97316" />
                              </div>
                              <span style={{ color: '#f4f4f5', fontSize: 14, fontWeight: 600, display: 'block', marginBottom: 4 }}>Drag visual media here</span>
                              <span style={{ color: '#71717a', fontSize: 12, display: 'block', marginBottom: 12 }}>PNG, JPG, or MP4 formats</span>
                              <span style={{ color: '#f97316', fontSize: 13, fontWeight: 700 }}>Browse Files</span>
                            </div>
                          )}
                          <input type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleImageUpload} />
                        </label>

                        {/* AI Suggestion Button */}
                        {selectedImage && (
                          <button
                            type="button"
                            onClick={handleGenerateAiSuggestion}
                            disabled={generatingAi}
                            style={{
                              marginTop: 16,
                              width: '100%',
                              background: 'rgba(249,115,22,0.08)',
                              border: '1px solid rgba(249,115,22,0.2)',
                              borderRadius: 8,
                              padding: '12px',
                              color: '#f97316',
                              fontSize: 13,
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 8,
                              cursor: generatingAi ? 'not-allowed' : 'pointer',
                              transition: 'all 0.2s'
                            }}
                            onMouseEnter={e => { if(!generatingAi) { e.currentTarget.style.background = 'rgba(249,115,22,0.15)'; e.currentTarget.style.color = '#fff'; } }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(249,115,22,0.08)'; e.currentTarget.style.color = '#f97316'; }}
                          >
                            {generatingAi ? (
                              <>
                                <Loader2 size={15} className="spin" />
                                <span>AI analyzing poster...</span>
                              </>
                            ) : (
                              <>
                                <Sparkles size={15} />
                                <span>Suggest with AI</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '20px 28px', display: 'flex', justifyContent: 'flex-end', gap: 12, borderTop: '1px solid rgba(255, 255, 255, 0.08)', background: '#1c1c1f' }}>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  background: 'transparent',
                  color: '#a1a1aa',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  padding: '10px 22px',
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#a1a1aa'; }}
              >
                Cancel
              </button>
              <button
                onClick={handleSavePost}
                disabled={saving || !description}
                style={{
                  background: (saving || !description) ? '#27272a' : 'linear-gradient(135deg, #f97316, #ea580c)',
                  color: (saving || !description) ? '#71717a' : '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '10px 24px',
                  fontSize: 13.5,
                  fontWeight: 700,
                  cursor: (saving || !description) ? 'not-allowed' : 'pointer',
                  opacity: (saving || !description) ? 0.6 : 1,
                  boxShadow: (saving || !description) ? 'none' : '0 4px 14px rgba(249,115,22,0.3)',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={e => { if(!saving && description) e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { if(!saving && description) e.currentTarget.style.transform = 'translateY(0)'; }}
              >
                {saving ? 'Publishing...' : 'Publish Post'}
              </button>
            </div>

          </div>
        </div>
      )}
    </>
  );
};

const PostAnalyticsView = ({ post, onBack, activeClient }) => {
  // Filters
  const [rangeType, setRangeType] = useState('Month'); // 'Month' or 'Date'

  // Custom range dialog states
  const [showRangePopover, setShowRangePopover] = useState(false);
  const [tempRangeType, setTempRangeType] = useState('Month');

  // Month range values
  const [fromMonth, setFromMonth] = useState('February, 2026');
  const [toMonth, setToMonth] = useState('July, 2026');

  // Date range values
  const [fromDate, setFromDate] = useState('2026-02-01');
  const [toDate, setToDate] = useState('2026-07-31');

  // Applied values
  const [appliedRangeType, setAppliedRangeType] = useState('Month');
  const [appliedFromMonth, setAppliedFromMonth] = useState('February, 2026');
  const [appliedToMonth, setAppliedToMonth] = useState('July, 2026');
  const [appliedFromDate, setAppliedFromDate] = useState('2026-02-01');
  const [appliedToDate, setAppliedToDate] = useState('2026-07-31');

  // Hover state for interactive tooltip
  const [hoveredPointIdx, setHoveredPointIdx] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const monthsList = [
    'January, 2026', 'February, 2026', 'March, 2026', 'April, 2026',
    'May, 2026', 'June, 2026', 'July, 2026', 'August, 2026',
    'September, 2026', 'October, 2026', 'November, 2026', 'December, 2026'
  ];

  // Helper to get Date object from Month selection
  const parseMonthYearString = (str) => {
    const [monthName, yearStr] = str.split(', ');
    const year = parseInt(yearStr, 10);
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const month = months.indexOf(monthName);
    return new Date(year, month, 1);
  };

  // Generate mock daily data
  const generateMockDailyData = () => {
    const startRange = new Date('2026-01-01');
    const data = [];
    const totalClicks = post.clicks || 0;
    const totalViews = Math.max(post.views || 0, totalClicks); // Click implies at least a view

    // Simulate metrics day-by-day for the entire year of 2026
    for (let i = 0; i < 365; i++) {
      const d = new Date(startRange.getTime() + i * 24 * 3600000);
      data.push({
        date: d.toISOString().split('T')[0],
        month: d.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
        views: 0,
        clicks: 0
      });
    }

    // Distribute clicks and views to matching indices so they sum up correctly without rounding to 0
    let viewsRemaining = totalViews;
    let clicksRemaining = totalClicks;

    if (clicksRemaining > 0) {
      for (let i = 0; i < clicksRemaining; i++) {
        // Distribute to days around June/July peaks (e.g. day 150 to 210)
        const dayIdx = (165 + (i * 7)) % 365;
        data[dayIdx].clicks += 1;
        data[dayIdx].views += 1;
        if (viewsRemaining > 0) viewsRemaining--;
      }
    }

    if (viewsRemaining > 0) {
      for (let i = 0; i < viewsRemaining; i++) {
        const dayIdx = (180 + (i * 3)) % 365;
        data[dayIdx].views += 1;
      }
    }

    return data;
  };

  const allMockData = generateMockDailyData();

  // Apply range filtering
  const filteredData = allMockData.filter(item => {
    const itemDate = new Date(item.date);

    if (appliedRangeType === 'Month') {
      const startLimit = parseMonthYearString(appliedFromMonth);
      const endLimit = parseMonthYearString(appliedToMonth);
      // set to end of the month for endLimit
      const endLimitEnd = new Date(endLimit.getFullYear(), endLimit.getMonth() + 1, 0, 23, 59, 59);
      return itemDate >= startLimit && itemDate <= endLimitEnd;
    } else {
      const startLimit = new Date(appliedFromDate);
      const endLimit = new Date(appliedToDate);
      endLimit.setHours(23, 59, 59);
      return itemDate >= startLimit && itemDate <= endLimit;
    }
  });

  // Calculate aggregates
  const filteredViews = filteredData.reduce((sum, item) => sum + item.views, 0);
  const filteredClicks = filteredData.reduce((sum, item) => sum + item.clicks, 0);
  const conversionRate = filteredViews ? ((filteredClicks / filteredViews) * 100).toFixed(1) : '0.0';

  // Chart Scaling & SVG
  const maxVal = Math.max(...filteredData.map(d => d.views), 1);
  const svgWidth = 700;
  const svgHeight = 220;
  const paddingX = 40;
  const paddingY = 30;

  // Generate points for spline chart path (using views as primary curve like in screenshot)
  const points = filteredData.map((d, idx) => {
    const x = filteredData.length > 1 ? (idx / (filteredData.length - 1)) * (svgWidth - paddingX * 2) + paddingX : paddingX;
    const y = svgHeight - ((d.views / maxVal) * (svgHeight - paddingY * 2) + paddingY);
    return { x, y, date: d.date, value: d.views, clicks: d.clicks };
  });

  // Spline Curved Path generator (Cubic Bezier curve algorithm)
  const getCurvePath = (pts) => {
    if (pts.length === 0) return '';
    let path = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      // Control points for smooth spline transition
      const cpX1 = p0.x + (p1.x - p0.x) / 3;
      const cpY1 = p0.y;
      const cpX2 = p0.x + 2 * (p1.x - p0.x) / 3;
      const cpY2 = p1.y;
      path += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${p1.x} ${p1.y}`;
    }
    return path;
  };

  const linePath = getCurvePath(points);
  const areaPath = points.length > 0 ? `${linePath} L ${points[points.length - 1].x} ${svgHeight - 10} L ${points[0].x} ${svgHeight - 10} Z` : '';

  // SVG Mouse Interaction handlers for hover tooltip
  const handleMouseMove = (e) => {
    if (points.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const svgX = (clientX / rect.width) * svgWidth;

    // Find nearest point
    let minDiff = Infinity;
    let nearestIdx = 0;
    points.forEach((p, idx) => {
      const diff = Math.abs(p.x - svgX);
      if (diff < minDiff) {
        minDiff = diff;
        nearestIdx = idx;
      }
    });

    setHoveredPointIdx(nearestIdx);
    // Tooltip position (above the node)
    setTooltipPos({
      x: (points[nearestIdx].x / svgWidth) * rect.width,
      y: (points[nearestIdx].y / svgHeight) * rect.height - 75
    });
  };

  const handleMouseLeave = () => {
    setHoveredPointIdx(null);
  };

  // Applied range label text to display
  const getRangeLabel = () => {
    if (appliedRangeType === 'Month') {
      return `${appliedFromMonth} - ${appliedToMonth}`;
    }
    return `${new Date(appliedFromDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ${new Date(appliedToDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  };

  const isVideo = post.image_url && (
    post.image_url.endsWith('.mp4') ||
    post.image_url.endsWith('.webm') ||
    post.image_url.endsWith('.mov') ||
    post.image_url.endsWith('.avi')
  );

  return (
    <div style={{ padding: '26px 26px 80px 26px', background: '#090a0f', height: '100%', overflowY: 'auto', boxSizing: 'border-box', color: '#fff', position: 'relative' }}>
      {/* Back Button */}
      <button
        onClick={onBack}
        style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', color: '#a1a1aa', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, marginBottom: 24, padding: 0, transition: 'color 0.2s' }}
        onMouseEnter={e => e.currentTarget.style.color = '#fff'}
        onMouseLeave={e => e.currentTarget.style.color = '#a1a1aa'}
      >
        <ArrowLeft size={16} /> Back to Dashboard
      </button>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 18, marginBottom: 26 }}>
        <div>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 24, fontWeight: 800, margin: 0 }}>GMB Post Analytics</h1>
          <p style={{ color: '#71717a', fontSize: 12.5, marginTop: 4 }}>Detailed spline chart & segment performance insights</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 28 }} className="flex-col-mobile">
        {/* Left Column: Donut Proportion & Post Preview */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Donut Chart block (Screenshot 2 style) */}
          <div style={{ background: '#11131c', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 20 }}>Metric Proportion</h3>

            {/* SVG Donut */}
            <div style={{ position: 'relative', width: 120, height: 120, marginBottom: 18 }}>
              {(() => {
                const total = filteredViews + filteredClicks;
                const showChart = total > 0;

                if (!showChart) {
                  return (
                    <svg width="120" height="120" viewBox="0 0 120 120">
                      <circle cx="60" cy="60" r="45" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="9" />
                      <text x="60" y="65" textAnchor="middle" fill="#71717a" style={{ fontSize: 11, fontWeight: 700 }}>No Data</text>
                    </svg>
                  );
                }

                const viewsRatio = filteredViews / total;
                const clicksRatio = filteredClicks / total;
                const conversionPercent = filteredViews ? (filteredClicks / filteredViews) * 100 : 0;

                const orangeOffset = 282.7 - (viewsRatio * 282.7);
                const blueOffset = 282.7 - (clicksRatio * 282.7);
                const blueRotation = (viewsRatio * 360) - 90;

                return (
                  <>
                    <svg width="120" height="120" viewBox="0 0 120 120" style={{ transform: 'rotate(-90deg)' }}>
                      <circle cx="60" cy="60" r="45" fill="none" stroke="#f97316" strokeWidth="9" strokeDasharray="282.7" strokeDashoffset={orangeOffset} strokeLinecap="round" />
                      <circle cx="60" cy="60" r="45" fill="none" stroke="#3b82f6" strokeWidth="9" strokeDasharray="282.7" strokeDashoffset={blueOffset} strokeLinecap="round" style={{ transform: `rotate(${blueRotation}deg)`, transformOrigin: '60px 60px' }} />
                    </svg>
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>{conversionPercent.toFixed(0)}%</span>
                      <span style={{ fontSize: 8, color: '#71717a', fontWeight: 700, textTransform: 'uppercase' }}>Conv</span>
                    </div>
                  </>
                );
              })()}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, width: '100%' }}>
              <div style={{ fontSize: 12, color: '#a1a1aa', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                <span style={{ width: 8, height: 8, background: '#f97316', borderRadius: '50%' }} /> Views (Orange)
              </div>
              <div style={{ fontSize: 12, color: '#a1a1aa', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                <span style={{ width: 8, height: 8, background: '#3b82f6', borderRadius: '50%' }} /> Clicks (Blue)
              </div>
            </div>
          </div>

          {/* Post Card Preview */}
          <div style={{ background: '#11131c', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 16, padding: 20 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 }}>Post Preview</h3>
            <div style={{ background: '#090a0f', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              {post.image_url ? (
                isVideo ? (
                  <video src={post.image_url} style={{ width: '100%', height: 'auto', maxHeight: 240, objectFit: 'contain', background: '#000' }} controls muted />
                ) : (
                  <img src={post.image_url} alt="Post visual" style={{ width: '100%', height: 'auto', maxHeight: 240, objectFit: 'contain', background: '#000' }} />
                )
              ) : (
                <div style={{ width: '100%', height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.01)' }}><Megaphone size={28} color="#3f3f46" /></div>
              )}
              <div style={{ padding: 14 }}>
                <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', background: 'rgba(249,115,22,0.1)', color: '#f97316', padding: '2px 5px', borderRadius: 4, display: 'inline-block', marginBottom: 6 }}>{post.post_type}</span>
                <p style={{ fontSize: 12, color: '#a1a1aa', margin: 0, lineHeight: 1.5 }}>{post.caption}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Custom Spline Chart & Range Picker Popover */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Metrics summary row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <div style={{ background: '#11131c', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 12, padding: 18 }}>
              <span style={{ fontSize: 12, color: '#71717a', textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: 4 }}>Filter Views</span>
              <span style={{ fontSize: 28, fontWeight: 800, color: '#fff' }}>{filteredViews}</span>
            </div>

            <div style={{ background: '#11131c', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 12, padding: 18 }}>
              <span style={{ fontSize: 12, color: '#71717a', textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: 4 }}>Filter Clicks</span>
              <span style={{ fontSize: 28, fontWeight: 800, color: '#fff' }}>{filteredClicks}</span>
            </div>

            <div style={{ background: 'rgba(249,115,22,0.02)', border: '1px solid rgba(249,115,22,0.1)', borderRadius: 12, padding: 18 }}>
              <span style={{ fontSize: 12, color: '#f97316', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: 4 }}>Conversion Rate</span>
              <span style={{ fontSize: 28, fontWeight: 800, color: '#f97316' }}>{conversionRate}%</span>
            </div>
          </div>

          {/* Graphical Spline Chart Area (Screenshot 1 & 3 combined style) */}
          <div style={{ background: '#11131c', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 16, padding: 22, position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}><TrendingUp size={15} color="#f97316" /> Performance Trend</h3>

              {/* Range Picker Trigger Button (Screenshot 3 trigger style) */}
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowRangePopover(!showRangePopover)}
                  style={{ background: '#1e2130', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 14px', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <Calendar size={14} color="#f97316" /> {getRangeLabel()}
                </button>

                {/* Range Picker Popover (Screenshot 3 style) */}
                {showRangePopover && (
                  <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 100, background: '#161924', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: 18, width: 320, boxShadow: '0 8px 30px rgba(0,0,0,0.5)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5 }}>Custom Range</span>

                      {/* Pill toggle (Month / Date) */}
                      <div style={{ display: 'flex', background: '#0e1017', borderRadius: 6, padding: 2 }}>
                        <button
                          onClick={() => setTempRangeType('Month')}
                          style={{ border: 'none', background: tempRangeType === 'Month' ? '#f97316' : 'transparent', color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 4, cursor: 'pointer', transition: 'all 0.2s' }}
                        >
                          Month
                        </button>
                        <button
                          onClick={() => setTempRangeType('Date')}
                          style={{ border: 'none', background: tempRangeType === 'Date' ? '#f97316' : 'transparent', color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 4, cursor: 'pointer', transition: 'all 0.2s' }}
                        >
                          Date
                        </button>
                      </div>
                    </div>

                    {/* From & To inputs based on Month / Date toggle */}
                    {tempRangeType === 'Month' ? (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
                        <div>
                          <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 6 }}>From</label>
                          <select
                            value={fromMonth}
                            onChange={e => setFromMonth(e.target.value)}
                            style={{ width: '100%', background: '#0e1017', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '8px 10px', color: '#fff', fontSize: 12, outline: 'none' }}
                          >
                            {monthsList.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 6 }}>To</label>
                          <select
                            value={toMonth}
                            onChange={e => setToMonth(e.target.value)}
                            style={{ width: '100%', background: '#0e1017', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '8px 10px', color: '#fff', fontSize: 12, outline: 'none' }}
                          >
                            {monthsList.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
                        <div>
                          <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 6 }}>From</label>
                          <input
                            type="date"
                            value={fromDate}
                            onChange={e => setFromDate(e.target.value)}
                            style={{ width: '100%', boxSizing: 'border-box', background: '#0e1017', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '7px 8px', color: '#fff', fontSize: 12, outline: 'none' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 6 }}>To</label>
                          <input
                            type="date"
                            value={toDate}
                            onChange={e => setToDate(e.target.value)}
                            style={{ width: '100%', boxSizing: 'border-box', background: '#0e1017', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '7px 8px', color: '#fff', fontSize: 12, outline: 'none' }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Popover Footer Buttons */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 14 }}>
                      <button
                        onClick={() => {
                          setTempRangeType(appliedRangeType);
                          setFromMonth(appliedFromMonth);
                          setToMonth(appliedToMonth);
                          setFromDate(appliedFromDate);
                          setToDate(appliedToDate);
                          setShowRangePopover(false);
                        }}
                        style={{ background: '#202330', border: 'none', borderRadius: 6, padding: '8px 14px', color: '#a1a1aa', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          setAppliedRangeType(tempRangeType);
                          setAppliedFromMonth(fromMonth);
                          setAppliedToMonth(toMonth);
                          setAppliedFromDate(fromDate);
                          setAppliedToDate(toDate);
                          setShowRangePopover(false);
                        }}
                        style={{ background: '#f97316', border: 'none', borderRadius: 6, padding: '8px 14px', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                      >
                        Apply Range
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Spline Chart SVG */}
            {filteredViews === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: svgHeight, color: '#71717a', fontSize: 13, background: 'rgba(255,255,255,0.01)', borderRadius: 8, padding: 20 }}>
                <TrendingUp size={24} style={{ marginBottom: 8, color: '#3f3f46' }} />
                <span>No live traffic views/clicks detected on Google Business Profile yet for this post.</span>
              </div>
            ) : (
              <div style={{ position: 'relative' }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
                <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ width: '100%', height: 'auto', overflow: 'visible', cursor: 'crosshair' }}>
                  {/* Grid Lines */}
                  <line x1={paddingX} y1={paddingY} x2={svgWidth - paddingX} y2={paddingY} stroke="rgba(255,255,255,0.03)" strokeDasharray="3,3" />
                  <line x1={paddingX} y1={(svgHeight - paddingY * 2) / 2 + paddingY} x2={svgWidth - paddingX} y2={(svgHeight - paddingY * 2) / 2 + paddingY} stroke="rgba(255,255,255,0.03)" strokeDasharray="3,3" />
                  <line x1={paddingX} y1={svgHeight - paddingY} x2={svgWidth - paddingX} y2={svgHeight - paddingY} stroke="rgba(255,255,255,0.08)" />

                  {/* Area Under Spline Curve (Gradients) */}
                  {points.length > 0 && (
                    <>
                      <path d={areaPath} fill="url(#smoothGrad)" opacity="0.12" />
                      <path d={linePath} fill="none" stroke="#f97316" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    </>
                  )}

                  {/* Hover Node highlight circle */}
                  {hoveredPointIdx !== null && points[hoveredPointIdx] && (
                    <g>
                      {/* Vertical guidance indicator line */}
                      <line x1={points[hoveredPointIdx].x} y1={paddingY} x2={points[hoveredPointIdx].x} y2={svgHeight - paddingY} stroke="rgba(249,115,22,0.15)" strokeWidth="1" strokeDasharray="3,3" />
                      {/* Node circle wrapper */}
                      <circle cx={points[hoveredPointIdx].x} cy={points[hoveredPointIdx].y} r="7" fill="#f97316" opacity="0.3" />
                      <circle cx={points[hoveredPointIdx].x} cy={points[hoveredPointIdx].y} r="4.5" fill="#f97316" stroke="#fff" strokeWidth="1.5" />
                    </g>
                  )}

                  {/* Gradient Definitions */}
                  <defs>
                    <linearGradient id="smoothGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f97316" />
                      <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                </svg>

                {/* Floating Tooltip Card (Screenshot 1 style) */}
                {hoveredPointIdx !== null && points[hoveredPointIdx] && (
                  <div style={{
                    position: 'absolute',
                    left: `${tooltipPos.x}px`,
                    top: `${tooltipPos.y}px`,
                    transform: 'translateX(-50%)',
                    background: '#161924',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    padding: '8px 12px',
                    pointerEvents: 'none',
                    zIndex: 10,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                    textAlign: 'center',
                    minWidth: 90
                  }}>
                    <div style={{ fontSize: 9.5, color: '#71717a', fontWeight: 700, marginBottom: 4 }}>
                      {new Date(points[hoveredPointIdx].date).toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })}
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: 800, color: '#fff' }}>
                      {points[hoveredPointIdx].value} <span style={{ fontSize: 10, color: '#a1a1aa', fontWeight: 600 }}>Views</span>
                    </div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: '#3b82f6', marginTop: 2 }}>
                      {points[hoveredPointIdx].clicks} <span style={{ fontSize: 9, color: '#71717a' }}>Clicks</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Daily Table Breakdown */}
          <div style={{ background: '#11131c', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 16, padding: 22 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 6 }}><TrendingUp size={15} color="#22c55e" /> Daily Performance Breakdown</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 220, overflowY: 'auto', paddingRight: 6 }}>
              {(() => {
                const activeBreakdown = filteredData.filter(item => item.views > 0 || item.clicks > 0);
                if (activeBreakdown.length === 0) {
                  return <div style={{ textAlign: 'center', padding: '40px 0', color: '#71717a', fontSize: 13.5 }}>No views/clicks recorded yet for the selected date range.</div>;
                }
                return activeBreakdown.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#f4f4f5' }}>{new Date(item.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</span>

                    <div style={{ flex: 1, margin: '0 24px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 9, color: '#71717a', width: 30 }}>Views</span>
                        <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(100, (item.views / maxVal) * 100)}%`, height: '100%', background: '#fff', borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: '#fff', width: 25, textAlign: 'right' }}>{item.views}</span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 9, color: '#71717a', width: 30 }}>Clicks</span>
                        <div style={{ flex: 1, height: 5, background: 'rgba(249,115,22,0.1)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(100, (item.clicks / maxVal) * 100)}%`, height: '100%', background: '#f97316', borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: '#f97316', width: 25, textAlign: 'right' }}>{item.clicks}</span>
                      </div>
                    </div>

                    <span style={{ fontSize: 11, fontWeight: 700, color: '#71717a' }}>{item.month}</span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function StreetPosts() {
  const [clients, setClients] = useState([]);
  const [activeClient, setActiveClientState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);

  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [editingPost, setEditingPost] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [importing, setImporting] = useState(false);
  const [selectedAnalyticsPost, setSelectedAnalyticsPost] = useState(null);

  // Main page GMB connection states
  const [dashLocations, setDashLocations] = useState([]);
  const [dashFetchingLocs, setDashFetchingLocs] = useState(false);
  const [dashSelectedLocStr, setDashSelectedLocStr] = useState('');
  const [dashSavingLoc, setDashSavingLoc] = useState(false);

  const location = useLocation();

  useEffect(() => {
    if (location.state && (location.state.caption || location.state.title)) {
      setEditingPost({
        caption: location.state.caption,
        post_title: location.state.title,
        post_type: 'Update',
        action_button: location.state.actionButton
      });
      
      setShowModal(true);
    }
  }, [location.state]);

  const fetchDashLocations = async (clientId) => {
    if (!clientId) return;
    setDashFetchingLocs(true);
    try {
      const token = localStorage.getItem('leados_token');
      const res = await axios.get(`${API_URL}/api/mafiya/reviews/google-locations?clientId=${clientId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = res.data;
      setDashLocations(data);
      if (data.length > 0) {
        setDashSelectedLocStr(data[0].accountId + '|' + data[0].locationId);
      }
    } catch (e) {
      console.error('[GMB Locations fetch error]:', e);
    } finally {
      setDashFetchingLocs(false);
    }
  };

  const handleDashSaveConnection = async () => {
    if (!dashSelectedLocStr || !activeClient) return;
    const [accId, locId] = dashSelectedLocStr.split('|');
    setDashSavingLoc(true);
    try {
      const token = localStorage.getItem('leados_token');
      await axios.put(`${API_URL}/api/mafiya/reviews/google-locations`, {
        clientId: activeClient.id,
        google_account_id: accId,
        google_location_id: locId
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success('Connected to GMB Location!');

      // Update active client state properties
      const updated = { ...activeClient, google_account_id: accId, google_location_id: locId };
      setActiveClientState(updated);
      localStorage.setItem('activeGmbClient', JSON.stringify(updated));
      setClients(prev => prev.map(c => c.id === activeClient.id ? updated : c));

      // Fetch posts
      fetchGmbPosts(activeClient.id);
    } catch(err) {
      toast.error('Failed to connect location');
    } finally {
      setDashSavingLoc(false);
    }
  };

  useEffect(() => {
    if (activeClient && !activeClient.google_location_id) {
      fetchDashLocations(activeClient.id);
    }
  }, [activeClient]);

  const setActiveClient = (client) => {
    setActiveClientState(client);
    setCurrentPage(1);
    if (client) {
      localStorage.setItem('activeGmbClient', JSON.stringify(client));
    } else {
      localStorage.removeItem('activeGmbClient');
    }
  };

  // Fetch Clients
  const fetchClients = async () => {
    try {
      const token = localStorage.getItem('leados_token');
      const { data: clientsData } = await axios.get(`${API_URL}/api/mafiya/clients`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setClients(clientsData);
      if (clientsData.length > 0) {
        const savedGmbClient = localStorage.getItem('activeGmbClient');
        if (savedGmbClient) {
          try {
            const parsed = JSON.parse(savedGmbClient);
            const found = clientsData.find(c => c.id === parsed.id);
            if (found) {
              setActiveClient(found);
              setLoading(false);
              return;
            }
          } catch (e) {}
        }
        setActiveClient(clientsData[0]);
      }
    } catch (err) {
      toast.error('Failed to load GMB clients');
    } finally {
      setLoading(false);
    }
  };

  // Fetch GMB Posts
  const fetchGmbPosts = async (clientId) => {
    if (!clientId) return;
    setPostsLoading(true);
    try {
      const token = localStorage.getItem('leados_token');
      const res = await fetch(`${API_URL}/api/mafiya/reviews/posts?clientId=${clientId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPosts(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setPostsLoading(false);
    }
  };

  const handleImportGmbPosts = async () => {
    if (!activeClient) return;
    setImporting(true);
    const importToast = toast.loading('Importing posts from Google...');
    try {
      const token = localStorage.getItem('leados_token');
      const res = await axios.post(`${API_URL}/api/mafiya/reviews/posts/import`,
        { clientId: activeClient.id },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      toast.success(res.data.message || 'Import completed!', { id: importToast });
      fetchGmbPosts(activeClient.id);
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.error || 'Failed to import GMB posts', { id: importToast });
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  useEffect(() => {
    if (activeClient) {
      fetchGmbPosts(activeClient.id);

      // Sync metrics in background
      const token = localStorage.getItem('leados_token');
      axios.get(`${API_URL}/api/mafiya/reviews/posts/sync-metrics?clientId=${activeClient.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      .then(() => {
        // Silently refresh post list to display the updated metrics
        fetch(`${API_URL}/api/mafiya/reviews/posts?clientId=${activeClient.id}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        .then(res => {
          if (res.ok) return res.json();
        })
        .then(data => {
          if (data) setPosts(data);
        });
      })
      .catch(err => console.warn('[Metrics Sync Warning]:', err.message));
    }
  }, [activeClient]);

  // Polling to auto-refresh scheduled posts status without manual page reload
  useEffect(() => {
    if (!activeClient) return;

    const hasScheduled = posts.some(p => p.status === 'scheduled');
    if (!hasScheduled) return;

    // Check every 10 seconds silently (no loading spinner flicker)
    const interval = setInterval(() => {
      const token = localStorage.getItem('leados_token');
      fetch(`${API_URL}/api/mafiya/reviews/posts?clientId=${activeClient.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      .then(res => {
        if (res.ok) return res.json();
      })
      .then(data => {
        if (data) setPosts(data);
      })
      .catch(err => console.error('[Polling Error]:', err));
    }, 10000);

    return () => clearInterval(interval);
  }, [posts, activeClient]);

  // Delete Post
  const handleDeletePost = async (id) => {
    if (!confirm('Are you sure you want to delete this GMB post record?')) return;
    try {
      const token = localStorage.getItem('leados_token');
      await axios.delete(`${API_URL}/api/mafiya/reviews/posts/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
        toast.success('Post deleted');
        fetchGmbPosts(activeClient.id);
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.text }}>
        <div style={{ textAlign: 'center' }}>
          <Megaphone size={42} className="animate-pulse" style={{ color: C.accent, marginBottom: 12 }} />
          <p style={{ fontSize: 14 }}>Loading Street Posts dashboard...</p>
        </div>
      </div>
    );
  }

  const clientName = activeClient?.display_name || activeClient?.business_name || 'GMB Profile';
  const contactPhone = activeClient?.phone_number || '';



  if (selectedAnalyticsPost) {
    const activePost = posts.find(p => p.id === selectedAnalyticsPost.id) || selectedAnalyticsPost;
    return (
      <PostAnalyticsView
        post={activePost}
        onBack={() => setSelectedAnalyticsPost(null)}
        activeClient={activeClient}
      />
    );
  }

  return (
    <div className="p-mobile" style={{ padding: 26, overflowY: 'auto', height: '100%', background: C.bg, position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 400, background: 'radial-gradient(circle at 50% -20%, rgba(249,115,22,0.05) 0%, transparent 70%)', pointerEvents: 'none', zIndex: 0 }} />

      <div style={{ position: 'relative', zIndex: 1 }}>

        {/* Header toolbar */}
        <div className="flex-col-mobile" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 26 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: 24, fontWeight: 800, color: '#fff', margin: 0 }}>
                Street Posts <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(249,115,22,0.12)', color: C.accent, padding: '3px 8px', borderRadius: 20, marginLeft: 8 }}>GMB Posts</span>
              </h1>
            </div>
            <p style={{ color: C.muted, fontSize: 12.5, marginTop: 5 }}>
              8 posts/month · {posts.length} generated · {Math.max(0, 8 - posts.length)} remaining — Growth Plan · {clientName}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12, width: '100%', maxWidth: 500, justifyContent: 'flex-end', alignItems: 'center' }} className="flex-col-mobile">
            <select
              value={activeClient ? activeClient.id : ''}
              onChange={(e) => {
                const c = clients.find(cl => cl.id === parseInt(e.target.value));
                if (c) setActiveClient(c);
              }}
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                color: C.text,
                padding: '10px 14px',
                fontSize: 13,
                outline: 'none',
                cursor: 'pointer',
                flex: 1,
                maxWidth: '320px',
                width: '100%',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                overflow: 'hidden'
              }}
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.display_name || c.business_name}</option>
              ))}
            </select>
            <button
              onClick={handleImportGmbPosts}
              disabled={importing}
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                padding: '10px 18px',
                color: C.text,
                fontSize: 13,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: importing ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
                opacity: importing ? 0.7 : 1,
                transition: 'all 0.2s'
              }}
              onMouseEnter={e => { if (!importing) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
            >
              {importing ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Sync GMB Posts
            </button>
            <button
              onClick={() => {
                setEditingPost(null);
                setShowModal(true);
              }}
              style={{
                background: 'linear-gradient(135deg,#f97316,#ea580c)',
                border: 'none',
                borderRadius: 10,
                padding: '10px 18px',
                color: '#fff',
                fontSize: 13,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(249,115,22,0.25)',
                whiteSpace: 'nowrap'
              }}
            >
              <Plus size={15} /> Upload Poster
            </button>
          </div>
        </div>

        {!activeClient?.google_location_id ? (
          <div style={{ background: '#11131c', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 16, padding: '40px 24px', textAlign: 'center', marginTop: 20, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ background: 'rgba(249,115,22,0.1)', padding: 20, borderRadius: '50%', marginBottom: 20, border: '1px solid rgba(249,115,22,0.2)' }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
            </div>
            <h3 style={{ color: '#f4f4f5', fontSize: 20, fontWeight: 700, margin: '0 0 12px 0' }}>Connect Google Business Location</h3>
            <p style={{ color: '#a1a1aa', fontSize: 14, maxWidth: 440, marginBottom: 28, lineHeight: 1.6 }}>
              To publish posts directly to Google, please connect the specific business location for <strong style={{ color: '#fff' }}>{clientName}</strong>.
            </p>

            {dashFetchingLocs ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#f97316' }}>
                <Loader2 size={18} className="spin" />
                <span>Fetching verified locations...</span>
              </div>
            ) : dashLocations.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 380 }}>
                <select
                  value={dashSelectedLocStr}
                  onChange={e => setDashSelectedLocStr(e.target.value)}
                  style={{ background: '#27272a', border: '1px solid rgba(255,255,255,0.1)', color: '#f4f4f5', padding: '14px 18px', borderRadius: 8, fontSize: 14, outline: 'none', cursor: 'pointer' }}
                >
                  {dashLocations.map((loc, i) => (
                    <option key={i} value={loc.accountId + '|' + loc.locationId}>{loc.title}</option>
                  ))}
                </select>
                <button
                  onClick={handleDashSaveConnection}
                  disabled={dashSavingLoc}
                  style={{ background: 'linear-gradient(135deg, #f97316, #ea580c)', color: '#fff', border: 'none', padding: '14px', borderRadius: 8, fontWeight: 700, cursor: dashSavingLoc ? 'not-allowed' : 'pointer', boxShadow: '0 4px 14px rgba(249,115,22,0.3)', transition: 'all 0.2s' }}
                >
                  {dashSavingLoc ? 'Connecting...' : 'Connect Location'}
                </button>
              </div>
            ) : (
              <div style={{ background: 'rgba(239,68,68,0.06)', padding: 20, borderRadius: 12, border: '1px solid rgba(239,68,68,0.2)', width: '100%', maxWidth: 460 }}>
                <p style={{ color: '#ef4444', margin: 0, fontSize: 13.5, lineHeight: 1.6 }}>
                  We couldn't find any locations in your Google Account. Please ensure you have connected an account that manages Google Business Profiles in the Local SEO Bridge.
                </p>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Dashboard Overview Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 28 }}>
              <div style={{ background: '#18181b', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: 12, padding: 18 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>Published Posts</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 26, fontWeight: 800, color: '#fff' }}>{posts.filter(p => p.status === 'published').length}</span>
                  <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>Live</span>
                </div>
              </div>

              <div style={{ background: '#18181b', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: 12, padding: 18 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>Total Views</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 26, fontWeight: 800, color: '#fff' }}>{posts.reduce((sum, p) => sum + (p.views || 0), 0)}</span>
                  <span style={{ fontSize: 11, color: '#a1a1aa' }}>👁️ Impressions</span>
                </div>
              </div>

              <div style={{ background: '#18181b', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: 12, padding: 18 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>Total Clicks</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 26, fontWeight: 800, color: '#fff' }}>{posts.reduce((sum, p) => sum + (p.clicks || 0), 0)}</span>
                  <span style={{ fontSize: 11, color: '#a1a1aa' }}>🖱️ Actions</span>
                </div>
              </div>

              <div style={{ background: '#18181b', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: 12, padding: 18 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>Scheduled</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 26, fontWeight: 800, color: '#fff' }}>{posts.filter(p => p.status === 'scheduled').length}</span>
                  <span style={{ fontSize: 11, color: '#f97316', fontWeight: 600 }}>Queue</span>
                </div>
              </div>
            </div>

            {/* Existing GMB posts horizontal list */}
            {postsLoading ? (
              <div style={{ padding: 60, textAlign: 'center', color: C.muted }}>
                <Loader2 size={24} className="spin" style={{ color: C.accent, margin: '0 auto 10px auto' }} />
                Loading post history...
              </div>
            ) : posts.length === 0 ? (
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '60px 20px', textAlign: 'center', color: C.muted }}>
                <Megaphone size={40} style={{ color: C.border, marginBottom: 14 }} />
                <h3 style={{ color: '#fff', fontSize: 15, margin: '0 0 4px 0' }}>No GMB Posts Yet</h3>
                <p style={{ fontSize: 12.5, margin: 0 }}>Click "Upload Poster" above to create your first GMB Post.</p>
              </div>
            ) : (
              <div style={{ marginTop: 30 }}>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: '#fff', margin: '0 0 4px 0', fontFamily: "'Syne', sans-serif" }}>All posts</h2>
                <p style={{ color: C.muted, fontSize: 12.5, margin: '0 0 20px 0' }}>View or make changes</p>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {(() => {
                    const postsPerPage = 5;
                    const indexOfLastPost = currentPage * postsPerPage;
                    const indexOfFirstPost = indexOfLastPost - postsPerPage;
                    const currentPosts = posts.slice(indexOfFirstPost, indexOfLastPost);
                    const totalPages = Math.ceil(posts.length / postsPerPage);

                    return (
                      <>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          {currentPosts.map((post, idx) => {
                            const isVideo = post.image_url && (
                              post.image_url.endsWith('.mp4') ||
                              post.image_url.endsWith('.webm') ||
                              post.image_url.endsWith('.mov') ||
                              post.image_url.endsWith('.avi')
                            );

                            const hasCta = post.poster_subtitle && post.poster_subtitle.includes('|');
                            const ctaText = hasCta ? post.poster_subtitle.split('|')[0] : '';
                            const posterNumber = post.id;

                            return (
                              <div
                                key={post.id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  padding: '16px 0',
                                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                                  gap: 20,
                                  position: 'relative'
                                }}
                              >
                                {/* Left Side: Mock Google Post card (Media preview + details inside card) */}
                                <div
                                  onClick={() => {
                                      setEditingPost(post);
                                      setShowModal(true);
                                  }}
                                  style={{
                                    display: 'flex',
                                    gap: 16,
                                    alignItems: 'center',
                                    background: '#121214',
                                    border: '1px solid rgba(255, 255, 255, 0.08)',
                                    borderRadius: 10,
                                    padding: 12,
                                    width: '60%',
                                    minWidth: 320,
                                    cursor: 'pointer',
                                    transition: 'border-color 0.2s'
                                  }}
                                  onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(249,115,22,0.3)'}
                                  onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
                                >
                                  {/* Media Container */}
                                  <div style={{
                                    width: 90,
                                    height: 75,
                                    borderRadius: 6,
                                    overflow: 'hidden',
                                    position: 'relative',
                                    background: 'rgba(255,255,255,0.02)',
                                    flexShrink: 0,
                                    border: '1px solid rgba(255,255,255,0.06)'
                                  }}>
                                    {post.image_url ? (
                                      isVideo ? (
                                        <>
                                          <video src={post.image_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted />
                                          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)' }}>
                                            <Play size={14} color="#fff" fill="#fff" />
                                          </div>
                                        </>
                                      ) : (
                                        <img src={post.image_url} alt="Post Visual" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                      )
                                    ) : (
                                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.04)' }}>
                                        <Megaphone size={18} color="#71717a" />
                                      </div>
                                    )}
                                  </div>

                                  {/* Text / Details Container */}
                                  <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                      <span style={{ fontSize: 10, fontWeight: 800, color: '#f97316', background: 'rgba(249,115,22,0.1)', padding: '2.5px 7px', borderRadius: 4 }}>
                                        Poster #{posterNumber}
                                      </span>
                                      {post.post_type && (
                                        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', background: 'rgba(255,255,255,0.05)', color: '#a1a1aa', padding: '2.5px 7px', borderRadius: 4 }}>
                                          {post.post_type}
                                        </span>
                                      )}
                                    </div>
                                    <p style={{
                                      fontSize: 13,
                                      fontWeight: 600,
                                      color: '#e4e4e7',
                                      margin: '0 0 6px 0',
                                      lineHeight: 1.4,
                                      display: '-webkit-box',
                                      WebkitLineClamp: 2,
                                      WebkitBoxOrient: 'vertical',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis'
                                    }}>
                                      {post.caption}
                                    </p>

                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#a1a1aa', fontSize: 11.5 }}>
                                      <Link size={11} color="#a1a1aa" /> <span>{ctaText || 'Call now'}</span>
                                    </div>
                                  </div>
                                </div>

                                {/* Middle Side: Relative time info on the clean row background */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start', flex: 1 }}>
                                  <span style={{ fontSize: 13.5, color: '#f4f4f5', fontWeight: 500 }}>
                                    {post.status === 'published' ? formatTimeAgo(post.created_at) : 'Draft'}
                                  </span>
                                  {post.status === 'published' && (
                                    <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#71717a', alignItems: 'center' }}>
                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Eye size={12} /> {post.views || 0} views</span>
                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MousePointer size={12} /> {post.clicks || 0} clicks</span>
                                    </div>
                                  )}
                                </div>

                                {/* Right Side: Options / Action Menu */}
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                  {post.status === 'published' && (
                                    <button
                                      onClick={() => setSelectedAnalyticsPost(post)}
                                      style={{ background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.15)', borderRadius: 8, padding: '7px 12px', color: '#f97316', display: 'flex', cursor: 'pointer', transition: 'all 0.2s', gap: 5, alignItems: 'center', fontSize: 11.5, fontWeight: 700 }}
                                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(249,115,22,0.15)'; e.currentTarget.style.color = '#fff'; }}
                                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(249,115,22,0.08)'; e.currentTarget.style.color = '#f97316'; }}
                                    >
                                      <BarChart2 size={13} /> Analysis
                                    </button>
                                  )}
                                    <button
                                      onClick={() => {
                                        setEditingPost(post);
                                        setShowModal(true);
                                      }}
                                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: 8, color: '#a1a1aa', display: 'flex', cursor: 'pointer', transition: 'all 0.2s' }}
                                      onMouseEnter={e => e.currentTarget.style.color = '#fff'}
                                      onMouseLeave={e => e.currentTarget.style.color = '#a1a1aa'}
                                      title="Edit Post"
                                    >
                                      <Plus size={14} style={{ transform: 'rotate(45deg)' }} />
                                    </button>
                                    <button
                                      onClick={() => handleDeletePost(post.id)}
                                      style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 8, padding: 8, color: '#ef4444', display: 'flex', cursor: 'pointer', transition: 'all 0.2s' }}
                                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.15)'; e.currentTarget.style.color = '#fff'; }}
                                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; e.currentTarget.style.color = '#ef4444'; }}
                                      title="Delete Post"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Pagination Controls */}
                        {totalPages > 1 && (
                          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 24, paddingBottom: 20 }}>
                            <button
                              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                              disabled={currentPage === 1}
                              style={{
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid rgba(255,255,255,0.08)',
                                borderRadius: 8,
                                padding: '8px 14px',
                                color: currentPage === 1 ? '#4b5563' : '#fff',
                                cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                                fontSize: 12.5,
                                fontWeight: 600,
                                transition: 'all 0.2s'
                              }}
                            >
                              Previous
                            </button>

                            {Array.from({ length: totalPages }).map((_, idx) => (
                              <button
                                key={idx}
                                onClick={() => setCurrentPage(idx + 1)}
                                style={{
                                  background: currentPage === idx + 1 ? '#f97316' : 'rgba(255,255,255,0.03)',
                                  border: currentPage === idx + 1 ? 'none' : '1px solid rgba(255,255,255,0.08)',
                                  borderRadius: 8,
                                  width: 32,
                                  height: 32,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: '#fff',
                                  cursor: 'pointer',
                                  fontSize: 12.5,
                                  fontWeight: 700,
                                  transition: 'all 0.2s'
                                }}
                              >
                                {idx + 1}
                              </button>
                            ))}

                            <button
                              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                              disabled={currentPage === totalPages}
                              style={{
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid rgba(255,255,255,0.08)',
                                borderRadius: 8,
                                padding: '8px 14px',
                                color: currentPage === totalPages ? '#4b5563' : '#fff',
                                cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                                fontSize: 12.5,
                                fontWeight: 600,
                                transition: 'all 0.2s'
                              }}
                            >
                              Next
                            </button>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
          </>
        )}

        {/* ═══ GMB Upload Post Modal ═══ */}
        <GmbPostModal
          activeClient={activeClient}
          fetchGmbPosts={fetchGmbPosts}
          showModal={showModal}
          setShowModal={setShowModal}
          editingPost={editingPost}
          setEditingPost={setEditingPost}
        />

      </div>
    </div>
  );
}
