import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  FiSearch, FiPlus, FiArrowLeft, FiCheck, FiClock, FiAlertTriangle, FiX, FiCornerUpRight, FiStar, FiTrash2,
  FiLock, FiUnlock, FiFileText, FiInbox, FiPaperclip,
} from 'react-icons/fi';
import { BsPinAngleFill } from 'react-icons/bs';
import { FaWhatsapp } from 'react-icons/fa';
import axiosClient from '../api/axiosClient';
import { useLiveEvent, useLiveStatus } from '../api/realtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { fullDateTime } from '../utils/time';
import { Composer } from '../components/inbox/Composer';
import { MessageBubble } from '../components/inbox/MessageBubble';
import { ImageViewer } from '../components/inbox/ImageViewer';
import { ForwardDialog } from '../components/inbox/ForwardDialog';
import { MAX_FILE, MAX_FILES, SendPreview, toPending } from '../components/inbox/SendPreview';
import { saveFile } from '../components/inbox/ChatMedia';
import { quoteText } from '../components/inbox/ChatCards';
import { ContactInfoPanel, LabelChip, MessageInfoPanel, SharedMediaPanel, useShared } from '../components/inbox/ContactInfo';

const apiError = (err, fallback) => err.response?.data?.error || fallback;
const FILTERS = [['all', 'All'], ['unread', 'Unread'], ['unassigned', 'Unassigned'], ['open', 'Open'], ['closed', 'Closed']];
const TYPING_EVERY_MS = 20000;

