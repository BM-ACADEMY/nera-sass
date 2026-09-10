import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, Bell, X, FileText, Menu } from 'lucide-react';
import { C } from '../../constants/theme.js';

// Header-scoped palette — matches the sidebar's indigo/purple accent so the
// two chrome pieces read as one system. Kept local like the sidebar's SB.
const HB = {
  accent: '#1677ff',
  card: '#ffffff',
  border: '#e2e8f0',
};

const LABELS = {
  dashboard: 'Dashboard',
  leads: 'Lead Management',
  inbox: 'WhatsApp Inbox',
  campaigns: 'Bulk Campaigns',
  templates: 'Templates',
  brain: 'AI Brain',
  reports: 'Reports',
  clients: 'Clients',
  settings: 'Settings',
  'sales-tasks': 'Sales Tasks',
};

const SEARCH_PAGES = [
  // Primary
  { path: '/dashboard', label: 'Dashboard', desc: 'Overview and quick stats' },
  { path: '/leads', label: 'Leads', desc: 'View, filter, and manage all leads' },
  { path: '/sales-tasks', label: 'Sales Task', desc: 'Manage your daily sales activities' },
  { path: '/inbox', label: 'WhatsApp Inbox', desc: 'Chat directly with your leads' },
  { path: '/campaigns', label: 'Bulk Campaigns', desc: 'Send mass WhatsApp messages' },
  { path: '/templates', label: 'Templates', desc: 'Manage WhatsApp message templates' },
  { path: '/brain', label: 'AI Brain', desc: 'Configure AI assistant behavior' },
  { path: '/ai-image', label: 'AI Image', desc: 'Generate AI images' },
  { path: '/reports', label: 'Reports', desc: 'Detailed analytics and performance' },
  { path: '/founder-reports', label: 'Founder Reports', desc: 'Executive summaries and metrics' },
  { path: '/clients', label: 'Clients', desc: 'Manage client accounts and billing' },
  { path: '/integrations', label: 'Integrations', desc: 'Connect third-party tools' },
  { path: '/workflows', label: 'Workflow Logs', desc: 'View automated workflow executions' },
  { path: '/settings', label: 'Settings', desc: 'System configuration and preferences' },

  // AllianceOS
  { path: '/alliance-dashboard', label: 'AllianceOS Dashboard', desc: 'Alliance overview' },
  { path: '/upload-leads', label: 'Upload Leads', desc: 'AllianceOS - Import new leads' },
  { path: '/lead-list', label: 'Lead List', desc: 'AllianceOS - View leads' },
  { path: '/pipeline', label: 'Pipeline', desc: 'AllianceOS - Sales pipeline' },
  { path: '/lead-profile', label: 'Lead Profile', desc: 'AllianceOS - Lead details' },
  { path: '/knowledge-base', label: 'Knowledge Base', desc: 'AllianceOS - Documentation' },
  { path: '/prompt-manager', label: 'Prompt Manager', desc: 'AllianceOS - Manage prompts' },
  { path: '/alliance-inbox', label: 'Alliance Inbox', desc: 'AllianceOS - Messages' },

  // Content OS
  { path: '/admin/content-os/approval', label: 'Approval Room', desc: 'Content OS - Review content' },
  { path: '/admin/content-os/monitors', label: 'Folder Monitors', desc: 'Content OS - Track folders' },
  { path: '/admin/content-os/scheduler', label: 'Scheduler', desc: 'Content OS - Schedule posts' },
  { path: '/admin/content-os/captions', label: 'Caption Studio', desc: 'Content OS - Manage captions' },
  { path: '/admin/content-os/thumbnail-brain', label: 'Thumbnail Brain', desc: 'Content OS - AI thumbnails' },
  { path: '/admin/content-os/social-connection', label: 'Social Accounts', desc: 'Content OS - Social links' },
  { path: '/admin/content-os/tokens', label: 'Token Health', desc: 'Content OS - API token status' },
  { path: '/admin/content-os/logs', label: 'Publish Logs', desc: 'Content OS - Publishing history' },
  { path: '/admin/content-os/reach', label: 'Reach Report', desc: 'Content OS - Analytics' },
  { path: '/admin/content-os/failed', label: 'Failed Jobs', desc: 'Content OS - Error logs' },


  // Mafiya OS
  { path: '/mafiya/family', label: 'The Family', desc: 'Mafiya OS - Users' },
  { path: '/mafiya/add-client', label: 'GMB Clients', desc: 'Mafiya OS - Client management' },
  { path: '/mafiya/plans', label: 'Mafiya Plans', desc: 'Mafiya OS - Plans' },
  { path: '/mafiya/loyalty', label: 'Loyalty (Review)', desc: 'Mafiya OS - Reviews' },
  { path: '/mafiya/street-posts', label: 'Street Posts', desc: 'Mafiya OS - Social posting' },
  { path: '/mafiya/rivals', label: 'Rival Families', desc: 'Mafiya OS - Competitors' },
  { path: '/mafiya/gbp-insights', label: 'GBP Insights', desc: 'Mafiya OS - Business Profile' },
  { path: '/mafiya/citations', label: 'Citation', desc: 'Mafiya OS - Citations' },
  { path: '/mafiya/orders', label: 'Mafia Orders', desc: 'Mafiya OS - Orders' },
  { path: '/mafiya/brain', label: "Don's Brain", desc: 'Mafiya OS - AI Assistant' },
  { path: '/mafiya/usage', label: 'Usage', desc: 'Mafiya OS - Platform usage' },
];

