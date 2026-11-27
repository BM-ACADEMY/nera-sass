import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { Virtuoso } from 'react-virtuoso';
import { useFloating, autoUpdate, offset, flip, shift, FloatingPortal, useDismiss, useInteractions } from '@floating-ui/react';
import { MessageCircle, Search, Send, ChevronLeft, ChevronRight, ChevronDown, Check, Clock, Paperclip, Copy, Edit2, Trash2, X, MoreVertical, Image, Film, Music, FileText, Smile, Mic, Square, CornerUpLeft, CornerUpRight, Pin, Star, CheckSquare, Forward, Download, ZoomIn, ZoomOut, Phone, Video, User, Sparkles, ExternalLink, Plus, Tag, Camera } from 'lucide-react';
import { io as socketIO } from 'socket.io-client';
import { C } from '../constants/theme.js';
import { useLeads, useLead, useAllianceInbox, useAllianceLead } from '../hooks/useLeads.js';
import { api, allianceInboxApi } from '../services/api.js';
import { labelsAsInboxTags } from './leads/labels/labelsApi.js';
import { toast } from 'react-hot-toast';
import { VoiceRecorder, voiceFileName } from '../components/chat/VoiceRecorder.jsx';
import { CameraDialog } from '../components/chat/CameraDialog.jsx';
import { SendPreview, toPending, MAX_FILE, MAX_FILES } from '../components/chat/SendPreview.jsx';

// The emoji picker is large and only opens on demand: load it then, in its own chunk.
const EmojiPickerLazy = lazy(() => import('emoji-picker-react'));
const EmojiPicker = (props) => (
  <Suspense fallback={<div style={{ width: props.width || 300, height: props.height || 400, background: '#fff', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }} />}>
    <EmojiPickerLazy {...props} />
  </Suspense>
);

// In local dev (localhost), connect via same origin so Vite's WebSocket proxy works.
// In production, connect directly to the API server.
const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const SOCKET_URL = isLocalDev ? window.location.origin : import.meta.env.VITE_API_URL;

const WA_GREEN = '#25D366';
// Files the server takes as WhatsApp documents (server/services/tenantUploads.js).
const DOCUMENT_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.jpg,.jpeg,.png,.webp,.mp4,.3gp,.mp3,.m4a,.aac,.amr,.ogg,.opus';
// Same palette as the admin panel's WhatsApp Chat.
const CHAT_BG = '#efeae2';
const BAR_BG = '#f0f2f5';
const LINE = '#e5e7eb';
const DAY_MS = 24 * 60 * 60 * 1000;

const MessageActionsMenu = ({ isOpen, onToggle, onClose, align = 'end', children }) => {
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: (open) => { if (!open) onClose(); },
    placement: align === 'start' ? 'bottom-start' : 'bottom-end',
    middleware: [offset(4), flip({ fallbackPlacements: ['top-start', 'top-end'] }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
    strategy: 'fixed',
  });
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

  return (
    <div className="wa-hover" data-open={isOpen ? 'true' : 'false'} style={{ position: 'absolute', top: 4, right: 4, zIndex: 10 }}>
      <button
        ref={refs.setReference}
        type="button"
        aria-label="Message actions"
        {...getReferenceProps({ onClick: (e) => { e.stopPropagation(); onToggle(); } })}
        style={{ background: 'rgba(255, 255, 255, 0.9)', border: 'none', cursor: 'pointer', padding: 2, borderRadius: 999, display: 'flex', boxShadow: '0 1px 2px rgba(11,20,26,.15)' }}
      >
        <ChevronDown size={14} color="#54656f" />
      </button>
      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{ ...floatingStyles, background: C.card, border: '1px solid ' + C.border, borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 1000, minWidth: 160, padding: '5px 0', display: 'flex', flexDirection: 'column' }}
            {...getFloatingProps()}
          >
            {children}
          </div>
        </FloatingPortal>
      )}
    </div>
  );
};

// Hover-only message controls are shown with CSS. Keeping the hovered message
// in React state re-rendered the whole inbox on every mouse move.
const INBOX_CSS = `
@keyframes typingBounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.5; } 30% { transform: translateY(-4px); opacity: 1; } }
.wa-row .wa-hover { visibility: hidden; }
.wa-row:hover .wa-hover, .wa-row .wa-hover[data-open="true"] { visibility: visible; }
.wa-list-item:hover { background: #f8fafc; }
.wa-list-item[data-active="true"], .wa-list-item[data-active="true"]:hover { background: #f0fdf4; }
`;

// Hours left in Meta's 24-hour customer-service window, or 0 when closed.
const replyWindowHoursLeft = (lastInboundAt) => {
  const at = lastInboundAt ? new Date(lastInboundAt).getTime() : NaN;
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.ceil((at + DAY_MS - Date.now()) / 3600000));
};

const initialsOf = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

