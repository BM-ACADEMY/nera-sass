import { useState, useEffect, useRef } from 'react';
import { api } from '../src/services/api.js';

function normPlatform(p) {
  return (p || '').toLowerCase().replace(/_(post|reel|short|story|video)$/, '');
}

function getPostEntry(platform, platformPostIds) {
  if (!Array.isArray(platformPostIds) || !platform) return null;
  const norm = normPlatform(platform);
  return platformPostIds.find(e => e && normPlatform(e.platform) === norm) || null;
}

function buildPostUrl(platform, entry) {
  if (!entry) return null;
  if (entry.url) return entry.url;
  const id = entry.post_id;
  if (!id) return null;
  const p = (platform || '').toLowerCase();
  if (p.includes('youtube')) return `https://www.youtube.com/watch?v=${id}`;
  if (p.includes('linkedin')) return `https://www.linkedin.com/feed/update/${id}/`;
  if (p.includes('facebook')) {
    if (id.includes('_')) {
      const [pageId, pid] = id.split('_');
      return `https://www.facebook.com/permalink.php?story_fbid=${pid}&id=${pageId}`;
    }
    return `https://www.facebook.com/watch?v=${id}`;
  }
  if (p.includes('instagram')) return null;
  return null;
}

export function ApprovalRoom({
  items,
  selectedBrand,
  analytics,
  selectedItem,
  setSelectedItem,
  canApprove,
  isPublishing,
  handleApprove,
  handleReject,
  handlePublishNow,
  handleScheduleItem,
  editMode,
  setEditMode,
  editValues,
  setEditValues,
  handleSaveEdit,
  togglePlatform,
  toggleAccount,
  socialAccounts,
  isSameBrand,
  getBrandConfig,
  getPlatformConfig,
  formatTime,
  extractDriveFileId,
  handleOpenAiSuggestions,
  handleGenerateFirstTime,
  loadingSuggestions,
  suggestionsError,
  confirmAction,
  setConfirmAction,
  rejectionReason,
  setRejectionReason
}) {
  const [seg, setSeg] = useState('pending'); // pending | published (live)
  const [firstGenContext, setFirstGenContext] = useState("");
  const [firstGenTone, setFirstGenTone] = useState("engaging");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteResults, setDeleteResults] = useState(null);
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);
  const [thumbUploadError, setThumbUploadError] = useState('');
  const thumbFileRef = useRef(null);

  const handleDeleteFromPlatforms = async () => {
    if (!selectedItem) return;
    setIsDeleting(true);
    try {
      const res = await api.deletePostFromPlatforms(selectedItem.id);
      setDeleteResults(res.results || []);
      setDeleteConfirm(false);
    } catch (err) {
      setDeleteResults([{ channel: 'error', status: 'failed', reason: err.message }]);
      setDeleteConfirm(false);
    } finally {
      setIsDeleting(false);
    }
  };

  // Sync edits if item changes
  useEffect(() => {
    if (selectedItem) {
      setEditValues({
        caption: selectedItem.caption || '',
        instagram_caption: selectedItem.instagram_caption || selectedItem.caption || '',
        facebook_caption: selectedItem.facebook_caption || selectedItem.caption || '',
        x_caption: selectedItem.x_caption || '',
        linkedin_caption: selectedItem.linkedin_caption || '',
        youtube_title: selectedItem.youtube_title || selectedItem.thumbnail_title || '',
        youtube_description: selectedItem.youtube_description || selectedItem.description || selectedItem.caption || '',
        thumbnail_title: selectedItem.thumbnail_title || '',
        scheduled_at: selectedItem.scheduled_at || '',
        platforms: [...(selectedItem.platforms || [])],
        selected_accounts: selectedItem.selected_accounts || {},
        hashtags: selectedItem.hashtags || '',
        thumbnail_url: selectedItem.thumbnail_url || ''
      });
    }
  }, [selectedItem, setEditValues]);

  const handleThumbnailUpload = async (file) => {
    if (!file || !selectedItem) return;
    setThumbUploadError('');
    setUploadingThumbnail(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
      const res = await api.uploadPosterOverlay(selectedItem.id, dataUrl);
      const permanentUrl = res.poster_url || dataUrl;
      setEditValues(prev => ({ ...prev, thumbnail_url: permanentUrl }));
    } catch (err) {
      setThumbUploadError(err.message || 'Upload failed. Please try again.');
    } finally {
      setUploadingThumbnail(false);
      if (thumbFileRef.current) thumbFileRef.current.value = '';
    }
  };

  // Helper callbacks to auto-switch tabs
  const onApproveClick = async (id) => {
    await handleApprove(id);
    setSeg('publish');
  };

  const onPublishClick = async (id) => {
    await handlePublishNow(id);
    setSeg('live');
  };

  // Filter items based on current brand selection and segment stage
  const getFilteredItems = () => {
    return items.filter(item => {
      // Filter status
      const s = (item.status || '').toUpperCase();
      let statusMatches = false;
      if (seg === 'pending') {
        statusMatches = (s === 'PENDING' || s === 'PENDING_APPROVAL' || s === 'REJECTED' || s === 'FAILED' || s.startsWith('PENDING'));
      } else if (seg === 'publish') {
        statusMatches = (s === 'APPROVED' || s.startsWith('APPROVED') || s === 'SCHEDULED' || s.startsWith('SCHEDULED'));
      } else if (seg === 'live') {
        statusMatches = (s === 'PUBLISHED' || s.startsWith('PUBLISHED') || s === 'LIVE' || s.startsWith('LIVE') || s === 'PARTIAL' || s.startsWith('PARTIAL'));
      }

      if (!statusMatches) return false;

      // Filter brand
      if (selectedBrand !== 'all') {
        return isSameBrand(item.brand_name, selectedBrand);
      }
      return true;
    });
  };

  const filteredItems = getFilteredItems();
  const currentBrandConfig = selectedItem ? getBrandConfig(selectedItem.brand_name) : null;

  return (
    <div className="page on">
      {/* 4 Stat Cards */}
      <div className="sg">
        <div className="sc gold">
          <div className="sc-ico">◎</div>
          <div className="sc-lbl">In Queue</div>
          <div className="sc-val">{items.length}</div>
          <div className="sc-sub">total tracks</div>
        </div>
        <div className="sc gold">
          <div className="sc-ico">◷</div>
          <div className="sc-lbl">Pending Approval</div>
          <div className="sc-val gold">{analytics.pending}</div>
          <div className="sc-sub">{selectedBrand === 'all' ? 'All Brands' : selectedBrand}</div>
        </div>
        <div className="sc grn">
          <div className="sc-ico">▲</div>
          <div className="sc-lbl">Published Today</div>
          <div className="sc-val grn">{analytics.publishedToday}</div>
          <div className="sc-sub up">▲ Active</div>
        </div>
        <div className="sc teal">
          <div className="sc-ico">◈</div>
          <div className="sc-lbl">Reach · 24h</div>
          <div className="sc-val teal">48.2K</div>
          <div className="sc-sub up">▲ IG+FB+YT</div>
        </div>
      </div>

      {/* Review Grid (Queue list, Detail viewer, Details sidebar) */}
      <div className="rev-grid">

        {/* Column 1: Queue list */}
        <div className="panel" style={{ margin: 0, display: 'flex', flexDirection: 'column', height: 'fit-content' }}>
          <div className="panel-h">
            Queue
            <div className="seg-mini">
              <span className={seg === 'pending' ? 'on' : ''} onClick={() => setSeg('pending')}>Pending</span>
              <span className={seg === 'publish' ? 'on' : ''} onClick={() => setSeg('publish')}>Publish</span>
              <span className={seg === 'live' ? 'on' : ''} onClick={() => setSeg('live')}>Live</span>
            </div>
          </div>
          <div className="panel-b" style={{ maxHeight: 600, overflowY: 'auto', padding: '10px' }}>
            {filteredItems.length === 0 ? (
              <div className="empty" style={{ padding: '34px 10px' }}>
                <b>No {seg} content</b>
                Nothing in {seg} segment for {selectedBrand === 'all' ? 'any brand' : selectedBrand} right now.
              </div>
            ) : (
              filteredItems.map(item => {
                const bc = getBrandConfig(item.brand_name);
                const isSel = selectedItem?.id === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setSelectedItem(item);
                      setEditMode(false);
                    }}
                    className={`qcard ${isSel ? 'sel' : ''}`}
                    style={{ '--brand': bc.color, width: '100%' }}
                  >
                    <div className="qcard-top">
                      <span className={`qbadge ${
                        (item.status || '').toUpperCase() === 'PUBLISHED' ? 'qb-published' :
                        (item.status || '').toUpperCase() === 'APPROVED' ? 'qb-approved' :
                        'qb-pending'
                      }`}>
                        ● {item.status}
                      </span>
                      <span className="qtime">{formatTime(item.created_at)}</span>
                    </div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 9, fontWeight: 700, color: bc.color, marginBottom: 5 }}>
                      <span className="ms-dot" style={{ background: bc.color }} />
                      {bc.name}
                    </div>
                    <div className="qtitle">{item.thumbnail_title || item.caption?.substring(0, 40) || 'Untitled Post'}</div>
                    <div className="qfile">{item.file_name || 'No video file'}</div>
                    <div className="qfmts">
                      {(item.platforms || []).map(p => {
                        const pf = getPlatformConfig(p);
                        const isPublished = ['PUBLISHED','PARTIAL'].includes((item.status || '').toUpperCase());
                        const entry = isPublished ? getPostEntry(p, item.platform_post_ids) : null;
                        const url = isPublished ? buildPostUrl(p, entry) : null;
                        return url ? (
                          <a key={p} href={url} target="_blank" rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="fmt"
                            style={{ textDecoration: 'none', color: '#4ade80', borderColor: 'rgba(74,222,128,0.3)', cursor: 'pointer' }}>
                            {pf.icon} {pf.label} ↗
                          </a>
                        ) : (
                          <span key={p} className="fmt"
                            style={isPublished && entry ? { color: '#4ade80', borderColor: 'rgba(74,222,128,0.3)' } : {}}>
                            {pf.icon} {pf.label}{isPublished && entry ? ' ✓' : ''}
                          </span>
                        );
                      })}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Column 2: Selected Item Detail Viewer */}
        <div className="panel" style={{ margin: 0 }}>
          {!selectedItem ? (
            <div className="empty" style={{ padding: 80 }}>
              <b>No selection</b>
              Select a content item from the queue list to preview and review.
            </div>
          ) : (
            <>
              <div className="rev-titlebar">
                <span className="rev-brandtag" style={{ background: `${currentBrandConfig.color}22`, color: currentBrandConfig.color }}>
                  ● {currentBrandConfig.name}
                </span>
                <h1>{selectedItem.thumbnail_title || 'Untitled Post'}</h1>
                <div className="rev-metaline">
                  {selectedItem.file_name} · groq/whisper + llama · 0:36
                </div>
              </div>

              {/* Video preview panel */}
              <div className="vpanel">
                <div className="reel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {(() => {
                    const pubUrl = selectedItem.public_video_url;
                    const driveId = extractDriveFileId(selectedItem.video_url);
                    const API_URL = import.meta.env.VITE_API_URL || '';

                    const posterUrl = editValues.thumbnail_url || selectedItem.thumbnail_url;
                    if (pubUrl && !extractDriveFileId(pubUrl)) {
                      return (
                        <video
                          key={posterUrl}
                          src={pubUrl}
                          controls
                          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                          poster={posterUrl}
                        />
                      );
                    } else if (driveId) {
                      const proxyUrl = `${API_URL}/api/content/drive-proxy?id=${driveId}`;
                      return (
                        <video
                          key={posterUrl}
                          src={proxyUrl}
                          controls
                          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                          poster={posterUrl}
                        />
                      );
                    } else {
                      return (
                        <div style={{ color: 'var(--t3)', fontSize: '12px', textAlign: 'center', padding: 20 }}>
                          Video unavailable or still importing
                        </div>
                      );
                    }
                  })()}
                </div>
                <div className="vwm">@LEARN WITH KAMAR · 1080×1920 · faststart ✓</div>
              </div>

              {/* ─── STEP 1: Caption Generation ─────────────────────────────────── */}
              {/* AI generates title, description, platform metadata, and hashtags. */}
              {/* User reviews and edits before moving to thumbnail generation.      */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '10px 16px', borderTop: '1px solid var(--b1)' }}>
                {(!selectedItem.caption && !editMode) ? (
                  <div style={{ background: 'var(--bg3)', border: '1px solid var(--gold)', borderRadius: 8, padding: 20 }}>
                    <h3 style={{ margin: '0 0 10px 0', fontSize: 16, color: 'var(--gold)' }}>✨ Generate Captions</h3>
                    <p style={{ margin: '0 0 15px 0', fontSize: 13, color: 'var(--t2)' }}>
                      This video doesn't have any captions yet. Provide a short description to generate captions, hashtags, and metadata for all platforms at once.
                    </p>
                    <textarea
                      placeholder="e.g. A short promotional video about our new digital marketing batch starting next week..."
                      value={firstGenContext}
                      onChange={(e) => setFirstGenContext(e.target.value)}
                      style={{
                        width: '100%', background: 'var(--bg)', color: 'var(--t1)', border: '1px solid var(--b2)',
                        borderRadius: 6, padding: 12, fontSize: 13, minHeight: 80, outline: 'none', marginBottom: 15, boxSizing: 'border-box'
                      }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <select
                        value={firstGenTone}
                        onChange={(e) => setFirstGenTone(e.target.value)}
                        style={{ padding: '8px 12px', borderRadius: 6, background: 'var(--bg)', border: '1px solid var(--b2)', color: 'var(--t1)', outline: 'none' }}
                      >
                        <option value="engaging">Engaging / Mixed</option>
                        <option value="professional">Professional</option>
                        <option value="viral">Viral / Trendy</option>
                        <option value="educational">Educational</option>
                        <option value="sales">Sales-Oriented</option>
                      </select>

                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {/* Primary: caption generation — no thumbnail side-effect */}
                        <button
                          className="tb-btn"
                          onClick={async () => {
                            if (!firstGenContext || firstGenContext.trim() === '') {
                              alert("Please provide a short description first.");
                              return;
                            }
                            const meta = await handleGenerateFirstTime(selectedItem.id, firstGenTone, firstGenContext);
                            if (meta) {
                              const linkedPlats = new Set();
                              (socialAccounts || []).forEach(s => {
                                if (isSameBrand(s.brand_name, selectedItem.brand_name)) {
                                  linkedPlats.add(s.platform);
                                }
                              });

                              const platformsToActivate = [];
                              if (linkedPlats.has('instagram')) platformsToActivate.push('instagram_post');
                              if (linkedPlats.has('facebook')) platformsToActivate.push('facebook_post');
                              if (linkedPlats.has('youtube')) platformsToActivate.push('youtube');
                              if (linkedPlats.has('x_twitter')) platformsToActivate.push('x_twitter');
                              if (linkedPlats.has('linkedin')) platformsToActivate.push('linkedin');

                              setEditValues({
                                caption: meta.caption || '',
                                instagram_caption: meta.instagram_caption || meta.caption || '',
                                facebook_caption: meta.facebook_caption || meta.caption || '',
                                x_caption: meta.x_caption || '',
                                linkedin_caption: meta.linkedin_caption || '',
                                youtube_title: meta.youtube_title || selectedItem.thumbnail_title || '',
                                youtube_description: meta.youtube_description || meta.description || meta.caption || '',
                                thumbnail_title: meta.thumbnail_options?.[0]?.title || selectedItem.thumbnail_title || '',
                                scheduled_at: selectedItem.scheduled_at || '',
                                platforms: platformsToActivate,
                                selected_accounts: selectedItem.selected_accounts || {},
                                hashtags: meta.hashtags || selectedItem.hashtags || ''
                              });
                              setEditMode(true);
                            }
                          }}
                          disabled={loadingSuggestions || !firstGenContext || firstGenContext.trim() === ''}
                          style={{
                            background: 'var(--gold)', color: '#000', padding: '10px 20px',
                            borderRadius: 8, fontWeight: 700, border: 'none',
                            cursor: (!firstGenContext || firstGenContext.trim() === '') ? 'not-allowed' : 'pointer',
                            opacity: (loadingSuggestions || !firstGenContext || firstGenContext.trim() === '') ? 0.5 : 1
                          }}
                        >
                          {loadingSuggestions ? 'Generating…' : '✨ Generate Captions'}
                        </button>
                      </div>
                    </div>
                    {suggestionsError && <div style={{ color: 'var(--red)', marginTop: 10, fontSize: 12 }}>{suggestionsError}</div>}
                  </div>
                ) : (
                  [
                    { key: 'hashtags', label: 'Hashtags', icon: '#', color: '#8B72F0', alwaysShow: true },
                    { key: 'instagram_caption', label: 'Instagram Caption', icon: '📸', color: 'linear-gradient(135deg,#F58529,#DD2A7B,#8134AF)' },
                    { key: 'facebook_caption', label: 'Facebook Caption', icon: '👍', color: '#1877F2' },
                    { key: 'youtube_title', label: 'YouTube Title', icon: '▶', color: '#FF0000' },
                    { key: 'youtube_description', label: 'YouTube Description', icon: '📝', color: '#FF0000' },
                    { key: 'x_caption', label: 'X (Twitter) Caption', icon: '𝕏', color: '#000000' },
                    { key: 'linkedin_caption', label: 'LinkedIn Caption', icon: 'in', color: '#0A66C2' }
                  ].map(field => {
                    const isPlatformActive = () => {
                      if (field.alwaysShow) return true;

                      const activePlatforms = editMode ? (editValues.platforms || []) : (selectedItem.platforms || []);

                      const hasLinkedAccount = (plat) => (socialAccounts || []).some(s => isSameBrand(s.brand_name, selectedItem.brand_name) && s.platform === plat);

                      let isActive = false;
                      if (field.key === 'instagram_caption') isActive = activePlatforms.includes('instagram') || activePlatforms.includes('instagram_post');
                      else if (field.key === 'facebook_caption') isActive = activePlatforms.includes('facebook') || activePlatforms.includes('facebook_post');
                      else if (field.key === 'youtube_title' || field.key === 'youtube_description') isActive = activePlatforms.includes('youtube');
                      else if (field.key === 'x_caption') isActive = activePlatforms.includes('x_twitter');
                      else if (field.key === 'linkedin_caption') isActive = activePlatforms.includes('linkedin');

                      // Enforce it must be linked
                      if (field.key === 'instagram_caption' && !hasLinkedAccount('instagram')) return false;
                      if (field.key === 'facebook_caption' && !hasLinkedAccount('facebook')) return false;
                      if ((field.key === 'youtube_title' || field.key === 'youtube_description') && !hasLinkedAccount('youtube')) return false;
                      if (field.key === 'x_caption' && !hasLinkedAccount('x_twitter')) return false;
                      if (field.key === 'linkedin_caption' && !hasLinkedAccount('linkedin')) return false;

                      return isActive;
                    };

                  const active = isPlatformActive();
                  if (!active) return null;

                  const val = editValues[field.key] || '';

                  return (
                    <div
                      key={field.key}
                      style={{
                        background: 'var(--bg3)',
                        border: '1px solid var(--b1)',
                        borderRadius: 8,
                        padding: 12
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            width: 20,
                            height: 20,
                            borderRadius: 4,
                            background: field.color,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 10,
                            color: '#fff'
                          }}>
                            {field.icon}
                          </span>
                          {field.label}
                        </span>

                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span className="mono" style={{ fontSize: 10, color: 'var(--t3)' }}>
                            {val.length} chars
                          </span>
                          <button
                            type="button"
                            className="tb-btn"
                            onClick={() => {
                              if (!editMode) setEditMode(true);
                              handleOpenAiSuggestions(field.key);
                            }}
                            style={{
                              padding: '2px 8px',
                              fontSize: 9,
                              background: 'rgba(0,196,160,0.12)',
                              color: 'var(--teal)',
                              borderColor: 'rgba(0,196,160,0.2)',
                              cursor: 'pointer'
                            }}
                          >
                            ✨ AI Suggest
                          </button>
                        </div>
                      </div>

                      <textarea
                        value={val}
                        onChange={e => setEditValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                        style={{
                          width: '100%',
                          background: 'var(--bg)',
                          color: 'var(--t1)',
                          border: '1px solid var(--b2)',
                          borderRadius: 6,
                          padding: 8,
                          fontSize: 12.5,
                          lineHeight: 1.5,
                          minHeight: field.key === 'instagram_caption' || field.key === 'facebook_caption' || field.key === 'linkedin_caption' || field.key === 'youtube_description' ? 120 : 50,
                          outline: 'none',
                          resize: 'vertical',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>
                  );
                }))}
              </div>

              {/* Thumbnail Upload */}
              <div style={{ margin: '0 14px 14px', borderTop: '1px solid var(--b1)', paddingTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(139,114,240,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>🖼</div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t1)' }}>Thumbnail</div>
                      <div style={{ fontSize: 10, color: 'var(--t3)' }}>
                        {editValues.thumbnail_url ? 'Current thumbnail — upload a new one to replace' : 'No thumbnail set — upload an image'}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => thumbFileRef.current?.click()}
                    disabled={uploadingThumbnail}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '6px 12px', fontSize: 11, fontWeight: 700, borderRadius: 7,
                      background: uploadingThumbnail ? 'var(--bg3)' : 'linear-gradient(135deg, rgba(139,114,240,0.2), rgba(0,196,160,0.15))',
                      color: uploadingThumbnail ? 'var(--t3)' : 'var(--pur)',
                      border: uploadingThumbnail ? '1px solid var(--b1)' : '1px solid rgba(139,114,240,0.35)',
                      cursor: uploadingThumbnail ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {uploadingThumbnail
                      ? <><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', border: '2px solid var(--t3)', borderTopColor: 'var(--pur)', animation: 'spin 0.8s linear infinite' }} /> Uploading…</>
                      : '⬆ Upload Image'}
                  </button>
                  <input
                    ref={thumbFileRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleThumbnailUpload(f); }}
                  />
                </div>

                {thumbUploadError && (
                  <div style={{ background: 'rgba(240,74,94,0.08)', border: '1px solid rgba(240,74,94,0.3)', borderRadius: 7, padding: '8px 12px', marginBottom: 10, fontSize: 11, color: 'var(--red)' }}>
                    ✕ {thumbUploadError}
                  </div>
                )}

                {editValues.thumbnail_url && (
                  <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--b1)', background: '#000' }}>
                    <img
                      src={editValues.thumbnail_url}
                      alt="Thumbnail"
                      style={{ width: '100%', height: 'auto', display: 'block', maxHeight: 260, objectFit: 'contain' }}
                    />
                    <button
                      onClick={() => setEditValues(prev => ({ ...prev, thumbnail_url: '' }))}
                      style={{
                        position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.65)',
                        border: 'none', color: '#fff', borderRadius: 5, padding: '3px 8px',
                        fontSize: 10, fontWeight: 700, cursor: 'pointer'
                      }}
                    >
                      ✕ Remove
                    </button>
                  </div>
                )}
              </div>

              {/* Status and reject notices */}
              {selectedItem.rejection_reason && selectedItem.status === 'REJECTED' && (
                <div style={{ background: '#f04a5e15', border: '1px solid #f04a5e33', borderRadius: 8, padding: 12, margin: '10px 16px 0' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--red)', textTransform: 'uppercase', marginBottom: 4 }}>
                    Rejection Reason
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--redb)' }}>{selectedItem.rejection_reason}</div>
                </div>
              )}

              {/* Action Buttons */}
              {(() => {
                const statusUpper = (selectedItem.status || '').toUpperCase();
                const hasFutureSchedule = editValues.scheduled_at && new Date(editValues.scheduled_at) > new Date();
                const noPlatforms = !editMode
                  ? !(selectedItem.platforms && selectedItem.platforms.length > 0)
                  : !(editValues.platforms && editValues.platforms.length > 0);
                return (
                  <div className="actions" style={{ padding: '16px', display: 'flex', gap: 10, flexWrap: 'wrap' }}>

                    {/* PENDING: Reject + Approve (smart label) */}
                    {canApprove && (statusUpper === 'PENDING' || statusUpper === 'PENDING_APPROVAL') && (
                      <>
                        <button className="act act-reject" onClick={() => setConfirmAction({ type: 'reject', id: selectedItem.id })}>
                          ✕ Reject
                        </button>
                        <button className="act act-approve" onClick={() => onApproveClick(selectedItem.id)}>
                          {hasFutureSchedule ? '📅 Approve & Schedule' : '✓ Approve'}
                        </button>
                      </>
                    )}

                    {/* APPROVED: Publish Now + optionally Schedule for Later */}
                    {canApprove && (statusUpper === 'APPROVED' || statusUpper === 'APPROVED_SCHEDULED') && (
                      <>
                        {hasFutureSchedule && (
                          <button
                            className="act"
                            onClick={() => handleScheduleItem(selectedItem.id)}
                            style={{ background: 'rgba(0,196,160,0.12)', color: 'var(--teal)', border: '1px solid rgba(0,196,160,0.3)', padding: '10px 16px', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}
                          >
                            📅 Schedule for Later
                          </button>
                        )}
                        <button
                          className="act act-approve"
                          disabled={isPublishing || noPlatforms}
                          title={noPlatforms ? "Please select at least one publishing channel." : ""}
                          onClick={() => onPublishClick(selectedItem.id)}
                        >
                          {isPublishing ? 'Publishing...' : '🚀 Publish Now'}
                        </button>
                      </>
                    )}

                    {/* SCHEDULED: Publish Now (override) */}
                    {canApprove && statusUpper === 'SCHEDULED' && (
                      <button
                        className="act act-approve"
                        disabled={isPublishing || noPlatforms}
                        title={noPlatforms ? "Please select at least one publishing channel." : ""}
                        onClick={() => onPublishClick(selectedItem.id)}
                      >
                        {isPublishing ? 'Publishing...' : '🚀 Publish Now (Override)'}
                      </button>
                    )}

                    <button
                      className="tb-btn"
                      onClick={() => handleSaveEdit(selectedItem.id)}
                      style={{ background: 'var(--teal)', color: 'var(--bg)', fontWeight: 600, padding: '10px 16px', borderRadius: 8, border: 'none', cursor: 'pointer' }}
                    >
                      ✓ Save Captions
                    </button>

                    {(statusUpper === 'PUBLISHED' || statusUpper === 'PARTIAL') && (
                      <button
                        className="tb-btn"
                        onClick={() => { setDeleteConfirm(true); setDeleteResults(null); }}
                        style={{ background: 'rgba(240,74,94,.12)', color: 'var(--red)', border: '1px solid rgba(240,74,94,.3)', padding: '10px 16px', borderRadius: 8, fontWeight: 600, cursor: 'pointer', marginLeft: 'auto' }}
                      >
                        🗑 Delete from All Platforms
                      </button>
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </div>

        {/* Delete Confirmation Modal */}
        {deleteConfirm && selectedItem && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--b1)', borderRadius: 12, padding: 28, maxWidth: 420, width: '90%' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--red)', marginBottom: 10 }}>🗑 Delete from All Platforms?</div>
              <div style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 18, lineHeight: 1.6 }}>
                This will permanently delete <b style={{ color: 'var(--t1)' }}>{selectedItem.file_name}</b> from every platform it was published to — including Instagram, Facebook, YouTube, LinkedIn and their stories. This cannot be undone.
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => setDeleteConfirm(false)} style={{ background: 'transparent', border: '1px solid var(--b2)', color: 'var(--t2)', padding: '9px 18px', borderRadius: 8, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button
                  onClick={handleDeleteFromPlatforms}
                  disabled={isDeleting}
                  style={{ background: 'var(--red)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8, fontWeight: 700, cursor: isDeleting ? 'not-allowed' : 'pointer', opacity: isDeleting ? 0.6 : 1 }}
                >
                  {isDeleting ? 'Deleting...' : 'Yes, Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Results Modal */}
        {deleteResults && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--b1)', borderRadius: 12, padding: 28, maxWidth: 420, width: '90%' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--t1)', marginBottom: 14 }}>Deletion Results</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                {deleteResults.map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg3)', borderRadius: 8, padding: '8px 12px' }}>
                    <span style={{ fontSize: 13, color: 'var(--t1)', textTransform: 'capitalize' }}>{r.channel}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: r.status === 'deleted' ? 'var(--grn)' : r.status === 'skipped' ? 'var(--amb)' : 'var(--red)' }}>
                      {r.status === 'deleted' ? '✓ Deleted' : r.status === 'skipped' ? `⚠ Skipped${r.reason ? ` — ${r.reason}` : ''}` : `✕ Failed — ${r.reason}`}
                    </span>
                  </div>
                ))}
              </div>
              <button onClick={() => setDeleteResults(null)} style={{ width: '100%', background: 'var(--bg4)', border: '1px solid var(--b2)', color: 'var(--t1)', padding: '9px 18px', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
                Close
              </button>
            </div>
          </div>
        )}

        {/* Column 3: Platform selection, Schedule window, Pipeline trace */}
        <div>
          {selectedItem && (
            <>
              {/* Platforms */}
              <div className="panel">
                <div className="panel-h">Platforms &amp; Formats</div>
                <div className="panel-b">
                  {['instagram_post', 'facebook_post', 'youtube', 'linkedin', 'x_twitter'].map(platformKey => {
                    const p = getPlatformConfig(platformKey);
                    const active = editMode
                      ? editValues.platforms?.includes(platformKey)
                      : selectedItem.platforms?.includes(platformKey);

                    const brandAccounts = socialAccounts.filter(s => isSameBrand(s.brand_name, selectedItem.brand_name) && s.platform === (platformKey.includes('instagram') ? 'instagram' : platformKey.includes('facebook') ? 'facebook' : platformKey));

                    if (brandAccounts.length === 0 && !active) {
                      return null;
                    }

                    return (
                      <div key={platformKey} style={{ marginBottom: 12 }}>
                        <button
                          type="button"
                          className={`prow ${active ? 'on' : 'off'}`}
                          onClick={() => {
                            if (!editMode) {
                              setEditValues({
                                caption: selectedItem.caption || '',
                                instagram_caption: selectedItem.instagram_caption || selectedItem.caption || '',
                                facebook_caption: selectedItem.facebook_caption || selectedItem.caption || '',
                                x_caption: selectedItem.x_caption || '',
                                linkedin_caption: selectedItem.linkedin_caption || '',
                                youtube_title: selectedItem.youtube_title || selectedItem.thumbnail_title || '',
                                youtube_description: selectedItem.youtube_description || selectedItem.description || selectedItem.caption || '',
                                thumbnail_title: selectedItem.thumbnail_title || '',
                                scheduled_at: selectedItem.scheduled_at || '',
                                platforms: [...(selectedItem.platforms || [])],
                                selected_accounts: selectedItem.selected_accounts || {},
                                hashtags: selectedItem.hashtags || ''
                              });
                              setEditMode(true);

                              const exists = selectedItem.platforms?.includes(platformKey);
                              const nextPlatforms = exists
                                ? (selectedItem.platforms || []).filter(x => x !== platformKey)
                                : [...(selectedItem.platforms || []), platformKey];

                              setEditValues(prev => ({
                                ...prev,
                                platforms: nextPlatforms,
                                selected_channels: nextPlatforms
                              }));
                            } else {
                              togglePlatform(platformKey);
                            }
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <div className="pl">
                            <span className="pico" style={{ background: p.color }}>{p.icon}</span>
                            {p.label}
                          </div>
                          <div className="chk"></div>
                        </button>

                        {(() => {
                          const isPublished = ['PUBLISHED','PARTIAL'].includes((selectedItem.status || '').toUpperCase());
                          if (!isPublished || !active) return null;
                          const entry = getPostEntry(platformKey, selectedItem.platform_post_ids);
                          const url = buildPostUrl(platformKey, entry);
                          if (!url && !entry) return null;
                          return url ? (
                            <a href={url} target="_blank" rel="noopener noreferrer"
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                marginTop: 4, marginLeft: 6, marginBottom: 2,
                                fontSize: 10, fontWeight: 700, textDecoration: 'none',
                                color: '#4ade80', padding: '2px 8px',
                                background: 'rgba(74,222,128,0.08)',
                                border: '1px solid rgba(74,222,128,0.25)',
                                borderRadius: 20
                              }}>
                              View Post ↗
                            </a>
                          ) : (
                            <span style={{ display: 'inline-block', marginTop: 4, marginLeft: 6, fontSize: 10, color: '#4ade80', fontWeight: 700 }}>
                              ✓ Published
                            </span>
                          );
                        })()}

                        {active && brandAccounts.length > 0 && (
                          <div className="acct" style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 28 }}>
                            {brandAccounts.map(acc => {
                              const checkSelected = (accsObj) => {
                                if (!accsObj) return false;
                                return (accsObj[platformKey] || []).includes(acc.account_id) ||
                                       (accsObj[platformKey.includes('instagram') ? 'instagram' : platformKey.includes('facebook') ? 'facebook' : platformKey] || []).includes(acc.account_id);
                              };
                              const isSelected = editMode ? checkSelected(editValues.selected_accounts) : checkSelected(selectedItem.selected_accounts);
                              return (
                                <label
                                  key={acc.account_id}
                                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, cursor: 'pointer', opacity: isSelected ? 1 : 0.5 }}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    if (!editMode) {
                                      setEditValues({
                                        caption: selectedItem.caption || '',
                                        instagram_caption: selectedItem.instagram_caption || selectedItem.caption || '',
                                        facebook_caption: selectedItem.facebook_caption || selectedItem.caption || '',
                                        x_caption: selectedItem.x_caption || '',
                                        linkedin_caption: selectedItem.linkedin_caption || '',
                                        youtube_title: selectedItem.youtube_title || selectedItem.thumbnail_title || '',
                                        youtube_description: selectedItem.youtube_description || selectedItem.description || selectedItem.caption || '',
                                        thumbnail_title: selectedItem.thumbnail_title || '',
                                        scheduled_at: selectedItem.scheduled_at || '',
                                        platforms: [...(selectedItem.platforms || [])],
                                        selected_accounts: selectedItem.selected_accounts || {}
                                      });
                                      setEditMode(true);
                                    }
                                    toggleAccount(platformKey, acc.account_id);
                                  }}
                                >
                                  <input type="checkbox" checked={isSelected} readOnly style={{ pointerEvents: 'none' }} />
                                  @{acc.account_name}
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Scheduled Window */}
              <div className="panel">
                <div className="panel-h">Scheduled Window</div>
                <div className="panel-b">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* Date row */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date</label>
                      <input
                        type="date"
                        value={editValues.scheduled_at?.slice(0, 10) || ''}
                        onChange={e => {
                          const time = editValues.scheduled_at?.slice(11, 16) || '09:00';
                          setEditValues(prev => ({ ...prev, scheduled_at: `${e.target.value}T${time}:00+05:30` }));
                          if (!editMode) setEditMode(true);
                        }}
                        style={{
                          width: '100%',
                          background: 'var(--bg)',
                          color: 'var(--t1)',
                          border: '1px solid var(--b2)',
                          borderRadius: 8,
                          padding: '9px 12px',
                          fontSize: 13,
                          fontWeight: 500,
                          outline: 'none',
                          boxSizing: 'border-box',
                          cursor: 'pointer',
                          colorScheme: 'dark'
                        }}
                      />
                    </div>
                    {/* Time row */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Time (IST)</label>
                      <input
                        type="time"
                        value={editValues.scheduled_at?.slice(11, 16) || ''}
                        onChange={e => {
                          const date = editValues.scheduled_at?.slice(0, 10) || new Date().toISOString().slice(0, 10);
                          setEditValues(prev => ({ ...prev, scheduled_at: `${date}T${e.target.value}:00+05:30` }));
                          if (!editMode) setEditMode(true);
                        }}
                        style={{
                          width: '100%',
                          background: 'var(--bg)',
                          color: 'var(--t1)',
                          border: '1px solid var(--b2)',
                          borderRadius: 8,
                          padding: '9px 12px',
                          fontSize: 13,
                          fontWeight: 500,
                          outline: 'none',
                          boxSizing: 'border-box',
                          cursor: 'pointer',
                          colorScheme: 'dark'
                        }}
                      />
                    </div>
                    {/* Summary row */}
                    {editValues.scheduled_at && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,196,160,0.08)', border: '1px solid rgba(0,196,160,0.2)', borderRadius: 8, padding: '8px 12px' }}>
                        <span style={{ fontSize: 14 }}>◷</span>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--teal)' }}>{formatTime(editValues.scheduled_at)}</div>
                          <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2 }}>scheduled · IST</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Pipeline Trace */}
              <div className="panel">
                <div className="panel-h">Pipeline Trace</div>
                <div className="panel-b">
                  <div className="trace">
                    <div className="ok">✓ drive → transcode (faststart)</div>
                    <div className={selectedItem.transcript ? 'ok' : 'wait'}>
                      {selectedItem.transcript ? `✓ whisper transcript · ${selectedItem.transcript.length}ch` : '◷ whisper transcript generating'}
                    </div>
                    <div className={selectedItem.instagram_caption || selectedItem.facebook_caption ? 'ok' : 'wait'}>
                      {selectedItem.instagram_caption || selectedItem.facebook_caption ? '✓ llama · 5-platform captions' : '◷ llama caption generation queued'}
                    </div>
                    <div className="ok">✓ story card · brand overlay</div>
                    <div className={selectedItem.status === 'PUBLISHED' ? 'ok' : 'wait'}>
                      {selectedItem.status === 'PUBLISHED' ? '✓ published successfully' : '◷ awaiting approval'}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Reject Reason Confirmation Overlay */}
      {confirmAction && confirmAction.type === 'reject' && (
        <div className="content-os-dashboard-dialog-overlay">
          <div className="content-os-dashboard-dialog">
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, fontFamily: "'Syne', sans-serif" }}>Reject this content?</div>
            <div style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 16 }}>Please provide a reason for the content team.</div>

            <textarea
              placeholder="Reason for rejection..."
              value={rejectionReason}
              onChange={e => setRejectionReason(e.target.value)}
              style={{ width: '100%', padding: 10, borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--b1)', color: 'var(--t1)', marginBottom: 16, minHeight: 80, boxSizing: 'border-box', fontSize: 12, outline: 'none', resize: 'vertical' }}
            />

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setConfirmAction(null); setRejectionReason(''); }} className="act" style={{ background: 'transparent', border: '1px solid var(--b2)', color: 'var(--t1)' }}>
                Cancel
              </button>
              <button
                onClick={() => handleReject(confirmAction.id, rejectionReason)}
                disabled={!rejectionReason.trim()}
                className="act"
                style={{ background: rejectionReason.trim() ? 'var(--red)' : 'var(--bg5)', color: '#fff', cursor: rejectionReason.trim() ? 'pointer' : 'not-allowed' }}
              >
                Yes, Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
