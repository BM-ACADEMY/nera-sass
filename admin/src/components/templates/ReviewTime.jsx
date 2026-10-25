import React, { useEffect, useState } from 'react';
import { FiClock, FiCheck, FiX } from 'react-icons/fi';
import { cn } from '@/lib/utils';

const IN_REVIEW = ['PENDING', 'IN_APPEAL'];

// 45s · 4m 20s · 38m · 3h 12m · 2d 4h
export const duration = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 10) return `${m}m ${s % 60}s`;
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
};

const stamp = (v) => new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

// Re-renders every 15 seconds while something is waiting.
const useNow = (active) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, [active]);
  return now;
};

// How long Meta has been reviewing a template, or how long the review took.
const ReviewTime = ({ template, className }) => {
  const { status, submitted_at: sent, reviewed_at: decided, submitted_at_estimated: estimated } = template;
  const waiting = IN_REVIEW.includes(status);
  const now = useNow(waiting && Boolean(sent));
  const approx = estimated ? '~' : '';

  if (waiting && sent) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-[11.5px] font-medium text-amber-700', className)} title={`Sent for review ${stamp(sent)}${estimated ? ' (first seen in review)' : ''}`}>
        <FiClock className="size-3" /> Waiting {approx}{duration(now - new Date(sent))}
      </span>
    );
  }
  if (!waiting && sent && decided) {
    const ok = status === 'APPROVED';
    return (
      <span className={cn('inline-flex items-center gap-1 text-[11.5px] font-medium', ok ? 'text-emerald-700' : 'text-red-700', className)} title={`Sent ${stamp(sent)} · decided ${stamp(decided)}`}>
        {ok ? <FiCheck className="size-3" /> : <FiX className="size-3" />}
        {ok ? 'Approved' : 'Decided'} in {approx}{duration(new Date(decided) - new Date(sent))}
      </span>
    );
  }
  return null;
};

export default ReviewTime;
