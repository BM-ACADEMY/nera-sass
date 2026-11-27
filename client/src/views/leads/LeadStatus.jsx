import { FiPlusCircle, FiSun, FiCheckCircle, FiXCircle, FiCircle, FiUserX } from 'react-icons/fi';
import { FaFire, FaSnowflake } from 'react-icons/fa';
import { cn } from '@/lib/utils';
import { statusInfo, initials, avatarTone } from './leadsPolicy.js';

// Icons for the status mapping in leadsPolicy.js (STATUS_OPTIONS[].icon), and
// the small people avatars of the assign lists. Used by the status filter, the
// bulk bar, the status badge and the row menu, so they always match.
const STATUS_ICONS = {
  new: FiPlusCircle,
  hot: FaFire,
  warm: FiSun,
  cold: FaSnowflake,
  converted: FiCheckCircle,
  lost: FiXCircle,
  other: FiCircle,
};

export function StatusIcon({ status, className }) {
  const info = statusInfo(status);
  const Icon = STATUS_ICONS[info.icon] || STATUS_ICONS.other;
  return <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', info.iconTone, className)} />;
}

/** Icon and name, for dropdown and menu items. */
export function StatusLabel({ status }) {
  return (
    <span className="inline-flex items-center gap-2">
      <StatusIcon status={status} />
      {statusInfo(status).label}
    </span>
  );
}

export function StatusBadge({ status, className }) {
  const info = statusInfo(status);
  return (
    <span className={cn('inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', info.tone, className)}>
      <StatusIcon status={status} className="size-3 text-current" />
      {info.label}
    </span>
  );
}

/** Initials in a circle, one colour per person. */
export function PersonAvatar({ name, id, className }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold', avatarTone(id ?? name), className)}
    >
      {initials(name)}
    </span>
  );
}

/** "Nobody (unassign)" in assign lists. */
export function NobodyAvatar({ className }) {
  return (
    <span aria-hidden="true" className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-400', className)}>
      <FiUserX className="size-3" />
    </span>
  );
}

/** Avatar and name, for assign dropdown and menu items. */
export function PersonLabel({ user }) {
  const name = user?.name || user?.email || 'Team member';
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <PersonAvatar name={name} id={user?.id} />
      <span className="truncate">{name}</span>
    </span>
  );
}

export function NobodyLabel() {
  return (
    <span className="inline-flex items-center gap-2">
      <NobodyAvatar />
      Nobody (unassign)
    </span>
  );
}
