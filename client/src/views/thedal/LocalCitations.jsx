import React, { useState, useEffect } from 'react';
import SopModal from '../../components/common/SopModal.jsx';
import { C } from '../../constants/theme.js';
import { api } from '../../services/api.js';
import {
  MapPin, Search, Phone, Building, Loader2, Clock, 
  History, Download, Eye, Activity, CheckCircle, AlertTriangle, XCircle
} from 'lucide-react';

// ── Metric Card Component ──────────────────────────────────────────────────
const MetricCard = ({ title, value, icon: Icon, color }) => (
  <div style={{
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    padding: '24px 20px',
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    flex: 1,
    minWidth: 200,
    boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
  }}>
    <div style={{
      width: 48,
      height: 48,
      borderRadius: 12,
      background: `${color}15`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }}>
      <Icon size={24} color={color} />
    </div>
    <div>
      <p style={{ margin: 0, fontSize: 13, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</p>
      <h3 style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 800, color: '#f8fafc' }}>{value}</h3>
    </div>
  </div>
);

// ── Main Page Component ─────────────────────────────────────────────────────
export default function LocalCitations() {
  const [businessName, setBusinessName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [tracked, setTracked] = useState([]);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [sidebarTab, setSidebarTab] = useState('history'); // 'history' or 'tracked'
  const [isTracking, setIsTracking] = useState(false);
  
  const itemsPerPage = 10;

  useEffect(() => {
    fetchHistory();
    fetchTracked();
  }, []);

  useEffect(() => {
    if (data && tracked.some(t => t.business_name === data.businessName)) {
      setIsTracking(true);
    } else {
      setIsTracking(false);
    }
  }, [data, tracked]);

  const fetchHistory = async () => {
    try {
      const res = await api.get('/thedal/citations/history');
      if (res.history) setHistory(res.history);
    } catch (err) { console.error(err); }
  };

  const fetchTracked = async () => {
    try {
      const res = await api.get('/thedal/citations/tracked');
      if (res.tracked) setTracked(res.tracked);
    } catch (err) { console.error(err); }
  };

  const handleScan = async (e) => {
    if (e) e.preventDefault();
    if (!businessName.trim() || !phone.trim() || !address.trim()) {
      setError('Business Name, Phone Number, and Address are all required.');
      return;
    }

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await api.post('/thedal/citations/scan', { businessName, phone, address });
      setData(res);
      setCurrentPage(1);
      fetchHistory(); 
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to scan local citations.');
    } finally {
      setLoading(false);
    }
  };

  const toggleTracking = async () => {
    if (!data) return;
    try {
      const res = await api.post('/thedal/citations/track', { businessName: data.businessName, phone: data.phone, metrics: data.metrics });
      setIsTracking(res.tracking);
      fetchTracked();
    } catch (err) {
      console.error(err);
    }
  };

  const exportCSV = () => {
    if (!data || !data.citations) return;

    const headers = ['Directory', 'Status', 'Listed Name', 'Listed Phone', 'Listed Address'];
    const rows = data.citations.map(c => [
      `"${c.directory}"`, 
      `"${c.status}"`, 
      `"${c.listedName}"`, 
      `"${c.listedPhone}"`, 
      `"${c.listedAddress}"`
    ].join(','));
    
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${data.businessName.replace(/\s+/g, '_')}_citations.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const loadFromHistory = (item) => {
    setBusinessName(item.business_name);
    setPhone(item.phone || '');
    setAddress(item.address || '');
    setData({ 
      businessName: item.business_name, 
      phone: item.phone, 
      address: item.address, 
      metrics: item.metrics, 
      citations: item.citations || [], 
      scanned_at: item.scanned_at || item.added_at 
    });
    setCurrentPage(1);
    setError(null);
  };

  return (
    <div style={{ padding: '30px 40px', color: C.text, height: '100%', overflowY: 'auto', background: C.background }}>
      
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: '#f8fafc', margin: 0, fontFamily: "'Syne', sans-serif", display: 'flex', alignItems: 'center', gap: 12 }}>
            <MapPin size={32} color={C.accent} />
            Local Citations
          </h1>
          <p style={{ color: C.muted, fontSize: 15, marginTop: 8, maxWidth: 600, lineHeight: 1.5 }}>
            Ensure your business NAP (Name, Address, Phone) is consistent across all major local directories to improve your local search rankings.
          </p>
        </div>
      </div>

      {/* ── Search Bar ──────────────────────────────────────────────────── */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '24px 30px', marginBottom: 30, boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}>
        <form onSubmit={handleScan} style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          
          <div style={{ flex: 1.5, position: 'relative', minWidth: 250 }}>
            <Building size={20} color={C.muted} style={{ position: 'absolute', left: 16, top: 18 }} />
            <input
              type="text"
              placeholder="Business Name*"
              value={businessName}
              onChange={e => setBusinessName(e.target.value)}
              disabled={loading}
              required
              style={{
                width: '100%', padding: '16px 20px 16px 48px',
                background: 'rgba(15, 23, 42, 0.4)', border: `1px solid ${C.border}`,
                borderRadius: 12, color: '#f8fafc', fontSize: 16, outline: 'none'
              }}
            />
          </div>
          
          <div style={{ flex: 1, position: 'relative', minWidth: 200 }}>
            <Phone size={20} color={C.muted} style={{ position: 'absolute', left: 16, top: 18 }} />
            <input
              type="text"
              placeholder="Phone Number*"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              disabled={loading}
              required
              style={{
                width: '100%', padding: '16px 20px 16px 48px',
                background: 'rgba(15, 23, 42, 0.4)', border: `1px solid ${C.border}`,
                borderRadius: 12, color: '#f8fafc', fontSize: 16, outline: 'none'
              }}
            />
          </div>

          <div style={{ flex: 1.5, position: 'relative', minWidth: 250 }}>
            <MapPin size={20} color={C.muted} style={{ position: 'absolute', left: 16, top: 18 }} />
            <input
              type="text"
              placeholder="Full Address / Zip Code*"
              value={address}
              onChange={e => setAddress(e.target.value)}
              disabled={loading}
              required
              style={{
                width: '100%', padding: '16px 20px 16px 48px',
                background: 'rgba(15, 23, 42, 0.4)', border: `1px solid ${C.border}`,
                borderRadius: 12, color: '#f8fafc', fontSize: 16, outline: 'none'
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading || !businessName.trim() || !phone.trim() || !address.trim()}
            style={{
              padding: '0 32px', background: loading ? 'rgba(249, 115, 22, 0.5)' : C.accent,
              color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 16,
              cursor: loading || !businessName.trim() || !phone.trim() || !address.trim() ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 10
            }}
          >
            {loading ? <Loader2 size={20} className="spin" /> : <Search size={20} />}
            {loading ? 'Scanning...' : 'Analyze'}
          </button>
        </form>
        {error && (
          <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 8, color: '#fca5a5', fontSize: 14 }}>
            {error}
          </div>
        )}
      </div>

      {/* ── Results Area ────────────────────────────────────────────────── */}
      {data && !loading && (
        <div style={{ animation: 'fadeIn 0.5s ease-out' }}>
          
          {/* Action Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><h2 style={{ margin: 0, fontSize: 24, color: '#f8fafc', fontWeight: 800 }}>{data.businessName}</h2><SopModal /></div>
              <div style={{ display: 'flex', gap: 16, color: C.muted, fontSize: 14, marginTop: 6 }}>
                {data.phone && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={14}/> {data.phone}</span>}
                {data.address && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><MapPin size={14}/> {data.address}</span>}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={toggleTracking} style={{ 
                padding: '10px 16px', borderRadius: 8, border: `1px solid ${isTracking ? '#10b981' : C.border}`,
                background: isTracking ? 'rgba(16, 185, 129, 0.1)' : C.surface,
                color: isTracking ? '#34d399' : '#e2e8f0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600
              }}>
                <Eye size={16} /> {isTracking ? 'Monitoring Active' : 'Track Business'}
              </button>
              <button onClick={exportCSV} style={{ 
                padding: '10px 16px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface,
                color: '#e2e8f0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600
              }}>
                <Download size={16} /> Export CSV
              </button>
            </div>
          </div>

          {/* Metrics */}
          {data.metrics && (
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 30 }}>
              <MetricCard title="Health Score" value={`${data.metrics.healthScore}%`} icon={Activity} color="#3b82f6" />
              <MetricCard title="Accurate Listings" value={data.metrics.accurateCount} icon={CheckCircle} color="#10b981" />
              <MetricCard title="Errors / Discrepancies" value={data.metrics.discrepancyCount} icon={AlertTriangle} color="#f59e0b" />
              <MetricCard title="Missing Listings" value={data.metrics.missingCount} icon={XCircle} color="#ef4444" />
            </div>
          )}

          {/* Citations Table */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
            <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#f8fafc' }}>Top Directories</h2>
              <span style={{ fontSize: 13, color: C.muted, background: `${C.border}`, padding: '4px 10px', borderRadius: 20 }}>
                Showing {data.citations.length} listings
              </span>
            </div>
            
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: 'rgba(15, 23, 42, 0.4)' }}>
                    <th style={{ padding: '16px 24px', color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>Directory</th>
                    <th style={{ padding: '16px 24px', color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>Status</th>
                    <th style={{ padding: '16px 24px', color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>Listed Name</th>
                    <th style={{ padding: '16px 24px', color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>Listed Phone</th>
                    <th style={{ padding: '16px 24px', color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>Listed Address</th>
                  </tr>
                </thead>
                <tbody>
                  {data.citations.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((c, idx) => (
                    <tr key={c.id || idx} style={{ borderTop: `1px solid ${C.border}`, background: idx % 2 === 0 ? 'transparent' : 'rgba(15,23,42,0.2)' }}>
                      <td style={{ padding: '16px 24px' }}>
                        <span style={{ color: '#f8fafc', fontWeight: 600, fontSize: 14, display: 'block' }}>{c.directory}</span>
                        <span style={{ color: '#3b82f6', fontSize: 12 }}>{c.domain}</span>
                      </td>
                      <td style={{ padding: '16px 24px' }}>
                        {c.status === 'Accurate' && (
                          <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: 'rgba(16, 185, 129, 0.1)', color: '#34d399', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <CheckCircle size={12} /> Accurate
                          </span>
                        )}
                        {c.status === 'Discrepancy' && (
                          <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: 'rgba(245, 158, 11, 0.1)', color: '#fbbf24', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <AlertTriangle size={12} /> Discrepancy
                          </span>
                        )}
                        {c.status === 'Missing' && (
                          <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <XCircle size={12} /> Missing
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '16px 24px', color: c.discrepantFields?.includes('name') ? '#fbbf24' : '#cbd5e1', fontSize: 14 }}>
                        {c.listedName}
                      </td>
                      <td style={{ padding: '16px 24px', color: c.discrepantFields?.includes('phone') ? '#fbbf24' : '#cbd5e1', fontSize: 14 }}>
                        {c.listedPhone}
                      </td>
                      <td style={{ padding: '16px 24px', color: c.discrepantFields?.includes('address') ? '#fbbf24' : '#cbd5e1', fontSize: 14 }}>
                        {c.listedAddress}
                      </td>
                    </tr>
                  ))}
                  {data.citations.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: '40px 0', textAlign: 'center', color: C.muted }}>No citations found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {data.citations.length > itemsPerPage && (
              <div style={{ padding: '16px 24px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: C.muted, fontSize: 13 }}>
                  Showing {Math.min((currentPage - 1) * itemsPerPage + 1, data.citations.length)} to {Math.min(currentPage * itemsPerPage, data.citations.length)} of {data.citations.length} results
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} style={{ padding: '6px 12px', background: currentPage === 1 ? 'rgba(15,23,42,0.4)' : C.surface, border: `1px solid ${C.border}`, borderRadius: 6, color: currentPage === 1 ? C.muted : '#f8fafc', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}>Previous</button>
                  <button onClick={() => setCurrentPage(p => Math.min(Math.ceil(data.citations.length / itemsPerPage), p + 1))} disabled={currentPage >= Math.ceil(data.citations.length / itemsPerPage)} style={{ padding: '6px 12px', background: currentPage >= Math.ceil(data.citations.length / itemsPerPage) ? 'rgba(15,23,42,0.4)' : C.surface, border: `1px solid ${C.border}`, borderRadius: 6, color: currentPage >= Math.ceil(data.citations.length / itemsPerPage) ? C.muted : '#f8fafc', cursor: currentPage >= Math.ceil(data.citations.length / itemsPerPage) ? 'not-allowed' : 'pointer' }}>Next</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Empty State / Sidebars ─────────────────────────────────────── */}
      {!data && !loading && (
        <div style={{ display: 'flex', gap: 30, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, padding: 60, background: 'rgba(15,23,42,0.3)', borderRadius: 16, border: `1px dashed ${C.border}`, textAlign: 'center' }}>
            <MapPin size={48} color={C.accent} style={{ opacity: 0.5, marginBottom: 20 }} />
            <h3 style={{ margin: '0 0 10px', fontSize: 24, color: '#f8fafc' }}>Local Search Consistency</h3>
            <p style={{ color: C.muted, margin: 0, fontSize: 16, lineHeight: 1.6, maxWidth: 500, marginLeft: 'auto', marginRight: 'auto' }}>
              Enter your business name, phone number, and address above to check your visibility across the top directories and maps.
            </p>
          </div>

          <div style={{ width: 350, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}` }}>
              <button onClick={() => setSidebarTab('history')} style={{ flex: 1, padding: '16px 0', border: 'none', background: sidebarTab === 'history' ? 'rgba(15,23,42,0.4)' : 'transparent', color: sidebarTab === 'history' ? '#f8fafc' : C.muted, fontWeight: 600, cursor: 'pointer', borderBottom: sidebarTab === 'history' ? `2px solid ${C.accent}` : '2px solid transparent' }}>
                Recent Scans
              </button>
              <button onClick={() => setSidebarTab('tracked')} style={{ flex: 1, padding: '16px 0', border: 'none', background: sidebarTab === 'tracked' ? 'rgba(15,23,42,0.4)' : 'transparent', color: sidebarTab === 'tracked' ? '#f8fafc' : C.muted, fontWeight: 600, cursor: 'pointer', borderBottom: sidebarTab === 'tracked' ? `2px solid #10b981` : '2px solid transparent' }}>
                Monitored
              </button>
            </div>
            
            <div style={{ maxHeight: 350, overflowY: 'auto' }}>
              {sidebarTab === 'history' && history.map((h, i) => (
                <div key={h.id} onClick={() => loadFromHistory(h)} style={{ padding: '16px 20px', borderBottom: i === history.length - 1 ? 'none' : `1px solid ${C.border}`, cursor: 'pointer', transition: 'background 0.2s' }} onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'} onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{h.business_name}</span>
                    <span style={{ fontSize: 12, color: C.accent }}>{h.metrics?.healthScore}% Score</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.muted }}>
                    <Clock size={12} /> {new Date(h.scanned_at).toLocaleDateString()}
                  </div>
                </div>
              ))}
              
              {sidebarTab === 'tracked' && tracked.map((t, i) => (
                <div key={t.id} onClick={() => loadFromHistory(t)} style={{ padding: '16px 20px', borderBottom: i === tracked.length - 1 ? 'none' : `1px solid ${C.border}`, cursor: 'pointer', transition: 'background 0.2s' }} onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'} onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 6 }}><Eye size={14} color="#10b981" /> {t.business_name}</span>
                    <span style={{ fontSize: 12, background: 'rgba(16, 185, 129, 0.1)', color: '#34d399', padding: '2px 6px', borderRadius: 10 }}>{t.status}</span>
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
                    Health: {t.metrics?.healthScore}% • Accurate: {t.metrics?.accurateCount}
                  </div>
                </div>
              ))}

              {sidebarTab === 'history' && history.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: C.muted }}>No recent scans.</div>}
              {sidebarTab === 'tracked' && tracked.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: C.muted }}>No businesses monitored yet.</div>}
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
