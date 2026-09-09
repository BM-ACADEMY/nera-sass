import { useState, useEffect } from "react";
import { api } from "../src/services/api";
import { useAuth } from "../src/hooks/useAuth";

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
    instagram:       { label: "Instagram Post", icon: "📸", color: "#E1306C" },
    instagram_post:  { label: "Instagram Post", icon: "📸", color: "#E1306C" },
    instagram_reel:  { label: "Instagram Reel", icon: "📸", color: "#E1306C" },
    instagram_story: { label: "Instagram Story", icon: "📸", color: "#E1306C" },
    youtube:         { label: "YouTube Short",  icon: "▶️", color: "#FF0000" },
    youtube_short:   { label: "YouTube Short",  icon: "▶️", color: "#FF0000" },
    youtube_video:   { label: "YouTube Video",  icon: "▶️", color: "#FF0000" },
    facebook:        { label: "Facebook Post",  icon: "👍", color: "#1877F2" },
    facebook_post:   { label: "Facebook Post",  icon: "👍", color: "#1877F2" },
    facebook_reel:   { label: "Facebook Reel",  icon: "👍", color: "#1877F2" },
    x_twitter:       { label: "X",              icon: "𝕏", color: "#000000" },
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

function normalizePlatform(p) {
  return (p || "").toLowerCase().replace(/_(post|reel|short|story|video)$/, "");
}

function getPlatformPostEntry(platform, platformPostIds) {
  if (!Array.isArray(platformPostIds) || !platform) return null;
  const norm = normalizePlatform(platform);
  return platformPostIds.find(e => e && normalizePlatform(e.platform) === norm) || null;
}

