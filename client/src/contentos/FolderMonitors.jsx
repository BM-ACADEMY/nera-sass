export function FolderMonitors({
  monitors,
  loadingMonitors,
  monitorInputs,
  setMonitorInputs,
  handleSaveMonitor,
  brands,
  getBrandConfig
}) {
  return (
    <div className="page on">
      {/* Stats */}
      <div className="sg sg-3">
        <div className="sc teal">
          <div className="sc-lbl">Active Monitors</div>
          <div className="sc-val teal">{monitors.length}</div>
          <div className="sc-sub">watching Drive folders</div>
        </div>
        <div className="sc gold">
          <div className="sc-lbl">Detected Today</div>
          <div className="sc-val gold">9</div>
          <div className="sc-sub">new videos ingested</div>
        </div>
        <div className="sc grn">
          <div className="sc-lbl">Service Account</div>
          <div className="sc-val grn" style={{ fontSize: 15, fontFamily: "'IBM Plex Mono', monospace" }}>connected</div>
          <div className="sc-sub">leados-drive-sync</div>
        </div>
      </div>

      {/* Main panel */}
      <div className="panel">
        <div className="panel-h">
          Drive Folder Monitors 
          <span className="mono" style={{ textTransform: 'none', color: 'var(--t3)' }}>poll · every 60s</span>
        </div>
        <div className="panel-b">
          <div style={{ background: 'rgba(232, 146, 26, 0.1)', border: '1px solid rgba(232, 146, 26, 0.2)', borderRadius: 10, padding: 14, marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--amb)', marginBottom: 4 }}>
              ⚠️ Action Required: Share Drive Folder
            </div>
            <div style={{ fontSize: 11, color: 'var(--t2)', lineHeight: 1.5 }}>
              Ensure you share your target Google Drive folders with the LeadOS service account email:
              <code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4, marginLeft: 6, color: 'var(--gold)', fontFamily: "'IBM Plex Mono', monospace" }}>
                leados-drive-sync@jobportal-492311.iam.gserviceaccount.com
              </code>
              {" "}as a <strong>Viewer</strong> or <strong>Editor</strong> so that LeadOS can sync files automatically.
            </div>
          </div>

          {loadingMonitors ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>
              Loading Drive folder monitor settings...
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {brands.map(brand => {
                const folderId = monitorInputs[brand.slug] || '';
                const bc = getBrandConfig(brand.name);
                const hasFolder = !!folderId;

                return (
                  <div key={brand.slug} className="fm-row" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 12, padding: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="fm-dot" style={{ background: bc.color }} />
                        <span className="fm-name">{brand.name}</span>
                        <span className="fm-path" style={{ fontSize: 9.5 }}>/ContentOS/Uploads/{brand.slug}</span>
                      </div>
                      <span className="fm-status" style={{
                        background: hasFolder ? 'rgba(52,199,123,.14)' : 'rgba(212,168,67,.15)',
                        color: hasFolder ? 'var(--grn)' : 'var(--gold)'
                      }}>
                        {hasFolder ? '● WATCHING' : '○ SET FOLDER'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 10, width: '100%' }}>
                      <input 
                        type="text"
                        placeholder="Paste Google Drive Folder Link or Folder ID..."
                        value={folderId}
                        onChange={e => setMonitorInputs(prev => ({ ...prev, [brand.slug]: e.target.value }))}
                        style={{
                          flex: 1,
                          background: 'var(--bg)',
                          border: '1px solid var(--b1)',
                          color: 'var(--t1)',
                          padding: '10px 14px',
                          borderRadius: 8,
                          fontSize: 13,
                          outline: 'none',
                          boxSizing: 'border-box'
                        }}
                      />
                      <button 
                        onClick={() => handleSaveMonitor(brand.slug)}
                        className="tb-btn teal"
                        style={{ padding: '0 20px', height: 40, borderRadius: 8, fontSize: 12, fontWeight: 700 }}
                      >
                        Save
                      </button>
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
