import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { FiEdit2, FiPlus, FiTag, FiTrash2, FiX, FiCheck } from 'react-icons/fi';
import ConfirmDialog from '../../../components/templates/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { DEFAULT_LABEL_COLOR, LABEL_NAME_MAX, cleanLabelName, filterLabels, labelNameError, leadCountText } from '../labelsPolicy.js';
import { labelsApi } from './labelsApi.js';
import { ColorSwatches, LabelChip } from './LabelChip.jsx';

// One label in the list: shown, or being renamed / recoloured.
function LabelRow({ label, labels, canManage, onSaved, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(label.color);
  const [saving, setSaving] = useState(false);

  const start = () => { setName(label.name); setColor(label.color); setEditing(true); };
  const save = async (event) => {
    event.preventDefault();
    const problem = labelNameError(name, labels, label.id);
    if (problem) return toast.error(problem);
    const changes = {};
    if (cleanLabelName(name) !== label.name) changes.name = cleanLabelName(name);
    if (color !== label.color) changes.color = color;
    if (!Object.keys(changes).length) return setEditing(false);
    setSaving(true);
    try {
      await labelsApi.update(label.id, changes);
      toast.success('Label saved');
      setEditing(false);
      onSaved();
    } catch (err) {
      toast.error(err.message || 'Could not save the label.');
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <form onSubmit={save} className="flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50/40 p-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={LABEL_NAME_MAX} aria-label="Label name" autoFocus disabled={saving} className="h-9 bg-white" />
        <ColorSwatches value={color} onChange={setColor} disabled={saving} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}><FiX /> Cancel</Button>
          <Button type="submit" size="sm" disabled={saving}>{saving ? <Spinner /> : <FiCheck />} Save</Button>
        </div>
      </form>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
      <div className="min-w-0 flex-1">
        <LabelChip label={label} />
        <div className="mt-0.5 text-xs text-muted-foreground">{leadCountText(label.lead_count)}</div>
      </div>
      {canManage && (
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="icon" className="size-8" onClick={start} aria-label={`Edit ${label.name}`}><FiEdit2 /></Button>
          <Button variant="ghost" size="icon" className="size-8 text-red-600 hover:text-red-700" onClick={() => onDelete(label)} aria-label={`Delete ${label.name}`}><FiTrash2 /></Button>
        </div>
      )}
    </div>
  );
}

/**
 * Settings for the workspace's labels: create (name + colour), rename,
 * recolour, delete (with a confirmation) and how many leads carry each.
 * Members who cannot manage labels see the list only.
 */
export function LabelsManager({ open, onOpenChange, canManage, onChanged }) {
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_LABEL_COLOR);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const [reloadKey, setReloadKey] = useState(0);

  // Mounted only while open; reloads after every change.
  useEffect(() => {
    let live = true;
    labelsApi.list()
      .then((data) => live && setLabels(data.labels || []))
      .catch((err) => toast.error(err.message || 'Could not load your labels.'))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [reloadKey]);

  const changed = () => { setReloadKey((key) => key + 1); onChanged?.(); };

  const create = async (event) => {
    event.preventDefault();
    const problem = labelNameError(name, labels);
    if (problem) return toast.error(problem);
    setCreating(true);
    try {
      await labelsApi.create({ name: cleanLabelName(name), color });
      toast.success('Label created');
      setName('');
      setColor(DEFAULT_LABEL_COLOR);
      changed();
    } catch (err) {
      toast.error(err.message || 'Could not create the label.');
    } finally {
      setCreating(false);
    }
  };

  const askDelete = (label) => setConfirm({
    title: `Delete the label "${label.name}"?`,
    description: label.lead_count
      ? `It is taken off ${leadCountText(label.lead_count)}. The leads themselves are not deleted.`
      : 'No lead has this label.',
    actionLabel: 'Delete label',
    destructive: true,
    run: async () => {
      try {
        await labelsApi.remove(label.id);
        toast.success('Label deleted');
        changed();
      } catch (err) {
        toast.error(err.message || 'Could not delete the label.');
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FiTag /> Labels</DialogTitle>
          <DialogDescription>
            Group your leads with labels, then filter the list or send a campaign to everyone with a label.
          </DialogDescription>
        </DialogHeader>

        {canManage && (
          <form onSubmit={create} className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-label-name" className="text-[13px] font-semibold text-slate-700">New label</Label>
              <div className="flex gap-2">
                <Input id="new-label-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={LABEL_NAME_MAX} placeholder="e.g. VIP, Call back" disabled={creating} className="h-9 bg-white" />
                <Button type="submit" disabled={creating || !cleanLabelName(name)}>{creating ? <Spinner /> : <FiPlus />} Add</Button>
              </div>
            </div>
            <ColorSwatches value={color} onChange={setColor} disabled={creating} />
          </form>
        )}

        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1">
          {loading ? (
            Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-14" />)
          ) : labels.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {canManage ? 'No labels yet. Create your first one above.' : 'No labels yet. Ask your workspace owner to create some.'}
            </p>
          ) : (
            filterLabels(labels).map((label) => (
              <LabelRow key={`${label.id}-${label.name}-${label.color}`} label={label} labels={labels} canManage={canManage} onSaved={changed} onDelete={askDelete} />
            ))
          )}
        </div>
        <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
      </DialogContent>
    </Dialog>
  );
}
