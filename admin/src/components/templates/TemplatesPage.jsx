import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { FiPlus, FiRefreshCw, FiSearch, FiEye, FiEdit2, FiTrash2, FiFileText, FiAlertTriangle, FiSmartphone } from 'react-icons/fi';
import { FaWhatsapp } from 'react-icons/fa';
import axiosClient from '../../api/axiosClient';
import { useLiveEvent } from '../../api/realtime';
import ConfirmDialog from '../ConfirmDialog';
import TemplateEditor, { EMPTY_FORM, LANGUAGES } from './TemplateEditor';
import TemplatePreview, { toEditorShape } from './TemplatePreview';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const STATUS_VARIANT = { APPROVED: 'success', PENDING: 'warning', IN_APPEAL: 'warning', REJECTED: 'danger', PAUSED: 'muted', DISABLED: 'muted' };
const STATUS_FILTERS = [['all', 'All'], ['APPROVED', 'Approved'], ['PENDING', 'Pending'], ['REJECTED', 'Rejected']];
const langName = (code) => LANGUAGES.find(([c]) => c === code)?.[1] || code;
const title = (s) => String(s || '').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const editable = (t) => ['APPROVED', 'REJECTED', 'PAUSED'].includes(t.status);
const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

const StatusBadge = ({ status }) => <Badge variant={STATUS_VARIANT[status] || 'muted'}>{title(status || 'unknown').replace('_', ' ')}</Badge>;

