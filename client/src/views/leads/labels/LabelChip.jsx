import { FiCheck } from 'react-icons/fi';
import { cn } from '@/lib/utils';
import { LABEL_COLORS, labelColor } from '../labelsPolicy.js';

// A coloured pill with a label's name.
export function LabelChip({ label, className, onRemove }) {
  const color = labelColor(label?.color);
  return (
    <span className={cn('inline-flex max-w-[160px] items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4', color.chip, className)} title={label?.name}>
      <span className={cn('size-1.5 shrink-0 rounded-full', color.dot)} aria-hidden="true" />
      <span className="truncate">{label?.name}</span>
      {onRemove && (
        <button type="button" className="-mr-0.5 cursor-pointer rounded-full px-0.5 opacity-60 hover:opacity-100" aria-label={`Remove label ${label?.name}`} onClick={(e) => { e.stopPropagation(); onRemove(label); }}>×</button>
      )}
    </span>
  );
}

// A lead's labels: the first `max`, then "+N".
export function LabelChips({ labels, max = 3, className }) {
  const list = labels || [];
  if (!list.length) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {list.slice(0, max).map((label) => <LabelChip key={label.id} label={label} />)}
      {list.length > max && <span className="text-[11px] font-medium text-muted-foreground" title={list.slice(max).map((l) => l.name).join(', ')}>+{list.length - max}</span>}
    </div>
  );
}

// The 8 colour swatches.
export function ColorSwatches({ value, onChange, disabled }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Label colour">
      {LABEL_COLORS.map((color) => (
        <button
          key={color.key}
          type="button"
          role="radio"
          aria-checked={value === color.key}
          aria-label={color.name}
          title={color.name}
          disabled={disabled}
          onClick={() => onChange(color.key)}
          className={cn(
            'flex size-7 cursor-pointer items-center justify-center rounded-full text-white ring-offset-2 transition-shadow disabled:cursor-not-allowed disabled:opacity-50',
            color.dot,
            value === color.key ? 'ring-2 ring-slate-900' : 'hover:ring-2 hover:ring-slate-300',
          )}
        >
          {value === color.key && <FiCheck className="size-3.5" />}
        </button>
      ))}
    </div>
  );
}
