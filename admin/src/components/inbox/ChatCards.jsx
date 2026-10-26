import React from 'react';
import { cn } from '@/lib/utils';

const QUOTE_LABEL = { image: '📷 Photo', video: '🎥 Video', audio: '🎤 Voice message', document: '📄 Document', sticker: 'Sticker', template: 'Template' };

export const quoteText = (m) => m.text || m.filename || QUOTE_LABEL[m.type] || 'Message';

/** The quoted message at the top of a reply (in a bubble or above the message box). */
export const QuotedMessage = ({ quote, customerName, onClick, className }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn('mb-1 flex w-full cursor-pointer overflow-hidden rounded-md bg-black/5 text-left hover:bg-black/10', className)}
  >
    <span className={cn('w-1 shrink-0', quote.direction === 'outbound' ? 'bg-green-500' : 'bg-violet-500')} />
    <span className="min-w-0 px-2 py-1">
      <span className={cn('block text-[11.5px] font-semibold', quote.direction === 'outbound' ? 'text-green-700' : 'text-violet-700')}>
        {quote.direction === 'outbound' ? 'You' : customerName || 'Customer'}
      </span>
      <span className="line-clamp-2 block text-[12px] text-slate-600">{quoteText(quote)}</span>
    </span>
  </button>
);

/** Reaction chips under a bubble: the customer's and the staff's. */
export const Reactions = ({ reactions, align }) => {
  const list = [reactions?.customer, reactions?.staff].filter(Boolean);
  if (!list.length) return null;
  return (
    <div className={cn('-mt-1.5 mb-1 flex', align === 'right' ? 'justify-end pr-2' : 'pl-2')}>
      <span className="relative z-[1] flex items-center gap-0.5 rounded-full border border-border bg-white px-1.5 py-0.5 text-sm shadow-sm">
        {list.map((e, i) => <span key={i}>{e}</span>)}
        {list.length > 1 && <span className="ml-0.5 text-[10.5px] text-slate-500">{list.length}</span>}
      </span>
    </div>
  );
};
