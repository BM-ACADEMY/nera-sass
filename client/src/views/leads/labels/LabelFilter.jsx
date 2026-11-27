import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { filterLabels, labelColor } from '../labelsPolicy.js';
import { labelsApi } from './labelsApi.js';

/**
 * "All labels" or one label, for the Leads list (sent as tag_id / label).
 * value: 'all' or a label id as a string. Reloads when `refreshKey` changes
 * (after labels are created, renamed or deleted). A chosen label that was
 * deleted falls back to 'all'.
 */
export function LabelFilter({ value, onChange, refreshKey = 0, className }) {
  const [labels, setLabels] = useState([]);

  useEffect(() => {
    let live = true;
    labelsApi.list()
      .then((data) => {
        if (!live) return;
        const list = data.labels || [];
        setLabels(list);
        if (value !== 'all' && !list.some((label) => String(label.id) === value)) onChange('all');
      })
      .catch(() => {});
    return () => { live = false; };
    // Reload on refreshKey only; `value` is checked against the fresh list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  if (!labels.length && value === 'all') return null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn('h-9 w-full sm:w-44', className)} aria-label="Label"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All labels</SelectItem>
        {filterLabels(labels).map((label) => (
          <SelectItem key={label.id} value={String(label.id)}>
            <span className={cn('size-2 shrink-0 rounded-full', labelColor(label.color).dot)} aria-hidden="true" />
            {label.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
