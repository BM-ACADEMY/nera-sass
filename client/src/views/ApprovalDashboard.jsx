import { useState, useEffect } from "react";
import { api } from "../services/api";
import { useAuth } from "../hooks/useAuth";

const COLORS = [
  { c: "#7C3AED", bg: "#F5F3FF" }, { c: "#06B6D4", bg: "#ECFEFF" },
  { c: "#10B981", bg: "#ECFDF5" }, { c: "#F59E0B", bg: "#FFFBEB" },
  { c: "#EF4444", bg: "#FEF2F2" }, { c: "#3B82F6", bg: "#EFF6FF" },
  { c: "#EC4899", bg: "#FDF2F8" }, { c: "#8B5CF6", bg: "#F5F3FF" }
];

function getBrandConfig(brandName) {
  const name = brandName || "Unknown";
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const idx = Math.abs(hash) % COLORS.length;
  const short = name.split(/[\s_]+/).map(w => w[0]).join('').substring(0,3).toUpperCase();
  return { name, color: COLORS[idx].c, bg: COLORS[idx].bg, short };
}

function getPlatformConfig(platform) {
  if (!platform) return { label: "Unknown", icon: "🌐", color: "#6B6B80" };
  const p = platform.toLowerCase();
  const known = {
    instagram:       { label: "Instagram Post",  icon: "📸", color: "#E1306C" },
    instagram_post:  { label: "Instagram Post",  icon: "📸", color: "#E1306C" },
    instagram_story: { label: "Instagram Story", icon: "📱", color: "#D3006A" },
    youtube:         { label: "YouTube",         icon: "▶️", color: "#FF0000" },
    facebook:        { label: "Facebook Post",   icon: "👍", color: "#1877F2" },
    facebook_post:   { label: "Facebook Post",   icon: "👍", color: "#1877F2" },
    facebook_story:  { label: "Facebook Story",  icon: "📱", color: "#1565C0" },
    x_twitter:       { label: "X",               icon: "𝕏", color: "#000000" },
    linkedin:        { label: "LinkedIn",        icon: "in", color: "#0A66C2" },
  };
  if (known[p]) return known[p];
  
  let hash = 0;
  for (let i = 0; i < p.length; i++) hash = p.charCodeAt(i) + ((hash << 5) - hash);
  return { label: platform, icon: "🌐", color: COLORS[Math.abs(hash) % COLORS.length].c };
}

function instagramMediaIdToShortcode(mediaId) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let code = '';
  try {
    let n = BigInt(mediaId);
    while (n > 0n) { code = alpha[Number(n % 64n)] + code; n = n / 64n; }
  } catch (_) { return null; }
  return code || null;
}

function normalizePlatform(p) {
  return (p || "").toLowerCase().replace(/_(post|reel|short|story|video)$/, "");
}

function getPlatformPostEntry(platform, platformPostIds) {
  if (!Array.isArray(platformPostIds) || !platform) return null;
  const norm = normalizePlatform(platform);
  return platformPostIds.find(e => e && normalizePlatform(e.platform) === norm) || null;
}

