import React, { useEffect, useState } from 'react';
import { FiCheck, FiSearch, FiSend } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

/**
 * Pick chats to forward to. Only chats whose 24-hour window is open can take
 * a forwarded message (Meta's rule); the others are shown greyed out.
 * `onForward(contactIds)` does the sending.
 */
export const ForwardDialog = ({ open, onOpenChange, conversations, count, onForward }) => {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setSearch(''); setPicked(new Set()); } }, [open]);

  const q = search.trim().toLowerCase();
  const list = conversations.filter((c) => !q || `${c.name || ''} ${c.wa_id}`.toLowerCase().includes(q));
  const toggle = (id) => setPicked((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else if (next.size < 5) next.add(id); return next; });

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Forward {count > 1 ? `${count} messages` : 'message'} to</DialogTitle>
          <DialogDescription>Up to 5 chats. Only chats that wrote in the last 24 hours can receive it.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <FiSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or number" className="pl-9" />
        </div>
        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto">
          {list.map((c) => {
            const on = picked.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                disabled={!c.window_open}
                onClick={() => toggle(c.id)}
                className={cn('flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45', on && 'bg-green-50')}
              >
                <span className={cn('flex size-5 shrink-0 items-center justify-center rounded border-2', on ? 'border-[#25D366] bg-[#25D366] text-white' : 'border-slate-300 text-transparent')}><FiCheck className="size-3.5" /></span>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-green-100 font-bold text-green-700">{String(c.name || c.wa_id).charAt(0).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{c.name || `+${c.wa_id}`}</span>
                  <span className="block text-[11px] text-muted-foreground">{c.window_open ? `+${c.wa_id}` : 'Reply window closed'}</span>
                </span>
              </button>
            );
          })}
          {!list.length && <div className="py-8 text-center text-sm text-muted-foreground">No chats</div>}
        </div>
        <div className="flex justify-end">
          <Button
            className="bg-[#25D366] hover:bg-[#1fb857]"
            disabled={!picked.size || busy}
            onClick={async () => {
              setBusy(true);
              try { await onForward([...picked]); onOpenChange(false); } finally { setBusy(false); }
            }}
          >
            {busy ? <Spinner /> : <FiSend />} Forward{picked.size ? ` to ${picked.size}` : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
