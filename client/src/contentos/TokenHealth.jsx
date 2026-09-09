export function TokenHealth({ connectedAccounts }) {
  const activeConnected = connectedAccounts.filter(acc => acc.access_token);

  // Calculate health metrics
  const getHealthStats = () => {
    let healthy = 0;
    let expiring = 0;
    
    activeConnected.forEach(acc => {
      if (acc.expires_at) {
        const days = Math.ceil((new Date(acc.expires_at) - new Date()) / (1000 * 60 * 60 * 24));
        if (days > 0 && days <= 15) {
          expiring++;
        } else {
          healthy++;
        }
      } else {
        healthy++;
      }
    });

    return { healthy, expiring };
  };

  const stats = getHealthStats();

  return (
    <div className="page on">
      {/* Stats */}
      <div className="sg sg-3">
        <div className="sc grn">
          <div className="sc-lbl">Healthy Tokens</div>
          <div className="sc-val grn">{stats.healthy}</div>
          <div className="sc-sub">all encrypted AES-256</div>
        </div>
        <div className="sc gold">
          <div className="sc-lbl">Expiring Soon</div>
          <div className="sc-val gold">{stats.expiring}</div>
          <div className="sc-sub">attention required</div>
        </div>
        <div className="sc teal">
          <div className="sc-lbl">WF13 Monitor</div>
          <div className="sc-val teal" style={{ fontSize: 16, fontFamily: "'IBM Plex Mono', monospace" }}>every 6h</div>
          <div className="sc-sub">auto-alerts enabled</div>
        </div>
      </div>

      {/* Access Tokens Table */}
      <div className="panel">
        <div className="panel-h">Access Tokens</div>
        <div className="panel-b" style={{ padding: 0 }}>
          {activeConnected.length === 0 ? (
            <div className="empty">
              <b>No active tokens found</b>
              Connect your channels to view credential token status.
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Platform</th>
                  <th>Token</th>
                  <th>Expires</th>
                  <th>Health</th>
                </tr>
              </thead>
              <tbody>
                {activeConnected.map((acc, index) => {
                  let expiryStr = '—';
                  let statusClass = 'grn';
                  let statusText = 'Healthy';

                  if (acc.expires_at) {
                    const days = Math.ceil((new Date(acc.expires_at) - new Date()) / (1000 * 60 * 60 * 24));
                    if (days <= 0) {
                      expiryStr = 'Expired';
                      statusClass = 'red';
                      statusText = 'Expired';
                    } else if (days <= 15) {
                      expiryStr = `${days} days`;
                      statusClass = 'gold';
                      statusText = 'Expiring';
                    } else {
                      expiryStr = `${days} days`;
                      statusClass = 'grn';
                      statusText = 'Healthy';
                    }
                  }

                  return (
                    <tr key={index}>
                      <td>
                        <b>{acc.account_name}</b>
                        <div style={{ fontSize: 10, color: 'var(--t3)' }}>Brand: {acc.brand_name}</div>
                      </td>
                      <td style={{ textTransform: 'capitalize' }}>{acc.platform}</td>
                      <td className="mono" style={{ opacity: 0.6 }}>●●●●●●●● AES-256</td>
                      <td className="mono">{expiryStr}</td>
                      <td>
                        <span className={`pill ${statusClass}`}>{statusText}</span>
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
