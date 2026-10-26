import React, { useEffect, useRef, useState } from 'react';
import { FiPlus, FiSend, FiX } from 'react-icons/fi';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { FileTile, extensionOf, formatSize } from './ChatMedia';

export const MAX_FILE = 100 * 1024 * 1024; // WhatsApp documents: 100 MB
export const MAX_FILES = 10;

let nextId = 0;
// Wraps picked files for the preview; image and video files get a preview URL.
export const toPending = (files) => files.map((file) => ({
  id: `f${++nextId}`,
  file,
  caption: '',
  preview: /^(image|video)\//.test(file.type) ? URL.createObjectURL(file) : null,
}));

const Big = ({ item }) => {
  const { file, preview } = item;
  if (preview && file.type.startsWith('image/')) return <img src={preview} alt={file.name} className="max-h-full max-w-full rounded object-contain shadow" />;
  if (preview && file.type.startsWith('video/')) return <video src={preview} controls className="max-h-full max-w-full rounded bg-black shadow" />;
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <FileTile name={file.name} className="size-24 rounded-xl [&_svg]:size-12" />
      <div className="max-w-md truncate text-lg font-medium">{file.name}</div>
      <div className="text-sm text-slate-500">{[formatSize(file.size), extensionOf(file.name)].filter(Boolean).join(' · ')}</div>
      <div className="text-xs text-slate-400">No preview available</div>
    </div>
  );
};

/**
 * Full-screen send preview over the chat, like WhatsApp: a large preview,
 * a caption per file, thumbnails to switch between files, + to add more.
 * `onSend(item, caption, onProgress)` sends one file.
 */
export const SendPreview = ({ items, onItems, onClose, onSend }) => {
  const [current, setCurrent] = useState(0);
  const [sending, setSending] = useState(null); // { index, percent }
  const addRef = useRef(null);
  const captionRef = useRef(null);
  const item = items[Math.min(current, items.length - 1)];

  useEffect(() => { captionRef.current?.focus(); }, [current]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !sending) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, sending]);
  if (!item) return null;

  const setCaption = (caption) => onItems(items.map((x) => (x.id === item.id ? { ...x, caption } : x)));
  const remove = (id) => {
    const left = items.filter((x) => x.id !== id);
    const gone = items.find((x) => x.id === id);
    if (gone?.preview) URL.revokeObjectURL(gone.preview);
    if (!left.length) { onClose(); return; }
    onItems(left);
    setCurrent((c) => Math.min(c, left.length - 1));
  };

  const sendAll = async () => {
    const queue = [...items];
    for (let i = 0; i < queue.length; i++) {
      setSending({ index: i, percent: 0 });
      try {
        await onSend(queue[i], queue[i].caption.trim(), (percent) => setSending({ index: i, percent }));
      } catch {
        // Keep what was not sent; the page showed why.
        queue.slice(0, i).forEach((x) => x.preview && URL.revokeObjectURL(x.preview));
        onItems(queue.slice(i));
        setCurrent(0);
        setSending(null);
        return;
      }
    }
    queue.forEach((x) => x.preview && URL.revokeObjectURL(x.preview));
    setSending(null);
    onItems([]);
    onClose();
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[#e9edef]">
      <div className="flex h-14 shrink-0 items-center gap-3 px-4">
        <button type="button" onClick={onClose} disabled={Boolean(sending)} className="flex size-9 cursor-pointer items-center justify-center rounded-full hover:bg-black/5 disabled:opacity-40" aria-label="Close preview">
          <FiX className="size-5" />
        </button>
        <div className="min-w-0 flex-1 truncate text-center text-sm font-medium text-slate-700">{item.file.name}</div>
        <span className="w-9" />
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <Big key={item.id} item={item} />
      </div>

      <div className="mx-auto w-full max-w-2xl px-4 pb-3">
        <input
          ref={captionRef}
          value={item.caption}
          onChange={(e) => setCaption(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !sending) { e.preventDefault(); sendAll(); } }}
          placeholder={item.file.type.startsWith('audio/') ? 'Audio files have no caption' : 'Add a caption'}
          disabled={item.file.type.startsWith('audio/') || Boolean(sending)}
          maxLength={1024}
          className="h-11 w-full rounded-lg border-none bg-white px-4 text-sm shadow-sm outline-none placeholder:text-slate-400"
        />
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-black/5 bg-[#e9edef] px-4 py-3">
        <div className="no-scrollbar flex min-w-0 flex-1 items-center justify-center gap-2 overflow-x-auto py-1">
          {items.map((x, i) => (
            <div key={x.id} className="group relative shrink-0">
              <button
                type="button"
                onClick={() => setCurrent(i)}
                className={cn('flex size-14 cursor-pointer items-center justify-center overflow-hidden rounded-md border-2 bg-white', i === current ? 'border-[#25D366]' : 'border-transparent')}
              >
                {x.preview && x.file.type.startsWith('image/') ? <img src={x.preview} alt="" className="size-full object-cover" /> : <FileTile name={x.file.name} className="size-9" />}
                {sending?.index === i && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-[10px] font-bold text-white">{sending.percent}%</span>
                )}
              </button>
              {!sending && (
                <button type="button" onClick={() => remove(x.id)} className="absolute -top-1.5 -right-1.5 hidden size-5 cursor-pointer items-center justify-center rounded-full bg-slate-700 text-white group-hover:flex" aria-label={`Remove ${x.file.name}`}>
                  <FiX className="size-3" />
                </button>
              )}
            </div>
          ))}
          {items.length < MAX_FILES && !sending && (
            <button type="button" onClick={() => addRef.current?.click()} className="flex size-14 shrink-0 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-slate-400 text-slate-500 hover:bg-white" aria-label="Add more files">
              <FiPlus className="size-5" />
            </button>
          )}
          <input
            ref={addRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const room = MAX_FILES - items.length;
              const picked = [...e.target.files].filter((f) => f.size <= MAX_FILE).slice(0, room);
              if (picked.length) onItems([...items, ...toPending(picked)]);
              e.target.value = '';
            }}
          />
        </div>
        <button
          type="button"
          onClick={sendAll}
          disabled={Boolean(sending)}
          className="relative flex size-14 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg hover:bg-[#1fb857] disabled:opacity-70"
          aria-label="Send"
        >
          {sending ? <Spinner /> : <FiSend className="size-6" />}
          {items.length > 1 && !sending && <span className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-white text-[11px] font-bold text-green-700 shadow">{items.length}</span>}
        </button>
      </div>
    </div>
  );
};
