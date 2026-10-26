import React, { useRef, useState } from 'react';
import {
  FiCheckSquare, FiChevronDown, FiCopy, FiCornerUpLeft, FiCornerUpRight, FiDownload, FiFileText, FiInfo, FiSmile, FiStar, FiTrash2,
} from 'react-icons/fi';
import { BsPin, BsPinAngleFill } from 'react-icons/bs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { MessageMedia } from './ChatMedia';
import { QuotedMessage, Reactions } from './ChatCards';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const LONG_TEXT = 700;

// Links in a message become clickable.
const linkify = (text) => text.split(/(https?:\/\/[^\s<>"')]+)/g).map((part, i) => (
  /^https?:\/\//.test(part)
    ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="break-all text-sky-700 underline">{part}</a>
    : part
));

const Item = ({ icon: Icon, children, onSelect, danger }) => (
  <DropdownMenuItem onSelect={onSelect} className={cn('gap-3 py-2', danger && 'text-red-600 focus:text-red-600')}>
    <Icon className="size-4" /> {children}
  </DropdownMenuItem>
);

/**
 * One chat message with WhatsApp's actions. `onAction(name, message, extra)`:
 * info, reply, copy, forward, pin, star, select, save, delete, react.
 * In select mode the bubble only toggles its checkbox.
 */
export const MessageBubble = ({
  message: m, customerName, canInteract, selecting, selected, onToggleSelect, onAction, onOpenImage, onJumpTo,
  highlighted, ticks, time, readOnly,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const reactRef = useRef(null);
  const outbound = m.direction === 'outbound';
  const hasFile = m.has_media || m.media_url;
  const text = m.text || '';
  const long = text.length > LONG_TEXT && !expanded;
  const canReply = canInteract && m.can_reply && !readOnly;
  const act = (name, extra) => () => onAction(name, m, extra);

  return (
    <div
      id={`msg-${m.id}`}
      onClick={selecting ? () => onToggleSelect(m) : undefined}
      className={cn('group flex items-start gap-2', selecting && 'cursor-pointer rounded-md px-1 hover:bg-black/5', selected && 'bg-green-500/10')}
    >
      {selecting && (
        <span className={cn('mt-2 flex size-5 shrink-0 items-center justify-center rounded border-2', selected ? 'border-[#25D366] bg-[#25D366] text-white' : 'border-slate-400 bg-white')}>
          {selected && '✓'}
        </span>
      )}
      <div className={cn('flex min-w-0 flex-1 flex-col', outbound ? 'items-end' : 'items-start')}>
        <div className={cn('flex max-w-[85%] items-center gap-1 sm:max-w-[70%]', outbound && 'flex-row-reverse')}>
          <div className={cn(
            'relative min-w-0 rounded-lg px-2.5 py-1.5 text-sm shadow-sm transition-shadow',
            outbound ? 'rounded-tr-none bg-[#d9fdd3]' : 'rounded-tl-none bg-white',
            m.status === 'failed' && 'ring-1 ring-red-300',
            highlighted && 'ring-2 ring-amber-400',
          )}>
            {!selecting && !readOnly && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={cn('absolute top-0.5 right-0.5 z-[2] flex size-6 cursor-pointer items-center justify-center rounded-full text-slate-500 opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100', outbound ? 'bg-[#d9fdd3]' : 'bg-white')} aria-label="Message options">
                    <FiChevronDown />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align={outbound ? 'end' : 'start'} className="w-52">
                  {outbound && <Item icon={FiInfo} onSelect={act('info')}>Message info</Item>}
                  {canReply && <Item icon={FiCornerUpLeft} onSelect={act('reply')}>Reply</Item>}
                  {text && <Item icon={FiCopy} onSelect={act('copy')}>Copy</Item>}
                  <Item icon={FiCornerUpRight} onSelect={act('forward')}>Forward</Item>
                  <Item icon={m.pinned ? BsPinAngleFill : BsPin} onSelect={act('pin')}>{m.pinned ? 'Unpin' : 'Pin'}</Item>
                  <Item icon={FiStar} onSelect={act('star')}>{m.starred ? 'Unstar' : 'Star'}</Item>
                  <DropdownMenuSeparator />
                  <Item icon={FiCheckSquare} onSelect={act('select')}>Select</Item>
                  {hasFile && <Item icon={FiDownload} onSelect={act('save')}>Save as</Item>}
                  <DropdownMenuSeparator />
                  <Item icon={FiTrash2} onSelect={act('delete')} danger>Delete</Item>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {m.is_forwarded && <div className="mb-0.5 flex items-center gap-1 pr-6 text-[11px] text-slate-500 italic"><FiCornerUpRight className="size-3" /> Forwarded</div>}
            {m.template_name && (
              <div className="mb-0.5 inline-flex items-center gap-1 pr-6 text-[10.5px] font-semibold text-green-800"><FiFileText /> Template · {m.template_name}</div>
            )}
            {m.reply_to && <QuotedMessage quote={m.reply_to} customerName={customerName} onClick={(e) => { e.stopPropagation(); onJumpTo(m.reply_to.id); }} />}
            <MessageMedia message={m} onOpenImage={selecting ? undefined : onOpenImage} senderName={outbound ? (m.sent_by_name || 'Getnera') : customerName} />
            {(text || !hasFile) && (
              <div className="pr-5 break-words whitespace-pre-wrap">
                {linkify(long ? `${text.slice(0, LONG_TEXT)}…` : text || ' ')}
                {long && <button type="button" onClick={(e) => { e.stopPropagation(); setExpanded(true); }} className="ml-1 cursor-pointer text-sky-700 hover:underline">Read more</button>}
              </div>
            )}
            <div className="mt-0.5 flex items-center justify-end gap-1.5 text-[10.5px] text-slate-500">
              {m.pinned && <BsPinAngleFill className="size-3" title="Pinned" />}
              {m.starred && <FiStar className="size-3 fill-current" title="Starred" />}
              {outbound && m.sent_by_name && <span>{m.sent_by_name} ·</span>}
              {time}
              {outbound && ticks}
            </div>
            {m.status === 'failed' && <div className="mt-0.5 text-[11px] text-red-600">Not delivered: {m.error || 'Meta refused it'}</div>}
          </div>

          {/* React / reply on hover, beside the bubble */}
          {canReply && !selecting && (
            <div ref={reactRef} className="relative hidden shrink-0 items-center gap-1 group-hover:flex data-[open=true]:flex" data-open={reactOpen}>
              <button type="button" onClick={() => setReactOpen((v) => !v)} className="flex size-7 cursor-pointer items-center justify-center rounded-full bg-white/80 text-slate-500 shadow-sm hover:text-slate-700" title="React" aria-label="React">
                <FiSmile className="size-3.5" />
              </button>
              {reactOpen && (
                <div className={cn('wa-pop absolute bottom-full z-30 mb-1 flex gap-0.5 rounded-full border border-border bg-white px-1.5 py-1 shadow-xl', outbound ? 'right-0' : 'left-0')} onMouseLeave={() => setReactOpen(false)}>
                  {QUICK_REACTIONS.map((e) => (
                    <button key={e} type="button" onClick={() => { setReactOpen(false); onAction('react', m, m.reactions?.staff === e ? '' : e); }} className={cn('cursor-pointer rounded-full p-1 text-xl transition-transform hover:scale-125', m.reactions?.staff === e && 'bg-green-100')}>
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <Reactions reactions={m.reactions} align={outbound ? 'right' : 'left'} />
      </div>
    </div>
  );
};
