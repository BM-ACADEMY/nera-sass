import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { FiActivity, FiFileText, FiMessageCircle, FiPlus, FiRefreshCw, FiTrash2 } from 'react-icons/fi';
import { api } from '../../services/api.js';
import ConfirmDialog from '../../components/templates/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { shortWhen, timeAgo } from './leadsPolicy.js';
import { PersonAvatar, StatusBadge } from './LeadStatus.jsx';

// One lead's details on the Leads page: its notes (newest first, with author
// and time) and its activity timeline (who changed what). Opened from the
// row menu or the note count on a row. The server decides who may delete a
// note (note.can_delete).

const Section = ({ icon: Icon, title, action, children }) => (
  <section className="flex flex-col gap-2.5">
    <div className="flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-slate-700"><Icon className="size-4 text-muted-foreground" /> {title}</h3>
      {action}
    </div>
    {children}
  </section>
);

const Loading = () => <div className="flex flex-col gap-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>;

const Failed = ({ onRetry }) => (
  <div className="flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
    Could not load this.
    <Button variant="outline" size="sm" className="h-7 bg-white" onClick={onRetry}><FiRefreshCw /> Try again</Button>
  </div>
);

const When = ({ at }) => (
  <time dateTime={at ? new Date(at).toISOString() : undefined} title={at ? new Date(at).toLocaleString('en-IN') : undefined} className="text-xs whitespace-nowrap text-muted-foreground">
    {timeAgo(at) || shortWhen(at)}
  </time>
);

export function LeadDetailSheet({ lead, open, onOpenChange, onAddNote, onOpenChat, onNotesChanged, notesVersion = 0 }) {
  const [notes, setNotes] = useState(null);
  const [events, setEvents] = useState(null);
  const [failed, setFailed] = useState({ notes: false, events: false });
  const [confirm, setConfirm] = useState(null);
  const leadId = lead?.id;

  const load = useCallback(() => {
    if (!leadId) return;
    const done = (key, set) => (data) => { set(data[key] || []); setFailed((f) => ({ ...f, [key]: false })); };
    const fail = (key) => () => setFailed((f) => ({ ...f, [key]: true }));
    api.getLeadNotes(leadId).then(done('notes', setNotes)).catch(fail('notes'));
    api.getLeadActivity(leadId).then(done('events', setEvents)).catch(fail('events'));
  }, [leadId]);

  // Again after a note is added from the dialog (notesVersion changes).
  useEffect(() => { if (open) load(); }, [open, load, notesVersion]);

  const askDelete = (note) => setConfirm({
    title: 'Delete this note?',
    description: 'It is removed for everyone in your team. This cannot be undone.',
    actionLabel: 'Delete note',
    destructive: true,
    run: async () => {
      try {
        await api.deleteLeadNote(leadId, note.id);
        toast.success('Note deleted');
        load();
        onNotesChanged?.();
      } catch (err) {
        toast.error(err.message || 'Could not delete the note.');
      }
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b border-border pr-10">
          <SheetTitle className="truncate">{lead?.name || 'No name'}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2">
            <span>{lead?.phone || '—'}</span>
            {lead && <StatusBadge status={lead.status} />}
            <span>{lead?.assigned_name ? `Assigned to ${lead.assigned_name}` : 'Not assigned'}</span>
          </SheetDescription>
          {onOpenChat && lead && (
            <div className="pt-1"><Button variant="outline" size="sm" onClick={() => onOpenChat(lead)}><FiMessageCircle /> Open chat</Button></div>
          )}
        </SheetHeader>

        <div className="flex flex-col gap-6 p-4">
          <Section
            icon={FiFileText}
            title="Notes"
            action={onAddNote && <Button variant="outline" size="sm" className="h-7" onClick={() => onAddNote(lead)}><FiPlus /> Add note</Button>}
          >
            {failed.notes ? <Failed onRetry={load} /> : notes == null ? <Loading /> : notes.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No notes yet. Notes are for your team only.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {notes.map((note) => (
                  <li key={note.id} className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <PersonAvatar name={note.author_name} id={note.user_id} />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{note.author_name}</span>
                      <When at={note.created_at} />
                      {note.can_delete && (
                        <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive" aria-label="Delete note" onClick={() => askDelete(note)}><FiTrash2 /></Button>
                      )}
                    </div>
                    <p className="mt-1.5 text-[13px] break-words whitespace-pre-wrap text-slate-700">{note.note}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section icon={FiActivity} title="Activity">
            {failed.events ? <Failed onRetry={load} /> : events == null ? <Loading /> : events.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No changes recorded yet.</p>
            ) : (
              <ol className="relative flex flex-col gap-3 border-l border-border pl-4">
                {events.map((event) => (
                  <li key={event.id} className="relative">
                    <span aria-hidden="true" className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-background bg-slate-300" />
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-semibold">{event.actor?.name || 'System'}</span>
                      <When at={event.at} />
                    </div>
                    <p className="text-[13px] text-slate-600">{event.details || event.action}</p>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
        <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
      </SheetContent>
    </Sheet>
  );
}
