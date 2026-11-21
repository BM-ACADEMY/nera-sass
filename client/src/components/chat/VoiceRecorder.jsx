import React, { useEffect, useRef, useState } from 'react';
import { FiMic, FiPause, FiSend, FiTrash2 } from 'react-icons/fi';
import { cn } from '@/lib/utils';

// The same file is used by the admin panel (admin/src/components/inbox/) and
// the customer panel (client/src/components/chat/): keep the two copies equal.

const MAX_RECORDING_SECONDS = 15 * 60;
const BARS = 48;

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Records a voice note: live waveform, pause / resume, discard or send. */
export const VoiceRecorder = ({ onCancel, onSend, onError }) => {
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
        const mimeType = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => window.MediaRecorder?.isTypeSupported?.(t));
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
        onError?.('Allow the microphone in the browser to record a voice note.');
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

/** File name for a recording: the server turns webm into an ogg/opus voice note. */
export const voiceFileName = (type = '') => `voice-${Date.now()}.${type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm'}`;