export const Header = ({user, onMenuClick}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const activePath = location.pathname.substring(1) || 'dashboard';
  const activeLabel = LABELS[activePath] || 'Dashboard';

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef(null);
  const [dataMode, setDataMode] = useState(localStorage.getItem('leados_data_mode') || 'live');

  const handleDataModeChange = (mode) => {
    setDataMode(mode);
    localStorage.setItem('leados_data_mode', mode);
    window.location.reload();
  };

  const initial = user?.name ? user.name[0].toUpperCase() : 'K';
  const roleLabel = 'User';
  const nameLabel = user?.name || 'Kamar';

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchOpen]);

  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
      setSearchQuery('');
    }
  }, [searchOpen]);

  const filteredPages = SEARCH_PAGES.filter(p => 
    p.label.toLowerCase().includes(searchQuery.toLowerCase()) || 
    p.desc.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <>
      <div style={{height:60,background:C.surface,borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 24px',flexShrink:0,gap:16}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 12, minWidth:0}}>
          <button className="show-mobile" onClick={onMenuClick} style={{background:'transparent',border:'none',color:C.muted, display: 'none'}}>
            <Menu size={20} />
          </button>
          <div style={{display:'flex',alignItems:'baseline',gap:8,minWidth:0}}>
            <span style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700,color:C.text,whiteSpace:'nowrap'}}>{activeLabel}</span>
            <span className="hide-mobile" style={{color:C.dim,fontSize:12,whiteSpace:'nowrap'}}>LeadOS by BM TechX</span>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:20,flexShrink:0}}>


          <div style={{display:'flex',alignItems:'center',gap:9,background:HB.card,border:'1px solid '+HB.border,borderRadius:8,padding:'6px 12px 6px 6px'}}>
            <div style={{width:28,height:28,borderRadius:'50%',background:HB.accent,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:800,color:'#fff',flexShrink:0}}>{initial}</div>
            <div className="hide-mobile" style={{lineHeight:1.3}}>
              <p style={{fontSize:11.5,fontWeight:600,color:C.text,whiteSpace:'nowrap'}}>{nameLabel}</p>
              <p style={{fontSize:9.5,color:C.muted,whiteSpace:'nowrap'}}>{roleLabel}</p>
            </div>
          </div>
        </div>
      </div>

      {searchOpen && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',backdropFilter:'blur(4px)',zIndex:1000,display:'flex',alignItems:'flex-start',justifyContent:'center',paddingTop:'12vh'}} onClick={() => setSearchOpen(false)}>
          <div style={{background:C.surface,border:'1px solid '+C.border,borderRadius:12,width:'90%',maxWidth:520,boxShadow:'0 20px 40px rgba(0,0,0,0.5)',overflow:'hidden'}} onClick={e => e.stopPropagation()}>
            <div style={{display:'flex',alignItems:'center',padding:'16px 20px',borderBottom:'1px solid '+C.border, background: C.card}}>
              <Search size={18} color={C.accent} style={{marginRight:12}} />
              <input 
                ref={searchInputRef}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search for pages..." 
                style={{flex:1,background:'transparent',border:'none',color:C.text,fontSize:15,outline:'none'}} 
              />
              <button onClick={() => setSearchOpen(false)} style={{background:'transparent',border:'none',cursor:'pointer',color:C.muted, display: 'flex', alignItems: 'center'}}>
                <X size={18} />
              </button>
            </div>
            <div style={{maxHeight:380,overflowY:'auto',padding:'8px 0'}}>
              {filteredPages.length > 0 ? (
                filteredPages.map(page => (
                  <div 
                    key={page.path}
                    onClick={() => { navigate(page.path); setSearchOpen(false); }}
                    style={{display:'flex',alignItems:'center',padding:'12px 20px',cursor:'pointer',borderBottom:'1px solid transparent', transition: 'background 0.15s'}}
                    onMouseEnter={e => e.currentTarget.style.background = C.accent+'15'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{width: 32, height: 32, borderRadius: 8, background: C.accent+'22', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 14}}>
                      <FileText size={16} color={C.accent} />
                    </div>
                    <div>
                      <p style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:2}}>{page.label}</p>
                      <p style={{fontSize:11,color:C.muted}}>{page.desc}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{padding:'40px 20px',textAlign:'center'}}>
                  <Search size={24} color={C.muted} style={{marginBottom: 10, opacity: 0.5}} />
                  <p style={{color:C.muted,fontSize:13}}>No pages found matching "{searchQuery}"</p>
                </div>
              )}
            </div>
            <div style={{padding: '10px 20px', background: C.card, borderTop: '1px solid '+C.border, display: 'flex', justifyContent: 'flex-end', fontSize: 10, color: C.muted}}>
              Press Esc to close
            </div>
          </div>
        </div>
      )}
    </>
  );
};
