import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  FiSearch, FiPlus, FiArrowLeft, FiCheck, FiClock, FiAlertTriangle, FiInfo, FiX,
  FiLock, FiUnlock, FiExternalLink, FiFileText, FiInbox, FiPaperclip,
} from 'react-icons/fi';
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
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { relativeTime, fullDateTime } from '../utils/time';
import { Composer } from '../components/inbox/Composer';
import { MessageMedia } from '../components/inbox/ChatMedia';

const apiError = (err, fallback) => err.response?.data?.error || fallback;
const FILTERS = [['all', 'All'], ['unread', 'Unread'], ['open', 'Open'], ['closed', 'Closed']];

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
  const composerRef = useRef(null);
  const [templates, setTemplates] = useState([]);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
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
      const res = await axiosClient.get('/admin/inbox/conversations', { params: { search: search.trim() || undefined, filter } });
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
  }, [search, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setDetail(null);
    setMessages([]);
    loadThread(activeId);
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    axiosClient.get('/admin/inbox/templates').then((r) => setTemplates(r.data.templates || [])).catch(() => {});
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

  // Shows the failed message (if the server recorded one) and the reason; rethrows
  // so the composer keeps what was not sent.
  const sendFailed = (err, fallback) => {
    if (err.response?.data?.message) setMessages((m) => [...m, err.response.data.message]);
    toast.error(apiError(err, fallback));
    if (err.response?.data?.code === 'WINDOW_CLOSED') loadThread(activeId, { quiet: true });
    throw err;
  };

  const sendText = async (body) => {
    try {
      const res = await axiosClient.post(`/admin/inbox/conversations/${activeId}/messages`, { text: body });
      setMessages((m) => [...m, res.data.message]);
    } catch (err) {
      sendFailed(err, 'Message not sent');
    }
  };

  const sendFile = async (file, { caption = '', voice = false, onProgress } = {}) => {
    const form = new FormData();
    form.append('file', file);
    if (caption) form.append('caption', caption);
    if (voice) form.append('voice', '1');
    try {
      const res = await axiosClient.post(`/admin/inbox/conversations/${activeId}/media`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 0,
        onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
      });
      setMessages((m) => [...m, res.data.message]);
    } catch (err) {
      sendFailed(err, voice ? 'Voice message not sent' : `${file.name} not sent`);
    }
  };

  const canAttach = configured && windowOpen;
  const dragProps = {
    onDragEnter: (e) => { if (canAttach && e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragging(true); } },
    onDragOver: (e) => { if (canAttach && e.dataTransfer?.types?.includes('Files')) e.preventDefault(); },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); },
    onDrop: (e) => {
      if (!canAttach) return;
      e.preventDefault();
      setDragging(false);
      composerRef.current?.addFiles(e.dataTransfer.files);
    },
  };

  const updateConversation = async (changes, success) => {
    try {
      const res = await axiosClient.patch(`/admin/inbox/conversations/${activeId}`, changes);
      setDetail((d) => ({ ...d, conversation: res.data.conversation }));
      setConversations((list) => list.map((c) => (c.id === activeId ? res.data.conversation : c)));
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

      <div className="flex min-h-0 flex-1">
        {/* Conversations */}
        <aside className={cn('flex w-full shrink-0 flex-col border-r border-border bg-card md:w-80 lg:w-96', activeId && 'hidden md:flex')}>
          <div className="flex flex-col gap-2 border-b border-border p-3">
            <div className="relative">
              <FiSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search name, number or message" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 pl-9" />
            </div>
            <div className="flex gap-1 overflow-x-auto">
              {FILTERS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={cn('cursor-pointer rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap transition-colors', filter === key ? 'bg-green-100 text-green-800' : 'text-muted-foreground hover:bg-muted')}
                >
                  {label}
                </button>
              ))}
            </div>
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
                {search || filter !== 'all' ? 'No chat matches this search or filter.' : 'No chats yet. Messages to the platform number appear here.'}
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
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* Thread */}
        <section className={cn('relative flex min-w-0 flex-1 flex-col', !activeId && 'hidden md:flex')} {...dragProps}>
          {dragging && (
            <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#25D366] bg-white/90 text-center">
              <FiPaperclip className="size-8 text-[#25D366]" />
              <div className="font-semibold">Drop files to send</div>
              <div className="text-xs text-muted-foreground">Photos, videos, documents and any other file up to 100 MB</div>
            </div>
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
                <Avatar name={conversation.name || conversation.wa_id} size="size-9" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{conversation.name || formatNumber(conversation.wa_id)}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{formatNumber(conversation.wa_id)}</div>
                </div>
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
                <Button variant="ghost" size="icon" className="size-8 xl:hidden" onClick={() => setShowInfo((v) => !v)} aria-label="Contact info"><FiInfo /></Button>
              </div>

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
                  ) : (
                    <div key={item.id} className={cn('flex', item.direction === 'outbound' ? 'justify-end' : 'justify-start')}>
                      <div className={cn(
                        'max-w-[85%] rounded-lg px-3 py-1.5 text-sm shadow-sm sm:max-w-[70%]',
                        item.direction === 'outbound' ? 'rounded-tr-none bg-[#d9fdd3]' : 'rounded-tl-none bg-white',
                        item.status === 'failed' && 'ring-1 ring-red-300'
                      )}>
                        {item.template_name && (
                          <div className="mb-0.5 inline-flex items-center gap-1 text-[10.5px] font-semibold text-green-800"><FiFileText /> Template · {item.template_name}</div>
                        )}
                        <MessageMedia message={item} />
                        {(item.text || !(item.has_media || item.media_url)) && <div className="break-words whitespace-pre-wrap">{item.text || ' '}</div>}
                        <div className="mt-0.5 flex items-center justify-end gap-1.5 text-[10.5px] text-slate-500">
                          {item.direction === 'outbound' && item.sent_by_name && <span>{item.sent_by_name} ·</span>}
                          <span title={fullDateTime(item.created_at)}>{timeOf(item.created_at)}</span>
                          {item.direction === 'outbound' && <Ticks status={item.status} />}
                        </div>
                        {item.status === 'failed' && <div className="mt-0.5 text-[11px] text-red-600">Not delivered: {item.error || 'Meta refused it'}</div>}
                      </div>
                    </div>
                  )))}
                  <div ref={bottomRef} />
                </div>
              </div>

              {/* Composer */}
              <div className="shrink-0 border-t border-border bg-card p-3">
                {!configured ? (
                  <div className="text-center text-xs text-muted-foreground">Sending is off until the platform number is set up.</div>
                ) : windowOpen ? (
                  <Composer key={activeId} ref={composerRef} onSendText={sendText} onSendFile={sendFile} onTemplate={() => setTemplateOpen(true)} />
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

        {/* Contact info */}
        {activeId && conversation && (
          <ContactPanel
            key={conversation.id}
            conversation={conversation}
            workspaces={detail.workspaces || []}
            className={cn(showInfo ? 'fixed inset-y-0 right-0 z-30 flex w-80 shadow-xl xl:static xl:shadow-none' : 'hidden xl:flex')}
            onClose={() => setShowInfo(false)}
            onSave={(changes) => updateConversation(changes, 'Saved')}
          />
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
      <NewChatDialog
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        templates={templates}
        onStarted={(id) => { loadConversations({ quiet: true }); openChat(id); }}
      />
    </div>
  );
};

const ContactPanel = ({ conversation, workspaces, className, onClose, onSave }) => {
  const [name, setName] = useState(conversation.name || '');
  const [note, setNote] = useState(conversation.note || '');
  const dirty = name !== (conversation.name || '') || note !== (conversation.note || '');
  return (
    <aside className={cn('w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l border-border bg-card p-4', className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Contact info</span>
        <Button variant="ghost" size="icon" className="size-7 xl:hidden" onClick={onClose} aria-label="Close"><FiX /></Button>
      </div>
      <div className="flex flex-col items-center gap-2 text-center">
        <Avatar name={conversation.name || conversation.wa_id} size="size-16 text-xl" />
        <div className="font-semibold">{conversation.name || formatNumber(conversation.wa_id)}</div>
        <div className="text-xs text-muted-foreground">{formatNumber(conversation.wa_id)}</div>
        {conversation.profile_name && conversation.profile_name !== conversation.name && (
          <div className="text-[11px] text-muted-foreground">WhatsApp name: {conversation.profile_name}</div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Getnera customer</div>
        {workspaces.length ? workspaces.map((w) => (
          <a key={w.tenant_id} href={`/dashboard/workspaces/${w.tenant_id}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">
            <span className="min-w-0">
              <span className="block truncate font-semibold">{w.name}</span>
              <span className="block text-[11px] text-muted-foreground">{w.matched_by} · {w.status}</span>
            </span>
            <FiExternalLink className="shrink-0 text-muted-foreground" />
          </a>
        )) : <div className="text-xs text-muted-foreground">This number is not linked to any workspace.</div>}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ci-name" className="text-xs">Name</Label>
          <Input id="ci-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={conversation.profile_name || 'Add a name'} maxLength={80} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ci-note" className="text-xs">Internal note</Label>
          <Textarea id="ci-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Only staff see this" maxLength={2000} />
        </div>
        <Button size="sm" disabled={!dirty} onClick={() => onSave({ name, note })}>Save</Button>
      </div>
      <div className="text-[11px] text-muted-foreground">
        Reply window {conversation.window_open ? `closes ${relativeTime(conversation.window_closes_at)}` : 'is closed'}.
      </div>
    </aside>
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