export default function ApprovalDashboard() {
  const { user } = useAuth();
  const canApprove = !user || !user.role || ['Super Admin', 'Marketing Admin', 'super_admin', 'admin', 'founder', 'Founder'].includes(user.role);

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

  useEffect(() => {
    const timer = setTimeout(() => fetchData(), 400);
    return () => clearTimeout(timer);
  }, [filter, search, startDate, endDate]);

  useEffect(() => {
    fetchAccounts();
  }, []);

  async function fetchData(showLoading = true) {
    if (showLoading) setLoading(true);
    try {
      const res = await api.getContentQueue({ 
        status: filter === "ALL" ? "all" : filter,
        search, startDate, endDate
      });
      setItems(res.items || []);

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
    setSelected(item);
    setTab("caption");
    setEditMode(false);
    setEditValues({
      caption: item.caption,
      x_caption: item.x_caption,
      linkedin_caption: item.linkedin_caption,
      thumbnail_title: item.thumbnail_title,
      scheduled_at: item.scheduled_at,
      platforms: [...(item.platforms || [])],
      selected_accounts: item.selected_accounts && !Array.isArray(item.selected_accounts) ? { ...item.selected_accounts } : {},
      story_1: item.story_1 || "",
      story_2: item.story_2 || "",
      story_3: item.story_3 || "",
    });
  }

  async function handleApprove(id) {
    try {
      await api.approveContent(id);
      if (filter !== "ALL" && filter !== "APPROVED") {
        setItems(prev => prev.filter(i => i.id !== id));
      } else {
        setItems(prev => prev.map(i => i.id === id ? { ...i, status: "APPROVED" } : i));
      }
      setStats(prev => ({ ...prev, PENDING: Math.max(0, prev.PENDING - 1), APPROVED: prev.APPROVED + 1 }));
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
        setItems(prev => prev.map(i => i.id === id ? { ...i, status: "REJECTED" } : i));
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
      setItems(prev => prev.map(i => i.id === id ? { ...i, ...updated.item } : i));
      if (selected?.id === id) setSelected(prev => ({ ...prev, ...updated.item }));
      setEditMode(false);
      showToast("Changes saved");
    } catch(e) {
      showToast("Failed to save changes", "error");
    }
  }

  function togglePlatform(p) {
    setEditValues(prev => ({
      ...prev,
      platforms: prev.platforms.includes(p)
        ? prev.platforms.filter(x => x !== p)
        : [...prev.platforms, p]
    }));
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

  const brandConf = selected ? getBrandConfig(selected.brand_name) : null;

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: "#F8F7FF", height: "100%", color: "#1A1A2E", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* ── TOPBAR ── */}
      <div style={{ background: "#0A0A0F", padding: "0 24px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#E8E8F0", letterSpacing: "-0.3px" }}>
            ABM Groups <span style={{ color: "#7C3AED" }}>· Content OS</span>
          </div>
          <div style={{ background: "#7C3AED22", border: "1px solid #7C3AED44", borderRadius: 20, padding: "2px 10px", fontSize: 11, color: "#A78BFA", fontWeight: 600 }}>
            Approval Dashboard
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {stats.PENDING > 0 && (
            <div style={{ background: "#EF444420", border: "1px solid #EF444444", borderRadius: 20, padding: "3px 12px", fontSize: 12, color: "#EF4444", fontWeight: 700 }}>
              {stats.PENDING} pending
            </div>
          )}
          <div style={{ fontSize: 12, color: "#6B6B80" }}>{user?.role || 'Admin'}</div>
        </div>
      </div>

      {/* ── ANALYTICS BAR ── */}
      <div style={{ padding: "16px 24px", display: "flex", gap: 16, borderBottom: "1px solid #E5E4F0", background: "#fff" }}>
        {[{ label: "Total Content", val: analytics.total }, 
          { label: "Pending", val: analytics.pending, color: "#F59E0B" }, 
          { label: "Published Today", val: analytics.publishedToday, color: "#10B981" }, 
          { label: "Failed Today", val: analytics.failedToday, color: "#EF4444" }
        ].map(a => (
          <div key={a.label} style={{ flex: 1, padding: 16, borderRadius: 12, border: "1px solid #E5E4F0", background: "#FAFAFF" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6B6B80", textTransform: "uppercase", marginBottom: 4 }}>{a.label}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: a.color || "#1A1A2E", letterSpacing: "-0.5px" }}>{a.val}</div>
          </div>
        ))}
      </div>

      {/* ── LAYOUT ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── LEFT PANEL — CONTENT LIST ── */}
        <div style={{ width: 340, flexShrink: 0, background: "#fff", borderRight: "1px solid #E5E4F0", overflowY: "auto", display: "flex", flexDirection: "column" }}>

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
                      const entry = getPlatformPostEntry(p, item.platform_post_ids);
                      const url = item.status === "PUBLISHED" ? buildPlatformUrl(p, entry) : null;
                      const isPublished = item.status === "PUBLISHED";
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
                          onClick={e => e.stopPropagation()}
                          style={style}>
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
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, color: "#6B6B80" }}>
            <div style={{ fontSize: 40 }}>📋</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#1A1A2E" }}>Select a content item to review</div>
            <div style={{ fontSize: 13 }}>{stats.PENDING} items waiting for approval</div>
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>

            {/* Item header */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
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
              <div style={{ display: "flex", gap: 8 }}>
                {canApprove && selected.status === "PENDING" && (
                  <>
                    <button onClick={() => setConfirmAction({ type: "reject", id: selected.id })} style={{
                      padding: "8px 16px", borderRadius: 8, border: "1px solid #EF444444",
                      background: "#FEF2F2", color: "#EF4444", fontWeight: 600, fontSize: 13, cursor: "pointer"
                    }}>✕ Reject</button>
                    <button onClick={() => handleApprove(selected.id)} style={{
                      padding: "8px 20px", borderRadius: 8, border: "none",
                      background: "#10B981", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
                      boxShadow: "0 2px 8px #10B98133"
                    }}>✓ Approve</button>
                  </>
                )}
                {/* Editing allowed for all if PENDING or REJECTED */}
                {(selected.status === "PENDING" || selected.status === "REJECTED") && (
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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20 }}>

              {/* LEFT — Captions */}
              <div>
                {/* Caption tabs */}
                <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E5E4F0", overflow: "hidden", marginBottom: 16 }}>
                  <div style={{ display: "flex", borderBottom: "1px solid #E5E4F0", background: "#F8F7FF", overflowX: "auto" }}>
                    {[
                      { key: "caption", label: "Primary Caption", icon: "📝" },
                      { key: "x_caption", label: "X (Twitter)", icon: "𝕏" },
                      { key: "linkedin_caption", label: "LinkedIn", icon: "in" },
                      { key: "thumbnail_title", label: "Title", icon: "▶️" }
                    ].filter(t => selected[t.key] || editMode).map(t => (
                      <button key={t.key} onClick={() => setTab(t.key)} style={{
                        flex: 1, padding: "10px 8px", border: "none", minWidth: 100,
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
                          width: "100%", minHeight: tab === "caption" ? 240 : 120,
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
                  </div>
                </div>

                {/* Stories */}
                <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E5E4F0", overflow: "hidden" }}>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #E5E4F0", background: "#F8F7FF", fontSize: 12, fontWeight: 700, color: "#6B6B80", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    📱 Instagram Stories
                  </div>
                  <div style={{ padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                    {["story_1","story_2","story_3"].map((s, i) => (
                      <div key={s} style={{ background: "#F8F7FF", borderRadius: 8, padding: 12, border: "1px solid #E5E4F0" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#7C3AED", marginBottom: 6, textTransform: "uppercase" }}>Slide {i+1}</div>
                        {editMode ? (
                          <textarea 
                            value={editValues[s] || ""}
                            onChange={e => setEditValues(prev => ({ ...prev, [s]: e.target.value }))}
                            style={{ width: "100%", fontSize: 12, border: "1px solid #7C3AED44", borderRadius: 4, padding: 6, boxSizing: "border-box", minHeight: 80, outline: "none", resize: "vertical" }}
                          />
                        ) : (
                          <div style={{ fontSize: 12, color: "#1A1A2E", lineHeight: 1.5 }}>{selected[s]}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
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
                      <img src={selected.thumbnail_url} alt="thumbnail" style={{ width: "100%", borderRadius: 8 }} />
                    ) : (
                      <div style={{
                        background: `linear-gradient(135deg, ${brandConf.color}22, ${brandConf.color}44)`,
                        border: `1px dashed ${brandConf.color}66`,
                        borderRadius: 8, padding: "32px 16px", textAlign: "center"
                      }}>
                        <div style={{ fontSize: 24, marginBottom: 8 }}>🖼️</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: brandConf.color, marginBottom: 4 }}>
                          {selected.thumbnail_title || 'Thumbnail Generating...'}
                        </div>
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
                    {Array.from(new Set([...(socialAccounts.map(s => s.platform) || []), ...(selected.platforms || [])])).map(key => {
                      const p = getPlatformConfig(key);
                      const active = editMode
                        ? editValues.platforms?.includes(key)
                        : selected.platforms?.includes(key);
                      
                      const brandAccounts = socialAccounts.filter(s => s.brand_name === selected.brand_name && s.platform === key);

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
                                if (selected.status !== "PUBLISHED" || !active) return null;
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
                        value={editValues.scheduled_at?.slice(0,16)}
                        onChange={e => setEditValues(prev => ({ ...prev, scheduled_at: e.target.value + ":00+05:30" }))}
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
                {canApprove && selected.status === "PENDING" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <button onClick={() => setConfirmAction({ type: "reject", id: selected.id })} style={{
                      padding: "12px", borderRadius: 10, border: "1px solid #EF444444",
                      background: "#FEF2F2", color: "#EF4444", fontWeight: 700, fontSize: 13, cursor: "pointer"
                    }}>✕ Reject</button>
                    <button onClick={() => handleApprove(selected.id)} style={{
                      padding: "12px", borderRadius: 10, border: "none",
                      background: "#10B981", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
                      boxShadow: "0 2px 8px #10B98133"
                    }}>✓ Approve</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

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
    </div>
  );
}

function StatusBadge({ status }) {
  const cfg = {
    PENDING:  { bg: "#FEF3C7", color: "#92400E", text: "Pending" },
    APPROVED: { bg: "#D1FAE5", color: "#065F46", text: "Approved" },
    REJECTED: { bg: "#FEE2E2", color: "#991B1B", text: "Rejected" },
    PUBLISHED:{ bg: "#DBEAFE", color: "#1E40AF", text: "Published" },
    FAILED:   { bg: "#FEE2E2", color: "#B91C1C", text: "Failed" },
  }[status] || { bg: "#F3F4F6", color: "#374151", text: status };
  return (
    <div style={{ background: cfg.bg, color: cfg.color, borderRadius: 5, padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>
      {cfg.text}
    </div>
  );
}
