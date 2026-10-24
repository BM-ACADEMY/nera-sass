import { useState, useEffect, useCallback } from 'react';
import { C } from '../constants/theme.js';
import { api } from '../services/api.js';
import { settingsTabs, settingsLoadState } from './settings/settingsPolicy.js';
import { syncCurrentUser } from '../hooks/useAuth.js';
import { NOTICE_KEY, NOTICES, USER_KEY } from '../services/session.js';
import { WorkspaceTab } from './settings/WorkspaceTab.jsx';
import { BrandProfileTab } from './settings/BrandProfileTab.jsx';
import { WhatsAppTab } from './settings/WhatsAppTab.jsx';
import { AccountTab } from './settings/AccountTab.jsx';
import { Notice } from './settings/ui.jsx';

// Customer Settings. Everything is read from the signed-in user's own
// workspace (the server decides which one from the session); what can be
// edited follows the permission flags in GET /api/tenant, and the server
// checks every change again.
export const SettingsView = () => {
  const [tab, setTab] = useState('workspace');
  const [tenantInfo, setTenantInfo] = useState(null);
  const [brand, setBrand] = useState(null);
  const [me, setMe] = useState(null);
  const [signupConfig, setSignupConfig] = useState(null);
  const [loaded, setLoaded] = useState(false); // at least one complete load
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0); // remounts the tab forms after each load
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.getTenant(),
      api.getClients(),
      api.getMe(),
      api.getMetaEmbeddedSignupConfig().catch(() => ({ enabled: false })),
    ]).then(([tenant, clients, profile, signup]) => {
      if (!active) return;
      setTenantInfo(tenant);
      setBrand(clients.clients?.[0] || null);
      setMe(profile);
      setSignupConfig(signup);
      setError('');
      setLoaded(true);
      setVersion((v) => v + 1);
      syncCurrentUser(profile); // header and sidebar show the current name and role
    }).catch((err) => {
      if (active) setError(err.message || 'Could not load settings');
    });
    return () => { active = false; };
  }, [reloadKey]);

  const view = settingsLoadState({ loaded, error });
  const tabs = settingsTabs();
  const activeTab = tabs.some((t) => t.key === tab) ? tab : 'workspace';

  // Every session was revoked by the server, including this one.
  const signedOutEverywhere = () => {
    localStorage.removeItem(USER_KEY);
    sessionStorage.setItem(NOTICE_KEY, NOTICES.signedOutEverywhere);
    window.location.href = '/login';
  };

  return (
    <div className="p-mobile" style={{ padding: 26, overflowY: 'auto', height: '100%' }}>
      <h1 style={{ fontFamily: "'Inter',sans-serif", fontSize: 21, fontWeight: 800, color: C.text, marginBottom: 22 }}>Settings</h1>
      {view === 'loading' && <p style={{ fontSize: 12, color: C.muted }}>Loading…</p>}
      {view === 'error' && (
        // Nothing loaded: show the problem and a retry, never empty tabs.
        <Notice tone="error">
          Settings could not be loaded: {error}{' '}
          <button type="button" onClick={load} style={{ background: 'none', border: 'none', color: C.accent, fontWeight: 700, cursor: 'pointer', padding: 0 }}>Retry</button>
        </Notice>
      )}
      {view === 'ready-with-error' && <Notice tone="error">Could not refresh settings: {error}. Showing the last loaded values.</Notice>}
      {(view === 'ready' || view === 'ready-with-error') && (
        <div className="flex-col-mobile" style={{ display: 'flex', gap: 18 }}>
          <div className="w-full-mobile" style={{ width: 180 }}>
            {tabs.map(({ key, label }) => (
              <button key={key} type="button" onClick={() => setTab(key)} style={{ width: '100%', textAlign: 'left', padding: '9px 13px', borderRadius: 7, border: 'none', background: activeTab === key ? C.accent + '20' : 'transparent', color: activeTab === key ? C.accent : C.muted, fontSize: 12, fontWeight: activeTab === key ? 600 : 400, marginBottom: 1, cursor: 'pointer' }}>
                {activeTab === key && <span style={{ marginRight: 5 }}>›</span>}{label}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, background: C.card, border: '1px solid ' + C.border, borderRadius: 13, padding: 22, minWidth: 0 }}>
            {activeTab === 'workspace' && <WorkspaceTab key={version} tenantInfo={tenantInfo} onSaved={load} />}
            {activeTab === 'brand' && <BrandProfileTab key={version} brand={brand} tenantInfo={tenantInfo} onSaved={load} />}
            {activeTab === 'whatsapp' && <WhatsAppTab brand={brand} tenantInfo={tenantInfo} signupConfig={signupConfig} />}
            {activeTab === 'account' && <AccountTab me={me} onChanged={load} onSignedOutEverywhere={signedOutEverywhere} />}
          </div>
        </div>
      )}
    </div>
  );
};
