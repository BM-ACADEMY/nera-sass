import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { FiDownload, FiUploadCloud, FiFileText, FiAlertTriangle, FiCheckCircle } from 'react-icons/fi';
import { api } from '../../services/api.js';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { ADD_LEAD_SOURCES, IMPORT_COLUMNS, SOURCE_LABELS, importSampleCsv, importSummary, exportButtonLabel, MAX_NOTE_LENGTH } from './leadsPolicy.js';

const Field = ({ label, htmlFor, hint, required, children }) => (
  <div className="flex flex-col gap-1.5">
    <Label htmlFor={htmlFor} className="text-[13px] font-semibold text-slate-700">
      {label}{required && <span className="text-red-500"> *</span>}
    </Label>
    {children}
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

const saveFile = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const EMPTY_LEAD = { name: '', phone: '', source: 'manual', interest: '', assigned_to: 'none' };

// ── Add lead ─────────────────────────────────────────────────────────
export function AddLeadDialog({ open, onOpenChange, users, onSaved }) {
  const [form, setForm] = useState(EMPTY_LEAD);
  const [saving, setSaving] = useState(false);

  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) return toast.error('Enter the lead\'s name.');
    if (form.phone.replace(/\D/g, '').length < 10) return toast.error('Enter a phone number with at least 10 digits.');
    setSaving(true);
    try {
      await api.createLead({
        name: form.name.trim(),
        phone: form.phone.trim(),
        source: form.source,
        interest: form.interest.trim() || null,
        assigned_to: form.assigned_to === 'none' ? null : Number(form.assigned_to),
      });
      toast.success('Lead added');
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(err.message || 'Could not add the lead. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add lead</DialogTitle>
          <DialogDescription>Add someone who contacted you by phone, in person or another way.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="lead-name" required>
              <Input id="lead-name" value={form.name} onChange={(e) => set('name')(e.target.value)} placeholder="e.g. Rahul Sharma" autoFocus />
            </Field>
            <Field label="Phone" htmlFor="lead-phone" required hint="With country code, e.g. 91 98765 43210">
              <Input id="lead-phone" type="tel" inputMode="tel" value={form.phone} onChange={(e) => set('phone')(e.target.value)} placeholder="919876543210" />
            </Field>
          </div>
          <Field label="Interested in" htmlFor="lead-interest">
            <Input id="lead-interest" value={form.interest} onChange={(e) => set('interest')(e.target.value)} placeholder="e.g. Web design course" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Source" htmlFor="lead-source">
              <Select value={form.source} onValueChange={set('source')}>
                <SelectTrigger id="lead-source"><SelectValue /></SelectTrigger>
                <SelectContent>{ADD_LEAD_SOURCES.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Assign to" htmlFor="lead-assign">
              <Select value={form.assigned_to} onValueChange={set('assigned_to')}>
                <SelectTrigger id="lead-assign"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nobody yet</SelectItem>
                  {users.map((user) => <SelectItem key={user.id} value={String(user.id)}>{user.name || user.email}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving && <Spinner />} Add lead</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Import ───────────────────────────────────────────────────────────
export function ImportLeadsDialog({ open, onOpenChange, onImported }) {
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);


  const downloadSample = () => saveFile(new Blob([importSampleCsv()], { type: 'text/csv;charset=utf-8' }), 'leads_import_sample.csv');

  const upload = async () => {
    if (!file) return toast.error('Choose a file first.');
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      // Every imported lead is stored with the Import source.
      formData.append('force_source', 'XLS Sheet');
      const res = await api.importLeads(formData);
      setResult(res);
      toast.success(`Imported ${Number(res.imported) || 0} leads`);
      onImported?.();
    } catch (err) {
      toast.error(err.message || 'Could not import the file. Please check it and try again.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import leads</DialogTitle>
          <DialogDescription>Add many leads at once from an Excel or CSV file.</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-3.5 py-2.5 text-[13px] text-green-800">
              <FiCheckCircle className="mt-0.5 shrink-0" /> <span>{importSummary(result)}.</span>
            </div>
            {Array.isArray(result.errors) && result.errors.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800">
                <div className="mb-1 font-semibold">Rows not added</div>
                <ul className="flex flex-col gap-0.5">
                  {result.errors.slice(0, 5).map((row, index) => (
                    <li key={`${row.row}-${index}`}>Row {row.row}{row.name ? ` (${row.name})` : ''}: {row.error}</li>
                  ))}
                </ul>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setResult(null)}>Import another file</Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 text-[13px] text-slate-700">
              <p>Use these column names in the first row. Name and Phone are needed; the rest are optional.</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {IMPORT_COLUMNS.map((column) => <span key={column} className="rounded-md border border-border bg-white px-2 py-0.5 font-mono text-[12px]">{column}</span>)}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">A phone number that is already in your leads updates that lead instead of adding it again.</p>
              <Button type="button" variant="link" className="mt-1 h-auto px-0 text-[13px]" onClick={downloadSample}><FiDownload /> Download a sample file</Button>
            </div>

            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={cn('flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors hover:bg-muted/50', file ? 'border-primary/40 bg-blue-50/40' : 'border-border')}
            >
              {file ? <FiFileText className="size-6 text-primary" /> : <FiUploadCloud className="size-6 text-muted-foreground" />}
              <span className="text-sm font-semibold">{file ? file.name : 'Choose a file'}</span>
              <span className="text-xs text-muted-foreground">{file ? 'Click to choose a different file' : '.xlsx, .xls or .csv'}</span>
            </button>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
              <Button type="button" onClick={upload} disabled={!file || busy}>{busy ? <Spinner /> : <FiUploadCloud />} Import</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Export ───────────────────────────────────────────────────────────
const EXPORT_SOURCES = ['whatsapp', 'whatsapp_ad', 'import', 'manual'];

export function ExportLeadsDialog({ open, onOpenChange, selectedIds = [], showFacebook = false }) {
  const [mode, setMode] = useState(selectedIds.length ? 'selected' : 'all');
  const [source, setSource] = useState('whatsapp');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [fetched, setFetched] = useState({ key: null, count: null });
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState({ processed: 0, total: 0, percent: 0 });

  const dateProblem = mode === 'date' ? (!from || !to ? 'Choose both dates.' : new Date(from) > new Date(to) ? 'The start must be before the end.' : null) : null;
  // What the count is for; the server is asked again when it changes.
  const countKey = mode === 'selected' || dateProblem ? null : JSON.stringify({ mode, source: mode === 'source' ? source : null, from: mode === 'date' ? from : null, to: mode === 'date' ? to : null });
  const counting = countKey !== null && fetched.key !== countKey;
  const count = mode === 'selected' ? selectedIds.length : countKey !== null && fetched.key === countKey ? fetched.count : null;

  useEffect(() => {
    if (!open || countKey === null) return undefined;
    let cancelled = false;
    const { mode: m, source: src, from: f, to: t } = JSON.parse(countKey);
    const timer = setTimeout(async () => {
      let result;
      try {
        const filters = { limit: 1, offset: 0 };
        if (m === 'source') filters.source = src;
        if (m === 'date') { filters.from = new Date(f).toISOString(); filters.to = new Date(t).toISOString(); }
        const data = await api.getLeads(filters);
        result = Number(data.total) || 0;
      } catch {
        result = null;
      }
      if (!cancelled) setFetched({ key: countKey, count: result });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, countKey]);

  const run = async (event) => {
    event.preventDefault();
    if (dateProblem) return toast.error(dateProblem);
    setExporting(true);
    try {
      const body = { mode };
      if (mode === 'source') body.source = source;
      if (mode === 'date') { body.from = new Date(from).toISOString(); body.to = new Date(to).toISOString(); }
      if (mode === 'selected') body.ids = selectedIds;
      const job = await api.createLeadExport(body);
      const total = Number(job.total_records) || 0;
      setProgress({ processed: 0, total, percent: 0 });
      let status = job;
      while (!['completed', 'failed'].includes(status.status)) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        status = await api.getLeadExport(job.id);
        const processed = Number(status.processed_records) || 0;
        setProgress({ processed, total, percent: total ? Math.min(100, Math.round((processed / total) * 100)) : 0 });
      }
      if (status.status === 'failed') throw new Error('The export could not be finished. Please try again.');
      const blob = await api.downloadLeadExport(job.id);
      saveFile(blob, `leads_${mode}_${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success(`Exported ${Number(status.processed_records || total).toLocaleString('en-IN')} leads`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err.message || 'Could not export. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const sources = showFacebook ? [...EXPORT_SOURCES, 'facebook'] : EXPORT_SOURCES;
  const options = [
    ...(selectedIds.length ? [{ value: 'selected', title: `Selected leads (${selectedIds.length})`, text: 'Only the leads you ticked in the list' }] : []),
    { value: 'all', title: 'All leads', text: 'Every lead in this workspace' },
    { value: 'source', title: 'By source', text: 'Only leads from one source' },
    { value: 'date', title: 'By date added', text: 'Leads added between two dates' },
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => !exporting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export leads</DialogTitle>
          <DialogDescription>
            {mode === 'selected'
              ? `Download the ${selectedIds.length} lead${selectedIds.length === 1 ? '' : 's'} you selected as a CSV file you can open in Excel.`
              : 'Download leads as a CSV file you can open in Excel.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={run} className="flex flex-col gap-3">
          <div role="radiogroup" className="flex flex-col gap-2">
            {options.map((option) => (
              <label key={option.value} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-2.5 transition-colors', mode === option.value ? 'border-primary bg-blue-50/60' : 'border-border hover:bg-muted/50')}>
                <input type="radio" name="export-mode" className="mt-1 accent-primary" checked={mode === option.value} onChange={() => setMode(option.value)} disabled={exporting} />
                <span>
                  <span className="block text-sm font-semibold">{option.title}</span>
                  <span className="block text-xs text-muted-foreground">{option.text}</span>
                </span>
              </label>
            ))}
          </div>

          {mode === 'source' && (
            <Select value={source} onValueChange={setSource} disabled={exporting}>
              <SelectTrigger aria-label="Source"><SelectValue /></SelectTrigger>
              <SelectContent>{sources.map((kind) => <SelectItem key={kind} value={kind}>{SOURCE_LABELS[kind]}</SelectItem>)}</SelectContent>
            </Select>
          )}
          {mode === 'date' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="From" htmlFor="export-from"><Input id="export-from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} disabled={exporting} /></Field>
              <Field label="To" htmlFor="export-to"><Input id="export-to" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} disabled={exporting} /></Field>
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-[13px]">
            <span className="text-muted-foreground">{exporting ? 'Preparing your file' : 'Leads to export'}</span>
            <span className="font-semibold">
              {exporting
                ? `${progress.processed.toLocaleString('en-IN')} / ${progress.total.toLocaleString('en-IN')}`
                : counting ? 'Counting…' : count == null ? '—' : count.toLocaleString('en-IN')}
            </span>
          </div>
          {exporting && <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${progress.percent}%` }} /></div>}
          {mode === 'date' && dateProblem && (from || to) && <p className="flex items-center gap-1.5 text-xs text-amber-700"><FiAlertTriangle /> {dateProblem}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={exporting}>Cancel</Button>
            <Button type="submit" disabled={exporting || counting || !count || Boolean(dateProblem)}>{exporting ? <Spinner /> : <FiDownload />} {exportButtonLabel(count)}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Add note ─────────────────────────────────────────────────────────
// A remark the team keeps about the lead (not sent to the lead). Saved with
// the author's name; listed in the lead's details, newest first.
export function AddNoteDialog({ lead, open, onOpenChange, onSaved }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const text = note.trim();

  const submit = async (event) => {
    event.preventDefault();
    if (!text) return toast.error('Write a note first.');
    setSaving(true);
    try {
      const res = await api.addLeadNote(lead.id, text);
      toast.success('Note added');
      onSaved?.(res.note);
      onOpenChange(false);
    } catch (err) {
      toast.error(err.message || 'Could not save the note. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add note</DialogTitle>
          <DialogDescription>For your team only. {lead?.name ? `${lead.name} does not see it.` : 'The lead does not see it.'}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Note" htmlFor="lead-note">
            <Textarea
              id="lead-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE_LENGTH))}
              maxLength={MAX_NOTE_LENGTH}
              rows={5}
              placeholder="e.g. Called at 4 pm, wants the weekend batch. Call back Monday."
              autoFocus
              disabled={saving}
            />
          </Field>
          <p className={cn('-mt-1 text-right text-xs', note.length >= MAX_NOTE_LENGTH ? 'text-amber-700' : 'text-muted-foreground')}>
            {note.length.toLocaleString('en-IN')} / {MAX_NOTE_LENGTH.toLocaleString('en-IN')}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving || !text}>{saving && <Spinner />} Save note</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
