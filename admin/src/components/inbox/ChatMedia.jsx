import React, { useEffect, useState } from 'react';
import { FiDownload, FiExternalLink, FiFile, FiFileText, FiFilm, FiImage, FiMusic, FiArchive } from 'react-icons/fi';
import axiosClient from '../../api/axiosClient';
import { cn } from '@/lib/utils';

export const formatSize = (bytes) => {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const extensionOf = (name = '') => (String(name).includes('.') ? String(name).split('.').pop().toUpperCase().slice(0, 5) : '');

// Colour and icon of a file tile, like WhatsApp's document cards.
const FILE_STYLES = [
  { exts: ['PDF'], className: 'bg-red-500', Icon: FiFileText },
  { exts: ['XLS', 'XLSX', 'CSV', 'ODS'], className: 'bg-green-600', Icon: FiFileText },
  { exts: ['DOC', 'DOCX', 'ODT', 'RTF', 'TXT'], className: 'bg-blue-600', Icon: FiFileText },
  { exts: ['PPT', 'PPTX', 'ODP', 'KEY'], className: 'bg-orange-500', Icon: FiFileText },
  { exts: ['ZIP', 'RAR', '7Z', 'TAR', 'GZ'], className: 'bg-amber-600', Icon: FiArchive },
  { exts: ['JPG', 'JPEG', 'PNG', 'GIF', 'WEBP', 'HEIC', 'SVG', 'BMP'], className: 'bg-purple-500', Icon: FiImage },
  { exts: ['MP4', 'MOV', 'AVI', 'MKV', '3GP', 'WEBM'], className: 'bg-pink-500', Icon: FiFilm },
  { exts: ['MP3', 'WAV', 'OGG', 'M4A', 'AAC', 'AMR', 'OPUS'], className: 'bg-teal-500', Icon: FiMusic },
];

export const FileTile = ({ name, className }) => {
  const ext = extensionOf(name);
  const style = FILE_STYLES.find((s) => s.exts.includes(ext)) || { className: 'bg-slate-500', Icon: FiFile };
  return (
    <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-md text-white', style.className, className)}>
      <style.Icon className="size-5" />
    </span>
  );
};

// A message's file as a URL the browser can show: the signed media-server
// link when there is one, otherwise loaded through the API with the login.
export function useMediaSrc(message) {
  const [src, setSrc] = useState(message.media_url || null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (message.media_url) { setSrc(message.media_url); return undefined; }
    if (!message.has_media || !message.id) return undefined;
    let url = null;
    let cancelled = false;
    axiosClient.get(`/admin/inbox/messages/${message.id}/media`, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        url = URL.createObjectURL(res.data);
        setSrc(url);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [message.id, message.media_url, message.has_media]);
  return { src, failed };
}

// Saves a file under its own name, also when it lives on another origin.
export async function saveFile(src, name) {
  const blob = await (await fetch(src)).blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name || 'file';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const DocumentCard = ({ message, src }) => {
  const name = message.filename || 'Document';
  const meta = [formatSize(message.file_size), extensionOf(name)].filter(Boolean).join(' · ');
  return (
    <div className="w-72 max-w-full overflow-hidden rounded-md bg-black/5">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <FileTile name={name} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" title={name}>{name}</div>
          {meta && <div className="text-[11px] text-slate-500">{meta}</div>}
        </div>
      </div>
      <div className="grid grid-cols-2 border-t border-black/10 text-[13px] font-semibold text-green-700">
        <button type="button" disabled={!src} onClick={() => window.open(src, '_blank', 'noopener')} className="flex cursor-pointer items-center justify-center gap-1.5 py-2 hover:bg-black/5 disabled:opacity-50">
          <FiExternalLink className="size-3.5" /> Open
        </button>
        <button type="button" disabled={!src} onClick={() => saveFile(src, name)} className="flex cursor-pointer items-center justify-center gap-1.5 border-l border-black/10 py-2 hover:bg-black/5 disabled:opacity-50">
          <FiDownload className="size-3.5" /> Save as…
        </button>
      </div>
    </div>
  );
};

/** The file part of a chat message: photo, video, voice note, sticker or document card. */
// `onOpenImage(message)`: show a photo in the full-screen viewer.
export const MessageMedia = ({ message, onOpenImage }) => {
  const { src, failed } = useMediaSrc(message);
  if (!message.has_media && !message.media_url) return null;
  if (failed) return <div className="mb-1 rounded-md bg-black/5 px-3 py-2 text-xs text-slate-500">This file is no longer available on WhatsApp.</div>;

  if (message.type === 'document') return <div className="mb-1"><DocumentCard message={message} src={src} /></div>;
  if (!src) return <div className="mb-1 h-40 w-64 max-w-full animate-pulse rounded-md bg-black/10" />;
  if (message.type === 'image' || message.type === 'sticker') {
    return (
      <button type="button" onClick={() => (onOpenImage ? onOpenImage(message) : window.open(src, '_blank', 'noopener'))} className="mb-1 block cursor-zoom-in">
        <img src={src} alt={message.filename || 'Photo'} className={cn('rounded-md object-cover', message.type === 'sticker' ? 'size-32 bg-transparent' : 'max-h-80 max-w-full sm:max-w-72')} />
      </button>
    );
  }
  if (message.type === 'video') return <video src={src} controls preload="metadata" className="mb-1 max-h-80 max-w-full rounded-md bg-black sm:max-w-72" />;
  if (message.type === 'audio') return <audio src={src} controls preload="metadata" className="mb-1 h-10 w-64 max-w-full" />;
  return null;
};
