import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { C } from '../../constants/theme.js';
import {
  Activity, Zap, Search, Filter, RefreshCw, ChevronLeft, ChevronRight,
  AlertTriangle, ShieldCheck, Database, Clock, Calendar, Eye, X,
  CheckCircle2, Layers, Cpu, Server, BarChart3, TrendingUp, HelpCircle
} from 'lucide-react';
import toast from 'react-hot-toast';

const API_URL = import.meta.env.VITE_API_URL || '';

export default function Usage() {
  // Summary & Cards State
  const [summary, setSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(true);

  // Table State
  const [clientsData, setClientsData] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, totalPages: 1, totalCount: 0 });
  const [loadingTable, setLoadingTable] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortField, setSortField] = useState('credits');
  const [sortOrder, setSortOrder] = useState('desc');

  // Detail Modal State
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientDetails, setClientDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Fetch Summary Metrics
  const fetchSummary = async () => {
    try {
      setLoadingSummary(true);
      const token = localStorage.getItem('leados_token');
      const res = await axios.get(`${API_URL}/api/mafiya/usage/summary?provider=valueserp`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSummary(res.data);
    } catch (err) {
      console.error('[Usage] Fetch summary error:', err);
      toast.error('Failed to load API usage summary');
    } finally {
      setLoadingSummary(false);
    }
  };

  // Fetch Client Usage Table
  const fetchClientsUsage = async (page = 1) => {
    try {
      setLoadingTable(true);
      const token = localStorage.getItem('leados_token');
      const res = await axios.get(`${API_URL}/api/mafiya/usage/clients`, {
        params: {
          provider: 'valueserp',
          search,
          filter: filterStatus,
          sort: sortField,
          order: sortOrder,
          page,
          limit: 10
        },
        headers: { Authorization: `Bearer ${token}` }
      });

      setClientsData(res.data.rows || []);
      setPagination(res.data.pagination || { page: 1, limit: 10, totalPages: 1, totalCount: 0 });
    } catch (err) {
      console.error('[Usage] Fetch client usage error:', err);
      toast.error('Failed to load client usage table');
    } finally {
      setLoadingTable(false);
    }
  };

  // Fetch Detailed View for Selected Client
  const fetchClientDetails = async (clientId) => {
    try {
      setLoadingDetails(true);
      const token = localStorage.getItem('leados_token');
      const res = await axios.get(`${API_URL}/api/mafiya/usage/clients/${clientId}?provider=valueserp`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setClientDetails(res.data);
    } catch (err) {
      console.error('[Usage] Fetch client details error:', err);
      toast.error('Failed to load client usage breakdown');
    } finally {
      setLoadingDetails(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  useEffect(() => {
    fetchClientsUsage(1);
  }, [search, filterStatus, sortField, sortOrder]);

  const handleRowClick = (client) => {
    setSelectedClient(client);
    fetchClientDetails(client.clientId);
  };

  const handleSortToggle = (field) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  // Shared Card Style
  const cardStyle = {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    padding: '18px 20px',
    position: 'relative',
    overflow: 'hidden'
  };

  return (
    <div style={{ padding: 28, color: C.text, height: '100%', overflowY: 'auto', background: 'rgba(0,0,0,0.15)' }}>

      {/* ═══ Header Section ═══ */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 38, height: 38, background: 'linear-gradient(135deg, #ea580c, #f97316)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Activity size={20} color="#fff" />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#fff', fontFamily: "'Syne', sans-serif" }}>
                ValueSERP API Usage & Credits
              </h1>
              <p style={{ margin: 0, color: C.muted, fontSize: 12, marginTop: 2 }}>
                Monitor API requests, credit consumption, and scan performance across all client profiles
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={() => { fetchSummary(); fetchClientsUsage(pagination.page); }}
          style={{ background: C.surface, border: `1px solid ${C.border}`, padding: '10px 16px', borderRadius: 10, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, transition: 'background 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
          onMouseLeave={e => e.currentTarget.style.background = C.surface}
        >
          <RefreshCw size={14} className={loadingSummary || loadingTable ? "animate-spin" : ""} />
          Refresh Stats
        </button>
      </div>

      {/* ═══ Credit Protection Warning Banner ═══ */}
      {summary && summary.isWarning && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: '14px 18px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 36, height: 36, background: 'rgba(239,68,68,0.2)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <AlertTriangle size={20} color="#ef4444" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#ef4444' }}>
              Credit Protection Alert — Low API Credits Remaining ({summary.remainingPct}%)
            </div>
            <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 2 }}>
              {summary.warningMessage || `Remaining ValueSERP API credits have fallen below the configured ${summary.warningThresholdPct}% threshold. Please top up your account.`}
            </div>
          </div>
        </div>
      )}

      {/* ═══ Dashboard Metric Cards ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 16, marginBottom: 28 }}>
        
        {/* Card 1: Available Credits */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Available Credits</span>
            <Database size={16} color="#94a3b8" />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#fff', fontFamily: "'Syne', sans-serif" }}>
            {loadingSummary ? '...' : (summary?.totalCreditsAvailable?.toLocaleString('en-IN') || 0)}
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Allocated API Quota</div>
        </div>

        {/* Card 2: Total Credits Used */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Credits Used</span>
            <Zap size={16} color="#f97316" />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#f97316', fontFamily: "'Syne', sans-serif" }}>
            {loadingSummary ? '...' : (summary?.totalCreditsUsed?.toLocaleString('en-IN') || 0)}
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Consumed across scans</div>
        </div>

        {/* Card 3: Remaining Credits */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Remaining Credits</span>
            <Cpu size={16} color={summary?.isWarning ? '#ef4444' : '#10b981'} />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: summary?.isWarning ? '#ef4444' : '#10b981', fontFamily: "'Syne', sans-serif" }}>
            {loadingSummary ? '...' : (summary?.remainingCredits?.toLocaleString('en-IN') || 0)}
          </div>
          {/* Progress Bar */}
          <div style={{ marginTop: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 10, height: 5, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, summary?.remainingPct || 0)}%`, height: '100%', background: summary?.isWarning ? '#ef4444' : '#10b981', borderRadius: 10, transition: 'width 0.3s' }} />
          </div>
        </div>

        {/* Card 4: Total API Requests */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total API Requests</span>
            <Server size={16} color="#3b82f6" />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#fff', fontFamily: "'Syne', sans-serif" }}>
            {loadingSummary ? '...' : (summary?.totalApiRequests?.toLocaleString('en-IN') || 0)}
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Lifetime SERP Queries</div>
        </div>

        {/* Card 5: Today's Requests */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Today's Requests</span>
            <TrendingUp size={16} color="#8b5cf6" />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#c084fc', fontFamily: "'Syne', sans-serif" }}>
            {loadingSummary ? '...' : (summary?.todayApiRequests?.toLocaleString('en-IN') || 0)}
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Requested today</div>
        </div>

        {/* Card 6: This Month's Requests */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>This Month</span>
            <Calendar size={16} color="#06b6d4" />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#38bdf8', fontFamily: "'Syne', sans-serif" }}>
            {loadingSummary ? '...' : (summary?.monthApiRequests?.toLocaleString('en-IN') || 0)}
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Current calendar month</div>
        </div>

        {/* Card 7: Last API Call Time */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Last API Call</span>
            <Clock size={16} color="#eab308" />
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fef08a', fontFamily: "'Syne', sans-serif", marginTop: 4 }}>
            {loadingSummary ? '...' : (summary?.lastApiCallTime ? new Date(summary.lastApiCallTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Never')}
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
            {summary?.lastApiCallTime ? new Date(summary.lastApiCallTime).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'No calls logged'}
          </div>
        </div>

      </div>

      {/* ═══ Client Usage Table Section ═══ */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
        
        {/* Table Controls (Search, Filter, Sort) */}
        <div style={{ padding: '18px 22px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14, background: 'rgba(255,255,255,0.01)' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#fff', fontFamily: "'Syne', sans-serif" }}>Client API Usage Breakdown</h2>
            <p style={{ margin: 0, color: C.muted, fontSize: 11, marginTop: 2 }}>Click on any client row to view detailed scan logs and directory metrics</p>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Search Input */}
            <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.25)', border: `1px solid ${C.border}`, borderRadius: 8, padding: '0 10px', width: 220 }}>
              <Search size={14} color={C.muted} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search clients..."
                style={{ background: 'transparent', border: 'none', color: '#fff', padding: '8px 8px', width: '100%', outline: 'none', fontSize: 12 }}
              />
            </div>

            {/* Filter Select */}
            <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.25)', border: `1px solid ${C.border}`, borderRadius: 8, padding: '0 8px' }}>
              <Filter size={13} color={C.muted} style={{ marginRight: 4 }} />
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                style={{ background: '#0a0f1d', border: 'none', color: '#fff', padding: '8px 4px', outline: 'none', fontSize: 12, cursor: 'pointer' }}
              >
                <option value="all">All Statuses</option>
                <option value="Verified">Verified</option>
                <option value="Mismatch">Mismatch</option>
                <option value="Missing">Missing</option>
                <option value="Completed">Completed</option>
              </select>
            </div>
          </div>
        </div>

        {/* Usage Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}`, background: 'rgba(255,255,255,0.02)' }}>
                <th onClick={() => handleSortToggle('client_name')} style={{ padding: '14px 18px', color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', cursor: 'pointer' }}>
                  Client Name {sortField === 'client_name' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th onClick={() => handleSortToggle('business_name')} style={{ padding: '14px 18px', color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', cursor: 'pointer' }}>
                  Business Name {sortField === 'business_name' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th onClick={() => handleSortToggle('searches')} style={{ padding: '14px 18px', color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', textAlign: 'center', cursor: 'pointer' }}>
                  Total Searches {sortField === 'searches' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th onClick={() => handleSortToggle('credits')} style={{ padding: '14px 18px', color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', textAlign: 'center', cursor: 'pointer' }}>
                  Credits Used {sortField === 'credits' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th onClick={() => handleSortToggle('last_scan')} style={{ padding: '14px 18px', color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', cursor: 'pointer' }}>
                  Last Scan Date & Time {sortField === 'last_scan' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th style={{ padding: '14px 18px', color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', textAlign: 'center' }}>
                  Scan Status
                </th>
                <th style={{ padding: '14px 18px', color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', textAlign: 'right' }}>
                  Avg Credits / Scan
                </th>
              </tr>
            </thead>
            <tbody>
              {loadingTable ? (
                <tr>
                  <td colSpan={8} style={{ padding: '40px 0', textAlign: 'center', color: C.muted }}>
                    <RefreshCw size={22} className="animate-spin" style={{ margin: '0 auto 10px display: block' }} />
                    Loading client usage data...
                  </td>
                </tr>
              ) : clientsData.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '40px 0', textAlign: 'center', color: C.muted }}>
                    No client usage records found.
                  </td>
                </tr>
              ) : (
                clientsData.map(client => {
                  let statusBg = 'rgba(255,255,255,0.05)';
                  let statusColor = C.muted;
                  if (client.scanStatus === 'Verified') {
                    statusBg = 'rgba(16,185,129,0.1)';
                    statusColor = '#10b981';
                  } else if (client.scanStatus === 'Mismatch') {
                    statusBg = 'rgba(239,68,68,0.1)';
                    statusColor = '#ef4444';
                  } else if (client.scanStatus === 'Missing') {
                    statusBg = 'rgba(249,115,22,0.1)';
                    statusColor = '#f97316';
                  }

                  return (
                    <tr
                      key={client.clientId}
                      onClick={() => handleRowClick(client)}
                      style={{ borderBottom: `1px solid ${C.border}`, cursor: 'pointer', transition: 'background 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '14px 18px', fontSize: 13, fontWeight: 700, color: '#fff' }}>
                        {client.clientName}
                      </td>
                      <td style={{ padding: '14px 18px', fontSize: 13, color: C.text }}>
                        {client.businessName}
                      </td>
                      <td style={{ padding: '14px 18px', fontSize: 13, fontWeight: 600, color: '#38bdf8', textAlign: 'center' }}>
                        {client.totalSearches}
                      </td>
                      <td style={{ padding: '14px 18px', fontSize: 13, fontWeight: 700, color: '#f97316', textAlign: 'center' }}>
                        {client.creditsUsed}
                      </td>
                      <td style={{ padding: '14px 18px', fontSize: 12, color: C.muted }}>
                        {client.lastScanDate} {client.lastScanTime !== '—' && <span style={{ color: '#fff', fontSize: 11 }}>({client.lastScanTime})</span>}
                      </td>
                      <td style={{ padding: '14px 18px', textAlign: 'center' }}>
                        <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: statusBg, color: statusColor, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          {client.scanStatus}
                        </span>
                      </td>
                      <td style={{ padding: '14px 18px', fontSize: 13, fontWeight: 600, color: '#a7f3d0', textAlign: 'right' }}>
                        {client.avgCreditsPerScan}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer / Pagination */}
        {pagination.totalPages > 1 && (
          <div style={{ padding: '14px 22px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.01)' }}>
            <span style={{ fontSize: 12, color: C.muted }}>
              Showing {Math.min((pagination.page - 1) * pagination.limit + 1, pagination.totalCount)} to {Math.min(pagination.page * pagination.limit, pagination.totalCount)} of {pagination.totalCount} clients
            </span>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={() => fetchClientsUsage(pagination.page - 1)}
                disabled={pagination.page <= 1}
                style={{ padding: '6px 12px', background: pagination.page <= 1 ? 'rgba(255,255,255,0.02)' : C.surface, border: `1px solid ${C.border}`, borderRadius: 6, color: pagination.page <= 1 ? C.muted : '#fff', cursor: pagination.page <= 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', padding: '0 8px' }}>
                {pagination.page} / {pagination.totalPages}
              </span>
              <button
                onClick={() => fetchClientsUsage(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages}
                style={{ padding: '6px 12px', background: pagination.page >= pagination.totalPages ? 'rgba(255,255,255,0.02)' : C.surface, border: `1px solid ${C.border}`, borderRadius: 6, color: pagination.page >= pagination.totalPages ? C.muted : '#fff', cursor: pagination.page >= pagination.totalPages ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}

      </div>

      {/* ═══ Client Details Drawer / Modal ═══ */}
      {selectedClient && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 99999, padding: 20 }}>
          <div style={{ background: C.surface, width: '100%', maxWidth: 780, maxHeight: '88vh', borderRadius: 16, border: `1px solid ${C.border}`, overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column' }}>

            {/* Modal Header */}
            <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, rgba(249,115,22,0.08) 0%, transparent 100%)' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#fff', fontFamily: "'Syne', sans-serif" }}>
                  {selectedClient.businessName}
                </h2>
                <p style={{ margin: 0, color: C.muted, fontSize: 12, marginTop: 2 }}>
                  Client Contact: <strong style={{ color: '#fff' }}>{selectedClient.clientName}</strong>
                </p>
              </div>
              <button
                onClick={() => { setSelectedClient(null); setClientDetails(null); }}
                style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`, borderRadius: 8, padding: 6, cursor: 'pointer', color: C.muted }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Content */}
            <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
              {loadingDetails ? (
                <div style={{ textAlign: 'center', padding: '60px 0', color: C.muted }}>
                  <RefreshCw size={28} className="animate-spin" style={{ margin: '0 auto 12px display: block' }} />
                  Loading client API metrics & directory breakdown...
                </div>
              ) : clientDetails ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

                  {/* Summary Metric Strip */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, background: 'rgba(0,0,0,0.25)', border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
                    <div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase' }}>Citation Scans</span>
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginTop: 2 }}>{clientDetails.metrics.totalCitationScans}</div>
                    </div>
                    <div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase' }}>SERP Requests</span>
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#38bdf8', marginTop: 2 }}>{clientDetails.metrics.totalValueSerpRequests}</div>
                    </div>
                    <div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase' }}>Credits Consumed</span>
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#f97316', marginTop: 2 }}>{clientDetails.metrics.totalCreditsConsumed}</div>
                    </div>
                    <div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase' }}>First Scan Date</span>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginTop: 4 }}>{clientDetails.metrics.firstScanDate}</div>
                    </div>
                    <div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase' }}>Last Scan Date</span>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginTop: 4 }}>{clientDetails.metrics.lastScanDate}</div>
                    </div>
                    <div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase' }}>Last Scan Duration</span>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#a7f3d0', marginTop: 4 }}>
                        {clientDetails.metrics.lastScanDurationMs > 0 ? `${(clientDetails.metrics.lastScanDurationMs / 1000).toFixed(1)}s` : '—'}
                      </div>
                    </div>
                  </div>

                  {/* Directory-wise Usage */}
                  <div>
                    <h3 style={{ fontSize: 13, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
                      Directory-Wise Usage
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                      {clientDetails.directoryUsage.length === 0 ? (
                        <div style={{ fontSize: 12, color: C.muted }}>No directory requests logged.</div>
                      ) : (
                        clientDetails.directoryUsage.map((dirItem, idx) => (
                          <div key={idx} style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{dirItem.directory}</div>
                            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Requests: <strong style={{ color: '#38bdf8' }}>{dirItem.requestCount}</strong></div>
                            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Credits: <strong style={{ color: '#f97316' }}>{dirItem.creditsConsumed}</strong></div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Scan History Log */}
                  <div>
                    <h3 style={{ fontSize: 13, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
                      Recent ValueSERP API Request Logs
                    </h3>
                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: `1px solid ${C.border}` }}>
                            <th style={{ padding: '10px 12px', color: C.muted, fontWeight: 700 }}>Request Time</th>
                            <th style={{ padding: '10px 12px', color: C.muted, fontWeight: 700 }}>Directory</th>
                            <th style={{ padding: '10px 12px', color: C.muted, fontWeight: 700 }}>Query</th>
                            <th style={{ padding: '10px 12px', color: C.muted, fontWeight: 700, textAlign: 'center' }}>Credits</th>
                            <th style={{ padding: '10px 12px', color: C.muted, fontWeight: 700, textAlign: 'center' }}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {clientDetails.scanHistory.length === 0 ? (
                            <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: C.muted }}>No scan history logged.</td></tr>
                          ) : (
                            clientDetails.scanHistory.map(item => (
                              <tr key={item.id} style={{ borderBottom: `1px solid ${C.border}50` }}>
                                <td style={{ padding: '10px 12px', color: C.muted }}>{item.requestTime}</td>
                                <td style={{ padding: '10px 12px', fontWeight: 600, color: '#fff' }}>{item.directory}</td>
                                <td style={{ padding: '10px 12px', color: C.text, maxWidth: 240, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={item.searchQuery}>
                                  {item.searchQuery}
                                </td>
                                <td style={{ padding: '10px 12px', fontWeight: 700, color: '#f97316', textAlign: 'center' }}>{item.creditsConsumed}</td>
                                <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                  <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700, background: item.isCached ? 'rgba(59,130,246,0.1)' : 'rgba(16,185,129,0.1)', color: item.isCached ? '#60a5fa' : '#10b981' }}>
                                    {item.isCached ? 'Cached Result' : `Live (${item.responseStatus})`}
                                  </span>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                </div>
              ) : null}
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
