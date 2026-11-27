import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { FiPlus, FiSearch, FiTag } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { DEFAULT_LABEL_COLOR, LABEL_NAME_MAX, cleanLabelName, filterLabels, labelNameError, toggleLabelId } from '../labelsPolicy.js';
import { labelsApi } from './labelsApi.js';
import { ColorSwatches, LabelChip } from './LabelChip.jsx';

/**
 * Choose the labels of one lead: a checkbox per label, and (owners/admins)
 * "Create new label" inline. Saved in one call (PUT /api/leads/:id/labels).
 * `lead` = a row of the Leads list (lead.labels are its current labels).
 */
export function LeadLabelsDialog({ open, onOpenChange, lead, canManage, onSaved }) {
  const [labels, setLabels] = useState([]);
  const [chosen, setChosen] = useState(() => (lead?.labels || []).map((l) => l.id));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(DEFAULT_LABEL_COLOR);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open || !lead) return;
    let live = true;
    Promise.all([labelsApi.list(), labelsApi.forLead(lead.id)])
      .then(([all, own]) => {
        if (!live) return;
        setLabels(all.labels || []);
        setChosen((own.labels || []).map((l) => l.id));
      })
      .catch((err) => toast.error(err.message || 'Could not load the labels.'))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [open, lead]);

  const shown = filterLabels(labels, query);

  const createLabel = async (event) => {
    event.preventDefault();
    const problem = labelNameError(newName, labels);
    if (problem) return toast.error(problem);
    setCreating(true);
    try {
      const { label } = await labelsApi.create({ name: cleanLabelName(newName), color: newColor });
      setLabels((current) => [...current, label]);
      setChosen((current) => [...current, label.id]);
      setNewName('');
      setNewColor(DEFAULT_LABEL_COLOR);
      setCreatingOpen(false);
    } catch (err) {
      toast.error(err.message || 'Could not create the label.');
    } finally {
      setCreating(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const data = await labelsApi.setForLead(lead.id, chosen);
      toast.success('Labels saved');
      onSaved?.(data.labels || []);
      onOpenChange(false);
    } catch (err) {
      toast.error(err.message || 'Could not save the labels.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FiTag /> Labels</DialogTitle>
          <DialogDescription className="truncate">{lead?.name || 'This lead'}{lead?.phone ? ` · ${lead.phone}` : ''}</DialogDescription>
        </DialogHeader>

        {labels.length > 6 && (
          <div className="relative">
            <FiSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a label" className="h-9 pl-9" aria-label="Find a label" />
          </div>
        )}

        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1">
          {loading ? (
            Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-10" />)
          ) : shown.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {labels.length ? 'No label matches.' : canManage ? 'No labels yet. Create one below.' : 'No labels yet. Ask your workspace owner to create some.'}
            </p>
          ) : shown.map((label) => {
            const on = chosen.includes(label.id);
            return (
              <label key={label.id} className={cn('flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted', on && 'bg-blue-50/60')}>
                <input type="checkbox" className="size-4 cursor-pointer accent-primary" checked={on} onChange={() => setChosen((current) => toggleLabelId(current, label.id))} disabled={saving} />
                <LabelChip label={label} />
              </label>
            );
          })}
        </div>

        {canManage && (creatingOpen ? (
          <form onSubmit={createLabel} className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex gap-2">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={LABEL_NAME_MAX} placeholder="Label name" aria-label="New label name" autoFocus disabled={creating} className="h-9 bg-white" />
              <Button type="submit" disabled={creating || !cleanLabelName(newName)}>{creating ? <Spinner /> : <FiPlus />} Add</Button>
            </div>
            <ColorSwatches value={newColor} onChange={setNewColor} disabled={creating} />
          </form>
        ) : (
          <Button variant="outline" size="sm" className="self-start" onClick={() => setCreatingOpen(true)} disabled={saving}><FiPlus /> Create new label</Button>
        ))}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading}>{saving && <Spinner />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
