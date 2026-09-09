import { useState, useEffect } from 'react';
import { api } from '../src/services/api.js';
import '../src/views/ContentOS.css';

// Import modular features
import { ApprovalRoom } from './ApprovalRoom.jsx';
import { FolderMonitors } from './FolderMonitors.jsx';
import { SchedulerView } from './SchedulerView.jsx';
import { CaptionStudio } from './CaptionStudio.jsx';
import { SocialAccounts } from './SocialAccounts.jsx';
import { TokenHealth } from './TokenHealth.jsx';
import { PublishLogs } from './PublishLogs.jsx';
import { ReachReport } from './ReachReport.jsx';
import { FailedJobs } from './FailedJobs.jsx';
import { ThumbnailBrainStudio } from './ThumbnailBrainStudio.jsx';

// Color matching
const COLORS = [
  { c: "#8B72F0", bg: "rgba(139,114,240,.12)" }, // BM Academy
  { c: "#00C4A0", bg: "rgba(0,196,160,.12)" },  // BM TechX
  { c: "#34C77B", bg: "rgba(52,199,123,.14)" },  // Namma Pondy Properties
  { c: "#D4A843", bg: "rgba(212,168,67,.15)" },  // Dada's Kitchen
  { c: "#F04A5E", bg: "rgba(240,74,94,.15)" },   // TravellersNeed
  { c: "#4C8EF5", bg: "rgba(76,142,245,.15)" }    // EduConsultants
];

function getBrandConfig(brandName) {
  const name = brandName || "Unknown";
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const idx = Math.abs(hash) % COLORS.length;
  
  // Custom brand configs matching the HTML mockup
  if (name.includes("Academy") || name.toLowerCase() === "academy") {
    return { name: "BM Academy", color: "#8B72F0", bg: "rgba(139,114,240,.12)", short: "BMA" };
  }
  if (name.includes("TechX") || name.toLowerCase() === "techx") {
    return { name: "BM TechX", color: "#00C4A0", bg: "rgba(0,196,160,.12)", short: "BTX" };
  }
  if (name.includes("Pondy") || name.toLowerCase() === "npp") {
    return { name: "Namma Pondy", color: "#34C77B", bg: "rgba(52,199,123,.14)", short: "NPP" };
  }
  if (name.includes("Kitchen") || name.toLowerCase() === "dadas") {
    return { name: "Dada's Kitchen", color: "#D4A843", bg: "rgba(212,168,67,.15)", short: "DDK" };
  }
  if (name.includes("Traveller") || name.toLowerCase() === "travel") {
    return { name: "TravellersNeed", color: "#F04A5E", bg: "rgba(240,74,94,.15)", short: "TVN" };
  }
  
  const short = name.split(/[\s_]+/).map(w => w[0]).join('').substring(0,3).toUpperCase();
  return { name, color: COLORS[idx].c, bg: COLORS[idx].bg, short };
}

function getPlatformConfig(platform) {
  if (!platform) return { label: "Unknown", icon: "🌐", color: "#454A58" };
  const p = platform.toLowerCase();
  const known = {
    instagram:       { label: "Instagram Reel", icon: "📸", color: "linear-gradient(135deg,#F58529,#DD2A7B,#8134AF)" },
    instagram_post:  { label: "Instagram Post", icon: "📸", color: "linear-gradient(135deg,#F58529,#DD2A7B,#8134AF)" },
    instagram_story: { label: "Instagram Story", icon: "📱", color: "linear-gradient(135deg,#F58529,#DD2A7B,#8134AF)" },
    youtube:         { label: "YouTube Short", icon: "▶", color: "#FF0000" },
    facebook:        { label: "Facebook Reel", icon: "👍", color: "#1877F2" },
    facebook_post:   { label: "Facebook Post", icon: "👍", color: "#1877F2" },
    facebook_story:  { label: "Facebook Story", icon: "📱", color: "#1877F2" },
    x_twitter:       { label: "X (Twitter)", icon: "𝕏", color: "#000000" },
    linkedin:        { label: "LinkedIn", icon: "in", color: "#0A66C2" },
  };
  if (known[p]) return known[p];
  return { label: platform, icon: "🌐", color: "#454A58" };
}

