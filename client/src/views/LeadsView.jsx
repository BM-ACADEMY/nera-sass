import { useState, useEffect, useRef } from 'react';
import { Search, Upload, Download, Plus, Eye, Phone, Trash, FileSpreadsheet, X, CreditCard, Copy, CheckCheck, RefreshCw, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { C } from '../constants/theme.js';
import { Badge, ScoreBar } from '../components/ui.jsx';
import { useLeads } from '../hooks/useLeads.js';
import { api, allianceInboxApi } from '../services/api.js';



const inp = {
  width: '100%', background: '#0d1117', border: '1px solid #2a2a3a',
  borderRadius: 8, color: '#e2e8f0', fontSize: 13, padding: '9px 12px',
  outline: 'none', boxSizing: 'border-box', transition: 'border-color .2s',
};

const SOURCE_FILTERS = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'website', label: 'Website' },
  { value: 'xls_sheet', label: 'XLS Sheet' },
];

function AddLeadModal({ open, onClose, onSaved, clients, users }) {
  const [form, setForm] = useState({ name: '', phone: '', source: '', interest: '', assigned_to: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm({ name: '', phone: '', source: '', interest: '', assigned_to: '' });
  }, [open]);

  if (!open) return null;

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Name is required');
    if (!form.phone.trim()) return toast.error('Phone is required');
    setSaving(true);
    try {
      await api.createLead({
        name: form.name.trim(),
        phone: form.phone.trim(),
        source: form.source || 'Manual',
        interest: form.interest.trim() || null,
        assigned_to: form.assigned_to || null,
      });
      toast.success('Lead added successfully!');
      onSaved();
      onClose();
    } catch (err) {
      toast.error('Failed to add lead: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const labelStyle = { fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 5, display: 'block', letterSpacing: 0.4 };
  const fieldStyle = { marginBottom: 16 };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'linear-gradient(145deg,#13151f,#0d0f18)',
          border: '1px solid #2a2a3a', borderRadius: 16, padding: 28, width: '100%', maxWidth: 480,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          animation: 'slideUp .22s ease',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Add New Lead</h2>
            <p style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>Fill in the details to create a lead</p>
          </div>
          <button
            onClick={onClose}
            style={{ background: '#1e2030', border: '1px solid #2a2a3a', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <X size={14} color="#94a3b8" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Row: Name + Phone */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Full Name <span style={{ color: '#f87171' }}>*</span></label>
              <input
                style={inp}
                placeholder="e.g. Rahul Sharma"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                onFocus={e => e.target.style.borderColor = C.accent}
                onBlur={e => e.target.style.borderColor = '#2a2a3a'}
                required
              />
            </div>
            <div>
              <label style={labelStyle}>Phone <span style={{ color: '#f87171' }}>*</span></label>
              <input
                style={inp}
                placeholder="e.g. 9876543210"
                value={form.phone}
                onChange={e => set('phone', e.target.value)}
                onFocus={e => e.target.style.borderColor = C.accent}
                onBlur={e => e.target.style.borderColor = '#2a2a3a'}
                required
              />
            </div>
          </div>

          {/* Interest */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Interest / Course</label>
            <input
              style={inp}
              placeholder="e.g. Web Development, MBA, Digital Marketing"
              value={form.interest}
              onChange={e => set('interest', e.target.value)}
              onFocus={e => e.target.style.borderColor = C.accent}
              onBlur={e => e.target.style.borderColor = '#2a2a3a'}
            />
          </div>

          {/* Row: Source + Brand */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Source</label>
              <select
                style={{ ...inp, cursor: 'pointer' }}
                value={form.source}
                onChange={e => set('source', e.target.value)}
                onFocus={e => e.target.style.borderColor = C.accent}
                onBlur={e => e.target.style.borderColor = '#2a2a3a'}
              >
                <option value="">— Select Source —</option>
                {SOURCE_FILTERS.map(source => <option key={source.value} value={source.value}>{source.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>LeadOS Brand (locked)</label>
              <select
                style={{ ...inp, cursor: 'pointer' }}
                value={clients.find(c => c.name?.replace(/[^a-z0-9]/gi, '').toLowerCase() === 'abmgroups')?.id || ''}
                disabled
                onFocus={e => e.target.style.borderColor = C.accent}
                onBlur={e => e.target.style.borderColor = '#2a2a3a'}
              >
                <option value="">— None —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          {/* Assigned To */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Assign To</label>
            <select
              style={{ ...inp, cursor: 'pointer' }}
              value={form.assigned_to}
              onChange={e => set('assigned_to', e.target.value)}
              onFocus={e => e.target.style.borderColor = C.accent}
              onBlur={e => e.target.style.borderColor = '#2a2a3a'}
            >
              <option value="">— Unassigned —</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
            </select>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button
              type="button"
              onClick={onClose}
              style={{ flex: 1, background: '#1e2030', border: '1px solid #2a2a3a', color: '#94a3b8', padding: '10px', borderRadius: 9, fontSize: 13, cursor: 'pointer', fontWeight: 500 }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                flex: 2, background: saving ? '#3a3a50' : `linear-gradient(135deg, ${C.accent}, #c2410c)`,
                border: 'none', color: '#fff', padding: '10px', borderRadius: 9, fontSize: 13,
                fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', display: 'flex',
                alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'opacity .2s',
              }}
            >
              <Plus size={14} />{saving ? 'Saving...' : 'Add Lead'}
            </button>
          </div>
        </form>
      </div>

      <style>{`@keyframes slideUp { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:translateY(0); } }`}</style>
    </div>
  );
}

// ─── Payment Link Modal ───────────────────────────────────────
function PaymentLinkModal({ lead, onClose }) {
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedLink, setGeneratedLink] = useState('');
  const [copied, setCopied] = useState(false);

  if (!lead) return null;

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) return toast.error('Enter a valid amount');
    setGenerating(true);
    try {
      const res = await api.createPaymentLink(lead.id, parseFloat(amount), desc || 'Service Fee');
      const link = res.payment_link || res.link;
      if (link) {
        setGeneratedLink(link);
        toast.success('Payment link generated!');
      } else {
        throw new Error('No link returned');
      }
    } catch (err) {
      toast.error('Failed to generate link: ' + err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedLink);
    setCopied(true);
    toast.success('Copied to clipboard!');
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', zIndex: 2000, padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'linear-gradient(145deg,#13151f,#0d0f18)',
          border: '1px solid #2a2a3a', borderRadius: 18, padding: 28,
          width: '100%', maxWidth: 440,
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
          animation: 'slideUp .22s ease',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CreditCard size={16} color="#f97316" />
            </div>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Generate Payment Link</h3>
              <p style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>For: <strong style={{ color: '#94a3b8' }}>{lead.name}</strong></p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: '#1e2030', border: '1px solid #2a2a3a', borderRadius: 8, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <X size={13} color="#94a3b8" />
          </button>
        </div>

        {generatedLink ? (
          <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 12, padding: 16 }}>
            <p style={{ fontSize: 11, color: '#4ade80', fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
              <CheckCheck size={13} /> Link ready — share with {lead.name}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                readOnly
                value={generatedLink}
                style={{ flex: 1, background: '#0d1117', border: '1px solid #2a2a3a', color: '#e2e8f0', padding: '8px 10px', borderRadius: 8, fontSize: 11, outline: 'none' }}
              />
              <button
                onClick={handleCopy}
                style={{ background: copied ? 'rgba(34,197,94,0.15)' : 'rgba(249,115,22,0.12)', border: `1px solid ${copied ? 'rgba(34,197,94,0.4)' : 'rgba(249,115,22,0.3)'}`, color: copied ? '#4ade80' : '#f97316', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}
              >
                {copied ? <CheckCheck size={12} /> : <Copy size={12} />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
              <button onClick={() => window.open(generatedLink, '_blank')} style={{ background: 'transparent', border: 'none', color: '#64748b', fontSize: 10, cursor: 'pointer', textDecoration: 'underline' }}>Open link ↗</button>
              <button onClick={() => { setGeneratedLink(''); setAmount(''); setDesc(''); }} style={{ background: 'transparent', border: 'none', color: '#f97316', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>+ Generate New</button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleGenerate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 10, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 }}>Amount (₹) *</label>
                <input
                  type="number" min="1" step="0.01" required
                  placeholder="e.g. 4999"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  style={{ width: '100%', background: '#0d1117', border: '1px solid #2a2a3a', borderRadius: 8, color: '#e2e8f0', fontSize: 13, padding: '9px 12px', outline: 'none', boxSizing: 'border-box' }}
                  onFocus={e => e.target.style.borderColor = '#f97316'}
                  onBlur={e => e.target.style.borderColor = '#2a2a3a'}
                />
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 }}>Description</label>
                <input
                  type="text"
                  placeholder="e.g. Admission Fee, Course Payment"
                  value={desc}
                  onChange={e => setDesc(e.target.value)}
                  style={{ width: '100%', background: '#0d1117', border: '1px solid #2a2a3a', borderRadius: 8, color: '#e2e8f0', fontSize: 13, padding: '9px 12px', outline: 'none', boxSizing: 'border-box' }}
                  onFocus={e => e.target.style.borderColor = '#f97316'}
                  onBlur={e => e.target.style.borderColor = '#2a2a3a'}
                />
              </div>
            </div>
            <div style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.15)', borderRadius: 9, padding: '9px 12px', fontSize: 10, color: '#94a3b8' }}>
              📱 Link will be pre-filled with <strong style={{ color: '#e2e8f0' }}>{lead.name}</strong>'s phone (<strong style={{ color: '#e2e8f0' }}>{lead.phone}</strong>) and linked to lead ID <strong style={{ color: '#f97316' }}>#{lead.id}</strong>. WF04 triggers automatically on payment.
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button type="button" onClick={onClose} style={{ flex: 1, background: '#1e2030', border: '1px solid #2a2a3a', color: '#94a3b8', padding: '10px', borderRadius: 9, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              <button
                type="submit" disabled={generating}
                style={{ flex: 2, background: generating ? '#3a3a50' : 'linear-gradient(135deg,#f97316,#c2410c)', border: 'none', color: '#fff', padding: '10px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: generating ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <CreditCard size={13} />{generating ? 'Generating...' : 'Create Payment Link'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Meta Details Modal ──────────────────────────────────────────────────────────
function MetaLeadDetailsModal({ lead, onClose }) {
  if (!lead) return null;

  return (
    <div onClick={onClose} style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.card, padding: 24, borderRadius: 12, width: 440, maxWidth: '100%', border: '1px solid ' + C.border, boxShadow: '0 8px 32px rgba(0,0,0,0.2)', position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'transparent', border: 'none', cursor: 'pointer' }}><X size={18} color={C.muted} /></button>
        <h3 style={{ margin: '0 0 16px 0', fontSize: 18, fontWeight: 600, color: C.text }}>Campaign Details</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid ' + C.border }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Source Platform</div>
            <div style={{ fontSize: 14, color: C.text, fontWeight: 500, textTransform: 'capitalize' }}>{lead.source}</div>
          </div>

          <div style={{ padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid ' + C.border }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Campaign Name</div>
            <div style={{ fontSize: 14, color: C.text, fontWeight: 500 }}>{lead.campaign_name || 'N/A'}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>ID: {lead.campaign_id || 'N/A'}</div>
          </div>

          <div style={{ padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid ' + C.border }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Ad Name</div>
            <div style={{ fontSize: 14, color: C.text, fontWeight: 500 }}>{lead.ad_name || 'N/A'}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>ID: {lead.ad_id || 'N/A'}</div>
          </div>

          <div style={{ padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid ' + C.border }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Form ID</div>
            <div style={{ fontSize: 14, color: C.text, fontWeight: 500 }}>{lead.lead_ad_form_id || 'N/A'}</div>
          </div>

          <div style={{ padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid ' + C.border }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Meta Lead ID</div>
            <div style={{ fontSize: 14, color: C.text, fontWeight: 500 }}>{lead.meta_lead_id || 'N/A'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExportLeadsModal({ open, onClose, onExport, exporting, exportProgress }) {
  const [mode, setMode] = useState('all');
  const [source, setSource] = useState('facebook');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedCount, setSelectedCount] = useState(null);
  const [counting, setCounting] = useState(false);

  useEffect(() => {
    if (open) {
      setMode('all');
      setSource('facebook');
      setFrom('');
      setTo('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    if (mode === 'date' && (!from || !to || new Date(from) > new Date(to))) {
      setSelectedCount(null);
      setCounting(false);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setCounting(true);
      try {
        const filters = { limit: 1, offset: 0 };
        if (mode === 'source') filters.source = source;
        if (mode === 'date') {
          filters.from = new Date(from).toISOString();
          filters.to = new Date(to).toISOString();
        }
        const data = await api.getLeads(filters);
        if (!cancelled) setSelectedCount(data.total || 0);
      } catch {
        if (!cancelled) setSelectedCount(null);
      } finally {
        if (!cancelled) setCounting(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, mode, source, from, to]);

  if (!open) return null;

  const optionStyle = (active) => ({
    padding: 12, borderRadius: 9, cursor: 'pointer', display: 'flex', gap: 9, alignItems: 'center',
    background: active ? `${C.accent}18` : C.surface,
    border: `1px solid ${active ? C.accent : C.border}`, color: active ? C.text : C.muted,
  });

  const submit = (e) => {
    e.preventDefault();
    if (mode === 'date' && (!from || !to)) return toast.error('Select both From and To date/time');
    if (mode === 'date' && new Date(from) > new Date(to)) return toast.error('From date must be before To date');
    onExport({ mode, source, from, to });
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.68)', backdropFilter: 'blur(4px)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: C.card, border: `1px solid ${C.border}`, borderRadius: 15, padding: 24, boxShadow: '0 24px 64px rgba(0,0,0,.6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div><h2 style={{ margin: 0, color: C.text, fontSize: 17 }}>Export Leads</h2><p style={{ margin: '3px 0 0', color: C.muted, fontSize: 11 }}>Choose which records to download</p></div>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 0, cursor: 'pointer' }}><X size={17} color={C.muted} /></button>
        </div>
        <div style={{ display: 'grid', gap: 9 }}>
          <label style={optionStyle(mode === 'all')}><input type="radio" name="exportMode" checked={mode === 'all'} onChange={() => setMode('all')} /> <span><strong>Export All</strong><small style={{ display: 'block', marginTop: 2 }}>Every lead across all pages</small></span></label>
          <label style={optionStyle(mode === 'source')}><input type="radio" name="exportMode" checked={mode === 'source'} onChange={() => setMode('source')} /> <span><strong>Export by Source</strong><small style={{ display: 'block', marginTop: 2 }}>Only leads from one selected source</small></span></label>
          {mode === 'source' && <select value={source} onChange={e => setSource(e.target.value)} style={{ ...inp, marginTop: -3 }}>
            {SOURCE_FILTERS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>}
          <label style={optionStyle(mode === 'date')}><input type="radio" name="exportMode" checked={mode === 'date'} onChange={() => setMode('date')} /> <span><strong>Export by Custom Date Range</strong><small style={{ display: 'block', marginTop: 2 }}>Leads created within a date/time period</small></span></label>
          {mode === 'date' && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ color: C.muted, fontSize: 11 }}>From<input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} style={{ ...inp, marginTop: 5 }} /></label>
            <label style={{ color: C.muted, fontSize: 11 }}>To<input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} style={{ ...inp, marginTop: 5 }} /></label>
          </div>}
        </div>
        <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 8, background: `${C.accent}10`, border: `1px solid ${C.accent}35`, color: C.text, fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: C.muted }}>{exporting ? 'Export progress' : 'Selected leads'}</span>
          <strong style={{ color: C.accent, fontSize: 15 }}>{exporting
            ? `${(exportProgress.processed || 0).toLocaleString()} / ${(exportProgress.total || selectedCount || 0).toLocaleString()} (${exportProgress.percent || 0}%)`
            : counting ? 'Counting...' : selectedCount === null ? '—' : selectedCount.toLocaleString()}</strong>
        </div>
        {exporting && <div style={{ height: 5, marginTop: 7, background: C.surface, borderRadius: 5, overflow: 'hidden' }}><div style={{ width: `${exportProgress.percent || 0}%`, height: '100%', background: C.accent, transition: 'width .3s' }} /></div>}
        <div style={{ display: 'flex', gap: 9, marginTop: 20 }}>
          <button type="button" onClick={onClose} style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: 10, cursor: 'pointer' }}>{exporting ? 'Close' : 'Cancel'}</button>
          <button type="submit" disabled={exporting} style={{ flex: 2, background: C.accent, border: 0, color: '#fff', borderRadius: 8, padding: 10, fontWeight: 700, cursor: exporting ? 'wait' : 'pointer', opacity: exporting ? .7 : 1 }}>{exporting ? 'Preparing export...' : 'Download CSV'}</button>
        </div>
      </form>
    </div>
  );
}

// ─── Main View ─────────────────────────────────────────────
export const LeadsView = ({ onLeadClick, refreshTrigger }) => {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [adFilter, setAdFilter] = useState('');
  const [metaPageFilter, setMetaPageFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [availableTags, setAvailableTags] = useState([]);
  const [facebookFilterOptions, setFacebookFilterOptions] = useState([]);
  const [metaPageOptions, setMetaPageOptions] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [syncingFB, setSyncingFB] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState({ processed: 0, total: 0, percent: 0 });
  const itemsPerPage = 10;

  const { leads: apiLeads, total, loading, error, refetch } = useLeads({
    status: filter !== 'all' ? filter : undefined,
    search,
    source: sourceFilter !== 'all' ? sourceFilter : undefined,
    campaignName: campaignFilter || undefined,
    adName: adFilter || undefined,
    metaPageId: metaPageFilter || undefined,
    tagId: tagFilter || undefined,
    limit: itemsPerPage,
    offset: (currentPage - 1) * itemsPerPage
  });

  useEffect(() => {
    if (refetch) refetch();
  }, [refreshTrigger]);

  const tabs = ['all', 'new', 'hot', 'warm', 'cold', 'converted'];
  // Deduplicate by id (safeguard against API returning duplicate rows)
  const leads = Array.from(new Map((apiLeads || []).map(l => [l.id, l])).values());
  const filtered = leads;
  const paginatedLeads = leads;

  useEffect(() => {
    setCurrentPage(1);
  }, [filter, search, sourceFilter, campaignFilter, adFilter, metaPageFilter, tagFilter]);

  const totalPages = Math.ceil((total || 0) / itemsPerPage);

  const fileInputRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [paymentLead, setPaymentLead] = useState(null);
  const [metaLeadDetails, setMetaLeadDetails] = useState(null);
  const [modalClients, setModalClients] = useState([]);
  const [modalUsers, setModalUsers] = useState([]);

  useEffect(() => {
    api.getClients().then(d => setModalClients(Array.from(new Map((d.clients || []).map(c => [c.id, c])).values()))).catch(() => { });
    api.getUsers().then(d => setModalUsers(Array.from(new Map((d.users || []).map(u => [u.id, u])).values()))).catch(() => { });
    api.get('/leads/facebook-filter-options').then(d => {
      setFacebookFilterOptions(d.options || []);
      setMetaPageOptions(d.pages || []);
    }).catch(() => { });
    allianceInboxApi.getTags().then(setAvailableTags).catch(console.error);
  }, []);

  const campaignNames = [...new Set(facebookFilterOptions.map(option => option.campaign_name).filter(Boolean))];
  const adNames = [...new Set(facebookFilterOptions
    .filter(option => !campaignFilter || option.campaign_name === campaignFilter)
    .map(option => option.ad_name)
    .filter(Boolean))];

  const handleExport = async ({ mode, source, from, to }) => {
    setExporting(true);
    setExportProgress({ processed: 0, total: 0, percent: 0 });
    try {
      const job = await api.createLeadExport({ mode, source, from, to });
      if (!job.total_records) throw new Error('No leads found for this export.');
      setExportProgress({ processed: 0, total: job.total_records, percent: 0 });
      toast.success(`Export scheduled for ${Number(job.total_records).toLocaleString()} leads`);

      let status = job;
      while (!['completed', 'failed'].includes(status.status)) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        status = await api.getLeadExport(job.id);
        const processed = Number(status.processed_records || 0);
        const total = Number(status.total_records || job.total_records);
        setExportProgress({ processed, total, percent: total ? Math.min(100, Math.round((processed / total) * 100)) : 0 });
      }
      if (status.status === 'failed') throw new Error(status.error_message || 'Background export failed');

      const blob = await api.downloadLeadExport(job.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `leads_export_${mode}_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setShowExportModal(false);
      toast.success(`Exported ${Number(status.processed_records).toLocaleString()} leads`);
    } catch (err) {
      toast.error('Export failed: ' + err.message);
    } finally {
      setExporting(false);
    }
  };

  const handleDownloadTemplate = () => {
    // Columns must match exactly what the server import handler reads
    const headers = ['Name', 'Phone', 'Country Code', 'Source', 'Brand', 'Status', 'Score', 'Interest', 'Assigned', 'Last Contact'];
    const dummy = ['Rahul Sharma', '9876543210', '91', 'WhatsApp', 'BM Academy', 'new', '75', 'Web Development', 'Admin', new Date().toISOString().split('T')[0]];
    const csvContent = [headers.join(','), dummy.join(',')].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'leads_import_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Template downloaded! Fill in your leads and import.');
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('force_source', 'XLS Sheet');
      const res = await api.importLeads(formData);
      toast.success(`Successfully imported ${res.imported} leads!`);
      if (refetch) refetch();
    } catch (err) {
      toast.error('Error importing leads: ' + err.message);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = (id) => {
    toast((t) => (
      <div>
        <p style={{ fontSize: 13, color: C.text, marginBottom: 10, fontWeight: 500 }}>Are you sure you want to delete this lead?</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={() => toast.dismiss(t.id)} style={{ background: C.card, border: '1px solid ' + C.border, color: C.muted, padding: '5px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>Cancel</button>
          <button onClick={async () => {
            toast.dismiss(t.id);
            try {
              await api.deleteLead(id);
              toast.success('Lead deleted successfully');
              if (refetch) refetch();
            } catch (err) {
              toast.error('Error deleting lead: ' + err.message);
            }
          }} style={{ background: '#ef4444', border: 'none', color: '#fff', padding: '5px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>Delete</button>
        </div>
      </div>
    ), { duration: 5000, style: { background: C.surface, border: '1px solid ' + C.border } });
  };

  return (
    <div className="p-mobile" style={{ padding: 26, overflowY: 'auto', height: '100%' }}>
      <AddLeadModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSaved={() => { if (refetch) refetch(); }}
        clients={modalClients}
        users={modalUsers}
      />
      <PaymentLinkModal lead={paymentLead} onClose={() => setPaymentLead(null)} />
      <MetaLeadDetailsModal lead={metaLeadDetails} onClose={() => setMetaLeadDetails(null)} />
      <ExportLeadsModal open={showExportModal} onClose={() => setShowExportModal(false)} onExport={handleExport} exporting={exporting} exportProgress={exportProgress} />

      <div className="flex-col-mobile" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 22 }}>
        <div>
          <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: 21, fontWeight: 800, color: C.text }}>Lead Management</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{total || 0} total leads {loading && '(loading...)'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input type="file" accept=".csv,.xlsx,.xls" ref={fileInputRef} onChange={handleImport} style={{ display: 'none' }} />
          <button
            onClick={handleDownloadTemplate}
            title="Download CSV template with sample data"
            style={{ background: 'linear-gradient(135deg,#1a3a1a,#0d2b0d)', border: '1px solid #2d6a2d', color: '#4ade80', padding: '7px 12px', borderRadius: 7, fontSize: 11, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontWeight: 600, transition: 'opacity .2s' }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            <FileSpreadsheet size={12} /> Template
          </button>
          <button onClick={() => fileInputRef.current?.click()} disabled={importing} style={{ background: C.card, border: '1px solid ' + C.border, color: C.muted, padding: '7px 12px', borderRadius: 7, fontSize: 11, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', opacity: importing ? 0.6 : 1 }}><Upload size={12} />{importing ? 'Importing...' : 'Import CSV'}</button>
          <button onClick={() => setShowExportModal(true)} style={{ background: C.card, border: '1px solid ' + C.border, color: C.muted, padding: '7px 12px', borderRadius: 7, fontSize: 11, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}><Download size={12} />Export</button>
          <button
            onClick={async () => {
              if (syncingFB) return;
              setSyncingFB(true);
              try {
                const res = await api.post('/api/integrations/meta/sync-all-leads');
                if (res.success) {
                  toast.success(res.message || 'Syncing started in the background!');
                  if (refetch) refetch();
                } else {
                  toast.error('Sync failed: ' + res.error);
                }
              } catch (err) {
                toast.error('Sync error: ' + err.message);
              } finally {
                setSyncingFB(false);
              }
            }}
            title="Sync all historical Facebook Leads"
            disabled={syncingFB}
            style={{ background: 'linear-gradient(135deg,#3b5998,#1e2e50)', border: '1px solid #4c70ba', color: '#fff', padding: '7px 12px', borderRadius: 7, fontSize: 11, display: 'flex', alignItems: 'center', gap: 5, cursor: syncingFB ? 'default' : 'pointer', fontWeight: 600, transition: 'opacity .2s', opacity: syncingFB ? 0.7 : 1 }}
            onMouseEnter={e => !syncingFB && (e.currentTarget.style.opacity = '0.8')}
            onMouseLeave={e => !syncingFB && (e.currentTarget.style.opacity = '1')}
          >
            <RefreshCw size={12} className={syncingFB ? "spin-animation" : ""} /> {syncingFB ? 'Syncing...' : 'Sync FB Leads'}
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            style={{ background: C.accent, border: 'none', color: '#fff', padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}
          >
            <Plus size={12} />Add Lead
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#2d1010', border: '1px solid #7c2d12', borderRadius: 7, padding: 12, marginBottom: 18, color: '#ef4444', fontSize: 12 }}>
          Error loading leads: {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18, alignItems: 'stretch' }}>
        <div className="w-full-mobile table-responsive" style={{ display: 'flex', background: C.card, border: '1px solid ' + C.border, borderRadius: 9, overflow: 'hidden', alignSelf: 'flex-start' }}>
          {tabs.map((t) => (
            <button key={t} onClick={() => setFilter(t)} style={{ padding: '7px 13px', fontSize: 11, fontWeight: 600, border: 'none', background: filter === t ? C.accent : 'transparent', color: filter === t ? '#fff' : C.muted, textTransform: 'capitalize' }}>
              {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div className="w-full-mobile" style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: C.card, border: '1px solid ' + C.border, borderRadius: 9, padding: '0 12px', height: 36, flex: 1 }}>
            <Search size={12} color={C.muted} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or phone..." style={{ background: 'transparent', border: 'none', color: C.text, fontSize: 12, outline: 'none', width: '100%' }} />
          </div>
          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 9, padding: '0 12px', height: 36, display: 'flex', alignItems: 'center' }}>
            <select value={sourceFilter} onChange={(e) => { const source = e.target.value; setSourceFilter(source); if (source !== 'facebook') { setCampaignFilter(''); setAdFilter(''); setMetaPageFilter(''); } }} style={{ background: 'transparent', border: 'none', color: C.text, fontSize: 12, outline: 'none', cursor: 'pointer', textTransform: 'capitalize' }}>
              <option value="all" style={{ background: C.card, color: C.text }}>All Sources</option>
              {SOURCE_FILTERS.map(source => (
                <option key={source.value} value={source.value} style={{ background: C.card, color: C.text }}>{source.label}</option>
              ))}
            </select>
          </div>
          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 9, padding: '0 10px', height: 36, display: 'flex', alignItems: 'center', minWidth: 190 }}>
            <select aria-label="Campaign Name" value={campaignFilter} onChange={(e) => { setCampaignFilter(e.target.value); setAdFilter(''); if (e.target.value) setSourceFilter('facebook'); }} style={{ width: '100%', background: 'transparent', border: 'none', color: C.text, fontSize: 11, outline: 'none', cursor: 'pointer' }}>
              <option value="" style={{ background: C.card, color: C.text }}>All Facebook Campaigns</option>
              {campaignNames.length === 0 && <option disabled style={{ background: C.card, color: C.muted }}>No campaign names found</option>}
              {campaignNames.map(name => <option key={name} value={name} style={{ background: C.card, color: C.text }}>{name}</option>)}
            </select>
          </div>
          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 9, padding: '0 10px', height: 36, display: 'flex', alignItems: 'center', minWidth: 170 }}>
            <select aria-label="Ad Name" value={adFilter} onChange={(e) => { setAdFilter(e.target.value); if (e.target.value) setSourceFilter('facebook'); }} style={{ width: '100%', background: 'transparent', border: 'none', color: C.text, fontSize: 11, outline: 'none', cursor: 'pointer' }}>
              <option value="" style={{ background: C.card, color: C.text }}>All Facebook Ads</option>
              {adNames.length === 0 && <option disabled style={{ background: C.card, color: C.muted }}>No ad names found</option>}
              {adNames.map(name => <option key={name} value={name} style={{ background: C.card, color: C.text }}>{name}</option>)}
            </select>
          </div>
          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 9, padding: '0 10px', height: 36, display: 'flex', alignItems: 'center', minWidth: 190 }}>
            <select aria-label="Facebook or Instagram Page" value={metaPageFilter} onChange={(e) => { setMetaPageFilter(e.target.value); if (e.target.value) setSourceFilter('facebook'); }} style={{ width: '100%', background: 'transparent', border: 'none', color: C.text, fontSize: 11, outline: 'none', cursor: 'pointer' }}>
              <option value="" style={{ background: C.card, color: C.text }}>All Facebook & Instagram Pages</option>
              {metaPageOptions.length === 0 && <option disabled style={{ background: C.card, color: C.muted }}>No connected pages found</option>}
              {metaPageOptions.map(page => (
                <option key={`${page.platform}-${page.page_id}-${page.brand_name}`} value={page.page_id} style={{ background: C.card, color: C.text }}>
                  [{page.platform === 'instagram' ? 'Instagram' : 'Facebook'}] {page.page_name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 9, padding: '0 10px', height: 36, display: 'flex', alignItems: 'center', minWidth: 150 }}>
            <select aria-label="Tag Filter" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} style={{ width: '100%', background: 'transparent', border: 'none', color: C.text, fontSize: 11, outline: 'none', cursor: 'pointer' }}>
              <option value="" style={{ background: C.card, color: C.text }}>All Tags</option>
              {availableTags.map(tag => (
                <option key={tag.id} value={tag.id} style={{ background: C.card, color: C.text }}>{tag.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="table-responsive" style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 14, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid ' + C.border }}>
              {['Lead', 'Phone', 'Tags', 'Source', 'Brand', 'Status', 'Score', 'Assigned', 'Date', ''].map((h) => (
                <th key={h} style={{ padding: '11px 14px', fontSize: 9, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, textAlign: 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedLeads.map((l, i) => (
              <tr key={l.id} onClick={() => onLeadClick(l)} style={{ borderBottom: '1px solid ' + C.border, cursor: 'pointer', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                <td style={{ padding: '13px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: C.accent + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: C.accent, flexShrink: 0 }}>{l.name[0]}</div>
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{l.name}</p>
                      <p style={{ fontSize: 10, color: C.muted }}>{l.interest || 'N/A'}</p>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '13px 14px', fontSize: 11, color: C.muted }}>{l.phone}</td>
                <td style={{ padding: '13px 14px' }}>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 120 }}>
                    {l.tags && l.tags.length > 0 ? l.tags.map(tag => (
                      <span key={tag.id} style={{ fontSize: 9, fontWeight: 700, background: tag.color + '22', color: tag.color, border: `1px solid ${tag.color}44`, padding: '2px 6px', borderRadius: 10, whiteSpace: 'nowrap' }}>
                        {tag.name}
                      </span>
                    )) : <span style={{ fontSize: 10, color: C.dim }}>-</span>}
                  </div>
                </td>
                <td style={{ padding: '13px 14px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 10, color: C.blue, background: '#0f1e38', padding: '2px 7px', borderRadius: 10 }}>{l.source || 'Manual'}</span>
                      {(l.source?.toLowerCase().includes('facebook') || l.source?.toLowerCase().includes('meta ads') || l.source?.toLowerCase().includes('meta_ads')) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setMetaLeadDetails(l); }}
                          title="View Campaign Details"
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted }}
                        >
                          <Info size={12} />
                        </button>
                      )}
                    </div>
                    {(l.source?.toLowerCase().includes('facebook') || l.source?.toLowerCase().includes('meta ads') || l.source?.toLowerCase().includes('meta_ads')) && l.campaign_name && (
                      <span title={l.campaign_name} style={{ maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.muted, fontSize: 9 }}>Campaign: {l.campaign_name}</span>
                    )}
                    {(l.source?.toLowerCase().includes('facebook') || l.source?.toLowerCase().includes('meta ads') || l.source?.toLowerCase().includes('meta_ads')) && l.facebook_page_name && (
                      <span title={l.facebook_page_name} style={{ maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.blue, fontSize: 9 }}>Page: {l.facebook_page_name}</span>
                    )}
                  </div>
                </td>
                <td style={{ padding: '13px 14px', fontSize: 11, color: C.muted }}>{l.brand_name || 'N/A'}</td>
                <td style={{ padding: '13px 14px' }}><Badge status={l.status} /></td>
                <td style={{ padding: '13px 14px' }}><ScoreBar score={l.score || 0} /></td>
                <td style={{ padding: '13px 14px', fontSize: 11, color: C.muted }}>{l.assigned_name || 'Unassigned'}</td>
                <td style={{ padding: '13px 14px', fontSize: 10, color: C.dim }}>
                  {l.created_at ? new Date(l.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : (l.last_contact || 'N/A')}
                </td>
                <td style={{ padding: '13px 14px' }}>
                  <div style={{ display: 'flex', gap: 5 }}>
                    <button title="View lead" style={{ width: 26, height: 26, borderRadius: 6, background: 'transparent', border: '1px solid ' + C.border, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={(e) => { e.stopPropagation(); onLeadClick(l); }}><Eye size={11} color={C.muted} /></button>
                    <button title="Call" style={{ width: 26, height: 26, borderRadius: 6, background: 'transparent', border: '1px solid ' + C.border, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={(e) => { e.stopPropagation(); window.open(`tel:${l.phone}`, '_self'); }}><Phone size={11} color={C.muted} /></button>
                    <button title="Generate Payment Link" style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={(e) => { e.stopPropagation(); setPaymentLead(l); }}><CreditCard size={11} color="#f97316" /></button>
                    <button title="Delete" style={{ width: 26, height: 26, borderRadius: 6, background: 'transparent', border: '1px solid ' + C.border, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={(e) => { e.stopPropagation(); handleDelete(l.id); }}><Trash size={11} color="#ef4444" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && !loading && <div style={{ textAlign: 'center', padding: 32, color: C.muted }}>No leads match this filter</div>}
        {loading && <div style={{ textAlign: 'center', padding: 32, color: C.muted }}>Loading leads...</div>}
        {filtered.length > 0 && (
          <div style={{ padding: '12px 14px', borderTop: '1px solid ' + C.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: C.muted }}>Showing {total > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0} to {Math.min(currentPage * itemsPerPage, total || 0)} of {total || 0} entries</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                style={{ background: 'transparent', border: '1px solid ' + C.border, color: currentPage === 1 ? C.dim : C.text, padding: '5px 10px', borderRadius: 6, fontSize: 11, cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
              >
                Previous
              </button>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px', fontSize: 11, fontWeight: 600, color: C.text }}>
                Page {currentPage} of {totalPages > 0 ? totalPages : 1}
              </div>
              <button
                disabled={currentPage === totalPages || totalPages === 0}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                style={{ background: 'transparent', border: '1px solid ' + C.border, color: currentPage === totalPages || totalPages === 0 ? C.dim : C.text, padding: '5px 10px', borderRadius: 6, fontSize: 11, cursor: currentPage === totalPages || totalPages === 0 ? 'not-allowed' : 'pointer' }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