const Segmented = ({ value, onChange, options }) => (
  <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
    {options.map(([key, label, count]) => (
      <button
        key={key}
        type="button"
        onClick={() => onChange(key)}
        className={cn('flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap transition-colors', value === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
      >
        {label}{count != null && <span className="rounded-full bg-muted px-1.5 text-[11px]">{count}</span>}
      </button>
    ))}
  </div>
);

const Toolbar = ({ search, onSearch, status, onStatus, children, placeholder }) => (
  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
    <div className="relative flex-1">
      <FiSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
      <Input value={search} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder} className="h-9 pl-9" />
    </div>
    <Select value={status} onValueChange={onStatus}>
      <SelectTrigger className="h-9 w-full sm:w-40"><SelectValue /></SelectTrigger>
      <SelectContent>{STATUS_FILTERS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
    </Select>
    {children}
  </div>
);

const Empty = ({ icon: Icon = FiFileText, title: heading, text, action }) => (
  <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
    <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><Icon className="size-5" /></span>
    <div className="font-semibold">{heading}</div>
    <p className="max-w-md text-sm text-muted-foreground">{text}</p>
    {action}
  </div>
);

// Kept between visits so the page shows the last data at once and refreshes quietly.
const cache = { platform: null, clients: null };

const matches = (t, search, status) => (status === 'all' || t.status === status)
  && (!search.trim() || [t.name, t.category, t.waba_name, ...(t.workspaces || []).map((w) => w.name)].some((v) => String(v || '').toLowerCase().includes(search.trim().toLowerCase())));

/** Template Management: the admin WABA's templates and every client's. */
const TemplatesPage = ({ itemId, basePath, canManage }) => {
  const navigate = useNavigate();
  const [tab, setTab] = useState('getnera');
  const [platform, setPlatformState] = useState(cache.platform);
  const [clients, setClientsState] = useState(cache.clients);
  const [clientsLoading, setClientsLoading] = useState(false);
  const setPlatform = (value) => { cache.platform = value; setPlatformState(value); };
  const setClients = (value) => { cache.clients = value; setClientsState(value); };
  const loading = !platform;
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [account, setAccount] = useState('all');
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const loadPlatform = async ({ refresh = false } = {}) => {
    try {
      const res = await axiosClient.get('/admin/templates/platform', { params: refresh ? { refresh: 1 } : undefined });
      setPlatform(res.data);
      if (refresh) toast.success('Templates refreshed from Meta');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not load templates');
      if (!platform) setPlatform({ configured: false, templates: [] });
    }
  };
  const loadClients = async () => {
    try {
      setClients((await axiosClient.get('/admin/templates/clients')).data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not load client templates');
      setClients({ templates: [], accounts: [] });
    }
  };

  useEffect(() => { loadPlatform(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Meta's status webhook updates the list at once; while a template is still
  // in review the page also asks Meta every 15 seconds.
  useLiveEvent('templates:changed', () => { loadPlatform(); if (cache.clients) loadClients(); });
  const pendingCount = (platform?.templates || []).filter((t) => ['PENDING', 'IN_APPEAL'].includes(t.status)).length;
  useEffect(() => {
    if (!pendingCount || !platform?.can_manage) return undefined;
    let stopped = false;
    const check = async () => {
      if (document.hidden) return;
      try {
        const res = await axiosClient.post('/admin/templates/platform/check-pending');
        if (stopped) return;
        setPlatform({ ...cache.platform, templates: res.data.templates });
        if (res.data.changed) toast.success(`${res.data.changed} template${res.data.changed > 1 ? 's' : ''} reviewed by Meta`);
      } catch { /* keep the last list; the next check retries */ }
    };
    check();
    const timer = setInterval(check, 15000);
    return () => { stopped = true; clearInterval(timer); };
  }, [pendingCount, platform?.can_manage]); // eslint-disable-line react-hooks/exhaustive-deps
  // Client templates load only when that tab is opened.
  useEffect(() => {
    if (tab !== 'clients') return;
    if (!cache.clients) setClientsLoading(true);
    loadClients().finally(() => setClientsLoading(false));
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Client rows come without content; the preview fetches the one template.
  const openPreview = async (t) => {
    if (t.components?.length) { setPreview(t); return; }
    setPreview({ ...t, loading: true });
    try {
      const res = await axiosClient.get(`/admin/templates/item/${t.template_id}`);
      setPreview({ ...t, ...res.data.template, loading: false });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not load the template');
      setPreview(null);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await loadPlatform({ refresh: true });
    setRefreshing(false);
  };

  const remove = (t) => setConfirm({
    title: `Delete "${t.name}"?`,
    description: 'It is deleted from Meta in every language. The name cannot be reused for 30 days.',
    actionLabel: 'Delete template',
    destructive: true,
    run: async () => {
      try {
        await axiosClient.delete(`/admin/templates/platform/${t.template_id}`);
        toast.success('Template deleted');
        await loadPlatform();
      } catch (err) {
        toast.error(err.response?.data?.error || 'Delete failed');
      }
    },
  });

  const platformRows = useMemo(() => (platform?.templates || []).filter((t) => matches(t, search, status)), [platform, search, status]);
  const clientRows = useMemo(() => (clients?.templates || []).filter((t) => (account === 'all' || t.waba_id === account) && matches(t, search, status)), [clients, search, status, account]);

  // Editor routes: <base>/new and <base>/<template_id>
  if (itemId) {
    if (loading) return <Skeleton className="h-96 rounded-xl" />;
    if (itemId === 'new') {
      return <TemplateEditor onCancel={() => navigate(basePath)} onSaved={async () => { await loadPlatform(); navigate(basePath); }} />;
    }
    const current = (platform?.templates || []).find((t) => t.template_id === itemId);
    if (!current) {
      return <Card className="p-6"><Empty title="Template not found" text="It may have been deleted in Meta. Refresh the list and try again." action={<Button variant="outline" onClick={() => navigate(basePath)}>Back to templates</Button>} /></Card>;
    }
    return (
      <TemplateEditor
        key={current.template_id}
        templateId={current.template_id}
        initial={{ ...EMPTY_FORM, ...toEditorShape(current) }}
        onCancel={() => navigate(basePath)}
        onSaved={async () => { await loadPlatform(); navigate(basePath); }}
      />
    );
  }

  const number = platform?.number;

  return (
    <div className="flex flex-col gap-5">
      {/* Admin WhatsApp number */}
      <Card className="flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-green-50 text-[#25D366]"><FaWhatsapp size={22} /></span>
        <div className="min-w-0 flex-1">
          <div className="font-bold">Getnera WhatsApp templates</div>
          <p className="text-[13px] text-muted-foreground">
            {platform?.configured
              ? <>Templates of the admin number <span className="font-semibold text-foreground">{number?.display_phone_number || '—'}</span>{platform.waba_name ? ` · ${platform.waba_name}` : ''}. Use them in WhatsApp Chat to start conversations.</>
              : 'Pick the admin WhatsApp number in WhatsApp Numbers to create and send Getnera templates.'}
          </p>
        </div>
        {!platform?.configured && !loading && (
          <Button variant="outline" onClick={() => navigate('/dashboard/whatsapp-numbers')}><FiSmartphone /> Open WhatsApp Numbers</Button>
        )}
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          value={tab}
          onChange={(v) => { setTab(v); setSearch(''); setStatus('all'); }}
          options={[['getnera', 'Getnera templates', platform?.templates?.length ?? null], ['clients', 'Client templates', clients?.templates?.length ?? null]]}
        />
        {tab === 'getnera' && platform?.configured && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={refresh} disabled={refreshing || !platform.can_manage}>{refreshing ? <Spinner /> : <FiRefreshCw />} Refresh from Meta</Button>
            {canManage && <Button onClick={() => navigate(`${basePath}/new`)} disabled={!platform.can_manage}><FiPlus /> Create template</Button>}
          </div>
        )}
      </div>

      <Card className="gap-4 px-4 py-4 sm:px-5">
        {tab === 'getnera' ? (
          loading ? <ListSkeleton /> : !platform?.configured ? (
            <Empty icon={FiAlertTriangle} title="No admin WhatsApp number yet" text='In WhatsApp Numbers, pick a number and choose "Use for admin WhatsApp". Its templates appear here.' />
          ) : (
            <>
              <Toolbar search={search} onSearch={setSearch} status={status} onStatus={setStatus} placeholder="Search templates" />
              {platformRows.length === 0 ? (
                <Empty title={platform.templates.length ? 'No template matches' : 'No templates yet'} text={platform.templates.length ? 'Try another search or status.' : 'Create your first template. Meta reviews it before it can be sent.'} action={!platform.templates.length && canManage ? <Button onClick={() => navigate(`${basePath}/new`)}><FiPlus /> Create template</Button> : null} />
              ) : (
                <TemplateTable rows={platformRows} onPreview={openPreview} onEdit={canManage ? (t) => navigate(`${basePath}/${t.template_id}`) : null} onDelete={canManage ? remove : null} />
              )}
            </>
          )
        ) : clientsLoading || !clients ? <ListSkeleton /> : (
          <>
            <Toolbar search={search} onSearch={setSearch} status={status} onStatus={setStatus} placeholder="Search template, workspace or account">
              <Select value={account} onValueChange={setAccount}>
                <SelectTrigger className="h-9 w-full sm:w-56"><SelectValue placeholder="All accounts" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All accounts</SelectItem>
                  {(clients?.accounts || []).map((a) => (
                    <SelectItem key={a.waba_id} value={a.waba_id}>{a.workspaces?.[0]?.name || a.name || a.waba_id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Toolbar>
            {clientRows.length === 0 ? (
              <Empty title={clients?.templates?.length ? 'No template matches' : 'No client templates yet'} text={clients?.templates?.length ? 'Try another search, status or account.' : 'Templates of the workspaces’ WhatsApp accounts appear here after the Meta inventory sync.'} />
            ) : (
              <TemplateTable rows={clientRows} onPreview={openPreview} showWorkspace />
            )}
          </>
        )}
      </Card>

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2"><span className="truncate">{preview?.name}</span> {preview && <StatusBadge status={preview.status} />}</DialogTitle>
            <DialogDescription>
              {preview && `${title(preview.category)} · ${langName(preview.language)}${preview.workspaces?.length ? ` · ${preview.workspaces.map((w) => w.name).join(', ')}` : ''}`}
            </DialogDescription>
          </DialogHeader>
          {preview?.rejected_reason && (
            <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-800"><FiAlertTriangle className="mt-0.5 shrink-0" /> Rejected by Meta: {title(preview.rejected_reason).replace(/_/g, ' ')}</p>
          )}
          {preview && (preview.loading ? <Skeleton className="h-64 w-full rounded-xl" /> : <TemplatePreview template={toEditorShape(preview)} />)}
        </DialogContent>
      </Dialog>
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
};

const ListSkeleton = () => (
  <div className="flex flex-col gap-3">
    <div className="flex gap-2"><Skeleton className="h-9 flex-1" /><Skeleton className="h-9 w-40" /></div>
    {[0, 1, 2, 3].map((i) => (
      <div key={i} className="flex items-center gap-4 rounded-lg border border-border px-4 py-3">
        <div className="flex flex-1 flex-col gap-1.5"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-20" /></div>
        <Skeleton className="h-5 w-20 rounded-full" /><Skeleton className="h-5 w-20 rounded-full" /><Skeleton className="h-8 w-24" />
      </div>
    ))}
  </div>
);

const TemplateTable = ({ rows, onPreview, onEdit, onDelete, showWorkspace = false }) => (
  <>
    {/* Cards on small screens */}
    <div className="flex flex-col gap-2 md:hidden">
      {rows.map((t) => (
        <button key={t.template_id} type="button" onClick={() => onPreview(t)} className="flex cursor-pointer flex-col gap-1.5 rounded-lg border border-border px-3 py-3 text-left hover:bg-muted/50">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-semibold">{t.name}</span>
            <StatusBadge status={t.status} />
          </div>
          <div className="text-[12px] text-muted-foreground">
            {title(t.category)} · {langName(t.language)}{showWorkspace ? ` · ${t.workspaces?.map((w) => w.name).join(', ') || t.waba_name || 'Not assigned'}` : ''}
          </div>
        </button>
      ))}
    </div>
    <div className="hidden overflow-hidden rounded-lg border border-border md:block">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead>Template</TableHead>
            {showWorkspace && <TableHead>Workspace</TableHead>}
            <TableHead>Category</TableHead>
            <TableHead>Status</TableHead>
            {!showWorkspace && <TableHead>Quality</TableHead>}
            <TableHead>Last synced</TableHead>
            <TableHead className="w-28 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((t) => (
            <TableRow key={t.template_id}>
              <TableCell>
                <button type="button" onClick={() => onPreview(t)} className="cursor-pointer text-left font-semibold hover:underline">{t.name}</button>
                <div className="text-[12px] text-muted-foreground">{langName(t.language)}</div>
              </TableCell>
              {showWorkspace && (
                <TableCell>
                  <div className="font-medium">{t.workspaces?.map((w) => w.name).join(', ') || <span className="text-muted-foreground">Not assigned</span>}</div>
                  <div className="text-[12px] text-muted-foreground">{t.waba_name || t.waba_id}</div>
                </TableCell>
              )}
              <TableCell><Badge variant="outline">{title(t.category)}</Badge></TableCell>
              <TableCell><StatusBadge status={t.status} /></TableCell>
              {!showWorkspace && <TableCell className="text-[13px] text-muted-foreground">{t.quality ? title(t.quality) : '—'}</TableCell>}
              <TableCell className="text-[13px] text-muted-foreground">{when(t.last_synced_at)}</TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon" className="size-8" onClick={() => onPreview(t)} aria-label="Preview" title="Preview"><FiEye /></Button>
                  {onEdit && <Button variant="ghost" size="icon" className="size-8" onClick={() => onEdit(t)} disabled={!editable(t)} aria-label="Edit" title={editable(t) ? 'Edit' : 'Pending templates cannot be edited'}><FiEdit2 /></Button>}
                  {onDelete && <Button variant="ghost" size="icon" className="size-8 hover:text-red-600" onClick={() => onDelete(t)} aria-label="Delete" title="Delete"><FiTrash2 /></Button>}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  </>
);

export default TemplatesPage;
