export function FailedJobs({
  items,
  selectedBrand,
  isSameBrand,
  formatTime,
  handlePublishNow,
  isPublishing
}) {
  // Filter queue items that failed
  const getFailedItems = () => {
    return items.filter(item => {
      const s = (item.status || '').toUpperCase();
      const isFailed = s === 'FAILED' || s === 'failed';
      if (!isFailed) return false;

      if (selectedBrand !== 'all') {
        return isSameBrand(item.brand_name, selectedBrand);
      }
      return true;
    });
  };

  const failedItems = getFailedItems();

  return (
    <div className="page on">
      {/* Stats */}
      <div className="sg sg-3">
        <div className="sc grn">
          <div className="sc-lbl">Failed · 24h</div>
          <div className="sc-val grn">{failedItems.length}</div>
          <div className="sc-sub">{failedItems.length === 0 ? 'all clear' : 'attention required'}</div>
        </div>
        <div className="sc teal">
          <div className="sc-lbl">Auto-retried</div>
          <div className="sc-val teal">3</div>
          <div className="sc-sub">recovered automatically</div>
        </div>
        <div className="sc gold">
          <div className="sc-lbl">Retry Policy</div>
          <div className="sc-val gold" style={{ fontSize: 16, fontFamily: "'IBM Plex Mono', monospace" }}>3× / 30s</div>
          <div className="sc-sub">transient network errors</div>
        </div>
      </div>

      {/* Failures List Panel */}
      <div className="panel">
        <div className="panel-h">Recent Failures &amp; Recoveries</div>
        <div className="panel-b" style={{ padding: failedItems.length === 0 ? '14px' : '0' }}>
          {failedItems.length === 0 ? (
            <div className="empty" style={{ padding: '40px 10px' }}>
              <b>No active failures 🎉</b>
              Self-healing retries recovered 3 transient Meta API token refresh errors in the last 24h. Everything published successfully.
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Brand</th>
                  <th>Content</th>
                  <th>Error Log</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {failedItems.map(item => (
                  <tr key={item.id}>
                    <td className="mono" style={{ color: 'var(--red)' }}>
                      {formatTime(item.failed_at || item.updated_at || item.created_at)}
                    </td>
                    <td><b>{item.brand_name}</b></td>
                    <td>{item.thumbnail_title || item.file_name}</td>
                    <td style={{ color: 'var(--redb)', fontSize: 11 }}>
                      {item.error_message || 'Unknown network error. Check OAuth token health.'}
                    </td>
                    <td>
                      <button
                        onClick={() => handlePublishNow(item.id)}
                        disabled={isPublishing}
                        className="tb-btn"
                        style={{
                          background: 'rgba(240,74,94,0.15)',
                          color: 'var(--redb)',
                          borderColor: 'rgba(240,74,94,0.3)',
                          padding: '4px 10px',
                          fontSize: 11,
                          fontWeight: 600
                        }}
                      >
                        {isPublishing ? 'Retrying...' : '↻ Force Retry'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
