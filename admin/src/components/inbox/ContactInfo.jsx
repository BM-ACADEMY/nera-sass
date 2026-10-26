import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FiArrowLeft, FiCheck, FiChevronRight, FiExternalLink, FiPlay, FiPlus, FiTrash2, FiX } from 'react-icons/fi';
import axiosClient from '../../api/axiosClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { FileTile, extensionOf, formatSize, useMediaSrc } from './ChatMedia';

const apiError = (err, fallback) => err.response?.data?.error || fallback;

// Same label always gets the same colour.
const LABEL_COLORS = ['bg-green-100 text-green-800', 'bg-blue-100 text-blue-800', 'bg-amber-100 text-amber-800', 'bg-pink-100 text-pink-800', 'bg-violet-100 text-violet-800', 'bg-teal-100 text-teal-800', 'bg-red-100 text-red-800'];
export const labelColor = (label) => LABEL_COLORS[[...String(label).toLowerCase()].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % LABEL_COLORS.length];

export const LabelChip = ({ label, onRemove, className }) => (
  <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', labelColor(label), className)}>
    {label}
    {onRemove && <button type="button" onClick={onRemove} className="cursor-pointer opacity-60 hover:opacity-100" aria-label={`Remove ${label}`}><FiX className="size-3" /></button>}
  </span>
);

/** Photos, documents and links of one chat, reloaded when `refreshKey` changes. */
export function useShared(conversationId, refreshKey) {
  const [data, setData] = useState(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!conversationId) return undefined;
    let cancelled = false;
    axiosClient.get(`/admin/inbox/conversations/${conversationId}/shared`)
      .then((res) => !cancelled && setData(res.data))
      .catch(() => !cancelled && setData({ media: [], documents: [], links: [] }));
    return () => { cancelled = true; };
  }, [conversationId, refreshKey, reload]);
  return { data, refresh: () => setReload((n) => n + 1) };
}

const PanelHeader = ({ icon, onClick, label, title, children }) => (
  <div className="flex h-14 shrink-0 items-center gap-4 border-b border-border px-4">
    <button type="button" onClick={onClick} className="flex size-8 cursor-pointer items-center justify-center rounded-full hover:bg-muted" aria-label={label}>{icon}</button>
    <span className="flex-1 text-[15px] font-medium">{title}</span>
    {children}
  </div>
);

const Thumb = ({ message, className, children, onClick }) => {
  const { src } = useMediaSrc(message);
  return (
    <button type="button" onClick={onClick} className={cn('relative aspect-square cursor-pointer overflow-hidden rounded-md bg-muted', className)}>
      {src && (message.type === 'video'
        ? <><video src={src} preload="metadata" className="size-full object-cover" muted /><FiPlay className="absolute inset-0 m-auto size-6 fill-white text-white drop-shadow" /></>
        : <img src={src} alt="" className="size-full object-cover" />)}
      {children}
    </button>
  );
};

