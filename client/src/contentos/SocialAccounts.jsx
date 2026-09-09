import { useState, useEffect } from 'react';
import { api } from '../src/services/api.js';

export function SocialAccounts({
  connectedAccounts,
  loadConnectedAccounts,
  getPlatformConfig,
  brands = []
}) {
  const [discoveredAccounts, setDiscoveredAccounts] = useState([]);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [linkingBrand, setLinkingBrand] = useState(false);
  const [metaAppId, setMetaAppId] = useState('');
  const [ytBrand, setYtBrand] = useState('');
  const [liBrand, setLiBrand] = useState('');

  // Load Meta configuration App ID
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const res = await api.get('/api/content/config');
        setMetaAppId(res.appId || '');
      } catch (err) {
        console.error('Error loading meta config:', err);
      }
    };
    loadConfig();
    loadConnectedAccounts();
  }, [loadConnectedAccounts]);

  // Handle YouTube / LinkedIn URL parameters callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ytSuccess = params.get('youtube_success');
    const ytError = params.get('youtube_error');
    const liSuccess = params.get('linkedin_success');
    const liError = params.get('linkedin_error');
    const channel = params.get('channel');
    const brand = params.get('brand');

    if (ytSuccess) {
      alert(`Successfully connected YouTube channel "${channel}"!`);
      window.history.replaceState({}, document.title, window.location.pathname);
      loadConnectedAccounts();
    } else if (ytError) {
      alert(`Failed to connect YouTube: ${ytError}`);
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (liSuccess) {
      alert(`Successfully connected LinkedIn "${channel}" to brand "${brand}"!`);
      window.history.replaceState({}, document.title, window.location.pathname);
      loadConnectedAccounts();
    } else if (liError) {
      alert(`Failed to connect LinkedIn: ${liError}`);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [loadConnectedAccounts]);

  // Handle Meta OAuth Callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const via = params.get('via');
    if (code) {
      window.history.replaceState({}, document.title, window.location.pathname);
      
      const exchangeCode = async () => {
        setLoadingMeta(true);
        try {
          const redirectUri = via === 'settings'
            ? window.location.origin + '/settings'
            : window.location.origin + '/admin/content-os/social-connection';

          const res = await api.post('/api/content/meta/callback', { code, redirectUri });
          if (res.success && res.accounts) {
            setDiscoveredAccounts(res.accounts);
            alert(`Successfully authenticated with Meta! Discovered ${res.accounts.length} page(s).`);
          } else {
            alert('Meta connection succeeded, but no pages were found.');
          }
        } catch (err) {
          console.error('Meta OAuth Callback failed:', err);
          alert('Failed to connect to Meta: ' + err.message);
        } finally {
          setLoadingMeta(false);
        }
      };
      exchangeCode();
    }
  }, [loadConnectedAccounts]);

  const handleConnectMeta = () => {
    if (!metaAppId) {
      alert('Meta App ID is not configured. Please contact server admin.');
      return;
    }
    const redirectUri = window.location.origin + '/admin/content-os/social-connection';
    const fbUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${metaAppId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management,public_profile&response_type=code`;
    window.location.href = fbUrl;
  };

  const handleLinkToBrand = async (brandName, platform, accountName, accountId, facebookPageId, instagramBusinessId, accessToken, expiresAt) => {
    setLinkingBrand(true);
    try {
      const res = await api.post('/api/content/meta/link-account', {
        brand_name: brandName,
        platform,
        account_name: accountName,
        account_id: accountId,
        facebook_page_id: facebookPageId,
        instagram_business_id: instagramBusinessId,
        access_token: accessToken,
        expires_at: expiresAt
      });
      if (res.success) {
        alert(`Successfully linked ${platform} (${accountName}) to brand "${brandName}"!`);
        setDiscoveredAccounts(prev => prev.filter(item => {
          if (platform === 'facebook') return item.facebook.page_id !== accountId;
          if (platform === 'instagram') return item.instagram?.business_id !== accountId;
          return true;
        }));
        loadConnectedAccounts();
      } else {
        alert('Failed to link account to brand');
      }
    } catch (err) {
      alert('Linking brand account failed: ' + err.message);
    } finally {
      setLinkingBrand(false);
    }
  };

  const handleConnectYoutube = () => {
    const apiBase = import.meta.env.VITE_API_URL || '';
    window.location.href = `${apiBase}/api/content/youtube/auth?brand_name=${encodeURIComponent(ytBrand)}`;
  };

  const handleConnectLinkedIn = () => {
    if (!liBrand) { alert('Please select a brand first.'); return; }
    const apiBase = import.meta.env.VITE_API_URL || '';
    window.location.href = `${apiBase}/api/content/linkedin/auth?brand_name=${encodeURIComponent(liBrand)}`;
  };

  const activeConnected = connectedAccounts.filter(acc => acc.access_token);

  return (
    <div className="page on">
      {/* Stats */}
      <div className="sg sg-3">
        <div className="sc grn">
          <div className="sc-lbl">Connected</div>
          <div className="sc-val grn">{activeConnected.length}</div>
          <div className="sc-sub">active channels</div>
        </div>
        <div className="sc gold">
          <div className="sc-lbl">Pending Setup</div>
          <div className="sc-val gold">3</div>
          <div className="sc-sub">Dada's · Edu · Travel</div>
        </div>
        <div className="sc teal">
          <div className="sc-lbl">Platforms Live</div>
          <div className="sc-val teal">3</div>
          <div className="sc-sub">Meta + Google API</div>
        </div>
      </div>

      {/* Alert Notices */}
      <div className="conn-grid" style={{ marginBottom: 16 }}>
        <div className="panel" style={{ margin: 0, borderColor: 'rgba(0,196,160,.2)' }}>
          <div className="panel-b" style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(0,196,160,.12)', display: 'grid', placeItems: 'center', color: 'var(--teal)', flexShrink: 0, fontSize: 14 }}>🛡</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)', marginBottom: 2 }}>Meta App · Live Mode</div>
              <div style={{ fontSize: 10.5, color: 'var(--t2)', lineHeight: 1.5 }}>
                The Meta Developer App must be set to <b style={{ color: 'var(--t1)' }}>Live</b> on the developer portal for production publishing.
              </div>
            </div>
          </div>
        </div>
        <div className="panel" style={{ margin: 0, borderColor: 'rgba(232,146,26,.2)' }}>
          <div className="panel-b" style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(232,146,26,.1)', display: 'grid', placeItems: 'center', color: 'var(--amb)', flexShrink: 0, fontSize: 14 }}>⚠</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)', marginBottom: 2 }}>Google API Quota</div>
              <div style={{ fontSize: 10.5, color: 'var(--t2)', lineHeight: 1.5 }}>
                Standard projects allow <b style={{ color: 'var(--t1)' }}>~6 uploads/day</b> (10,000 units). Request a quota increase for higher volumes.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Connection Panel */}
      <div className="panel">
        <div className="panel-h">Connect a Channel</div>
        <div className="panel-b">
          <p style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 20 }}>
            Authorize Meta or Google. LeadOS requests publishing scopes, then auto-discovers each brand's pages and channels.
          </p>

          {/* Meta Connect */}
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1)', marginBottom: 5 }}>Meta · Facebook &amp; Instagram</div>
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--t3)', marginBottom: 9 }}>
              scopes: pages_show_list · pages_manage_posts · instagram_basic · instagram_content_publish
            </div>
            <button
              onClick={handleConnectMeta}
              disabled={loadingMeta}
              style={{
                background: '#1877F2',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '12px 20px',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 9,
                boxShadow: '0 4px 14px rgba(24,119,242,.3)',
                opacity: loadingMeta ? 0.6 : 1
              }}
            >
              <span>👍</span>
              <span>{loadingMeta ? 'Authorizing Meta...' : 'Connect with Facebook & Instagram'}</span>
            </button>
          </div>

          {/* YouTube Connect */}
          <div style={{ borderTop: '1px solid var(--b1)', paddingTop: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1)', marginBottom: 5 }}>Google · YouTube Channel</div>
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--t3)', marginBottom: 9 }}>
              scopes: youtube.upload · youtube.readonly
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <select
                value={ytBrand}
                onChange={e => setYtBrand(e.target.value)}
                style={{
                  background: 'var(--bg4)',
                  color: 'var(--t1)',
                  border: '1px solid var(--b2)',
                  padding: '10px 14px',
                  borderRadius: 8,
                  fontSize: 13,
                  outline: 'none',
                  cursor: 'pointer',
                  minWidth: 200
                }}
              >
                <option value="" disabled>Select brand...</option>
                {brands.map(b => (
                  <option key={b.id || b.slug} value={b.name}>{b.name}</option>
                ))}
              </select>
              <button
                onClick={handleConnectYoutube}
                style={{
                  background: '#FF0000',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '12px 20px',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 9,
                  boxShadow: '0 4px 14px rgba(255,0,0,.3)'
                }}
              >
                <span>▶</span> Connect YouTube Channel
              </button>
            </div>
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--t3)', marginTop: 10 }}>
              redirects → /api/content/youtube/auth?brand_name=...
            </div>
          </div>

          {/* LinkedIn Connect */}
          <div style={{ borderTop: '1px solid var(--b1)', paddingTop: 20, marginTop: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1)', marginBottom: 5 }}>LinkedIn · Page or Profile</div>
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--t3)', marginBottom: 9 }}>
              scopes: w_member_social · r_organization_social · w_organization_social
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <select
                value={liBrand}
                onChange={e => setLiBrand(e.target.value)}
                style={{
                  background: 'var(--bg4)',
                  color: 'var(--t1)',
                  border: '1px solid var(--b2)',
                  padding: '10px 14px',
                  borderRadius: 8,
                  fontSize: 13,
                  outline: 'none',
                  cursor: 'pointer',
                  minWidth: 200
                }}
              >
                <option value="" disabled>Select brand...</option>
                {brands.map(b => (
                  <option key={b.id || b.slug} value={b.name}>{b.name}</option>
                ))}
              </select>
              <button
                onClick={handleConnectLinkedIn}
                style={{
                  background: '#0A66C2',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '12px 20px',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 9,
                  boxShadow: '0 4px 14px rgba(10,102,194,.3)'
                }}
              >
                <span>in</span> Connect LinkedIn
              </button>
            </div>
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--t3)', marginTop: 10 }}>
              Auto-detects company page if you are an admin · falls back to personal profile
            </div>
          </div>

          {/* Loading Banner */}
          {loadingMeta && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg3)', border: '1px solid var(--b1)', borderRadius: 8, padding: 12, marginTop: 20 }}>
              <span className="ms-live" style={{ background: 'var(--teal)' }}></span>
              <span style={{ fontSize: 11, color: 'var(--t2)' }}>Exchanging authorization code for long-lived token…</span>
            </div>
          )}

          {/* Discovered Meta Assets List */}
          {discoveredAccounts.length > 0 && (
            <div style={{ marginTop: 22 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--teal)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 12 }}>
                Discovered Meta Assets — Link to a brand:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {discoveredAccounts.map((item, idx) => (
                  <div key={idx} style={{ background: 'var(--bg3)', border: '1px solid var(--b1)', borderRadius: 10, padding: 15 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 13, color: 'var(--t1)', fontWeight: 700 }}>{item.facebook.name}</div>
                        <div className="mono" style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2 }}>FB Page ID: {item.facebook.page_id}</div>
                        {item.instagram && (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(225,48,108,.08)', border: '1px solid rgba(225,48,108,.15)', padding: '3px 9px', borderRadius: 20, marginTop: 8 }}>
                            <span style={{ fontSize: 10, color: '#E1306C', fontWeight: 600 }}>🔗 IG @{item.instagram.username}</span>
                          </div>
                        )}
                      </div>
                      <select 
                        disabled={linkingBrand}
                        onChange={(e) => {
                          const brand = e.target.value;
                          if (!brand) return;
                          handleLinkToBrand(brand, 'facebook', item.facebook.name, item.facebook.page_id, item.facebook.page_id, null, item.facebook.access_token, item.expires_at);
                          if (item.instagram) {
                            handleLinkToBrand(brand, 'instagram', item.instagram.username, item.instagram.business_id, item.facebook.page_id, item.instagram.business_id, item.instagram.access_token, item.expires_at);
                          }
                        }}
                        defaultValue=""
                        style={{ background: 'var(--bg4)', color: 'var(--t1)', border: '1px solid var(--b2)', padding: '8px 12px', borderRadius: 8, fontSize: 12, outline: 'none', cursor: 'pointer' }}
                      >
                        <option value="" disabled>Link to Brand Dashboard...</option>
                        {brands.map(b => (
                          <option key={b.id || b.slug} value={b.name}>{b.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Connected Grid */}
      <div className="panel">
        <div className="panel-h">Currently Connected Channels</div>
        <div className="panel-b">
          {activeConnected.length === 0 ? (
            <div className="empty">
              <b>No channels connected yet</b>
              Connect your first Facebook Page or YouTube channel above to start publishing.
            </div>
          ) : (
            <div className="conn-grid">
              {activeConnected.map((acc, index) => {
                const p = getPlatformConfig(acc.platform);
                return (
                  <div key={index} className="conn">
                    <div className="ci" style={{ background: p.color }}>{p.icon}</div>
                    <div className="conn-info">
                      <div className="cn" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        {acc.account_name} 
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--grn)', boxShadow: '0 0 6px var(--grn)' }} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 4 }}>
                        <span className="pill" style={{ background: `${p.color}22`, color: p.color, fontSize: 8 }}>{p.label}</span>
                        <span className="cs" style={{ margin: 0 }}>{acc.brand_name}</span>
                      </div>
                      <div className="cs mono" style={{ marginTop: 4 }}>
                        ID: {acc.platform === 'facebook' ? acc.facebook_page_id
                           : acc.platform === 'youtube' ? acc.account_id
                           : acc.platform === 'linkedin' ? acc.account_id
                           : acc.instagram_business_id}
                      </div>
                    </div>
                    <button className="conn-btn linked">● Active</button>
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
