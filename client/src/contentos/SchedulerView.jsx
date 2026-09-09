export function SchedulerView({
  items,
  selectedBrand,
  isSameBrand,
  formatTime,
  getBrandConfig,
  getPlatformConfig,
  stats
}) {
  // Filter and sort items that are approved/scheduled
  const getScheduledItems = () => {
    return items
      .filter(item => {
        const s = (item.status || '').toUpperCase();
        const isScheduled = s === 'SCHEDULED';
        if (!isScheduled) return false;

        if (selectedBrand !== 'all') {
          return isSameBrand(item.brand_name, selectedBrand);
        }
        return true;
      })
      .sort((a, b) => {
        if (!a.scheduled_at) return 1;
        if (!b.scheduled_at) return -1;
        return new Date(a.scheduled_at) - new Date(b.scheduled_at);
      });
  };

  const scheduledItems = getScheduledItems();
  const publishedThisWeek = stats?.PUBLISHED_WEEK ?? 0;
  const approvedCount = stats?.APPROVED ?? 0;

  return (
    <div className="page on">
      {/* Stats */}
      <div className="sg sg-3">
        <div className="sc gold">
          <div className="sc-lbl">Scheduled</div>
          <div className="sc-val gold">{scheduledItems.length}</div>
          <div className="sc-sub">pending auto-publish</div>
        </div>
        <div className="sc teal">
          <div className="sc-lbl">WF14 Cron</div>
          <div className="sc-val teal" style={{ fontSize: 16, fontFamily: "'IBM Plex Mono', monospace" }}>every 5m</div>
          <div className="sc-sub">{approvedCount} approved ready</div>
        </div>
        <div className="sc grn">
          <div className="sc-lbl">Auto-published</div>
          <div className="sc-val grn">{publishedThisWeek}</div>
          <div className="sc-sub">this week</div>
        </div>
      </div>

      {/* Schedule list panel */}
      <div className="panel">
        <div className="panel-h">Upcoming Schedule</div>
        <div className="panel-b" style={{ padding: 0 }}>
          {scheduledItems.length === 0 ? (
            <div className="empty" style={{ padding: 40 }}>
              <b>No scheduled content</b>
              There are no approved videos scheduled for publication for {selectedBrand === 'all' ? 'any brand' : selectedBrand}.
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Brand</th>
                  <th>Content</th>
                  <th>Platforms</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {scheduledItems.map(item => {
                  const bc = getBrandConfig(item.brand_name);
                  return (
                    <tr key={item.id}>
                      <td className="mono" style={{ color: 'var(--gold)' }}>
                        {formatTime(item.scheduled_at)}
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span className="ms-dot" style={{ background: bc.color, width: 8, height: 8 }} />
                          <b>{bc.name}</b>
                        </span>
                      </td>
                      <td>{item.thumbnail_title || item.caption?.substring(0, 50) || 'Untitled Post'}</td>
                      <td className="mono">
                        {(item.platforms || []).map(p => {
                          const pf = getPlatformConfig(p);
                          return <span key={p} style={{ marginRight: 6 }} title={pf.label}>{pf.icon}</span>;
                        })}
                      </td>
                      <td>
                        <span className="pill gold">Scheduled</span>
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
