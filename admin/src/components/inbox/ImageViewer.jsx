import React, { useEffect } from 'react';
import { FiChevronLeft, FiChevronRight, FiDownload, FiX } from 'react-icons/fi';
import { saveFile, useMediaSrc } from './ChatMedia';
import { cn } from '@/lib/utils';

const Picture = ({ message, className }) => {
  const { src } = useMediaSrc(message);
  return src ? <img src={src} alt={message.text || 'Photo'} className={className} /> : <div className={cn('animate-pulse bg-white/10', className)} />;
};

const Download = ({ message }) => {
  const { src } = useMediaSrc(message);
  return (
    <button type="button" disabled={!src} onClick={() => saveFile(src, message.filename || `photo-${message.id}.jpg`)} className="flex size-10 cursor-pointer items-center justify-center rounded-full text-white hover:bg-white/10 disabled:opacity-40" aria-label="Download">
      <FiDownload className="size-5" />
    </button>
  );
};

/**
 * Full-screen photo viewer for one chat: arrows or ← → keys move through the
 * chat's photos, Esc closes.
 */
export const ImageViewer = ({ images, index, onIndex, onClose }) => {
  const current = images[index];
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      if (e.key === 'ArrowRight' && index < images.length - 1) onIndex(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, images.length, onClose, onIndex]);
  if (!current) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95" role="dialog" aria-label="Photo viewer">
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <div className="min-w-0 text-sm">
          <div className="font-semibold">{current.direction === 'outbound' ? 'You' : 'Customer'} · {new Date(current.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>
          <div className="text-xs text-white/60">{index + 1} of {images.length}</div>
        </div>
        <div className="flex items-center gap-1">
          <Download message={current} />
          <button type="button" onClick={onClose} className="flex size-10 cursor-pointer items-center justify-center rounded-full text-white hover:bg-white/10" aria-label="Close"><FiX className="size-6" /></button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-14" onClick={onClose}>
        <div onClick={(e) => e.stopPropagation()} className="flex max-h-full flex-col items-center gap-3">
          <Picture key={current.id} message={current} className="max-h-[75vh] max-w-full rounded object-contain" />
          {current.text && <div className="max-w-xl text-center text-sm text-white/90">{current.text}</div>}
        </div>
        {index > 0 && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onIndex(index - 1); }} className="absolute left-3 flex size-11 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="Previous photo">
            <FiChevronLeft className="size-6" />
          </button>
        )}
        {index < images.length - 1 && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onIndex(index + 1); }} className="absolute right-3 flex size-11 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="Next photo">
            <FiChevronRight className="size-6" />
          </button>
        )}
      </div>

      {images.length > 1 && (
        <div className="flex justify-center gap-2 overflow-x-auto px-4 py-3">
          {images.map((m, i) => (
            <button key={m.id} type="button" onClick={() => onIndex(i)} className={cn('shrink-0 cursor-pointer overflow-hidden rounded border-2', i === index ? 'border-[#25D366]' : 'border-transparent opacity-60 hover:opacity-100')}>
              <Picture message={m} className="size-14 object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
