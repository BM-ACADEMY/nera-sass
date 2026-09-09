import { useState, useEffect } from 'react';

export function CaptionStudio({
  selectedItem,
  items,
  setSelectedItem,
  editValues,
  setEditValues,
  getPlatformConfig,
  handleOpenAiSuggestions,
  handleSaveEdit,
  getBrandConfig,
  isSameBrand,
  selectedBrand
}) {
  const [localEditMode, setLocalEditMode] = useState(false);

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
        selected_accounts: selectedItem.selected_accounts || {}
      });
    }
  }, [selectedItem, setEditValues]);

  // List of pending items to select from
  const pendingItems = items.filter(item => {
    const s = (item.status || '').toUpperCase();
    const isPend = s === 'PENDING' || s === 'PENDING_APPROVAL' || s === 'REJECTED';
    if (!isPend) return false;
    
    if (selectedBrand !== 'all') {
      return isSameBrand(item.brand_name, selectedBrand);
    }
    return true;
  });

  const handleSave = async () => {
    await handleSaveEdit(selectedItem.id);
    setLocalEditMode(false);
  };

  const platformsList = [
    { key: 'instagram_caption', label: 'Instagram', name: 'instagram', iconField: 'instagram_caption' },
    { key: 'facebook_caption', label: 'Facebook', name: 'facebook', iconField: 'facebook_caption' },
    { key: 'youtube_description', label: 'YouTube', name: 'youtube', iconField: 'youtube_title' },
    { key: 'x_caption', label: 'X (Twitter)', name: 'x_twitter', iconField: 'x_caption' },
    { key: 'linkedin_caption', label: 'LinkedIn', name: 'linkedin', iconField: 'linkedin_caption' }
  ];

  return (
    <div className="page on">
      <div className="panel">
        <div className="panel-h">
          AI Caption Engine 
          <span className="mono" style={{ textTransform: 'none', color: 'var(--teal)' }}>groq · llama-3.3-70b</span>
        </div>
        <div className="panel-b">
          <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.7, marginBottom: 16 }}>
            Each publishing platform gets its own tailored copy generated from the video's transcript and brand voice SOP. 
            Select a pending video below to review and modify its captions.
          </p>

          {/* Pending items dropdown/select list */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center' }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)', whiteSpace: 'nowrap' }}>Active Reel:</label>
            <select
              value={selectedItem ? selectedItem.id : ''}
              onChange={e => {
                const item = items.find(i => i.id === parseInt(e.target.value));
                if (item) {
                  setSelectedItem(item);
                  setLocalEditMode(false);
                }
              }}
              style={{
                flex: 1,
                background: 'var(--bg3)',
                color: 'var(--t1)',
                border: '1px solid var(--b2)',
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 13,
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="" disabled>Select content to edit captions...</option>
              {pendingItems.map(i => {
                const bc = getBrandConfig(i.brand_name);
                return (
                  <option key={i.id} value={i.id}>
                    [{bc.short}] {i.thumbnail_title || i.caption?.substring(0, 40) || i.file_name}
                  </option>
                );
              })}
            </select>
            {selectedItem && (
              <button 
                onClick={() => {
                  if (localEditMode) {
                    handleSave();
                  } else {
                    setLocalEditMode(true);
                  }
                }}
                className="tb-btn"
                style={{ background: localEditMode ? 'var(--teal)' : 'var(--bg4)', color: localEditMode ? 'var(--bg)' : 'var(--t1)', fontWeight: 600, height: 40 }}
              >
                {localEditMode ? '✓ Save All' : '✏️ Edit'}
              </button>
            )}
          </div>

          {!selectedItem ? (
            <div className="empty" style={{ padding: 40 }}>
              <b>No video selected</b>
              Choose an active video from the list above to customize subtitles and metadata.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {platformsList.map(item => {
                const p = getPlatformConfig(item.name);
                const captionValue = localEditMode ? (editValues[item.key] || '') : (selectedItem[item.key] || selectedItem.caption || '');
                const charCount = captionValue.length;

                return (
                  <div key={item.key} className="panel" style={{ marginBottom: 0 }}>
                    <div className="panel-h" style={{ textTransform: 'none', padding: '10px 14px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="pico" style={{ background: p.color }}>{p.icon}</span>
                        <b>{item.label}</b>
                        <span className="mono" style={{ color: 'var(--t3)', fontSize: 10 }}>· Tanglish brand tone</span>
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="mono" style={{ color: item.name === 'x_twitter' && charCount > 240 ? 'var(--red)' : 'var(--grn)' }}>
                          {charCount} chars {item.name === 'x_twitter' && '/ 240'}
                        </span>
                        {localEditMode && (
                          <button 
                            className="tb-btn"
                            onClick={() => handleOpenAiSuggestions(item.key)}
                            style={{ padding: '2px 8px', fontSize: 10, background: 'rgba(0,196,160,0.12)', color: 'var(--teal)', borderColor: 'rgba(0,196,160,0.2)' }}
                          >
                            ✨ AI Suggest
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="panel-b" style={{ padding: 14 }}>
                      {localEditMode ? (
                        <textarea
                          value={captionValue}
                          onChange={e => setEditValues(prev => ({ ...prev, [item.key]: e.target.value }))}
                          style={{
                            width: '100%',
                            background: 'var(--bg)',
                            color: 'var(--t1)',
                            border: '1px solid var(--b1)',
                            borderRadius: 8,
                            padding: 12,
                            fontSize: 13,
                            lineHeight: 1.6,
                            minHeight: 80,
                            outline: 'none',
                            resize: 'vertical'
                          }}
                        />
                      ) : (
                        <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--t1)', whiteSpace: 'pre-wrap' }}>
                          {captionValue || <span style={{ color: 'var(--t3)' }}>Not generated. Edit to write.</span>}
                        </p>
                      )}
                      
                      {/* Special YouTube Title Field */}
                      {item.key === 'youtube_description' && (
                        <div style={{ marginTop: 12, borderTop: '1px dashed var(--b1)', paddingTop: 10 }}>
                          <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', marginBottom: 4 }}>
                            YouTube Video Title:
                          </label>
                          {localEditMode ? (
                            <input
                              type="text"
                              value={editValues.youtube_title || ''}
                              onChange={e => setEditValues(prev => ({ ...prev, youtube_title: e.target.value }))}
                              style={{ width: '100%', background: 'var(--bg)', color: 'var(--t1)', border: '1px solid var(--b1)', borderRadius: 6, padding: '8px 10px', fontSize: 13, outline: 'none' }}
                            />
                          ) : (
                            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--gold)' }}>
                              {selectedItem.youtube_title || selectedItem.thumbnail_title || 'No custom title'}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
