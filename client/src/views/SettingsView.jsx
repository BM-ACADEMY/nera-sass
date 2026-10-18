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
import { BillingTab } from './settings/BillingTab.jsx';
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
  const tabs = settingsTabs({ role: me?.role });
  const activeTab = tabs.some((t) => t.key === tab) ? tab : 'workspace';

  // Every session was revoked by the server, including this one.
  const signedOutEverywhere = () => {
    localStorage.removeItem(USER_KEY);
    sessionStorage.setItem(NOTICE_KEY, NOTICES.signedOutEverywhere);
    window.location.href = '/login';
  };

  return (
    <div className="p-mobile" style={{ padding: 26, overflowY: 'auto', height: '100%' }}>
      <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: 21, fontWeight: 800, color: C.text, marginBottom: 22 }}>Settings</h1>
<<<<<<< HEAD
      <div className="flex-col-mobile" style={{ display: 'flex', gap: 18 }}>
        <div className="w-full-mobile" style={{ width: 180 }}>
          {[['account', 'Account'], ['whatsapp', 'WhatsApp API'], ['notifications', 'Alerts'], ['billing', 'Billing']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ width: '100%', textAlign: 'left', padding: '9px 13px', borderRadius: 7, border: 'none', background: tab === k ? C.accent + '20' : 'transparent', color: tab === k ? C.accent : C.muted, fontSize: 12, fontWeight: tab === k ? 600 : 400, marginBottom: 1, cursor: 'pointer' }}>
              {tab === k && <span style={{ marginRight: 5 }}>›</span>}{l}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, background: C.card, border: '1px solid ' + C.border, borderRadius: 13, padding: 22 }}>
          {tab === 'account' && (
            <form onSubmit={handleSavePassword}>
              <h3 style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 18 }}>Account & Password Settings</h3>
              {[['Business Name', user?.brand_name || 'Your Brand'], ['Portal Name', 'LeadOS by BM TechX'], ['Admin Email', user?.email || 'admin@example.com'], ['Contact', user?.phone || 'N/A'], ['Website', user?.website || 'N/A']].map(([l, v]) => (
                <div key={l} style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 9, color: C.muted, marginBottom: 5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>{l}</label>
                  <input readOnly defaultValue={v} style={{ width: '100%', background: C.surface, border: '1px solid ' + C.border, borderRadius: 7, color: C.dim, padding: '9px 11px', fontSize: 12, outline: 'none' }} />
                </div>
              ))}

              <div style={{ height: 1, background: C.border, margin: '20px 0' }} />
              <h4 style={{ fontFamily: "'Syne',sans-serif", fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 14 }}>Change Password</h4>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 9, color: C.muted, marginBottom: 5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Current Password</label>
                <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="••••••••" style={{ width: '100%', background: C.surface, border: '1px solid ' + C.border, borderRadius: 7, color: C.text, padding: '9px 11px', fontSize: 12, outline: 'none' }} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 9, color: C.muted, marginBottom: 5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>New Password</label>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Min 6 characters" style={{ width: '100%', background: C.surface, border: '1px solid ' + C.border, borderRadius: 7, color: C.text, padding: '9px 11px', fontSize: 12, outline: 'none' }} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18, paddingTop: 18, borderTop: '1px solid ' + C.border }}>
                <button type="submit" disabled={savingPass} style={{ background: C.accent, border: 'none', borderRadius: 7, color: '#fff', padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: savingPass ? 0.6 : 1 }}>
                  {savingPass ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          )}

          {tab === 'whatsapp' && (
            <form onSubmit={handleSaveWhatsApp}>
              <h3 style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>WhatsApp API Connection</h3>

              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'block', fontSize: 9, color: C.muted, marginBottom: 5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Select Brand</label>
                <select value={selectedClientId || ''} onChange={(e) => setSelectedClientId(parseInt(e.target.value))} style={{ width: '100%', background: C.surface, border: '1px solid ' + C.border, borderRadius: 7, color: C.text, padding: '9px 11px', fontSize: 12, outline: 'none' }}>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div style={{ background: '#0a2018', border: '1px solid #16523a', borderRadius: 9, padding: 13, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 9 }}>
                <CheckCircle size={13} color={C.green} />
                <p style={{ fontSize: 12, color: C.green }}>Active postgres-synced connection settings for {clients.find(c => c.id === selectedClientId)?.name || 'Brand'}</p>
              </div>

              {[
                ['Phone Number ID', phoneId, setPhoneId, 'Meta Developer Phone ID'],
                ['Access Token', accessToken, setAccessToken, 'EAAB...'],
                ['WhatsApp Business Account ID', waBizId, setWaBizId, 'Meta WA Business Account ID'],
                ['WhatsApp Number', waNumber, setWaNumber, '+91...'],
              ].map(([label, val, setter, placeholder]) => (
                <div key={label} style={{ marginBottom: 13 }}>
                  <label style={{ display: 'block', fontSize: 9, color: C.muted, marginBottom: 5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</label>
                  <input value={val} onChange={(e) => setter(e.target.value)} placeholder={placeholder} style={{ width: '100%', background: C.surface, border: '1px solid ' + C.border, borderRadius: 7, color: C.text, padding: '8px 11px', fontSize: 11, outline: 'none', fontFamily: 'monospace' }} />
                </div>
              ))}

              <div style={{ marginBottom: 13 }}>
                <label style={{ display: 'block', fontSize: 9, color: C.muted, marginBottom: 5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Connection Status</label>
                <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: '100%', background: C.surface, border: '1px solid ' + C.border, borderRadius: 7, color: C.text, padding: '9px 11px', fontSize: 12, outline: 'none' }}>
                  <option value="active">Active (Forward incoming WhatsApp messages to AI Brain)</option>
                  <option value="inactive">Inactive (Pause AI auto-responders)</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18, paddingTop: 18, borderTop: '1px solid ' + C.border }}>
                <button type="submit" disabled={saving} style={{ background: C.accent, border: 'none', borderRadius: 7, color: '#fff', padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                  {saving ? 'Saving...' : 'Save Connection'}
                </button>
              </div>
            </form>
          )}



          {tab === 'notifications' && (
            <div>
              <h3 style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 18 }}>Alert Settings</h3>
              {[
                ['Hot lead detected', 'Send WhatsApp alert to assigned team', true],
                ['Payment received', 'Notify admin and team member', true],
                ['Daily summary report', 'Sent at 9 PM every day', true],
                ['AI agent failure', 'Immediate alert', false]
              ].map(([l, d, on]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 0', borderBottom: '1px solid ' + C.border }}>
                  <div><p style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{l}</p><p style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{d}</p></div>
                  <div style={{ width: 38, height: 20, borderRadius: 10, background: on ? C.accent : C.border, position: 'relative', cursor: 'pointer' }}>
                    <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: on ? 20 : 2, transition: 'left 0.15s' }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'billing' && (
            <div style={{ textAlign: 'center', padding: 36, color: C.muted }}>
              <Brain size={28} color={C.muted} style={{ margin: '0 auto 11px' }} />
              <p>Available in full deployment</p>
            </div>
          )}
        </div>
      </div>
=======
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
            {activeTab === 'billing' && <BillingTab tenantInfo={tenantInfo} />}
          </div>
        </div>
      )}
>>>>>>> origin/aakash
    </div>
  );
};
