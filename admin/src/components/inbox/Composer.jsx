import React, { lazy, Suspense, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FiCamera, FiFileText, FiHeadphones, FiImage, FiList, FiMapPin, FiMic, FiPaperclip, FiSend, FiSmile, FiTrash2, FiUser, FiX, FiZap } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { FileTile, extensionOf, formatSize } from './ChatMedia';
import { QuotedMessage } from './ChatCards';

// The picker is large; load it the first time someone opens it.
const EmojiPicker = lazy(() => import('emoji-picker-react'));

const MAX_FILE = 100 * 1024 * 1024; // WhatsApp documents: 100 MB
const MAX_FILES = 10;
const MAX_RECORDING_SECONDS = 15 * 60;
const BARS = 40;

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Records a voice note with a live waveform. */
const VoiceRecorder = ({ onCancel, onSend }) => {
  const [levels, setLevels] = useState(() => Array(BARS).fill(0.06));
  const [seconds, setSeconds] = useState(0);
  const rec = useRef({});

  const cleanup = () => {
    const r = rec.current;
    cancelAnimationFrame(r.raf);
    clearInterval(r.timer);
    r.stream?.getTracks().forEach((t) => t.stop());
    r.ctx?.close().catch(() => {});
  };

  const finish = (send) => {
    const r = rec.current;
    if (!r.recorder || r.recorder.state === 'inactive') { cleanup(); onCancel(); return; }
    r.recorder.onstop = () => {
      const blob = new Blob(r.chunks, { type: r.recorder.mimeType || 'audio/webm' });
      cleanup();
      if (send && blob.size) onSend(blob); else onCancel();
    };
    r.recorder.stop();
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        const mimeType = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => window.MediaRecorder?.isTypeSupported?.(t));
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        const chunks = [];
        recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        recorder.start(250);

        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        let last = 0;
        const started = Date.now();
        const tick = (t) => {
          if (t - last > 80) {
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (const v of data) sum += ((v - 128) / 128) ** 2;
            const level = Math.min(1, Math.max(0.06, Math.sqrt(sum / data.length) * 5));
            setLevels((prev) => [...prev.slice(1), level]);
            last = t;
          }
          rec.current.raf = requestAnimationFrame(tick);
        };
        rec.current = { stream, recorder, chunks, ctx, raf: requestAnimationFrame(tick) };
        rec.current.timer = setInterval(() => {
          const s = (Date.now() - started) / 1000;
          setSeconds(s);
          if (s >= MAX_RECORDING_SECONDS) finish(true);
        }, 250);
      } catch {
        toast.error('Allow the microphone in the browser to record a voice note.');
        onCancel();
      }
    })();
    return () => { cancelled = true; cleanup(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-1 items-center gap-2">
      <Button variant="ghost" size="icon" className="shrink-0 text-red-500 hover:text-red-600" onClick={() => finish(false)} title="Discard" aria-label="Discard recording"><FiTrash2 /></Button>
      <span className="flex items-center gap-1.5 text-sm font-medium tabular-nums">
        <span className="size-2.5 animate-pulse rounded-full bg-red-500" />
        {clock(seconds)}
      </span>
      <div className="flex h-9 min-w-0 flex-1 items-center gap-[3px] overflow-hidden rounded-full bg-muted px-3" aria-hidden>
        {levels.map((level, i) => (
          <span key={i} className="w-[3px] shrink-0 rounded-full bg-[#25D366] transition-[height] duration-75" style={{ height: `${Math.round(level * 100)}%` }} />
        ))}
      </div>
      <Button size="icon" className="shrink-0 bg-[#25D366] hover:bg-[#1fb857]" onClick={() => finish(true)} aria-label="Send voice message"><FiSend /></Button>
    </div>
  );
};

const ATTACH_OPTIONS = [
  { key: 'document', label: 'Document', Icon: FiFileText, color: 'text-violet-600', accept: '*/*' },
  { key: 'media', label: 'Photos & videos', Icon: FiImage, color: 'text-blue-600', accept: 'image/*,video/*' },
  { key: 'camera', label: 'Camera', Icon: FiCamera, color: 'text-pink-600', accept: 'image/*', capture: 'environment' },
  { key: 'audio', label: 'Audio', Icon: FiHeadphones, color: 'text-orange-500', accept: 'audio/*' },
];

// Messages built in a dialog by the page (onSpecial(key)).
const SPECIAL_OPTIONS = [
  { key: 'location', label: 'Location', Icon: FiMapPin, color: 'text-red-500' },
  { key: 'contact', label: 'Contact', Icon: FiUser, color: 'text-sky-600' },
  { key: 'interactive', label: 'Buttons or list', Icon: FiList, color: 'text-amber-500' },
];

/**
 * WhatsApp-style message box: emoji, attachments (any file, also pasted or
 * dropped), captions and voice notes. `ref.addFiles(files)` lets the chat
 * area hand over dropped files.
 */
