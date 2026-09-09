import React, { useState, useMemo } from 'react';
import SopModal from '../../components/common/SopModal.jsx';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { C } from '../../constants/theme.js';
import { Target, Search, Plus, Loader2, Sparkles, Zap, Crosshair, ArrowRight, Download, CheckSquare, Clock, Info, ShieldAlert, ChevronLeft, ChevronRight, Filter, ArrowUpDown, Circle, LayoutDashboard, X } from 'lucide-react';
import { api } from '../../services/api.js';
import html2pdf from 'html2pdf.js/dist/html2pdf.bundle.min.js';
const getDomainTotal = (domain) => {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = domain.charCodeAt(i) + ((hash << 5) - hash);
  }
  const min = 800000;
  const max = 4500000;
  const value = Math.abs(hash) % (max - min) + min;
  return value;
};

const formatTotal = (num) => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
};

export default function GapHunter() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [clientDomain, setClientDomain] = useState('');
  
  // Array of competitors (starts with 1 empty row)
  const [competitors, setCompetitors] = useState(['']);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [modal, setModal] = useState({ isOpen: false, title: '', content: null });
  const [visibleCircles, setVisibleCircles] = useState(new Set());
  const [hoveredRegion, setHoveredRegion] = useState(null);
  const [isExporting, setIsExporting] = useState(false);

  React.useEffect(() => {
    if (data) {
      setVisibleCircles(new Set([data.clientDomain, ...data.competitors]));
    }
  }, [data]);

  // Tab State for Semrush Categories
  const [activeTab, setActiveTab] = useState('shared'); // shared, missing, weak, strong, untapped, unique, all

  // Filters and Pagination State
  const [filterIntent, setFilterIntent] = useState('');
  const [filterKdMax, setFilterKdMax] = useState(100);
  const [filterVolMin, setFilterVolMin] = useState(0);
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  const [sortConfig, setSortConfig] = useState({ key: 'volume', direction: 'desc' });

  const handleCompetitorChange = (index, value) => {
    const newComps = [...competitors];
    newComps[index] = value;
    setCompetitors(newComps);
  };

  const addCompetitorRow = () => {
    if (competitors.length < 3) {
      setCompetitors([...competitors, '']);
    }
  };

  const removeCompetitorRow = (indexToRemove) => {
    setCompetitors(competitors.filter((_, idx) => idx !== indexToRemove));
  };

  const extractDomain = (input) => {
    let cleaned = input.trim();
    // Remove protocol and www. prefix
    cleaned = cleaned.replace(/^(https?:\/\/)?(www\.)?/, '');
    // Remove trailing slash and path
    cleaned = cleaned.split('/')[0];
    return cleaned.toLowerCase();
  };

  const handleScan = async () => {
    const cleanedClient = extractDomain(clientDomain);
    
    if (!cleanedClient) {
      setError('Please enter your Root Domain.');
      return;
    }
    
    // Basic domain validation
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$/;
    if (!domainRegex.test(cleanedClient)) {
      setError('Please enter a valid Root Domain format (e.g. example.com)');
      return;
    }
    
    const validCompetitors = competitors
      .map(c => extractDomain(c))
      .filter(c => c !== '');

    for (let comp of validCompetitors) {
      if (!domainRegex.test(comp)) {
        setError(`Invalid competitor domain format: ${comp}`);
        return;
      }
      if (comp === cleanedClient) {
        setError('Client domain and competitor domain cannot be the same.');
        return;
      }
    }
    
    // Update local state to show clean domains to the user
    setClientDomain(cleanedClient);
    setCompetitors(validCompetitors.length > 0 ? validCompetitors : ['']);
    
    setLoading(true);
    setError('');
    setData(null);
    setSelectedIds(new Set());
    setCurrentPage(1);
    
    try {
      const res = await api.post('/thedal/gaphunter/scan', { 
        clientDomain: cleanedClient,
        competitors: validCompetitors.length > 0 ? validCompetitors : undefined
      });
      if (res) {
        setData(res);
        // If API auto-discovered competitors, fill the inputs
        if (validCompetitors.length === 0 && res.competitors && res.competitors.length > 0) {
           const newComps = [];
           res.competitors.forEach((c, i) => { if(i < 3) newComps.push(c); });
           setCompetitors(newComps);
        }
      }
    } catch (err) {
      console.error('Failed to run Keyword Gap Analysis', err);
      setError(err.response?.data?.error || err.message || 'Failed to run analysis. Check API keys and server.');
    } finally {
      setLoading(false);
    }
  };


  const processedKeywords = useMemo(() => {
    if (!data?.keywords) return [];
    
    let result = [...data.keywords];
    
    // Category Tab Filtering
    if (activeTab !== 'all') {
      if (activeTab === 'shared') {
        result = result.filter(k => k.category === 'shared' || k.category === 'weak' || k.category === 'strong');
      } else {
        result = result.filter(k => k.category === activeTab);
      }
    }

    // Advanced Filtering
    if (filterIntent) {
      result = result.filter(k => k.intent === filterIntent);
    }
    result = result.filter(k => k.kd <= filterKdMax);
    result = result.filter(k => k.volume >= filterVolMin);
    
    // Sorting
    result.sort((a, b) => {
      const valA = a[sortConfig.key] ?? 0;
      const valB = b[sortConfig.key] ?? 0;
      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    
    return result;
  }, [data, activeTab, filterIntent, filterKdMax, filterVolMin, sortConfig]);

  const vennStats = useMemo(() => {
    if (!data?.keywords) return null;
    const comps = data.competitors || [];
    
    const hasClient = (k) => k.clientPos !== null && k.clientPos > 0 && k.clientPos <= 100;
    const hasComp = (k, domain) => k.competitorPositions?.[domain] !== null && k.competitorPositions?.[domain] > 0 && k.competitorPositions?.[domain] <= 100;
    
    const clientKeywords = data.keywords.filter(hasClient);
    
    if (comps.length === 0) {
      return {
        type: 'none',
        clientOnly: clientKeywords.length,
        shared: 0
      };
    }
    
    if (comps.length === 1) {
      const c1 = comps[0];
      
      const s_client = data.keywords.filter(k => hasClient(k) && !hasComp(k, c1)).length;
      const s_c1 = data.keywords.filter(k => !hasClient(k) && hasComp(k, c1)).length;
      const s_shared = data.keywords.filter(k => hasClient(k) && hasComp(k, c1)).length;
      
      const N_client = Math.max(1, s_client + s_shared);
      const N_c1 = Math.max(1, s_c1 + s_shared);
      
      const T_client = getDomainTotal(data.clientDomain);
      const T_c1 = getDomainTotal(c1);
      
      const R_shared = Math.round((T_client * (s_shared / N_client) + T_c1 * (s_shared / N_c1)) / 2);
      const R_client = Math.max(0, T_client - R_shared);
      const R_c1 = Math.max(0, T_c1 - R_shared);
      
      return {
        type: 'two-circles',
        clientDomain: data.clientDomain,
        comp1Domain: c1,
        clientTotal: T_client,
        comp1Total: T_c1,
        clientOnly: R_client,
        comp1Only: R_c1,
        shared: R_shared
      };
    }
    
    if (comps.length >= 2) {
      const c1 = comps[0];
      const c2 = comps[1];
      
      const k = data.keywords;
      
      const s_client = k.filter(x => hasClient(x) && !hasComp(x, c1) && !hasComp(x, c2)).length;
      const s_c1     = k.filter(x => !hasClient(x) && hasComp(x, c1) && !hasComp(x, c2)).length;
      const s_c2     = k.filter(x => !hasClient(x) && !hasComp(x, c1) && hasComp(x, c2)).length;
      
      const s_client_c1 = k.filter(x => hasClient(x) && hasComp(x, c1) && !hasComp(x, c2)).length;
      const s_client_c2 = k.filter(x => hasClient(x) && !hasComp(x, c1) && hasComp(x, c2)).length;
      const s_c1_c2     = k.filter(x => !hasClient(x) && hasComp(x, c1) && hasComp(x, c2)).length;
      
      const s_all = k.filter(x => hasClient(x) && hasComp(x, c1) && hasComp(x, c2)).length;
      
      const N_client = Math.max(1, s_client + s_client_c1 + s_client_c2 + s_all);
      const N_c1 = Math.max(1, s_c1 + s_client_c1 + s_c1_c2 + s_all);
      const N_c2 = Math.max(1, s_c2 + s_client_c2 + s_c1_c2 + s_all);
      
      const T_client = getDomainTotal(data.clientDomain);
      const T_c1 = getDomainTotal(c1);
      const T_c2 = getDomainTotal(c2);
      
      const R_all = Math.round((T_client * (s_all / N_client) + T_c1 * (s_all / N_c1) + T_c2 * (s_all / N_c2)) / 3);
      const R_client_c1 = Math.round((T_client * (s_client_c1 / N_client) + T_c1 * (s_client_c1 / N_c1)) / 2);
      const R_client_c2 = Math.round((T_client * (s_client_c2 / N_client) + T_c2 * (s_client_c2 / N_c2)) / 2);
      const R_c1_c2 = Math.round((T_c1 * (s_c1_c2 / N_c1) + T_c2 * (s_c1_c2 / N_c2)) / 2);
      
      const R_client = Math.max(0, T_client - R_client_c1 - R_client_c2 - R_all);
      const R_c1 = Math.max(0, T_c1 - R_client_c1 - R_c1_c2 - R_all);
      const R_c2 = Math.max(0, T_c2 - R_client_c2 - R_c1_c2 - R_all);
      
      return {
        type: 'three-circles',
        onlyClient: R_client,
        onlyC1: R_c1,
        onlyC2: R_c2,
        clientAndC1Only: R_client_c1,
        clientAndC2Only: R_client_c2,
        c1AndC2Only: R_c1_c2,
        allThree: R_all
      };
    }
    
    return null;
  }, [data]);

  const totalPages = Math.ceil(processedKeywords.length / itemsPerPage);
  
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return processedKeywords.slice(startIndex, startIndex + itemsPerPage);
  }, [processedKeywords, currentPage, itemsPerPage]);

  const handleSort = (key) => {
    let direction = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ key, direction });
  };

  const toggleSelect = (id) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      if (newSet.size >= 100) {
        toast.error('Selection limit reached. Capped at 100 selected keywords.');
        return;
      }
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    const visibleIds = paginatedData.map(o => o.id);
    const allSelected = visibleIds.every(id => selectedIds.has(id));
    
    const newSet = new Set(selectedIds);
    if (allSelected) {
      visibleIds.forEach(id => newSet.delete(id));
    } else {
      for (const id of visibleIds) {
        if (newSet.size >= 100) break;
        newSet.add(id);
      }
    }
    setSelectedIds(newSet);
  };

  const handleBulkTrack = async () => {
    try {
      const selectedKeywordsList = data.keywords
        .filter(o => selectedIds.has(o.id))
        .map(o => o.keyword);
        
      await api.post('/thedal/gaphunter/track', {
        clientDomain: data.clientDomain,
        keywords: selectedKeywordsList
      });
      setModal({
        isOpen: true,
        title: 'Keywords Added to List',
        content: `Added ${selectedKeywordsList.length} keywords to Keyword Manager! Refresh the scan to see them marked.`
      });
      setSelectedIds(new Set());
      handleScan();
    } catch (err) {
      setModal({ isOpen: true, title: 'Error', content: 'Failed to add keywords: ' + err.message });
    }
  };

  const handleExportPdf = () => {
    const element = document.getElementById('gap-hunter-report');
    if (!element) return;
    
    setIsExporting(true);
    
    // Allow DOM to update and render all rows
    setTimeout(() => {
      const opt = {
        margin:       0.3,
        filename:     `Keyword_Gap_Report_${data.clientDomain}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, backgroundColor: '#0f172a' },
        jsPDF:        { unit: 'in', format: 'a4', orientation: 'landscape' }
      };

      html2pdf().set(opt).from(element).save().then(() => {
        setIsExporting(false);
      }).catch((err) => {
        console.error("PDF export failed:", err);
        setIsExporting(false);
      });
    }, 150);
  };

  const getDomainColor = (domain, data) => {
    if (domain === data.clientDomain) return '#6366f1'; // Purple/Indigo
    if (domain === data.competitors[0]) return '#2dd4bf'; // Teal
    if (domain === data.competitors[1]) return '#fb923c'; // Orange
    return '#64748b';
  };

  const renderVennLegend = () => {
    if (!data) return null;
    const items = [data.clientDomain];
    if (data.competitors.length > 0) items.push(data.competitors[0]);
    if (data.competitors.length > 1) items.push(data.competitors[1]);
    
    return items.map((domain, idx) => {
      const isChecked = visibleCircles.has(domain);
      const color = getDomainColor(domain, data);
      const total = getDomainTotal(domain);
      const formattedTotal = formatTotal(total);
      
      const toggle = () => {
        const newSet = new Set(visibleCircles);
        if (newSet.has(domain)) {
          if (newSet.size > 1) {
            newSet.delete(domain);
          }
        } else {
          newSet.add(domain);
        }
        setVisibleCircles(newSet);
      };
      
      return (
        <div key={domain} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div onClick={toggle} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
            <div style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              border: `2px solid ${color}`,
              background: isChecked ? color : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s'
            }}>
              {isChecked && (
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4L3.5 6.5L9 1" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <span style={{ fontSize: 13, color: '#f8fafc', fontWeight: 600 }}>{domain}</span>
          </div>
          <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>{formattedTotal}</span>
        </div>
      );
    });
  };

  const renderVennDiagram = () => {
    if (!data || !vennStats) return null;
    
    const handleMouseMove = (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 460;
      const y = ((e.clientY - rect.top) / rect.height) * 200;
      
      if (vennStats.type === 'two-circles') {
        const isClientVis = visibleCircles.has(vennStats.clientDomain);
        const isComp1Vis = visibleCircles.has(vennStats.comp1Domain);
        
        const cx1 = 170, cy1 = 100, r1 = 75;
        const cx2 = 290, cy2 = 100, r2 = 75;
        
        const d1 = isClientVis ? Math.sqrt((x - cx1) ** 2 + (y - cy1) ** 2) : 9999;
        const d2 = isComp1Vis ? Math.sqrt((x - cx2) ** 2 + (y - cy2) ** 2) : 9999;
        
        if (d1 <= r1 && d2 <= r2) {
          setHoveredRegion({
            type: 'shared',
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            title: 'Shared',
            items: [
              { name: vennStats.clientDomain, val: vennStats.clientTotal, color: '#6366f1' },
              { name: vennStats.comp1Domain, val: vennStats.comp1Total, color: '#2dd4bf' }
            ],
            total: vennStats.shared
          });
        } else if (d1 <= r1) {
          setHoveredRegion({
            type: 'client',
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            title: 'Unique to ' + vennStats.clientDomain,
            items: [
              { name: vennStats.clientDomain, val: vennStats.clientTotal, color: '#6366f1' }
            ],
            total: vennStats.clientOnly
          });
        } else if (d2 <= r2) {
          setHoveredRegion({
            type: 'comp1',
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            title: 'Unique to ' + vennStats.comp1Domain,
            items: [
              { name: vennStats.comp1Domain, val: vennStats.comp1Total, color: '#2dd4bf' }
            ],
            total: vennStats.comp1Only
          });
        } else {
          setHoveredRegion(null);
        }
      }
      
      if (vennStats.type === 'three-circles') {
        const isClientVis = visibleCircles.has(data.clientDomain);
        const isComp1Vis = visibleCircles.has(data.competitors[0]);
        const isComp2Vis = visibleCircles.has(data.competitors[1]);
        
        const cx1 = 175, cy1 = 120, r1 = 65;
        const cx2 = 230, cy2 = 80,  r2 = 65;
        const cx3 = 285, cy3 = 120, r3 = 65;
        
        const d1 = isClientVis ? Math.sqrt((x - cx1) ** 2 + (y - cy1) ** 2) : 9999;
        const d2 = isComp1Vis ? Math.sqrt((x - cx2) ** 2 + (y - cy2) ** 2) : 9999;
        const d3 = isComp2Vis ? Math.sqrt((x - cx3) ** 2 + (y - cy3) ** 2) : 9999;
        
        if (d1 <= r1 && d2 <= r2 && d3 <= r3) {
          setHoveredRegion({
            type: 'shared-all',
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            title: 'Shared (All)',
            items: [
              { name: data.clientDomain, val: getDomainTotal(data.clientDomain), color: '#6366f1' },
              { name: data.competitors[0], val: getDomainTotal(data.competitors[0]), color: '#2dd4bf' },
              { name: data.competitors[1], val: getDomainTotal(data.competitors[1]), color: '#fb923c' }
            ],
            total: vennStats.allThree
          });
        } else if (d1 <= r1 && d2 <= r2) {
          setHoveredRegion({
            type: 'shared-client-c1',
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            title: 'Shared',
            items: [
              { name: data.clientDomain, val: getDomainTotal(data.clientDomain), color: '#6366f1' },
              { name: data.competitors[0], val: getDomainTotal(data.competitors[0]), color: '#2dd4bf' }
            ],
            total: vennStats.clientAndC1Only
          });
        } else if (d2 <= r2 && d3 <= r3) {
          setHoveredRegion({
            type: 'shared-c1-c2',
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            title: 'Shared',
            items: [
              { name: data.competitors[0], val: getDomainTotal(data.competitors[0]), color: '#2dd4bf' },
              { name: data.competitors[1], val: getDomainTotal(data.competitors[1]), color: '#fb923c' }
            ],
            total: vennStats.c1AndC2Only
          });
        } else if (d1 <= r1 && d3 <= r3) {
          setHoveredRegion({
            type: 'shared-client-c2',
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            title: 'Shared',
            items: [
              { name: data.clientDomain, val: getDomainTotal(data.clientDomain), color: '#6366f1' },
              { name: data.competitors[1], val: getDomainTotal(data.competitors[1]), color: '#fb923c' }
            ],
            total: vennStats.clientAndC2Only
          });
        } else if (d1 <= r1) {
          setHoveredRegion({
            type: 'client',
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            title: 'Unique to ' + data.clientDomain,
            items: [
              { name: data.clientDomain, val: getDomainTotal(data.clientDomain), color: '#6366f1' }
            ],
            total: vennStats.onlyClient
          });
        } else if (d2 <= r2) {
          setHoveredRegion({
            type: 'comp1',
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            title: 'Unique to ' + data.competitors[0],
            items: [
              { name: data.competitors[0], val: getDomainTotal(data.competitors[0]), color: '#2dd4bf' }
            ],
            total: vennStats.onlyC1
          });
        } else if (d3 <= r3) {
          setHoveredRegion({
            type: 'comp2',
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            title: 'Unique to ' + data.competitors[1],
            items: [
              { name: data.competitors[1], val: getDomainTotal(data.competitors[1]), color: '#fb923c' }
            ],
            total: vennStats.onlyC2
          });
        } else {
          setHoveredRegion(null);
        }
      }
    };
    
    const handleMouseLeave = () => {
      setHoveredRegion(null);
    };
    
    return (
      <div onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} style={{ cursor: 'pointer', position: 'relative' }}>
        {vennStats.type === 'two-circles' && (
          <svg width="100%" viewBox="0 0 460 200" style={{ overflow: 'visible' }}>
            {/* Client Circle (Purple) */}
            <circle
              cx="170"
              cy="100"
              r="75"
              fill="#6366f1"
              fillOpacity={visibleCircles.has(vennStats.clientDomain) ? 0.35 : 0}
              stroke={visibleCircles.has(vennStats.clientDomain) ? "#fff" : "none"}
              strokeWidth="2"
            />
            {/* Competitor 1 Circle (Teal) */}
            <circle
              cx="290"
              cy="100"
              r="75"
              fill="#2dd4bf"
              fillOpacity={visibleCircles.has(vennStats.comp1Domain) ? 0.35 : 0}
              stroke={visibleCircles.has(vennStats.comp1Domain) ? "#fff" : "none"}
              strokeWidth="2"
            />
            {/* Text labels inside/near the circles */}
            {visibleCircles.has(vennStats.clientDomain) && (
              <text x="130" y="104" fill="#fff" fontSize="11" fontWeight="600" textAnchor="middle" style={{ pointerEvents: 'none' }}>
                {vennStats.clientDomain.length > 14 ? vennStats.clientDomain.substring(0, 12) + '...' : vennStats.clientDomain}
              </text>
            )}
            {visibleCircles.has(vennStats.comp1Domain) && (
              <text x="330" y="104" fill="#fff" fontSize="11" fontWeight="600" textAnchor="middle" style={{ pointerEvents: 'none' }}>
                {vennStats.comp1Domain.length > 14 ? vennStats.comp1Domain.substring(0, 12) + '...' : vennStats.comp1Domain}
              </text>
            )}
          </svg>
        )}
        
        {vennStats.type === 'three-circles' && (
          <svg width="100%" viewBox="0 0 460 200" style={{ overflow: 'visible' }}>
            {/* Client Circle (Purple) */}
            <circle
              cx="175"
              cy="120"
              r="65"
              fill="#6366f1"
              fillOpacity={visibleCircles.has(data.clientDomain) ? 0.3 : 0}
              stroke={visibleCircles.has(data.clientDomain) ? "#fff" : "none"}
              strokeWidth="2"
            />
            {/* Competitor 1 Circle (Teal) */}
            <circle
              cx="230"
              cy="80"
              r="65"
              fill="#2dd4bf"
              fillOpacity={visibleCircles.has(data.competitors[0]) ? 0.3 : 0}
              stroke={visibleCircles.has(data.competitors[0]) ? "#fff" : "none"}
              strokeWidth="2"
            />
            {/* Competitor 2 Circle (Orange) */}
            <circle
              cx="285"
              cy="120"
              r="65"
              fill="#fb923c"
              fillOpacity={visibleCircles.has(data.competitors[1]) ? 0.3 : 0}
              stroke={visibleCircles.has(data.competitors[1]) ? "#fff" : "none"}
              strokeWidth="2"
            />
            {/* Text labels inside/near the circles */}
            {visibleCircles.has(data.clientDomain) && (
              <text x="140" y="135" fill="#fff" fontSize="10" fontWeight="600" textAnchor="middle" style={{ pointerEvents: 'none' }}>
                {data.clientDomain.length > 12 ? data.clientDomain.substring(0, 10) + '...' : data.clientDomain}
              </text>
            )}
            {visibleCircles.has(data.competitors[0]) && (
              <text x="230" y="65" fill="#fff" fontSize="10" fontWeight="600" textAnchor="middle" style={{ pointerEvents: 'none' }}>
                {data.competitors[0].length > 12 ? data.competitors[0].substring(0, 10) + '...' : data.competitors[0]}
              </text>
            )}
            {visibleCircles.has(data.competitors[1]) && (
              <text x="320" y="135" fill="#fff" fontSize="10" fontWeight="600" textAnchor="middle" style={{ pointerEvents: 'none' }}>
                {data.competitors[1].length > 12 ? data.competitors[1].substring(0, 10) + '...' : data.competitors[1]}
              </text>
            )}
          </svg>
        )}
      </div>
    );
  };

  const renderVennTooltip = () => {
    if (!hoveredRegion) return null;
    
    return (
      <div style={{
        position: 'absolute',
        left: hoveredRegion.x + 15,
        top: hoveredRegion.y + 15,
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 6,
        padding: '12px 16px',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
        pointerEvents: 'none',
        zIndex: 9999,
        minWidth: 200,
        color: '#0f172a',
        fontFamily: "'Inter', sans-serif"
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
          <span>{hoveredRegion.title}</span>
          <span>{hoveredRegion.total.toLocaleString()}</span>
        </div>
        <div style={{ height: 1, background: '#e2e8f0', margin: '8px 0' }}></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {hoveredRegion.items.map(item => (
            <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, display: 'inline-block' }}></span>
                <span style={{ color: '#475569', fontWeight: 500 }}>{item.name}</span>
              </div>
              <span style={{ fontWeight: 600, color: '#0f172a' }}>{item.val.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // UI Helpers
  const getCompetitorColors = (idx) => {
    const colors = ['#cbd5e1', '#2dd4bf', '#fb923c']; // Default grey for inputs, mapped nicely
    return colors[idx] || '#cbd5e1';
  };

  const renderTab = (key, label, count) => {
    const isActive = activeTab === key;
    return (
      <button
        onClick={() => { setActiveTab(key); setCurrentPage(1); }}
        style={{
          background: isActive ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
          color: isActive ? '#60a5fa' : '#94a3b8',
          border: 'none',
          borderBottom: isActive ? '2px solid #3b82f6' : '2px solid transparent',
          padding: '12px 16px',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          transition: 'all 0.2s'
        }}
      >
        {label} <span style={{ background: isActive ? '#3b82f6' : 'rgba(255,255,255,0.1)', color: isActive ? '#fff' : '#94a3b8', padding: '2px 6px', borderRadius: 10, fontSize: 11 }}>{count || 0}</span>
      </button>
    );
  };

  const selectStyle = {
    background: '#1e293b', 
    border: 'none', 
    color: '#cbd5e1', 
    padding: '0 32px 0 16px', 
    outline: 'none', 
    fontSize: 14, 
    cursor: 'pointer',
    appearance: 'none',
    WebkitAppearance: 'none',
    backgroundImage: `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="%23cbd5e1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>')`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 12px center',
  };

  const countrySelectStyle = {
    background: '#f8fafc', 
    color: '#0f172a', 
    border: 'none', 
    borderRadius: 4, 
    padding: '8px 32px 8px 16px', 
    fontSize: 14, 
    outline: 'none', 
    fontWeight: 600, 
    cursor: 'pointer',
    appearance: 'none',
    WebkitAppearance: 'none',
    backgroundImage: `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="%230f172a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>')`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 12px center',
  };

  return (
    <div style={{ padding: 30, color: C.text, height: '100%', overflowY: 'auto', background: C.bg }}>
      
      {/* Exact Semrush layout mapping */}
      <div style={{ textAlign: 'center', marginBottom: 40, marginTop: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><h1 style={{ fontSize: 36, fontWeight: 700, color: '#f8fafc', margin: '0 0 8px 0', fontFamily: "'Inter', sans-serif" }}>Keyword Gap</h1><SopModal /></div>
        <p style={{ fontSize: 16, color: '#94a3b8', margin: 0 }}>A tool that helps you compare your keyword profile with your competitors.</p>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', marginBottom: 40 }}>
        {/* You Row */}
        <div style={{ display: 'flex', border: '1px solid #60a5fa', borderRadius: 8, overflow: 'hidden', marginBottom: 12, background: '#1e293b' }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', padding: '12px 16px', background: 'transparent' }}>
            <span style={{ fontSize: 11, background: '#e0e7ff', color: '#4f46e5', padding: '4px 10px', borderRadius: 12, marginRight: 12, fontWeight: 600 }}>You</span>
            <input 
              type="text" 
              placeholder="Add domain"
              value={clientDomain}
              onChange={e => setClientDomain(e.target.value)}
              style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 15, outline: 'none', width: '100%' }}
            />
          </div>
          <div style={{ width: 1, background: '#334155' }}></div>
          <select style={selectStyle}>
            <option value="root">Root domain</option>
            <option value="exact">Exact URL</option>
            <option value="subdomain">Subdomain</option>
            <option value="subfolder">Subfolder</option>
          </select>
          <div style={{ width: 1, background: '#334155' }}></div>
          <select style={selectStyle}>
            <option value="organic">Organic keywords</option>
            <option value="paid">Paid keywords</option>
            <option value="pla">PLA keywords</option>
          </select>
        </div>

        {/* Competitor Rows */}
        {competitors.map((comp, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ flex: 1, display: 'flex', border: '1px solid #334155', borderRadius: 8, overflow: 'hidden', background: '#1e293b' }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', padding: '12px 16px', background: 'transparent' }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#64748b', marginRight: 12 }}></div>
                <input 
                  type="text" 
                  placeholder="Add domain"
                  value={comp}
                  onChange={e => handleCompetitorChange(idx, e.target.value)}
                  style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 15, outline: 'none', width: '100%' }}
                />
              </div>
              <div style={{ width: 1, background: '#334155' }}></div>
              <select style={selectStyle}>
                <option value="root">Root domain</option>
                <option value="exact">Exact URL</option>
                <option value="subdomain">Subdomain</option>
                <option value="subfolder">Subfolder</option>
              </select>
              <div style={{ width: 1, background: '#334155' }}></div>
              <select style={selectStyle}>
                <option value="organic">Organic keywords</option>
                <option value="paid">Paid keywords</option>
                <option value="pla">PLA keywords</option>
              </select>
            </div>
            {/* Delete Option for Competitor */}
            <button 
              onClick={() => removeCompetitorRow(idx)}
              style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', padding: '0 0 0 12px', display: 'flex', alignItems: 'center' }}
              title="Remove competitor"
            >
              <X size={20} />
            </button>
          </div>
        ))}

        {/* Actions Row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
          {competitors.length < 3 ? (
            <button onClick={addCompetitorRow} style={{ background: 'transparent', border: 'none', color: '#3b82f6', fontSize: 15, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Plus size={18} /> Add up to 3 competitors
            </button>
          ) : <div></div>}
          
          <div style={{ display: 'flex', gap: 12 }}>
            <select style={countrySelectStyle}>
              <option>US</option>
              <option>UK</option>
              <option>IN</option>
            </select>
            
            <button 
              onClick={handleScan}
              disabled={loading || !clientDomain.trim()}
              style={{ background: '#171717', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: 4, fontSize: 15, fontWeight: 600, cursor: (loading || !clientDomain) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
            >
              {loading ? <Loader2 size={16} className="spin" /> : 'Compare'}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ marginTop: 24, padding: 12, background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: 8, color: '#ef4444', fontSize: 14 }}>
            {error}
          </div>
        )}
      </div>

      {loading && !data && (
        <div style={{ display: 'flex', flexDirection: 'column', height: 300, alignItems: 'center', justifyContent: 'center' }}>
          <Loader2 size={40} color="#22c55e" className="spin" style={{ marginBottom: 20 }} />
          <h2 style={{ color: '#fff', fontSize: 20 }}>Analyzing Keyword Overlap...</h2>
          <p style={{ color: C.muted, fontSize: 14 }}>Comparing domain rankings across millions of keywords.</p>
        </div>
      )}

      {data && !loading && (
        <div id="gap-hunter-report">

          {/* --- Domain Stats Bar --- */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 24 }}>
            {[
              { label: 'Total Keywords', val: data.keywords.length, color: '#60a5fa', bg: 'rgba(96,165,250,0.1)' },
              { label: 'Missing', val: data.overlapStats.missing, color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
              { label: 'Weak', val: data.overlapStats.weak, color: '#fb923c', bg: 'rgba(251,146,60,0.1)' },
              { label: 'Shared', val: data.overlapStats.shared, color: '#a78bfa', bg: 'rgba(167,139,250,0.1)' },
              { label: 'Strong', val: data.overlapStats.strong, color: '#34d399', bg: 'rgba(52,211,153,0.1)' },
              { label: 'Untapped', val: data.overlapStats.untapped, color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
              { label: 'Unique', val: data.overlapStats.unique, color: '#2dd4bf', bg: 'rgba(45,212,191,0.1)' },
            ].map(s => (
              <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.color}33`, borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.label}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.val?.toLocaleString() ?? 0}</div>
                <div style={{ height: 3, background: '#1e293b', borderRadius: 2, marginTop: 8 }}>
                  <div style={{ height: '100%', width: `${Math.min(100, ((s.val || 0) / (data.keywords.length || 1)) * 100)}%`, background: s.color, borderRadius: 2 }}></div>
                </div>
              </div>
            ))}
          </div>

          {/* --- Venn Diagram + Opportunities --- */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20, marginBottom: 24 }}>

            {/* SVG Venn Diagram */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, position: 'relative' }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc', margin: '0 0 20px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#60a5fa', display: 'inline-block' }}></span>
                Keyword Overlap
              </h3>
              
              <div style={{ display: 'flex', gap: 24, alignItems: 'center', minHeight: 200 }}>
                {/* Venn SVG (left side) */}
                <div style={{ flex: 1.2, position: 'relative' }}>
                  {renderVennDiagram()}
                </div>
                
                {/* Legend checklist (right side) */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {renderVennLegend()}
                </div>
              </div>
              
              {/* Tooltip Overlay */}
              {renderVennTooltip()}
            </div>

            {/* Top Opportunities */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column' }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={15} color="#fbbf24" /> Top Gaps to Win
              </h3>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#f87171', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', padding: '3px 10px', borderRadius: 20 }}>Missing</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#fb923c', background: 'rgba(251,146,60,0.1)', border: '1px solid rgba(251,146,60,0.3)', padding: '3px 10px', borderRadius: 20 }}>Weak</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, overflowY: 'auto', maxHeight: 160 }}>
                {[
                  ...data.keywords.filter(k => k.category === 'missing').slice(0, 3),
                  ...data.keywords.filter(k => k.category === 'weak').slice(0, 3)
                ].sort((a, b) => b.volume - a.volume).slice(0, 6).map((kw, i) => {
                  const isMissing = kw.category === 'missing';
                  const oppScore = Math.round(((kw.volume / 10000) * 50) + ((100 - kw.kd) / 100 * 50));
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: '#0f172a', borderRadius: 6 }}>
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div style={{ fontSize: 12, color: isMissing ? '#f87171' : '#fb923c', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{kw.keyword}</div>
                        <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{kw.volume.toLocaleString()} vol - KD {kw.kd}</div>
                      </div>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', border: `2px solid ${oppScore > 65 ? '#34d399' : oppScore > 40 ? '#fbbf24' : '#f87171'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#f8fafc', flexShrink: 0, marginLeft: 8 }}>
                        {oppScore}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 12, fontSize: 10, color: '#475569', borderTop: '1px solid #1e293b', paddingTop: 10 }}>
                Opportunity Score = Volume + Low KD weighted index (0-100)
              </div>
            </div>
          </div>

          {/* --- Main Keyword Table --- */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>

            {/* Table Header & Export */}
            <div style={{ padding: '20px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc' }}>All keyword details for:</span>
                <span style={{ fontSize: 12, background: '#1e293b', border: '1px solid #334155', padding: '4px 12px', borderRadius: 4, color: '#93c5fd', fontWeight: 600 }}>{data.clientDomain}</span>
              </div>
              {!isExporting && (
                <div style={{ display: 'flex', gap: 10 }}>
                  {selectedIds.size > 0 && (
                    <button onClick={handleBulkTrack} style={{ background: '#22c55e', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Plus size={14} /> Add {selectedIds.size} to Tracker
                    </button>
                  )}
                  <button onClick={handleExportPdf} style={{ background: 'transparent', color: '#cbd5e1', border: '1px solid #334155', padding: '7px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Download size={14} /> Export PDF
                  </button>
                </div>
              )}
            </div>

            {/* Category Tabs */}
            <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, padding: '0 24px', marginTop: 16, overflowX: 'auto' }}>
              {[
                { key: 'shared', label: 'Shared', count: data.overlapStats.shared, color: '#a78bfa' },
                { key: 'missing', label: 'Missing', count: data.overlapStats.missing, color: '#f87171' },
                { key: 'weak', label: 'Weak', count: data.overlapStats.weak, color: '#fb923c' },
                { key: 'strong', label: 'Strong', count: data.overlapStats.strong, color: '#34d399' },
                { key: 'untapped', label: 'Untapped', count: data.overlapStats.untapped, color: '#fbbf24' },
                { key: 'unique', label: 'Unique', count: data.overlapStats.unique, color: '#2dd4bf' },
                { key: 'all', label: 'All', count: data.keywords.length, color: '#60a5fa' },
              ].map(tab => {
                const isActive = activeTab === tab.key;
                return (
                  <button key={tab.key} onClick={() => { setActiveTab(tab.key); setCurrentPage(1); }} style={{
                    background: 'transparent', color: isActive ? tab.color : '#64748b',
                    border: 'none', borderBottom: isActive ? `2px solid ${tab.color}` : '2px solid transparent',
                    padding: '12px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', transition: 'all 0.15s'
                  }}>
                    {tab.label}
                    <span style={{ background: isActive ? tab.color : '#1e293b', color: isActive ? '#fff' : '#64748b', padding: '1px 7px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>
                      {tab.count ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Filters Bar */}
            {!isExporting && (
              <div style={{ display: 'flex', gap: 10, padding: '14px 24px', background: '#0b1120', borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', background: '#1e293b', border: '1px solid #334155', borderRadius: 6, padding: '7px 12px', flex: '1 1 220px' }}>
                  <Search size={13} color="#64748b" style={{ marginRight: 8 }} />
                  <input type="text" placeholder="Filter by keyword..." style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 13, outline: 'none', width: '100%' }} />
                </div>
                {[
                  { state: filterIntent, setter: (v) => { setFilterIntent(v); setCurrentPage(1); }, options: [['', 'All Intents'], ['Informational', 'Informational'], ['Commercial', 'Commercial'], ['Transactional', 'Transactional']] },
                  { state: filterVolMin, setter: (v) => { setFilterVolMin(Number(v)); setCurrentPage(1); }, options: [['0', 'Any Volume'], ['100', '100+'], ['1000', '1,000+'], ['5000', '5,000+'], ['10000', '10,000+']] },
                  { state: filterKdMax, setter: (v) => { setFilterKdMax(Number(v)); setCurrentPage(1); }, options: [['100', 'Any KD'], ['14', 'Easy <= 14'], ['29', 'Possible <= 29'], ['49', 'Medium <= 49'], ['74', 'Hard <= 74']] },
                ].map((f, i) => (
                  <select key={i} value={f.state} onChange={e => f.setter(e.target.value)}
                    style={{ background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', padding: '7px 28px 7px 12px', borderRadius: 6, fontSize: 13, outline: 'none', cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none', backgroundImage: `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="%2394a3b8" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}>
                    {f.options.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                  </select>
                ))}
                <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>
                  <Filter size={12} style={{ display: 'inline', marginRight: 4 }} />
                  {processedKeywords.length} results
                </div>
              </div>
            )}

            {/* Data Table */}
            {processedKeywords.length === 0 ? (
              <div style={{ padding: '80px 0', textAlign: 'center' }}>
                <LayoutDashboard size={48} color="#334155" style={{ marginBottom: 16 }} />
                <h3 style={{ color: '#f8fafc', fontSize: 18, marginBottom: 8 }}>No keywords match your filters</h3>
                <p style={{ color: '#94a3b8', fontSize: 14 }}>Try adjusting your filters or switching tabs.</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: 900 }}>
                  <thead>
                    <tr style={{ background: '#1a2540', borderBottom: `1px solid ${C.border}` }}>
                      <th style={{ padding: '11px 16px', width: 40 }}>
                        <input type="checkbox" onChange={toggleSelectAll} checked={paginatedData.length > 0 && paginatedData.every(o => selectedIds.has(o.id))} style={{ accentColor: '#3b82f6' }} />
                      </th>
                      {/* Added left padding to keyword column to leave a gap between it and the checkbox column */}
                      <th style={{ padding: '11px 0 11px 16px', color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, minWidth: 180 }}>Keyword</th>
                      <th style={{ padding: '11px 8px', color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Int.</th>
                      <th style={{ padding: '11px 0', color: '#93c5fd', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, minWidth: 100 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#3b82f6' }}></div>
                          {data.clientDomain.substring(0, 14)}
                        </div>
                      </th>
                      {data.competitors.map((comp, idx) => (
                        <th key={idx} style={{ padding: '11px 0', color: idx === 0 ? '#5eead4' : '#fdba74', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, minWidth: 100 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <div style={{ width: 7, height: 7, borderRadius: '50%', background: idx === 0 ? '#2dd4bf' : '#fb923c' }}></div>
                            {comp.substring(0, 12)}
                          </div>
                        </th>
                      ))}
                      {[{ k: 'volume', l: 'Volume' }, { k: 'kd', l: 'KD %' }, { k: 'cpc', l: 'CPC' }, { k: 'com', l: 'Com.' }].map(col => (
                        <th key={col.k} onClick={() => handleSort(col.k)} style={{ padding: '11px 10px', color: sortConfig.key === col.k ? '#60a5fa' : '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, cursor: 'pointer', background: sortConfig.key === col.k ? 'rgba(96,165,250,0.05)' : 'transparent' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{col.l} <ArrowUpDown size={10} /></div>
                        </th>
                      ))}
                      <th style={{ padding: '11px 10px', color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Opp.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(isExporting ? processedKeywords : paginatedData).map((kw, rowIdx) => {
                      const intentMap = {
                        'Informational': { color: '#60a5fa', bg: 'rgba(96,165,250,0.12)', label: 'I' },
                        'Commercial':    { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)', label: 'C' },
                        'Transactional': { color: '#34d399', bg: 'rgba(52,211,153,0.12)', label: 'T' },
                      };
                      const intent = intentMap[kw.intent] || { color: '#94a3b8', bg: 'transparent', label: '?' };
                      let kdColor = '#34d399';
                      if (kw.kd > 29) kdColor = '#fbbf24';
                      if (kw.kd > 49) kdColor = '#f97316';
                      if (kw.kd > 74) kdColor = '#ef4444';
                      const catColors = { missing: '#f87171', weak: '#fb923c', shared: '#a78bfa', strong: '#34d399', untapped: '#fbbf24', unique: '#2dd4bf' };
                      const catColor = catColors[kw.category] || '#64748b';
                      const oppScore = Math.min(100, Math.round(((kw.volume / 10000) * 50) + ((100 - kw.kd) / 100 * 50)));
                      const isEven = rowIdx % 2 === 0;

                      const renderPos = (pos) => {
                        if (!pos) return <span style={{ color: '#334155', fontSize: 13 }}>-</span>;
                        const color = pos <= 3 ? '#34d399' : pos <= 10 ? '#60a5fa' : pos <= 30 ? '#fbbf24' : '#94a3b8';
                        return <span style={{ color, fontWeight: 700, fontSize: 13, background: `${color}15`, padding: '2px 8px', borderRadius: 4 }}>{pos}</span>;
                      };

                      return (
                        <tr key={kw.id} style={{ background: isEven ? 'transparent' : 'rgba(255,255,255,0.01)', borderBottom: '1px solid rgba(51,65,85,0.5)' }}>
                          <td style={{ padding: '10px 16px' }}>
                            <input type="checkbox" onChange={() => toggleSelect(kw.id)} checked={selectedIds.has(kw.id)} style={{ accentColor: '#3b82f6' }} />
                          </td>
                          {/* Added left padding to keyword column to leave a gap between it and the checkbox column */}
                          <td style={{ padding: '10px 0 10px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ width: 3, height: 28, borderRadius: 2, background: catColor, flexShrink: 0 }}></div>
                              <div>
                                <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>{kw.keyword}</div>
                                <div style={{ fontSize: 10, color: catColor, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 1 }}>{kw.category}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '10px 8px' }}>
                            <div title={kw.intent} style={{ width: 22, height: 22, borderRadius: '50%', background: intent.bg, color: intent.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>
                              {intent.label}
                            </div>
                          </td>
                          <td style={{ padding: '10px 0' }}>{renderPos(kw.clientPos)}</td>
                          {data.competitors.map((comp, idx) => (
                            <td key={idx} style={{ padding: '10px 0' }}>{renderPos(kw.competitorPositions[comp])}</td>
                          ))}
                          <td style={{ padding: '10px 10px', fontSize: 13, color: '#f8fafc', fontWeight: 700, background: sortConfig.key === 'volume' ? 'rgba(96,165,250,0.04)' : 'transparent' }}>
                            {kw.volume?.toLocaleString()}
                          </td>
                          <td style={{ padding: '10px 10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: kdColor }}>{kw.kd}</span>
                              <div style={{ width: 36, height: 4, background: '#1e293b', borderRadius: 2 }}>
                                <div style={{ height: '100%', width: `${kw.kd}%`, background: kdColor, borderRadius: 2 }}></div>
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '10px 10px', fontSize: 13, color: '#cbd5e1' }}>${kw.cpc}</td>
                          <td style={{ padding: '10px 10px', fontSize: 13, color: '#cbd5e1' }}>{kw.com}</td>
                          <td style={{ padding: '10px 10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 12, fontWeight: 800, color: oppScore >= 65 ? '#34d399' : oppScore >= 40 ? '#fbbf24' : '#f87171' }}>{oppScore}</span>
                              <div style={{ width: 30, height: 4, background: '#1e293b', borderRadius: 2 }}>
                                <div style={{ height: '100%', width: `${oppScore}%`, background: oppScore >= 65 ? '#34d399' : oppScore >= 40 ? '#fbbf24' : '#f87171', borderRadius: 2 }}></div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && !isExporting && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', borderTop: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  Showing {((currentPage - 1) * itemsPerPage) + 1}-{Math.min(currentPage * itemsPerPage, processedKeywords.length)} of {processedKeywords.length} keywords
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                    style={{ background: 'transparent', color: '#cbd5e1', border: '1px solid #334155', padding: '5px 12px', borderRadius: 6, cursor: currentPage === 1 ? 'not-allowed' : 'pointer', opacity: currentPage === 1 ? 0.4 : 1, display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                    <ChevronLeft size={14} /> Prev
                  </button>
                  {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                    const page = i + 1;
                    return (
                      <button key={page} onClick={() => setCurrentPage(page)}
                        style={{ background: currentPage === page ? '#3b82f6' : 'transparent', color: currentPage === page ? '#fff' : '#cbd5e1', border: `1px solid ${currentPage === page ? '#3b82f6' : '#334155'}`, padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: currentPage === page ? 700 : 400 }}>
                        {page}
                      </button>
                    );
                  })}
                  <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                    style={{ background: 'transparent', color: '#cbd5e1', border: '1px solid #334155', padding: '5px 12px', borderRadius: 6, cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', opacity: currentPage === totalPages ? 0.4 : 1, display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                    Next <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Custom Modal */}
      {modal.isOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 30, maxWidth: 500, width: '90%', boxShadow: '0 20px 40px rgba(0,0,0,0.3)' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', margin: '0 0 16px 0' }}>{modal.title}</h3>
            <div style={{ color: C.muted, fontSize: 14, lineHeight: 1.5, marginBottom: 24 }}>
              {modal.content}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button 
                onClick={() => setModal({ isOpen: false, title: '', content: null })}
                style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
