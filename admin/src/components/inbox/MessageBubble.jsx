import React, { useState } from 'react';
import { toast } from 'sonner';
import { FiChevronDown, FiCopy, FiCornerUpLeft, FiDownload, FiFileText, FiSmile } from 'react-icons/fi';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { MessageMedia, saveFile, useMediaSrc } from './ChatMedia';
import { ContactCards, InteractiveChoices, LocationCard, QuotedMessage, Reactions } from './ChatCards';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

// Long text gets "Read more" like WhatsApp.
const LONG_TEXT = 700;

// Links in a message become clickable.
const linkify = (text) => text.split(/(https?:\/\/[^\s<>"')]+)/g).map((part, i) => (
  /^https?:\/\//.test(part)
    ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="break-all text-sky-700 underline">{part}</a>
    : part
));

const DownloadItem = ({ message }) => {
  const { src } = useMediaSrc(message);
  return (
    <DropdownMenuItem disabled={!src} onSelect={() => saveFile(src, message.filename || `${message.type}-${message.id}`)} className="gap-2.5">
      <FiDownload /> Download
    </DropdownMenuItem>
  );
};

/**
 * One chat message: quote, file, cards, text, reactions and a hover menu with
 * Reply, quick reactions, Copy and Download.
 */
export const MessageBubble = ({ message: m, customerName, canInteract, onReply, onReact, onOpenImage, onJumpTo, highlighted, ticks, sentBy, time }) => {
  const [expanded, setExpanded] = useState(false);
  const outbound = m.direction === 'outbound';
  const hasFile = m.has_media || m.media_url;
  const text = m.text || '';
  const long = text.length > LONG_TEXT && !expanded;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Could not copy');
    }
  };

  return (
    <div id={`msg-${m.id}`} className={cn('group flex flex-col', outbound ? 'items-end' : 'items-start')}>
      <div className={cn('flex max-w-[85%] items-start gap-1 sm:max-w-[70%]', outbound && 'flex-row-reverse')}>
        <div className={cn(
          'relative min-w-0 rounded-lg px-2.5 py-1.5 text-sm shadow-sm transition-shadow',
          outbound ? 'rounded-tr-none bg-[#d9fdd3]' : 'rounded-tl-none bg-white',
          m.status === 'failed' && 'ring-1 ring-red-300',
          highlighted && 'ring-2 ring-amber-400',
        )}>
          {/* Menu button, top-right of the bubble on hover */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={cn('absolute top-0.5 right-0.5 z-[2] flex size-6 cursor-pointer items-center justify-center rounded-full text-slate-500 opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100', outbound ? 'bg-[#d9fdd3]' : 'bg-white')} aria-label="Message options">
                <FiChevronDown />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={outbound ? 'end' : 'start'} className="w-52">
              {canInteract && m.can_reply && (
                <>
                  <div className="flex justify-between px-1.5 py-1">
                    {QUICK_REACTIONS.map((e) => (
                      <DropdownMenuItem key={e} onSelect={() => onReact(m, m.reactions?.staff === e ? '' : e)} className={cn('justify-center p-1 text-lg', m.reactions?.staff === e && 'bg-green-100')}>{e}</DropdownMenuItem>
                    ))}
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onReply(m)} className="gap-2.5"><FiCornerUpLeft /> Reply</DropdownMenuItem>
                  {m.reactions?.staff && <DropdownMenuItem onSelect={() => onReact(m, '')} className="gap-2.5"><FiSmile /> Remove my reaction</DropdownMenuItem>}
                </>
              )}
              {text && <DropdownMenuItem onSelect={copy} className="gap-2.5"><FiCopy /> Copy text</DropdownMenuItem>}
              {hasFile && <DownloadItem message={m} />}
              {!canInteract && !text && !hasFile && <DropdownMenuItem disabled>Nothing to do here</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>

          {m.template_name && (
            <div className="mb-0.5 inline-flex items-center gap-1 pr-6 text-[10.5px] font-semibold text-green-800"><FiFileText /> Template · {m.template_name}</div>
          )}
          {m.reply_to && <QuotedMessage quote={m.reply_to} customerName={customerName} onClick={() => onJumpTo(m.reply_to.id)} />}
          <MessageMedia message={m} onOpenImage={onOpenImage} />
          {m.location && <LocationCard location={m.location} />}
          {m.contacts?.length > 0 && <ContactCards contacts={m.contacts} />}
          {(text || (!hasFile && !m.location && !m.contacts?.length)) && (
            <div className="pr-5 break-words whitespace-pre-wrap">
              {linkify(long ? `${text.slice(0, LONG_TEXT)}…` : text || ' ')}
              {long && <button type="button" onClick={() => setExpanded(true)} className="ml-1 cursor-pointer text-sky-700 hover:underline">Read more</button>}
            </div>
          )}
          <InteractiveChoices interactive={m.interactive} />
          <div className="mt-0.5 flex items-center justify-end gap-1.5 text-[10.5px] text-slate-500">
            {outbound && sentBy && <span>{sentBy} ·</span>}
            {time}
            {outbound && ticks}
          </div>
          {m.status === 'failed' && <div className="mt-0.5 text-[11px] text-red-600">Not delivered: {m.error || 'Meta refused it'}</div>}
        </div>
        {canInteract && m.can_reply && (
          <button type="button" onClick={() => onReply(m)} className="mt-1 hidden size-7 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/80 text-slate-500 shadow-sm group-hover:flex hover:text-slate-700" title="Reply" aria-label="Reply">
            <FiCornerUpLeft className="size-3.5" />
          </button>
        )}
      </div>
      <Reactions reactions={m.reactions} align={outbound ? 'right' : 'left'} />
    </div>
  );
};