/** Right side "Contact info", opened from the chat header like WhatsApp. */
export const ContactInfoPanel = ({ conversation, workspaces, staff, knownLabels, shared, onClose, onSave, onOpenShared, onOpenImage }) => {
  const [name, setName] = useState(conversation.name || '');
  const [note, setNote] = useState(conversation.note || '');
  const [draft, setDraft] = useState('');
  useEffect(() => { setName(conversation.name || ''); setNote(conversation.note || ''); }, [conversation.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = name !== (conversation.name || '') || note !== (conversation.note || '');
  const labels = conversation.labels || [];
  const count = shared ? shared.media.length + shared.documents.length + shared.links.length : 0;

  const addLabel = (value) => {
    const label = value.trim();
    setDraft('');
    if (!label || labels.some((l) => l.toLowerCase() === label.toLowerCase())) return;
    onSave({ labels: [...labels, label] });
  };
  const suggestions = knownLabels.filter((l) => !labels.some((x) => x.toLowerCase() === l.toLowerCase()) && l.toLowerCase().includes(draft.trim().toLowerCase())).slice(0, 6);

  return (
    <>
      <PanelHeader icon={<FiX className="size-5" />} onClick={onClose} label="Close contact info" title="Contact info" />
      <div className="min-h-0 flex-1 overflow-y-auto bg-[#f0f2f5]">
        <div className="flex flex-col items-center gap-1 bg-white px-4 pt-7 pb-6 text-center">
          <span className="mb-3 flex size-36 items-center justify-center rounded-full bg-green-100 text-5xl font-bold text-green-700">
            {String(conversation.name || conversation.wa_id || '?').trim().charAt(0).toUpperCase()}
          </span>
          <div className="text-xl">{conversation.name || `+${conversation.wa_id}`}</div>
          <div className="text-sm text-muted-foreground">+{conversation.wa_id}</div>
          {conversation.profile_name && conversation.profile_name !== conversation.name && <div className="text-xs text-muted-foreground">~{conversation.profile_name}</div>}
        </div>

        <div className="mt-2 bg-white px-4 py-3">
          <button type="button" onClick={onOpenShared} className="flex w-full cursor-pointer items-center justify-between py-1 text-left text-sm text-slate-600 hover:text-slate-900">
            <span>Media, links and docs</span>
            <span className="flex items-center gap-1 text-xs">{count || ''}<FiChevronRight /></span>
          </button>
          {shared?.media.length > 0 && (
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {shared.media.slice(0, 4).map((m) => <Thumb key={m.id} message={m} onClick={() => (m.type === 'video' ? onOpenShared() : onOpenImage(m, shared.media))} />)}
            </div>
          )}
        </div>

        <div className="mt-2 flex flex-col gap-3 bg-white px-4 py-4">
          <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Getnera customer</div>
          {workspaces.length ? workspaces.map((w) => (
            <a key={w.tenant_id} href={`/dashboard/workspaces/${w.tenant_id}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">
              <span className="min-w-0"><span className="block truncate font-semibold">{w.name}</span><span className="block text-[11px] text-muted-foreground">{w.matched_by} · {w.status}</span></span>
              <FiExternalLink className="shrink-0 text-muted-foreground" />
            </a>
          )) : <div className="text-xs text-muted-foreground">This number is not linked to any workspace.</div>}
        </div>

        <div className="mt-2 flex flex-col gap-3 bg-white px-4 py-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Assigned to</Label>
            <Select value={conversation.assigned_to ? String(conversation.assigned_to) : 'none'} onValueChange={(v) => onSave({ assigned_to: v === 'none' ? null : Number(v) })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nobody</SelectItem>
                {staff.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Labels</Label>
            {labels.length > 0 && <div className="flex flex-wrap gap-1">{labels.map((l) => <LabelChip key={l} label={l} onRemove={() => onSave({ labels: labels.filter((x) => x !== l) })} />)}</div>}
            {labels.length < 10 && (
              <form onSubmit={(e) => { e.preventDefault(); addLabel(draft); }} className="flex gap-1.5">
                <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Hot lead, Paid, Demo booked…" maxLength={24} className="h-8 text-xs" />
                <button type="submit" disabled={!draft.trim()} className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border hover:bg-muted disabled:opacity-40" aria-label="Add label"><FiPlus /></button>
              </form>
            )}
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {suggestions.map((l) => <button key={l} type="button" onClick={() => addLabel(l)} className="cursor-pointer rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted">+ {l}</button>)}
              </div>
            )}
          </div>
        </div>

        <div className="mt-2 flex flex-col gap-3 bg-white px-4 py-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ci-name" className="text-xs">Name</Label>
            <Input id="ci-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={conversation.profile_name || 'Add a name'} maxLength={80} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ci-note" className="text-xs">Internal note</Label>
            <Textarea id="ci-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Only staff see this" maxLength={2000} />
          </div>
          <Button size="sm" disabled={!dirty} onClick={() => onSave({ name, note }, 'Saved')}>Save</Button>
        </div>
      </div>
    </>
  );
};

const monthOf = (d) => {
  const date = new Date(d);
  const now = new Date();
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) return 'This month';
  return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};
const byMonth = (rows) => rows.reduce((groups, row) => {
  const key = monthOf(row.created_at);
  const last = groups[groups.length - 1];
  if (last?.month === key) last.rows.push(row); else groups.push({ month: key, rows: [row] });
  return groups;
}, []);

const Check = ({ on }) => (
  <span className={cn('absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded border-2 shadow', on ? 'border-[#25D366] bg-[#25D366] text-white' : 'border-white bg-black/20 text-transparent')}>
    <FiCheck className="size-3.5" />
  </span>
);

/**
 * "Media, links and docs" of one chat: Media / Docs / Links tabs grouped by
 * month. Hover shows a checkbox; selected files can be deleted, which removes
 * them from the media server too.
 */
export const SharedMediaPanel = ({ shared, onBack, onOpenImage, onDeleted }) => {
  const [tab, setTab] = useState('media');
  const [selected, setSelected] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);
  useEffect(() => { setSelected(new Set()); }, [tab]);

  const rows = useMemo(() => (!shared ? [] : tab === 'media' ? shared.media : tab === 'docs' ? shared.documents : shared.links), [shared, tab]);
  const groups = useMemo(() => byMonth(rows), [rows]);
  const toggle = (id) => setSelected((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const selecting = selected.size > 0;

  const remove = async () => {
    const ids = [...selected];
    if (!window.confirm(`Delete ${ids.length} ${ids.length === 1 ? 'message' : 'messages'}? The files are deleted from the media server for good. The customer's phone keeps its copy.`)) return;
    setDeleting(true);
    try {
      const res = await axiosClient.post('/admin/inbox/messages/delete', { ids });
      toast.success(`Deleted ${res.data.deleted}`);
      setSelected(new Set());
      onDeleted(ids);
    } catch (err) {
      toast.error(apiError(err, 'Could not delete'));
    } finally {
      setDeleting(false);
    }
  };

  const tabs = [['media', 'Media'], ['docs', 'Docs'], ['links', 'Links']];
  return (
    <>
      {selecting ? (
        <PanelHeader icon={<FiX className="size-5" />} onClick={() => setSelected(new Set())} label="Clear selection" title={`${selected.size} selected`}>
          <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={remove} disabled={deleting}><FiTrash2 /> Delete</Button>
        </PanelHeader>
      ) : (
        <PanelHeader icon={<FiArrowLeft className="size-5" />} onClick={onBack} label="Back to contact info" title="Media, links and docs" />
      )}
      <div className="grid shrink-0 grid-cols-3 border-b border-border">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cn('cursor-pointer border-b-[3px] py-3 text-sm', tab === k ? 'border-[#25D366] font-medium text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700')}>
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {!shared ? (
          <div className="mt-4 grid grid-cols-3 gap-1.5">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="aspect-square" />)}</div>
        ) : !rows.length ? (
          <div className="py-12 text-center text-sm text-muted-foreground">{tab === 'media' ? 'No photos or videos' : tab === 'docs' ? 'No documents' : 'No links'}</div>
        ) : groups.map((g) => (
          <div key={g.month}>
            <div className="pt-5 pb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">{g.month}</div>
            {tab === 'media' ? (
              <div className="grid grid-cols-3 gap-1.5">
                {g.rows.map((m) => (
                  <div key={m.id} className="group relative">
                    <Thumb message={m} className="w-full" onClick={() => (selecting ? toggle(m.id) : m.type === 'video' ? null : onOpenImage(m, shared.media))} />
                    <button type="button" onClick={() => toggle(m.id)} className={cn('absolute inset-x-0 top-0 h-9 cursor-pointer', !selecting && !selected.has(m.id) && 'opacity-0 group-hover:opacity-100')} aria-label="Select">
                      <Check on={selected.has(m.id)} />
                    </button>
                  </div>
                ))}
              </div>
            ) : tab === 'docs' ? (
              <div className="flex flex-col gap-1">
                {g.rows.map((m) => <DocRow key={m.id} message={m} selected={selected.has(m.id)} selecting={selecting} onToggle={() => toggle(m.id)} />)}
              </div>
            ) : (
              <div className="flex flex-col">
                {g.rows.map((l, i) => (
                  <a key={`${l.message_id}-${i}`} href={l.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-md p-2 text-xs text-sky-700 hover:bg-muted">
                    <FiExternalLink className="shrink-0" /> <span className="truncate">{l.url}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
};

const DocRow = ({ message, selected, selecting, onToggle }) => {
  const { src } = useMediaSrc(message);
  const name = message.filename || (message.type === 'audio' ? 'Voice message' : 'Document');
  return (
    <div className={cn('group flex items-center gap-2.5 rounded-md p-2 hover:bg-muted', selected && 'bg-green-50')}>
      <button type="button" onClick={onToggle} className={cn('flex size-5 shrink-0 cursor-pointer items-center justify-center rounded border-2', selected ? 'border-[#25D366] bg-[#25D366] text-white' : 'border-slate-300 text-transparent', !selecting && !selected && 'opacity-0 group-hover:opacity-100')} aria-label="Select">
        <FiCheck className="size-3.5" />
      </button>
      <a href={selecting ? undefined : src || undefined} onClick={selecting ? (e) => { e.preventDefault(); onToggle(); } : undefined} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center gap-2.5">
        <FileTile name={message.type === 'audio' ? 'a.ogg' : name} className="size-9" />
        <span className="min-w-0">
          <span className="block truncate text-sm">{name}</span>
          <span className="block text-[11px] text-muted-foreground">{[formatSize(message.file_size), extensionOf(name)].filter(Boolean).join(' · ')}</span>
        </span>
      </a>
    </div>
  );
};

const stamp = (d) => {
  if (!d) return null;
  const date = new Date(d);
  const today = new Date().toDateString() === date.toDateString();
  return `${today ? 'Today' : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} at ${date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
};

/** WhatsApp's "Message info": the message, then when it was read and delivered. */
export const MessageInfoPanel = ({ message, preview, onClose }) => (
  <>
    <PanelHeader icon={<FiX className="size-5" />} onClick={onClose} label="Close message info" title="Message info" />
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex justify-end bg-[#efeae2] px-4 py-5">{preview}</div>
      <div className="flex flex-col gap-6 px-6 py-6">
        {message.status === 'failed' ? (
          <div className="text-sm text-red-600">Not delivered: {message.error || 'Meta refused it'}</div>
        ) : (
          <>
            <div>
              <div className="flex items-center gap-2 text-[15px]"><span className="text-sky-500">✓✓</span> Read</div>
              <div className="mt-0.5 pl-7 text-sm text-slate-500">{stamp(message.read_at) || '—'}</div>
            </div>
            <div>
              <div className="flex items-center gap-2 text-[15px]"><span className="text-slate-500">✓✓</span> Delivered</div>
              <div className="mt-0.5 pl-7 text-sm text-slate-500">{stamp(message.delivered_at) || '—'}</div>
            </div>
            <div>
              <div className="flex items-center gap-2 text-[15px]"><span className="text-slate-500">✓</span> Sent</div>
              <div className="mt-0.5 pl-7 text-sm text-slate-500">{stamp(message.created_at)}</div>
            </div>
          </>
        )}
      </div>
    </div>
  </>
);
