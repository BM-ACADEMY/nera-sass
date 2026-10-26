import React from 'react';
import { toast } from 'sonner';
import { FiCopy, FiList, FiMapPin, FiUser, FiCornerUpLeft } from 'react-icons/fi';
import { cn } from '@/lib/utils';

const mapsLink = ({ latitude, longitude }) => `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;

export const LocationCard = ({ location }) => (
  <a
    href={location.url || mapsLink(location)}
    target="_blank"
    rel="noopener noreferrer"
    className="mb-1 flex w-64 max-w-full items-center gap-3 rounded-md bg-black/5 px-3 py-2.5 hover:bg-black/10"
  >
    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-500 text-white"><FiMapPin className="size-5" /></span>
    <span className="min-w-0">
      <span className="block truncate text-sm font-semibold">{location.name || 'Location'}</span>
      {location.address && <span className="block truncate text-[11px] text-slate-500">{location.address}</span>}
      <span className="block text-[11px] font-semibold text-green-700">Open in Google Maps</span>
    </span>
  </a>
);

const copy = async (value) => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success('Copied');
  } catch {
    toast.error('Could not copy');
  }
};

export const ContactCards = ({ contacts }) => (
  <div className="mb-1 flex flex-col gap-1.5">
    {contacts.map((c, i) => (
      <div key={i} className="w-64 max-w-full rounded-md bg-black/5 px-3 py-2.5">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-400 text-white"><FiUser className="size-5" /></span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{c.name}</div>
            {c.emails?.[0] && <div className="truncate text-[11px] text-slate-500">{c.emails[0]}</div>}
          </div>
        </div>
        {c.phones?.map((p) => (
          <button key={p} type="button" onClick={() => copy(p)} className="mt-1.5 flex w-full cursor-pointer items-center justify-between rounded px-1 py-0.5 text-[13px] text-green-700 hover:bg-black/5" title="Copy number">
            {p} <FiCopy className="size-3.5" />
          </button>
        ))}
      </div>
    ))}
  </div>
);

// The choices of a buttons / list message, as WhatsApp shows them under the text.
export const InteractiveChoices = ({ interactive }) => {
  if (!interactive?.options?.length) return null;
  if (interactive.kind === 'list') {
    return (
      <div className="mt-1.5 border-t border-black/10 pt-1.5">
        <div className="flex items-center justify-center gap-1.5 text-[13px] font-semibold text-sky-700"><FiList /> {interactive.button_text || 'Options'}</div>
        <ul className="mt-1 list-inside list-disc text-[12px] text-slate-600">
          {interactive.options.map((o) => <li key={o.title}>{o.title}{o.description ? ` · ${o.description}` : ''}</li>)}
        </ul>
      </div>
    );
  }
  return (
    <div className="mt-1.5 flex flex-col border-t border-black/10">
      {interactive.options.map((o) => (
        <div key={o.title} className="flex items-center justify-center gap-1.5 border-b border-black/5 py-1.5 text-[13px] font-semibold text-sky-700 last:border-b-0">
          <FiCornerUpLeft className="size-3.5" /> {o.title}
        </div>
      ))}
    </div>
  );
};

const QUOTE_LABEL = { image: '📷 Photo', video: '🎥 Video', audio: '🎤 Voice message', document: '📄 Document', sticker: 'Sticker', location: '📍 Location', contacts: '👤 Contact', template: 'Template', interactive: 'Message' };

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
