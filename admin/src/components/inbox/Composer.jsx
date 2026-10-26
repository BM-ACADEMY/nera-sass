import React, { lazy, Suspense, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FiCamera, FiFileText, FiHeadphones, FiImage, FiMic, FiPause, FiPlus, FiSend, FiSmile, FiTrash2, FiX } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { QuotedMessage } from './ChatCards';
import { CameraDialog } from './CameraDialog';

// The picker is large; load it the first time someone opens it.
const EmojiPicker = lazy(() => import('emoji-picker-react'));

const MAX_RECORDING_SECONDS = 15 * 60;
const BARS = 48;

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Records a voice note: live waveform, pause / resume, discard or send. */
const VoiceRecorder = ({ onCancel, onSend }) => {
  const [levels, setLevels] = useState(() => Array(BARS).fill(0.08));
  const [seconds, setSeconds] = useState(0);
  const [paused, setPaused] = useState(false);
  const rec = useRef({ elapsed: 0, since: 0 });

  const cleanup = () => {
    const r = rec.current;
    cancelAnimationFrame(r.raf);
    clearInterval(r.timer);
    r.stream?.getTracks().forEach((t) => t.stop());
    r.ctx?.close().catch(() => {});
  };

  const elapsed = () => {
    const r = rec.current;
    return r.elapsed + (r.since ? (Date.now() - r.since) / 1000 : 0);
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

  const togglePause = () => {
    const r = rec.current;
    if (!r.recorder) return;
    if (r.recorder.state === 'recording') {
      r.recorder.pause();
      r.elapsed = elapsed();
      r.since = 0;
      setPaused(true);
    } else if (r.recorder.state === 'paused') {
      r.recorder.resume();
      r.since = Date.now();
      setPaused(false);
    }
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
        const tick = (t) => {
          if (t - last > 90 && recorder.state === 'recording') {
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (const v of data) sum += ((v - 128) / 128) ** 2;
            const level = Math.min(1, Math.max(0.08, Math.sqrt(sum / data.length) * 5));
            setLevels((prev) => [...prev.slice(1), level]);
            last = t;
          }
          rec.current.raf = requestAnimationFrame(tick);
        };
        Object.assign(rec.current, { stream, recorder, chunks, ctx, since: Date.now(), raf: requestAnimationFrame(tick) });
        rec.current.timer = setInterval(() => {
          const s = elapsed();
          setSeconds(s);
          if (s >= MAX_RECORDING_SECONDS) finish(true);
        }, 200);
      } catch {
        toast.error('Allow the microphone in the browser to record a voice note.');
        onCancel();
      }
    })();
    return () => { cancelled = true; cleanup(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-1 items-center justify-end gap-3">
      <button type="button" onClick={() => finish(false)} className="flex size-9 cursor-pointer items-center justify-center rounded-full text-slate-500 hover:bg-muted" title="Discard" aria-label="Discard recording">
        <FiTrash2 className="size-5" />
      </button>
      <span className="flex items-center gap-2 text-[15px] tabular-nums">
        <span className={cn('size-2.5 rounded-full bg-red-500', !paused && 'animate-pulse')} />
        {clock(seconds)}
      </span>
      <div className="flex h-8 w-56 max-w-[40vw] items-center gap-[2px]" aria-hidden>
        {levels.map((level, i) => (
          <span key={i} className={cn('w-[2px] shrink-0 rounded-full', paused ? 'bg-slate-300' : 'bg-slate-500')} style={{ height: `${Math.round(level * 100)}%` }} />
        ))}
      </div>
      <button type="button" onClick={togglePause} className="flex size-9 cursor-pointer items-center justify-center rounded-full text-red-500 hover:bg-muted" title={paused ? 'Resume' : 'Pause'} aria-label={paused ? 'Resume recording' : 'Pause recording'}>
        {paused ? <FiMic className="size-5" /> : <FiPause className="size-5" />}
      </button>
      <button type="button" onClick={() => finish(true)} className="flex size-11 cursor-pointer items-center justify-center rounded-full bg-[#25D366] text-white shadow hover:bg-[#1fb857]" aria-label="Send voice message">
        <FiSend className="size-5" />
      </button>
    </div>
  );
};

const ATTACH_OPTIONS = [
  { key: 'document', label: 'Document', Icon: FiFileText, color: 'bg-violet-500', accept: '*/*' },
  { key: 'media', label: 'Photos & videos', Icon: FiImage, color: 'bg-blue-500', accept: 'image/*,video/*' },
  { key: 'camera', label: 'Camera', Icon: FiCamera, color: 'bg-pink-500' },
  { key: 'audio', label: 'Audio', Icon: FiHeadphones, color: 'bg-orange-500', accept: 'audio/*' },
  { key: 'template', label: 'Template', Icon: FiFileText, color: 'bg-green-600' },
];

// Closes a popup when the user clicks outside it or presses Esc.
function useDismiss(open, ref, onClose) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, ref, onClose]);
}

/**
 * WhatsApp-style message box: emoji, attach menu, camera and voice notes.
 * Picked, pasted or dropped files go to `onFiles(files)`; the page shows
 * them in the send preview.
 */
