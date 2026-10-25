import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { FiPlus, FiRefreshCw, FiSearch, FiEye, FiEdit2, FiTrash2, FiFileText, FiAlertTriangle, FiSmartphone } from 'react-icons/fi';
import { FaWhatsapp } from 'react-icons/fa';
import axiosClient from './templatesClient';
import ConfirmDialog from './ConfirmDialog';
import TemplateEditor, { EMPTY_FORM, LANGUAGES } from './TemplateEditor';
import TemplatePreview, { toEditorShape } from './TemplatePreview';
import ReviewTime from './ReviewTime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const STATUS_VARIANT = { APPROVED: 'success', PENDING: 'warning', IN_APPEAL: 'warning', REJECTED: 'danger', PAUSED: 'muted', DISABLED: 'muted' };
const STATUS_FILTERS = [['all', 'All'], ['APPROVED', 'Approved'], ['PENDING', 'Pending'], ['REJECTED', 'Rejected']];
const langName = (code) => LANGUAGES.find(([c]) => c === code)?.[1] || code;
const title = (s) => String(s || '').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const editable = (t) => ['APPROVED', 'REJECTED', 'PAUSED'].includes(t.status);
const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const StatusBadge = ({ status }) => <Badge variant={STATUS_VARIANT[status] || 'muted'}>{title(status || 'unknown').replace('_', ' ')}</Badge>;

const Empty = ({ icon: Icon = FiFileText, heading, text, action }) => (
  <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
    <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><Icon className="size-5" /></span>
    <div className="font-semibold">{heading}</div>
    <p className="max-w-md text-sm text-muted-foreground">{text}</p>
    {action}
  </div>
);

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

let cache = null;