const InitialsAvatar = ({ name, size = 44 }) => (
  <span aria-hidden="true" style={{ width: size, height: size, flexShrink: 0, borderRadius: '50%', background: '#dcfce7', color: '#15803d', fontWeight: 700, fontSize: size * 0.36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    {initialsOf(name)}
  </span>
);

// Today: time; this week: weekday; older: date.
const listTime = (value) => {
  if (!value) return '';
  const d = new Date(value);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const days = (now - d) / 86400000;
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

const getNameColor = (name) => {
  if (!name) return '#e91e63';
  const colors = [
    '#e91e63', '#9c27b0', '#673ab7', '#3f51b5',
    '#2196f3', '#03a9f4', '#00bcd4', '#009688',
    '#4caf50', '#8bc34a', '#ff9800', '#ff5722'
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
};

// A message can arrive through both the REST response and Socket.IO. Prefer the
// database id, then WhatsApp's id, so those two delivery paths cannot render twice.
const getMessageIdentity = (message) => {
  if (message?.id !== null && message?.id !== undefined) return `id:${String(message.id)}`;
  if (message?.wa_msg_id) return `wa:${message.wa_msg_id}`;
  return null;
};

const getMessageTimestamp = (message) => {
  const value = message?.timestamp || message?.sent_at || message?.time;
  const timestamp = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(timestamp) ? null : timestamp;
};

// File name from a media link, without the signed-link query string.
const mediaFileName = (url = '') => {
  const last = url.split(/[?#]/)[0].split('/').pop() || '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
};

const getInboundDuplicateKey = (message) => {
  const isInbound = message?.direction === 'inbound' || message?.from === 'lead';
  if (!isInbound) return null;

  return JSON.stringify([
    message?.type || message?.msg_type || 'text',
    (message?.content || message?.message || message?.text || '').trim(),
    (message?.media_url || '').split('?')[0], // signed links change their query over time
  ]);
};

const mergeMessages = (current, incoming) => {
  const merged = [];
  const positions = new Map();
  const recentInboundPositions = new Map();

  [...(current || []), ...(incoming || [])].forEach((message) => {
    const identity = getMessageIdentity(message);
    const whatsappIdentity = message?.wa_msg_id ? `wa:${message.wa_msg_id}` : null;
    let existingIndex = identity !== null
      ? positions.get(identity) ?? (whatsappIdentity ? positions.get(whatsappIdentity) : undefined)
      : undefined;

    // Some old webhook retries were stored as separate rows with distinct DB ids
    // and no reliable wa_msg_id. Treat an identical inbound payload received within
    // ten seconds as the same webhook event.
    const inboundDuplicateKey = getInboundDuplicateKey(message);
    const timestamp = getMessageTimestamp(message);
    if (existingIndex === undefined && inboundDuplicateKey && timestamp !== null) {
      const candidateIndex = recentInboundPositions.get(inboundDuplicateKey);
      const candidateTimestamp = candidateIndex !== undefined
        ? getMessageTimestamp(merged[candidateIndex])
        : null;
      if (candidateTimestamp !== null && Math.abs(timestamp - candidateTimestamp) <= 10000) {
        existingIndex = candidateIndex;
      }
    }

    if (existingIndex !== undefined) {
      merged[existingIndex] = { ...merged[existingIndex], ...message };
      if (identity) positions.set(identity, existingIndex);
      if (whatsappIdentity) positions.set(whatsappIdentity, existingIndex);
      if (inboundDuplicateKey) recentInboundPositions.set(inboundDuplicateKey, existingIndex);
      return;
    }

    const nextIndex = merged.length;
    merged.push(message);
    if (identity) positions.set(identity, nextIndex);
    if (whatsappIdentity) positions.set(whatsappIdentity, nextIndex);
    if (inboundDuplicateKey) recentInboundPositions.set(inboundDuplicateKey, nextIndex);
  });

  return merged;
};

export const InboxWorkspace = ({ mode = 'leados' }) => {
  const alliance = mode === 'alliance';
  const location = useLocation();
  // The chat list reloads 300 ms after typing stops, not on every key.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);
  const useInboxList = alliance ? useAllianceInbox : useLeads;
  const useInboxLead = alliance ? useAllianceLead : useLead;
  const inboxApi = alliance ? allianceInboxApi : api;
  // Tag menu: Alliance contacts keep their tags; LeadOS leads use this
  // workspace's labels (views/leads/labels).
  const tagApi = alliance ? allianceInboxApi : labelsAsInboxTags;
  const storageKeys = alliance ? {
    reactions: 'alliance_user_reactions', deleted: 'alliance_deleted_for_me',
  } : { reactions: 'leados_user_reactions', deleted: 'leados_deleted_for_me' };
  const socketEvents = alliance ? {
    incoming: 'alliance_incoming_message', outgoing: 'alliance_outgoing_message',
    typing: 'alliance_ai_typing', status: 'alliance_message_status',
    edited: 'alliance_message_edited', deleted: 'alliance_message_deleted',
  } : {
    incoming: 'incoming_message', outgoing: 'outgoing_message', typing: 'ai_typing',
    status: 'message_status', edited: 'message_edited', deleted: 'message_deleted',
  };
  const { leads, loading: loadingLeads, hasMore: hasMoreLeads, loadingMore: loadingMoreLeads, loadMoreLeads, refetch: refetchLeadsList } = useInboxList({ search });
  const [activeLeadId, setActiveLeadId] = useState(location.state?.leadId || null);
  const { lead: activeLead, workspaceAiEnabled = null, conversations, loadingMore, hasMore, loadMoreMessages, refetch: refetchLead, loading: loadingLead } = useInboxLead(activeLeadId);
  const [aiPause, setAiPause] = useState({ paused: false, reason: null });
  const [resumingAi, setResumingAi] = useState(false);
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [suggestingReply, setSuggestingReply] = useState(false);
  const [allianceDraftSource, setAllianceDraftSource] = useState('human');
  const [showChatOnMobile, setShowChatOnMobile] = useState(!!location.state?.leadId);

  useEffect(() => {
    setAllianceDraftSource('human');
  }, [activeLeadId]);
  const [localMessages, setLocalMessages] = useState([]);
  const [connected, setConnected] = useState(false);
  const [typingLeadIds, setTypingLeadIds] = useState(() => new Map()); // Map<lead_id, 'waiting'|'composing'>
  const typingTimeoutsRef = useRef({});
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editContent, setEditContent] = useState('');

  // Sync activeLeadId and showChatOnMobile if location state changes
  useEffect(() => {
    if (location.state?.leadId && location.state.leadId !== activeLeadId) {
      setActiveLeadId(location.state.leadId);
      setShowChatOnMobile(true);
      // Clean up location state so refreshing doesn't keep forcing it if user selected someone else
      window.history.replaceState({}, document.title)
      window.history.replaceState({}, document.title)
    }
  }, [location.state?.leadId, activeLeadId]);

  const [availableTags, setAvailableTags] = useState([]);
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#00a884');
  const [tagUpdateTick, setTagUpdateTick] = useState(0); // For optimistic UI updates

  const tagMenuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (tagMenuRef.current && !tagMenuRef.current.contains(event.target)) {
        setShowTagMenu(false);
      }
    };
    if (showTagMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTagMenu]);

  // The tag list is only needed for the "Add Tag" menu: load it the first time
  // that menu opens instead of on every inbox visit.
  const tagsLoadedRef = useRef(false);
  useEffect(() => {
    if (!showTagMenu || tagsLoadedRef.current) return;
    tagsLoadedRef.current = true;
    tagApi.getTags().then(tags => setAvailableTags(tags)).catch((err) => {
      tagsLoadedRef.current = false;
      console.error(err);
    });
  }, [showTagMenu, tagApi]);
  
  // Files picked, pasted, dropped or photographed, shown in the send preview.
  const [pendingFiles, setPendingFiles] = useState([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [activeDropdownId, setActiveDropdownId] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [deleteModalMsg, setDeleteModalMsg] = useState(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const [isRecording, setIsRecording] = useState(false);

  const [forwardMessage, setForwardMessage] = useState(null);
  const [forwardSearch, setForwardSearch] = useState('');
  const [selectedForwardLeads, setSelectedForwardLeads] = useState([]);
  const [forwarding, setForwarding] = useState(false);

  const [pinMessageModal, setPinMessageModal] = useState(null);
  const [pinDuration, setPinDuration] = useState(168); // Default 7 days (168 hours)
  const [pinning, setPinning] = useState(false);
  const [currentPinIndex, setCurrentPinIndex] = useState(0);

  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState([]);

  // Message Search states
  const [showMessageSearchPanel, setShowMessageSearchPanel] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState('');
  const [highlightedMessageKey, setHighlightedMessageKey] = useState(null);
  const messageListRef = useRef(null);
  const messageHighlightTimeoutRef = useRef(null);

  // Contact Info states
  const [showContactInfoPanel, setShowContactInfoPanel] = useState(false);
  const [showEditContactModal, setShowEditContactModal] = useState(false);
  const [editContactData, setEditContactData] = useState({});
  const [savingContact, setSavingContact] = useState(false);

  // Lightbox state
  const [zoomedImageIndex, setZoomedImageIndex] = useState(null);
  const [lightboxZoomLevel, setLightboxZoomLevel] = useState(1);

  // Reaction state
  const [activeReactBarMsgId, setActiveReactBarMsgId] = useState(null);
  const [showFullReactionPicker, setShowFullReactionPicker] = useState(null);
  // userReactions: { [msgId]: emoji } — tracks the current user's own reaction per message
  const [userReactions, setUserReactions] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKeys.reactions) || '{}'); } catch { return {}; }
  });
  const saveUserReactions = (updated) => {
    setUserReactions(updated);
    localStorage.setItem(storageKeys.reactions, JSON.stringify(updated));
  };

  // Deleted for me state
  const [deletedForMeIds, setDeletedForMeIds] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKeys.deleted) || '[]');
    } catch {
      return [];
    }
  });
  const hideMessageForMe = (msgId) => {
    const updated = [...deletedForMeIds, msgId];
    setDeletedForMeIds(updated);
    localStorage.setItem(storageKeys.deleted, JSON.stringify(updated));
  };


  const socketRef = useRef(null);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  // No chat opens by itself (as in the admin inbox): opening the inbox loads
  // only the chat list, and a chat's messages load when it is picked.

  // Merge paginated server messages with realtime messages. Replacing this array
  // used to discard socket messages whenever an older page finished loading.
  useEffect(() => {
    setLocalMessages((prev) => mergeMessages(conversations || [], prev));
  }, [conversations]);

  // Never carry messages from the previously selected lead into the next chat.
  useEffect(() => {
    setLocalMessages([]);
  }, [activeLeadId]);

  // Refs to hold latest values for socket listeners without causing re-connects
  const activeLeadIdRef = useRef(activeLeadId);
  const refetchLeadsListRef = useRef(refetchLeadsList);

  useEffect(() => {
    activeLeadIdRef.current = activeLeadId;
    refetchLeadsListRef.current = refetchLeadsList;
  });

  // Chats read in this visit show no unread badge, without reloading the
  // whole chat list after every open.
  const [readLeadIds, setReadLeadIds] = useState(() => new Set());
  const markRead = (leadId) => {
    if (leadId === null || leadId === undefined) return;
    setReadLeadIds((prev) => (prev.has(String(leadId)) ? prev : new Set(prev).add(String(leadId))));
    // LeadOS: one PUT also clears the lead's Sales Task badge on the server.
    inboxApi.readConversation(leadId).catch((e) => console.error(e));
  };
  const markReadRef = useRef(markRead);
  useEffect(() => { markReadRef.current = markRead; });
  useEffect(() => {
    if (activeLeadId) markReadRef.current(activeLeadId);
  }, [activeLeadId]);

  // Live events can arrive in bursts (a reply plus its delivery receipts).
  // Reload the chat list at most once per burst.
  const listRefreshTimerRef = useRef(null);
  const refreshListSoon = () => {
    clearTimeout(listRefreshTimerRef.current);
    listRefreshTimerRef.current = setTimeout(() => refetchLeadsListRef.current(), 600);
  };
  useEffect(() => () => clearTimeout(listRefreshTimerRef.current), []);

  useEffect(() => {
    const current = String(activeLead?.id) === String(activeLeadId) ? activeLead : null;
    setAiPause({ paused: Boolean(current?.ai_paused), reason: current?.handover_reason || null });
  }, [activeLead, activeLeadId]);

  const resumeAi = async () => {
    setResumingAi(true);
    try {
      await api.post(`/leads/${activeLeadId}/ai`, { paused: false });
      setAiPause({ paused: false, reason: null });
      toast.success('AI will reply to this chat again');
    } catch (err) {
      toast.error(err.message || 'Could not resume the AI');
    } finally {
      setResumingAi(false);
    }
  };

  const clearTypingIndicator = (leadId) => {
    const key = String(leadId);
    if (typingTimeoutsRef.current[key]) {
      clearTimeout(typingTimeoutsRef.current[key]);
      delete typingTimeoutsRef.current[key];
    }
    setTypingLeadIds((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  };

  // ── SOCKET.IO CONNECTION ────────────────────────────────────
  useEffect(() => {
    const socket = socketIO(SOCKET_URL, {
      auth: { token: localStorage.getItem('leados_token') },
      transports: ['polling', 'websocket'], // Start with HTTP polling, then upgrade to WS (safer through Vite proxy)
      withCredentials: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      console.log('[Socket.io] Connected:', socket.id);
    });

    socket.on('disconnect', () => {
      setConnected(false);
      console.log('[Socket.io] Disconnected');
    });

    // New inbound message received from a customer
    socket.on(socketEvents.incoming, ({ lead_id, message }) => {
      // Refresh sidebar lead list to show new last_contact time
      refreshListSoon();
      // If the active conversation is for this lead, append the message
      if (activeLeadIdRef.current !== null && activeLeadIdRef.current !== undefined && String(lead_id) === String(activeLeadIdRef.current)) {
        setLocalMessages((prev) => {
          return mergeMessages(prev, [message]);
        });
        // The chat is on screen, so the new message is already read.
        markReadRef.current(lead_id);
      } else {
        // A chat read earlier in this visit has a new unread message again.
        setReadLeadIds((prev) => {
          if (!prev.has(String(lead_id))) return prev;
          const next = new Set(prev);
          next.delete(String(lead_id));
          return next;
        });
      }
    });

    // Our own outbound message confirmed by server
    socket.on(socketEvents.outgoing, ({ lead_id, message }) => {
      refreshListSoon();
      clearTypingIndicator(lead_id);
      if (activeLeadIdRef.current !== null && activeLeadIdRef.current !== undefined && String(lead_id) === String(activeLeadIdRef.current)) {
        setLocalMessages((prev) => {
          return mergeMessages(prev, [message]);
        });
      }
    });

    if (alliance) {
      socket.on('alliance_contacts_changed', () => refetchLeadsListRef.current());
    } else {
      // The AI handed this chat to a person while it is open.
      socket.on('lead_handover', ({ lead_id, reason, paused }) => {
        if (paused && String(lead_id) === String(activeLeadIdRef.current)) setAiPause({ paused: true, reason: reason || null });
      });
    }

    // AI is waiting in queue / composing a reply to the customer's last message
    socket.on(socketEvents.typing, ({ lead_id, typing, status }) => {
      if (typing) {
        const key = String(lead_id);
        const aiStatus = status || 'composing';
        setTypingLeadIds((prev) => { const m = new Map(prev); m.set(key, aiStatus); return m; });
        if (typingTimeoutsRef.current[key]) clearTimeout(typingTimeoutsRef.current[key]);
        // Safety net — 90s covers 60s queue + 30s composing
        typingTimeoutsRef.current[key] = setTimeout(() => clearTypingIndicator(key), 90000);
      } else {
        clearTypingIndicator(lead_id);
      }
    });

    // Status update (sent → delivered → read)
    socket.on(socketEvents.status, ({ wa_message_id, status }) => {
      setLocalMessages((prev) =>
        prev.map((m) => ((m.wa_message_id || m.wa_msg_id) === wa_message_id ? { ...m, status } : m))
      );
    });

    socket.on(socketEvents.edited, (message) => {
      setLocalMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, ...message } : m)));
    });

    socket.on(socketEvents.deleted, (message) => {
      setLocalMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, is_deleted: true } : m)));
    });

    return () => {
      socket.disconnect();
      Object.values(typingTimeoutsRef.current).forEach(clearTimeout);
      typingTimeoutsRef.current = {};
    };
  }, []); // Empty dependency array ensures it connects only once!

  const handleSaveContact = async (e) => {
    e.preventDefault();
    if (!editContactData?.id) return;
    setSavingContact(true);
    try {
      await inboxApi.updateLead(editContactData.id, editContactData);
      refetchLeadsList(); // Use direct hook reference
      refetchLead(); // Update active lead data as well
      setShowEditContactModal(false);
    } catch (err) {
      alert("Failed to update contact: " + (err.message || 'Unknown error'));
    } finally {
      setSavingContact(false);
    }
  };

  // Same flow as the admin WhatsApp Chat: picked, pasted, dropped or
  // photographed files open the send preview (caption per file, up to 10).
  const addFiles = (files) => {
    const list = [...(files || [])];
    if (!list.length) return;
    const tooBig = list.filter((f) => f.size > MAX_FILE);
    if (tooBig.length) toast.error(`${tooBig.length === 1 ? `"${tooBig[0].name}" is` : `${tooBig.length} files are`} over WhatsApp's 100 MB limit.`);
    const fit = list.filter((f) => f.size <= MAX_FILE);
    setPendingFiles((prev) => {
      const room = MAX_FILES - prev.length;
      if (fit.length > room) toast.error(`You can send up to ${MAX_FILES} files at once.`);
      return [...prev, ...toPending(fit.slice(0, Math.max(0, room)))];
    });
  };

  const handleFileChange = (e) => {
    addFiles(e.target.files);
    e.target.value = '';
  };

  const handleAttachOptionClick = (option) => {
    setShowAttachMenu(false);
    if (option.camera) { setCameraOpen(true); return; }
    if (fileInputRef.current) {
      fileInputRef.current.accept = option.accept;
      fileInputRef.current.click();
    }
  };

  // Before the server said how Meta takes the file (alliance uploads), the
  // browser's type decides.
  const kindOfFile = (file) => (file.type.startsWith('image/') ? 'image'
    : file.type.startsWith('video/') ? 'video'
      : file.type.startsWith('audio/') ? 'audio' : 'document');

  /**
   * Sends one message: text, or a file (stored on our media server in this
   * workspace's folder) with an optional caption. Throws when it was not
   * sent, after telling the user why, so the send preview keeps the file.
   */
  const deliverMessage = async ({ text = '', file = null, onProgress } = {}) => {
    if (!activeLeadId) throw new Error('No chat open');
    const quoted = replyingTo;
    let mediaUrl = null;
    let msgType = 'text';
    let waMediaId = null;
    let optimisticId = null;

    try {
      if (file) {
        const formData = new FormData();
        formData.append('file', file);
        const uploadRes = await inboxApi.uploadMedia(formData, onProgress);
        mediaUrl = uploadRes.fileUrl;
        // Alliance inbox: prefer the Meta media_id so we don't need a public URL.
        if (alliance && uploadRes.waMediaId) waMediaId = uploadRes.waMediaId;
        // The server applies Meta's limits (a 9 MB photo or a .webp goes as a document).
        msgType = uploadRes.kind || kindOfFile(file);
      }

      optimisticId = `optimistic-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      const optimisticMsg = {
        id: optimisticId,
        direction: 'outbound',
        content: text,
        status: 'sending',
        type: msgType,
        media_url: mediaUrl,
        reply_to: quoted,
        timestamp: new Date().toISOString(),
        is_ai: alliance && allianceDraftSource === 'ai',
      };
      setLocalMessages((prev) => [...prev, optimisticMsg]);
      setReplyingTo(null);

      const sentMsg = alliance
        ? await inboxApi.sendWhatsAppMessage(activeLeadId, text, mediaUrl, msgType, quoted?.wa_msg_id, false, allianceDraftSource, waMediaId)
        : await inboxApi.sendWhatsAppMessage(activeLeadId, text, mediaUrl, msgType, quoted?.wa_msg_id);
      setAllianceDraftSource('human');

      // If window was closed, backend sent a template to reopen it silently.
      // WhatsApp blocks free text and media outside the 24-hour window, so the
      // server never sent this message: remove it.
      if (sentMsg?.window_closed) {
        setLocalMessages((prev) => prev.filter(m => m.id !== optimisticId));
        toast.error('Message not sent! The WhatsApp 24-hour window has expired. A standard template was sent automatically to reopen the chat. You can send files once they reply.', { duration: 6000 });
        const closed = new Error('window_closed');
        closed.shown = true;
        throw closed;
      }

      // Socket.IO may have already inserted this confirmed message. Remove the
      // optimistic row and merge the confirmation instead of creating a duplicate.
      setLocalMessages((prev) => mergeMessages(
        prev.filter((m) => m.id !== optimisticId),
        [{ ...sentMsg.message, reply_to: quoted }]
      ));
    } catch (err) {
      if (optimisticId) setLocalMessages((prev) => prev.filter(m => m.id !== optimisticId));
      if (!err.shown) {
        const errorData = err.response?.data;
        toast.error(errorData?.reason === 'window_closed'
          ? (errorData?.error || 'The 24-hour WhatsApp window is closed. The approved reopen template could not be sent.')
          : 'Failed to send message: ' + (errorData?.error || err.message));
        err.shown = true;
      }
      throw err;
    }
  };

  const handleSend = async (e) => {
    e?.preventDefault?.();
    const text = msg;
    if (!text.trim() || !activeLeadId || sending) return;
    setSending(true);
    setMsg('');
    try {
      await deliverMessage({ text });
    } catch {
      setMsg((current) => current || text); // keep what was typed
    } finally {
      setSending(false);
    }
  };

  // A recorded voice note goes straight out, as in the admin chat.
  const sendVoice = async (blob) => {
    setIsRecording(false);
    setSending(true);
    try {
      await deliverMessage({ file: new File([blob], voiceFileName(blob.type), { type: blob.type }) });
    } catch {
      // shown already
    } finally {
      setSending(false);
    }
  };

  const handleAllianceSuggestion = async () => {
    if (!alliance || !activeLeadId || suggestingReply) return;
    setSuggestingReply(true);
    try {
      const result = await allianceInboxApi.suggestReply(activeLeadId);
      setMsg(result.suggestion || '');
      setAllianceDraftSource('ai');
      toast.success('AI suggestion ready. Review and edit it before sending.');
    } catch (error) {
      toast.error(error.message || 'Unable to generate an AI suggestion.');
    } finally {
      setSuggestingReply(false);
    }
  };

  const handleCopy = async (text) => {
    const value = String(text || '').trim();
    if (!value) {
      toast.error('This message has no text to copy.');
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Message copied.');
    } catch {
      toast.error('Unable to copy the message.');
    }
  };
  const handleDownloadMedia = (mediaUrl) => {
    if (!mediaUrl) return;
    let fullMediaUrl = mediaUrl.startsWith('http') ? mediaUrl : `${SOCKET_URL}${mediaUrl}`;
    // Signed media-server links: ask the server for a download, since the
    // `download` attribute is ignored on another origin.
    if (fullMediaUrl.includes('&sig=')) fullMediaUrl += '&dl=1';
    const link = document.createElement('a');
    link.href = fullMediaUrl;
    link.target = '_blank';
    const filename = mediaFileName(mediaUrl) || 'download';
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  const startEdit = (m) => {
    setEditingMessageId(m.id);
    setEditContent(getMessageText(m));
  };
  const saveEdit = async () => {
    setEditSaving(true);
    try {
      await inboxApi.editMessage(editingMessageId, editContent);
      setEditingMessageId(null);
      setEditContent('');
    } catch (e) {
      alert("Failed to edit");
    } finally {
      setEditSaving(false);
    }
  };

  const handleForward = async () => {
    if (!forwardMessage || selectedForwardLeads.length === 0) return;
    setForwarding(true);
    try {
      if (forwardMessage.isBulk) {
        // Bulk forwarding: send multiple messages to all selected leads
        for (const leadId of selectedForwardLeads) {
          for (const msgId of forwardMessage.messages) {
            const m = localMessages.find(x => x.id === msgId);
            if (m) {
              await inboxApi.sendWhatsAppMessage(leadId, m.content, m.media_url, m.msg_type || m.type || 'text', null, true);
            }
          }
        }
        setIsSelectMode(false);
        setSelectedMessageIds([]);
      } else {
        // Single forward
        await Promise.all(selectedForwardLeads.map(leadId =>
          inboxApi.sendWhatsAppMessage(leadId, forwardMessage.content, forwardMessage.media_url, forwardMessage.type || 'text', null, true)
        ));
      }

      const firstLeadId = selectedForwardLeads[0];
      setForwardMessage(null);
      setSelectedForwardLeads([]);
      setForwardSearch('');
      if (firstLeadId) setActiveLeadId(firstLeadId);
    } catch (err) {
      console.error('Failed to forward message:', err);
      alert('Failed to forward message to some contacts.');
    } finally {
      setForwarding(false);
    }
  };

  const handlePin = async () => {
    if (!pinMessageModal) return;
    setPinning(true);
    try {
      let updatedMessage;
      if (pinMessageModal.pinned_until && new Date(pinMessageModal.pinned_until) > new Date()) {
        const res = await inboxApi.unpinMessage(pinMessageModal.id);
        updatedMessage = res.message;
      } else {
        const res = await inboxApi.pinMessage(pinMessageModal.id, pinDuration);
        updatedMessage = res.message;
      }

      // Instantly update the local state so the top bar and icon appear immediately
      setLocalMessages((prev) => prev.map((m) => (m.id === updatedMessage.id ? { ...m, ...updatedMessage } : m)));

      setPinMessageModal(null);
    } catch (err) {
      console.error('Failed to pin/unpin:', err);
      alert('Failed to update pin status.');
    } finally {
      setPinning(false);
    }
  };

  const handleStar = async (msgId, isStarred) => {
    try {
      // Optimistically update the UI instantly
      setLocalMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, is_starred: isStarred } : m)));

      const res = await inboxApi.toggleStarMessage(msgId, isStarred);
      // Backend confirmation
      setLocalMessages((prev) => prev.map((m) => (m.id === res.message.id ? { ...m, ...res.message } : m)));
    } catch (err) {
      console.error('Failed to star/unstar:', err);
      alert('Failed to update star status.');
      // Revert on error
      setLocalMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, is_starred: !isStarred } : m)));
    }
  };

  const handleReact = async (msgId, emoji) => {
    setActiveReactBarMsgId(null);
    setShowFullReactionPicker(null);

    const prevEmoji = userReactions[msgId]; // emoji the user already reacted with
    const isSameEmoji = prevEmoji === emoji;

    // Build updated userReactions map
    const updatedUserReactions = { ...userReactions };
    if (isSameEmoji) {
      delete updatedUserReactions[msgId]; // toggle off
    } else {
      updatedUserReactions[msgId] = emoji; // switch to new emoji
    }
    saveUserReactions(updatedUserReactions);

    // Optimistic UI update
    setLocalMessages((prev) => prev.map((m) => {
      if (m.id !== msgId) return m;
      const reactions = { ...(m.reactions || {}) };
      // Remove old reaction if switching
      if (prevEmoji && !isSameEmoji) {
        if (reactions[prevEmoji] > 1) reactions[prevEmoji] -= 1;
        else delete reactions[prevEmoji];
      }
      // Toggle off or add new
      if (isSameEmoji) {
        if (reactions[emoji] > 1) reactions[emoji] -= 1;
        else delete reactions[emoji];
      } else {
        reactions[emoji] = (reactions[emoji] || 0) + 1;
      }
      return { ...m, reactions };
    }));

    try {
      // Remove old reaction first if switching emoji
      if (prevEmoji && !isSameEmoji) {
        await inboxApi.reactToMessage(msgId, prevEmoji, 'remove');
      }
      // Add new or remove toggled
      const action = isSameEmoji ? 'remove' : 'add';
      const res = await inboxApi.reactToMessage(msgId, emoji, action);
      setLocalMessages((prev) => prev.map((m) => m.id === res.message.id ? { ...m, reactions: res.message.reactions } : m));
    } catch (err) {
      console.error('React failed:', err);
    }
  };

  const displayLeads = leads || [];
  const activeObj = activeLeadId ? (displayLeads.find((l) => l.id === activeLeadId) || activeLead) : null;

  const deletedForMeSet = useMemo(() => new Set(deletedForMeIds), [deletedForMeIds]);
  const chatImages = useMemo(
    () => localMessages.filter(m => m.type === 'image' && m.media_url && !deletedForMeSet.has(m.id)),
    [localMessages, deletedForMeSet]
  );

  // 24-hour reply window: the newest customer message we know of, from the
  // server (last_inbound_at) or from a live message received since.
  const activeLeadDetails = activeLead && String(activeLead.id) === String(activeLeadId) ? activeLead : null;
  const lastInboundAt = useMemo(() => {
    let latest = activeLeadDetails?.last_inbound_at ? new Date(activeLeadDetails.last_inbound_at).getTime() : null;
    for (const m of localMessages) {
      if (m.direction !== 'inbound' && m.from !== 'lead') continue;
      const at = getMessageTimestamp(m);
      if (at !== null && (latest === null || at > latest)) latest = at;
    }
    return latest;
  }, [activeLeadDetails, localMessages]);
  const windowKnown = !alliance && Boolean(activeLeadDetails) && (activeLeadDetails.last_inbound_at !== undefined || lastInboundAt !== null);
  const windowHoursLeft = replyWindowHoursLeft(lastInboundAt);
  const workspaceAiOff = !alliance && workspaceAiEnabled === false;

  const getMessageText = (m) => m.content || m.message || m.text || '';

  const renderMessageWithLinks = (text) => {
    if (!text) return null;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, i) => {
      if (part.match(urlRegex)) {
        let cleanUrl = part;
        let trailing = '';
        if (/[.,!?;:]$/.test(cleanUrl)) {
          trailing = cleanUrl.slice(-1);
          cleanUrl = cleanUrl.slice(0, -1);
        }
        return (
          <span key={i}>
            <a href={cleanUrl} target="_blank" rel="noreferrer" style={{ color: C.blue, textDecoration: 'underline' }} onClick={(e) => e.stopPropagation()}>
              {cleanUrl}
            </a>
            {trailing}
          </span>
        );
      }
      return part;
    });
  };
  const renderLastMessage = (lead) => {
    const lastMsg = lead.last_msg;
    if (!lastMsg || Object.keys(lastMsg).every(k => lastMsg[k] === null)) {
      return <span>{lead.interest || 'No custom details'}</span>;
    }

    if (lastMsg.is_deleted) {
      return (
        <span style={{ fontStyle: 'italic', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          This message was deleted
        </span>
      );
    }

    const type = lastMsg.msg_type;
    const content = lastMsg.content || '';

    // Truncate helper to max 15 characters
    const truncate = (str, len = 15) => {
      if (!str) return '';
      return str.length > len ? str.substring(0, len) + '...' : str;
    };

    if (type === 'image') {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Image size={12} style={{ flexShrink: 0 }} />
          <span>{content ? truncate(content) : 'Photo'}</span>
        </span>
      );
    }
    if (type === 'video') {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Film size={12} style={{ flexShrink: 0 }} />
          <span>{content ? truncate(content) : 'Video'}</span>
        </span>
      );
    }
    if (type === 'audio') {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Music size={12} style={{ flexShrink: 0 }} />
          <span>Audio</span>
        </span>
      );
    }
    if (type && type !== 'text') {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <FileText size={12} style={{ flexShrink: 0 }} />
          <span>{content ? truncate(content) : 'Document'}</span>
        </span>
      );
    }

    return <span>{truncate(content)}</span>;
  };
  const getMessageTime = (m) => {
    const raw = m.timestamp || m.sent_at || m.time;
    if (!raw) return '';
    return new Date(raw).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  const filteredMessages = useMemo(() => localMessages.filter(m => !deletedForMeSet.has(m.id)), [localMessages, deletedForMeSet]);
  const messageFirstItemIndex = Math.max(0, 10000 - filteredMessages.length);

  const focusSearchResult = (message) => {
    const targetKey = getMessageIdentity(message);
    if (!targetKey) return;

    const messageIndex = filteredMessages.findIndex((candidate) =>
      candidate === message || getMessageIdentity(candidate) === targetKey
    );
    if (messageIndex === -1) return;

    if (messageHighlightTimeoutRef.current) {
      clearTimeout(messageHighlightTimeoutRef.current);
    }

    // Virtuoso only mounts visible rows, so DOM-based scrollIntoView is
    // unreliable for search results that are currently off screen.
    setHighlightedMessageKey(targetKey);
    messageListRef.current?.scrollToIndex({
      // Imperative Virtuoso indexes are zero-based positions within `data`.
      // `firstItemIndex` only offsets the index passed to itemContent; adding it
      // here makes Virtuoso clamp the target to the final row.
      index: messageIndex,
      align: 'center',
      behavior: 'auto'
    });

    // Once Virtuoso has mounted the requested row, center the exact keyed DOM
    // element. The retry covers rows whose height is measured after mounting.
    [50, 150].forEach((delay) => {
      setTimeout(() => {
        document.getElementById(`msg-${targetKey}`)?.scrollIntoView({
          behavior: 'auto',
          block: 'center'
        });
      }, delay);
    });

    messageHighlightTimeoutRef.current = setTimeout(() => {
      setHighlightedMessageKey(null);
      messageHighlightTimeoutRef.current = null;
    }, 2500);
  };

  useEffect(() => () => {
    if (messageHighlightTimeoutRef.current) {
      clearTimeout(messageHighlightTimeoutRef.current);
    }
  }, []);

  const getGroupDateLabel = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '';

    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    }

    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }

    return date.toLocaleDateString([], { weekday: 'long' });
  };

  const activeLeadTypingStatus = (activeLeadId !== null && activeLeadId !== undefined) ? typingLeadIds.get(String(activeLeadId)) : null;
  const isActiveLeadTyping = !!activeLeadTypingStatus;

return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fff' }}>
      <style>{INBOX_CSS}</style>
      {/* ── TOP BAR (as in the admin WhatsApp Chat) ─── */}
      <header style={{ height: 56, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', borderBottom: '1px solid ' + LINE, background: '#fff' }}>
        <span style={{ width: 32, height: 32, borderRadius: 8, background: WA_GREEN, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><MessageCircle size={18} color="#fff" /></span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>WhatsApp Chat</div>
          <div style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{alliance ? 'Alliance inbox' : 'Chat directly with your leads'}</div>
        </div>
        <span
          title={connected ? 'Live updates are on' : 'Live updates are off; reconnecting'}
          style={{ marginLeft: 4, display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 600, border: '1px solid ' + (connected ? '#bbf7d0' : LINE), background: connected ? '#f0fdf4' : '#f1f5f9', color: connected ? '#15803d' : '#64748b' }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 999, background: connected ? '#22c55e' : '#94a3b8' }} />
          {connected ? 'Live' : 'Offline'}
        </span>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
      {/* ── SIDEBAR ─────────────────────────────────── */}
      <div
        className={showChatOnMobile ? 'hide-mobile' : 'w-full-mobile'}
        style={{ width: 360, minHeight: 0, borderRight: '1px solid ' + LINE, display: 'flex', flexDirection: 'column', flexShrink: 0, background: '#fff' }}
      >
        <div style={{ padding: 12, borderBottom: '1px solid ' + LINE }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} color="#64748b" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name or number"
              aria-label="Search chats"
              style={{ width: '100%', height: 36, boxSizing: 'border-box', paddingLeft: 36, paddingRight: 12, border: '1px solid ' + LINE, borderRadius: 8, background: '#fff', color: '#0f172a', fontSize: 14, outline: 'none' }}
            />
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {loadingLeads && displayLeads.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 12 }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ width: 40, height: 40, borderRadius: 999, background: '#f1f5f9' }} />
                  <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ height: 12, width: '45%', borderRadius: 4, background: '#f1f5f9' }} />
                    <span style={{ height: 10, width: '70%', borderRadius: 4, background: '#f1f5f9' }} />
                  </span>
                </div>
              ))}
            </div>
          ) : displayLeads.length === 0 ? (
            <div style={{ padding: '64px 24px', textAlign: 'center', fontSize: 13, color: '#64748b' }}>
              {search ? 'No chat matches this search.' : 'No chats yet. WhatsApp messages from your leads appear here.'}
            </div>
          ) : (
          <Virtuoso
            style={{ flex: 1, minHeight: 0 }}
            data={displayLeads}
            computeItemKey={(_, l) => l.id}
            endReached={() => {
              if (hasMoreLeads && !loadingMoreLeads) {
                loadMoreLeads();
              }
            }}
            components={{
              Footer: () => loadingMoreLeads ? <div style={{ padding: 10, textAlign: 'center', color: C.muted, fontSize: 11 }}>Loading more...</div> : null
            }}
            itemContent={(index, l) => {
              const active = activeLeadId === l.id;
              const unread = readLeadIds.has(String(l.id)) ? 0 : Number(l.unread || 0);
              return (
                <button
                  key={l.id}
                  type="button"
                  className="wa-list-item"
                  data-active={active ? 'true' : 'false'}
                  onClick={() => { setActiveLeadId(l.id); setShowChatOnMobile(true); }}
                  style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 12, padding: 12, border: 'none', borderBottom: '1px solid ' + LINE, background: 'transparent', cursor: 'pointer', textAlign: 'left', transition: 'background-color .15s' }}
                >
                  <InitialsAvatar name={l.name || l.phone} size={40} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: unread ? 700 : 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name || l.phone}</span>
                      <span style={{ flexShrink: 0, fontSize: 11, fontWeight: unread ? 600 : 400, color: unread ? '#15803d' : '#64748b' }}>{listTime(l.last_contact)}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2 }}>
                      <span style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                        {renderLastMessage(l)}
                      </span>
                      {unread > 0 && (
                        <span style={{ flexShrink: 0, minWidth: 20, height: 20, padding: '0 6px', borderRadius: 10, background: WA_GREEN, color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{unread}</span>
                      )}
                    </div>
                    {l.tags?.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, overflow: 'hidden' }}>
                        {l.tags.slice(0, 3).map((tag) => (
                          <span key={tag.id} style={{ flexShrink: 0, fontSize: 10, fontWeight: 600, color: tag.color, background: tag.color + '1f', borderRadius: 999, padding: '1px 6px' }}>{tag.name}</span>
                        ))}
                        {l.tags.length > 3 && <span style={{ fontSize: 10, color: '#64748b' }}>+{l.tags.length - 3}</span>}
                      </div>
                    )}
                  </div>
                </button>
              );
            }}
          />
          )}
        </div>
      </div>

      {/* ── CHAT PANEL ──────────────────────────────── */}
      <div className={!showChatOnMobile ? 'hide-mobile' : 'w-full-mobile'} style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!activeLeadId ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center', background: BAR_BG }}>
            <span style={{ width: 64, height: 64, borderRadius: 999, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <MessageCircle size={30} color={WA_GREEN} />
            </span>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#0f172a' }}>WhatsApp Chat</div>
            <p style={{ maxWidth: 360, margin: 0, fontSize: 14, color: '#64748b' }}>Pick a chat on the left to read and reply.</p>
          </div>
        ) : (<>
        <div style={{ height: 56, padding: '0 12px', borderBottom: '1px solid ' + LINE, background: '#fff', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button type="button" className="show-mobile" aria-label="Back to chats" onClick={() => setShowChatOnMobile(false)} style={{ background: 'transparent', border: 'none', color: '#64748b', display: 'none', cursor: 'pointer', padding: 4 }}>
            <ChevronLeft size={20} />
          </button>
          {/* Like WhatsApp: the name opens Contact info */}
          <button
            type="button"
            title="Contact info"
            style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1, cursor: 'pointer', background: 'transparent', border: 'none', padding: '4px 0', textAlign: 'left' }}
            onClick={() => {
              setShowContactInfoPanel((open) => !open);
              setShowMessageSearchPanel(false);
            }}
          >
            <InitialsAvatar name={activeObj?.name || activeObj?.phone} size={36} />
            <span style={{ minWidth: 0, display: 'block' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeObj?.name || activeObj?.phone || (loadingLead ? 'Loading…' : '')}</span>
                {activeObj?.tags?.slice(0, 2).map(tag => (
                  <span key={tag.id} style={{ flexShrink: 0, fontSize: 10, fontWeight: 600, color: tag.color, background: tag.color + '1f', padding: '1px 6px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <Tag size={9} /> {tag.name}
                  </span>
                ))}
              </span>
              {alliance ? (
                <span style={{ display: 'block', fontSize: 11, color: '#64748b' }}>Click here for contact info</span>
              ) : workspaceAiOff ? (
                <span title="Turn the AI on in AI Brain" style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b' }}>AI off for this workspace</span>
              ) : aiPause.paused ? (
                <span title={aiPause.reason || undefined} style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#b45309', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  AI paused{aiPause.reason ? ` - ${aiPause.reason}` : ''}
                </span>
              ) : (
                <span style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#15803d' }}>AI active</span>
              )}
            </span>
          </button>
          {windowKnown && (
            <span
              className="hide-mobile"
              title="Meta allows free-form replies for 24 hours after the customer's last message. After that, sending reopens the chat with an approved template."
              style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 999, padding: '3px 9px', fontSize: 11, fontWeight: 600, background: windowHoursLeft ? '#dcfce7' : '#f1f5f9', color: windowHoursLeft ? '#15803d' : '#64748b' }}
            >
              <Clock size={12} /> {windowHoursLeft ? `Reply window: ${windowHoursLeft}h left` : 'Reply window closed'}
            </span>
          )}
          {!alliance && !workspaceAiOff && aiPause.paused && (
            <button
              type="button"
              onClick={resumeAi}
              disabled={resumingAi}
              style={{ flexShrink: 0, background: WA_GREEN, border: 'none', borderRadius: 8, color: '#fff', height: 32, padding: '0 12px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', cursor: resumingAi ? 'not-allowed' : 'pointer', opacity: resumingAi ? 0.6 : 1 }}
            >
              {resumingAi ? 'Resuming…' : 'Resume AI'}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setShowMessageSearchPanel(!showMessageSearchPanel);
              setShowContactInfoPanel(false);
              setMessageSearchQuery('');
            }}
            style={{
              flexShrink: 0,
              background: showMessageSearchPanel ? '#dcfce7' : 'transparent',
              border: '1px solid ' + (showMessageSearchPanel ? '#bbf7d0' : LINE),
              cursor: 'pointer',
              width: 32,
              height: 32,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: showMessageSearchPanel ? '#15803d' : '#475569',
            }}
            title="Search messages"
            aria-label="Search messages"
          >
            <Search size={15} />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden', position: 'relative' }}>
          {/* Main Chat Flow (files can be dropped anywhere on it) */}
          <div
            style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}
            onDragOver={(e) => { if (!isSelectMode && e.dataTransfer?.types?.includes('Files')) e.preventDefault(); }}
            onDrop={(e) => {
              if (isSelectMode || !e.dataTransfer?.files?.length) return;
              e.preventDefault();
              addFiles(e.dataTransfer.files);
            }}
          >
            {pendingFiles.length > 0 && (
              <SendPreview
                items={pendingFiles}
                onItems={setPendingFiles}
                onClose={() => {
                  pendingFiles.forEach((x) => x.preview && URL.revokeObjectURL(x.preview));
                  setPendingFiles([]);
                }}
                onSend={(item, caption, onProgress) => deliverMessage({ text: caption, file: item.file, onProgress })}
              />
            )}
            <CameraDialog open={cameraOpen} onOpenChange={setCameraOpen} onCapture={(file) => addFiles([file])} />

            {/* Pinned Messages Bar */}
        {(() => {
          const pinnedMessages = localMessages.filter(m => m.pinned_until && new Date(m.pinned_until) > new Date() && !deletedForMeSet.has(m.id));
          if (pinnedMessages.length === 0) return null;

          const currentPin = pinnedMessages[currentPinIndex % pinnedMessages.length];
          if (!currentPin) return null;

          return (
            <div
              style={{ background: C.card, borderBottom: '1px solid ' + C.border, padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', position: 'relative' }}
              onClick={() => {
                const el = document.getElementById(`msg-${currentPin.id}`);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setCurrentPinIndex((prev) => (prev + 1) % pinnedMessages.length);
              }}
            >
              <Pin size={16} color={C.accent} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.accent }}>Pinned Message {pinnedMessages.length > 1 ? `(${currentPinIndex + 1}/${pinnedMessages.length})` : ''}</p>
                <p style={{ margin: 0, fontSize: 12, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {currentPin.content || (currentPin.media_url ? 'Attachment' : '')}
                </p>
              </div>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await inboxApi.unpinMessage(currentPin.id);
                    // Instantly update the local state so the top bar updates immediately
                    setLocalMessages((prev) => prev.map((m) => (m.id === currentPin.id ? { ...m, pinned_until: null } : m)));
                  } catch (err) {
                    console.error('Failed to unpin:', err);
                    alert('Failed to unpin message');
                  }
                }}
                style={{
                  background: C.bg,
                  border: '1px solid ' + C.border,
                  borderRadius: 6,
                  padding: '4px 10px',
                  fontSize: 11,
                  color: C.muted,
                  cursor: 'pointer',
                  fontWeight: 500,
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  flexShrink: 0
                }}
                onMouseOver={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = '#ef4444'; }}
                onMouseOut={e => { e.currentTarget.style.color = C.muted; e.currentTarget.style.borderColor = C.border; }}
              >
                <X size={12} />
                Unpin
              </button>
            </div>
          );
        })()}

        {/* Messages area */}
        {/* Plain chat colour, no wallpaper image (same as the admin chat) */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: CHAT_BG, position: 'relative', overflow: 'hidden' }}>
          {loadingLead && localMessages.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 24 }}>
              <span style={{ height: 40, width: '45%', borderRadius: 8, background: 'rgba(255,255,255,.7)' }} />
              <span style={{ height: 56, width: '60%', borderRadius: 8, background: 'rgba(255,255,255,.7)' }} />
              <span style={{ height: 44, width: '40%', marginLeft: 'auto', borderRadius: 8, background: 'rgba(217,253,211,.8)' }} />
            </div>
          )}
          {!loadingLead && localMessages.length === 0 && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 60 }}>
              <span style={{ background: 'rgba(255,255,255,.9)', borderRadius: 6, padding: '6px 12px', fontSize: 12, color: '#475569', boxShadow: '0 1px 0.5px rgba(11,20,26,.13)' }}>No messages yet. Start the conversation!</span>
            </div>
          )}
          {filteredMessages.length > 0 && (
            <Virtuoso
              ref={messageListRef}
              style={{ flex: 1, minHeight: 0, zIndex: 1, background: 'transparent' }}
              data={filteredMessages}
              computeItemKey={(_, message) => getMessageIdentity(message) || `message-${_}`}
              firstItemIndex={messageFirstItemIndex}
              initialTopMostItemIndex={filteredMessages.length - 1}
              startReached={() => {
                if (hasMore && !loadingMore) {
                  loadMoreMessages();
                }
              }}
              components={{
                Header: () => loadingMore ? <div style={{ padding: 10, textAlign: 'center', color: C.muted, fontSize: 11 }}>Loading older messages...</div> : <div style={{ height: 60 }} />,
                Footer: () => (
                  <div style={{ padding: '0 18px' }}>
                    {isActiveLeadTyping && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 11 }}>
                        <div style={{
                          background: activeLeadTypingStatus === 'waiting' ? C.muted + '15' : C.accent + '20',
                          border: '1px solid ' + (activeLeadTypingStatus === 'waiting' ? C.muted + '40' : C.accentDim),
                          borderRadius: '13px 4px 13px 13px',
                          padding: '9px 13px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6
                        }}>
                          {activeLeadTypingStatus === 'waiting' ? (
                            <>
                              <span style={{ fontSize: 10, color: C.muted, marginRight: 2 }}>⏳ AI in queue...</span>
                              {[0, 1, 2].map((dot) => (
                                <span key={dot} style={{
                                  width: 4,
                                  height: 4,
                                  borderRadius: '50%',
                                  background: C.muted,
                                  animation: 'typingBounce 1.8s infinite',
                                  animationDelay: `${dot * 0.25}s`
                                }} />
                              ))}
                            </>
                          ) : (
                            <>
                              <span style={{ fontSize: 10, color: C.muted, marginRight: 2 }}>🤖 AI is typing</span>
                              {[0, 1, 2].map((dot) => (
                                <span key={dot} style={{
                                  width: 5,
                                  height: 5,
                                  borderRadius: '50%',
                                  background: C.accent,
                                  animation: 'typingBounce 1.2s infinite',
                                  animationDelay: `${dot * 0.15}s`
                                }} />
                              ))}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                    <div style={{ height: 18 }} />
                  </div>
                )
              }}
              itemContent={(i, m) => {
                const messageIndex = i - messageFirstItemIndex;
                const isLead = m.direction === 'inbound' || m.from === 'lead';
                const isAI = m.is_ai === true || m.sender_type === 'ai' || m.sender === 'ai' || m.from === 'ai';
                const isAutomation = !isLead && m.sender_type === 'automation';
                const isSending = m.id?.toString().startsWith('optimistic-');

                // Determine if we should show date header
                let showDateHeader = false;
                let dateHeaderLabel = '';
                const mDateStr = m.timestamp || m.sent_at || m.time;
                if (messageIndex === 0 && mDateStr) {
                  showDateHeader = true;
                  dateHeaderLabel = getGroupDateLabel(mDateStr);
                } else if (mDateStr) {
                  const prevMsg = filteredMessages[messageIndex - 1];
                  if (prevMsg) {
                    const prevDateStr = prevMsg.timestamp || prevMsg.sent_at || prevMsg.time;
                    if (prevDateStr) {
                      const prevDate = new Date(prevDateStr).toDateString();
                      const currDate = new Date(mDateStr).toDateString();
                      if (prevDate !== currDate) {
                        showDateHeader = true;
                        dateHeaderLabel = getGroupDateLabel(mDateStr);
                      }
                    }
                  }
                }

                return (
                  <div style={{ padding: '0 18px', marginBottom: 11 }}>
                    {showDateHeader && (
                      <div style={{ display: 'flex', justifyContent: 'center', margin: '20px 0 14px 0' }}>
                        <span style={{
                          background: 'rgba(255,255,255,0.92)',
                          border: 'none',
                          color: '#54656f',
                          fontSize: '12px',
                          padding: '6px 12px',
                          borderRadius: '8px',
                          fontWeight: '500',
                          boxShadow: '0 1px 0.5px rgba(11,20,26,.13)'
                        }}>
                          {dateHeaderLabel}
                        </span>
                      </div>
                    )}

              <div
                id={`msg-${getMessageIdentity(m) || i}`}
                key={getMessageIdentity(m) || i}
                className="wa-row"
                style={{ display: 'flex', justifyContent: isLead ? 'flex-start' : 'flex-end', opacity: isSending ? 0.6 : 1, transition: 'opacity 0.3s' }}
              >
                {isSelectMode && (
                  <div style={{ display: 'flex', alignItems: 'center', marginRight: isLead ? 10 : 10, marginLeft: isLead ? 0 : 10, order: isLead ? -1 : 1 }}>
                    <input
                      type="checkbox"
                      checked={selectedMessageIds.includes(m.id)}
                      onChange={() => {
                        setSelectedMessageIds(prev => prev.includes(m.id) ? prev.filter(id => id !== m.id) : [...prev, m.id]);
                      }}
                      style={{ width: 18, height: 18, accentColor: C.accent, cursor: 'pointer' }}
                    />
                  </div>
                )}
                <div style={{ position: 'relative', maxWidth: 'min(70%, 560px)' }}>
                  <div
                    style={{
                      position: 'relative',
                      background: highlightedMessageKey === getMessageIdentity(m)
                        ? (isLead ? '#f0f2f5' : '#c6f1bd')
                        : (selectedMessageIds.includes(m.id) ? (isLead ? '#f0f2f5' : '#c6f1bd') : (isLead ? '#ffffff' : '#d9fdd3')),
                      border: 'none',
                      borderRadius: isLead ? '0px 8px 8px 8px' : '8px 0px 8px 8px',
                      padding: '8px 12px 8px 12px',
                      boxShadow: '0 1px 0.5px rgba(11,20,26,.13)',
                      transition: 'all 0.3s ease'
                    }}
                  onClick={() => {
                    if (isSelectMode) {
                      setSelectedMessageIds(prev => prev.includes(m.id) ? prev.filter(id => id !== m.id) : [...prev, m.id]);
                    }
                  }}
                >
                  {!m.is_deleted && !isSelectMode && (
                    <MessageActionsMenu
                      isOpen={activeDropdownId === m.id}
                      onToggle={() => setActiveDropdownId(activeDropdownId === m.id ? null : m.id)}
                      onClose={() => setActiveDropdownId(null)}
                      align={isLead ? 'start' : 'end'}
                    >
                      <button onClick={() => { setReplyingTo(m); setActiveDropdownId(null); }} style={{ background: 'transparent', border: 'none', color: C.text, padding: '10px 16px', textAlign: 'left', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
                        <CornerUpLeft size={16} color={C.muted} /> Reply
                      </button>

                      {((!m.type || m.type === 'text') || (!alliance && Boolean(getMessageText(m)))) && (
                        <button onClick={() => { handleCopy(getMessageText(m)); setActiveDropdownId(null); }} style={{ background: 'transparent', border: 'none', color: C.text, padding: '10px 16px', textAlign: 'left', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
                          <Copy size={16} color={C.muted} /> Copy
                        </button>
                      )}

                      <button onClick={() => { setForwardMessage(m); setActiveDropdownId(null); }} style={{ background: 'transparent', border: 'none', color: C.text, padding: '10px 16px', textAlign: 'left', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
                        <CornerUpRight size={16} color={C.muted} /> Forward
                      </button>

                      {m.media_url && (
                        <button
                          onClick={() => {
                            handleDownloadMedia(m.media_url);
                            setActiveDropdownId(null);
                          }}
                          style={{ background: 'transparent', border: 'none', color: C.text, padding: '10px 16px', textAlign: 'left', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 }}
                        >
                          <Download size={16} color={C.muted} /> Download
                        </button>
                      )}

                      <button onClick={() => { setPinMessageModal(m); setActiveDropdownId(null); }} style={{ background: 'transparent', border: 'none', color: C.text, padding: '10px 16px', textAlign: 'left', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Pin size={16} color={C.muted} /> {m.pinned_until && new Date(m.pinned_until) > new Date() ? 'Unpin' : 'Pin'}
                      </button>

                      <button onClick={() => { handleStar(m.id, !m.is_starred); setActiveDropdownId(null); }} style={{ background: 'transparent', border: 'none', color: C.text, padding: '10px 16px', textAlign: 'left', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Star size={16} color={C.muted} /> {m.is_starred ? 'Unstar' : 'Star'}
                      </button>

                      <div style={{ height: 1, background: C.border, margin: '4px 0' }} />

                      <button onClick={() => { setIsSelectMode(true); setSelectedMessageIds([m.id]); setActiveDropdownId(null); }} style={{ background: 'transparent', border: 'none', color: C.text, padding: '10px 16px', textAlign: 'left', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
                        <CheckSquare size={16} color={C.muted} /> Select
                      </button>

                      {!isLead && (!m.type || m.type === 'text') && (
                        <button onClick={() => { startEdit(m); setActiveDropdownId(null); }} style={{ background: 'transparent', border: 'none', color: C.text, padding: '10px 16px', textAlign: 'left', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
                          <Edit2 size={16} color={C.muted} /> Edit
                        </button>
                      )}

                      <button onClick={() => { setDeleteModalMsg(m); setActiveDropdownId(null); }} style={{ background: 'transparent', border: 'none', color: '#ef4444', padding: '10px 16px', textAlign: 'left', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Trash2 size={16} color="#ef4444" /> Delete
                      </button>
                    </MessageActionsMenu>
                  )}

                  {m.is_deleted ? (
                    <p style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>🚫 This message was deleted</p>
                  ) : editingMessageId === m.id ? (
                    <div style={{ display: 'flex', gap: 5, flexDirection: 'column' }}>
                      <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} style={{ width: '100%', background: C.bg, color: C.text, border: '1px solid ' + C.border, borderRadius: 5, padding: 5, fontSize: 12, minHeight: 40 }} />
                      <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end' }}>
                        <button onClick={() => setEditingMessageId(null)} style={{ background: 'transparent', border: 'none', color: C.muted, fontSize: 11, cursor: 'pointer' }}>Cancel</button>
                        <button onClick={saveEdit} disabled={editSaving} style={{ background: C.accent, border: 'none', color: '#fff', fontSize: 11, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', opacity: editSaving ? 0.6 : 1 }}>
                          {editSaving ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {isLead && (
                        <p style={{
                          fontSize: 11,
                          color: getNameColor(activeObj?.name || 'Contact'),
                          fontWeight: 600,
                          marginBottom: 4,
                          marginTop: 0
                        }}>
                          {activeObj?.name || 'Contact'}
                        </p>
                      )}
                      {isAI && <p style={{ fontSize: 10.5, color: '#15803d', fontWeight: 600, margin: '0 0 2px' }}>AI</p>}
                      {isAutomation && <p style={{ fontSize: 10.5, color: '#15803d', fontWeight: 600, margin: '0 0 2px' }}>Automated reminder</p>}
                      {!isLead && !isAI && !isAutomation && <p style={{ fontSize: 10.5, color: '#475569', fontWeight: 600, margin: '0 0 2px' }}>You</p>}

                      {m.reply_to && (
                        <div style={{ padding: '6px 10px', background: C.bg + '50', borderLeft: `4px solid ${C.accent}`, borderRadius: 4, marginBottom: 6, opacity: 0.8 }}>
                          <span style={{ fontSize: 11, color: C.accent, fontWeight: 600, display: 'block', marginBottom: 2 }}>
                            {m.reply_to.direction === 'inbound' || m.reply_to.from === 'lead' ? 'Contact' : 'You'}
                          </span>
                          <span style={{ fontSize: 11, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                            {m.reply_to.media_url ? '📷 Media message' : getMessageText(m.reply_to)}
                          </span>
                        </div>
                      )}

                      {m.is_forwarded && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: C.muted, fontSize: 11, fontStyle: 'italic', marginBottom: 4 }}>
                          <CornerUpRight size={12} /> Forwarded
                        </div>
                      )}

                      {m.pinned_until && new Date(m.pinned_until) > new Date() && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: C.muted, fontSize: 11, fontWeight: 500, marginBottom: 4 }}>
                          <Pin size={12} /> Pinned
                        </div>
                      )}

                      {m.media_url && (() => {
                        let fullMediaUrl = m.media_url.startsWith('http') ? m.media_url : `${SOCKET_URL}${m.media_url}`;

                        // Proxy WhatsApp Graph API media URLs, passing the LeadOS
                        // lead so the server can use that client's own WhatsApp
                        // token instead of always falling back to the shared one.
                        if (fullMediaUrl.includes('graph.facebook.com')) {
                          const mediaId = fullMediaUrl.split('/').pop();
                          fullMediaUrl = `${SOCKET_URL}/api/whatsapp-media/${mediaId}${!alliance && activeLeadId ? `?leadId=${activeLeadId}` : ''}`;
                        }

                        return (
                          <div style={{ marginBottom: 6 }}>
                            {m.type === 'image' ? (
                                <img
                                  src={fullMediaUrl}
                                  loading="lazy"
                                  decoding="async"
                                  style={{ maxWidth: 280, maxHeight: 280, borderRadius: 6, minHeight: 100, backgroundColor: '#f1f5f9', cursor: 'pointer', objectFit: 'cover', display: 'block' }}
                                alt="attachment"
                                onClick={() => {
                                  const idx = chatImages.findIndex(img => img.id === m.id);
                                  if (idx !== -1) {
                                    setZoomedImageIndex(idx);
                                    setLightboxZoomLevel(1);
                                  }
                                }}
                              />
                            ) : m.type === 'video' ? <video src={fullMediaUrl} controls preload="metadata" style={{ maxWidth: '100%', borderRadius: 6, backgroundColor: '#0f172a' }} />
                                : m.type === 'audio' ? <audio src={fullMediaUrl} controls preload="metadata" style={{ maxWidth: '100%' }} />
                                  : (
                                    <div
                                      onClick={() => window.open(fullMediaUrl, '_blank')}
                                      style={{
                                        background: 'rgba(11, 20, 26, 0.04)',
                                        borderRadius: 8,
                                        padding: 12,
                                        display: 'flex',
                                        gap: 12,
                                        alignItems: 'center',
                                        cursor: 'pointer',
                                        textDecoration: 'none',
                                        transition: 'background 0.2s',
                                        border: '1px solid rgba(11, 20, 26, 0.08)'
                                      }}
                                      onMouseOver={(e) => e.currentTarget.style.background = 'rgba(11, 20, 26, 0.08)'}
                                      onMouseOut={(e) => e.currentTarget.style.background = 'rgba(11, 20, 26, 0.04)'}
                                    >
                                      <div style={{ background: '#027eb5', borderRadius: 6, width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
                                        <FileText size={20} />
                                      </div>
                                      <div style={{ flex: 1, overflow: 'hidden' }}>
                                        <div style={{ fontWeight: 600, fontSize: 14, color: '#111b21', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                          {mediaFileName(fullMediaUrl) || 'Document'}
                                        </div>
                                        <div style={{ fontSize: 11, color: '#667781', marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
                                          <span>{mediaFileName(fullMediaUrl).split('.').pop().toUpperCase().substring(0,4)}</span>
                                          <span>•</span>
                                          <span>Open file</span>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                          </div>
                        );
                      })()}

                      <div style={{ display: 'block', minWidth: '70px', position: 'relative' }}>
                        {(m.type === 'template' || m.msg_type === 'template') && (
                          <div style={{ fontSize: 10.5, fontWeight: 600, color: '#166534', marginBottom: 2, display: 'inline-flex', alignItems: 'center', gap: 4, paddingRight: 24 }}>
                            <FileText size={11} /> Template{m.template_name ? ` · ${m.template_name}` : ''}
                          </div>
                        )}
                        <span style={{ fontSize: '14.2px', color: '#111b21', whiteSpace: 'pre-wrap', lineHeight: '19px', wordBreak: 'break-word' }}>
                          {renderMessageWithLinks(getMessageText(m))}
                        </span>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          float: 'right',
                          margin: '6px 0 -4px 8px',
                          position: 'relative',
                          top: 2,
                          userSelect: 'none'
                        }}>
                          <span style={{ fontSize: 10, color: '#667781' }}>
                            {isSending ? 'sending…' : new Date(m.timestamp || m.sent_at || m.time || new Date())
                              .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
                              .toLowerCase()}
                          </span>
                          {!isLead && !isSending && (
                            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                              {m.status === 'failed' ? (
                                <span style={{ color: '#ef4444', fontSize: 11, fontWeight: 'bold' }}>✕</span>
                              ) : m.status === 'sent' ? (
                                <Check size={13} style={{ color: '#8696a0' }} />
                              ) : (
                                <span style={{ color: (m.status === 'read' || m.status === 'seen') ? '#53bdeb' : '#8696a0', display: 'inline-flex' }}>
                                  <Check size={13} style={{ marginRight: -6 }} />
                                  <Check size={13} />
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                        {/* Clear float to prevent collapse */}
                        <div style={{ clear: 'both' }} />
                      </div>
                      {Array.isArray(m.template_buttons) && m.template_buttons.length > 0 && (
                        <div style={{ margin: '9px -12px -8px -12px', borderTop: '1px solid #e9edef' }}>
                          {m.template_buttons.map((button, buttonIndex) => {
                            const type = String(button.type || '').toUpperCase();
                            const label = button.text || (type === 'URL' ? 'Open link' : type === 'PHONE_NUMBER' ? 'Call' : 'Reply');
                            const href = type === 'URL' && /^https?:\/\//i.test(String(button.url || ''))
                              ? button.url
                              : type === 'PHONE_NUMBER' && button.phone_number
                                ? `tel:${String(button.phone_number).replace(/[^+\d]/g, '')}`
                                : null;
                            const ButtonTag = href ? 'a' : 'div';
                            return (
                              <ButtonTag
                                key={`${type}-${label}-${buttonIndex}`}
                                href={href || undefined}
                                target={type === 'URL' ? '_blank' : undefined}
                                rel={type === 'URL' ? 'noopener noreferrer' : undefined}
                                style={{ minHeight: 40, padding: '10px 12px', borderTop: buttonIndex ? '1px solid #e9edef' : 'none', color: '#0a8576', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontSize: 14, fontWeight: 500, textDecoration: 'none', cursor: href ? 'pointer' : 'default', background: 'transparent' }}
                              >
                                {type === 'URL' ? <ExternalLink size={14} /> : type === 'PHONE_NUMBER' ? <Phone size={14} /> : <CornerUpLeft size={14} />}
                                {label}
                              </ButtonTag>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}

                  {m.is_starred && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4, paddingRight: 4 }}>
                      <Star size={11} fill={C.muted} color={C.muted} style={{ opacity: 0.8 }} />
                    </div>
                  )}

                  {/* Reaction Bubbles */}
                  {m.reactions && Object.keys(m.reactions).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                      {Object.entries(m.reactions).map(([emoji, count]) => {
                        const isMyReaction = userReactions[m.id] === emoji;
                        return (
                          <button
                            key={emoji}
                            onClick={() => handleReact(m.id, emoji)}
                            title={isMyReaction ? 'Remove your reaction' : 'React with ' + emoji}
                            style={{
                              background: isMyReaction ? C.accent + '22' : C.bg,
                              border: `1.5px solid ${isMyReaction ? C.accent : C.border}`,
                              borderRadius: 12,
                              padding: '2px 7px',
                              fontSize: 13,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              color: C.text,
                              transition: 'all 0.15s'
                            }}
                          >
                            {emoji} <span style={{ fontSize: 10, color: isMyReaction ? C.accent : C.muted, fontWeight: isMyReaction ? 600 : 400 }}>{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Single Emoji Trigger Button (shows on hover) */}
                {activeDropdownId !== m.id && !isSelectMode && !m.is_deleted && !isSending && (
                  <button
                    type="button"
                    className="wa-hover"
                    data-open={activeReactBarMsgId === m.id ? 'true' : 'false'}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveReactBarMsgId(activeReactBarMsgId === m.id ? null : m.id);
                    }}
                    style={{
                      position: 'absolute',
                      [isLead ? 'left' : 'right']: '100%',
                      [isLead ? 'marginLeft' : 'marginRight']: 8,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: C.card,
                      border: '1.5px solid ' + C.border,
                      borderRadius: '50%',
                      width: 32,
                      height: 32,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                      zIndex: 15,
                      color: C.muted,
                      transition: 'all 0.2s',
                    }}
                    onMouseOver={e => e.currentTarget.style.color = C.text}
                    onMouseOut={e => e.currentTarget.style.color = C.muted}
                    title="React to message"
                  >
                    <Smile size={16} />
                  </button>
                )}

                {/* Emoji Quick-Reaction Bar (shows on trigger click) */}
                {activeReactBarMsgId === m.id && !isSelectMode && !m.is_deleted && !isSending && (
                  <div
                    style={{
                      position: 'absolute',
                      [isLead ? 'left' : 'right']: 0,
                      bottom: 'calc(100% - 8px)',
                      paddingBottom: 10,
                      background: 'transparent',
                      zIndex: 30,
                      whiteSpace: 'nowrap'
                    }}
                    onMouseLeave={() => { setActiveReactBarMsgId(null); setShowFullReactionPicker(null); }}
                  >
                    <div style={{
                      background: C.card,
                      border: '1px solid ' + C.border,
                      borderRadius: 24,
                      padding: '5px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                    }}>
                      {['👍', '❤️', '😂', '😮', '😢', '🙏'].map(emoji => (
                        <button
                          key={emoji}
                          onClick={() => handleReact(m.id, emoji)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            fontSize: 20,
                            cursor: 'pointer',
                            padding: '2px 3px',
                            borderRadius: 6,
                            transition: 'transform 0.15s',
                            lineHeight: 1
                          }}
                          onMouseOver={e => e.currentTarget.style.transform = 'scale(1.4)'}
                          onMouseOut={e => e.currentTarget.style.transform = 'scale(1)'}
                          title={emoji}
                        >
                          {emoji}
                        </button>
                      ))}
                      {/* Full Picker Button */}
                      <div style={{ position: 'relative' }}>
                        <button
                          onClick={() => setShowFullReactionPicker(showFullReactionPicker === m.id ? null : m.id)}
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.muted, padding: '2px 4px', fontSize: 18, display: 'flex', alignItems: 'center' }}
                          title="More emojis"
                        >
                          ＋
                        </button>
                        {showFullReactionPicker === m.id && (
                          <div style={{ position: 'absolute', bottom: '100%', [isLead ? 'left' : 'right']: 0, zIndex: 100, marginBottom: 8 }}>
                            <EmojiPicker
                              onEmojiClick={(emojiObj) => handleReact(m.id, emojiObj.emoji)}
                              theme="light"
                              searchDisabled={false}
                              height={350}
                              width={300}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

                  </div>
                );
              }}
              followOutput="smooth"
            />
          )}
        </div>

        {/* Action Bar (Select Mode) or Input */}
        {isSelectMode ? (
          <div style={{ padding: '10px 16px', background: BAR_BG, borderTop: '1px solid ' + LINE, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <button onClick={() => { setIsSelectMode(false); setSelectedMessageIds([]); }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.text, display: 'flex' }}>
                <X size={24} />
              </button>
              <span style={{ fontSize: 16, color: C.text, fontWeight: 500 }}>
                {selectedMessageIds.length} selected
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <button style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.muted, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <Star size={20} />
              </button>
              <button style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.muted, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <Trash2 size={20} />
              </button>
              <button
                onClick={() => {
                  if (selectedMessageIds.length > 0) {
                    setForwardMessage({ isBulk: true, messages: selectedMessageIds });
                  }
                }}
                style={{ background: 'transparent', border: 'none', cursor: selectedMessageIds.length > 0 ? 'pointer' : 'not-allowed', color: selectedMessageIds.length > 0 ? C.text : C.muted, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
              >
                <CornerUpRight size={20} />
              </button>
              <button style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.muted, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <Download size={20} />
              </button>
            </div>
          </div>
        ) : (
          <>
            {replyingTo && (
              <div style={{ padding: '8px 14px', background: C.card, borderTop: '1px solid ' + C.border, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderLeft: `5px solid ${C.accent}`, margin: '0 10px', borderRadius: '4px 4px 0 0', position: 'relative', top: 5, zIndex: 1 }}>
                <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <span style={{ fontSize: 13, color: C.accent, fontWeight: 600 }}>
                    {replyingTo.direction === 'inbound' || replyingTo.from === 'lead' ? 'Contact' : 'You'}
                  </span>
                  <span style={{ fontSize: 12, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '300px' }}>
                    {replyingTo.media_url ? '📷 Media message' : getMessageText(replyingTo)}
                  </span>
                </div>
                <button onClick={() => setReplyingTo(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.text, padding: 5 }}><X size={16} /></button>
              </div>
            )}

            {windowKnown && !windowHoursLeft && (
              <div style={{ padding: '8px 14px', borderTop: '1px solid ' + LINE, background: '#fffbeb', color: '#92400e', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Clock size={14} style={{ flexShrink: 0 }} />
                <span>More than 24 hours since this customer last wrote. Meta allows only an approved template: sending now sends the reopen template first, and you can reply freely once they answer.</span>
              </div>
            )}
            <form onSubmit={handleSend} style={{ padding: '10px 12px', borderTop: '1px solid ' + LINE, background: BAR_BG, display: 'flex', gap: 6, position: 'relative', alignItems: 'flex-end' }}>
              <input type="file" ref={fileInputRef} multiple style={{ display: 'none' }} onChange={handleFileChange} />

              {/* While recording, the recorder takes the whole bar (as in the admin chat). */}
              {!isRecording && (<>
              <div style={{ position: 'relative' }}>
                {showEmojiPicker && (
                  <div style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 10, zIndex: 100 }}>
                    <EmojiPicker
                      onEmojiClick={(emojiObject) => {
                        setMsg(prev => prev + emojiObject.emoji);
                      }}
                      theme="light"
                      searchDisabled
                    />
                  </div>
                )}
                <button type="button" onClick={() => setShowEmojiPicker(!showEmojiPicker)} style={{ background: 'transparent', border: 'none', width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} title="Add Emoji">
                  <Smile size={22} color={showEmojiPicker ? '#15803d' : '#667781'} />
                </button>
              </div>

              <div style={{ position: 'relative' }}>
                {showAttachMenu && (
                  <div style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 10, background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 6, display: 'flex', flexDirection: 'column', gap: 2, zIndex: 10, minWidth: 224, boxShadow: '0 12px 32px rgba(0,0,0,0.18)' }}>
                    {[
                      { label: 'Document', color: '#8b5cf6', accept: DOCUMENT_ACCEPT, icon: <FileText size={16} color="#fff" /> },
                      { label: 'Photos & videos', color: '#3b82f6', accept: 'image/jpeg,image/png,image/webp,video/mp4,video/3gpp', icon: <Image size={16} color="#fff" /> },
                      { label: 'Camera', color: '#ec4899', camera: true, icon: <Camera size={16} color="#fff" /> },
                      { label: 'Audio', color: '#f97316', accept: '.mp3,.m4a,.aac,.amr,.ogg,.opus,audio/mpeg,audio/mp4,audio/aac,audio/amr,audio/ogg', icon: <Music size={16} color="#fff" /> },
                    ].map((opt) => (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() => handleAttachOptionClick(opt)}
                        style={{ background: 'transparent', border: 'none', color: C.text, padding: '8px 10px', textAlign: 'left', borderRadius: 8, cursor: 'pointer', fontSize: 14, display: 'flex', gap: 12, alignItems: 'center' }}
                        onMouseOver={(e) => e.currentTarget.style.background = C.bg}
                        onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <span style={{ width: 32, height: 32, borderRadius: '50%', background: opt.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{opt.icon}</span> {opt.label}
                      </button>
                    ))}
                  </div>
                )}
                <button type="button" onClick={() => setShowAttachMenu(!showAttachMenu)} style={{ background: 'transparent', border: 'none', width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} title="Attach File">
                  <Plus size={22} color={'#667781'} style={{ transition: 'transform .15s', transform: showAttachMenu ? 'rotate(45deg)' : 'none' }} />
                </button>
              </div>

              {alliance && (
                <button
                  type="button"
                  onClick={handleAllianceSuggestion}
                  disabled={suggestingReply || !activeLeadId}
                  style={{ background: 'transparent', border: 'none', width: 42, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: suggestingReply ? 'wait' : 'pointer', opacity: suggestingReply ? .65 : 1 }}
                  title="Generate AI reply suggestion"
                >
                  <Sparkles size={24} color="#e0b52f" />
                </button>
              )}
              </>)}

              {isRecording ? (
                <VoiceRecorder onCancel={() => setIsRecording(false)} onSend={sendVoice} onError={(message) => toast.error(message)} />
              ) : (
                <textarea
                  value={msg}
                  onChange={(e) => {
                    setMsg(e.target.value);
                    e.target.style.height = '40px';
                    e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (msg.trim()) {
                        handleSend(e);
                        e.target.style.height = '40px';
                      }
                    }
                  }}
                  onPaste={(e) => {
                    if (e.clipboardData?.files?.length > 0) {
                      e.preventDefault();
                      addFiles(e.clipboardData.files);
                    }
                  }}
                  placeholder="Type a message"
                  style={{ 
                    flex: 1, 
                    background: '#ffffff', 
                    border: '1px solid #e2e8f0', 
                    borderRadius: 8, 
                    padding: '10px 14px', 
                    color: '#111b21', 
                    fontSize: 14, 
                    outline: 'none',
                    resize: 'none',
                    fontFamily: 'inherit',
                    lineHeight: '20px',
                    height: '40px',
                    maxHeight: '150px',
                    overflowY: 'auto',
                    boxSizing: 'border-box'
                  }}
                />
              )}

              {isRecording ? null : !msg.trim() && !sending ? (
                <button type="button" onClick={() => { setShowEmojiPicker(false); setShowAttachMenu(false); setIsRecording(true); }} title="Record a voice message" aria-label="Record a voice message" style={{ background: '#25D366', border: 'none', width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, color: '#fff' }}>
                  <Mic size={20} color="#fff" />
                </button>
              ) : (
                <button type="submit" disabled={sending || isRecording} aria-label="Send" style={{ background: '#25D366', border: 'none', width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, color: '#fff', opacity: (sending || isRecording) ? 0.6 : 1 }}>
                  <Send size={20} color="#fff" />
                </button>
              )}
            </form>
          </>
        )}
          </div>

          {/* Message Search Side Panel */}
          {showMessageSearchPanel && (
            <div style={{ width: 340, borderLeft: '1px solid ' + C.border, background: C.card, display: 'flex', flexDirection: 'column', zIndex: 10, flexShrink: 0 }}>
              {/* Panel Header */}
              <div style={{ padding: '16px 18px', borderBottom: '1px solid ' + C.border, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.text }}>
                  <Search size={16} />
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Search messages</span>
                </div>
                <button
                  onClick={() => { setShowMessageSearchPanel(false); setMessageSearchQuery(''); }}
                  style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: 4, display: 'flex' }}
                >
                  <X size={18} />
                </button>
              </div>

              {/* Panel Search Input */}
              <div style={{ padding: '14px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.bg, border: '1px solid ' + C.border, borderRadius: 8, padding: '8px 12px' }}>
                  <Search size={14} color={C.muted} />
                  <input
                    value={messageSearchQuery}
                    onChange={(e) => setMessageSearchQuery(e.target.value)}
                    placeholder="Search..."
                    style={{ background: 'transparent', border: 'none', color: C.text, fontSize: 13, outline: 'none', width: '100%' }}
                  />
                  {messageSearchQuery && (
                    <button
                      onClick={() => setMessageSearchQuery('')}
                      style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: 2, display: 'flex' }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Panel Results List */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '0 18px 18px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {messageSearchQuery.trim() === '' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: C.muted, textAlign: 'center', padding: '0 20px', gap: 10 }}>
                    <Search size={24} style={{ opacity: 0.5 }} />
                    <p style={{ fontSize: 13, margin: 0 }}>Search for messages within this chat.</p>
                  </div>
                ) : (() => {
                  const query = messageSearchQuery.trim().toLowerCase();
                  const results = localMessages.filter(m =>
                    !m.is_deleted &&
                    !m.id?.toString().startsWith('optimistic-') &&
                    (m.content || '').toLowerCase().includes(query)
                  );

                  if (results.length === 0) {
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: C.muted, textAlign: 'center', padding: '0 20px' }}>
                        <p style={{ fontSize: 13 }}>No messages found matching "{messageSearchQuery}"</p>
                      </div>
                    );
                  }

                  const highlightText = (text, q) => {
                    if (!q) return text;
                    const parts = text.split(new RegExp(`(${q})`, 'gi'));
                    return parts.map((part, idx) =>
                      part.toLowerCase() === q.toLowerCase()
                        ? <span key={idx} style={{ background: '#eab308', color: '#000', padding: '0 2px', borderRadius: 2, fontWeight: 600 }}>{part}</span>
                        : part
                    );
                  };

                  return results.map((m) => {
                    const isLeadMsg = m.direction === 'inbound' || m.from === 'lead';
                    const timeStr = m.timestamp || m.sent_at || m.time;
                    const dateFormatted = timeStr ? new Date(timeStr).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
                    return (
                      <div
                        key={m.id}
                        onClick={() => focusSearchResult(m)}
                        style={{
                          background: C.card,
                          border: '1px solid ' + C.border,
                          borderRadius: 8,
                          padding: '12px 14px',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4
                        }}
                        onMouseOver={e => e.currentTarget.style.borderColor = C.accent}
                        onMouseOut={e => e.currentTarget.style.borderColor = C.border}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: isLeadMsg ? C.accent : C.text }}>
                            {isLeadMsg ? (activeObj?.name || 'Contact') : 'You'}
                          </span>
                          <span style={{ fontSize: 10, color: C.muted }}>{dateFormatted}</span>
                        </div>
                        <p style={{ margin: 0, fontSize: 12, color: C.text, wordBreak: 'break-word', lineHeight: 1.4 }}>
                          {highlightText(m.content || '', query)}
                        </p>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}

          {/* Contact Info Side Panel */}
          {showContactInfoPanel && (
            <div style={{ width: 340, borderLeft: '1px solid ' + C.border, background: C.card, display: 'flex', flexDirection: 'column', zIndex: 10, flexShrink: 0 }}>
              <div style={{ padding: '16px 18px', borderBottom: '1px solid ' + C.border, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <button onClick={() => setShowContactInfoPanel(false)} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: 0, display: 'flex' }}>
                    <X size={20} />
                  </button>
                  <span style={{ fontSize: 16, fontWeight: 600, color: C.text }}>Contact info</span>
                </div>
                <button
                  onClick={() => {
                    setEditContactData({ ...activeObj });
                    setShowEditContactModal(true);
                  }}
                  style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: 0, display: 'flex' }}
                  title="Edit Contact"
                >
                  <Edit2 size={18} />
                </button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto' }}>
                <div style={{ padding: '24px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', borderBottom: '1px solid ' + C.border }}>
                  <div style={{ width: 100, height: 100, borderRadius: '50%', background: C.bg, border: '1px solid ' + C.border, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                  <User size={48} color={C.muted} />
                </div>
                <h2 style={{ margin: '0 0 8px 0', fontSize: 20, fontWeight: 600, color: C.text }}>{activeObj?.name}</h2>
                <p style={{ margin: 0, fontSize: 14, color: C.muted }}>{activeObj?.phone || '+1 234 567 8900'}</p>

                <div style={{ display: 'flex', gap: 24, marginTop: 24 }}>
                  <a
                    href={`tel:${(activeObj?.phone || '').replace(/\D/g, '')}`}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textDecoration: 'none', cursor: 'pointer' }}
                    title={`Call ${activeObj?.phone}`}
                  >
                    <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#22c55e22', border: '1px solid #22c55e55', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
                      <Phone size={20} color='#22c55e' />
                    </div>
                    <span style={{ fontSize: 12, color: C.text }}>Voice</span>
                  </a>
                  <a
                    href={`https://wa.me/${(activeObj?.phone || '').replace(/\D/g, '')}?videocall=1`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textDecoration: 'none', cursor: 'pointer' }}
                    title={`Video call ${activeObj?.phone}`}
                  >
                    <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#3b82f622', border: '1px solid #3b82f655', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
                      <Video size={20} color='#3b82f6' />
                    </div>
                    <span style={{ fontSize: 12, color: C.text }}>Video</span>
                  </a>
                  <button
                    onClick={() => {
                      setShowContactInfoPanel(false);
                      setShowMessageSearchPanel(true);
                      setMessageSearchQuery('');
                    }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', cursor: 'pointer' }}
                  >
                    <div style={{ width: 44, height: 44, borderRadius: '50%', background: C.bg, border: '1px solid ' + C.border, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Search size={20} color={C.text} />
                    </div>
                    <span style={{ fontSize: 12, color: C.text }}>Search</span>
                  </button>
                </div>
              </div>

              {/* SalesOS Lead Details Section */}
              <div style={{ padding: '16px 18px', borderBottom: '1px solid ' + C.border }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 600, color: C.text }}>SalesOS Details</h3>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: C.muted, fontSize: 13 }}>Lead Score</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: (activeObj?.score > 50) ? '#10b981' : C.text }}>{activeObj?.score || 0}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: C.muted, fontSize: 13 }}>Stage</span>
                  <span style={{ color: C.text, fontSize: 12, fontWeight: 500, padding: '2px 8px', background: C.bg, borderRadius: 12, border: '1px solid ' + C.border }}>{activeObj?.stage || 'NEW'}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: C.muted, fontSize: 13 }}>Owner</span>
                  <span style={{ color: C.text, fontSize: 13, fontWeight: 500 }}>{activeObj?.owner || 'AI Bot'}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: C.muted, fontSize: 13 }}>Objections</span>
                  <span style={{ color: C.text, fontSize: 13, fontWeight: 500, maxWidth: '60%', textAlign: 'right' }}>{activeObj?.objections || 'None'}</span>
                </div>

                {/* --- TAGS SECTION --- */}
                  <div style={{ marginTop: 20, borderTop: '1px solid ' + C.border, paddingTop: 16, paddingBottom: showTagMenu ? 260 : 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ color: C.text, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Tag size={14} style={{ color: C.muted }} /> Tags

                      </span>
                      <div ref={tagMenuRef} style={{ position: 'relative' }}>
                        <button onClick={() => setShowTagMenu(!showTagMenu)} style={{ background: 'transparent', border: 'none', color: C.accent, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600 }}>
                          <Plus size={14} /> Add Tag
                        </button>
                        {showTagMenu && (
                          <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 8, width: 220, background: C.card, border: '1px solid ' + C.border, borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 100, padding: 10 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: 'uppercase' }}>Select Tag</div>
                            <div style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                              {(availableTags || []).length === 0 && <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>No tags yet.</div>}
                              {(availableTags || []).filter(t => !(activeObj?.tags || []).find(at => at.id === t.id)).map(tag => (
                                <div key={tag.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', width: '100%', gap: 8 }}>
                                  <button onClick={async () => {
                                    // Optimistic UI Update
                                    if (!activeObj.tags) activeObj.tags = [];
                                    activeObj.tags.push(tag);
                                    setTagUpdateTick(t => t + 1);
                                    setShowTagMenu(false);
                                    
                                    try {
                                      await inboxApi.assignTag(activeObj.id, tag.id);
                                      refetchLeadsList(); // refresh the list to show tags in sidebar
                                    } catch(e) { console.error(e); }
                                  }} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', flex: 1 }}>
                                    <Tag size={12} style={{ color: tag.color }} />
                                    <span style={{ fontSize: 13, color: C.text }}>{tag.name}</span>
                                  </button>
                                  <button onClick={async () => {
                                    if(window.confirm(`Are you sure you want to permanently delete the "${tag.name}" tag from the workspace?`)) {
                                      try {
                                        await tagApi.deleteTag(tag.id);
                                        setAvailableTags(tags => tags.filter(t => t.id !== tag.id));
                                        refetchLeadsList(); // update sidebar tags if any were removed
                                      } catch(e) { console.error(e); }
                                    }
                                  }} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', display: 'flex', alignItems: 'center' }} title="Delete tag">
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              ))}
                            </div>
                            <div style={{ borderTop: '1px solid ' + C.border, paddingTop: 10 }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: 'uppercase' }}>Create New Tag</div>
                              <input value={newTagName} onChange={e => setNewTagName(e.target.value)} placeholder="Tag name..." style={{ width: '100%', background: C.bg, border: '1px solid ' + C.border, padding: '6px 8px', borderRadius: 4, color: C.text, fontSize: 12, marginBottom: 8, outline: 'none' }} />
                              <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                                {['#e11d48', '#2563eb', '#16a34a', '#ca8a04', '#9333ea', '#0891b2', '#ea580c', '#475569'].map(c => (
                                  <div key={c} onClick={() => setNewTagColor(c)} style={{ width: 16, height: 16, borderRadius: '50%', background: c, cursor: 'pointer', border: newTagColor === c ? '2px solid #fff' : '2px solid transparent', boxShadow: newTagColor === c ? '0 0 0 1px ' + c : 'none' }}></div>
                                ))}
                              </div>
                              <button disabled={!newTagName.trim()} onClick={async () => {
                                try {
                                  const newTag = await tagApi.createTag(newTagName, newTagColor);
                                  setAvailableTags([...(availableTags || []), newTag]);
                                  
                                  // Optimistic assignment
                                  if (!activeObj.tags) activeObj.tags = [];
                                  activeObj.tags.push(newTag);
                                  setTagUpdateTick(t => t + 1);
                                  
                                  setNewTagName('');
                                  setShowTagMenu(false);
                                  
                                  // Background assign & fetch
                                  await inboxApi.assignTag(activeObj.id, newTag.id);
                                  refetchLeadsList();
                                } catch(e) { console.error(e); }
                              }} style={{ width: '100%', background: C.accent, color: '#fff', border: 'none', padding: '6px', borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: newTagName.trim() ? 'pointer' : 'not-allowed', opacity: newTagName.trim() ? 1 : 0.5 }}>
                                Create & Assign
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {(!activeObj?.tags || activeObj.tags.length === 0) && (
                        <div style={{ fontSize: 12, color: C.dim, fontStyle: 'italic' }}>No tags assigned</div>
                      )}
                      {(activeObj?.tags || []).map(tag => (
                        <div key={tag.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: tag.color + '22', border: '1px solid ' + tag.color + '44', padding: '4px 8px', borderRadius: 12 }}>
                          <Tag size={12} style={{ color: tag.color }} />
                          <span style={{ fontSize: 11, fontWeight: 600, color: tag.color }}>{tag.name}</span>
                          <X size={12} style={{ color: tag.color, cursor: 'pointer', opacity: 0.7 }} onClick={async () => {
                            // Optimistic removal
                            if (activeObj.tags) {
                              activeObj.tags = activeObj.tags.filter(t => t.id !== tag.id);
                              setTagUpdateTick(t => t + 1);
                            }
                            try {
                              await inboxApi.removeTag(activeObj.id, tag.id);
                              refetchLeadsList();
                            } catch(e) { console.error(e); }
                          }} />
                        </div>
                      ))}
                    </div>
                  </div>
                {/* --- END TAGS SECTION --- */}
              </div>


              <div style={{ padding: '18px' }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 600, color: C.text }}>About</h3>
                <p style={{ margin: 0, fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
                  {activeObj?.interest ? `Interest: ${activeObj.interest}` : 'No additional information available.'}
                </p>
                {activeObj?.email && (
                  <p style={{ margin: '8px 0 0 0', fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
                    Email: {activeObj.email}
                  </p>
                )}
                <p style={{ margin: '8px 0 0 0', fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
                  Brand: {activeObj?.brand_name || activeObj?.brand || 'Manual'}
                </p>
              </div>
            </div>
          </div>
        )}
        </div>
        </>)}
      </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteModalMsg && (() => {
        const isMsgLead = deleteModalMsg.direction === 'inbound' || deleteModalMsg.from === 'lead';
        return (
          <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: C.card, padding: 24, borderRadius: 12, width: 340, boxShadow: '0 8px 32px rgba(0,0,0,0.2)', border: '1px solid ' + C.border }}>
              <h3 style={{ margin: '0 0 10px 0', color: C.text, fontSize: 18, fontWeight: 600 }}>Delete Message?</h3>
              <p style={{ margin: '0 0 20px 0', color: C.muted, fontSize: 14, lineHeight: 1.5 }}>
                {isMsgLead
                  ? 'This message will be hidden from your chat view. The contact will still be able to see it.'
                  : 'Choose whether you want to delete this message only for yourself or for everyone.'}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {!isMsgLead && (
                  <button
                    onClick={async () => {
                      try {
                        await inboxApi.deleteMessage(deleteModalMsg.id);
                        setDeleteModalMsg(null);
                      } catch (e) {
                        alert("Failed to delete for everyone");
                      }
                    }}
                    style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: C.red || '#ef4444', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
                  >
                    Delete for everyone
                  </button>
                )}
                <button
                  onClick={() => {
                    hideMessageForMe(deleteModalMsg.id);
                    setDeleteModalMsg(null);
                  }}
                  style={{ padding: '10px 16px', borderRadius: 8, border: '1px solid ' + C.border, background: isMsgLead ? (C.red || '#ef4444') : 'transparent', color: isMsgLead ? '#fff' : C.text, cursor: 'pointer', fontWeight: 500, fontSize: 14 }}
                >
                  Delete for me
                </button>
                <button
                  onClick={() => setDeleteModalMsg(null)}
                  style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: 'transparent', color: C.muted, cursor: 'pointer', fontWeight: 500, fontSize: 14 }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Pin Duration Modal */}
      {pinMessageModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: C.card, borderRadius: 12, width: '100%', maxWidth: 400, boxShadow: '0 8px 32px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '24px 24px 12px 24px' }}>
              <h3 style={{ margin: '0 0 8px 0', color: C.text, fontSize: 18, fontWeight: 600 }}>
                {pinMessageModal.pinned_until && new Date(pinMessageModal.pinned_until) > new Date() ? 'Unpin message' : 'Choose how long your pin lasts'}
              </h3>
              <p style={{ margin: 0, color: C.muted, fontSize: 14 }}>
                {pinMessageModal.pinned_until && new Date(pinMessageModal.pinned_until) > new Date() ? 'This message will no longer be pinned for anyone in the chat.' : 'You can unpin at any time.'}
              </p>
            </div>

            {!(pinMessageModal.pinned_until && new Date(pinMessageModal.pinned_until) > new Date()) && (
              <div style={{ padding: '12px 24px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', margin: '10px 0' }}>
                  <input type="radio" name="pin_duration" value="24" checked={pinDuration === 24} onChange={() => setPinDuration(24)} style={{ accentColor: C.accent, width: 18, height: 18 }} />
                  <span style={{ color: C.text, fontSize: 15 }}>24 hours</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', margin: '10px 0' }}>
                  <input type="radio" name="pin_duration" value="168" checked={pinDuration === 168} onChange={() => setPinDuration(168)} style={{ accentColor: C.accent, width: 18, height: 18 }} />
                  <span style={{ color: C.text, fontSize: 15 }}>7 days</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', margin: '10px 0' }}>
                  <input type="radio" name="pin_duration" value="720" checked={pinDuration === 720} onChange={() => setPinDuration(720)} style={{ accentColor: C.accent, width: 18, height: 18 }} />
                  <span style={{ color: C.text, fontSize: 15 }}>30 days</span>
                </label>
              </div>
            )}

            <div style={{ padding: 24, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button
                onClick={() => setPinMessageModal(null)}
                style={{ background: 'transparent', border: 'none', color: C.accent, fontSize: 15, fontWeight: 500, cursor: 'pointer', padding: '8px 16px' }}
              >
                Cancel
              </button>
              <button
                onClick={handlePin}
                disabled={pinning}
                style={{ background: C.accent, color: '#fff', border: 'none', borderRadius: 24, fontSize: 15, fontWeight: 500, cursor: pinning ? 'not-allowed' : 'pointer', padding: '8px 24px', opacity: pinning ? 0.7 : 1 }}
              >
                {pinMessageModal.pinned_until && new Date(pinMessageModal.pinned_until) > new Date() ? 'Unpin' : 'Pin'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Forward Modal */}
      {forwardMessage && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: C.card, borderRadius: 12, width: '100%', maxWidth: 400, boxShadow: '0 8px 32px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}>
            <div style={{ padding: 16, borderBottom: '1px solid ' + C.border, display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={() => { setForwardMessage(null); setSelectedForwardLeads([]); setForwardSearch(''); }} style={{ background: 'transparent', border: 'none', color: C.text, cursor: 'pointer', padding: 4, display: 'flex' }}><X size={20} /></button>
              <h3 style={{ margin: 0, color: C.text, fontSize: 16, fontWeight: 600 }}>Forward message to</h3>
            </div>
            <div style={{ padding: 12, borderBottom: '1px solid ' + C.border }}>
              <div style={{ background: C.bg, borderRadius: 20, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10, border: '1px solid ' + C.border }}>
                <Search size={16} color={C.muted} />
                <input
                  type="text"
                  placeholder="Search name or number"
                  value={forwardSearch}
                  onChange={(e) => setForwardSearch(e.target.value)}
                  style={{ background: 'transparent', border: 'none', color: C.text, outline: 'none', width: '100%', fontSize: 14 }}
                />
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 0' }}>
              <p style={{ padding: '0 16px 10px', margin: 0, color: C.muted, fontSize: 13, fontWeight: 500 }}>Recent chats</p>
              {leads?.filter(l => l.name.toLowerCase().includes(forwardSearch.toLowerCase()) || l.phone.includes(forwardSearch)).map(lead => {
                const isSelected = selectedForwardLeads.includes(lead.id);
                return (
                  <div
                    key={lead.id}
                    onClick={() => setSelectedForwardLeads(prev => isSelected ? prev.filter(id => id !== lead.id) : [...prev, lead.id])}
                    style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', background: isSelected ? C.bg : 'transparent' }}
                    onMouseOver={(e) => e.currentTarget.style.background = isSelected ? C.bg : C.bg + '55'}
                    onMouseOut={(e) => e.currentTarget.style.background = isSelected ? C.bg : 'transparent'}
                  >
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: C.accent + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.accent, fontWeight: 600, flexShrink: 0 }}>
                      {lead.name?.[0]}
                    </div>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ color: C.text, fontSize: 15, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lead.name}</div>
                      <div style={{ color: C.muted, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lead.phone}</div>
                    </div>
                    <div style={{ width: 22, height: 22, borderRadius: 4, border: `2px solid ${isSelected ? C.accent : C.muted}`, background: isSelected ? C.accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {isSelected && <Check size={16} color="#fff" strokeWidth={3} />}
                    </div>
                  </div>
                );
              })}
            </div>
            {selectedForwardLeads.length > 0 && (
              <div style={{ padding: 16, borderTop: '1px solid ' + C.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.bg }}>
                <span style={{ color: C.text, fontSize: 14 }}>{selectedForwardLeads.length} selected</span>
                <button
                  onClick={handleForward}
                  disabled={forwarding}
                  style={{ background: C.accent, color: '#fff', border: 'none', borderRadius: 50, width: 46, height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: forwarding ? 'not-allowed' : 'pointer', opacity: forwarding ? 0.7 : 1, boxShadow: '0 4px 10px rgba(0,0,0,0.2)' }}
                >
                  <Send size={20} style={{ marginLeft: 3 }} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Lightbox Modal */}
      {zoomedImageIndex !== null && chatImages[zoomedImageIndex] && (() => {
        const currentImgUrl = chatImages[zoomedImageIndex].media_url.startsWith('http') ? chatImages[zoomedImageIndex].media_url : `${SOCKET_URL}${chatImages[zoomedImageIndex].media_url}`;

        return (
          <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.95)', zIndex: 9999, display: 'flex', flexDirection: 'column', userSelect: 'none' }}>
            {/* Top Toolbar */}
            <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <button onClick={() => setZoomedImageIndex(null)} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex' }} title="Close (Esc)">
                  <X size={28} />
                </button>
                <div style={{ color: '#fff', fontSize: 16, fontWeight: 500 }}>
                  Image {zoomedImageIndex + 1} of {chatImages.length}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                <button onClick={() => setLightboxZoomLevel(Math.max(0.5, lightboxZoomLevel - 0.25))} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex' }} title="Zoom Out">
                  <ZoomOut size={24} />
                </button>
                <span style={{ color: '#fff', fontSize: 14, minWidth: 40, textAlign: 'center' }}>{Math.round(lightboxZoomLevel * 100)}%</span>
                <button onClick={() => setLightboxZoomLevel(Math.min(3, lightboxZoomLevel + 0.25))} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex' }} title="Zoom In">
                  <ZoomIn size={24} />
                </button>
                <a href={currentImgUrl} download target="_blank" rel="noreferrer" style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', textDecoration: 'none' }} title="Download">
                  <Download size={24} />
                </a>
              </div>
            </div>

            {/* Main View Area */}
            <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {/* Prev Button */}
              {zoomedImageIndex > 0 && (
                <button onClick={() => { setZoomedImageIndex(zoomedImageIndex - 1); setLightboxZoomLevel(1); }} style={{ position: 'absolute', left: 24, zIndex: 10, background: 'rgba(255,255,255,0.1)', border: 'none', width: 56, height: 56, borderRadius: '50%', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
                  <ChevronLeft size={36} />
                </button>
              )}

              {/* Image */}
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: lightboxZoomLevel > 1 ? 'auto' : 'hidden' }}>
                <img
                  src={currentImgUrl}
                  style={{
                    maxHeight: lightboxZoomLevel > 1 ? 'none' : '90%',
                    maxWidth: lightboxZoomLevel > 1 ? 'none' : '90%',
                    transform: `scale(${lightboxZoomLevel})`,
                    transformOrigin: 'center center',
                    transition: lightboxZoomLevel === 1 ? 'transform 0.2s ease-out' : 'none',
                    objectFit: 'contain'
                  }}
                  alt="Zoomed"
                />
              </div>

              {/* Next Button */}
              {zoomedImageIndex < chatImages.length - 1 && (
                <button onClick={() => { setZoomedImageIndex(zoomedImageIndex + 1); setLightboxZoomLevel(1); }} style={{ position: 'absolute', right: 24, zIndex: 10, background: 'rgba(255,255,255,0.1)', border: 'none', width: 56, height: 56, borderRadius: '50%', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
                  <ChevronRight size={36} />
                </button>
              )}
            </div>

            {/* Thumbnails Gallery (Bottom) */}
            <div style={{ height: 100, background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '0 24px', overflowX: 'auto' }}>
              {chatImages.map((img, idx) => (
                <div
                  key={img.id}
                  onClick={() => { setZoomedImageIndex(idx); setLightboxZoomLevel(1); }}
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 8,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    border: zoomedImageIndex === idx ? `2px solid ${C.accent}` : '2px solid transparent',
                    opacity: zoomedImageIndex === idx ? 1 : 0.5,
                    transition: 'all 0.2s',
                    flexShrink: 0
                  }}
                >
                  <img
                    loading="lazy"
                    decoding="async"
                    src={img.media_url.startsWith('http') ? img.media_url : `${SOCKET_URL}${img.media_url}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    alt="Thumbnail"
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Edit Contact Modal */}
      {showEditContactModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: C.card, borderRadius: 12, width: '100%', maxWidth: 400, boxShadow: '0 8px 32px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid ' + C.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: C.text, fontSize: 18, fontWeight: 600 }}>Edit Contact Info</h3>
              <button onClick={() => setShowEditContactModal(false)} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', display: 'flex' }}><X size={20} /></button>
            </div>
            <form onSubmit={handleSaveContact} style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: C.text, fontWeight: 500 }}>Name</label>
                  <input type="text" value={editContactData.name || ''} onChange={(e) => setEditContactData({...editContactData, name: e.target.value})} style={{ width: '100%', background: C.bg, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 14, outline: 'none' }} required />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: C.text, fontWeight: 500 }}>Phone</label>
                  <input type="text" value={editContactData.phone || ''} onChange={(e) => setEditContactData({...editContactData, phone: e.target.value})} style={{ width: '100%', background: C.bg, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 14, outline: 'none' }} required />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: C.text, fontWeight: 500 }}>Email</label>
                  <input type="email" value={editContactData.email || ''} onChange={(e) => setEditContactData({...editContactData, email: e.target.value})} style={{ width: '100%', background: C.bg, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 14, outline: 'none' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: C.text, fontWeight: 500 }}>Interest / Notes</label>
                  <textarea value={editContactData.interest || ''} onChange={(e) => setEditContactData({...editContactData, interest: e.target.value})} style={{ width: '100%', background: C.bg, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 14, outline: 'none', minHeight: 80, resize: 'vertical' }} />
                </div>
              </div>
              <div style={{ padding: '16px 24px', borderTop: '1px solid ' + C.border, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button type="button" onClick={() => setShowEditContactModal(false)} style={{ background: 'transparent', border: 'none', color: C.text, fontSize: 14, fontWeight: 500, cursor: 'pointer', padding: '8px 16px' }}>Cancel</button>
                <button type="submit" disabled={savingContact} style={{ background: C.accent, color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: savingContact ? 'not-allowed' : 'pointer', padding: '8px 24px', opacity: savingContact ? 0.7 : 1 }}>{savingContact ? 'Saving...' : 'Save Changes'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  )
};
