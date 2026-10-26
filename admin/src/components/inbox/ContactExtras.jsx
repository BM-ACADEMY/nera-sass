import React, { useEffect, useState } from 'react';
import { FiExternalLink, FiPlus, FiX } from 'react-icons/fi';
import axiosClient from '../../api/axiosClient';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { FileTile, extensionOf, formatSize, useMediaSrc } from './ChatMedia';

// Same label always gets the same colour.
const LABEL_COLORS = ['bg-green-100 text-green-800', 'bg-blue-100 text-blue-800', 'bg-amber-100 text-amber-800', 'bg-pink-100 text-pink-800', 'bg-violet-100 text-violet-800', 'bg-teal-100 text-teal-800', 'bg-red-100 text-red-800'];
export const labelColor = (label) => LABEL_COLORS[[...String(label).toLowerCase()].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % LABEL_COLORS.length];

export const LabelChip = ({ label, onRemove, className }) => (
  <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', labelColor(label), className)}>
    {label}
    {onRemove && <button type="button" onClick={onRemove} className="cursor-pointer opacity-60 hover:opacity-100" aria-label={`Remove ${label}`}><FiX className="size-3" /></button>}
  </span>
);

const UNASSIGNED = 'none';

/** Who handles the chat, and its labels. `onSave(changes)` patches the chat. */
export const AssignAndLabels = ({ conversation, staff, knownLabels, onSave }) => {
  const [draft, setDraft] = useState('');
  const labels = conversation.labels || [];
  const addLabel = (value) => {
    const label = value.trim();
    setDraft('');
    if (!label || labels.some((l) => l.toLowerCase() === label.toLowerCase())) return;
    onSave({ labels: [...labels, label] });
  };
  const suggestions = knownLabels.filter((l) => !labels.some((x) => x.toLowerCase() === l.toLowerCase()) && l.toLowerCase().includes(draft.trim().toLowerCase())).slice(0, 6);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Assigned to</Label>
        <Select value={conversation.assigned_to ? String(conversation.assigned_to) : UNASSIGNED} onValueChange={(v) => onSave({ assigned_to: v === UNASSIGNED ? null : Number(v) })}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={UNASSIGNED}>Nobody</SelectItem>
            {staff.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Labels</Label>
        {labels.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {labels.map((l) => <LabelChip key={l} label={l} onRemove={() => onSave({ labels: labels.filter((x) => x !== l) })} />)}
          </div>
        )}
        {labels.length < 10 && (
          <form onSubmit={(e) => { e.preventDefault(); addLabel(draft); }} className="flex gap-1.5">
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Hot lead, Paid, Demo booked…" maxLength={24} className="h-8 text-xs" />
            <button type="submit" disabled={!draft.trim()} className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border hover:bg-muted disabled:opacity-40" aria-label="Add label"><FiPlus /></button>
          </form>
        )}
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {suggestions.map((l) => (
              <button key={l} type="button" onClick={() => addLabel(l)} className="cursor-pointer rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted">+ {l}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const Thumb = ({ message, onOpen }) => {
  const { src } = useMediaSrc(message);
  return (
    <button type="button" onClick={() => (message.type === 'video' ? src && window.open(src, '_blank', 'noopener') : onOpen(message))} className="aspect-square cursor-pointer overflow-hidden rounded-md bg-muted">
      {src && (message.type === 'video'
        ? <video src={src} preload="metadata" className="size-full object-cover" muted />
        : <img src={src} alt="" className="size-full object-cover" />)}
    </button>
  );
};

const DocRow = ({ message }) => {
  const { src } = useMediaSrc(message);
  const name = message.filename || (message.type === 'audio' ? 'Voice message' : 'Document');
  return (
    <a href={src || undefined} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 rounded-md p-1.5 hover:bg-muted">
      <FileTile name={message.type === 'audio' ? 'a.ogg' : name} className="size-8" />
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium">{name}</span>
        <span className="block text-[10.5px] text-muted-foreground">{[formatSize(message.file_size), extensionOf(name), new Date(message.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })].filter(Boolean).join(' · ')}</span>
      </span>
    </a>
  );
};

/** "Media, links and docs" of one chat. `onOpenImage` opens a photo in the viewer. */
export const SharedMedia = ({ conversationId, refreshKey, onOpenImage }) => {
  const [tab, setTab] = useState('media');
  const [data, setData] = useState(null);
  useEffect(() => {
    let cancelled = false;
    axiosClient.get(`/admin/inbox/conversations/${conversationId}/shared`)
      .then((res) => !cancelled && setData(res.data))
      .catch(() => !cancelled && setData({ media: [], documents: [], links: [] }));
    return () => { cancelled = true; };
  }, [conversationId, refreshKey]);

  const tabs = [['media', 'Media', data?.media.length], ['docs', 'Docs', data?.documents.length], ['links', 'Links', data?.links.length]];
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Media, links and docs</div>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
        {tabs.map(([k, label, count]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cn('cursor-pointer rounded-md py-1 text-[11px] font-semibold', tab === k ? 'bg-card shadow-sm' : 'text-muted-foreground')}>
            {label}{count ? ` ${count}` : ''}
          </button>
        ))}
      </div>
      {!data ? (
        <div className="grid grid-cols-3 gap-1.5">{[0, 1, 2].map((i) => <Skeleton key={i} className="aspect-square" />)}</div>
      ) : tab === 'media' ? (
        data.media.length
          ? <div className="grid grid-cols-3 gap-1.5">{data.media.map((m) => <Thumb key={m.id} message={m} onOpen={onOpenImage} />)}</div>
          : <div className="py-3 text-center text-xs text-muted-foreground">No photos or videos yet.</div>
      ) : tab === 'docs' ? (
        data.documents.length
          ? <div className="flex flex-col">{data.documents.map((m) => <DocRow key={m.id} message={m} />)}</div>
          : <div className="py-3 text-center text-xs text-muted-foreground">No documents yet.</div>
      ) : (
        data.links.length
          ? (
            <div className="flex flex-col">
              {data.links.map((l, i) => (
                <a key={`${l.message_id}-${i}`} href={l.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-md p-1.5 text-xs text-sky-700 hover:bg-muted">
                  <FiExternalLink className="shrink-0" /> <span className="truncate">{l.url}</span>
                </a>
              ))}
            </div>
          )
          : <div className="py-3 text-center text-xs text-muted-foreground">No links yet.</div>
      )}
    </div>
  );
};
