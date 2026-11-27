import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { FiPlus, FiUpload, FiDownload, FiSearch, FiUsers, FiMoreVertical, FiMessageCircle, FiTrash2, FiX, FiChevronLeft, FiChevronRight, FiRefreshCw, FiFileText, FiEdit3, FiUserPlus, FiFlag, FiCheck, FiActivity, FiTag } from 'react-icons/fi';
import { useLeads } from '../hooks/useLeads.js';
import { api } from '../services/api.js';
import { USER_KEY } from '../services/session.js';
import ConfirmDialog from '../components/templates/ConfirmDialog';
import { AddLeadDialog, ImportLeadsDialog, ExportLeadsDialog, AddNoteDialog } from './leads/LeadDialogs.jsx';
import { LeadDetailSheet } from './leads/LeadDetailSheet.jsx';
import { StatusBadge, StatusLabel, PersonLabel, NobodyLabel } from './leads/LeadStatus.jsx';
import {
  PAGE_SIZE, SOURCE_LABELS, SOURCE_VARIANT, STATUS_OPTIONS, sourceFilters, leadSourceKind, statusInfo, pageInfo,
  lastMessageText, timeAgo, shortDate, toggleAll, toggleOne, uniqueLeads, leadPermissions, bulkLeadConfirm,
  selectionOnPage, changedBy, noteCountLabel,
} from './leads/leadsPolicy.js';
import { LabelFilter, LabelsManagerButton, LeadLabelsCell, LeadLabelsDialog } from './leads/labels/index.js';
import { labelPermissions } from './leads/labelsPolicy.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

// Leads: everyone who wrote to the workspace's WhatsApp number, clicked a
// WhatsApp ad, was imported from a sheet or added by hand. Same look as the
// Templates and Settings pages (shadcn kit, light theme).

const readRole = () => {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || '{}')?.role || null; } catch { return null; }
};

const SourceBadge = ({ lead }) => {
  const kind = leadSourceKind(lead);
  return <Badge variant={SOURCE_VARIANT[kind]}>{SOURCE_LABELS[kind]}</Badge>;
};

const Avatar = ({ name }) => (
  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[13px] font-bold text-blue-700">
    {String(name || '?').trim().charAt(0).toUpperCase() || '?'}
  </span>
);

const LastActivity = ({ lead }) => {
  const text = lastMessageText(lead);
  const when = timeAgo(lead.last_contact);
  if (!text && !when) return <span className="text-[13px] text-muted-foreground">No messages yet</span>;
  return (
    <div className="min-w-0 max-w-[260px]">
      {text && <div className="truncate text-[13px]">{text}</div>}
      {when && <div className="text-xs text-muted-foreground">{when}</div>}
    </div>
  );
};

const Checkbox = ({ checked, indeterminate = false, onChange, label }) => (
  <input
    type="checkbox"
    aria-label={label}
    className="size-4 cursor-pointer accent-primary"
    checked={checked}
    ref={(node) => { if (node) node.indeterminate = indeterminate && !checked; }}
    onChange={onChange}
    onClick={(e) => e.stopPropagation()}
  />
);

// "Aakash · 2:30 pm": the last team member who changed the lead, and when.
const UpdatedBy = ({ lead, className }) => {
  const who = changedBy(lead);
  if (!who) return <span className={cn('text-muted-foreground', className)}>—</span>;
  return (
    <span className={className} title={lead.last_changed_at ? new Date(lead.last_changed_at).toLocaleString('en-IN') : undefined}>
      {who.name}{who.when && <span className="text-muted-foreground"> · {who.when}</span>}
    </span>
  );
};

// Small note icon with the count, when the lead has notes; opens the details.
const NoteCount = ({ lead, onOpen }) => {
  const label = noteCountLabel(lead.note_count);
  if (!label) return null;
  return (
    <button
      type="button"
      title={label}
      aria-label={`${label}: open notes for ${lead.name || 'lead'}`}
      onClick={(e) => { e.stopPropagation(); onOpen(lead); }}
      className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-100"
    >
      <FiFileText className="size-3" /> {Number(lead.note_count)}
    </button>
  );
};