/** Customer panel Template Management: the linked WhatsApp number's templates only. */
const TemplatesPage = ({ itemId, basePath = '/templates' }) => {
  const navigate = useNavigate();
  const [data, setDataState] = useState(cache);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const setData = (value) => { cache = value; setDataState(value); };

  const load = async ({ refresh = false } = {}) => {
    try {
      const res = await axiosClient.get('/wa-templates', { params: refresh ? { refresh: 1 } : undefined });
      setData(res.data);
      if (refresh) toast.success('Templates refreshed from Meta');
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Could not load templates');
      if (!cache) setData({ configured: false, templates: [], error: true });
    }
  };
  useEffect(() => { load(); }, []);

  // While a template is in review, ask Meta every 15 seconds.
  const pendingCount = (data?.templates || []).filter((t) => ['PENDING', 'IN_APPEAL'].includes(t.status)).length;
  useEffect(() => {
    if (!pendingCount || !data?.can_manage) return undefined;
    let stopped = false;
    const check = async () => {
      if (document.hidden) return;
      try {
        const res = await axiosClient.post('/wa-templates/check-pending');
        if (stopped) return;
        setData({ ...cache, templates: res.data.templates });
        if (res.data.changed) toast.success(`${res.data.changed} template${res.data.changed > 1 ? 's' : ''} reviewed by Meta`);
      } catch { /* the next check retries */ }
    };
    check();
    const timer = setInterval(check, 15000);
    return () => { stopped = true; clearInterval(timer); };
  }, [pendingCount, data?.can_manage]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async () => { setRefreshing(true); await load({ refresh: true }); setRefreshing(false); };
  const remove = (t) => setConfirm({
    title: `Delete "${t.name}"?`,
    description: 'It is deleted from Meta in every language. The name cannot be reused for 30 days.',
    actionLabel: 'Delete template',
    destructive: true,
    run: async () => {
      try {
        await axiosClient.delete(`/wa-templates/${t.template_id}`);
        toast.success('Template deleted');
        await load();
      } catch (err) {
        toast.error(err.response?.data?.error || 'Delete failed');
      }
    },
  });

  const rows = useMemo(() => (data?.templates || []).filter((t) => (status === 'all' || t.status === status)
    && (!search.trim() || [t.name, t.category].some((v) => String(v || '').toLowerCase().includes(search.trim().toLowerCase())))), [data, search, status]);

  if (itemId) {
    if (!data) return <div className="p-4 md:p-8"><Skeleton className="h-96 rounded-xl" /></div>;
    const wrap = (node) => <div className="p-4 md:p-8">{node}</div>;
    if (itemId === 'new') return wrap(<TemplateEditor onCancel={() => navigate(basePath)} onSaved={async () => { await load(); navigate(basePath); }} />);
    const current = (data.templates || []).find((t) => t.template_id === itemId);
    if (!current) return wrap(<Card className="p-6"><Empty heading="Template not found" text="It may have been deleted in Meta. Refresh the list and try again." action={<Button variant="outline" onClick={() => navigate(basePath)}>Back to templates</Button>} /></Card>);
    return wrap(
      <TemplateEditor key={current.template_id} templateId={current.template_id} initial={{ ...EMPTY_FORM, ...toEditorShape(current) }} onCancel={() => navigate(basePath)} onSaved={async () => { await load(); navigate(basePath); }} />,
    );
  }

  const canManage = Boolean(data?.can_manage);

  return (
    <div className="flex flex-col gap-5 p-4 md:p-8">
      <Card className="flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-green-50 text-[#25D366]"><FaWhatsapp size={22} /></span>
        <div className="min-w-0 flex-1">
          <div className="font-bold">WhatsApp templates</div>
          <p className="text-[13px] text-muted-foreground">
            {data?.configured
              ? <>Templates of your WhatsApp number <span className="font-semibold text-foreground">{data.number?.display_phone_number || '—'}</span>. Use approved ones in WhatsApp Chat and Campaigns.</>
              : 'Your templates appear here once a WhatsApp number is linked to this workspace.'}
          </p>
        </div>
        {data?.configured && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={refresh} disabled={refreshing || !canManage}>{refreshing ? <Spinner /> : <FiRefreshCw />} Refresh from Meta</Button>
            {canManage && <Button onClick={() => navigate(`${basePath}/new`)}><FiPlus /> Create template</Button>}
          </div>
        )}
      </Card>

      <Card className="gap-4 px-4 py-4 sm:px-5">
        {!data ? <ListSkeleton /> : !data.configured ? (
          <Empty icon={FiAlertTriangle} heading="No WhatsApp number linked yet" text="The Getnera team links your WhatsApp Business number to this workspace. Its templates then appear here." action={<Button variant="outline" onClick={() => navigate('/whatsapp')}><FiSmartphone /> Open WhatsApp Number</Button>} />
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <FiSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates" className="h-9 pl-9" />
              </div>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-9 w-full sm:w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUS_FILTERS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {rows.length === 0 ? (
              <Empty heading={data.templates.length ? 'No template matches' : 'No templates yet'} text={data.templates.length ? 'Try another search or status.' : 'Create your first template. Meta reviews it before it can be sent.'} action={!data.templates.length && canManage ? <Button onClick={() => navigate(`${basePath}/new`)}><FiPlus /> Create template</Button> : null} />
            ) : (
              <>
                <div className="flex flex-col gap-2 md:hidden">
                  {rows.map((t) => (
                    <button key={t.template_id} type="button" onClick={() => setPreview(t)} className="flex cursor-pointer flex-col gap-1.5 rounded-lg border border-border px-3 py-3 text-left hover:bg-muted/50">
                      <div className="flex items-center justify-between gap-2"><span className="truncate font-semibold">{t.name}</span><span className="flex flex-col items-end gap-0.5"><StatusBadge status={t.status} /><ReviewTime template={t} /></span></div>
                      <div className="text-[12px] text-muted-foreground">{title(t.category)} · {langName(t.language)}</div>
                    </button>
                  ))}
                </div>
                <div className="hidden overflow-hidden rounded-lg border border-border md:block">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Template</TableHead><TableHead>Category</TableHead><TableHead>Status</TableHead><TableHead>Quality</TableHead><TableHead>Last synced</TableHead>
                        <TableHead className="w-28 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((t) => (
                        <TableRow key={t.template_id}>
                          <TableCell>
                            <button type="button" onClick={() => setPreview(t)} className="cursor-pointer text-left font-semibold hover:underline">{t.name}</button>
                            <div className="text-[12px] text-muted-foreground">{langName(t.language)}</div>
                          </TableCell>
                          <TableCell><Badge variant="outline">{title(t.category)}</Badge></TableCell>
                          <TableCell><div className="flex flex-col items-start gap-1"><StatusBadge status={t.status} /><ReviewTime template={t} /></div></TableCell>
                          <TableCell className="text-[13px] text-muted-foreground">{t.quality ? title(t.quality) : '—'}</TableCell>
                          <TableCell className="text-[13px] text-muted-foreground">{when(t.last_synced_at)}</TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon" className="size-8" onClick={() => setPreview(t)} aria-label="Preview" title="Preview"><FiEye /></Button>
                              {canManage && <Button variant="ghost" size="icon" className="size-8" onClick={() => navigate(`${basePath}/${t.template_id}`)} disabled={!editable(t)} aria-label="Edit" title={editable(t) ? 'Edit' : 'Pending templates cannot be edited'}><FiEdit2 /></Button>}
                              {canManage && <Button variant="ghost" size="icon" className="size-8 hover:text-red-600" onClick={() => remove(t)} aria-label="Delete" title="Delete"><FiTrash2 /></Button>}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </>
        )}
      </Card>

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2"><span className="truncate">{preview?.name}</span> {preview && <StatusBadge status={preview.status} />} {preview && <ReviewTime template={preview} />}</DialogTitle>
            <DialogDescription>{preview && `${title(preview.category)} · ${langName(preview.language)}`}</DialogDescription>
          </DialogHeader>
          {preview?.rejected_reason && (
            <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-800"><FiAlertTriangle className="mt-0.5 shrink-0" /> Rejected by Meta: {title(preview.rejected_reason).replace(/_/g, ' ')}</p>
          )}
          {preview && <TemplatePreview template={toEditorShape(preview)} />}
        </DialogContent>
      </Dialog>
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
};

export default TemplatesPage;
