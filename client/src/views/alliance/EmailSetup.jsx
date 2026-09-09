import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../services/api.js';
import './alliance.css';

export const EmailSetup = () => {
  const [config, setConfig] = useState(null);
  const [senders, setSenders] = useState([]);
  const [form, setForm] = useState({ warmup_stage: 1, daily_cap: 20, status: 'inactive' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getAllianceEmailSettings();
      setConfig(data.config);
      setSenders(data.senders || []);
      const sender = data.senders?.find((item) => item.inbox_email === data.config?.from);
      if (sender) setForm({ warmup_stage: sender.warmup_stage, daily_cap: sender.daily_cap, status: sender.status });
    } catch (error) {
      toast.error(error.message || 'Failed to load email setup');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const verify = async () => {
    setBusy('verify');
    try {
      const result = await api.verifyAllianceEmailSettings();
      toast.success(result.message);
    } catch (error) {
      toast.error(error.message || 'SMTP verification failed');
    } finally {
      setBusy('');
    }
  };

  const save = async () => {
    setBusy('save');
    try {
      await api.saveAllianceEmailSettings(form);
      toast.success('Alliance email sender saved');
      await load();
    } catch (error) {
      toast.error(error.message || 'Failed to save sender');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="al-wrap">
      <div className="al-eyebrow">AllianceOS · Email Infrastructure</div>
      <div className="al-page-title">Cold email sender</div>
      <p className="al-page-desc">Zoho credentials stay in the server environment. This page controls operational limits and verifies SMTP without exposing the password.</p>

      {loading ? <p style={{ color: 'var(--al-muted)' }}>Loading email configuration…</p> : (
        <>
          <div style={{ background: 'var(--al-panel2)', border: '1px solid var(--al-line)', borderRadius: 12, padding: 20 }}>
            <div className="al-fields">
              <div className="al-field"><label>Sender</label><input value={config?.from || ''} readOnly /></div>
              <div className="al-field"><label>Display name</label><input value={config?.from_name || ''} readOnly /></div>
            </div>
            <div className="al-fields">
              <div className="al-field"><label>Provider</label><input value={config?.provider || ''} readOnly /></div>
              <div className="al-field"><label>SMTP server</label><input value={`${config?.host || ''}:${config?.port || ''}`} readOnly /></div>
              <div className="al-field"><label>Credential</label><input value={config?.password_configured ? 'Configured securely' : 'Missing'} readOnly /></div>
            </div>
            <div className="al-fields">
              <div className="al-field"><label>Warm-up stage</label><select value={form.warmup_stage} onChange={(e) => setForm({ ...form, warmup_stage: Number(e.target.value) })}>{[1, 2, 3, 4].map((stage) => <option key={stage} value={stage}>Week {stage}</option>)}</select></div>
              <div className="al-field"><label>Daily limit</label><input type="number" min="1" max="50" value={form.daily_cap} onChange={(e) => setForm({ ...form, daily_cap: Number(e.target.value) })} /></div>
              <div className="al-field"><label>Status</label><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="inactive">Inactive</option><option value="active">Active</option><option value="paused">Paused</option></select></div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button className="al-btn ghost" disabled={busy === 'verify' || !config?.password_configured} onClick={verify}>{busy === 'verify' ? 'Checking…' : 'Verify Zoho connection'}</button>
              <button className="al-btn" disabled={Boolean(busy) || !config?.password_configured} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save sender'}</button>
            </div>
          </div>

          <div className="al-note" style={{ marginTop: 18 }}><span>!</span><div><b>Activation does not start a campaign.</b> Campaign Planner performs readiness checks before scheduling email touches.</div></div>

          <div className="al-page-title" style={{ fontSize: 20, marginTop: 24 }}>Registered senders</div>
          <div style={{ background: 'var(--al-panel2)', border: '1px solid var(--al-line)', borderRadius: 12, overflow: 'hidden', marginTop: 12 }}>
            <table className="al-table"><thead><tr><th>Inbox</th><th>Provider</th><th>Warm-up</th><th>Today</th><th>Reputation</th><th>Status</th></tr></thead>
              <tbody>{senders.map((sender) => <tr key={sender.id}><td>{sender.inbox_email}</td><td>{sender.provider}</td><td>Week {sender.warmup_stage}</td><td>{sender.sent_today} / {sender.daily_cap}</td><td>{sender.reputation}</td><td>{sender.status}</td></tr>)}{!senders.length && <tr><td colSpan="6" style={{ textAlign: 'center', padding: 24, color: 'var(--al-muted)' }}>Save the configured sender to register it.</td></tr>}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
