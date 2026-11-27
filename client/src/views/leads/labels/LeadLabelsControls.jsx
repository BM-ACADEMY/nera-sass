import { useState } from 'react';
import { FiPlus, FiTag } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { LabelChips } from './LabelChip.jsx';
import { LabelsManager } from './LabelsManager.jsx';

// Small pieces the Leads page (views/LeadsView.jsx) drops in, so its own
// edits stay a few lines.

/** The "Labels" header button; opens the LabelsManager. */
export function LabelsManagerButton({ canManage, onChanged }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}><FiTag /> Labels</Button>
      {open && <LabelsManager open onOpenChange={setOpen} canManage={canManage} onChanged={onChanged} />}
    </>
  );
}

/**
 * A lead's labels in a list row, and the row's way to change them: clicking
 * the chips (or "Label" when there are none) calls onEdit(lead), which opens
 * the LeadLabelsDialog. Does not open the chat.
 */
export function LeadLabelsCell({ lead, onEdit, max = 3 }) {
  const labels = lead?.labels || [];
  const edit = (event) => { event.stopPropagation(); onEdit(lead); };
  return (
    <button
      type="button"
      onClick={edit}
      onKeyDown={(e) => e.stopPropagation()}
      className="group -mx-1 flex max-w-[240px] cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-left hover:bg-muted"
      aria-label={labels.length ? `Labels of ${lead?.name || 'lead'}: ${labels.map((l) => l.name).join(', ')}. Change labels` : `Add a label to ${lead?.name || 'lead'}`}
    >
      {labels.length ? (
        <LabelChips labels={labels} max={max} />
      ) : (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground"><FiPlus className="size-3" /> Label</span>
      )}
    </button>
  );
}
