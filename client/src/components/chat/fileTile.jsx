import React from 'react';
import { FiArchive, FiFile, FiFileText, FiFilm, FiImage, FiMusic } from 'react-icons/fi';
import { cn } from '@/lib/utils';

// File tile and size helpers from admin/src/components/inbox/ChatMedia.jsx (keep equal).

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
