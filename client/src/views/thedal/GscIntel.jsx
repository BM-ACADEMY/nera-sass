import React, { useState, useEffect } from 'react';
import SopModal from '../../components/common/SopModal.jsx';
import { C } from '../../constants/theme.js';
import { 
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar
} from 'recharts';
import { LineChart, Loader2, Search, Globe, Smartphone, Calendar, CheckCircle2, AlertCircle, MousePointerClick, Eye, Target, TrendingUp, TrendingDown, RefreshCw, Zap } from 'lucide-react';
import { api } from '../../services/api.js';
import toast from 'react-hot-toast';
import GscWorkspace, { GscSectionNav } from './GscWorkspace.jsx';

export default function GscIntel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  
  // Filters State
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState('');
  const [propertyType, setPropertyType] = useState('sc-domain'); // 'sc-domain' or 'url-prefix'
  const [dateRange, setDateRange] = useState('28Days');
  const [device, setDevice] = useState('All');
  const [country, setCountry] = useState('All');
  const [searchType, setSearchType] = useState('web');
  const [queryRegex, setQueryRegex] = useState('');
  const [activeTab, setActiveTab] = useState('topQueries');
  const [showDateModal, setShowDateModal] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [tempDateRange, setTempDateRange] = useState('28Days');
  const [tempStartDate, setTempStartDate] = useState('');
  const [tempEndDate, setTempEndDate] = useState('');
  
  // Interactive GSC/Semrush Metric Toggles
  const [activeMetrics, setActiveMetrics] = useState({
    clicks: true,
    impressions: true,
    ctr: false,
    position: false
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('clicks');
  const [sortDirection, setSortDirection] = useState('desc');
  const [tablePage, setTablePage] = useState(1);
  const [activeDropdown, setActiveDropdown] = useState(null); // 'date' | 'device' | 'country' | 'addFilter' | null
  const [gscSection, setGscSection] = useState('overview');

  useEffect(() => {
    const handleOutsideClick = () => {
      setActiveDropdown(null);
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, []);

  const toggleMetric = (key) => {
    setActiveMetrics(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  useEffect(() => {
    const loadClients = async () => {
      try {
        const res = await api.get('/thedal/clients');
        const clientList = Array.isArray(res) ? res : (res?.clients || []);
        setClients(clientList);
        if (clientList.length > 0) {
          let defaultUrl = clientList[0].domain || '';
          if (defaultUrl) {
            defaultUrl = defaultUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
            setSelectedClient(defaultUrl);
          } else {
            setLoading(false);
          }
        } else {
          setLoading(false); // Clear loader if no clients
        }
      } catch (err) {
        console.error('Failed to load clients', err);
        setLoading(false); // Clear loader on error
        setErrorMsg('Failed to fetch clients from database.');
      }
    };
    loadClients();
  }, []);

  const fetchData = async () => {
    if (!selectedClient) return; // Wait until a client is selected
    setLoading(true);
    setErrorMsg('');
    try {
      const siteUrl = propertyType === 'sc-domain' ? 'sc-domain:' + selectedClient : 'https://' + selectedClient + '/';
      
      const queryParams = {
        clientId: 'default',
        siteUrl,
        device,
        country,
        searchType,
        ...(queryRegex && { queryFilter: queryRegex, queryOperator: 'includingRegex' })
      };

      if (dateRange === 'Custom' && startDate && endDate) {
        queryParams.startDate = startDate;
        queryParams.endDate = endDate;
      } else {
        queryParams.days = dateRange;
      }

      const params = new URLSearchParams(queryParams);
      const res = await api.get(`/thedal/gscintel?${params.toString()}`);
      if (res) {
        if (res.isVerified === false) {
          setData(res);
          setErrorMsg('');
        } else if (res.error) {
          setErrorMsg(res.error);
        } else {
          setData(res);
          setErrorMsg('');
        }
      }
    } catch (err) {
      console.error('Failed to load data', err);
      setErrorMsg(err.message || 'Failed to fetch GSC data');
    } finally {
      setLoading(false);
    }
  };

  const reconnectGoogle = async () => {
    try {
      await api.delete('/thedal/gscintel/connection?clientId=default');
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3600';
      window.location.href = `${apiUrl}/api/thedal/gscintel/auth/google?clientId=default`;
    } catch (err) {
      console.error('Failed to reset Google connection', err);
      toast.error(err.message || 'Could not reset the Google connection');
    }
  };

  useEffect(() => {
    if (selectedClient) {
      if (dateRange === 'Custom') {
        if (startDate && endDate) {
          fetchData();
        }
      } else {
        fetchData();
      }
    }
  }, [selectedClient, dateRange, device, country, searchType, propertyType, startDate, endDate]);

  // Reset page index on sorting, filtering, or tab changes
  useEffect(() => {
    setTablePage(1);
  }, [activeTab, searchTerm, sortField, sortDirection, selectedClient, dateRange, device, country, searchType, propertyType, startDate, endDate]);

  const handlePushToPage1 = async (query) => {
    const toastId = toast.loading(`Mapping keyword "${query}"...`);
    try {
      const targetUrl = 'https://' + selectedClient;
      await api.post('/thedal/keywordtracking', { keyword: query, targetUrl });
      toast.success(`Successfully mapped keyword "${query}" to Keyword Map!`, { id: toastId });
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Failed to map keyword.', { id: toastId });
    }
  };

  if (loading && !data) {
    return (
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', background: C.bg }}>
        <Loader2 size={32} color={C.accent} className="spin" />
      </div>
    );
  }

  // Derived data based on UI toggles
  const metrics = data?.metrics || { clicks: 0, impressions: 0, ctr: '0.00', position: '0.0', trends: { clicks: 0, impressions: 0, ctr: 0, position: 0 } };
  const timeseries = data?.timeseries || [];
  const devices = data?.devices || [];
  const countries = data?.countries || [];
  const queries = data?.queries || [];
  const pages = data?.pages || [];
    
  let currentTableData = [];
  if (activeTab === 'topQueries') {
    currentTableData = queries;
  } else if (activeTab === 'topPages') {
    currentTableData = pages;
  } else if (activeTab === 'quickWins') {
    currentTableData = queries
      .filter(q => parseFloat(q.position) >= 11 && parseFloat(q.position) <= 20)
      .sort((a, b) => b.impressions - a.impressions);
  } else if (activeTab === 'searchAppearance') {
    currentTableData = data?.searchAppearances || [];
  }

  // Handle Sort Toggle
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Filter and Sort Table Data
  let processedTableData = [...currentTableData];
  if (searchTerm.trim()) {
    const s = searchTerm.toLowerCase();
    processedTableData = processedTableData.filter(item => {
      const text = (item.query || item.page || item.appearance || '').toLowerCase();
      return text.includes(s);
    });
  }
  processedTableData.sort((a, b) => {
    let valA = a[sortField];
    let valB = b[sortField];

    if (sortField === 'clicks' || sortField === 'impressions' || sortField === 'ctr' || sortField === 'position') {
      valA = parseFloat(valA) || 0;
      valB = parseFloat(valB) || 0;
    } else {
      valA = (valA || '').toString().toLowerCase();
      valB = (valB || '').toString().toLowerCase();
    }

    if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
    if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });



  const itemsPerPage = 10;
  const totalItems = processedTableData.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  const activePage = Math.min(tablePage, totalPages);
  const startIndex = (activePage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
  const currentTableItems = processedTableData.slice(startIndex, endIndex);

  const MetricCard = ({ title, value, trend, color, reverseGood = false, metricKey }) => {
    const isActive = activeMetrics[metricKey];
    const isPositive = reverseGood ? trend < 0 : trend > 0;
    const trendColor = isActive ? '#ffffff' : (isPositive ? '#22c55e' : '#ef4444');
    const TrendIcon = isPositive ? TrendingUp : TrendingDown;
    
    const bgColors = {
      clicks: 'rgba(59, 130, 246, 0.95)',
      impressions: 'rgba(139, 92, 246, 0.95)',
      ctr: 'rgba(16, 185, 129, 0.95)',
      position: 'rgba(245, 158, 11, 0.95)'
    };
    
    return (
      <div 
        onClick={() => toggleMetric(metricKey)}
        style={{ 
          background: isActive ? bgColors[metricKey] : 'rgba(255, 255, 255, 0.02)', 
          border: `1px solid ${isActive ? color : C.border}`,
          borderTop: `4px solid ${color}`,
          borderRadius: 8, 
          padding: '16px 20px',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minHeight: 105,
          flex: 1,
          boxShadow: isActive ? `0 10px 20px ${color}20` : 'none',
          transform: isActive ? 'translateY(-2px)' : 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <input 
            type="checkbox" 
            checked={isActive} 
            onChange={() => {}} 
            style={{ 
              accentColor: isActive ? '#fff' : color, 
              cursor: 'pointer',
              width: 14,
              height: 14
            }} 
          />
          <span style={{ fontSize: 13, color: isActive ? '#fff' : C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{title}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#fff' }}>{value}</div>
          {trend !== undefined && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: trendColor, fontWeight: 600 }}>
              <TrendIcon size={14} />
              {Math.abs(trend)}%
            </div>
          )}
        </div>
      </div>
    );
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1; // 0-indexed
        const day = parseInt(parts[2], 10);
        const d = new Date(year, month, day);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
      return dateStr;
    } catch (e) {
      return dateStr;
    }
  };

  const exportPerformanceCsv = () => {
    const rows = activeTab === 'topPages' ? (data?.pages || []) : activeTab === 'searchAppearance' ? (data?.searchAppearances || []) : (data?.queries || []);
    if (!rows.length) return toast.error('No rows to export');
    const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
    const csv = [columns.join(','), ...rows.map(row => columns.map(key => `"${String(row[key] ?? '').replaceAll('"', '""')}"`).join(','))].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    link.download = `gsc-${activeTab}-${selectedClient}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const activeSiteUrl = propertyType === 'sc-domain' ? `sc-domain:${selectedClient}` : `https://${selectedClient}/`;
  if (gscSection !== 'performance') {
    return <GscWorkspace active={gscSection} onChange={setGscSection} siteUrl={activeSiteUrl} domain={selectedClient} performanceData={data} onSync={fetchData} />;
  }

  return (
    <div className="p-mobile" style={{ padding: '26px', color: C.text, height: '100%', overflowY: 'auto', background: C.bg }}>
      
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 }} className="flex-col-mobile gap-mobile">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><h1 style={{ fontSize: 28, fontWeight: 800, color: '#e2e8f0', margin: 0, fontFamily: "'Syne', sans-serif" }}>GSC Intel</h1><SopModal /></div>
          <p style={{ color: C.muted, fontSize: 14, marginTop: 4 }}>Live Google Search Console traffic analysis.</p>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <select 
            value={selectedClient} 
            onChange={(e) => setSelectedClient(e.target.value)}
            style={{ background: C.surface, border: `1px solid ${C.border}`, color: '#fff', padding: '10px 16px', borderRadius: 8, fontSize: 14, outline: 'none', cursor: 'pointer' }}
          >
            {clients.map(client => {
              let url = client.domain || '';
              url = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
              const displayName = client.business_name || client.client_name || 'Unnamed Client';
              return <option key={client.id} value={url} style={{ background: '#1e293b', color: '#fff' }}>{displayName} ({url})</option>
            })}
            {clients.length === 0 && <option value="" style={{ background: '#1e293b', color: '#fff' }}>No clients found</option>}
          </select>
          <select
            value={propertyType}
            onChange={(e) => setPropertyType(e.target.value)}
            style={{ background: C.surface, border: `1px solid ${C.border}`, color: '#fff', padding: '10px 16px', borderRadius: 8, fontSize: 14, outline: 'none', cursor: 'pointer' }}
          >
            <option value="sc-domain">Domain (sc-domain:)</option>
            <option value="url-prefix">URL-Prefix (https://.../)</option>
          </select>
          <select
            value={searchType}
            onChange={(e) => setSearchType(e.target.value)}
            style={{ background: C.surface, border: `1px solid ${C.border}`, color: '#fff', padding: '10px 16px', borderRadius: 8, fontSize: 14, outline: 'none', cursor: 'pointer' }}
          >
            <option value="web">Web</option>
            <option value="image">Image</option>
            <option value="video">Video</option>
            <option value="news">Search News tab</option>
            <option value="discover">Discover</option>
            <option value="googleNews">Google News</option>
          </select>
          <input value={queryRegex} onChange={e => setQueryRegex(e.target.value)} placeholder="Query regex filter" title="Google RE2 regular expression; applied when Sync Data is clicked" style={{ background: C.surface, border: `1px solid ${C.border}`, color: '#fff', padding: '10px 12px', borderRadius: 8, width: 170 }} />
          <button onClick={fetchData} style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            <RefreshCw size={16} /> Sync Data
          </button>
          <button onClick={exportPerformanceCsv} style={{ background: C.surface, color: '#fff', border: `1px solid ${C.border}`, padding: '10px 16px', borderRadius: 8, cursor: 'pointer' }}>Export CSV</button>
        </div>
      </div>

      <GscSectionNav active={gscSection} onChange={setGscSection} />

      {/* GSC STYLE PERFORMANCE FILTER BAR */}
      <div style={{ background: 'rgba(255,255,255,0.01)', border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 20px', marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        
        {/* Date Tabs and Filter Pills Row */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, justifyContent: 'space-between' }}>
          
          {/* Left Side: Date Tabs + Pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
            
            {/* Quick Date Tabs */}
            <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.03)', border: `1px solid ${C.border}`, borderRadius: 20, overflow: 'hidden', padding: 2 }}>
              {[
                { label: '24 hours', value: '24Hours' },
                { label: '7 days', value: '7Days' },
                { label: '28 days', value: '28Days' },
                { label: '3 months', value: '3Months' }
              ].map((tab) => {
                const isSelected = dateRange === tab.value;
                return (
                  <button
                    key={tab.value}
                    onClick={() => {
                      setDateRange(tab.value);
                      setStartDate('');
                      setEndDate('');
                    }}
                    style={{
                      background: isSelected ? '#3b82f6' : 'transparent',
                      color: isSelected ? '#fff' : C.text,
                      border: 'none',
                      padding: '5px 14px',
                      borderRadius: 18,
                      fontSize: 12,
                      fontWeight: isSelected ? 600 : 500,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      transition: 'all 0.2s'
                    }}
                  >
                    {isSelected && <span style={{ fontSize: 9 }}>✓</span>}
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div style={{ width: 1, height: 20, background: C.border }} className="hide-mobile"></div>

            {/* GSC Pills Container */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, position: 'relative' }}>
              
              {/* Static Search Type Pill */}
              <div style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: `1px solid ${C.border}`,
                borderRadius: 20,
                padding: '6px 14px',
                fontSize: 12,
                color: '#e2e8f0',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}>
                <span style={{ color: C.muted }}>Search type:</span>
                <span style={{ fontWeight: 600, color: '#60a5fa' }}>Web</span>
              </div>

              {/* Date Range Pill */}
              <div 
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveDropdown(activeDropdown === 'date' ? null : 'date');
                }}
                style={{
                  background: activeDropdown === 'date' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.02)',
                  border: `1px solid ${activeDropdown === 'date' ? '#3b82f6' : C.border}`,
                  borderRadius: 20,
                  padding: '6px 14px',
                  fontSize: 12,
                  color: '#e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  position: 'relative'
                }}
              >
                <span style={{ color: C.muted }}>Date:</span>
                <span style={{ fontWeight: 600, color: '#3b82f6' }}>
                  {dateRange === '24Hours' ? 'Last 24 hours' :
                   dateRange === '7Days' ? 'Last 7 days' :
                   dateRange === '28Days' ? 'Last 28 days' :
                   dateRange === '3Months' ? 'Last 3 months' :
                   dateRange === '6Months' ? 'Last 6 months' :
                   dateRange === '12Months' ? 'Last 12 months' :
                   dateRange === '16Months' ? 'Last 16 months' :
                   dateRange === 'Custom' ? `${formatDate(startDate)} - ${formatDate(endDate)}` : ''}
                </span>
                <span style={{ fontSize: 9, color: C.muted }}>▼</span>
                
                {/* Date Dropdown */}
                {activeDropdown === 'date' && (
                  <div style={{
                    position: 'absolute',
                    top: '115%',
                    left: 0,
                    background: '#151c2c',
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
                    zIndex: 50,
                    minWidth: 160,
                    overflow: 'hidden'
                  }} onClick={e => e.stopPropagation()}>
                    {[
                      { label: 'Last 24 hours', value: '24Hours' },
                      { label: 'Last 7 days', value: '7Days' },
                      { label: 'Last 28 days', value: '28Days' },
                      { label: 'Last 3 months', value: '3Months' },
                      { label: 'Last 6 months', value: '6Months' },
                      { label: 'Last 12 months', value: '12Months' },
                      { label: 'Last 16 months', value: '16Months' },
                      { label: 'Custom...', value: 'CustomTrigger' }
                    ].map(opt => {
                      const isSelected = dateRange === opt.value || (opt.value === 'CustomTrigger' && dateRange === 'Custom');
                      return (
                        <div
                          key={opt.value}
                          onClick={() => {
                            if (opt.value === 'CustomTrigger') {
                              setTempDateRange(dateRange === 'Custom' ? 'Custom' : dateRange);
                              setTempStartDate(startDate);
                              setTempEndDate(endDate);
                              setShowDateModal(true);
                            } else {
                              setDateRange(opt.value);
                              setStartDate('');
                              setEndDate('');
                            }
                            setActiveDropdown(null);
                          }}
                          style={{
                            padding: '10px 14px',
                            cursor: 'pointer',
                            fontSize: 12,
                            color: isSelected ? '#3b82f6' : '#fff',
                            background: isSelected ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                            transition: 'background 0.2s',
                            borderLeft: isSelected ? '3px solid #3b82f6' : '3px solid transparent'
                          }}
                          onMouseEnter={e => e.target.style.background = 'rgba(255,255,255,0.03)'}
                          onMouseLeave={e => e.target.style.background = isSelected ? 'rgba(59, 130, 246, 0.08)' : 'transparent'}
                        >
                          {opt.label}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Device Pill (if active) */}
              {device !== 'All' && (
                <div 
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveDropdown(activeDropdown === 'device' ? null : 'device');
                  }}
                  style={{
                    background: 'rgba(59, 130, 246, 0.08)',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    borderRadius: 20,
                    padding: '6px 14px',
                    fontSize: 12,
                    color: '#93c5fd',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'pointer',
                    position: 'relative'
                  }}
                >
                  <span style={{ color: 'rgba(147, 197, 253, 0.7)' }}>Device:</span>
                  <span style={{ fontWeight: 600 }}>{device === 'Mobile' ? 'Mobile' : 'Desktop'}</span>
                  <span style={{ fontSize: 9 }}>▼</span>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setDevice('All');
                      setActiveDropdown(null);
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#ef4444',
                      cursor: 'pointer',
                      fontSize: 14,
                      fontWeight: 'bold',
                      padding: '0 0 0 6px',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    ×
                  </button>

                  {/* Device Dropdown */}
                  {activeDropdown === 'device' && (
                    <div style={{
                      position: 'absolute',
                      top: '115%',
                      left: 0,
                      background: '#151c2c',
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
                      zIndex: 50,
                      minWidth: 150,
                      overflow: 'hidden'
                    }} onClick={e => e.stopPropagation()}>
                      {[
                        { label: 'Mobile Only', value: 'Mobile' },
                        { label: 'Desktop Only', value: 'Desktop' }
                      ].map(opt => (
                        <div
                          key={opt.value}
                          onClick={() => {
                            setDevice(opt.value);
                            setActiveDropdown(null);
                          }}
                          style={{
                            padding: '10px 14px',
                            cursor: 'pointer',
                            fontSize: 12,
                            color: device === opt.value ? '#3b82f6' : '#fff',
                            background: device === opt.value ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                            transition: 'background 0.2s',
                            borderLeft: device === opt.value ? '3px solid #3b82f6' : '3px solid transparent'
                          }}
                          onMouseEnter={e => e.target.style.background = 'rgba(255,255,255,0.03)'}
                          onMouseLeave={e => e.target.style.background = device === opt.value ? 'rgba(59, 130, 246, 0.08)' : 'transparent'}
                        >
                          {opt.label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Country Pill (if active) */}
              {country !== 'All' && (
                <div 
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveDropdown(activeDropdown === 'country' ? null : 'country');
                  }}
                  style={{
                    background: 'rgba(16, 185, 129, 0.08)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    borderRadius: 20,
                    padding: '6px 14px',
                    fontSize: 12,
                    color: '#a7f3d0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'pointer',
                    position: 'relative'
                  }}
                >
                  <span style={{ color: 'rgba(167, 243, 208, 0.7)' }}>Country:</span>
                  <span style={{ fontWeight: 600 }}>{country.toUpperCase()}</span>
                  <span style={{ fontSize: 9 }}>▼</span>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setCountry('All');
                      setActiveDropdown(null);
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#ef4444',
                      cursor: 'pointer',
                      fontSize: 14,
                      fontWeight: 'bold',
                      padding: '0 0 0 6px',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    ×
                  </button>

                  {/* Country Dropdown */}
                  {activeDropdown === 'country' && (
                    <div style={{
                      position: 'absolute',
                      top: '115%',
                      left: 0,
                      background: '#151c2c',
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
                      zIndex: 50,
                      minWidth: 180,
                      maxHeight: 250,
                      overflowY: 'auto'
                    }} onClick={e => e.stopPropagation()}>
                      {countries.map(opt => (
                        <div
                          key={opt.countryCode}
                          onClick={() => {
                            setCountry(opt.countryCode);
                            setActiveDropdown(null);
                          }}
                          style={{
                            padding: '10px 14px',
                            cursor: 'pointer',
                            fontSize: 12,
                            color: country === opt.countryCode ? '#3b82f6' : '#fff',
                            background: country === opt.countryCode ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                            transition: 'background 0.2s',
                            borderLeft: country === opt.countryCode ? '3px solid #3b82f6' : '3px solid transparent'
                          }}
                          onMouseEnter={e => e.target.style.background = 'rgba(255,255,255,0.03)'}
                          onMouseLeave={e => e.target.style.background = country === opt.countryCode ? 'rgba(59, 130, 246, 0.08)' : 'transparent'}
                        >
                          {opt.countryCode.toUpperCase()} ({(opt.clicks || 0).toLocaleString()} clicks)
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Add Filter Pill Button */}
              <div 
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveDropdown(activeDropdown === 'addFilter' ? null : 'addFilter');
                }}
                style={{
                  background: 'transparent',
                  border: `1px dashed ${C.border}`,
                  borderRadius: 20,
                  padding: '6px 14px',
                  fontSize: 12,
                  color: '#3b82f6',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  cursor: 'pointer',
                  position: 'relative'
                }}
              >
                <span style={{ fontWeight: 600 }}>+</span>
                <span>Add filter</span>
                
                {/* Add Filter Dropdown */}
                {activeDropdown === 'addFilter' && (
                  <div style={{
                    position: 'absolute',
                    top: '115%',
                    left: 0,
                    background: '#151c2c',
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
                    zIndex: 50,
                    minWidth: 150,
                    overflow: 'hidden'
                  }} onClick={e => e.stopPropagation()}>
                    {device === 'All' && (
                      <div
                        onClick={() => {
                          setDevice('Mobile'); 
                          setActiveDropdown('device'); 
                        }}
                        style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 12, color: '#fff' }}
                        onMouseEnter={e => e.target.style.background = 'rgba(255,255,255,0.03)'}
                        onMouseLeave={e => e.target.style.background = 'transparent'}
                      >
                        Device
                      </div>
                    )}
                    {country === 'All' && countries.length > 0 && (
                      <div
                        onClick={() => {
                          setCountry(countries[0].countryCode); 
                          setActiveDropdown('country'); 
                        }}
                        style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 12, color: '#fff' }}
                        onMouseEnter={e => e.target.style.background = 'rgba(255,255,255,0.03)'}
                        onMouseLeave={e => e.target.style.background = 'transparent'}
                      >
                        Country
                      </div>
                    )}
                    {device !== 'All' && country !== 'All' && (
                      <div style={{ padding: '10px 14px', fontSize: 11, color: C.muted, cursor: 'default' }}>
                        All filters active
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Reset Filters Link */}
              {(device !== 'All' || country !== 'All' || dateRange !== '28Days') && (
                <button
                  onClick={() => {
                    setDevice('All');
                    setCountry('All');
                    setDateRange('28Days');
                    setActiveDropdown(null);
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#3b82f6',
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '6px 8px',
                    textDecoration: 'underline'
                  }}
                >
                  Reset filters
                </button>
              )}

            </div>

          </div>

          {/* Right Side: Data freshness display */}
          <div style={{ fontSize: 12, color: C.muted }} className="hide-mobile">
            Last updated: 1 day ago
          </div>

        </div>

      </div>

      {/* VERIFICATION STATE OR ERRORS */}
      {errorMsg ? (
        <div style={{ background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 12, padding: 40, textAlign: 'center', marginBottom: 24 }}>
          <AlertCircle size={48} color="#ef4444" style={{ margin: '0 auto 20px' }} />
          <h2 style={{ fontSize: 22, color: '#fff', margin: '0 0 10px 0' }}>
            {errorMsg.includes('Access Denied') ? 'Permission Required' : errorMsg.includes('Search Console API is disabled') ? 'API Setup Required' : 'API Error'}
          </h2>
          
          {errorMsg.includes('Search Console API is disabled') ? (
            <div style={{ textAlign: 'left', maxWidth: 600, margin: '0 auto 30px', background: 'rgba(0,0,0,0.2)', padding: 24, borderRadius: 12, border: `1px solid ${C.border}` }}>
              <p style={{ color: '#fff', fontSize: 15, marginTop: 0 }}>OAuth is connected, but the Search Console API is disabled for this Google Cloud project.</p>
              <ol style={{ color: C.muted, paddingLeft: 20, lineHeight: 1.8, fontSize: 14 }}>
                <li>Open the Google Cloud API Library using the same project as your OAuth client.</li>
                <li>Enable <strong>Google Search Console API</strong>.</li>
                <li>Wait a few minutes for Google to apply the change, then click Retry Request.</li>
              </ol>
              <a href="https://console.cloud.google.com/apis/library/searchconsole.googleapis.com" target="_blank" rel="noreferrer" style={{ color: '#60a5fa', fontSize: 14 }}>Open Search Console API in Google Cloud</a>
            </div>
          ) : errorMsg.includes('Access Denied') ? (
            <div style={{ textAlign: 'left', maxWidth: 600, margin: '0 auto 30px', background: 'rgba(0,0,0,0.2)', padding: 24, borderRadius: 12, border: `1px solid ${C.border}` }}>
              <p style={{ color: '#fff', fontSize: 15, marginTop: 0, marginBottom: 16 }}>
                Google blocked this request because your connected account doesn't have access to this website. To fix this instantly:
              </p>
              <ol style={{ color: C.muted, paddingLeft: 20, margin: 0, lineHeight: 1.8, fontSize: 14 }}>
                <li>Log into your <strong>Google Search Console</strong> dashboard.</li>
                <li>Select this domain in your property list.</li>
                <li>Go to <strong>Settings</strong> → <strong>Users and permissions</strong>.</li>
                <li>Click <strong>Add User</strong> and add the email address you just connected with.</li>
                <li>Come back here and click Retry!</li>
              </ol>
            </div>
          ) : (
            <p style={{ color: C.muted, maxWidth: 600, margin: '0 auto 30px', lineHeight: 1.6 }}>{errorMsg}</p>
          )}

          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button onClick={fetchData} style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>Retry Request</button>
            {errorMsg.includes('Access Denied') && (
              <button onClick={reconnectGoogle} style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                Connect with another Google account
              </button>
            )}
          </div>
        </div>
      ) : data && !data.isVerified ? (
        <div style={{ background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 12, padding: 40, textAlign: 'center' }}>
          <AlertCircle size={48} color="#ef4444" style={{ margin: '0 auto 20px' }} />
          <h2 style={{ fontSize: 22, color: '#fff', margin: '0 0 10px 0' }}>Property Not Verified</h2>
          <p style={{ color: C.muted, maxWidth: 500, margin: '0 auto 30px', lineHeight: 1.6 }}>
            You must verify ownership of this website in Google Search Console before we can pull the live traffic metrics. 
            Connect your Google account to generate the secure OAuth token.
          </p>
          <button 
            onClick={() => {
              const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3600';
              window.location.href = `${apiUrl}/api/thedal/gscintel/auth/google?clientId=default`;
            }}
            style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
          >
            Verify with Google
          </button>
        </div>
      ) : (
        <>
          {/* DELAY WARNING */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)', padding: '12px 20px', borderRadius: 8, marginBottom: 24, color: '#f59e0b', fontSize: 13, fontWeight: 500 }}>
            <AlertCircle size={16} />
            <span><strong>Data Freshness:</strong> Please note that Google Search Console data is typically delayed by 2-3 days according to Google's official processing schedule.</span>
          </div>

          {/* METRICS GRID */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 10 }}>
            <MetricCard title="Total Clicks" value={(metrics.clicks || 0).toLocaleString()} trend={metrics.trends?.clicks || 0} icon={MousePointerClick} color="#3b82f6" metricKey="clicks" />
            <MetricCard title="Total Impressions" value={(metrics.impressions || 0).toLocaleString()} trend={metrics.trends?.impressions || 0} icon={Eye} color="#8b5cf6" metricKey="impressions" />
            <MetricCard title="Average CTR" value={`${metrics.ctr || '0.00'}%`} trend={metrics.trends?.ctr || 0} icon={Target} color="#10b981" metricKey="ctr" />
            <MetricCard title="Average Position" value={metrics.position || '0.0'} trend={metrics.trends?.position || 0} icon={LineChart} color="#f59e0b" reverseGood={true} metricKey="position" />
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 20, textAlign: 'right' }}>
            Last updated: 1 hour ago
          </div>

          {/* ADVANCED PERFORMANCE VISUALIZATION CANVAS */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24, marginBottom: 24 }} className="flex-col-mobile">
            
            {/* Performance Area Chart */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 24px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, color: '#fff', fontWeight: 600 }}>Performance Search Trends</h3>
                  <p style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>Daily clicks, impressions, CTR, and positions search patterns</p>
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
                  {activeMetrics.clicks && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6' }} /> <span style={{ color: C.text }}>Clicks</span></div>}
                  {activeMetrics.impressions && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 8, height: 8, borderRadius: '50%', background: '#8b5cf6' }} /> <span style={{ color: C.text }}>Impressions</span></div>}
                  {activeMetrics.ctr && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} /> <span style={{ color: C.text }}>CTR</span></div>}
                  {activeMetrics.position && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b' }} /> <span style={{ color: C.text }}>Position</span></div>}
                </div>
              </div>
              
              <div style={{ height: 220, width: '100%' }}>
                {timeseries && timeseries.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timeseries}>
                      <defs>
                        <linearGradient id="clicksGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="impressionsGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="ctrGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="positionGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <XAxis 
                        dataKey="date" 
                        tickFormatter={(val) => {
                          try {
                            const d = new Date(val);
                            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                          } catch(e) { return val; }
                        }} 
                        tick={{ fill: C.muted, fontSize: 10 }} 
                        axisLine={false} 
                        tickLine={false} 
                      />
                      <YAxis yAxisId="left" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="right" orientation="right" reversed={true} tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: '#fff', fontSize: 12 }} />
                      
                      {activeMetrics.clicks && (
                        <Area yAxisId="left" type="monotone" dataKey="clicks" name="Clicks" stroke="#3b82f6" fillOpacity={1} fill="url(#clicksGrad)" strokeWidth={2} />
                      )}
                      {activeMetrics.impressions && (
                        <Area yAxisId="left" type="monotone" dataKey="impressions" name="Impressions" stroke="#8b5cf6" fillOpacity={1} fill="url(#impressionsGrad)" strokeWidth={2} />
                      )}
                      {activeMetrics.ctr && (
                        <Area yAxisId="left" type="monotone" dataKey="ctr" name="CTR (%)" stroke="#10b981" fillOpacity={1} fill="url(#ctrGrad)" strokeWidth={2} />
                      )}
                      {activeMetrics.position && (
                        <Area yAxisId="right" type="monotone" dataKey="position" name="Average Position" stroke="#f59e0b" fillOpacity={1} fill="url(#positionGrad)" strokeWidth={2} />
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 14 }}>
                    No daily historical trend data available.
                  </div>
                )}
              </div>
            </div>

            {/* Sidebar share panels */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              
              {/* Devices share */}
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 20px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: 14, color: '#fff', fontWeight: 600 }}>Device Share (Clicks)</h4>
                
                {devices && devices.length > 0 ? (
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div style={{ width: 100, height: 100 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie 
                            data={devices} 
                            dataKey="clicks" 
                            nameKey="device" 
                            cx="50%" 
                            cy="50%" 
                            innerRadius={25} 
                            outerRadius={45} 
                            paddingAngle={3}
                          >
                            {devices.map((entry, index) => {
                              const colors = { mobile: '#3b82f6', desktop: '#8b5cf6', tablet: '#10b981' };
                              return <Cell key={`cell-${index}`} fill={colors[entry.device] || '#64748b'} />;
                            })}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {devices.map((d, i) => {
                        const colors = { mobile: '#3b82f6', desktop: '#8b5cf6', tablet: '#10b981' };
                        const totalClicks = devices.reduce((acc, curr) => acc + curr.clicks, 0) || 1;
                        const pct = Math.round((d.clicks / totalClicks) * 100);
                        return (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ width: 8, height: 8, borderRadius: '50%', background: colors[d.device] || '#64748b' }} />
                              <span style={{ color: C.muted, textTransform: 'capitalize' }}>{d.device}</span>
                            </div>
                            <span style={{ color: '#fff', fontWeight: 600 }}>{pct}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div style={{ color: C.muted, fontSize: 12, textAlign: 'center', padding: '16px 0' }}>No device share data found</div>
                )}
              </div>

              {/* Geo/Country list bar chart */}
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 20px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: 14, color: '#fff', fontWeight: 600 }}>Top Countries (Clicks)</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {countries && countries.length > 0 ? (
                    countries.slice(0, 3).map((c, i) => {
                      const totalCountryClicks = countries.reduce((acc, curr) => acc + curr.clicks, 0) || 1;
                      const pct = Math.round((c.clicks / totalCountryClicks) * 100);
                      return (
                        <div key={i}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                            <span style={{ color: '#fff', fontWeight: 500 }}>{c.countryCode.toUpperCase()}</span>
                            <span style={{ color: C.muted }}>{(c.clicks || 0).toLocaleString()} clicks</span>
                          </div>
                          <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: '#10b981', borderRadius: 3 }} />
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div style={{ color: C.muted, fontSize: 12, textAlign: 'center' }}>No location data found</div>
                  )}
                </div>
              </div>

            </div>

          </div>

          {(!queries || queries.length === 0) ? (
            <div style={{ background: 'rgba(255,255,255,0.02)', padding: 60, textAlign: 'center', borderRadius: 12, border: `1px dashed ${C.border}` }}>
              <h2 style={{ fontSize: 20, color: '#fff', marginBottom: 10 }}>No Data Available Yet</h2>
              <p style={{ color: C.muted, fontSize: 15 }}>GSC data is still being processed by Google. Please check back in 24-48 hours.</p>
            </div>
          ) : (
            <>
              {/* TABS */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                {['topQueries', 'topPages', 'searchAppearance', 'quickWins'].map((tab) => {
                  const tabLabels = {
                    'topQueries': 'Top Queries',
                    'topPages': 'Top Pages',
                    'searchAppearance': 'Search Appearance',
                    'quickWins': 'Quick Wins ⚡'
                  };
                  return (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      style={{
                        background: activeTab === tab ? '#3b82f6' : 'rgba(255,255,255,0.02)',
                        color: activeTab === tab ? '#fff' : C.text,
                        border: `1px solid ${activeTab === tab ? '#3b82f6' : C.border}`,
                        padding: '10px 20px',
                        borderRadius: 8,
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      {tabLabels[tab]}
                    </button>
                  );
                })}
              </div>

              {/* DATA TABLE */}
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '20px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} className="flex-responsive gap-mobile">
                  <h3 style={{ margin: 0, fontSize: 16, color: '#fff', fontWeight: 600 }}>
                    {activeTab === 'topQueries' ? 'Top Search Queries' : activeTab === 'topPages' ? 'Top Pages' : activeTab === 'searchAppearance' ? 'Search Appearance' : 'Quick Wins (Page 2 Keywords)'}
                  </h3>
                  <div style={{ display: 'flex', border: `1px solid ${C.border}`, borderRadius: 8, background: '#0a0e14', overflow: 'hidden', width: 260 }}>
                    <div style={{ padding: '8px 12px', color: C.muted, display: 'flex', alignItems: 'center' }}><Search size={14} /></div>
                    <input 
                      type="text" 
                      value={searchTerm} 
                      onChange={(e) => setSearchTerm(e.target.value)} 
                      placeholder={activeTab === 'topPages' ? "Filter URLs..." : activeTab === 'searchAppearance' ? "Filter appearances..." : "Filter keywords..."}
                      style={{ width: '100%', border: 'none', background: 'transparent', color: '#fff', outline: 'none', padding: '6px 8px', fontSize: 13 }}
                    />
                  </div>
                </div>

                <div className="table-responsive">
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: `1px solid ${C.border}` }}>
                        <th onClick={() => handleSort(activeTab === 'topPages' ? 'page' : 'query')} style={{ padding: '16px 20px', color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', cursor: 'pointer', userSelect: 'none' }}>
                          {activeTab === 'topPages' ? 'Page URL' : 'Search Query'} {sortField === (activeTab === 'topPages' ? 'page' : 'query') && (sortDirection === 'asc' ? '▲' : '▼')}
                        </th>
                        <th onClick={() => handleSort('clicks')} style={{ padding: '16px 20px', color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}>
                          Clicks {sortField === 'clicks' && (sortDirection === 'asc' ? '▲' : '▼')}
                        </th>
                        <th onClick={() => handleSort('impressions')} style={{ padding: '16px 20px', color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}>
                          Impressions {sortField === 'impressions' && (sortDirection === 'asc' ? '▲' : '▼')}
                        </th>
                        <th onClick={() => handleSort('ctr')} style={{ padding: '16px 20px', color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}>
                          CTR {sortField === 'ctr' && (sortDirection === 'asc' ? '▲' : '▼')}
                        </th>
                        <th onClick={() => handleSort('position')} style={{ padding: '16px 20px', color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}>
                          Position {sortField === 'position' && (sortDirection === 'asc' ? '▲' : '▼')}
                        </th>
                        {activeTab === 'quickWins' && <th style={{ padding: '16px 20px', color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', textAlign: 'center' }}>Action</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {currentTableItems.length === 0 ? (
                        <tr>
                          <td colSpan={activeTab === 'quickWins' ? 6 : 5} style={{ padding: '40px', textAlign: 'center', color: C.muted }}>
                            No data available for this view.
                          </td>
                        </tr>
                      ) : (
                        currentTableItems.map((item, idx) => (
                          <tr key={idx} style={{ borderBottom: `1px solid ${C.border}55`, transition: 'background 0.2s', ':hover': { background: 'rgba(255,255,255,0.02)' } }}>
                            <td style={{ padding: '16px 20px', fontSize: 14, color: '#e2e8f0', fontWeight: 500, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.page || item.query || item.appearance}>
                              {item.page || item.query || item.appearance}
                            </td>
                            <td style={{ padding: '16px 20px', fontSize: 14, color: '#93c5fd', textAlign: 'right', fontWeight: 600 }}>{item.clicks.toLocaleString()}</td>
                            <td style={{ padding: '16px 20px', fontSize: 14, color: C.muted, textAlign: 'right' }}>{item.impressions.toLocaleString()}</td>
                            <td style={{ padding: '16px 20px', fontSize: 14, color: C.muted, textAlign: 'right' }}>{item.ctr}%</td>
                            <td style={{ padding: '16px 20px', fontSize: 14, color: '#fff', textAlign: 'right' }}>
                              <span style={{ background: item.position <= 10 ? 'rgba(34, 197, 94, 0.1)' : 'rgba(245, 158, 11, 0.1)', color: item.position <= 10 ? '#22c55e' : '#f59e0b', padding: '4px 10px', borderRadius: 12, fontWeight: 600 }}>
                                {item.position}
                              </span>
                            </td>
                            {activeTab === 'quickWins' && (
                              <td style={{ padding: '16px 20px', textAlign: 'center' }}>
                                <button 
                                  onClick={() => handlePushToPage1(item.query)}
                                  style={{ background: 'rgba(245, 158, 11, 0.2)', border: 'none', color: '#f59e0b', padding: '6px 12px', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                                  title="Add to keyword tracking map"
                                >
                                  Push to Page 1
                                </button>
                              </td>
                            )}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                  
                  {/* Pagination Bar */}
                  {totalItems > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderTop: `1px solid ${C.border}`, background: C.surface }}>
                      <div style={{ fontSize: 11, color: C.muted }}>
                        Showing <span style={{ color: C.text, fontWeight: 600 }}>{totalItems === 0 ? 0 : startIndex + 1}</span> to <span style={{ color: C.text, fontWeight: 600 }}>{endIndex}</span> of <span style={{ color: C.text, fontWeight: 600 }}>{totalItems}</span> items
                      </div>
                      
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                          onClick={() => setTablePage(prev => Math.max(prev - 1, 1))}
                          disabled={activePage === 1}
                          style={{
                            background: 'transparent',
                            border: `1px solid ${C.border}`,
                            borderRadius: 6,
                            color: activePage === 1 ? C.dim : C.text,
                            padding: '5px 12px',
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: activePage === 1 ? 'not-allowed' : 'pointer',
                            transition: 'all 0.2s'
                          }}
                        >
                          Previous
                        </button>

                        {Array.from({ length: totalPages }).map((_, idx) => {
                          const pageNum = idx + 1;
                          if (totalPages > 5 && Math.abs(pageNum - activePage) > 2 && pageNum !== 1 && pageNum !== totalPages) {
                            if (pageNum === 2 || pageNum === totalPages - 1) {
                              return <span key={pageNum} style={{ color: C.muted, padding: '0 4px', fontSize: 11 }}>...</span>;
                            }
                            return null;
                          }

                          return (
                            <button
                              key={pageNum}
                              onClick={() => setTablePage(pageNum)}
                              style={{
                                background: activePage === pageNum ? C.accent : 'transparent',
                                border: activePage === pageNum ? `1px solid ${C.accent}` : `1px solid ${C.border}`,
                                borderRadius: 6,
                                color: activePage === pageNum ? '#fff' : C.text,
                                minWidth: 26,
                                height: 26,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                              }}
                            >
                              {pageNum}
                            </button>
                          );
                        })}

                        <button
                          onClick={() => setTablePage(prev => Math.min(prev + 1, totalPages))}
                          disabled={activePage === totalPages}
                          style={{
                            background: 'transparent',
                            border: `1px solid ${C.border}`,
                            borderRadius: 6,
                            color: activePage === totalPages ? C.dim : C.text,
                            padding: '5px 12px',
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: activePage === totalPages ? 'not-allowed' : 'pointer',
                            transition: 'all 0.2s'
                          }}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* GSC DATE SELECTOR MODAL */}
      {showDateModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: '#151c2c',
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            width: 440,
            padding: 24,
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4)',
            color: '#fff'
          }}>
            {/* Modal Title */}
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 16px 0', color: '#fff' }}>Date range</h2>
            
            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, marginBottom: 20 }}>
              <button style={{
                background: 'transparent',
                border: 'none',
                borderBottom: '2px solid #3b82f6',
                color: '#3b82f6',
                padding: '8px 16px 12px 16px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer'
              }}>
                Filter
              </button>
              <button style={{
                background: 'transparent',
                border: 'none',
                borderBottom: '2px solid transparent',
                color: C.muted,
                padding: '8px 16px 12px 16px',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                opacity: 0.6
              }} onClick={() => toast.success('Compare mode is currently a GSC mockup feature.')}>
                Compare
              </button>
            </div>

            {/* Radio Options */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 220, overflowY: 'auto', paddingRight: 8, marginBottom: 20 }}>
              {[
                { label: 'Last 24 hours', value: '24Hours' },
                { label: 'Last 7 days', value: '7Days' },
                { label: 'Last 28 days', value: '28Days' },
                { label: 'Last 3 months', value: '3Months' },
                { label: 'Last 6 months', value: '6Months' },
                { label: 'Last 12 months', value: '12Months' },
                { label: 'Last 16 months', value: '16Months' },
                { label: 'Custom', value: 'Custom' }
              ].map(opt => (
                <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: '#e2e8f0' }}>
                  <input
                    type="radio"
                    name="modalDateRange"
                    value={opt.value}
                    checked={tempDateRange === opt.value}
                    onChange={(e) => setTempDateRange(e.target.value)}
                    style={{ accentColor: '#3b82f6', cursor: 'pointer', width: 15, height: 15 }}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>

            {/* Custom Inputs (if Custom is selected) */}
            {tempDateRange === 'Custom' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderTop: `1px solid ${C.border}`, paddingTop: 20, marginBottom: 20 }}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                  {/* Start Date */}
                  <div style={{ flex: 1, position: 'relative' }}>
                    <div style={{
                      position: 'absolute',
                      top: -10,
                      left: 10,
                      background: '#151c2c',
                      padding: '0 4px',
                      fontSize: 11,
                      color: C.muted,
                      fontWeight: 500
                    }}>
                      Start date
                    </div>
                    <input
                      type="date"
                      value={tempStartDate}
                      onChange={(e) => setTempStartDate(e.target.value)}
                      style={{
                        width: '100%',
                        background: 'transparent',
                        border: `1px solid ${C.border}`,
                        borderRadius: 6,
                        padding: '10px 12px',
                        color: '#fff',
                        fontSize: 13,
                        outline: 'none',
                        colorScheme: 'dark'
                      }}
                    />
                    <div style={{ fontSize: 10, color: C.muted, marginTop: 4, paddingLeft: 4 }}>YYYY-MM-DD</div>
                  </div>

                  <span style={{ color: C.muted }}>–</span>

                  {/* End Date */}
                  <div style={{ flex: 1, position: 'relative' }}>
                    <div style={{
                      position: 'absolute',
                      top: -10,
                      left: 10,
                      background: '#151c2c',
                      padding: '0 4px',
                      fontSize: 11,
                      color: C.muted,
                      fontWeight: 500
                    }}>
                      End date
                    </div>
                    <input
                      type="date"
                      value={tempEndDate}
                      onChange={(e) => setTempEndDate(e.target.value)}
                      style={{
                        width: '100%',
                        background: 'transparent',
                        border: `1px solid ${C.border}`,
                        borderRadius: 6,
                        padding: '10px 12px',
                        color: '#fff',
                        fontSize: 13,
                        outline: 'none',
                        colorScheme: 'dark'
                      }}
                    />
                    <div style={{ fontSize: 10, color: C.muted, marginTop: 4, paddingLeft: 4 }}>YYYY-MM-DD</div>
                  </div>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            {(() => {
              const isApplyDisabled = tempDateRange === 'Custom' && (!tempStartDate || !tempEndDate);
              return (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                  <button
                    onClick={() => setShowDateModal(false)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#3b82f6',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: '8px 16px'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    disabled={isApplyDisabled}
                    onClick={() => {
                      if (tempDateRange === 'Custom') {
                        if (!tempStartDate || !tempEndDate) {
                          toast.error('Please select both start and end dates.');
                          return;
                        }
                        if (tempStartDate > tempEndDate) {
                          toast.error('Start date cannot be after end date.');
                          return;
                        }
                        setStartDate(tempStartDate);
                        setEndDate(tempEndDate);
                        setDateRange('Custom');
                      } else {
                        setDateRange(tempDateRange);
                        setStartDate('');
                        setEndDate('');
                      }
                      setShowDateModal(false);
                    }}
                    style={{
                      background: isApplyDisabled ? 'rgba(255, 255, 255, 0.1)' : '#3b82f6',
                      color: isApplyDisabled ? 'rgba(255, 255, 255, 0.3)' : '#fff',
                      border: 'none',
                      borderRadius: 20,
                      padding: '8px 24px',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: isApplyDisabled ? 'not-allowed' : 'pointer',
                      boxShadow: isApplyDisabled ? 'none' : '0 4px 10px rgba(59, 130, 246, 0.3)',
                      transition: 'all 0.2s'
                    }}
                  >
                    Apply
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