const formatNumber = (waId) => (waId ? `+${waId}` : '');
const initials = (name) => String(name || '?').trim().charAt(0).toUpperCase();
const timeOf = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
const dayOf = (d) => {
  const date = new Date(d);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
const listTime = (d) => {
  if (!d) return '';
  const date = new Date(d);
  return date.toDateString() === new Date().toDateString() ? timeOf(d) : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const hoursLeft = (closesAt) => Math.max(0, Math.ceil((new Date(closesAt).getTime() - Date.now()) / 3600000));

const Ticks = ({ status }) => {
  if (status === 'failed') return <FiAlertTriangle className="size-3.5 text-red-500" title="Not delivered" />;
  if (status === 'sending') return <FiClock className="size-3 opacity-70" title="Sending" />;
  if (status === 'sent') return <FiCheck className="size-3.5 opacity-70" title="Sent" />;
  const read = status === 'read';
  return (
    <span className={cn('inline-flex', read ? 'text-sky-500' : 'opacity-70')} title={read ? 'Read' : 'Delivered'}>
      <FiCheck className="size-3.5" /><FiCheck className="-ml-2 size-3.5" />
    </span>
  );
};

const Avatar = ({ name, size = 'size-10' }) => (
  <span className={cn(size, 'flex shrink-0 items-center justify-center rounded-full bg-green-100 font-bold text-green-700')}>{initials(name)}</span>
);

// Saves a message's file under its own name.
async function saveMessageFile(m) {
  const name = m.filename || `${m.type}-${m.id}`;
  if (m.media_url) return saveFile(m.media_url, name);
  const res = await axiosClient.get(`/admin/inbox/messages/${m.id}/media`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  try { await saveFile(url, name); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

const DeleteDialog = ({ count, onCancel, onConfirm }) => {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={count > 0} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete {count > 1 ? `${count} messages` : 'message'}?</DialogTitle>
          <DialogDescription>
            It is removed from this chat and its file is deleted from the media server for good.
            WhatsApp cannot delete it from the customer's phone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="destructive" disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>
            {busy && <Spinner />} Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// The platform's own WhatsApp number as a full-screen inbox (opened in its own
// tab from the admin panel). All sending goes through the server.
// `embedded`: shown inside the admin panel (the dashboard owns the header and
// the URL is /dashboard/whatsapp-inbox/<chat>); otherwise a full-page view.
const InboxPage = ({ embedded = false, conversationId: conversationIdProp, basePath = '/inbox' }) => {
  const navigate = useNavigate();
  const params = useParams();
  const conversationId = embedded ? conversationIdProp : params.conversationId;
  const activeId = conversationId ? Number(conversationId) : null;
  const openChat = (id) => navigate(id ? `${basePath}/${id}` : basePath);
  const live = useLiveStatus();

  const [status, setStatus] = useState(null);
  const [allowed, setAllowed] = useState(true);
  const [conversations, setConversations] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState([]); // files in the send preview
  const [templates, setTemplates] = useState([]);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [panel, setPanel] = useState(null); // { kind: 'contact' | 'shared' | 'info', id? }
  const [replyingTo, setReplyingTo] = useState(null);
  const [staff, setStaff] = useState([]);
  const [knownLabels, setKnownLabels] = useState([]);
  const [labelFilter, setLabelFilter] = useState('');
  const [viewer, setViewer] = useState(null); // { images, index }
  const [highlightId, setHighlightId] = useState(null);
  const [selected, setSelected] = useState(null); // Set of message ids while selecting
  const [forwardIds, setForwardIds] = useState(null);
  const [deleteIds, setDeleteIds] = useState(null);
  const composerRef = useRef(null);
  const lastTyping = useRef(0);
  const bottomRef = useRef(null);

  useEffect(() => { if (!embedded) document.title = 'WhatsApp Chat · Getnera Admin'; }, [embedded]);

  const loadStatus = async () => {
    try {
      setStatus((await axiosClient.get('/admin/inbox/status')).data);
    } catch (err) {
      if (err.response?.status === 403) setAllowed(false);
    }
  };

  const loadConversations = async ({ quiet = false } = {}) => {
    if (!quiet) setListLoading(true);
    try {
      const res = await axiosClient.get('/admin/inbox/conversations', { params: { search: search.trim() || undefined, filter, label: labelFilter || undefined } });
      setConversations(res.data.conversations || []);
    } catch (err) {
      if (err.response?.status === 403) setAllowed(false);
      else if (!quiet) toast.error(apiError(err, 'Failed to load chats'));
    } finally {
      setListLoading(false);
    }
  };

  const loadThread = async (id, { quiet = false } = {}) => {
    if (!id) return;
    if (!quiet) setThreadLoading(true);
    try {
      const [d, m] = await Promise.all([
        axiosClient.get(`/admin/inbox/conversations/${id}`),
        axiosClient.get(`/admin/inbox/conversations/${id}/messages`),
      ]);
      setDetail(d.data);
      setMessages(m.data.messages || []);
      setHasMore(Boolean(m.data.has_more));
      if (d.data.conversation.unread_count) {
        await axiosClient.post(`/admin/inbox/conversations/${id}/read`);
        setConversations((list) => list.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c)));
      }
    } catch (err) {
      if (!quiet) toast.error(apiError(err, 'Failed to load the chat'));
    } finally {
      setThreadLoading(false);
    }
  };

  useEffect(() => { loadStatus(); }, []);
  useEffect(() => {
    const t = setTimeout(() => loadConversations(), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [search, filter, labelFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setDetail(null);
    setMessages([]);
    setReplyingTo(null);
    setSelected(null);
    setPending([]);
    setPanel((p) => (p?.kind === 'info' ? null : p));
    loadThread(activeId);
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadLabels = () => axiosClient.get('/admin/inbox/labels').then((r) => setKnownLabels(r.data.labels || [])).catch(() => {});
  useEffect(() => {
    axiosClient.get('/admin/inbox/templates').then((r) => setTemplates(r.data.templates || [])).catch(() => {});
    axiosClient.get('/admin/inbox/staff').then((r) => setStaff(r.data.staff || [])).catch(() => {});
    loadLabels();
  }, []);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, activeId]);

  // New messages and delivery receipts arrive live.
  useLiveEvent('platform_inbox:changed', (payload) => {
    loadConversations({ quiet: true });
    loadStatus();
    if (activeId && (!payload?.contact_id || payload.contact_id === activeId)) loadThread(activeId, { quiet: true });
  });

  const loadOlder = async () => {
    if (!messages.length) return;
    const res = await axiosClient.get(`/admin/inbox/conversations/${activeId}/messages`, { params: { before: messages[0].id } });
    setMessages((m) => [...(res.data.messages || []), ...m]);
    setHasMore(Boolean(res.data.has_more));
  };

  const conversation = detail?.conversation;
  const windowOpen = Boolean(conversation?.window_open);
  const configured = status?.configured !== false;
  const customerName = conversation ? conversation.name || formatNumber(conversation.wa_id) : '';
  const { data: shared, refresh: refreshShared } = useShared(panel ? activeId : null, messages.length);

  // Shows the failed message (if the server recorded one) and the reason; rethrows
  // so the composer keeps what was not sent.
  const sendFailed = (err, fallback) => {
    if (err.response?.data?.message) setMessages((m) => [...m, err.response.data.message]);
    toast.error(apiError(err, fallback));
    if (err.response?.data?.code === 'WINDOW_CLOSED') loadThread(activeId, { quiet: true });
    throw err;
  };

  const replyField = () => (replyingTo ? { reply_to: replyingTo.id } : {});
  const sent = (message) => {
    setMessages((m) => [...m, message]);
    setReplyingTo(null);
  };

  const sendText = async (body) => {
    try {
      const res = await axiosClient.post(`/admin/inbox/conversations/${activeId}/messages`, { text: body, ...replyField() });
      sent(res.data.message);
    } catch (err) {
      sendFailed(err, 'Message not sent');
    }
  };

  const sendFile = async (file, { caption = '', voice = false, onProgress } = {}) => {
    const form = new FormData();
    form.append('file', file);
    if (caption) form.append('caption', caption);
    if (voice) form.append('voice', '1');
    if (replyingTo) form.append('reply_to', String(replyingTo.id));
    try {
      const res = await axiosClient.post(`/admin/inbox/conversations/${activeId}/media`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 0,
        onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
      });
      sent(res.data.message);
    } catch (err) {
      sendFailed(err, voice ? 'Voice message not sent' : `${file.name} not sent`);
    }
  };

  // Picked, pasted or dropped files go to the send preview.
  const addFiles = (files) => {
    const list = [...(files || [])];
    const tooBig = list.filter((f) => f.size > MAX_FILE);
    if (tooBig.length) toast.error(`${tooBig.map((f) => f.name).join(', ')}: a file can be at most 100 MB`);
    setPending((current) => {
      const room = MAX_FILES - current.length;
      const ok = list.filter((f) => f.size <= MAX_FILE);
      if (ok.length > room) toast.error(`You can send up to ${MAX_FILES} files at once`);
      return [...current, ...toPending(ok.slice(0, Math.max(0, room)))];
    });
  };

  const react = async (message, emoji) => {
    const set = (value) => setMessages((list) => list.map((m) => (m.id === message.id ? { ...m, reactions: { ...m.reactions, staff: value || undefined } } : m)));
    const before = message.reactions?.staff;
    set(emoji);
    try {
      await axiosClient.post(`/admin/inbox/messages/${message.id}/reaction`, { emoji });
    } catch (err) {
      set(before);
      toast.error(apiError(err, 'Reaction not sent'));
    }
  };

  const flag = async (message, changes) => {
    try {
      const res = await axiosClient.patch(`/admin/inbox/messages/${message.id}`, changes);
      setMessages((list) => list.map((m) => (m.id === message.id ? res.data.message : m)));
    } catch (err) {
      toast.error(apiError(err, 'Could not update the message'));
    }
  };

  // "typing…" for the customer, at most every 20 seconds.
  const typing = () => {
    if (Date.now() - lastTyping.current < TYPING_EVERY_MS) return;
    lastTyping.current = Date.now();
    axiosClient.post(`/admin/inbox/conversations/${activeId}/typing`).catch(() => {});
  };

  const chatImages = useMemo(() => messages.filter((m) => m.type === 'image' && (m.has_media || m.media_url)), [messages]);
  const openImage = (message, list = chatImages) => {
    const images = list.filter((m) => m.type === 'image' || m.type === 'sticker');
    const index = images.findIndex((m) => m.id === message.id);
    setViewer(index >= 0 ? { images, index } : { images: [message], index: 0 });
  };

  const jumpTo = (id) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) { toast.info('That message is further up. Load older messages to see it.'); return; }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightId(id);
    setTimeout(() => setHighlightId((h) => (h === id ? null : h)), 1600);
  };

  const onAction = async (name, m, extra) => {
    if (name === 'info') setPanel({ kind: 'info', id: m.id });
    if (name === 'reply') { setReplyingTo(m); requestAnimationFrame(() => composerRef.current?.focus()); }
    if (name === 'copy') {
      try { await navigator.clipboard.writeText(m.text || ''); toast.success('Copied'); } catch { toast.error('Could not copy'); }
    }
    if (name === 'forward') setForwardIds([m.id]);
    if (name === 'pin') flag(m, { pinned: !m.pinned });
    if (name === 'star') flag(m, { starred: !m.starred });
    if (name === 'select') setSelected(new Set([m.id]));
    if (name === 'save') saveMessageFile(m).catch(() => toast.error('Could not download the file'));
    if (name === 'delete') setDeleteIds([m.id]);
    if (name === 'react') react(m, extra);
  };

  const toggleSelect = (m) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
    return next.size ? next : null;
  });

  const forward = async (contactIds) => {
    let ok = 0;
    let failed = 0;
    for (const id of forwardIds) {
      for (const contactId of contactIds) {
        try {
          await axiosClient.post(`/admin/inbox/messages/${id}/forward`, { contact_id: contactId });
          ok++;
        } catch (err) {
          failed++;
          toast.error(apiError(err, 'Could not forward'));
        }
      }
    }
    if (ok) toast.success(`Forwarded ${ok}`);
    if (contactIds.includes(activeId)) loadThread(activeId, { quiet: true });
    if (!failed) { setForwardIds(null); setSelected(null); }
  };

  const remove = async () => {
    try {
      const res = await axiosClient.post('/admin/inbox/messages/delete', { ids: deleteIds });
      const gone = new Set(deleteIds);
      setMessages((list) => list.filter((m) => !gone.has(m.id)));
      if (panel?.kind === 'info' && gone.has(panel.id)) setPanel(null);
      toast.success(res.data.files_deleted ? `Deleted (${res.data.files_deleted} file${res.data.files_deleted > 1 ? 's' : ''} removed from the server)` : 'Deleted');
      setDeleteIds(null);
      setSelected(null);
      refreshShared();
      loadConversations({ quiet: true });
    } catch (err) {
      toast.error(apiError(err, 'Could not delete'));
    }
  };

  const canAttach = configured && windowOpen && !selected;
  const dragProps = {
    onDragEnter: (e) => { if (canAttach && e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragging(true); } },
    onDragOver: (e) => { if (canAttach && e.dataTransfer?.types?.includes('Files')) e.preventDefault(); },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); },
    onDrop: (e) => {
      if (!canAttach) return;
      e.preventDefault();
      setDragging(false);
      addFiles(e.dataTransfer.files);
    },
  };

  const updateConversation = async (changes, success) => {
    try {
      const res = await axiosClient.patch(`/admin/inbox/conversations/${activeId}`, changes);
      setDetail((d) => ({ ...d, conversation: res.data.conversation }));
      setConversations((list) => list.map((c) => (c.id === activeId ? res.data.conversation : c)));
      if (changes.labels) loadLabels();
      if (success) toast.success(success);
    } catch (err) {
      toast.error(apiError(err, 'Failed to update the chat'));
    }
  };

  // Messages grouped under a date heading.
  const grouped = useMemo(() => {
    const out = [];
    let day = null;
    for (const m of messages) {
      const d = dayOf(m.created_at);
      if (d !== day) { out.push({ divider: d, key: `d-${d}-${m.id}` }); day = d; }
      out.push(m);
    }
    return out;
  }, [messages]);
  const pinned = useMemo(() => [...messages].reverse().find((m) => m.pinned), [messages]);
  const infoMessage = panel?.kind === 'info' ? messages.find((m) => m.id === panel.id) : null;

  const bubble = (m, extra = {}) => (
    <MessageBubble
      key={m.id}
      message={m}
      customerName={customerName}
      canInteract={configured && windowOpen}
      selecting={Boolean(selected)}
      selected={selected?.has(m.id)}
      onToggleSelect={toggleSelect}
      onAction={onAction}
      onOpenImage={(msg) => openImage(msg)}
      onJumpTo={jumpTo}
      highlighted={highlightId === m.id}
      time={<span title={fullDateTime(m.created_at)}>{timeOf(m.created_at)}</span>}
      ticks={<Ticks status={m.status} />}
      {...extra}
    />
  );

  if (!allowed) {
    return (
      <div className={cn('flex items-center justify-center bg-background p-6 text-center', embedded ? 'h-full' : 'h-screen')}>
        <div className="flex max-w-sm flex-col items-center gap-3">
          <FiLock className="size-8 text-muted-foreground" />
          <div className="font-semibold">You do not have access to WhatsApp Chat</div>
          <p className="text-sm text-muted-foreground">Only the Admin (Owner) and Staff can open the platform inbox.</p>
          <Button variant="outline" onClick={() => navigate('/dashboard')}>Back to the admin panel</Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col overflow-hidden bg-background', embedded ? 'h-full' : 'h-screen')}>
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-3 sm:px-5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-[#25D366] text-white"><FaWhatsapp size={18} /></span>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">Getnera WhatsApp Chat</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {status?.number?.display_phone_number || (configured ? 'Platform number' : 'Number not configured')}
            {status?.number?.verified_name ? ` · ${status.number.verified_name}` : ''}
          </div>
        </div>
        <span className={cn('ml-1 hidden items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold', !embedded && 'sm:inline-flex', live ? 'border-green-200 bg-green-50 text-green-700' : 'border-border bg-muted text-muted-foreground')}>
          <span className={cn('size-1.5 rounded-full', live ? 'animate-pulse bg-green-500' : 'bg-slate-400')} />
          {live ? 'Live' : 'Offline'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" onClick={() => setNewChatOpen(true)} disabled={!configured}><FiPlus /> <span className="hidden sm:inline">New chat</span></Button>
          {!embedded && <Button size="sm" variant="outline" onClick={() => navigate('/dashboard')} className="hidden sm:inline-flex">Admin panel</Button>}
        </div>
      </header>

      {!configured && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          <FiAlertTriangle className="mt-0.5 shrink-0" />
          <span>
            {status?.missing?.includes('PLATFORM_WA_PHONE_NUMBER_ID')
              ? <>The admin WhatsApp number is not set up. In <a href="/dashboard/whatsapp-numbers" className="font-semibold underline">WhatsApp Numbers</a>, choose a number and click "Use for admin WhatsApp".</>
              : <>The admin WhatsApp number cannot send yet: {status?.missing?.join(' and ')} is missing on the server.</>}
            Existing chats are shown, but nothing can be sent.
          </span>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {/* Conversations */}
        <aside className={cn('flex w-full shrink-0 flex-col border-r border-border bg-card md:w-80 lg:w-96', activeId && 'hidden md:flex')}>
          <div className="flex flex-col gap-2 border-b border-border p-3">
            <div className="relative">
              <FiSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search name, number or message" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 pl-9" />
            </div>
            <div className="flex flex-wrap gap-1">
              {FILTERS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={cn('cursor-pointer rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap transition-colors', filter === key ? 'bg-green-100 text-green-800' : 'bg-muted/60 text-muted-foreground hover:bg-muted')}
                >
                  {label}
                </button>
              ))}
            </div>
            {knownLabels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {knownLabels.map((l) => (
                  <button key={l} type="button" onClick={() => setLabelFilter((cur) => (cur === l ? '' : l))} className={cn('cursor-pointer rounded-full', labelFilter && labelFilter !== l && 'opacity-50')} title={labelFilter === l ? 'Show all labels' : `Only "${l}"`}>
                    <LabelChip label={l} className={cn(labelFilter === l && 'ring-2 ring-offset-1 ring-green-500')} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {listLoading ? (
              <div className="flex flex-col gap-3 p-3">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-3"><Skeleton className="size-10 rounded-full" /><div className="flex flex-1 flex-col gap-1.5"><Skeleton className="h-3.5 w-32" /><Skeleton className="h-3 w-48" /></div></div>
                ))}
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-sm text-muted-foreground">
                <FiInbox className="size-8 text-slate-300" />
                {search || filter !== 'all' || labelFilter ? 'No chat matches this search or filter.' : 'No chats yet. Messages to the platform number appear here.'}
              </div>
            ) : conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => openChat(c.id)}
                className={cn('flex w-full cursor-pointer items-center gap-3 border-b border-border px-3 py-3 text-left transition-colors hover:bg-muted/60', c.id === activeId && 'bg-green-50/70 hover:bg-green-50/70')}
              >
                <Avatar name={c.name || c.wa_id} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={cn('truncate text-sm', c.unread_count ? 'font-bold' : 'font-semibold')}>{c.name || formatNumber(c.wa_id)}</span>
                    <span className={cn('shrink-0 text-[11px]', c.unread_count ? 'font-semibold text-green-700' : 'text-muted-foreground')}>{listTime(c.last_message_at)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-muted-foreground">
                      {c.last_message_direction === 'outbound' && 'You: '}{c.last_message_preview || ' '}
                    </span>
                    {c.unread_count > 0 && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#25D366] px-1.5 text-[11px] font-bold text-white">{c.unread_count}</span>}
                    {c.status === 'closed' && !c.unread_count && <FiLock className="size-3 shrink-0 text-muted-foreground" title="Closed" />}
                  </div>
                  {(c.labels?.length > 0 || c.assigned_name) && (
                    <div className="mt-1 flex items-center gap-1 overflow-hidden">
                      {c.assigned_name && <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">@{c.assigned_name.split(' ')[0]}</span>}
                      {c.labels?.slice(0, 3).map((l) => <LabelChip key={l} label={l} className="shrink-0 px-1.5 text-[10px]" />)}
                      {c.labels?.length > 3 && <span className="text-[10px] text-muted-foreground">+{c.labels.length - 3}</span>}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* Thread */}
        <section className={cn('relative flex min-w-0 flex-1 flex-col', !activeId && 'hidden md:flex')} {...dragProps}>
          {dragging && (
            <div className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#25D366] bg-white/90 text-center">
              <FiPaperclip className="size-8 text-[#25D366]" />
              <div className="font-semibold">Drop files to send</div>
              <div className="text-xs text-muted-foreground">Photos, videos, documents and any other file up to 100 MB</div>
            </div>
          )}
          {pending.length > 0 && (
            <SendPreview
              items={pending}
              onItems={setPending}
              onClose={() => setPending([])}
              onSend={(item, caption, onProgress) => sendFile(item.file, { caption, onProgress })}
            />
          )}
          {!activeId ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[#f0f2f5] p-6 text-center">
              <span className="flex size-16 items-center justify-center rounded-full bg-white text-[#25D366] shadow-sm"><FaWhatsapp size={30} /></span>
              <div className="text-lg font-semibold">Getnera WhatsApp Chat</div>
              <p className="max-w-sm text-sm text-muted-foreground">Pick a chat on the left, or start a new one with an approved template.</p>
            </div>
          ) : threadLoading || !conversation ? (
            <div className="flex flex-1 flex-col gap-3 p-6"><Skeleton className="h-10 w-64" /><Skeleton className="h-16 w-2/3" /><Skeleton className="ml-auto h-12 w-1/2" /></div>
          ) : (
            <>
              <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-3">
                <Button variant="ghost" size="icon" className="size-8 md:hidden" onClick={() => openChat(null)} aria-label="Back to chats"><FiArrowLeft /></Button>
                {/* Like WhatsApp: the name opens Contact info */}
                <button type="button" onClick={() => setPanel((p) => (p?.kind === 'contact' ? null : { kind: 'contact' }))} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md py-1 text-left hover:bg-muted/50" title="Contact info">
                  <Avatar name={conversation.name || conversation.wa_id} size="size-9" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{customerName}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">Click here for contact info</span>
                  </span>
                </button>
                <Badge variant={windowOpen ? 'success' : 'muted'} className="hidden sm:inline-flex" title="Meta allows free messages for 24 hours after the customer's last message">
                  <FiClock /> {windowOpen ? `Reply window: ${hoursLeft(conversation.window_closes_at)}h left` : 'Reply window closed'}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => updateConversation({ status: conversation.status === 'closed' ? 'open' : 'closed' }, conversation.status === 'closed' ? 'Chat reopened' : 'Chat closed')}
                >
                  {conversation.status === 'closed' ? <><FiUnlock /> Reopen</> : <><FiLock /> Close</>}
                </Button>
              </div>

              {pinned && (
                <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-4 py-2 text-sm">
                  <BsPinAngleFill className="shrink-0 text-slate-500" />
                  <button type="button" onClick={() => jumpTo(pinned.id)} className="min-w-0 flex-1 cursor-pointer truncate text-left text-slate-700 hover:underline">{quoteText(pinned)}</button>
                  <button type="button" onClick={() => flag(pinned, { pinned: false })} className="shrink-0 cursor-pointer text-xs text-muted-foreground hover:text-foreground">Unpin</button>
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto bg-[#efeae2] px-3 py-4 sm:px-8">
                {hasMore && (
                  <div className="mb-3 flex justify-center">
                    <Button size="sm" variant="outline" className="bg-white" onClick={loadOlder}>Load older messages</Button>
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  {grouped.map((item) => (item.divider ? (
                    <div key={item.key} className="my-2 flex justify-center">
                      <span className="rounded-md bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-sm">{item.divider}</span>
                    </div>
                  ) : bubble(item)))}
                  <div ref={bottomRef} />
                </div>
              </div>

              {/* Composer, or the selection bar while selecting */}
              <div className="shrink-0 border-t border-border bg-[#f0f2f5] px-3 py-2.5">
                {selected ? (
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setSelected(null)} className="flex size-9 cursor-pointer items-center justify-center rounded-full hover:bg-black/5" aria-label="Cancel selection"><FiX className="size-5" /></button>
                    <span className="flex-1 text-sm">{selected.size} selected</span>
                    <Button variant="ghost" size="icon" title="Star" onClick={() => { messages.filter((m) => selected.has(m.id)).forEach((m) => flag(m, { starred: true })); setSelected(null); }}><FiStar /></Button>
                    <Button variant="ghost" size="icon" title="Delete" className="text-red-600" onClick={() => setDeleteIds([...selected])}><FiTrash2 /></Button>
                    <Button variant="ghost" size="icon" title="Forward" onClick={() => setForwardIds([...selected])}><FiCornerUpRight /></Button>
                  </div>
                ) : !configured ? (
                  <div className="text-center text-xs text-muted-foreground">Sending is off until the platform number is set up.</div>
                ) : windowOpen ? (
                  <Composer
                    key={activeId}
                    ref={composerRef}
                    onSendText={sendText}
                    onFiles={addFiles}
                    onSendVoice={(file) => sendFile(file, { voice: true })}
                    onTemplate={() => setTemplateOpen(true)}
                    onTyping={typing}
                    replyingTo={replyingTo}
                    onCancelReply={() => setReplyingTo(null)}
                    customerName={customerName}
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-center sm:flex-row sm:justify-between sm:text-left">
                    <span className="text-xs text-muted-foreground">
                      More than 24 hours since this customer last wrote. Meta allows only an approved template until they reply.
                    </span>
                    <Button size="sm" onClick={() => setTemplateOpen(true)}><FiFileText /> Send template</Button>
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        {/* Right side: contact info, its media, or message info (WhatsApp layout) */}
        {activeId && conversation && panel && (
          <aside key={panel.kind} className="wa-slide-in absolute inset-y-0 right-0 z-30 flex w-full max-w-[420px] flex-col border-l border-border bg-card shadow-xl lg:static lg:w-[400px] lg:shadow-none">
            {panel.kind === 'contact' && (
              <ContactInfoPanel
                conversation={conversation}
                workspaces={detail.workspaces || []}
                staff={staff}
                knownLabels={knownLabels}
                shared={shared}
                onClose={() => setPanel(null)}
                onSave={updateConversation}
                onOpenShared={() => setPanel({ kind: 'shared' })}
                onOpenImage={(m, list) => openImage(m, list)}
              />
            )}
            {panel.kind === 'shared' && (
              <SharedMediaPanel
                shared={shared}
                onBack={() => setPanel({ kind: 'contact' })}
                onOpenImage={(m, list) => openImage(m, list)}
                onDeleted={(ids) => {
                  const gone = new Set(ids);
                  setMessages((list) => list.filter((m) => !gone.has(m.id)));
                  refreshShared();
                  loadConversations({ quiet: true });
                }}
              />
            )}
            {panel.kind === 'info' && (infoMessage
              ? <MessageInfoPanel message={infoMessage} preview={<div className="w-full">{bubble(infoMessage, { readOnly: true, selecting: false })}</div>} onClose={() => setPanel(null)} />
              : <div className="p-6 text-sm text-muted-foreground">This message is no longer in the chat. <button type="button" className="underline" onClick={() => setPanel(null)}>Close</button></div>)}
          </aside>
        )}
      </div>

      <TemplateDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        templates={templates}
        onSend={async (template, values) => {
          const res = await axiosClient.post(`/admin/inbox/conversations/${activeId}/template`, { name: template.name, language: template.language, values });
          setMessages((m) => [...m, res.data.message]);
        }}
      />
      <ForwardDialog open={Boolean(forwardIds)} onOpenChange={(o) => !o && setForwardIds(null)} conversations={conversations} count={forwardIds?.length || 0} onForward={forward} />
      <DeleteDialog count={deleteIds?.length || 0} onCancel={() => setDeleteIds(null)} onConfirm={remove} />
      {viewer && <ImageViewer images={viewer.images} index={viewer.index} onIndex={(index) => setViewer((v) => ({ ...v, index }))} onClose={() => setViewer(null)} />}
      <NewChatDialog
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        templates={templates}
        onStarted={(id) => { loadConversations({ quiet: true }); openChat(id); }}
      />
    </div>
  );
};

const TemplatePicker = ({ templates, value, onChange }) => (
  <div className="flex flex-col gap-1.5">
    <Label className="text-xs">Approved template</Label>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-10"><SelectValue placeholder={templates.length ? 'Choose a template' : 'No approved templates'} /></SelectTrigger>
      <SelectContent>
        {templates.map((t) => <SelectItem key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} · {t.language}</SelectItem>)}
      </SelectContent>
    </Select>
  </div>
);

const EMPTY_VALUES = { header: '', header_media_id: '', header_file: '', body: {}, buttons: {} };
const ACCEPT = { IMAGE: 'image/jpeg,image/png', VIDEO: 'video/mp4,video/3gpp', DOCUMENT: '.pdf,application/pdf' };

// True when every value the template needs has been filled in.
const templateReady = (template, values) => {
  if (!template) return false;
  const { fields } = template;
  if (fields.header?.format === 'TEXT' && !values.header.trim()) return false;
  if (fields.header && fields.header.format !== 'TEXT' && !values.header_media_id) return false;
  if (fields.body.some((v) => !String(values.body[v.name] || '').trim())) return false;
  return fields.buttons.every((b) => String(values.buttons[b.index] || '').trim());
};

const fill = (text, values, fallback) => String(text || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (m, name) => String(values?.[name] || '').trim() || fallback(name, m));

// Inputs for a template's values, with a live preview of the message.
const TemplateValues = ({ template, values, onChange }) => {
  const [uploading, setUploading] = useState(false);
  const { fields } = template;
  const set = (patch) => onChange({ ...values, ...patch });
  const headerText = fields.header?.format === 'TEXT' ? fill(template.header_text, { [fields.header.name]: values.header }, (_n, m) => m) : template.header_text;
  const body = fill(template.body, values.body, (_n, m) => m);

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('format', fields.header.format);
      const res = await axiosClient.post('/admin/inbox/template-media', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      set({ header_media_id: res.data.media_id, header_file: file.name });
    } catch (err) {
      set({ header_media_id: '', header_file: '' });
      toast.error(apiError(err, 'Upload failed'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {fields.header?.format === 'TEXT' && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Header {`{{${fields.header.name}}}`}</Label>
          <Input value={values.header} onChange={(e) => set({ header: e.target.value })} placeholder={fields.header.sample || 'Value'} maxLength={60} />
        </div>
      )}
      {fields.header && fields.header.format !== 'TEXT' && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Header {fields.header.format.toLowerCase()}</Label>
          <Input type="file" accept={ACCEPT[fields.header.format]} disabled={uploading} onChange={(e) => upload(e.target.files?.[0])} />
          <span className="text-[11px] text-muted-foreground">
            {uploading ? 'Uploading to WhatsApp…' : values.header_media_id ? `Ready: ${values.header_file}` : 'Choose the file to send in the header.'}
          </span>
        </div>
      )}
      {fields.body.map((v) => (
        <div key={v.name} className="flex flex-col gap-1.5">
          <Label className="text-xs">{`{{${v.name}}}`}</Label>
          <Input value={values.body[v.name] || ''} onChange={(e) => set({ body: { ...values.body, [v.name]: e.target.value } })} placeholder={v.sample || 'Value'} maxLength={1024} />
        </div>
      ))}
      {fields.buttons.map((b) => (
        <div key={b.index} className="flex flex-col gap-1.5">
          <Label className="text-xs">{b.type === 'URL' ? `Button "${b.text}" link: ${b.url.replace(/\{\{\s*1\s*\}\}/, '…')}` : 'Offer code'}</Label>
          <Input value={values.buttons[b.index] || ''} onChange={(e) => set({ buttons: { ...values.buttons, [b.index]: e.target.value } })} placeholder={b.type === 'URL' ? (b.sample.split('/').pop() || 'Value') : (b.sample || 'CODE')} maxLength={b.type === 'URL' ? 2000 : 15} />
        </div>
      ))}
      <div className="rounded-lg bg-[#d9fdd3] px-3 py-2 text-sm whitespace-pre-wrap">
        {fields.header && fields.header.format !== 'TEXT' && <div className="mb-1 text-[11px] font-semibold text-green-800">[{fields.header.format.toLowerCase()}]</div>}
        {headerText && <div className="mb-1 font-semibold">{headerText}</div>}
        {body || template.name}
        {template.footer && <div className="mt-1 text-[11px] text-muted-foreground">{template.footer}</div>}
      </div>
    </div>
  );
};

const valuesPayload = (values) => ({ header: values.header, header_media_id: values.header_media_id, body: values.body, buttons: values.buttons });

const TemplateDialog = ({ open, onOpenChange, templates, onSend }) => {
  const [value, setValue] = useState('');
  const [values, setValues] = useState(EMPTY_VALUES);
  const [sending, setSending] = useState(false);
  const template = templates.find((t) => `${t.name}|${t.language}` === value);
  useEffect(() => { if (open) setValue(''); }, [open]);
  useEffect(() => { setValues(EMPTY_VALUES); }, [value]);
  return (
    <Dialog open={open} onOpenChange={(o) => !sending && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send a template</DialogTitle>
          <DialogDescription>Approved templates can be sent at any time. Fill in the values the template needs.</DialogDescription>
        </DialogHeader>
        <TemplatePicker templates={templates} value={value} onChange={setValue} />
        {template && <TemplateValues template={template} values={values} onChange={setValues} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
          <Button
            disabled={!templateReady(template, values) || sending}
            onClick={async () => {
              setSending(true);
              try { await onSend(template, valuesPayload(values)); toast.success('Template sent'); onOpenChange(false); } catch (err) { toast.error(apiError(err, 'Template not sent')); } finally { setSending(false); }
            }}
          >
            {sending && <Spinner />} Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const NewChatDialog = ({ open, onOpenChange, templates, onStarted }) => {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [values, setValues] = useState(EMPTY_VALUES);
  const [sending, setSending] = useState(false);
  const template = templates.find((t) => `${t.name}|${t.language}` === value);
  useEffect(() => { if (open) { setPhone(''); setName(''); setValue(''); } }, [open]);
  useEffect(() => { setValues(EMPTY_VALUES); }, [value]);
  const valid = phone.replace(/\D/g, '').length >= 10 && templateReady(template, values);
  return (
    <Dialog open={open} onOpenChange={(o) => !sending && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New chat</DialogTitle>
          <DialogDescription>A new conversation must start with an approved template (Meta rule).</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nc-phone" className="text-xs">WhatsApp number with country code</Label>
            <Input id="nc-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="91 98765 43210" inputMode="tel" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nc-name" className="text-xs">Name · optional</Label>
            <Input id="nc-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>
          <TemplatePicker templates={templates} value={value} onChange={setValue} />
          {template && <TemplateValues template={template} values={values} onChange={setValues} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
          <Button
            disabled={!valid || sending}
            onClick={async () => {
              setSending(true);
              try {
                const res = await axiosClient.post('/admin/inbox/conversations', { phone, name: name.trim() || undefined, template_name: template.name, language: template.language, values: valuesPayload(values) });
                toast.success('Chat started');
                onOpenChange(false);
                onStarted(res.data.contact_id);
              } catch (err) {
                toast.error(apiError(err, 'Could not start the chat'));
              } finally {
                setSending(false);
              }
            }}
          >
            {sending && <Spinner />} <FaWhatsapp /> Start chat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default InboxPage;