export const Composer = ({
  ref, onSendText, onSendFile, onTemplate, onSpecial, onTyping,
  replyingTo, onCancelReply, customerName, quickReplies = [], onManageQuickReplies,
}) => {
  const [text, setText] = useState('');
  const [pick, setPick] = useState(0); // highlighted quick reply
  const [files, setFiles] = useState([]); // { id, file, preview }
  const [recording, setRecording] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(null);
  const textRef = useRef(null);
  const emojiRef = useRef(null);
  const inputs = useRef({});

  const addFiles = (list) => {
    const incoming = [...(list || [])];
    if (!incoming.length) return;
    const tooBig = incoming.filter((f) => f.size > MAX_FILE);
    if (tooBig.length) toast.error(`${tooBig.map((f) => f.name).join(', ')}: a file can be at most 100 MB`);
    setFiles((current) => {
      const room = MAX_FILES - current.length;
      const ok = incoming.filter((f) => f.size <= MAX_FILE);
      if (ok.length > room) toast.error(`You can send up to ${MAX_FILES} files at once`);
      return [...current, ...ok.slice(0, Math.max(0, room)).map((file) => ({
        id: `${file.name}-${file.size}-${Math.random()}`,
        file,
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      }))];
    });
    textRef.current?.focus();
  };

  useImperativeHandle(ref, () => ({ addFiles, focus: () => textRef.current?.focus() }));

  // "/pri" shows saved replies whose shortcut starts with "pri".
  const slash = /^\/(\S*)$/.exec(text);
  const matches = slash ? quickReplies.filter((q) => q.shortcut.startsWith(slash[1].toLowerCase())).slice(0, 8) : [];
  useEffect(() => { setPick(0); }, [text]);
  const insertQuickReply = (q) => {
    setText(q.text);
    requestAnimationFrame(() => textRef.current?.focus());
  };

  useEffect(() => () => files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!emojiOpen) return undefined;
    const close = (e) => { if (!emojiRef.current?.contains(e.target)) setEmojiOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [emojiOpen]);

  const removeFile = (id) => setFiles((list) => list.filter((f) => {
    if (f.id === id && f.preview) URL.revokeObjectURL(f.preview);
    return f.id !== id;
  }));

  const insertEmoji = (emoji) => {
    const el = textRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const send = async () => {
    if (sending) return;
    const body = text.trim();
    if (!files.length && !body) return;
    setSending(true);
    try {
      if (files.length) {
        const queue = [...files];
        for (let i = 0; i < queue.length; i++) {
          setProgress({ index: i + 1, total: queue.length, percent: 0 });
          await onSendFile(queue[i].file, { caption: i === 0 ? body : '', onProgress: (percent) => setProgress({ index: i + 1, total: queue.length, percent }) });
          removeFile(queue[i].id);
        }
      } else {
        await onSendText(body);
      }
      setText('');
    } catch {
      // The page shows the error; unsent files stay in the tray.
    } finally {
      setSending(false);
      setProgress(null);
    }
  };

  const sendVoice = async (blob) => {
    setRecording(false);
    setSending(true);
    try {
      const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
      await onSendFile(new File([blob], `voice.${ext}`, { type: blob.type }), { voice: true });
    } catch {
      // shown by the page
    } finally {
      setSending(false);
    }
  };

  const onPaste = (e) => {
    const pasted = [...(e.clipboardData?.files || [])];
    if (pasted.length) {
      e.preventDefault();
      addFiles(pasted);
    }
  };

  const canSend = files.length > 0 || text.trim().length > 0;

  return (
    <div className="relative flex flex-col gap-2">
      {matches.length > 0 && (
        <div className="absolute bottom-full left-0 z-30 mb-2 w-full max-w-md overflow-hidden rounded-lg border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
            <span>Quick replies · ↑ ↓ to choose, Enter or Tab to insert</span>
            {onManageQuickReplies && <button type="button" onClick={onManageQuickReplies} className="cursor-pointer font-semibold text-green-700 hover:underline">Manage</button>}
          </div>
          {matches.map((q, i) => (
            <button key={q.id} type="button" onMouseDown={(e) => { e.preventDefault(); insertQuickReply(q); }} onMouseEnter={() => setPick(i)} className={cn('flex w-full cursor-pointer flex-col px-3 py-2 text-left', i === pick && 'bg-green-50')}>
              <span className="text-xs font-semibold text-green-700">/{q.shortcut}</span>
              <span className="line-clamp-1 text-xs text-muted-foreground">{q.text}</span>
            </button>
          ))}
        </div>
      )}
      {replyingTo && (
        <div className="flex items-center gap-2">
          <QuotedMessage quote={replyingTo} customerName={customerName} className="mb-0 flex-1" onClick={() => textRef.current?.focus()} />
          <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={onCancelReply} aria-label="Cancel reply"><FiX /></Button>
        </div>
      )}
      {files.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {files.map((f) => (
            <div key={f.id} className="relative flex w-36 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-muted/40">
              {f.preview
                ? <img src={f.preview} alt="" className="h-20 w-full object-cover" />
                : <div className="flex h-20 items-center justify-center"><FileTile name={f.file.name} className="size-12" /></div>}
              <div className="px-2 py-1.5">
                <div className="truncate text-xs font-medium" title={f.file.name}>{f.file.name}</div>
                <div className="text-[10.5px] text-muted-foreground">{[formatSize(f.file.size), extensionOf(f.file.name)].filter(Boolean).join(' · ')}</div>
              </div>
              {!sending && (
                <button type="button" onClick={() => removeFile(f.id)} className="absolute top-1 right-1 flex size-6 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80" aria-label={`Remove ${f.file.name}`}>
                  <FiX className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {progress && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>Sending {progress.index} of {progress.total}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-[#25D366] transition-all" style={{ width: `${progress.percent}%` }} /></span>
        </div>
      )}

      <div className="flex items-end gap-1.5">
        {recording ? (
          <VoiceRecorder onCancel={() => setRecording(false)} onSend={sendVoice} />
        ) : (
          <>
            <div ref={emojiRef} className="relative shrink-0">
              <Button variant="ghost" size="icon" onClick={() => setEmojiOpen((v) => !v)} title="Emoji" aria-label="Emoji" className={cn(emojiOpen && 'bg-muted')}><FiSmile /></Button>
              {emojiOpen && (
                <div className="absolute bottom-full left-0 z-30 mb-2 shadow-xl">
                  <Suspense fallback={<div className="flex h-[400px] w-[320px] items-center justify-center rounded-lg border bg-card"><Spinner /></div>}>
                    <EmojiPicker
                      onEmojiClick={(e) => insertEmoji(e.emoji)}
                      emojiStyle="native"
                      lazyLoadEmojis
                      previewConfig={{ showPreview: false }}
                      searchPlaceHolder="Search emoji"
                      width={320}
                      height={400}
                    />
                  </Suspense>
                </div>
              )}
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="shrink-0" title="Attach" aria-label="Attach"><FiPaperclip /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-52">
                {ATTACH_OPTIONS.map((o) => (
                  <DropdownMenuItem key={o.key} onSelect={() => inputs.current[o.key]?.click()} className="gap-3 py-2">
                    <o.Icon className={cn('size-4', o.color)} /> {o.label}
                  </DropdownMenuItem>
                ))}
                {SPECIAL_OPTIONS.map((o) => (
                  <DropdownMenuItem key={o.key} onSelect={() => onSpecial?.(o.key)} className="gap-3 py-2">
                    <o.Icon className={cn('size-4', o.color)} /> {o.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onTemplate} className="gap-3 py-2">
                  <FiFileText className="size-4 text-green-600" /> Template
                </DropdownMenuItem>
                {onManageQuickReplies && (
                  <DropdownMenuItem onSelect={onManageQuickReplies} className="gap-3 py-2">
                    <FiZap className="size-4 text-amber-500" /> Quick replies
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {ATTACH_OPTIONS.map((o) => (
              <input
                key={o.key}
                ref={(el) => { inputs.current[o.key] = el; }}
                type="file"
                accept={o.accept}
                capture={o.capture}
                multiple={!o.capture}
                className="hidden"
                onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
              />
            ))}

            <Textarea
              ref={textRef}
              value={text}
              onChange={(e) => { setText(e.target.value); if (e.target.value.trim()) onTyping?.(); }}
              onPaste={onPaste}
              onKeyDown={(e) => {
                if (matches.length) {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setPick((p) => (p + 1) % matches.length); return; }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setPick((p) => (p - 1 + matches.length) % matches.length); return; }
                  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertQuickReply(matches[pick] || matches[0]); return; }
                  if (e.key === 'Escape') { setText(''); return; }
                }
                if (e.key === 'Escape' && replyingTo) { onCancelReply?.(); return; }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              placeholder={files.length ? 'Add a caption' : 'Type a message, or / for quick replies'}
              rows={1}
              maxLength={files.length ? 1024 : 4096}
              className="max-h-36 min-h-10 resize-none"
            />
            {canSend || sending ? (
              <Button size="icon" className="shrink-0 bg-[#25D366] hover:bg-[#1fb857]" onClick={send} disabled={sending || !canSend} aria-label="Send">
                {sending ? <Spinner /> : <FiSend />}
              </Button>
            ) : (
              <Button size="icon" className="shrink-0 bg-[#25D366] hover:bg-[#1fb857]" onClick={() => setRecording(true)} title="Record a voice message" aria-label="Record a voice message">
                <FiMic />
              </Button>
            )}
          </>
        )}
      </div>
      <div className="hidden text-[10.5px] text-muted-foreground sm:block">Enter to send · Shift+Enter for a new line · / for quick replies · paste or drop files to attach</div>
    </div>
  );
};