function buildPlatformUrl(platform, entry) {
  if (!entry) return null;
  if (entry.url) return entry.url;
  const postId = entry.post_id;
  if (!postId) return null;
  const p = (platform || "").toLowerCase();
  if (p.includes("youtube")) return `https://www.youtube.com/watch?v=${postId}`;
  if (p.includes("linkedin")) return `https://www.linkedin.com/feed/update/${postId}/`;
  if (p.includes("facebook")) {
    if (postId.includes("_")) {
      const [pageId, pid] = postId.split("_");
      return `https://www.facebook.com/permalink.php?story_fbid=${pid}&id=${pageId}`;
    }
    return `https://www.facebook.com/watch?v=${postId}`;
  }
  if (p.includes("instagram")) return null;
  return null;
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
          console.error(`Failed to parse field ${field} for item ${item.id}:`, e);
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

function isSameBrand(brandA, brandB) {
  if (!brandA || !brandB) return false;
  const normalize = (name) => name.toLowerCase().replace(/['"_-]/g, '').replace(/\s+/g, '');
  return normalize(brandA) === normalize(brandB);
}

export default function ApprovalDashboard() {
  const { user } = useAuth();
  const canApprove = !user || !user.role || ['Super Admin', 'Marketing Admin', 'super_admin', 'admin', 'founder', 'Founder'].includes(user.role);

  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const isMobile = windowWidth < 768;
  const isTablet = windowWidth < 1024;

  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({ PENDING: 0, APPROVED: 0, REJECTED: 0, PUBLISHED: 0, FAILED: 0 });
  const [analytics, setAnalytics] = useState({ total: 0, pending: 0, publishedToday: 0, failedToday: 0 });
  const [socialAccounts, setSocialAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState("caption");
  const [editMode, setEditMode] = useState(false);
  const [editValues, setEditValues] = useState({});
  const [filter, setFilter] = useState("PENDING");
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [toast, setToast] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [view, setView] = useState("queue"); // queue | generate | monitors
  const [monitors, setMonitors] = useState([]);
  const [loadingMonitors, setLoadingMonitors] = useState(false);
  const [monitorInputs, setMonitorInputs] = useState({});
  const [brands, setBrands] = useState([]);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isSuggestModalOpen, setIsSuggestModalOpen] = useState(false);
  const [suggestCache, setSuggestCache] = useState({});
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState(null);
  const [selectedTone, setSelectedTone] = useState("engaging");
  const [suggestionType, setSuggestionType] = useState("caption");
  const [suggestionPlatform, setSuggestionPlatform] = useState(null);

  // Thumbnail feature states
  const [isThumbnailModalOpen, setIsThumbnailModalOpen] = useState(false);
  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);
  const [thumbnailCandidates, setThumbnailCandidates] = useState([]);
  const [selectedThumbnailCandidate, setSelectedThumbnailCandidate] = useState(null);

  async function fetchMonitors() {
    setLoadingMonitors(true);
    try {
      let activeBrands = brands;
      if (activeBrands.length === 0) {
        const res = await api.getClients();
        const seenSlugs = new Set();
        activeBrands = (res.clients || [])
          .filter(c => c.status === "active" || c.status === "Live")
          .map(c => {
            const known = {
              "BM Academy": "bm_academy",
              "BM TechX": "bm_techx",
              "Namma Pondy Properties": "namma_pondy_properties",
              "Dada's Kitchen": "dadas_kitchen",
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
      }

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
    } catch(e) {
      console.error(e);
      showToast("Failed to retrieve monitors", "error");
    } finally {
      setLoadingMonitors(false);
    }
  }

  async function handleSaveMonitor(brandSlug) {
    const rawVal = monitorInputs[brandSlug] || "";
    const folderId = rawVal.includes("/folders/") ? (rawVal.match(/\/folders\/([a-zA-Z0-9_-]+)/)?.[1] || rawVal) : rawVal;
    try {
      const res = await api.post("/api/content-os/folders", {
        brandSlug,
        folderId
      });
      if (res.success) {
        showToast(`Saved folder monitor!`);
        fetchMonitors();
      } else {
        showToast("Failed to save monitor", "error");
      }
    } catch (e) {
      showToast("Error saving monitor: " + e.message, "error");
    }
  }

  async function handlePublishNow(id) {
    setIsPublishing(true);
    showToast("Publishing to Facebook & Instagram... 🚀");
    try {
      if (editMode) {
        await api.updateContent(id, editValues);
      }
      
      const res = await api.publishContent(id);
      if (res.success) {
        showToast("Successfully published! 🎉");
        fetchData();
        setSelected(null);
      } else {
        showToast(res.error || "Failed to publish", "error");
        fetchData();
        setSelected(null);
      }
    } catch(e) {
      showToast("Error triggering publish: " + e.message, "error");
    } finally {
      setIsPublishing(false);
    }
  }

  useEffect(() => {
    if (view === "monitors") {
      fetchMonitors();
    }
  }, [view]);

  async function handleCreatePosts(newItems) {
    try {
      const res = await api.createBatchContent(newItems);
      if (res.success) {
        showToast(`Successfully added ${res.items.length} posts to staging queue!`);
        setView("queue");
        fetchData();
      } else {
        showToast(res.error || "Failed to create posts", "error");
      }
    } catch (e) {
      showToast("Error creating posts: " + e.message, "error");
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => fetchData(), 400);
    return () => clearTimeout(timer);
  }, [filter, search, startDate, endDate]);

  useEffect(() => {
    fetchAccounts();
  }, []);

  // Auto-poll when any item in the list is currently publishing
  useEffect(() => {
    const hasPublishingItems = items.some(item => {
      const s = (item.status || "").toUpperCase();
      return s === "PUBLISHING" || s === "PROCESSING";
    });

    if (hasPublishingItems) {
      const interval = setInterval(() => {
        fetchData(false);
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [items]);

  // Keep selected details view in sync when auto-poll updates items list
  useEffect(() => {
    if (selected) {
      const updated = items.find(i => i.id === selected.id);
      if (updated && JSON.stringify(updated) !== JSON.stringify(selected)) {
        setSelected(updated);
      }
    }
  }, [items, selected]);


  async function fetchData(showLoading = true) {
    if (showLoading) setLoading(true);
    try {
      let apiStatus = filter;
      if (filter === "PENDING") apiStatus = "pending_approval";
      else if (filter === "APPROVED") apiStatus = "approved";
      else if (filter === "REJECTED") apiStatus = "rejected";
      else if (filter === "PUBLISHED") apiStatus = "published";
      else if (filter === "FAILED") apiStatus = "failed";
      else if (filter === "ALL") apiStatus = "all";

      const res = await api.getContentQueue({ 
        status: apiStatus,
        search, startDate, endDate
      });
      setItems((res.items || []).map(parseItemJsonFields));

      const statsRes = await api.getContentStats();
      if (statsRes.success) {
        const s = statsRes.stats;
        setStats({
          PENDING: s.pending || 0,
          APPROVED: s.approved || 0,
          REJECTED: s.rejected || 0,
          PUBLISHED: s.published_today || 0,
          FAILED: s.failed_today || 0
        });
        setAnalytics({
          total: s.total || 0,
          pending: s.pending || 0,
          publishedToday: s.published_today || 0,
          failedToday: s.failed_today || 0
        });
      }
    } catch(e) {
      showToast("Error loading data", "error");
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  async function fetchAccounts() {
    try {
      const res = await api.getSocialAccounts();
      setSocialAccounts(res);
    } catch(e) {
      console.error(e);
    }
  }

  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  function openItem(item) {
    const parsedItem = parseItemJsonFields(item);
    let initialSelectedAccounts = { ...parsedItem.selected_accounts };

    const resolvedItem = {
      ...parsedItem,
      selected_accounts: initialSelectedAccounts
    };

    setSelected(resolvedItem);

    // Find the first connected platform to select as default tab
    let defaultTab = "description";
    const brandPlats = socialAccounts.filter(s => isSameBrand(s.brand_name, resolvedItem.brand_name) && s.is_active).map(s => s.platform);
    if (brandPlats.includes("instagram")) {
      defaultTab = "instagram_caption";
    } else if (brandPlats.includes("facebook")) {
      defaultTab = "facebook_caption";
    } else if (brandPlats.includes("youtube")) {
      defaultTab = "youtube_title";
    } else if (brandPlats.includes("linkedin")) {
      defaultTab = "linkedin_caption";
    } else if (brandPlats.includes("twitter") || brandPlats.includes("x")) {
      defaultTab = "x_caption";
    }
    setTab(defaultTab);

    setEditMode(false);
    setEditValues({
      caption: resolvedItem.caption,
      instagram_caption: resolvedItem.instagram_caption || resolvedItem.caption || "",
      facebook_caption: resolvedItem.facebook_caption || resolvedItem.caption || "",
      x_caption: resolvedItem.x_caption || "",
      linkedin_caption: resolvedItem.linkedin_caption || "",
      youtube_title: resolvedItem.youtube_title || resolvedItem.thumbnail_title || "",
      youtube_description: resolvedItem.youtube_description || resolvedItem.description || resolvedItem.caption || "",
      thumbnail_title: resolvedItem.thumbnail_title,
      scheduled_at: resolvedItem.scheduled_at,
      platforms: [...(resolvedItem.platforms || [])],
      selected_accounts: initialSelectedAccounts,
      video_url: resolvedItem.video_url || "",
      public_video_url: resolvedItem.public_video_url || "",
      description: resolvedItem.description || "",
      hashtags: resolvedItem.hashtags || "",
      thumbnail_options: resolvedItem.thumbnail_options || [],
      key_moments: resolvedItem.key_moments || [],
      thumbnail_url: resolvedItem.thumbnail_url || "",
      story_1: resolvedItem.story_1 || "",
      story_2: resolvedItem.story_2 || "",
      story_3: resolvedItem.story_3 || "",
    });
  }

  function getApprovalValidationError() {
    if (!selected) return null;
    
    // Determine active selected channels
    const channels = editMode ? (editValues.platforms || []) : (selected.platforms || []);
    
    if (!channels || channels.length === 0) {
      return "Please select at least one publishing channel.";
    }

    // Check connected accounts for this brand
    const connectedAccounts = (socialAccounts || []).filter(
      s => isSameBrand(s.brand_name, selected.brand_name) && s.is_active !== false
    );
    const connectedPlatforms = new Set(connectedAccounts.map(s => s.platform.toLowerCase()));

    const platformNames = {
      instagram: 'Instagram',
      facebook: 'Facebook',
      youtube: 'YouTube',
      linkedin: 'LinkedIn',
      x_twitter: 'X/Twitter'
    };

    for (const channel of channels) {
      let requiredPlatform = channel.toLowerCase();
      if (requiredPlatform.includes('instagram')) requiredPlatform = 'instagram';
      if (requiredPlatform.includes('facebook')) requiredPlatform = 'facebook';
      if (requiredPlatform === 'x_twitter') requiredPlatform = 'x_twitter';

      const displayPlat = platformNames[requiredPlatform] || (requiredPlatform.charAt(0).toUpperCase() + requiredPlatform.slice(1));

      if (!connectedPlatforms.has(requiredPlatform)) {
        return `${displayPlat} account is not connected for this brand.`;
      }

      // Check if at least one account is selected for this platform
      const brandPlatAccounts = connectedAccounts.filter(s => s.platform === requiredPlatform);
      if (brandPlatAccounts.length > 0) {
        const getSelectedAccs = (accsObj) => {
          if (!accsObj) return [];
          const direct = accsObj[channel] || accsObj[requiredPlatform] || [];
          if (direct.length > 0) return direct;
          
          if (channel === 'instagram') return accsObj['instagram_post'] || [];
          if (channel === 'facebook') return accsObj['facebook_post'] || [];
          if (channel === 'instagram_post') return accsObj['instagram'] || [];
          if (channel === 'facebook_post') return accsObj['facebook'] || [];
          
          return [];
        };

        const selectedAccs = editMode
          ? getSelectedAccs(editValues.selected_accounts)
          : getSelectedAccs(selected.selected_accounts);
        
        if (!selectedAccs || selectedAccs.length === 0) {
          return `Please select at least one account for ${displayPlat}.`;
        }
      }
    }

    return null;
  }

  async function handleApprove(id) {
    const valError = getApprovalValidationError();
    if (valError) {
      showToast(valError, "error");
      return;
    }
    try {
      if (editMode) {
        await api.updateContent(id, editValues);
      }
      await api.approveContent(id);
      if (filter !== "ALL" && filter !== "APPROVED") {
        setItems(prev => prev.filter(i => i.id !== id));
      } else {
        const updatedItem = editMode 
          ? parseItemJsonFields({ ...selected, ...editValues, status: "approved" })
          : { ...selected, status: "approved" };
        setItems(prev => prev.map(i => i.id === id ? updatedItem : i));
      }
      setStats(prev => ({ ...prev, PENDING: Math.max(0, prev.PENDING - 1), APPROVED: prev.APPROVED + 1 }));
      setEditMode(false);
      setSelected(null);
      showToast("Content approved — publishing queue updated ✅");
      fetchData(false);
    } catch(e) {
      showToast("Approval failed", "error");
    }
  }

  async function handleReject(id, reason) {
    try {
      await api.rejectContent(id, reason);
      if (filter !== "ALL" && filter !== "REJECTED") {
        setItems(prev => prev.filter(i => i.id !== id));
      } else {
        setItems(prev => prev.map(i => i.id === id ? { ...i, status: "rejected" } : i));
      }
      setStats(prev => ({ ...prev, PENDING: Math.max(0, prev.PENDING - 1), REJECTED: prev.REJECTED + 1 }));
      setSelected(null);
      showToast("Content rejected", "error");
      setConfirmAction(null);
      setRejectionReason("");
      fetchData(false);
    } catch(e) {
      showToast("Rejection failed", "error");
    }
  }

  async function handleSaveEdit(id) {
    try {
      const updated = await api.updateContent(id, editValues);
      const parsedItem = parseItemJsonFields(updated.item);
      setItems(prev => prev.map(i => i.id === id ? parsedItem : i));
      if (selected?.id === id) setSelected(parsedItem);
      setEditMode(false);
      showToast("Changes saved");
    } catch(e) {
      showToast("Failed to save changes", "error");
    }
  }

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

  function toggleAccount(platform, accountId) {
    setEditValues(prev => {
      let normalizedPlatform = platform;
      if (platform.includes('instagram')) {
        normalizedPlatform = 'instagram';
      } else if (platform.includes('facebook')) {
        normalizedPlatform = 'facebook';
      }
      
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

  function formatTime(iso) {
    if (!iso) return "Not set";
    return new Date(iso).toLocaleString("en-IN", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
    });
  }

  function formatLocalDatetimeForInput(isoString) {
    if (!isoString) return "";
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const handleOpenAiSuggestions = (type = "caption", forceTone = null, platform = null) => {
    if (!selected) return;
    const toneToUse = forceTone || selectedTone;
    setSuggestionType(type);
    setSuggestionPlatform(platform);
    setIsSuggestModalOpen(true);
    
    const cacheKey = `${selected.id}_${toneToUse}_${type}_${platform || 'all'}`;
    if (suggestCache[cacheKey]) {
      return;
    }
    
    fetchAiSuggestions(selected.id, toneToUse, type, platform);
  };

  const handleGenerateThumbnails = async () => {
    if (!selected) return;
    setIsGeneratingThumbnails(true);
    try {
      const res = await api.generateThumbnails(selected.id);
      if (res.success && res.thumbnails && res.thumbnails.length > 0) {
        setThumbnailCandidates(res.thumbnails);
        setSelectedThumbnailCandidate(res.thumbnails[0]);
        setIsThumbnailModalOpen(true);
      } else {
        showToast(res.error || "Failed to extract thumbnail frames", "error");
      }
    } catch (err) {
      showToast(err.message || "Error extracting frames", "error");
    } finally {
      setIsGeneratingThumbnails(false);
    }
  };

  const handleSaveThumbnail = async () => {
    if (!selected || !selectedThumbnailCandidate) return;
    try {
      const updated = await api.updateContent(selected.id, { thumbnail_url: selectedThumbnailCandidate });
      setItems(prev => prev.map(i => i.id === selected.id ? { ...i, thumbnail_url: selectedThumbnailCandidate } : i));
      setSelected(prev => ({ ...prev, thumbnail_url: selectedThumbnailCandidate }));
      if (editMode) {
        setEditValues(prev => ({ ...prev, thumbnail_url: selectedThumbnailCandidate }));
      }
      setIsThumbnailModalOpen(false);
      showToast("Thumbnail updated successfully!");
    } catch (err) {
      showToast("Failed to update thumbnail", "error");
    }
  };

  const fetchAiSuggestions = async (itemId, tone, type = "caption", platform = null) => {
    setLoadingSuggestions(true);
    setSuggestionsError(null);
    try {
      const res = type === "story"
        ? await api.getAiStorySuggestions(itemId, tone)
        : await api.getAiCaptionSuggestions(itemId, tone, platform);
      if (res.success && res.suggestions) {
        const cacheKey = `${itemId}_${tone}_${type}_${platform || 'all'}`;
        setSuggestCache(prev => ({
          ...prev,
          [cacheKey]: res.suggestions
        }));
      } else {
        setSuggestionsError("Failed to fetch suggestions");
      }
    } catch (err) {
      setSuggestionsError(err.message || "Failed to generate suggestions. Please try again.");
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const brandConf = selected ? getBrandConfig(selected.brand_name) : null;
  const validationError = getApprovalValidationError();

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: "#F8F7FF", height: "100%", color: "#1A1A2E", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* ── TOPBAR ── */}
      <div style={{ background: "#0A0A0F", padding: isMobile ? "0 12px" : "0 24px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 12 }}>
          <div style={{ fontWeight: 700, fontSize: isMobile ? 13 : 15, color: "#E8E8F0", letterSpacing: "-0.3px" }}>
            ABM Groups <span style={{ color: "#7C3AED" }}>· Content OS</span>
          </div>
          <div style={{ background: "#7C3AED22", border: "1px solid #7C3AED44", borderRadius: 20, padding: "2px 8px", fontSize: 10, color: "#A78BFA", fontWeight: 600, whiteSpace: "nowrap" }}>
            Approval Dashboard
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 16 }}>
          {stats.PENDING > 0 && (
            <div style={{ background: "#EF444420", border: "1px solid #EF444444", borderRadius: 20, padding: "3px 10px", fontSize: 11, color: "#EF4444", fontWeight: 700, whiteSpace: "nowrap" }}>
              {stats.PENDING} pending
            </div>
          )}
          {!isMobile && <div style={{ fontSize: 12, color: "#6B6B80" }}>{user?.role || 'Admin'}</div>}
        </div>
      </div>

      {/* ── TABS NAVIGATION ── */}
      <div style={{ display: "flex", borderBottom: "1px solid #E5E4F0", background: "#fff", padding: isMobile ? "0 12px" : "0 24px" }}>
        <button 
          onClick={() => setView("queue")} 
          style={{
            padding: "14px 16px",
            fontSize: 13,
            fontWeight: 700,
            background: "transparent",
            border: "none",
            borderBottom: view === "queue" ? "3px solid #7C3AED" : "3px solid transparent",
            color: view === "queue" ? "#7C3AED" : "#6B6B80",
            cursor: "pointer",
            transition: "all 0.15s"
          }}
        >
          📥 Approval Queue
        </button>
        <button 
          onClick={() => setView("monitors")} 
          style={{
            padding: "14px 16px",
            fontSize: 13,
            fontWeight: 700,
            background: "transparent",
            border: "none",
            borderBottom: view === "monitors" ? "3px solid #7C3AED" : "3px solid transparent",
            color: view === "monitors" ? "#7C3AED" : "#6B6B80",
            cursor: "pointer",
            transition: "all 0.15s"
          }}
        >
          📁 Folder Monitors
        </button>
      </div>

      {view === "monitors" ? (
        <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? 16 : 24 }}>
          <div style={{ maxWidth: 800, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
              <span style={{ fontSize: 24 }}>📁</span>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1A1A2E" }}>Google Drive Folder Monitors</h2>
                <p style={{ margin: 0, fontSize: 13, color: "#6B6B80" }}>Configure Google Drive folder IDs for automated video ingestion.</p>
              </div>
            </div>

            <div style={{ background: "#FFFBEB", border: "1px solid #F59E0B44", borderRadius: 12, padding: 16, marginBottom: 24 }}>
              <div style={{ fontWeight: 700, color: "#B45309", fontSize: 13, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                ⚠️ Important Action Required
              </div>
              <div style={{ fontSize: 12, color: "#B45309", lineHeight: 1.5 }}>
                You must share each Google Drive folder with the LeadOS service account email:
                <code style={{ background: "#fff", padding: "2px 6px", borderRadius: 4, fontWeight: 700, marginLeft: 4, marginRight: 4, border: "1px solid #F59E0B66" }}>
                  leados-drive-sync@jobportal-492311.iam.gserviceaccount.com
                </code>
                as a <strong>Viewer</strong> or <strong>Editor</strong>. Otherwise, LeadOS will not be able to auto-detect and analyze your videos.
              </div>
            </div>

            {loadingMonitors ? (
              <div style={{ padding: 40, textAlign: "center", color: "#6B6B80" }}>Loading folder settings...</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {brands.map(brand => {
                  const folderId = monitorInputs[brand.slug] || "";
                  return (
                    <div key={brand.slug} style={{ background: "#fff", border: "1px solid #E5E4F0", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 700, fontSize: 14, color: "#1A1A2E" }}>{brand.name}</span>
                        <span style={{ fontSize: 11, color: "#6B6B80" }}>{brand.slug}</span>
                      </div>
                      <div style={{ display: "flex", gap: 12 }}>
                        <input 
                          type="text"
                          placeholder="Paste Google Drive Folder Link or Folder ID..."
                          value={folderId}
                          onChange={e => setMonitorInputs(prev => ({ ...prev, [brand.slug]: e.target.value }))}
                          style={{ flex: 1, padding: "10px 14px", border: "1px solid #E5E4F0", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" }}
                        />
                        <button 
                          onClick={() => handleSaveMonitor(brand.slug)}
                          style={{ padding: "10px 20px", background: "#7C3AED", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer", transition: "all 0.15s" }}
                        >
                          Save Monitor
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* ── ANALYTICS BAR ── */}
      <div style={{ padding: isMobile ? "12px" : "16px 24px", display: "flex", gap: isMobile ? 8 : 16, flexWrap: "wrap", borderBottom: "1px solid #E5E4F0", background: "#fff" }}>
        {[{ label: "Total Content", val: analytics.total }, 
          { label: "Pending", val: analytics.pending, color: "#F59E0B" }, 
          { label: "Published Today", val: analytics.publishedToday, color: "#10B981" }, 
          { label: "Failed Today", val: analytics.failedToday, color: "#EF4444" }
        ].map(a => (
          <div key={a.label} style={{ flex: isMobile ? "1 1 calc(50% - 8px)" : 1, minWidth: isMobile ? 120 : "auto", padding: isMobile ? 12 : 16, borderRadius: 12, border: "1px solid #E5E4F0", background: "#FAFAFF", boxSizing: "border-box" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6B6B80", textTransform: "uppercase", marginBottom: 4 }}>{a.label}</div>
            <div style={{ fontSize: isMobile ? 20 : 24, fontWeight: 800, color: a.color || "#1A1A2E", letterSpacing: "-0.5px" }}>{a.val}</div>
          </div>
        ))}
      </div>

      {/* ── LAYOUT ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── LEFT PANEL — CONTENT LIST ── */}
        <div style={{ width: isMobile ? "100%" : 340, flexShrink: 0, background: "#fff", borderRight: isMobile ? "none" : "1px solid #E5E4F0", overflowY: "auto", display: isMobile && selected ? "none" : "flex", flexDirection: "column" }}>

          {/* Filters & Search */}
          <div style={{ padding: 16, borderBottom: "1px solid #E5E4F0", background: "#FAFAFF" }}>
            <input 
              type="text" 
              placeholder="Search title, brand, or file..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #E5E4F0", fontSize: 12, outline: "none", boxSizing: "border-box", marginBottom: 12 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <input 
                type="date" 
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                style={{ flex: 1, padding: "8px", borderRadius: 8, border: "1px solid #E5E4F0", fontSize: 11, outline: "none", boxSizing: "border-box" }}
              />
              <input 
                type="date" 
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                style={{ flex: 1, padding: "8px", borderRadius: 8, border: "1px solid #E5E4F0", fontSize: 11, outline: "none", boxSizing: "border-box" }}
              />
            </div>
          </div>

          {/* Filter tabs */}
          <div style={{ padding: "16px 16px 0", borderBottom: "1px solid #E5E4F0" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6B6B80", letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>Content Queue</div>
            <div style={{ display: "flex", gap: 4, marginBottom: -1, overflowX: "auto", paddingBottom: 4 }}>
              {["PENDING","APPROVED","REJECTED","PUBLISHED","FAILED","ALL"].map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{
                  padding: "6px 12px", fontSize: 11, fontWeight: 600,
                  background: filter === f ? "#7C3AED" : "transparent",
                  color: filter === f ? "#fff" : "#6B6B80",
                  border: "none", borderRadius: "6px 6px 0 0",
                  cursor: "pointer", transition: "all 0.15s", whiteSpace: "nowrap"
                }}>{f}</button>
              ))}
            </div>
          </div>

          {/* Items */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {loading && <div style={{ padding: 32, textAlign: "center", color: "#6B6B80", fontSize: 13 }}>Loading...</div>}
            {!loading && items.length === 0 && (
              <div style={{ padding: 32, textAlign: "center", color: "#6B6B80", fontSize: 13 }}>
                No {filter.toLowerCase()} items
              </div>
            )}
            {!loading && items.map(item => {
              const bc = getBrandConfig(item.brand_name);
              const isActive = selected?.id === item.id;
              return (
                <div key={item.id} onClick={() => openItem(item)} style={{
                  padding: "14px 16px", cursor: "pointer", borderBottom: "1px solid #F0EFF8",
                  background: isActive ? "#F5F3FF" : "transparent",
                  borderLeft: isActive ? `3px solid ${bc.color}` : "3px solid transparent",
                  transition: "all 0.15s"
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ background: bc.bg, border: `1px solid ${bc.color}33`, borderRadius: 5, padding: "2px 7px", fontSize: 10, fontWeight: 700, color: bc.color }}>
                        {bc.short}
                      </div>
                      <StatusBadge status={item.status} />
                    </div>
                    <div style={{ fontSize: 10, color: "#9CA3AF" }}>{formatTime(item.created_at)}</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1A1A2E", marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {item.thumbnail_title || item.caption?.substring(0, 40) || 'Untitled'}
                  </div>
                  <div style={{ fontSize: 11, color: "#6B6B80", marginBottom: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {item.file_name || 'No video file'}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {(item.platforms || []).map(p => {
                      const pConf = getPlatformConfig(p);
                      const isPublished = item.status === "PUBLISHED" || item.status === "published";
                      const entry = isPublished ? getPlatformPostEntry(p, item.platform_post_ids) : null;
                      const url = isPublished ? buildPlatformUrl(p, entry) : null;
                      const style = {
                        fontSize: 10, padding: "3px 8px", borderRadius: 6,
                        background: isPublished ? (pConf.color + "15") : "#F0EFF8",
                        border: isPublished ? `1px solid ${pConf.color}44` : "1px solid transparent",
                        color: isPublished ? pConf.color : "#6B6B80",
                        fontWeight: isPublished ? 600 : 400,
                        cursor: url ? "pointer" : "default",
                        textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 3
                      };
                      return url ? (
                        <a key={p} href={url} target="_blank" rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()} style={style}>
                          {pConf.icon} {pConf.label} ↗
                        </a>
                      ) : (
                        <span key={p} style={style}>
                          {pConf.icon} {pConf.label}
                          {isPublished && entry && <span style={{ fontSize: 9, opacity: 0.6 }}> ✓</span>}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── MAIN PANEL — DETAIL VIEW ── */}
        {!selected ? (
          <div style={{ flex: 1, display: isMobile ? "none" : "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, color: "#6B6B80" }}>
            <div style={{ fontSize: 40 }}>📋</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#1A1A2E" }}>Select a content item to review</div>
            <div style={{ fontSize: 13 }}>{stats.PENDING} items waiting for approval</div>
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? 16 : 24, display: isMobile && !selected ? "none" : "block" }}>

            {isMobile && (
              <button 
                onClick={() => setSelected(null)} 
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "none",
                  border: "none",
                  color: "#7C3AED",
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: "pointer",
                  padding: "0 0 16px 0"
                }}
              >
                ← Back to List
              </button>
            )}

            {/* Item header */}
            <div style={{ 
              display: "flex", 
              flexDirection: isMobile ? "column" : "row", 
              alignItems: isMobile ? "stretch" : "flex-start", 
              justifyContent: "space-between", 
              gap: 16,
              marginBottom: 20 
            }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <div style={{ background: brandConf.bg, border: `1px solid ${brandConf.color}44`, borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 700, color: brandConf.color }}>
                    {brandConf.name}
                  </div>
                  <StatusBadge status={selected.status} />
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#1A1A2E", letterSpacing: "-0.3px", marginBottom: 4 }}>
                  {selected.thumbnail_title || 'Untitled Post'}
                </div>
                <div style={{ fontSize: 12, color: "#9CA3AF" }}>
                  {selected.file_name} · Uploaded {formatTime(selected.created_at)}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: isMobile ? "stretch" : "flex-end", gap: 6 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: isMobile ? "stretch" : "flex-end" }}>
                  {canApprove && ["PENDING", "pending_approval"].includes(selected.status) && (
                    <>
                      <button onClick={() => setConfirmAction({ type: "reject", id: selected.id })} style={{
                        padding: "8px 16px", borderRadius: 8, border: "1px solid #EF444444",
                        background: "#FEF2F2", color: "#EF4444", fontWeight: 600, fontSize: 13, cursor: "pointer"
                      }}>✕ Reject</button>
                      <button 
                        disabled={!!validationError}
                        onClick={() => handleApprove(selected.id)} 
                        style={{
                          padding: "8px 20px", borderRadius: 8, border: "none",
                          background: validationError ? "#9CA3AF" : "#10B981", 
                          color: "#fff", fontWeight: 700, fontSize: 13, 
                          cursor: validationError ? "not-allowed" : "pointer",
                          boxShadow: validationError ? "none" : "0 2px 8px #10B98133",
                          opacity: validationError ? 0.7 : 1
                        }}
                      >
                        ✓ Approve
                      </button>
                    </>
                  )}
                  {canApprove && ["approved", "APPROVED"].includes(selected.status) && (
                    <button 
                      disabled={isPublishing || validationError}
                      onClick={() => handlePublishNow(selected.id)} 
                      title={validationError || ""}
                      style={{
                        padding: "8px 20px", borderRadius: 8, border: "none",
                        background: (isPublishing || validationError) ? "#9CA3AF" : "#7C3AED", 
                        color: "#fff", fontWeight: 700, fontSize: 13, 
                        cursor: (isPublishing || validationError) ? "not-allowed" : "pointer",
                        boxShadow: (isPublishing || validationError) ? "none" : "0 2px 8px #7C3AED33",
                        transition: "all 0.15s"
                      }}
                    >
                      {isPublishing ? "Publishing..." : "🚀 Publish Now"}
                    </button>
                  )}
                   {/* Editing allowed for all if PENDING, REJECTED, or APPROVED */}
                  {(["PENDING", "pending_approval", "REJECTED", "rejected", "approved", "APPROVED"].includes(selected.status)) && (
                    <button onClick={() => setEditMode(!editMode)} style={{
                      padding: "8px 16px", borderRadius: 8, border: "1px solid #E5E4F0",
                      background: editMode ? "#F5F3FF" : "#fff", color: editMode ? "#7C3AED" : "#1A1A2E",
                      fontWeight: 600, fontSize: 13, cursor: "pointer"
                    }}>
                      {editMode ? "✏️ Editing" : "✏️ Edit"}
                    </button>
                  )}
                  {editMode && (
                    <button onClick={() => handleSaveEdit(selected.id)} style={{
                      padding: "8px 16px", borderRadius: 8, border: "none",
                      background: "#06B6D4", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer"
                    }}>Save Changes</button>
                  )}
                </div>
                {validationError && (
                  <div style={{ color: "#EF4444", fontSize: 11, fontWeight: 600, textAlign: isMobile ? "left" : "right", marginTop: 2 }}>
                    ⚠️ {validationError}
                  </div>
                )}
              </div>
            </div>

            {selected.rejection_reason && selected.status === "REJECTED" && (
              <div style={{ background: "#FEF2F2", border: "1px solid #EF444466", borderRadius: 8, padding: 16, marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#EF4444", textTransform: "uppercase", marginBottom: 6 }}>Rejection Reason (by {selected.rejected_by})</div>
                <div style={{ fontSize: 14, color: "#991B1B" }}>{selected.rejection_reason}</div>
              </div>
            )}

            {selected.status === "FAILED" && (
              <div style={{ background: "#FEF2F2", border: "1px solid #EF444466", borderRadius: 8, padding: 16, marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#EF4444", textTransform: "uppercase", marginBottom: 6 }}>Publishing Failed at {formatTime(selected.failed_at)}</div>
                <div style={{ fontSize: 14, color: "#991B1B" }}>{selected.error_message}</div>
              </div>
            )}

            {/* Two column layout */}
            <div style={{ display: "grid", gridTemplateColumns: isTablet ? "1fr" : "1fr 320px", gap: 20 }}>

              {/* LEFT — Media and Main Captions */}
              <div>
                {/* Video Player */}
                <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E5E4F0", overflow: "hidden", marginBottom: 16 }}>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #E5E4F0", background: "#F8F7FF", fontSize: 12, fontWeight: 700, color: "#6B6B80", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    🎥 Video Preview
                  </div>
                  <div style={{ padding: 16, background: "#0A0A0F", display: "flex", justifyContent: "center", minHeight: 300, maxHeight: 400 }}>
                    {selected.video_url || selected.public_video_url ? (
                      (() => {
                        const pubUrl = selected.public_video_url;
                        const isTranscoded = pubUrl && !extractDriveFileId(pubUrl);
                        if (isTranscoded) {
                          return (
                            <video 
                              controls 
                              preload="metadata"
                              style={{ maxWidth: "100%", height: "auto", maxHeight: 360, borderRadius: 8 }}
                              src={pubUrl}
                            >
                              Your browser does not support the video tag.
                            </video>
                          );
                        }
                        const driveId = extractDriveFileId(pubUrl || selected.video_url);
                        if (driveId) {
                          return (
                            <iframe 
                              src={`https://drive.google.com/file/d/${driveId}/preview`}
                              style={{ width: "100%", height: 350, border: "none", borderRadius: 8 }}
                              allow="autoplay"
                            />
                          );
                        }
                        return (
                          <video 
                            controls 
                            preload="metadata"
                            style={{ maxWidth: "100%", height: "auto", maxHeight: 360, borderRadius: 8 }}
                            src={pubUrl || selected.video_url}
                          >
                            Your browser does not support the video tag.
                          </video>
                        );
                      })()
                    ) : (
                      <div style={{ padding: "40px 20px", color: "#6B6B80", textAlign: "center" }}>
                        <span>🎥 No preview stream available</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 1. Primary Caption & Hashtags Card */}
                <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E5E4F0", overflow: "hidden", marginBottom: 16 }}>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #E5E4F0", background: "#F8F7FF", fontSize: 12, fontWeight: 700, color: "#6B6B80", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    📝 Generated Caption & Hashtags
                  </div>
                  <div style={{ padding: 16 }}>
                    {editMode ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                        <div>
                          <label style={{ fontSize: 11, fontWeight: 700, color: "#6B6B80", textTransform: "uppercase" }}>Primary Caption</label>
                          <textarea
                            value={editValues.caption || ""}
                            onChange={e => setEditValues(prev => ({ ...prev, caption: e.target.value }))}
                            style={{
                              width: "100%", minHeight: 120,
                              border: "1px solid #7C3AED44", borderRadius: 8,
                              padding: 12, fontSize: 13, lineHeight: 1.6,
                              resize: "vertical", outline: "none", fontFamily: "inherit",
                              background: "#FAFAFF", color: "#1A1A2E", boxSizing: "border-box", marginTop: 4
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => handleOpenAiSuggestions()}
                            style={{
                              marginTop: 8,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "6px 12px",
                              borderRadius: 6,
                              border: "1px solid #7C3AED",
                              background: "#F5F3FF",
                              color: "#7C3AED",
                              fontSize: "11px",
                              fontWeight: "700",
                              cursor: "pointer",
                              transition: "all 0.15s",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = "#7C3AED"; e.currentTarget.style.color = "#fff"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "#F5F3FF"; e.currentTarget.style.color = "#7C3AED"; }}
                          >
                            ✨ AI Suggestions
                          </button>
                        </div>
                        <div>
                          <label style={{ fontSize: 11, fontWeight: 700, color: "#6B6B80", textTransform: "uppercase" }}>Hashtags</label>
                          <textarea
                            value={editValues.hashtags || ""}
                            onChange={e => setEditValues(prev => ({ ...prev, hashtags: e.target.value }))}
                            style={{
                              width: "100%", minHeight: 80,
                              border: "1px solid #7C3AED44", borderRadius: 8,
                              padding: 12, fontSize: 13, lineHeight: 1.6,
                              resize: "vertical", outline: "none", fontFamily: "inherit",
                              background: "#FAFAFF", color: "#1A1A2E", boxSizing: "border-box", marginTop: 4
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#6B6B80", textTransform: "uppercase", marginBottom: 6 }}>Caption</div>
                          <div style={{ fontSize: 13, lineHeight: 1.7, color: "#1A1A2E", whiteSpace: "pre-wrap" }}>
                            {selected.caption || <span style={{ color: "#9CA3AF" }}>No caption generated</span>}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleOpenAiSuggestions()}
                            style={{
                              marginTop: 8,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "6px 12px",
                              borderRadius: 6,
                              border: "1px solid #7C3AED",
                              background: "#F5F3FF",
                              color: "#7C3AED",
                              fontSize: "11px",
                              fontWeight: "700",
                              cursor: "pointer",
                              transition: "all 0.15s",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = "#7C3AED"; e.currentTarget.style.color = "#fff"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "#F5F3FF"; e.currentTarget.style.color = "#7C3AED"; }}
                          >
                            ✨ AI Suggestions
                          </button>
                        </div>
                        <div style={{ borderTop: "1px solid #F0EFF8", paddingTop: 12 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#6B6B80", textTransform: "uppercase", marginBottom: 6 }}>Hashtags</div>
                          <div style={{ fontSize: 13, lineHeight: 1.7, color: "#7C3AED", fontWeight: 600, whiteSpace: "pre-wrap" }}>
                            {selected.hashtags || <span style={{ color: "#9CA3AF" }}>No hashtags generated</span>}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. Platform Variations & Description Card */}
                <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E5E4F0", overflow: "hidden", marginBottom: 16 }}>
                  <div style={{ display: "flex", borderBottom: "1px solid #E5E4F0", background: "#F8F7FF", overflowX: "auto" }}>
                    {[
                      { key: "instagram_caption", label: "Instagram", icon: "📸" },
                      { key: "facebook_caption", label: "Facebook", icon: "👍" },
                      { key: "youtube_title", label: "YouTube Title", icon: "📺 Title" },
                      { key: "youtube_description", label: "YouTube Desc", icon: "📺 Desc" },
                      { key: "x_caption", label: "X (Twitter)", icon: "𝕏" },
                      { key: "linkedin_caption", label: "LinkedIn", icon: "in" },
                      { key: "description", label: "Base Description", icon: "📄" }
                    ].filter(t => {
                      if (t.key === "description") return true;

                      let plat = t.key;
                      if (t.key.includes("instagram")) plat = "instagram";
                      if (t.key.includes("facebook")) plat = "facebook";
                      if (t.key.includes("youtube")) plat = "youtube";
                      if (t.key === "x_caption") plat = "twitter";
                      if (t.key.includes("linkedin")) plat = "linkedin";

                      return socialAccounts.some(s => 
                        isSameBrand(s.brand_name, selected?.brand_name) && 
                        (s.platform === plat || (plat === "twitter" && s.platform === "x")) && 
                        s.is_active
                      );
                    }).map(t => (
                      <button key={t.key} onClick={() => setTab(t.key)} style={{
                        flex: 1, padding: "12px 8px", border: "none", minWidth: 125,
                        borderBottom: tab === t.key ? `2px solid #7C3AED` : "2px solid transparent",
                        background: "transparent", cursor: "pointer",
                        fontSize: 11, fontWeight: tab === t.key ? 700 : 500,
                        color: tab === t.key ? "#7C3AED" : "#6B6B80",
                        transition: "all 0.15s"
                      }}>
                        {t.icon} {t.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ padding: 16 }}>
                    {editMode ? (
                      <textarea
                        value={editValues[tab] || ""}
                        onChange={e => setEditValues(prev => ({ ...prev, [tab]: e.target.value }))}
                        style={{
                          width: "100%", minHeight: (tab === "description" || tab === "youtube_description" || tab.includes("caption")) ? 180 : 80,
                          border: "1px solid #7C3AED44", borderRadius: 8,
                          padding: 12, fontSize: 13, lineHeight: 1.6,
                          resize: "vertical", outline: "none", fontFamily: "inherit",
                          background: "#FAFAFF", color: "#1A1A2E", boxSizing: "border-box"
                        }}
                      />
                    ) : (
                      <div style={{ fontSize: 13, lineHeight: 1.7, color: "#1A1A2E", whiteSpace: "pre-wrap", minHeight: 80 }}>
                        {selected[tab] || <span style={{ color: "#9CA3AF" }}>Not generated</span>}
                      </div>
                    )}
                    {tab === "x_caption" && (
                      <div style={{ marginTop: 8, fontSize: 11, color: (editMode ? editValues.x_caption : selected.x_caption)?.length > 240 ? "#EF4444" : "#10B981", fontWeight: 600 }}>
                        {(editMode ? editValues.x_caption : selected.x_caption)?.length || 0} / 240 chars
                      </div>
                    )}
                    {tab === "youtube_title" && (
                      <div style={{ marginTop: 8, fontSize: 11, color: (editMode ? editValues.youtube_title : selected.youtube_title)?.length > 100 ? "#EF4444" : "#10B981", fontWeight: 600 }}>
                        {(editMode ? editValues.youtube_title : selected.youtube_title)?.length || 0} / 100 chars
                      </div>
                    )}
                    <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        onClick={() => handleOpenAiSuggestions("caption", null, tab)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "6px 12px",
                          borderRadius: 6,
                          border: "1px solid #7C3AED",
                          background: "#F5F3FF",
                          color: "#7C3AED",
                          fontSize: "11px",
                          fontWeight: "700",
                          cursor: "pointer",
                          transition: "all 0.15s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "#7C3AED"; e.currentTarget.style.color = "#fff"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "#F5F3FF"; e.currentTarget.style.color = "#7C3AED"; }}
                      >
                        ✨ AI Suggestions for {
                          tab === "instagram_caption" ? "Instagram" :
                          tab === "facebook_caption" ? "Facebook" :
                          tab === "youtube_title" ? "YouTube Title" :
                          tab === "youtube_description" ? "YouTube Desc" :
                          tab === "x_caption" ? "X (Twitter)" :
                          tab === "linkedin_caption" ? "LinkedIn" : "Base Description"
                        }
                      </button>
                    </div>
                  </div>
                </div>

                {/* Key Highlights & Moments */}
                {((editMode ? editValues.key_moments : selected.key_moments) && (editMode ? editValues.key_moments : selected.key_moments).length > 0) && (
                  <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E5E4F0", overflow: "hidden", marginBottom: 16 }}>
                    <div style={{ padding: "12px 16px", borderBottom: "1px solid #E5E4F0", background: "#F8F7FF", fontSize: 12, fontWeight: 700, color: "#6B6B80", textTransform: "uppercase", letterSpacing: 0.5 }}>
                      🔑 Key Highlights & Moments
                    </div>
                    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                      {(editMode ? editValues.key_moments : selected.key_moments).map((m, idx) => (
                        <div key={idx} style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "#F8F7FF", padding: 12, borderRadius: 8, border: "1px solid #E5E4F0" }}>
                          <div style={{ background: "#7C3AED", color: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                            ⏱️ {m.time}
                          </div>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#1A1A2E", marginBottom: 2 }}>{m.title}</div>
                            <div style={{ fontSize: 12, color: "#6B6B80", lineHeight: 1.4 }}>{m.desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Thumbnail Options */}
                {((editMode ? editValues.thumbnail_options : selected.thumbnail_options) && (editMode ? editValues.thumbnail_options : selected.thumbnail_options).length > 0) && (
                  <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E5E4F0", overflow: "hidden", marginBottom: 16 }}>
                    <div style={{ padding: "12px 16px", borderBottom: "1px solid #E5E4F0", background: "#F8F7FF", fontSize: 12, fontWeight: 700, color: "#6B6B80", textTransform: "uppercase", letterSpacing: 0.5 }}>
                      🖼️ Generated Thumbnail Options
                    </div>
                    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                      {(editMode ? editValues.thumbnail_options : selected.thumbnail_options).map((t, idx) => {
                        const isChosen = editMode 
                          ? editValues.thumbnail_title === t.title 
                          : selected.thumbnail_title === t.title;
                        return (
                          <div key={idx} 
                              onClick={async () => {
                                if (editMode) {
                                  setEditValues(prev => ({ ...prev, thumbnail_title: t.title }));
                                } else {
                                  try {
                                    // Instantly update on DB
                                    const updated = await api.updateContent(selected.id, { thumbnail_title: t.title });
                                    // Update local items state
                                    setItems(prev => prev.map(i => i.id === selected.id ? { ...i, thumbnail_title: t.title } : i));
                                    // Update selected state
                                    setSelected(prev => ({ ...prev, thumbnail_title: t.title }));
                                    // Update editValues
                                    setEditValues(prev => ({ ...prev, thumbnail_title: t.title }));
                                    showToast(`Thumbnail changed to "${t.title}"`);
                                  } catch (err) {
                                    showToast("Failed to update thumbnail option", "error");
                                  }
                                }
                              }}
                              style={{
                                background: isChosen ? "#F5F3FF" : "#fff",
                                border: `1px solid ${isChosen ? "#7C3AED" : "#E5E4F0"}`,
                                borderRadius: 8, padding: 12, cursor: "pointer",
                                transition: "all 0.15s"
                              }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: isChosen ? "#7C3AED" : "#1A1A2E" }}>Option {idx + 1}: "{t.title}"</span>
                              {isChosen && <span style={{ color: "#7C3AED", fontSize: 12, fontWeight: 700 }}>✓ Selected</span>}
                            </div>
                            <p style={{ margin: 0, fontSize: 11, color: "#6B6B80", lineHeight: 1.4 }}>{t.layout}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

              </div>

              {/* RIGHT — Metadata panel */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

                {/* Thumbnail preview */}
                <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E5E4F0", overflow: "hidden" }}>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #E5E4F0", background: "#F8F7FF", fontSize: 12, fontWeight: 700, color: "#6B6B80", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    🖼️ Thumbnail
                  </div>
                  <div style={{ padding: 16 }}>
                    {selected.thumbnail_url ? (
                      <div style={{ position: "relative", width: "100%", borderRadius: 8, overflow: "hidden", boxShadow: "0 4px 12px rgba(0,0,0,0.15)", group: "thumbnail-preview" }}>
                        <img src={selected.thumbnail_url} alt="thumbnail" style={{ width: "100%", display: "block" }} />
                        {(editMode ? editValues.thumbnail_title : selected.thumbnail_title) && (
                          <div style={{
                            position: "absolute",
                            bottom: 0,
                            left: 0,
                            right: 0,
                            background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 70%, rgba(0,0,0,0) 100%)",
                            padding: "24px 12px 16px 12px",
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center"
                          }}>
                            <div style={{
                              background: brandConf.color || "#7C3AED",
                              color: "#fff",
                              padding: "6px 12px",
                              borderRadius: 6,
                              fontSize: "12px",
                              fontWeight: "800",
                              textAlign: "center",
                              boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                              border: "1px solid rgba(255,255,255,0.2)",
                              textTransform: "uppercase",
                              letterSpacing: "0.5px",
                              wordBreak: "break-word"
                            }}>
                              {editMode ? editValues.thumbnail_title : selected.thumbnail_title}
                            </div>
                          </div>
                        )}
                        <div 
                          onClick={handleGenerateThumbnails}
                          style={{
                            position: "absolute",
                            top: 8,
                            right: 8,
                            background: "rgba(255,255,255,0.9)",
                            backdropFilter: "blur(4px)",
                            color: "#1A1A2E",
                            padding: "6px 12px",
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: "pointer",
                            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            transition: "all 0.2s"
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.transform = "scale(1.05)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.9)"; e.currentTarget.style.transform = "scale(1)"; }}
                        >
                          {isGeneratingThumbnails ? (
                            <div style={{ width: 12, height: 12, border: "2px solid #7C3AED", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                          ) : "✨"}
                          {isGeneratingThumbnails ? "Generating..." : "Pick Custom Frame"}
                        </div>
                      </div>
                    ) : (
                      <div style={{
                        background: `linear-gradient(135deg, ${brandConf.color}22, ${brandConf.color}44)`,
                        border: `1px dashed ${brandConf.color}66`,
                        borderRadius: 8, padding: "32px 16px", textAlign: "center",
                        cursor: "pointer",
                        transition: "all 0.2s"
                      }} 
                      onClick={handleGenerateThumbnails}
                      onMouseEnter={(e) => { e.currentTarget.style.background = `linear-gradient(135deg, ${brandConf.color}33, ${brandConf.color}55)`; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = `linear-gradient(135deg, ${brandConf.color}22, ${brandConf.color}44)`; }}
                      >
                        <div style={{ fontSize: 24, marginBottom: 8 }}>🖼️</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: brandConf.color, marginBottom: 4 }}>
                          {isGeneratingThumbnails ? "Extracting Frames..." : "Pick Custom Frame"}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Video Drive Link */}
                <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E5E4F0", overflow: "hidden" }}>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #E5E4F0", background: "#F8F7FF", fontSize: 12, fontWeight: 700, color: "#6B6B80", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    🎥 Video Drive Link
                  </div>
                  <div style={{ padding: 16 }}>
                    {editMode ? (
                      <input
                        type="text"
                        placeholder="Paste Google Drive video link..."
                        value={editValues.video_url || ""}
                        onChange={e => setEditValues(prev => ({ ...prev, video_url: e.target.value, public_video_url: e.target.value }))}
                        style={{ width: "100%", padding: "8px 10px", border: "1px solid #7C3AED44", borderRadius: 8, fontSize: 12, outline: "none", boxSizing: "border-box" }}
                      />
                    ) : (
                      <div>
                        {selected.video_url ? (
                          <a href={selected.video_url} target="_blank" rel="noopener noreferrer" style={{
                            display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 16px",
                            background: "#7C3AED", color: "#fff", textDecoration: "none", borderRadius: 8,
                            fontSize: 12, fontWeight: 700, boxShadow: "0 2px 8px rgba(124,90,237,0.2)"
                          }}>
                            🔗 Open Video Link
                          </a>
                        ) : (
                          <span style={{ fontSize: 12, color: "#9CA3AF", fontStyle: "italic" }}>No video link added</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Platforms & Accounts */}
                <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E5E4F0", overflow: "hidden" }}>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #E5E4F0", background: "#F8F7FF", fontSize: 12, fontWeight: 700, color: "#6B6B80", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Platforms & Accounts
                  </div>
                  <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                    {Array.from(new Set([
                      ...((socialAccounts.filter(s => isSameBrand(s.brand_name, selected.brand_name)).map(s => s.platform) || []).map(plat => {
                        if (plat === 'instagram') return 'instagram_post';
                        if (plat === 'facebook') return 'facebook_post';
                        return plat;
                      })),
                      ...((socialAccounts.filter(s => isSameBrand(s.brand_name, selected.brand_name)).map(s => s.platform) || []).map(plat => plat + '_story').filter(plat => ['instagram_story', 'facebook_story'].includes(plat))),
                      ...((selected.platforms || []).map(plat => {
                        if (plat === 'instagram') return 'instagram_post';
                        if (plat === 'facebook') return 'facebook_post';
                        return plat;
                      })),
                      ...((selected.selected_channels || []).map(plat => {
                        if (plat === 'instagram') return 'instagram_post';
                        if (plat === 'facebook') return 'facebook_post';
                        return plat;
                      }))
                    ])).map(key => {
                      const p = getPlatformConfig(key);
                      const checkActive = (arr) => {
                        if (!arr) return false;
                        if (arr.includes(key)) return true;
                        if (key === 'instagram_post' && (arr.includes('instagram') || arr.includes('instagram_post'))) return true;
                        if (key === 'facebook_post' && (arr.includes('facebook') || arr.includes('facebook_post'))) return true;
                        return false;
                      };
                      const active = editMode
                        ? checkActive(editValues.platforms)
                        : checkActive(selected.platforms);
                      
                      let accountPlatform = key.endsWith('_story') ? key.replace('_story', '') : key;
                      if (accountPlatform === 'instagram_post') accountPlatform = 'instagram';
                      if (accountPlatform === 'facebook_post') accountPlatform = 'facebook';
                      const brandAccounts = socialAccounts.filter(s => isSameBrand(s.brand_name, selected.brand_name) && s.platform === accountPlatform);

                      return (
                        <div key={key} style={{
                          display: "flex", flexDirection: "column",
                          borderRadius: 8,
                          background: active ? `${p.color}08` : "#F8F7FF",
                          border: `1px solid ${active ? p.color + "44" : "#E5E4F0"}`,
                          overflow: "hidden",
                          transition: "all 0.15s", opacity: active ? 1 : 0.65
                        }}>
                          {/* Platform Header */}
                          <div onClick={() => editMode && togglePlatform(key)} style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "8px 12px", cursor: editMode ? "pointer" : "default",
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 14 }}>{p.icon}</span>
                              <span style={{ fontSize: 12, fontWeight: 600, color: active ? p.color : "#6B6B80" }}>{p.label}</span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              {(() => {
                                const isPublished = selected.status === "PUBLISHED" || selected.status === "published";
                                if (!isPublished || !active) return null;
                                const entry = getPlatformPostEntry(key, selected.platform_post_ids);
                                const url = buildPlatformUrl(key, entry);
                                if (!url && !entry) return null;
                                return url ? (
                                  <a href={url} target="_blank" rel="noopener noreferrer"
                                    onClick={e => e.stopPropagation()}
                                    style={{
                                      fontSize: 10, padding: "2px 8px", borderRadius: 20,
                                      background: p.color, color: "#fff",
                                      fontWeight: 700, textDecoration: "none", display: "inline-block"
                                    }}>
                                    View Post ↗
                                  </a>
                                ) : (
                                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: "#10B98122", color: "#10B981", fontWeight: 700 }}>
                                    ✓ Published
                                  </span>
                                );
                              })()}
                              <div style={{ width: 16, height: 16, borderRadius: 4, background: active ? p.color : "#E5E4F0", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                {active && <span style={{ color: "#fff", fontSize: 10, fontWeight: 700 }}>✓</span>}
                              </div>
                            </div>
                          </div>

                          {/* Account Selection */}
                          {active && brandAccounts.length > 0 && (
                            <div style={{ padding: "8px 12px", background: "#fff", borderTop: "1px dashed #E5E4F0", display: "flex", flexDirection: "column", gap: 6 }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "#6B6B80", textTransform: "uppercase" }}>Select Accounts</div>
                              {brandAccounts.map(acc => {
                                const checkIsAccSelected = (accs) => {
                                  if (!accs) return false;
                                  if ((accs[key] || []).includes(acc.account_id)) return true;
                                  if (key.includes('instagram') && (accs['instagram'] || []).includes(acc.account_id)) return true;
                                  if (key.includes('facebook') && (accs['facebook'] || []).includes(acc.account_id)) return true;
                                  return false;
                                };
                                const isAccSelected = editMode 
                                  ? checkIsAccSelected(editValues.selected_accounts)
                                  : checkIsAccSelected(selected.selected_accounts);
                                
                                return (
                                  <div key={acc.account_id} 
                                      onClick={(e) => { e.stopPropagation(); if (editMode) toggleAccount(key, acc.account_id); }}
                                      style={{ display: "flex", alignItems: "center", gap: 8, cursor: editMode ? "pointer" : "default", opacity: isAccSelected ? 1 : 0.6 }}>
                                    <div style={{ width: 12, height: 12, borderRadius: 3, border: "1px solid #7C3AED", background: isAccSelected ? "#7C3AED" : "#fff" }} />
                                    <span style={{ fontSize: 11, color: "#1A1A2E" }}>{acc.account_name}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Schedule */}
                <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E5E4F0", overflow: "hidden" }}>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #E5E4F0", background: "#F8F7FF", fontSize: 12, fontWeight: 700, color: "#6B6B80", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    📅 Scheduled Time
                  </div>
                  <div style={{ padding: 16 }}>
                    {editMode ? (
                      <input
                        type="datetime-local"
                        value={formatLocalDatetimeForInput(editValues.scheduled_at)}
                        onChange={e => {
                          if (!e.target.value) {
                            setEditValues(prev => ({ ...prev, scheduled_at: "" }));
                            return;
                          }
                          const [datePart, timePart] = e.target.value.split('T');
                          const [year, month, day] = datePart.split('-').map(Number);
                          const [hours, minutes] = timePart.split(':').map(Number);
                          const d = new Date(year, month - 1, day, hours, minutes);
                          if (!isNaN(d.getTime())) {
                            setEditValues(prev => ({ ...prev, scheduled_at: d.toISOString() }));
                          }
                        }}
                        style={{ width: "100%", padding: "8px 10px", border: "1px solid #7C3AED44", borderRadius: 8, fontSize: 12, outline: "none", boxSizing: "border-box" }}
                      />
                    ) : (
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#1A1A2E" }}>
                        {formatTime(selected.scheduled_at)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Approve / Reject at bottom for mobile convenience */}
                {canApprove && ["PENDING", "pending_approval"].includes(selected.status) && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <button onClick={() => setConfirmAction({ type: "reject", id: selected.id })} style={{
                        padding: "12px", borderRadius: 10, border: "1px solid #EF444444",
                        background: "#FEF2F2", color: "#EF4444", fontWeight: 700, fontSize: 13, cursor: "pointer"
                      }}>✕ Reject</button>
                      <button 
                        disabled={!!validationError}
                        onClick={() => handleApprove(selected.id)} 
                        style={{
                          padding: "12px", borderRadius: 10, border: "none",
                          background: validationError ? "#9CA3AF" : "#10B981", 
                          color: "#fff", fontWeight: 700, fontSize: 13, 
                          cursor: validationError ? "not-allowed" : "pointer",
                          boxShadow: validationError ? "none" : "0 2px 8px #10B98133",
                          opacity: validationError ? 0.7 : 1
                        }}
                      >
                        ✓ Approve
                      </button>
                    </div>
                    {validationError && (
                      <div style={{ color: "#EF4444", fontSize: 11, fontWeight: 600, textAlign: "center" }}>
                        ⚠️ {validationError}
                      </div>
                    )}
                  </div>
                )}
                {canApprove && ["approved", "APPROVED"].includes(selected.status) && (
                  <div style={{ display: "flex", gap: 10 }}>
                    <button 
                      disabled={isPublishing || validationError}
                      onClick={() => handlePublishNow(selected.id)} 
                      title={validationError || ""}
                      style={{
                        flex: 1, padding: "12px", borderRadius: 10, border: "none",
                        background: (isPublishing || validationError) ? "#9CA3AF" : "#7C3AED", 
                        color: "#fff", fontWeight: 700, fontSize: 13, 
                        cursor: (isPublishing || validationError) ? "not-allowed" : "pointer",
                        boxShadow: (isPublishing || validationError) ? "none" : "0 2px 8px #7C3AED33",
                        transition: "all 0.15s"
                      }}
                    >
                      {isPublishing ? "Publishing..." : "🚀 Publish Now"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      </>
      )}

      {/* ── TOAST ── */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 999,
          background: toast.type === "error" ? "#EF4444" : "#10B981",
          color: "#fff", padding: "12px 20px", borderRadius: 10,
          fontSize: 13, fontWeight: 600, boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
          animation: "fadeIn 0.2s ease"
        }}>
          {toast.msg}
        </div>
      )}

      {/* ── CONFIRM DIALOG ── */}
      {confirmAction && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 998,
          display: "flex", alignItems: "center", justifyContent: "center"
        }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: 340, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Reject this content?</div>
            <div style={{ fontSize: 13, color: "#6B6B80", marginBottom: 16 }}>Please provide a reason for the content team.</div>
            
            <textarea 
              placeholder="Reason for rejection..."
              value={rejectionReason}
              onChange={e => setRejectionReason(e.target.value)}
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #E5E4F0", marginBottom: 16, minHeight: 80, boxSizing: "border-box", fontSize: 12, outline: "none", resize: "vertical" }}
            />

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setConfirmAction(null); setRejectionReason(""); }} style={{
                flex: 1, padding: 12, borderRadius: 8, border: "1px solid #E5E4F0",
                background: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 13
              }}>Cancel</button>
              <button onClick={() => handleReject(confirmAction.id, rejectionReason)} disabled={!rejectionReason.trim()} style={{
                flex: 1, padding: 12, borderRadius: 8, border: "none",
                background: rejectionReason.trim() ? "#EF4444" : "#FCA5A5", color: "#fff", cursor: rejectionReason.trim() ? "pointer" : "not-allowed", fontWeight: 700, fontSize: 13
              }}>Yes, Reject</button>
            </div>
          </div>
        </div>
      )}

      {/* ── THUMBNAIL PICKER MODAL ── */}
      {isThumbnailModalOpen && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 998,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16
        }}>
          <div style={{
            background: "#fff", borderRadius: 16, padding: 24, width: "100%", maxWidth: 640,
            maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.2)"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#1A1A2E" }}>
                ✨ Select Thumbnail Frame
              </div>
              <button 
                onClick={() => setIsThumbnailModalOpen(false)}
                style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#6B6B80" }}
              >✕</button>
            </div>
            
            <p style={{ margin: "0 0 20px 0", fontSize: 13, color: "#6B6B80", lineHeight: 1.5 }}>
              We've extracted a few key frames from your video. Select the one that looks best!
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, overflowY: "auto", paddingBottom: 16 }}>
              {thumbnailCandidates.map((url, idx) => {
                const isChosen = selectedThumbnailCandidate === url;
                return (
                  <div 
                    key={idx}
                    onClick={() => setSelectedThumbnailCandidate(url)}
                    style={{
                      position: "relative",
                      borderRadius: 12,
                      overflow: "hidden",
                      border: `2px solid ${isChosen ? "#7C3AED" : "transparent"}`,
                      boxShadow: isChosen ? "0 4px 16px rgba(124,90,237,0.3)" : "0 2px 8px rgba(0,0,0,0.1)",
                      cursor: "pointer",
                      transition: "all 0.2s"
                    }}
                    onMouseEnter={(e) => { if (!isChosen) e.currentTarget.style.transform = "scale(1.02)"; }}
                    onMouseLeave={(e) => { if (!isChosen) e.currentTarget.style.transform = "scale(1)"; }}
                  >
                    <img src={url} alt={`Frame ${idx + 1}`} style={{ width: "100%", display: "block" }} />
                    {isChosen && (
                      <div style={{
                        position: "absolute", top: 8, right: 8,
                        background: "#7C3AED", color: "#fff",
                        width: 24, height: 24, borderRadius: "50%",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 12, fontWeight: "bold",
                        boxShadow: "0 2px 4px rgba(0,0,0,0.2)"
                      }}>✓</div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: "auto", paddingTop: 16, borderTop: "1px solid #E5E4F0" }}>
              <button 
                onClick={() => setIsThumbnailModalOpen(false)}
                style={{ flex: 1, padding: 12, borderRadius: 8, border: "1px solid #E5E4F0", background: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 13 }}
              >
                Cancel
              </button>
              <button 
                onClick={handleSaveThumbnail}
                style={{ flex: 1, padding: 12, borderRadius: 8, border: "none", background: "#7C3AED", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}
              >
                Save Thumbnail
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── AI SUGGESTIONS MODAL ── */}
      {isSuggestModalOpen && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 998,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16
        }}>
          <div style={{
            background: "#fff", borderRadius: 16, padding: 24, width: "100%", maxWidth: 640,
            maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.2)"
          }}>
            <style>{`
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}</style>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#1A1A2E" }}>
                {suggestionType === "story" ? "✨ AI Story Suggestions" : "✨ AI Caption Suggestions"}
              </div>
              <button 
                onClick={() => setIsSuggestModalOpen(false)}
                style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#6B6B80" }}
              >✕</button>
            </div>

            {/* Tone Selector */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#6B6B80", textTransform: "uppercase" }}>Select Tone:</span>
              {[
                { value: "engaging", label: "🎨 Diverse Mix" },
                { value: "professional", label: "💼 Professional" },
                { value: "educational", label: "📖 Educational" },
                { value: "motivational", label: "🔥 Motivational" },
                { value: "sales", label: "🎯 Sales" },
                { value: "viral", label: "🚀 Viral" }
              ].map(t => {
                const isActive = selectedTone === t.value;
                return (
                  <button
                    key={t.value}
                    onClick={() => {
                      setSelectedTone(t.value);
                      handleOpenAiSuggestions(suggestionType, t.value, suggestionPlatform);
                    }}
                    style={{
                      padding: "5px 10px", borderRadius: 20, border: `1px solid ${isActive ? "#7C3AED" : "#E5E4F0"}`,
                      background: isActive ? "#7C3AED" : "#fff", color: isActive ? "#fff" : "#1A1A2E",
                      fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.1s"
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            {/* Suggestions list container */}
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, marginBottom: 16, paddingRight: 4 }}>
              {loadingSuggestions ? (
                <div style={{ padding: "40px 0", textAlign: "center", color: "#6B6B80" }}>
                  <div style={{ fontSize: 24, animation: "spin 1s linear infinite", display: "inline-block", marginBottom: 8 }}>🌀</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {suggestionType === "story" ? "Analyzing brand & generating story slides..." : "Analyzing brand & generating creative copy..."}
                  </div>
                </div>
              ) : suggestionsError ? (
                <div style={{ padding: "30px 20px", textAlign: "center", background: "#FEF2F2", borderRadius: 8, border: "1px solid #EF444444" }}>
                  <div style={{ fontSize: 13, color: "#EF4444", marginBottom: 12 }}>{suggestionsError}</div>
                  <button 
                    onClick={() => fetchAiSuggestions(selected.id, selectedTone, suggestionType, suggestionPlatform)}
                    style={{ padding: "6px 16px", background: "#EF4444", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                  >Retry</button>
                </div>
              ) : (
                (suggestCache[`${selected.id}_${selectedTone}_${suggestionType}_${suggestionPlatform || 'all'}`] || []).map((s, idx) => {
                  const toneLabel = s.tone ? s.tone.charAt(0).toUpperCase() + s.tone.slice(1) : "AI Suggestions";
                  return (
                    <div 
                      key={s.id || idx}
                      style={{
                        background: "#FAFAFF", border: "1px solid #E5E4F0", borderRadius: 10,
                        padding: 16, display: "flex", flexDirection: "column", gap: 10,
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = "#7C3AED"}
                      onMouseLeave={e => e.currentTarget.style.borderColor = "#E5E4F0"}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: "#7C3AED", textTransform: "uppercase", tracking: "0.5px" }}>
                          ✨ Suggestion #{idx + 1} ({toneLabel} Style)
                        </span>
                      </div>
                      
                      {suggestionType === "story" ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 10, background: "#fff", padding: 12, borderRadius: 8, border: "1px solid #E5E4F0" }}>
                          <div style={{ fontSize: 12, color: "#1A1A2E", lineHeight: 1.5 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#7C3AED", display: "block", marginBottom: 2 }}>SLIDE 1</span>
                            {s.story_1}
                          </div>
                          <div style={{ fontSize: 12, color: "#1A1A2E", lineHeight: 1.5, borderTop: "1px solid #F0EFF8", paddingTop: 8 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#7C3AED", display: "block", marginBottom: 2 }}>SLIDE 2</span>
                            {s.story_2}
                          </div>
                          <div style={{ fontSize: 12, color: "#1A1A2E", lineHeight: 1.5, borderTop: "1px solid #F0EFF8", paddingTop: 8 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#7C3AED", display: "block", marginBottom: 2 }}>SLIDE 3</span>
                            {s.story_3}
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, lineHeight: 1.6, color: "#1A1A2E", whiteSpace: "pre-wrap" }}>
                          {s.caption}
                        </div>
                      )}

                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px dashed #E5E4F0", paddingTop: 10 }}>
                        <button
                          onClick={() => {
                            if (suggestionType === "story") {
                              navigator.clipboard.writeText(`Slide 1: ${s.story_1}\n\nSlide 2: ${s.story_2}\n\nSlide 3: ${s.story_3}`);
                            } else {
                              navigator.clipboard.writeText(s.caption);
                            }
                            showToast("Copied to clipboard!");
                          }}
                          style={{
                            padding: "6px 12px", borderRadius: 6, border: "1px solid #E5E4F0",
                            background: "#fff", color: "#1A1A2E", fontSize: 11, fontWeight: 600,
                            cursor: "pointer"
                          }}
                        >
                          📋 Copy
                        </button>
                        <button
                          onClick={() => {
                            if (suggestionType === "story") {
                              if (!editMode) {
                                setEditMode(true);
                                setEditValues({
                                  caption: selected.caption,
                                  instagram_caption: selected.instagram_caption || selected.caption || "",
                                  facebook_caption: selected.facebook_caption || selected.caption || "",
                                  youtube_title: selected.youtube_title || selected.thumbnail_title || "",
                                  youtube_description: selected.youtube_description || selected.description || selected.caption || "",
                                  x_caption: selected.x_caption,
                                  linkedin_caption: selected.linkedin_caption,
                                  thumbnail_title: selected.thumbnail_title,
                                  scheduled_at: selected.scheduled_at,
                                  platforms: [...(selected.platforms || [])],
                                  selected_accounts: selected.selected_accounts ? { ...selected.selected_accounts } : {},
                                  video_url: selected.video_url || "",
                                  public_video_url: selected.public_video_url || "",
                                  description: selected.description || "",
                                  hashtags: selected.hashtags || "",
                                  thumbnail_options: selected.thumbnail_options || [],
                                  key_moments: selected.key_moments || [],
                                  thumbnail_url: selected.thumbnail_url || "",
                                  story_1: s.story_1,
                                  story_2: s.story_2,
                                  story_3: s.story_3,
                                });
                              } else {
                                setEditValues(prev => ({ 
                                  ...prev, 
                                  story_1: s.story_1,
                                  story_2: s.story_2,
                                  story_3: s.story_3,
                                }));
                              }
                              showToast("Applied stories!");
                            } else {
                              if (suggestionPlatform) {
                                if (!editMode) {
                                  setEditMode(true);
                                  setEditValues({
                                    caption: selected.caption,
                                    instagram_caption: selected.instagram_caption || selected.caption || "",
                                    facebook_caption: selected.facebook_caption || selected.caption || "",
                                    youtube_title: selected.youtube_title || selected.thumbnail_title || "",
                                    youtube_description: selected.youtube_description || selected.description || selected.caption || "",
                                    x_caption: selected.x_caption,
                                    linkedin_caption: selected.linkedin_caption,
                                    thumbnail_title: selected.thumbnail_title,
                                    scheduled_at: selected.scheduled_at,
                                    platforms: [...(selected.platforms || [])],
                                    selected_accounts: selected.selected_accounts ? { ...selected.selected_accounts } : {},
                                    video_url: selected.video_url || "",
                                    public_video_url: selected.public_video_url || "",
                                    description: selected.description || "",
                                    hashtags: selected.hashtags || "",
                                    thumbnail_options: selected.thumbnail_options || [],
                                    key_moments: selected.key_moments || [],
                                    thumbnail_url: selected.thumbnail_url || "",
                                    story_1: selected.story_1 || "",
                                    story_2: selected.story_2 || "",
                                    story_3: selected.story_3 || "",
                                    [suggestionPlatform]: s.caption
                                  });
                                } else {
                                  setEditValues(prev => ({ 
                                    ...prev, 
                                    [suggestionPlatform]: s.caption
                                  }));
                                }
                                showToast(`Applied to ${suggestionPlatform.replace("_", " ")}!`);
                              } else {
                                if (!editMode) {
                                  setEditMode(true);
                                  setEditValues({
                                    caption: s.caption,
                                    instagram_caption: s.caption,
                                    facebook_caption: s.caption,
                                    youtube_description: s.caption,
                                    x_caption: selected.x_caption,
                                    linkedin_caption: selected.linkedin_caption,
                                    youtube_title: selected.youtube_title || selected.thumbnail_title || "",
                                    thumbnail_title: selected.thumbnail_title,
                                    scheduled_at: selected.scheduled_at,
                                    platforms: [...(selected.platforms || [])],
                                    selected_accounts: selected.selected_accounts ? { ...selected.selected_accounts } : {},
                                    video_url: selected.video_url || "",
                                    public_video_url: selected.public_video_url || "",
                                    description: selected.description || "",
                                    hashtags: selected.hashtags || "",
                                    thumbnail_options: selected.thumbnail_options || [],
                                    key_moments: selected.key_moments || [],
                                    thumbnail_url: selected.thumbnail_url || "",
                                    story_1: selected.story_1 || "",
                                    story_2: selected.story_2 || "",
                                    story_3: selected.story_3 || "",
                                  });
                                } else {
                                  setEditValues(prev => ({ 
                                    ...prev, 
                                    caption: s.caption,
                                    instagram_caption: s.caption,
                                    facebook_caption: s.caption,
                                    youtube_description: s.caption
                                  }));
                                }
                                showToast("Applied caption!");
                              }
                            }
                            setIsSuggestModalOpen(false);
                          }}
                          style={{
                            padding: "6px 14px", borderRadius: 6, border: "none",
                            background: "#7C3AED", color: "#fff", fontSize: 11, fontWeight: 700,
                            cursor: "pointer", boxShadow: "0 2px 6px rgba(124,90,237,0.2)"
                          }}
                        >
                          {suggestionType === "story" ? "✓ Use Stories" : "✓ Use Caption"}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #E5E4F0", paddingTop: 16 }}>
              <button
                disabled={loadingSuggestions}
                onClick={() => {
                  const cacheKey = `${selected.id}_${selectedTone}_${suggestionType}_${suggestionPlatform || 'all'}`;
                  setSuggestCache(prev => {
                    const newCache = { ...prev };
                    delete newCache[cacheKey];
                    return newCache;
                  });
                  fetchAiSuggestions(selected.id, selectedTone, suggestionType, suggestionPlatform);
                }}
                style={{
                  padding: "8px 16px", borderRadius: 8, border: "1px solid #7C3AED",
                  background: "#fff", color: "#7C3AED", fontSize: 12, fontWeight: 700,
                  cursor: loadingSuggestions ? "not-allowed" : "pointer"
                }}
              >
                🔄 Regenerate
              </button>
              <button
                onClick={() => setIsSuggestModalOpen(false)}
                style={{
                  padding: "8px 20px", borderRadius: 8, border: "1px solid #E5E4F0",
                  background: "#fff", color: "#1A1A2E", fontSize: 12, fontWeight: 600,
                  cursor: "pointer"
                }}
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

function StatusBadge({ status }) {
  const s = (status || "").toUpperCase();
  const cfg = {
    PENDING:          { bg: "#FEF3C7", color: "#92400E", text: "Pending" },
    PENDING_APPROVAL: { bg: "#FEF3C7", color: "#92400E", text: "Pending Approval" },
    PROCESSING:       { bg: "#EFF6FF", color: "#1E40AF", text: "Processing" },
    APPROVED:         { bg: "#D1FAE5", color: "#065F46", text: "Approved" },
    REJECTED:         { bg: "#FEE2E2", color: "#991B1B", text: "Rejected" },
    PUBLISHING:       { bg: "#ECFDF5", color: "#047857", text: "Publishing" },
    PUBLISHED:        { bg: "#DBEAFE", color: "#1E40AF", text: "Published" },
    PARTIAL:          { bg: "#FFEDD5", color: "#C2410C", text: "Partially Published" },
    FAILED:           { bg: "#FEE2E2", color: "#B91C1C", text: "Failed" },
  }[s] || { bg: "#F3F4F6", color: "#374151", text: status };
  return (
    <div style={{ background: cfg.bg, color: cfg.color, borderRadius: 5, padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>
      {cfg.text}
    </div>
  );
}

