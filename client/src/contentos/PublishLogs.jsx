export function PublishLogs({
  items,
  selectedBrand,
  isSameBrand,
  formatTime
}) {
  // Filter history logs (published, partial, failed)
  const getLogs = () => {
    return items
      .filter(item => {
        const s = (item.status || '').toUpperCase();
        const isLog = s === 'PUBLISHED' || s === 'PARTIAL' || s === 'FAILED';
        if (!isLog) return false;

        if (selectedBrand !== 'all') {
          return isSameBrand(item.brand_name, selectedBrand);
        }
        return true;
      })
      .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
  };

  const logs = getLogs();

  return (
    <div className="page on">
      <div className="panel">
        <div className="panel-h">
          Publishing Log 
          <span className="mono" style={{ textTransform: 'none', color: 'var(--t3)' }}>
            {logs.length} total records
          </span>
        </div>
        <div className="panel-b" style={{ padding: 0 }}>
          {logs.length === 0 ? (
            <div className="empty" style={{ padding: 40 }}>
              <b>No publish logs</b>
              There are no historical publish records for {selectedBrand === 'all' ? 'any brand' : selectedBrand} yet.
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Brand</th>
                  <th>Content</th>
                  <th>Platform</th>
                  <th>Post ID / Reference</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log, index) => {
                  const s = (log.status || '').toUpperCase();
                  const isSuccess = s === 'PUBLISHED';
                  const isPartial = s === 'PARTIAL';
                  const pillClass = isSuccess ? 'grn' : isPartial ? 'ylw' : 'red';
                  const pillText = isSuccess ? 'Published' : isPartial ? 'Partial' : 'Failed';

                  return (
                    <tr key={log.id || index}>
                      <td className="mono">{formatTime(log.updated_at || log.created_at)}</td>
                      <td>
                        <span style={{ fontWeight: 600, color: 'var(--t1)' }}>{log.brand_name}</span>
                      </td>
                      <td>{log.thumbnail_title || log.caption?.substring(0, 40) || 'Untitled Post'}</td>
                      <td style={{ textTransform: 'capitalize' }}>
                        {(log.platforms || []).join(', ') || 'None'}
                      </td>
                      <td className="mono" style={{ fontSize: 10 }}>
                        {log.post_id || log.error_message?.substring(0, 30) || '—'}
                      </td>
                      <td>
                        <span className={`pill ${pillClass}`}>{pillText}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
