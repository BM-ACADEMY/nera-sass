import { useState, useEffect } from 'react';
import { Brain, CheckCircle } from 'lucide-react';
import { C } from '../constants/theme.js';
import { api } from '../services/api.js';
import { useAuth } from '../hooks/useAuth.js';

export const SettingsView = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState('account');
  const [clients, setClients] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState(null);

  const [phoneId, setPhoneId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [waBizId, setWaBizId] = useState('');
  const [waNumber, setWaNumber] = useState('');
  const [status, setStatus] = useState('active');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [saving, setSaving] = useState(false);
  const [savingPass, setSavingPass] = useState(false);

  useEffect(() => {
    const loadClients = async () => {
      try {
        const res = await api.getClients();
        setClients(res.clients || []);
        if (res.clients && res.clients.length > 0) {
          setSelectedClientId(res.clients[0].id);
        }
      } catch (err) {
        console.error('Error loading clients in settings:', err);
      }
    };
    loadClients();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      window.location.href = `/admin/content-os/social-connection?code=${code}&via=settings`;
    }
  }, []);
  useEffect(() => {
    if (!selectedClientId) return;
    const client = clients.find(c => c.id === selectedClientId);
    if (client) {
      setPhoneId(client.phone_number_id || '');
      setAccessToken(client.wa_access_token || '');
      setWaBizId(client.wa_business_id || '');
      setWaNumber(client.whatsapp_number || '');
      setStatus(client.status || 'active');
    }
  }, [selectedClientId, clients]);

  const handleSaveWhatsApp = async (e) => {
    e.preventDefault();
    if (!selectedClientId) return;
    setSaving(true);
    try {
      await api.updateClient(selectedClientId, {
        phone_number_id: phoneId,
        wa_access_token: accessToken,
        wa_business_id: waBizId,
        whatsapp_number: waNumber,
        status: status
      });
      alert('WhatsApp Business API configuration saved successfully!');
      const res = await api.getClients();
      setClients(res.clients || []);
    } catch (err) {
      alert('Failed to save connection details: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSavePassword = async (e) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) {
      alert('Please fill out both current and new password fields');
      return;
    }
    setSavingPass(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      alert('Password updated successfully!');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      alert('Failed to update password: ' + err.message);
    } finally {
      setSavingPass(false);
    }
  };

  return (
    <div className="p-mobile" style={{ padding: 26, overflowY: 'auto', height: '100%' }}>
      <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: 21, fontWeight: 800, color: C.text, marginBottom: 22 }}>Settings</h1>
      <div className="flex-col-mobile" style={{ display: 'flex', gap: 18 }}>
        <div className="w-full-mobile" style={{ width: 180 }}>
          {[['account', 'Account'], ['whatsapp', 'WhatsApp API'], ['team', 'Team'], ['notifications', 'Alerts'], ['billing', 'Billing']].map(([k, l]) => (
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

          {(tab === 'team' || tab === 'billing') && (
            <div style={{ textAlign: 'center', padding: 36, color: C.muted }}>
              <Brain size={28} color={C.muted} style={{ margin: '0 auto 11px' }} />
              <p>Available in full deployment</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
