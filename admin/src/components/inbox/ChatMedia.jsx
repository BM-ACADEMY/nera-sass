import React, { useEffect, useRef, useState } from 'react';
import { FiDownload, FiExternalLink, FiFile, FiFileText, FiFilm, FiImage, FiMic, FiMusic, FiArchive, FiPause, FiPlay } from 'react-icons/fi';
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

const PEAKS = 40;

// Loudness of the recording in PEAKS bars (0..1), for the waveform.
async function peaksOf(src) {
  const data = await (await fetch(src)).arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(data);
    const samples = audio.getChannelData(0);
    const size = Math.floor(samples.length / PEAKS) || 1;
    const peaks = Array.from({ length: PEAKS }, (_, i) => {
      let sum = 0;
      for (let j = i * size; j < Math.min(samples.length, (i + 1) * size); j++) sum += samples[j] * samples[j];
      return Math.sqrt(sum / size);
    });
    const max = Math.max(...peaks) || 1;
    return peaks.map((p) => Math.max(0.12, p / max));
  } finally {
    ctx.close().catch(() => {});
  }
}

const mmss = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');

/** WhatsApp-style voice note: avatar with mic, play / pause, waveform you can tap to seek. */
export const VoicePlayer = ({ src, name, outbound }) => {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [peaks, setPeaks] = useState(null);

  useEffect(() => {
    let cancelled = false;
    peaksOf(src).then((p) => !cancelled && setPeaks(p)).catch(() => !cancelled && setPeaks(Array(PEAKS).fill(0.3)));
    return () => { cancelled = true; };
  }, [src]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {}); else a.pause();
  };
  const seek = (e) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    const box = e.currentTarget.getBoundingClientRect();
    a.currentTime = Math.min(duration, Math.max(0, ((e.clientX - box.left) / box.width) * duration));
  };
  const progress = duration ? time / duration : 0;

  return (
    <div className="mb-1 flex w-72 max-w-full items-center gap-2.5 py-1">
      <span className="relative shrink-0">
        <span className={cn('flex size-11 items-center justify-center rounded-full text-base font-bold', outbound ? 'bg-green-600 text-white' : 'bg-violet-100 text-violet-700')}>
          {String(name || '?').trim().charAt(0).toUpperCase()}
        </span>
        <FiMic className={cn('absolute -right-0.5 -bottom-0.5 size-4 rounded-full bg-white p-0.5', playing || time ? 'text-sky-500' : 'text-green-600')} />
      </span>
      <button type="button" onClick={toggle} className="shrink-0 cursor-pointer text-slate-600 hover:text-slate-800" aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <FiPause className="size-6 fill-current" /> : <FiPlay className="size-6 fill-current" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="relative flex h-7 cursor-pointer items-center gap-[2px]" onClick={seek} role="slider" aria-label="Seek" aria-valuenow={Math.round(time)} aria-valuemax={Math.round(duration)}>
          {(peaks || Array(PEAKS).fill(0.2)).map((p, i) => (
            <span key={i} className={cn('flex-1 rounded-full', i / PEAKS < progress ? 'bg-sky-500' : 'bg-slate-400/70')} style={{ height: `${Math.round(p * 100)}%` }} />
          ))}
          <span className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-500 shadow" style={{ left: `${progress * 100}%` }} />
        </div>
        <div className="text-[11px] text-slate-500">{mmss(playing || time ? time : duration)}</div>
      </div>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setTime(0); }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
        className="hidden"
      />
    </div>
  );
};

/** The file part of a chat message: photo, video, voice note, sticker or document card. */
// `onOpenImage(message)`: show a photo in the full-screen viewer.
export const MessageMedia = ({ message, onOpenImage, senderName }) => {
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
  if (message.type === 'audio') return <VoicePlayer src={src} name={senderName} outbound={message.direction === 'outbound'} />;
  return null;
};