// Row actions (the ⋮ menu): status and assignment of this one lead (no
// confirm, unlike bulk changes), notes, details, chat, delete (owners, admins
// and managers). Radix closes it on Escape, outside click and after a choice.
const RowMenu = ({ lead, users, onStatus, onAssign, onAddNote, onLabels, onDetails, onOpen, onDelete }) => {
  const current = statusInfo(lead.status).value;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${lead.name || 'lead'}`} onClick={(e) => e.stopPropagation()}><FiMoreVertical /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={8} className="w-52" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger><FiFlag /> Change status</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {STATUS_OPTIONS.map((option) => (
              <DropdownMenuItem key={option.value} onSelect={() => option.value !== current && onStatus(lead, option.value)}>
                <StatusLabel status={option.value} />
                {option.value === current && <FiCheck className="ml-auto text-muted-foreground" aria-label="Current status" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger><FiUserPlus /> Assign to</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-w-64">
            <DropdownMenuItem onSelect={() => lead.assigned_to != null && onAssign(lead, null)}>
              <NobodyLabel />
              {lead.assigned_to == null && <FiCheck className="ml-auto text-muted-foreground" aria-label="Not assigned now" />}
            </DropdownMenuItem>
            {users.map((user) => (
              <DropdownMenuItem key={user.id} onSelect={() => user.id !== lead.assigned_to && onAssign(lead, user)}>
                <PersonLabel user={user} />
                {user.id === lead.assigned_to && <FiCheck className="ml-auto text-muted-foreground" aria-label="Assigned now" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={() => onAddNote(lead)}><FiEdit3 /> Add note</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onLabels(lead)}><FiTag /> Labels</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onDetails(lead)}><FiActivity /> Notes & activity</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onOpen(lead)}><FiMessageCircle /> Open chat</DropdownMenuItem>
        {onDelete && <DropdownMenuSeparator />}
        {onDelete && <DropdownMenuItem variant="destructive" onSelect={() => onDelete(lead)}><FiTrash2 /> Delete lead</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const Empty = ({ filtered, onAdd, onImport, onClear }) => (
  <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
    <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><FiUsers className="size-5" /></span>
    <div className="font-semibold">{filtered ? 'No lead matches' : 'No leads yet'}</div>
    <p className="max-w-md text-sm text-muted-foreground">
      {filtered ? 'Try another search or filter.' : 'Leads appear here when someone writes to your WhatsApp number. You can also add them by hand or import a sheet.'}
    </p>
    {filtered ? <Button variant="outline" className="mt-1" onClick={onClear}>Clear filters</Button> : (
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        <Button variant="outline" onClick={onImport}><FiUpload /> Import</Button>
        <Button onClick={onAdd}><FiPlus /> Add lead</Button>
      </div>
    )}
  </div>
);

export const LeadsView = ({ onLeadClick, refreshTrigger }) => {
  const [source, setSource] = useState('all');
  const [status, setStatus] = useState('all');
  const [assignedTo, setAssignedTo] = useState('all');
  const [campaign, setCampaign] = useState('all');
  const [ad, setAd] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set());
  const [users, setUsers] = useState([]);
  const [sourceCounts, setSourceCounts] = useState({});
  const [fbOptions, setFbOptions] = useState([]);
  const [dialog, setDialog] = useState(null); // 'add' | 'import' | 'export'
  const [confirm, setConfirm] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkKey, setBulkKey] = useState(0);
  const [detailLead, setDetailLead] = useState(null); // lead whose notes & activity are open
  const [noteLead, setNoteLead] = useState(null); // lead the Add note dialog is for
  const [notesVersion, setNotesVersion] = useState(0);
  const { canExport, canDelete } = leadPermissions(readRole());
  // Labels: list filter, the lead whose labels are being edited, reload key.
  const [labelFilter, setLabelFilter] = useState('all');
  const [labelLead, setLabelLead] = useState(null);
  const [labelsKey, setLabelsKey] = useState(0);
  const { canManage: canManageLabels } = labelPermissions(readRole());

  // A different filter starts again at page 1 with nothing selected.
  const resetView = () => { setPage(1); setSelected(new Set()); };
  // Another page starts with nothing selected too: ticks are per page.
  const goToPage = (next) => { setPage(next); setSelected(new Set()); };
  const filterSetter = (setter) => (value) => { setter(value); resetView(); };

  // Search runs 300 ms after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchInput.trim();
      setSearch((current) => {
        if (current !== next) { setPage(1); setSelected(new Set()); }
        return next;
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // The page shown, kept within the last page of the latest total: after a
  // delete or bulk change the last page can be gone.
  const [lastTotal, setLastTotal] = useState(null);
  const shownPage = lastTotal == null ? page : pageInfo(lastTotal, page).page;
  const { leads: rawLeads, total, loading, error, refetch } = useLeads({
    status: status !== 'all' ? status : undefined,
    source: source !== 'all' ? source : undefined,
    assignedTo: assignedTo !== 'all' ? assignedTo : undefined,
    campaignName: source === 'facebook' && campaign !== 'all' ? campaign : undefined,
    adName: source === 'facebook' && ad !== 'all' ? ad : undefined,
    search: search || undefined,
    tagId: labelFilter !== 'all' ? labelFilter : undefined,
    limit: PAGE_SIZE,
    offset: (shownPage - 1) * PAGE_SIZE,
  });
  const leads = useMemo(() => uniqueLeads(rawLeads), [rawLeads]);
  const pager = pageInfo(total, shownPage);
  const hasFacebook = Number(sourceCounts.facebook) > 0;

  const loadSummary = useCallback(() => {
    api.getLeadSourceSummary().then((data) => setSourceCounts(data.counts || {})).catch(() => {});
  }, []);

  useEffect(() => {
    loadSummary();
    api.getUsers()
      .then((data) => setUsers(uniqueLeads(data.users || []).filter((user) => user.is_active !== false)))
      .catch(() => {});
  }, [loadSummary]);

  // Facebook campaign / ad names: asked for only when this workspace has
  // lead form leads.
  useEffect(() => {
    if (!hasFacebook) return;
    api.getFacebookLeadFilterOptions().then((data) => setFbOptions(data.options || [])).catch(() => setFbOptions([]));
  }, [hasFacebook]);

  if (!loading && !error && total !== lastTotal) setLastTotal(total);

  const refreshAll = useCallback(() => {
    refetch();
    loadSummary();
  }, [loadSummary, refetch]);

  useEffect(() => {
    if (refreshTrigger) refreshAll();
    // Only when the app asks for a refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  const filters = sourceFilters(sourceCounts);
  const campaignNames = [...new Set(fbOptions.map((option) => option.campaign_name).filter(Boolean))];
  const adNames = [...new Set(fbOptions.filter((option) => campaign === 'all' || option.campaign_name === campaign).map((option) => option.ad_name).filter(Boolean))];
  const filtered = source !== 'all' || status !== 'all' || assignedTo !== 'all' || labelFilter !== 'all' || Boolean(search);
  const pageIds = leads.map((lead) => lead.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPage = pageIds.some((id) => selected.has(id));
  // Only ticked rows that are on the page count (a lead that left the list
  // after a change does not); the bulk bar shows only when there are some.
  const selectedIds = [...selectionOnPage(selected, pageIds)];

  const clearFilters = () => {
    setSource('all'); setStatus('all'); setAssignedTo('all'); setLabelFilter('all'); setCampaign('all'); setAd('all'); setSearchInput(''); setSearch('');
    resetView();
  };

  const bulkUpdate = async (body, done) => {
    setBulkBusy(true);
    try {
      const res = await api.bulkUpdateLeads({ ids: selectedIds, ...body });
      toast.success(done(res.updated ?? selectedIds.length));
      setSelected(new Set());
      refreshAll();
    } catch (err) {
      toast.error(err.message || 'Could not update the leads. Please try again.');
    } finally {
      setBulkBusy(false);
      setBulkKey((key) => key + 1);
    }
  };

  // Bulk changes ask first, with the number of leads, then call the server.
  const bulkAssign = (value) => {
    const user = users.find((u) => String(u.id) === value);
    const name = value === 'none' ? null : (user?.name || 'the team member');
    setConfirm({
      ...bulkLeadConfirm({ action: 'assign', count: selectedIds.length, assigneeName: name }),
      run: () => bulkUpdate(
        { action: 'assign', assigned_to: value === 'none' ? null : Number(value) },
        (n) => (value === 'none' ? `${n} leads unassigned` : `${n} leads assigned to ${name}`),
      ),
    });
  };

  const bulkStatus = (value) => setConfirm({
    ...bulkLeadConfirm({ action: 'status', count: selectedIds.length, statusLabel: statusInfo(value).label }),
    run: () => bulkUpdate({ action: 'status', status: value }, (n) => `${n} leads set to ${statusInfo(value).label}`),
  });

  // One lead from the row menu: no confirm (bulk changes ask first).
  const updateOne = async (lead, body, done) => {
    try {
      await api.updateLead(lead.id, body);
      toast.success(done);
      refreshAll();
      if (detailLead?.id === lead.id) setNotesVersion((v) => v + 1);
    } catch (err) {
      toast.error(err.message || 'Could not update the lead. Please try again.');
    }
  };
  const setOneStatus = (lead, value) => updateOne(lead, { status: value }, `${lead.name || 'Lead'} set to ${statusInfo(value).label}`);
  const assignOne = (lead, user) => updateOne(
    lead,
    { assigned_to: user ? user.id : null },
    user ? `${lead.name || 'Lead'} assigned to ${user.name || user.email}` : `${lead.name || 'Lead'} unassigned`,
  );

  const noteSaved = () => { setNotesVersion((v) => v + 1); refetch(); };
  const rowMenu = (lead) => (
    <RowMenu
      lead={lead}
      users={users}
      onStatus={setOneStatus}
      onAssign={assignOne}
      onAddNote={setNoteLead}
      onLabels={setLabelLead}
      onDetails={setDetailLead}
      onOpen={onLeadClick}
      onDelete={canDelete ? askDelete : null}
    />
  );

  const askDelete = (lead) => setConfirm({
    title: `Delete ${lead.name || 'this lead'}?`,
    description: 'Their chat history, payments and tasks are deleted too. This cannot be undone.',
    actionLabel: 'Delete lead',
    destructive: true,
    run: async () => {
      try {
        await api.deleteLead(lead.id);
        toast.success('Lead deleted');
        setSelected((current) => { const next = new Set(current); next.delete(lead.id); return next; });
        refreshAll();
      } catch (err) {
        toast.error(err.message || 'Could not delete the lead.');
      }
    },
  });

  const showSkeleton = loading && leads.length === 0;

  return (
    <div className="flex flex-col gap-5 p-4 md:p-8">
      {/* Header */}
      <Card className="flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><FiUsers size={20} /></span>
        <div className="min-w-0 flex-1">
          <div className="font-bold">Leads</div>
          <p className="text-[13px] text-muted-foreground">
            Everyone who wrote to your WhatsApp number, clicked your WhatsApp ad, or was imported or added by hand.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LabelsManagerButton canManage={canManageLabels} onChanged={() => { setLabelsKey((key) => key + 1); refreshAll(); }} />
          <Button variant="outline" onClick={() => setDialog('import')}><FiUpload /> Import</Button>
          {canExport && <Button variant="outline" onClick={() => setDialog('export')}><FiDownload /> Export</Button>}
          <Button onClick={() => setDialog('add')}><FiPlus /> Add lead</Button>
        </div>
      </Card>

      <Card className="gap-4 px-4 py-4 sm:px-5">
        {/* Source */}
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="tablist" aria-label="Source">
          {filters.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={source === item.value}
              onClick={() => { setSource(item.value); setCampaign('all'); setAd('all'); resetView(); }}
              className={cn(
                'inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors',
                source === item.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-slate-600 hover:bg-muted',
              )}
            >
              {item.label}
              {item.count != null && <span className={cn('rounded-full px-1.5 text-[11px] font-semibold', source === item.value ? 'bg-white/20' : 'bg-muted text-muted-foreground')}>{item.count.toLocaleString('en-IN')}</span>}
            </button>
          ))}
        </div>

        {/* Search and filters */}
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <FiSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
            <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search by name or phone" className="h-9 pl-9" aria-label="Search leads" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Select value={status} onValueChange={filterSetter(setStatus)}>
              <SelectTrigger className="h-9 w-full sm:w-40" aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUS_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}><StatusLabel status={option.value} /></SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={assignedTo} onValueChange={filterSetter(setAssignedTo)}>
              <SelectTrigger className="h-9 w-full sm:w-44" aria-label="Assigned to"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Anyone</SelectItem>
                <SelectItem value="unassigned">Not assigned</SelectItem>
                {users.map((user) => <SelectItem key={user.id} value={String(user.id)}>{user.name || user.email}</SelectItem>)}
              </SelectContent>
            </Select>
            <LabelFilter value={labelFilter} onChange={filterSetter(setLabelFilter)} refreshKey={labelsKey} />
          </div>
        </div>

        {source === 'facebook' && (campaignNames.length > 0 || adNames.length > 0) && (
          <div className="grid grid-cols-1 gap-2 sm:flex">
            <Select value={campaign} onValueChange={(value) => { setCampaign(value); setAd('all'); resetView(); }}>
              <SelectTrigger className="h-9 w-full sm:w-60" aria-label="Campaign"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All campaigns</SelectItem>
                {campaignNames.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={ad} onValueChange={filterSetter(setAd)}>
              <SelectTrigger className="h-9 w-full sm:w-60" aria-label="Ad"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All ads</SelectItem>
                {adNames.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Bulk actions: only while rows on this page are ticked */}
        {selectedIds.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2.5 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-blue-800">
              {bulkBusy && <Spinner />} {selectedIds.length} selected
              <Button variant="ghost" size="sm" className="h-7 px-2 text-blue-700" onClick={() => setSelected(new Set())}><FiX /> Clear</Button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:ml-auto sm:flex">
              <Select key={`assign-${bulkKey}`} onValueChange={bulkAssign} disabled={bulkBusy}>
                <SelectTrigger className="h-8 w-full bg-white sm:w-44" size="sm" aria-label="Assign selected leads"><SelectValue placeholder="Assign to…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none"><NobodyLabel /></SelectItem>
                  {users.map((user) => <SelectItem key={user.id} value={String(user.id)}><PersonLabel user={user} /></SelectItem>)}
                </SelectContent>
              </Select>
              <Select key={`status-${bulkKey}`} onValueChange={bulkStatus} disabled={bulkBusy}>
                <SelectTrigger className="h-8 w-full bg-white sm:w-40" size="sm" aria-label="Change status of selected leads"><SelectValue placeholder="Change status…" /></SelectTrigger>
                <SelectContent>{STATUS_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}><StatusLabel status={option.value} /></SelectItem>)}</SelectContent>
              </Select>
              {canExport && <Button variant="outline" size="sm" className="col-span-2 bg-white sm:col-span-1" onClick={() => setDialog('export')} disabled={bulkBusy}><FiDownload /> Export</Button>}
            </div>
          </div>
        )}

        {error && (
          <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-800 sm:flex-row sm:items-center sm:justify-between">
            <span>Could not load your leads. {error}</span>
            <Button variant="outline" size="sm" className="bg-white" onClick={refreshAll}><FiRefreshCw /> Try again</Button>
          </div>
        )}

        {showSkeleton ? (
          <div className="flex flex-col gap-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : leads.length === 0 ? (
          !error && <Empty filtered={filtered} onAdd={() => setDialog('add')} onImport={() => setDialog('import')} onClear={clearFilters} />
        ) : (
          <div className={cn('transition-opacity', loading && 'opacity-60')}>
            {/* Phones: cards */}
            <div className="flex flex-col gap-2 md:hidden">
              <label className="flex items-center gap-2 px-1 text-[13px] text-muted-foreground">
                <Checkbox checked={allOnPage} indeterminate={someOnPage} onChange={() => setSelected((current) => toggleAll(current, pageIds))} label="Select all on this page" />
                Select all on this page
              </label>
              {leads.map((lead) => (
                <div
                  key={lead.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onLeadClick(lead)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onLeadClick(lead); }}
                  className={cn('flex cursor-pointer gap-3 rounded-lg border px-3 py-3 text-left hover:bg-muted/50', selected.has(lead.id) ? 'border-blue-300 bg-blue-50/50' : 'border-border')}
                >
                  <div className="pt-2.5"><Checkbox checked={selected.has(lead.id)} onChange={() => setSelected((current) => toggleOne(current, lead.id))} label={`Select ${lead.name || 'lead'}`} /></div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5"><span className="truncate font-semibold">{lead.name || 'No name'}</span><NoteCount lead={lead} onOpen={setDetailLead} /></div>
                        <div className="text-[13px] text-muted-foreground">{lead.phone || '—'}</div>
                      </div>
                      <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>{rowMenu(lead)}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5"><SourceBadge lead={lead} /><StatusBadge status={lead.status} /></div>
                    <LeadLabelsCell lead={lead} onEdit={setLabelLead} />
                    <LastActivity lead={lead} />
                    <div className="text-xs text-muted-foreground">{lead.assigned_name ? `Assigned to ${lead.assigned_name}` : 'Not assigned'} · Added {shortDate(lead.created_at)}</div>
                    {changedBy(lead) && <div className="text-xs text-muted-foreground">Updated by <UpdatedBy lead={lead} className="text-slate-700" /></div>}
                  </div>
                </div>
              ))}
            </div>

            {/* Larger screens: table */}
            <div className="hidden overflow-hidden rounded-lg border border-border md:block">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-10 pr-0"><Checkbox checked={allOnPage} indeterminate={someOnPage} onChange={() => setSelected((current) => toggleAll(current, pageIds))} label="Select all on this page" /></TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Labels</TableHead>
                    <TableHead>Assigned to</TableHead>
                    <TableHead>Last message</TableHead>
                    <TableHead>Updated by</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leads.map((lead) => (
                    <TableRow key={lead.id} onClick={() => onLeadClick(lead)} className={cn('cursor-pointer', selected.has(lead.id) && 'bg-blue-50/50 hover:bg-blue-50')}>
                      <TableCell className="pr-0"><Checkbox checked={selected.has(lead.id)} onChange={() => setSelected((current) => toggleOne(current, lead.id))} label={`Select ${lead.name || 'lead'}`} /></TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar name={lead.name} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5"><span className="max-w-[200px] truncate font-semibold">{lead.name || 'No name'}</span><NoteCount lead={lead} onOpen={setDetailLead} /></div>
                            {lead.interest && <div className="max-w-[220px] truncate text-xs text-muted-foreground">{lead.interest}</div>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-[13px] whitespace-nowrap text-slate-600">{lead.phone || '—'}</TableCell>
                      <TableCell><SourceBadge lead={lead} /></TableCell>
                      <TableCell><StatusBadge status={lead.status} /></TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}><LeadLabelsCell lead={lead} onEdit={setLabelLead} /></TableCell>
                      <TableCell className="text-[13px] whitespace-nowrap">{lead.assigned_name || <span className="text-muted-foreground">Not assigned</span>}</TableCell>
                      <TableCell><LastActivity lead={lead} /></TableCell>
                      <TableCell className="text-[13px] whitespace-nowrap"><UpdatedBy lead={lead} /></TableCell>
                      <TableCell className="text-[13px] whitespace-nowrap text-muted-foreground">{shortDate(lead.created_at)}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>{rowMenu(lead)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pager: numbers from the server's total */}
            <div className="mt-3 flex flex-col items-center justify-between gap-2 sm:flex-row">
              <span className="text-[13px] text-muted-foreground">
                Showing {pager.from.toLocaleString('en-IN')}–{pager.to.toLocaleString('en-IN')} of {pager.total.toLocaleString('en-IN')} leads
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={!pager.hasPrev || loading} onClick={() => goToPage(pager.page - 1)}><FiChevronLeft /> Previous</Button>
                <span className="px-1 text-[13px] font-medium">Page {pager.page} of {pager.pages}</span>
                <Button variant="outline" size="sm" disabled={!pager.hasNext || loading} onClick={() => goToPage(pager.page + 1)}>Next <FiChevronRight /></Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Mounted only while open, so each opens with a fresh form. */}
      {dialog === 'add' && <AddLeadDialog open onOpenChange={(open) => !open && setDialog(null)} users={users} onSaved={refreshAll} />}
      {dialog === 'import' && <ImportLeadsDialog open onOpenChange={(open) => !open && setDialog(null)} onImported={refreshAll} />}
      {dialog === 'export' && <ExportLeadsDialog open onOpenChange={(open) => !open && setDialog(null)} selectedIds={selectedIds} showFacebook={hasFacebook} />}
      {noteLead && <AddNoteDialog open lead={noteLead} onOpenChange={(open) => !open && setNoteLead(null)} onSaved={noteSaved} />}
      {detailLead && (
        <LeadDetailSheet
          open
          lead={leads.find((lead) => lead.id === detailLead.id) || detailLead}
          onOpenChange={(open) => !open && setDetailLead(null)}
          onAddNote={setNoteLead}
          onOpenChat={onLeadClick}
          onNotesChanged={refetch}
          notesVersion={notesVersion}
        />
      )}
      {labelLead && <LeadLabelsDialog open lead={labelLead} canManage={canManageLabels} onOpenChange={(open) => !open && setLabelLead(null)} onSaved={() => { setLabelsKey((key) => key + 1); refreshAll(); }} />}
      <ConfirmDialog confirm={confirm} onClose={() => { setConfirm(null); setBulkKey((key) => key + 1); }} />
    </div>
  );
};
