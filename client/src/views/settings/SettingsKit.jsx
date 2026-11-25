import { useNavigate } from 'react-router-dom';
import { FiUser, FiBriefcase, FiShield, FiLock, FiArrowLeft, FiActivity } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { findSection } from './settingsPolicy.js';

// Same building blocks as the admin panel's Settings (hub cards, page header
// with a way back, label + field rows), in the customer panel's shadcn kit.

const SECTION_LOOK = {
  profile: { icon: FiUser, tone: 'bg-blue-50 text-blue-600 ring-blue-100' },
  brand: { icon: FiBriefcase, tone: 'bg-violet-50 text-violet-600 ring-violet-100' },
  'two-step': { icon: FiShield, tone: 'bg-emerald-50 text-emerald-600 ring-emerald-100' },
  password: { icon: FiLock, tone: 'bg-amber-50 text-amber-600 ring-amber-100' },
  activity: { icon: FiActivity, tone: 'bg-sky-50 text-sky-600 ring-sky-100' },
};

export const SectionIcon = ({ section, size = 20, className }) => {
  const look = SECTION_LOOK[section];
  const Icon = look.icon;
  return <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl ring-4', look.tone, className)}><Icon size={size} /></span>;
};

// Header of one settings page: back to the hub, icon and title.
export const SettingsPageHeader = ({ section }) => {
  const navigate = useNavigate();
  const meta = findSection(section);
  return (
    <div className="mb-6">
      <Button variant="ghost" size="sm" className="-ml-2 mb-3 text-slate-500" onClick={() => navigate('/settings')}>
        <FiArrowLeft /> Settings
      </Button>
      <div className="flex items-center gap-3.5">
        <SectionIcon section={section} />
        <div>
          <h1 className="text-lg font-extrabold tracking-tight">{meta.title}</h1>
          <p className="text-[13px] text-muted-foreground">{meta.text}</p>
        </div>
      </div>
    </div>
  );
};

export const FormRow = ({ label, htmlFor, hint, children }) => (
  <div className="flex flex-col gap-1.5">
    <Label htmlFor={htmlFor} className="text-[13px] font-semibold text-slate-700">{label}</Label>
    {children}
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

// Label/value rows that cannot be edited; a lock shows they are fixed.
export const InfoList = ({ rows }) => (
  <dl className="divide-y divide-border">
    {rows.map((row) => (
      <div key={row.key || row.label} className="flex items-center justify-between gap-4 py-2.5">
        <dt className="text-sm text-muted-foreground">{row.label}</dt>
        <dd className={cn('flex min-w-0 items-center gap-1.5 text-right text-sm font-medium', row.mono && 'font-mono text-[12.5px]')}>
          <span className="truncate">{row.value || '—'}</span>
          {row.locked && <FiLock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Read only" />}
        </dd>
      </div>
    ))}
  </dl>
);

export const Callout = ({ tone = 'muted', children, className }) => {
  const tones = {
    muted: 'border-slate-200 bg-slate-50 text-slate-700',
    info: 'border-blue-200 bg-blue-50 text-blue-800',
    ok: 'border-green-200 bg-green-50 text-green-800',
    warn: 'border-amber-200 bg-amber-50 text-amber-800',
    error: 'border-red-200 bg-red-50 text-red-800',
  };
  return <div className={cn('rounded-lg border px-3.5 py-2.5 text-[13px]', tones[tone], className)}>{children}</div>;
};