export const Composer = ({ ref, onSendText, onFiles, onSendVoice, onTemplate, onTyping, replyingTo, onCancelReply, customerName }) => {
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiLoaded, setEmojiLoaded] = useState(false); // stays mounted once opened: no lag on reopen
  const [attachOpen, setAttachOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const textRef = useRef(null);
  const emojiRef = useRef(null);
  const attachRef = useRef(null);
  const inputs = useRef({});

  useImperativeHandle(ref, () => ({ focus: () => textRef.current?.focus() }));
  useDismiss(emojiOpen, emojiRef, () => setEmojiOpen(false));
  useDismiss(attachOpen, attachRef, () => setAttachOpen(false));

  const insertEmoji = (emoji) => {
    const el = textRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText((t) => t.slice(0, start) + emoji + t.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await onSendText(body);
      setText('');
    } catch {
      // the page shows why; the text stays
    } finally {
      setSending(false);
      textRef.current?.focus();
    }
  };

  const sendVoice = async (blob) => {
    setRecording(false);
    setSending(true);
    try {
      const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
      await onSendVoice(new File([blob], `voice.${ext}`, { type: blob.type }));
    } catch {
      // shown by the page
    } finally {
      setSending(false);
    }
  };

  const pick = (key) => {
    setAttachOpen(false);
    if (key === 'template') onTemplate();
    else if (key === 'camera') setCameraOpen(true);
    else inputs.current[key]?.click();
  };

  const onPaste = (e) => {
    const pasted = [...(e.clipboardData?.files || [])];
    if (pasted.length) {
      e.preventDefault();
      onFiles(pasted);
    }
  };

  return (
    <div className="relative flex flex-col gap-2">
      {replyingTo && (
        <div className="flex items-center gap-2">
          <QuotedMessage quote={replyingTo} customerName={customerName} className="mb-0 flex-1" onClick={() => textRef.current?.focus()} />
          <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={onCancelReply} aria-label="Cancel reply"><FiX /></Button>
        </div>
      )}

      <div className="flex items-end gap-1.5">
        {recording ? (
          <VoiceRecorder onCancel={() => setRecording(false)} onSend={sendVoice} />
        ) : (
          <>
            <div ref={emojiRef} className="relative shrink-0">
              <Button
                variant="ghost" size="icon" title="Emoji" aria-label="Emoji"
                onClick={() => { setEmojiLoaded(true); setEmojiOpen((v) => !v); setAttachOpen(false); }}
                className={cn('transition-colors', emojiOpen && 'bg-muted text-green-700')}
              >
                {emojiOpen ? <FiX /> : <FiSmile />}
              </Button>
              {emojiLoaded && (
                <div className={cn('absolute bottom-full left-0 z-30 mb-2 overflow-hidden rounded-xl shadow-2xl', emojiOpen ? 'wa-pop' : 'hidden')}>
                  <Suspense fallback={<div className="flex h-[420px] w-[352px] items-center justify-center bg-card"><Spinner /></div>}>
                    <EmojiPicker
                      onEmojiClick={(e) => insertEmoji(e.emoji)}
                      emojiStyle="apple"
                      lazyLoadEmojis
                      skinTonesDisabled
                      autoFocusSearch={false}
                      previewConfig={{ showPreview: false }}
                      searchPlaceHolder="Search emoji"
                      width={352}
                      height={420}
                    />
                  </Suspense>
                </div>
              )}
            </div>

            <div ref={attachRef} className="relative shrink-0">
              <Button
                variant="ghost" size="icon" title="Attach" aria-label="Attach"
                onClick={() => { setAttachOpen((v) => !v); setEmojiOpen(false); }}
                className={cn('transition-transform', attachOpen && 'rotate-45 bg-muted')}
              >
                <FiPlus className="size-5" />
              </Button>
              {attachOpen && (
                <div className="wa-pop absolute bottom-full left-0 z-30 mb-2 w-56 rounded-xl border border-border bg-card p-1.5 shadow-2xl">
                  {ATTACH_OPTIONS.map((o) => (
                    <button key={o.key} type="button" onClick={() => pick(o.key)} className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted">
                      <span className={cn('flex size-8 items-center justify-center rounded-full text-white', o.color)}><o.Icon className="size-4" /></span>
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {ATTACH_OPTIONS.filter((o) => o.accept).map((o) => (
              <input
                key={o.key}
                ref={(el) => { inputs.current[o.key] = el; }}
                type="file"
                accept={o.accept}
                multiple
                className="hidden"
                onChange={(e) => { onFiles([...e.target.files]); e.target.value = ''; }}
              />
            ))}

            <Textarea
              ref={textRef}
              value={text}
              onChange={(e) => { setText(e.target.value); if (e.target.value.trim()) onTyping?.(); }}
              onPaste={onPaste}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && replyingTo) { onCancelReply?.(); return; }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              placeholder="Type a message"
              rows={1}
              maxLength={4096}
              className="max-h-36 min-h-10 resize-none rounded-lg"
            />
            {text.trim() || sending ? (
              <Button size="icon" className="size-10 shrink-0 rounded-full bg-[#25D366] hover:bg-[#1fb857]" onClick={send} disabled={sending || !text.trim()} aria-label="Send">
                {sending ? <Spinner /> : <FiSend />}
              </Button>
            ) : (
              <Button size="icon" className="size-10 shrink-0 rounded-full bg-[#25D366] hover:bg-[#1fb857]" onClick={() => setRecording(true)} title="Record a voice message" aria-label="Record a voice message">
                <FiMic />
              </Button>
            )}
          </>
        )}
      </div>
      <CameraDialog open={cameraOpen} onOpenChange={setCameraOpen} onCapture={(file) => onFiles([file])} />
    </div>
  );
};