function extractDriveFileId(url) {
  if (!url) return null;
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /id=([a-zA-Z0-9_-]+)/,
    /\/open\?id=([a-zA-Z0-9_-]+)/
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
}

function parseItemJsonFields(item) {
  if (!item) return item;
  const parsed = { ...item };
  const jsonFields = ["platforms", "selected_accounts", "thumbnail_options", "key_moments", "platform_post_ids"];
  for (const field of jsonFields) {
    if (parsed[field] !== undefined && parsed[field] !== null) {
      if (typeof parsed[field] === 'string') {
        try {
          parsed[field] = JSON.parse(parsed[field]);
        } catch (e) {
          console.error(`Failed to parse field ${field}:`, e);
        }
      }
    }
  }
  if (!parsed.selected_accounts || typeof parsed.selected_accounts !== 'object' || Array.isArray(parsed.selected_accounts)) {
    parsed.selected_accounts = {};
  }
  if (!parsed.platforms || !Array.isArray(parsed.platforms)) {
    parsed.platforms = [];
  }
  return parsed;
}

function isSameBrand(brandName, selectedSlug) {
  if (!brandName || !selectedSlug) return false;
  const bName = brandName.toLowerCase();
  const slug = selectedSlug.toLowerCase();
  
  if (slug === 'all') return true;
  
  if (slug === 'academy') return bName.includes('academy');
  if (slug === 'techx') return bName.includes('techx');
  if (slug === 'npp' || slug === 'nammapondy' || slug === 'pondy') {
    return bName.includes('pondy') || bName.includes('npp');
  }
  if (slug === 'dadas' || slug === 'kitchen') return bName.includes('dada') || bName.includes('kitchen');
  if (slug === 'travel' || slug === 'travellers') return bName.includes('travel') || bName.includes('traveller');
  if (slug === 'edu' || slug === 'educonsultants') return bName.includes('edu') || bName.includes('consultant');
  
  const normalize = (name) => name.toLowerCase().replace(/['"_-]/g, '').replace(/\s+/g, '');
  return normalize(brandName).includes(normalize(selectedSlug)) || normalize(selectedSlug).includes(normalize(brandName));
}

export default function ContentOSDashboard({ defaultPage = "approval" }) {
  const canApprove = true;

  // States
  const [view, setView] = useState(defaultPage);
  const [selectedBrand, setSelectedBrand] = useState('all');
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({ PENDING: 0, APPROVED: 0, REJECTED: 0, PUBLISHED: 0, FAILED: 0 });
  const [analytics, setAnalytics] = useState({ total: 0, pending: 0, publishedToday: 0, failedToday: 0 });
  const [socialAccounts, setSocialAccounts] = useState([]);
  const [monitors, setMonitors] = useState([]);
  const [brands, setBrands] = useState([]);
  const [, setLoading] = useState(true);
  const [loadingMonitors, setLoadingMonitors] = useState(false);
  const [monitorInputs, setMonitorInputs] = useState({});

  // Selection states
  const [selectedItem, setSelectedItem] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editValues, setEditValues] = useState({});

  // Suggestion Modal states
  const [isSuggestModalOpen, setIsSuggestModalOpen] = useState(false);
  const [suggestCache, setSuggestCache] = useState({});
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState(null);
  const [selectedTone, setSelectedTone] = useState("engaging");
  const [suggestionType, setSuggestionType] = useState("caption");
  const [contextInfo, setContextInfo] = useState("");

  // General Toast notifications
  const [toast, setToast] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);

  // Load configuration and data
  useEffect(() => {
    fetchBrands();
    fetchData();
    fetchAccounts();
    fetchMonitors();
  }, []);

  // Sync monitors if page switches to monitors
  useEffect(() => {
    if (view === 'monitors') {
      fetchMonitors();
    }
  }, [view]);

  // Sync default page prop if it changes
  useEffect(() => {
    if (view !== defaultPage) {
      const t = setTimeout(() => setView(defaultPage), 0);
      return () => clearTimeout(t);
    }
  }, [defaultPage, view]);

  // Fetch all queue items and stats
  async function fetchData(showLoading = true) {
    if (showLoading) setLoading(true);
    try {
      // Fetch all items (no status filter in request, filter client side for subviews)
      const res = await api.getContentQueue({ status: "all" });
      const parsedItems = (res.items || [])
        .map(parseItemJsonFields)
        .filter(i => (i.status || '').toLowerCase() !== 'deleted_from_drive');
      setItems(parsedItems);

      // Auto-select first pending item if none selected
      if (selectedItem) {
        const updatedItem = parsedItems.find(i => i.id === selectedItem.id);
        if (updatedItem) {
          setSelectedItem(updatedItem);
        } else {
          setSelectedItem(null);
        }
      } else if (parsedItems.length > 0) {
        const firstPend = parsedItems.find(i => (i.status || '').toUpperCase() === 'PENDING' || (i.status || '').toUpperCase() === 'PENDING_APPROVAL');
        if (firstPend) {
          setSelectedItem(firstPend);
        } else {
          setSelectedItem(parsedItems[0]);
        }
      }

      const statsRes = await api.getContentStats();
      if (statsRes.success) {
        const s = statsRes.stats;
        setStats({
          PENDING: s.pending || 0,
          APPROVED: s.approved || 0,
          SCHEDULED: s.scheduled || 0,
          REJECTED: s.rejected || 0,
          PUBLISHED: s.published_today || 0,
          PUBLISHED_WEEK: s.published_this_week || 0,
          FAILED: s.failed_today || 0
        });
        setAnalytics({
          total: s.total || 0,
          pending: s.pending || 0,
          publishedToday: s.published_today || 0,
          failedToday: s.failed_today || 0
        });
      }
    } catch {
      showToast("Error loading Content OS queue data", "error");
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  // Fetch linked social accounts
  async function fetchAccounts() {
    try {
      const res = await api.getSocialAccounts();
      setSocialAccounts(res || []);
    } catch (e) {
      console.error('Error fetching accounts:', e);
    }
  }

  // Fetch active clients (brands) list from database
  async function fetchBrands() {
    try {
      const res = await api.getClients();
      const seenSlugs = new Set();
      const activeBrands = (res.clients || [])
        .filter(c => c.status === "active" || c.status === "Live")
        .map(c => {
          const known = {
            "BM Academy": "academy",
            "BM TechX": "techx",
            "Namma Pondy Properties": "npp",
            "Dada's Kitchen": "dadas",
            "ABM Groups": "abm_groups"
          };
          const slug = known[c.name] || c.name.toLowerCase()
            .replace(/'/g, '')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
          return {
            id: c.id,
            name: c.name,
            slug: slug
          };
        })
        .filter(b => {
          if (seenSlugs.has(b.slug)) return false;
          seenSlugs.add(b.slug);
          return true;
        });
      setBrands(activeBrands);
      return activeBrands;
    } catch (err) {
      console.error("Error fetching brands list:", err);
      return [];
    }
  }

  // Fetch folder monitors configurations
  async function fetchMonitors() {
    setLoadingMonitors(true);
    try {
      let activeBrands = brands;
      if (activeBrands.length === 0) {
        activeBrands = await fetchBrands();
      }

      // Load folder monitor data
      const data = await api.get("/api/content-os/folders");
      setMonitors(data || []);
      const inputs = {};
      (data || []).forEach(m => {
        inputs[m.brandSlug] = m.folderId;
      });
      activeBrands.forEach(b => {
        if (!inputs[b.slug]) inputs[b.slug] = "";
      });
      setMonitorInputs(inputs);
    } catch (e) {
      console.error(e);
      showToast("Failed to retrieve Google Drive folder monitors", "error");
    } finally {
      setLoadingMonitors(false);
    }
  }

  // Save monitor settings
  async function handleSaveMonitor(brandSlug) {
    const rawVal = monitorInputs[brandSlug] || "";
    const folderId = rawVal.includes("/folders/") ? (rawVal.match(/\/folders\/([a-zA-Z0-9_-]+)/)?.[1] || rawVal) : rawVal;
    try {
      const res = await api.post("/api/content-os/folders", {
        brandSlug,
        folderId
      });
      if (res.success) {
        showToast(`Saved folder monitor for ${brandSlug}!`);
        fetchMonitors();
      } else {
        showToast("Failed to save monitor folder", "error");
      }
    } catch (e) {
      showToast("Error saving folder monitor: " + e.message, "error");
    }
  }

  // Approve content (auto-detects future scheduled_at → sets SCHEDULED status)
  async function handleApprove(id) {
    try {
      if (editMode) {
        await api.updateContent(id, editValues);
      }
      const hasFutureSchedule = editValues.scheduled_at && new Date(editValues.scheduled_at) > new Date();
      await api.approveContent(id, { scheduled_at: editValues.scheduled_at || null });
      showToast(hasFutureSchedule
        ? `Scheduled for ${formatTime(editValues.scheduled_at)} 📅`
        : "Content approved — ready to publish! ✅"
      );
      setEditMode(false);
      fetchData(false);
    } catch (e) {
      showToast("Approval failed: " + e.message, "error");
    }
  }

  // Schedule an already-approved item for a future time
  async function handleScheduleItem(id) {
    if (!editValues.scheduled_at) {
      showToast("Please set a date and time first", "error");
      return;
    }
    if (new Date(editValues.scheduled_at) <= new Date()) {
      showToast("Scheduled time must be in the future", "error");
      return;
    }
    try {
      if (editMode) {
        await api.updateContent(id, editValues);
      }
      await api.scheduleContent(id, editValues.scheduled_at);
      showToast(`Scheduled for ${formatTime(editValues.scheduled_at)} 📅`);
      setEditMode(false);
      fetchData(false);
    } catch (e) {
      showToast("Scheduling failed: " + e.message, "error");
    }
  }

  // Reject content
  async function handleReject(id, reason) {
    try {
      await api.rejectContent(id, reason);
      showToast("Content rejected successfully", "error");
      setConfirmAction(null);
      setRejectionReason("");
      fetchData(false);
    } catch (e) {
      showToast("Rejection failed: " + e.message, "error");
    }
  }

  // Publish approved content immediately
  async function handlePublishNow(id) {
    setIsPublishing(true);
    showToast("Publishing to selected channels... 🚀");
    try {
      if (editMode) {
        await api.updateContent(id, editValues);
      }
      
      const res = await api.publishContent(id);
      if (res.success) {
        showToast("Successfully published! 🎉");
        fetchData();
      } else {
        showToast(res.error || "Failed to publish", "error");
        fetchData();
      }
    } catch (e) {
      showToast("Error triggering publish: " + e.message, "error");
    } finally {
      setIsPublishing(false);
    }
  }

  // Save edits
  async function handleSaveEdit(id) {
    try {
      const updated = await api.updateContent(id, editValues);
      const parsedItem = parseItemJsonFields(updated.item);
      setItems(prev => prev.map(i => i.id === id ? parsedItem : i));
      if (selectedItem?.id === id) setSelectedItem(parsedItem);
      setEditMode(false);
      showToast("Changes saved successfully");
    } catch {
      showToast("Failed to save changes", "error");
    }
  }

  // Toggle publishing platform (editing)
  function togglePlatform(p) {
    setEditValues(prev => {
      const exists = prev.platforms.includes(p) || 
        (p === 'instagram_post' && prev.platforms.includes('instagram')) ||
        (p === 'facebook_post' && prev.platforms.includes('facebook'));

      let nextPlatforms;
      if (exists) {
        nextPlatforms = prev.platforms.filter(x => {
          if (p === 'instagram_post' && (x === 'instagram' || x === 'instagram_post')) return false;
          if (p === 'facebook_post' && (x === 'facebook' || x === 'facebook_post')) return false;
          return x !== p;
        });
      } else {
        nextPlatforms = [...prev.platforms, p];
      }

      return {
        ...prev,
        platforms: nextPlatforms,
        selected_channels: nextPlatforms
      };
    });
  }

  // Toggle target account for platform (editing)
  function toggleAccount(platform, accountId) {
    setEditValues(prev => {
      let normalizedPlatform = platform;
      if (platform.includes('instagram')) normalizedPlatform = 'instagram';
      else if (platform.includes('facebook')) normalizedPlatform = 'facebook';
      
      const current = prev.selected_accounts || {};
      const platAccounts = current[normalizedPlatform] || [];
      const isSelected = platAccounts.includes(accountId);
      
      const newPlatAccounts = isSelected 
        ? platAccounts.filter(id => id !== accountId)
        : [...platAccounts, accountId];
        
      return {
        ...prev,
        selected_accounts: {
          ...current,
          [normalizedPlatform]: newPlatAccounts
        }
      };
    });
  }

  // Show generic toast alert
  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  // AI Suggestions
  const handleOpenAiSuggestions = (type = "caption") => {
    if (!selectedItem) return;
    setSuggestionType(type);
    setIsSuggestModalOpen(true);
    
    const cacheKey = `${selectedItem.id}_${selectedTone}_${type}_${contextInfo}`;
    if (suggestCache[cacheKey]) return;
    
    fetchAiSuggestions(selectedItem.id, selectedTone, type, contextInfo);
  };

  const fetchAiSuggestions = async (itemId, tone, type = "caption", context = "") => {
    setLoadingSuggestions(true);
    setSuggestionsError(null);
    try {
      const platformMap = {
        'instagram_caption': 'instagram',
        'facebook_caption': 'facebook',
        'youtube_title': 'youtube',
        'youtube_description': 'youtube',
        'x_caption': 'x_twitter',
        'linkedin_caption': 'linkedin',
        'hashtags': 'hashtags'
      };
      const platform = platformMap[type] || null;

      const res = type === "story"
        ? await api.getAiStorySuggestions(itemId, tone, context)
        : await api.getAiCaptionSuggestions(itemId, tone, platform, context);

      if (res && (res.success || res.suggestions)) {
        const rawSuggestions = res.suggestions || [];
        
        let parsedList = [];
        if (Array.isArray(rawSuggestions)) {
          parsedList = rawSuggestions.map(s => {
            if (typeof s === 'string') return s;
            if (s && typeof s === 'object') return s.caption || s.text || s.suggestion || JSON.stringify(s);
            return String(s);
          });
        } else if (typeof rawSuggestions === 'string') {
          parsedList = [rawSuggestions];
        } else if (rawSuggestions && typeof rawSuggestions === 'object') {
          const possibleVal = rawSuggestions.caption || rawSuggestions.text || rawSuggestions.suggestion;
          if (possibleVal) parsedList = [possibleVal];
          else parsedList = [JSON.stringify(rawSuggestions)];
        }
        
        const cacheKey = `${itemId}_${tone}_${type}_${context}`;
        setSuggestCache(prev => ({ ...prev, [cacheKey]: parsedList }));
      } else {
        setSuggestionsError(res?.error || "Failed to fetch suggestions");
      }
    } catch (err) {
      setSuggestionsError(err.message || "Failed to generate suggestions. Please try again.");
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const handleGenerateFirstTime = async (itemId, tone, context) => {
    setLoadingSuggestions(true);
    setSuggestionsError(null);
    try {
      const res = await api.getAiCaptionSuggestions(itemId, tone, 'all', context);
      if (res && res.success && res.meta) {
        return res.meta;
      } else {
        setSuggestionsError(res?.error || "Failed to generate metadata");
        return null;
      }
    } catch (err) {
      setSuggestionsError(err.message || "Failed to generate metadata. Please try again.");
      return null;
    } finally {
      setLoadingSuggestions(false);
    }
  };

  // Helper date formatter
  function formatTime(iso) {
    if (!iso) return "Not set";
    return new Date(iso).toLocaleString("en-IN", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
    });
  }

  // Render Page Title and Header Subtitles
  const getPageHeader = () => {
    const pages = {
      approval: { title: "Approval Room", subtitle: `${items.filter(i => i.status === 'PENDING').length} reels awaiting approval · publishing to 5 platforms` },
      monitors: { title: "Folder Monitors", subtitle: "6 Drive folders watched · poller runs every 60s" },
      scheduler: { title: "Scheduler", subtitle: "Approved content auto-publishes at its scheduled window" },
      captions: { title: "Caption Studio", subtitle: "Per-platform AI captions · groq llama-3.3-70b" },
      accounts: { title: "Social Accounts", subtitle: "Connect Meta + YouTube · manage all brand channels" },
      tokens: { title: "Token Health", subtitle: "All tokens encrypted · monitored every 6 hours" },
      logs: { title: "Publish Logs", subtitle: `${items.filter(i => i.status === 'PUBLISHED').length} publishing records · every post traced` },
      reach: { title: "Reach Report", subtitle: "312K reach in 7 days · WhatsApp clicks tracked" },
      failed: { title: "Failed Jobs", subtitle: "Self-healing retries · 3× with 30s delay" },
      'thumbnail-brain': { title: "Thumbnail Brain", subtitle: "Central AI prompt and settings for all thumbnail generation" }
    };
    return pages[view] || { title: "Content OS Console", subtitle: "ABM Groups Publishing command center" };
  };

  const headerMeta = getPageHeader();
  const activeBrandsList = brands;
  
  const selectedBrandObj = activeBrandsList.find(b => b.slug === selectedBrand);
  const selectedBrandColor = selectedBrandObj 
    ? getBrandConfig(selectedBrandObj.name).color 
    : 'var(--t3)';

  return (
    <div className="content-os-dashboard">

      {/* MAIN VIEW AREA */}
      <main className="main">
        {/* Header bar */}
        <div className="topbar">
          <div>
            <div className="tb-title">
              {headerMeta.title} 
              <span className="tb-badge tbb-g" style={{ marginLeft: 10, background: selectedBrand === 'all' ? 'transparent' : 'rgba(212,168,67,0.12)' }}>
                {selectedBrand === 'all' ? 'All Brands' : selectedBrand.toUpperCase()}
              </span>
            </div>
            <div className="tb-sub">{headerMeta.subtitle}</div>
          </div>

          <div className="tb-right">
            {/* Global Brand Selector dropdown */}
            <div className="brand-global">
              <span className="bg-dot" style={{ background: selectedBrand === 'all' ? 'linear-gradient(135deg,var(--gold),var(--teal))' : selectedBrandColor }} />
              <select value={selectedBrand} onChange={e => setSelectedBrand(e.target.value)}>
                <option value="all">All Brands</option>
                {activeBrandsList.map(b => (
                  <option key={b.slug} value={b.slug}>{b.name}</option>
                ))}
              </select>
            </div>
            <button className="tb-btn" onClick={() => window.open('/', '_blank')}>Preview Live</button>
            <div className="bell-btn">
              ◔{items.some(i => (i.status || '').toUpperCase() === 'FAILED') && <span className="bell-dot" />}
            </div>
          </div>
        </div>

        {/* Scrollable Container with Sub-Views */}
        <div className="scroll">
          {view === 'approval' && (
            <ApprovalRoom
              items={items}
              selectedBrand={selectedBrand}
              stats={stats}
              analytics={analytics}
              selectedItem={selectedItem}
              setSelectedItem={setSelectedItem}
              canApprove={canApprove}
              isPublishing={isPublishing}
              handleApprove={handleApprove}
              handleReject={handleReject}
              handlePublishNow={handlePublishNow}
              handleScheduleItem={handleScheduleItem}
              editMode={editMode}
              setEditMode={setEditMode}
              editValues={editValues}
              setEditValues={setEditValues}
              handleSaveEdit={handleSaveEdit}
              togglePlatform={togglePlatform}
              toggleAccount={toggleAccount}
              socialAccounts={socialAccounts}
              isSameBrand={isSameBrand}
              getBrandConfig={getBrandConfig}
              getPlatformConfig={getPlatformConfig}
              formatTime={formatTime}
              extractDriveFileId={extractDriveFileId}
              handleOpenAiSuggestions={handleOpenAiSuggestions}
              handleGenerateFirstTime={handleGenerateFirstTime}
              loadingSuggestions={loadingSuggestions}
              suggestionsError={suggestionsError}
              confirmAction={confirmAction}
              setConfirmAction={setConfirmAction}
              rejectionReason={rejectionReason}
              setRejectionReason={setRejectionReason}
            />
          )}

          {view === 'monitors' && (
            <FolderMonitors
              monitors={monitors}
              loadingMonitors={loadingMonitors}
              monitorInputs={monitorInputs}
              setMonitorInputs={setMonitorInputs}
              handleSaveMonitor={handleSaveMonitor}
              brands={brands}
              getBrandConfig={getBrandConfig}
            />
          )}

          {view === 'scheduler' && (
            <SchedulerView
              items={items}
              selectedBrand={selectedBrand}
              isSameBrand={isSameBrand}
              formatTime={formatTime}
              getBrandConfig={getBrandConfig}
              getPlatformConfig={getPlatformConfig}
              stats={stats}
            />
          )}

          {view === 'captions' && (
            <CaptionStudio
              selectedItem={selectedItem}
              items={items}
              setSelectedItem={setSelectedItem}
              editValues={editValues}
              setEditValues={setEditValues}
              getPlatformConfig={getPlatformConfig}
              handleOpenAiSuggestions={handleOpenAiSuggestions}
              handleSaveEdit={handleSaveEdit}
              getBrandConfig={getBrandConfig}
              isSameBrand={isSameBrand}
              selectedBrand={selectedBrand}
            />
          )}

          {view === 'accounts' && (
            <SocialAccounts
              connectedAccounts={socialAccounts}
              loadConnectedAccounts={fetchAccounts}
              getPlatformConfig={getPlatformConfig}
              brands={brands}
            />
          )}

          {view === 'tokens' && (
            <TokenHealth connectedAccounts={socialAccounts} />
          )}

          {view === 'logs' && (
            <PublishLogs
              items={items}
              selectedBrand={selectedBrand}
              isSameBrand={isSameBrand}
              formatTime={formatTime}
            />
          )}

          {view === 'reach' && (
            <ReachReport
              items={items}
              selectedBrand={selectedBrand}
              isSameBrand={isSameBrand}
            />
          )}

          {view === 'failed' && (
            <FailedJobs
              items={items}
              selectedBrand={selectedBrand}
              isSameBrand={isSameBrand}
              formatTime={formatTime}
              handlePublishNow={handlePublishNow}
              isPublishing={isPublishing}
            />
          )}

          {view === 'thumbnail-brain' && <ThumbnailBrainStudio />}
        </div>
      </main>

      {/* AI Suggestion Dialog Overlay */}
      {isSuggestModalOpen && selectedItem && (
        <div className="content-os-dashboard-dialog-overlay">
          <div className="content-os-dashboard-dialog" style={{ maxWidth: 500 }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, fontFamily: "'Syne', sans-serif" }}>
              AI Caption Generator
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              <select 
                value={selectedTone} 
                onChange={e => setSelectedTone(e.target.value)}
                style={{ width: '100%', background: 'var(--bg3)', border: '1px solid var(--b1)', color: 'var(--t1)', padding: 8, borderRadius: 6, outline: 'none' }}
              >
                <option value="engaging">🔥 Engaging / Viral</option>
                <option value="professional">💼 Professional / B2B</option>
                <option value="educational">📚 Informational / Course</option>
                <option value="casual">👋 Friendly / Tanglish</option>
                <option value="clickbait">⚡ Clickbait / Urgency</option>
              </select>
              <textarea
                value={contextInfo}
                onChange={e => setContextInfo(e.target.value)}
                placeholder="Enter a short description or specific instructions for the AI..."
                style={{ width: '100%', minHeight: '60px', background: 'var(--bg3)', border: '1px solid var(--b1)', color: 'var(--t1)', padding: 8, borderRadius: 6, outline: 'none', resize: 'vertical' }}
              />
              <button 
                onClick={() => fetchAiSuggestions(selectedItem.id, selectedTone, suggestionType, contextInfo)}
                disabled={loadingSuggestions}
                className="act"
                style={{ background: 'var(--teal)', border: 'none', color: 'var(--bg)', padding: '8px 14px', borderRadius: 6, cursor: loadingSuggestions ? 'not-allowed' : 'pointer', fontWeight: 600 }}
              >
                {loadingSuggestions ? 'Generating...' : 'Generate Captions'}
              </button>
            </div>

            {loadingSuggestions ? (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--t3)' }}>
                Generating content recommendations using Groq Llama-3...
              </div>
            ) : suggestionsError ? (
              <div style={{ color: 'var(--red)', padding: 12, background: '#f04a5e15', borderRadius: 6, fontSize: 12 }}>
                {suggestionsError}
              </div>
            ) : (
              <div style={{ maxHeight: 250, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 4 }}>
                {(() => {
                  const cacheKey = `${selectedItem.id}_${selectedTone}_${suggestionType}_${contextInfo}`;
                  const rawList = suggestCache[cacheKey];
                  const itemsList = Array.isArray(rawList) ? rawList : [];
                  if (itemsList.length === 0) return <div style={{ textAlign: 'center', color: 'var(--t3)' }}>No suggestions returned</div>;
                  
                  return itemsList.map((s, idx) => (
                    <div 
                      key={idx} 
                      onClick={() => {
                        setEditValues(prev => ({ ...prev, [suggestionType]: s }));
                        setIsSuggestModalOpen(false);
                        showToast("Applied AI suggestion!");
                      }}
                      style={{ background: 'var(--bg)', border: '1px solid var(--b1)', borderRadius: 8, padding: 12, cursor: 'pointer', transition: 'background 0.12s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'var(--bg)'}
                    >
                      <p style={{ fontSize: 12.5, lineHeight: 1.5, margin: 0, color: 'var(--t1)' }}>{s}</p>
                    </div>
                  ));
                })()}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setIsSuggestModalOpen(false)} className="act" style={{ background: 'transparent', border: '1px solid var(--b2)', color: 'var(--t1)', padding: '6px 14px', flex: 'none' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Toast Alert */}
      {toast && (
        <div className={`toast ${toast ? 'show' : ''}`} style={{ background: toast.type === 'error' ? 'var(--red)' : 'var(--teal)', color: toast.type === 'error' ? '#fff' : 'var(--bg)' }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
