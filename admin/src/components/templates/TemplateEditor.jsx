import React, { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  FiCheck, FiArrowLeft, FiPlus, FiTrash2, FiUploadCloud, FiBell, FiKey, FiExternalLink, FiPhone, FiCopy, FiCornerUpLeft, FiInfo, FiAlertTriangle,
} from 'react-icons/fi';
import { HiOutlineMegaphone } from 'react-icons/hi2';
import axiosClient from '../../api/axiosClient';
import TemplatePreview from './TemplatePreview';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export const LANGUAGES = [
  ['en', 'English'], ['en_US', 'English (US)'], ['en_GB', 'English (UK)'], ['ta', 'Tamil'], ['hi', 'Hindi'],
  ['ml', 'Malayalam'], ['te', 'Telugu'], ['kn', 'Kannada'], ['mr', 'Marathi'], ['bn', 'Bengali'], ['gu', 'Gujarati'], ['ar', 'Arabic'],
];

const CATEGORIES = [
  {
    key: 'MARKETING', label: 'Marketing', icon: HiOutlineMegaphone,
    options: [{ key: 'default', title: 'Default', text: 'Send messages with media and customised buttons to engage your customers.' }],
    goodFor: 'Welcome messages, promotions, offers, coupons, newsletters, announcements',
    sample: { header_format: 'TEXT', header_text: 'Welcome to Getnera', body: 'Hi {{1}}, thanks for your interest in Getnera!\n\nGetnera helps your business reply to every WhatsApp enquiry faster, track leads and follow up automatically.', footer: 'Getnera by Afra Ventures', buttons: [{ type: 'URL', text: 'Visit Getnera' }], samples: { 1: 'Aakash' } },
  },
  {
    key: 'UTILITY', label: 'Utility', icon: FiBell,
    options: [{ key: 'default', title: 'Default', text: 'Send messages about an existing order or account.' }],
    goodFor: 'Order confirmations, account updates, receipts, appointment reminders, billing',
    sample: { header_format: 'NONE', body: 'Hi {{1}}, your demo with Getnera is confirmed for {{2}}. Reply to this message if you need to change the time.', footer: 'Getnera', buttons: [{ type: 'QUICK_REPLY', text: 'Reschedule' }], samples: { 1: 'Aakash', 2: '24 Oct, 11:00 AM' } },
  },
  {
    key: 'AUTHENTICATION', label: 'Authentication', icon: FiKey,
    options: [{ key: 'otp', title: 'One-time passcode', text: 'Send codes to verify a transaction or login.' }],
    goodFor: 'Login codes, account verification, password reset',
    sample: { header_format: 'NONE', body: '*{{1}}* is your verification code. For your security, do not share this code.', footer: 'This code expires in 10 minutes.', buttons: [{ type: 'OTP', text: 'Copy code' }], samples: { 1: '123456' } },
  },
];

const BUTTON_TYPES = [
  { type: 'QUICK_REPLY', label: 'Quick reply', icon: FiCornerUpLeft, max: 10 },
  { type: 'URL', label: 'Visit website', icon: FiExternalLink, max: 2 },
  { type: 'PHONE_NUMBER', label: 'Call phone number', icon: FiPhone, max: 1 },
  { type: 'COPY_CODE', label: 'Copy offer code', icon: FiCopy, max: 1 },
];

export const EMPTY_FORM = {
  name: '', language: 'en', category: 'MARKETING', variable_type: 'number',
  header_format: 'NONE', header_text: '', header_handle: '', media_name: '', media_url: '',
  body: '', footer: '', buttons: [], samples: {},
  add_security_recommendation: true, code_expiration_minutes: 10, copy_code_text: 'Copy code',
};

// Guesses the category Meta will likely give the message, from its words and
// buttons. Meta decides in the end (it can re-categorise on review); this only
// warns before submitting.
const MARKETING_WORDS = /(offer|offers|discount|sale|deal|deals|coupon|promo|promotion|% ?off|off on|free trial|buy|shop now|limited time|exclusive|new arrivals?|launch|subscribe|upgrade|special price|save|cashback|hurry|don'?t miss|best price|try (it|now)|check out|interested in|learn more about our)/i;
const UTILITY_WORDS = /(order|booking|booked|appointment|reservation|confirmed|confirmation|payment|paid|receipt|invoice|bill|due|delivery|delivered|shipped|dispatch|tracking|account|password|reminder|scheduled|reschedul\w*|status|ticket|refund|renewal|expires?|verification|registered)/i;
export function detectCategory(form) {
  const text = [form.header_format === 'TEXT' ? form.header_text : '', form.body, form.footer, ...(form.buttons || []).map((b) => b.text)].join(' ');
  if (!text.trim()) return null;
  const promo = MARKETING_WORDS.test(text) || (form.buttons || []).some((b) => b.type === 'COPY_CODE');
  const transactional = UTILITY_WORDS.test(text);
  if (promo) return { category: 'MARKETING', reason: 'It has promotional words or an offer code.' };
  if (transactional) return { category: 'UTILITY', reason: 'It is about a specific booking, order, payment or account update.' };
  return { category: 'MARKETING', reason: 'It is not tied to an order, booking or account update, so Meta treats it as marketing.' };
}

const varsIn = (text) => [...new Set([...String(text || '').matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)].map((m) => m[1]))];
const Counter = ({ value, max }) => <span className={cn('text-[11px] tabular-nums', String(value || '').length > max ? 'text-red-600' : 'text-muted-foreground')}>{String(value || '').length}/{max}</span>;

const Steps = ({ step }) => (
  <ol className="flex flex-wrap items-center gap-2 text-[13px]">
    {['Set up template', 'Edit template', 'Submit for review'].map((label, i) => {
      const n = i + 1;
      const done = n < step;
      const current = n === step;
      return (
        <li key={label} className="flex items-center gap-2">
          {i > 0 && <span className="h-px w-5 bg-slate-300" />}
          <span className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold', current ? 'bg-blue-50 text-blue-700' : done ? 'text-slate-700' : 'text-slate-400')}>
            <span className={cn('flex size-4.5 items-center justify-center rounded-full border text-[10px]', done ? 'border-green-600 bg-green-600 text-white' : current ? 'border-blue-600 text-blue-700' : 'border-slate-300')}>
              {done ? <FiCheck className="size-3" /> : n}
            </span>
            {label}
          </span>
        </li>
      );
    })}
  </ol>
);

const Section = ({ title, hint, children, className }) => (
  <Card className={cn('gap-4 px-5 py-5', className)}>
    <div>
      <div className="text-[15px] font-bold">{title}</div>
      {hint && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{hint}</p>}
    </div>
    {children}
  </Card>
);

/**
 * Create (template = null) or edit an admin template. Edit keeps the name and
 * language (Meta does not allow changing them).
 */
const TemplateEditor = ({ initial, templateId, onCancel, onSaved }) => {
  const editing = Boolean(templateId);
  const [step, setStep] = useState(editing ? 2 : 1);
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, ...(initial || {}) }));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const bodyRef = useRef(null);
  const fileRef = useRef(null);
  const category = CATEGORIES.find((c) => c.key === form.category) || CATEGORIES[0];
  const isAuth = form.category === 'AUTHENTICATION';

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setError(null); };
  const setSample = (name, value) => setForm((f) => ({ ...f, samples: { ...f.samples, [name]: value } }));

  const detected = isAuth ? null : detectCategory(form);
  const mismatch = detected && detected.category !== form.category;

  const variables = useMemo(() => [...new Set([...(form.header_format === 'TEXT' ? varsIn(form.header_text) : []), ...varsIn(form.body)])], [form.header_format, form.header_text, form.body]);

  const nextVariable = (text) => {
    if (form.variable_type === 'name') return `{{${['customer_name', 'order_id', 'date', 'amount', 'code'].find((n) => !variables.includes(n)) || `value_${variables.length + 1}`}}}`;
    return `{{${variables.filter((v) => /^\d+$/.test(v)).length + 1}}}`;
  };

  const insertInBody = (before, after = '') => {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? form.body.length;
    const end = el?.selectionEnd ?? form.body.length;
    const selected = form.body.slice(start, end);
    const value = form.body.slice(0, start) + before + selected + after + form.body.slice(end);
    set({ body: value.slice(0, 1024) });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + before.length, start + before.length + selected.length); });
  };

  const uploadMedia = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const data = new FormData();
      data.append('format', form.header_format);
      data.append('file', file);
      const res = await axiosClient.post('/admin/templates/media', data, { headers: { 'Content-Type': 'multipart/form-data' } });
      set({ header_handle: res.data.handle, media_name: file.name, media_url: form.header_format === 'IMAGE' ? URL.createObjectURL(file) : '' });
      toast.success('Sample uploaded');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const addButton = (type) => set({ buttons: [...form.buttons, { type, text: '', url: '', phone_number: '', example: '' }] });
  const updateButton = (i, patch) => set({ buttons: form.buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const removeButton = (i) => set({ buttons: form.buttons.filter((_, j) => j !== i) });
  const countOf = (type) => form.buttons.filter((b) => b.type === type).length;

  // What the preview shows: auth templates use Meta's fixed wording.
  const previewShape = isAuth
    ? {
      header_format: 'NONE',
      body: `*{{1}}* is your verification code.${form.add_security_recommendation ? ' For your security, do not share this code.' : ''}`,
      footer: form.code_expiration_minutes ? `This code expires in ${form.code_expiration_minutes} minutes.` : '',
      buttons: [{ type: 'OTP', text: form.copy_code_text || 'Copy code' }],
      samples: { 1: '123456' },
    }
    : form;

  const localProblem = () => {
    if (!/^[a-z0-9_]{1,512}$/.test(form.name)) return 'Template name: lowercase letters, numbers and _ only.';
    if (isAuth) return null;
    if (!form.body.trim()) return 'The body is required.';
    if (form.header_format === 'TEXT' && !form.header_text.trim()) return 'Add the header text or choose no header.';
    if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(form.header_format) && !form.header_handle) return 'Upload a sample file for the header.';
    const missing = variables.find((v) => !String(form.samples[v] || '').trim());
    if (missing) return `Add a sample value for {{${missing}}}.`;
    return null;
  };

  const goReview = () => {
    const problem = localProblem();
    if (problem) { setError({ error: problem }); toast.error(problem); return; }
    setStep(3);
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    const payload = { ...form, samples: Object.fromEntries(variables.map((v) => [v, form.samples[v]])) };
    try {
      const res = editing
        ? await axiosClient.put(`/admin/templates/platform/${templateId}`, payload)
        : await axiosClient.post('/admin/templates/platform', payload);
      toast.success(editing ? 'Changes sent to Meta for review' : 'Template submitted to Meta for review');
      onSaved(res.data.template);
    } catch (err) {
      const data = err.response?.data || { error: 'Could not submit the template' };
      setError(data);
      if (data.field) setStep(2);
      toast.error(data.error);
    } finally {
      setSaving(false);
    }
  };

  const nameLocked = editing;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={onCancel}><FiArrowLeft /> Templates</Button>
        <Steps step={step} />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          {error?.error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <FiAlertTriangle className="mt-0.5 shrink-0" />
              <div>{error.title && <div className="font-semibold">{error.title}</div>}{error.error}</div>
            </div>
          )}

          {step === 1 && (
            <Section title="Set up your template" hint="Choose the category that best describes your message template, then the type of message you want to send.">
              <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-border">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => set({ category: c.key })}
                    className={cn('flex cursor-pointer items-center justify-center gap-2 px-2 py-2.5 text-[13px] font-semibold transition-colors', c.key !== 'MARKETING' && 'border-l border-border', form.category === c.key ? 'bg-slate-100 text-slate-900' : 'bg-card text-slate-600 hover:bg-muted')}
                  >
                    <c.icon className="size-4" /> <span className="truncate">{c.label}</span>
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-1">
                {category.options.map((o) => (
                  <label key={o.key} className="flex cursor-pointer items-start gap-3 rounded-lg bg-blue-50/70 px-3 py-3">
                    <span className="mt-0.5 flex size-4 items-center justify-center rounded-full border-2 border-blue-600"><span className="size-2 rounded-full bg-blue-600" /></span>
                    <span>
                      <span className="block text-sm font-semibold">{o.title}</span>
                      <span className="block text-[12.5px] text-muted-foreground">{o.text}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex justify-end">
                <Button onClick={() => setStep(2)}>Next</Button>
              </div>
            </Section>
          )}

          {step === 2 && (
            <>
              {mismatch && (
                <div className="flex flex-col gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] text-blue-900 sm:flex-row sm:items-center">
                  <FiInfo className="hidden shrink-0 sm:block" />
                  <span className="flex-1">This message looks like <b>{CATEGORIES.find((c) => c.key === detected.category)?.label}</b>. {detected.reason}</span>
                  <Button size="sm" className="w-fit shrink-0" onClick={() => set({ category: detected.category })}>Use {CATEGORIES.find((c) => c.key === detected.category)?.label}</Button>
                </div>
              )}
              <Section title="Template name and language">
                <div className="grid gap-3 sm:grid-cols-[1fr_180px_180px]">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="tpl-name">Name your template</Label>
                    <div className="relative">
                      <Input
                        id="tpl-name"
                        value={form.name}
                        disabled={nameLocked}
                        placeholder="welcome_message"
                        onChange={(e) => set({ name: e.target.value.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 512) })}
                        className={cn('pr-16', error?.field === 'name' && 'border-red-400')}
                      />
                      <span className="absolute top-1/2 right-3 -translate-y-1/2"><Counter value={form.name} max={512} /></span>
                    </div>
                    {nameLocked && <span className="text-[11.5px] text-muted-foreground">Meta does not allow renaming a template.</span>}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Select language</Label>
                    <Select value={form.language} onValueChange={(v) => set({ language: v })} disabled={nameLocked}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{LANGUAGES.map(([code, label]) => <SelectItem key={code} value={code}>{label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Category</Label>
                    <Select value={form.category} onValueChange={(v) => set({ category: v })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              </Section>

              {isAuth ? (
                <Section title="Code delivery" hint="Authentication templates use Meta's fixed wording; you choose the options.">
                  <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                    <input type="checkbox" className="size-4 accent-blue-600" checked={form.add_security_recommendation} onChange={(e) => set({ add_security_recommendation: e.target.checked })} />
                    Add security recommendation ("For your security, do not share this code.")
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label>Code expires after (minutes)</Label>
                      <Input type="number" min={1} max={90} value={form.code_expiration_minutes} onChange={(e) => set({ code_expiration_minutes: e.target.value })} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>Copy button text</Label>
                      <Input value={form.copy_code_text} maxLength={25} onChange={(e) => set({ copy_code_text: e.target.value })} />
                    </div>
                  </div>
                </Section>
              ) : (
                <Section title="Content" hint="Add a header, body and footer. Meta reviews the variables and content to protect the security and integrity of its services.">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label className="flex items-center gap-1">Type of variable <FiInfo className="size-3 text-muted-foreground" title="Number: {{1}}, {{2}}. Name: {{customer_name}}." /></Label>
                      <Select value={form.variable_type} onValueChange={(v) => set({ variable_type: v, samples: {} })}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="number">Number</SelectItem><SelectItem value="name">Name</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>Header · <span className="font-normal text-muted-foreground">Optional</span></Label>
                      <Select value={form.header_format} onValueChange={(v) => set({ header_format: v, header_handle: '', media_name: '', media_url: '' })}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NONE">None</SelectItem>
                          <SelectItem value="TEXT">Text</SelectItem>
                          <SelectItem value="IMAGE">Image</SelectItem>
                          <SelectItem value="VIDEO">Video</SelectItem>
                          <SelectItem value="DOCUMENT">Document</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {form.header_format === 'TEXT' && (
                    <div className="flex flex-col gap-1.5">
                      <div className="relative">
                        <Input value={form.header_text} maxLength={60} placeholder="Add a short line of text to the header" onChange={(e) => set({ header_text: e.target.value })} className={cn('pr-14', error?.field === 'header' && 'border-red-400')} />
                        <span className="absolute top-1/2 right-3 -translate-y-1/2"><Counter value={form.header_text} max={60} /></span>
                      </div>
                      {!varsIn(form.header_text).length && (
                        <button type="button" className="ml-auto inline-flex cursor-pointer items-center gap-1 text-[12.5px] text-blue-700 hover:underline" onClick={() => set({ header_text: `${form.header_text}${form.header_text ? ' ' : ''}${nextVariable()}`.slice(0, 60) })}><FiPlus /> Add variable</button>
                      )}
                    </div>
                  )}

                  {['IMAGE', 'VIDEO', 'DOCUMENT'].includes(form.header_format) && (
                    <div className={cn('flex flex-col items-start gap-2 rounded-lg border border-dashed px-4 py-4 sm:flex-row sm:items-center', error?.field === 'header' ? 'border-red-300 bg-red-50/40' : 'border-slate-300 bg-slate-50')}>
                      <FiUploadCloud className="size-6 shrink-0 text-slate-500" />
                      <div className="min-w-0 flex-1 text-[13px]">
                        <div className="font-semibold">{form.media_name || `Sample ${form.header_format.toLowerCase()}`}</div>
                        <div className="text-muted-foreground">
                          {form.header_handle ? 'Uploaded. Meta uses it only to review the template.' : form.header_format === 'IMAGE' ? 'JPG or PNG, up to 5 MB' : form.header_format === 'VIDEO' ? 'MP4, up to 16 MB' : 'PDF, up to 100 MB'}
                        </div>
                      </div>
                      <input ref={fileRef} type="file" className="hidden" accept={form.header_format === 'IMAGE' ? 'image/jpeg,image/png' : form.header_format === 'VIDEO' ? 'video/mp4' : 'application/pdf'} onChange={(e) => uploadMedia(e.target.files?.[0])} />
                      <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? <Spinner /> : <FiUploadCloud />} {form.header_handle ? 'Replace' : 'Upload'}</Button>
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <Label>Body</Label>
                    <div className={cn('rounded-md border bg-card focus-within:ring-2 focus-within:ring-ring/40', error?.field === 'body' ? 'border-red-400' : 'border-input')}>
                      <Textarea
                        ref={bodyRef}
                        value={form.body}
                        maxLength={1024}
                        rows={6}
                        placeholder="Hi {{1}}, thanks for your interest!"
                        onChange={(e) => set({ body: e.target.value })}
                        className="min-h-32 resize-y border-0 shadow-none focus-visible:ring-0"
                      />
                      <div className="flex flex-wrap items-center justify-end gap-1 border-t border-border px-2 py-1.5">
                        <Counter value={form.body} max={1024} />
                        <span className="mx-1 h-4 w-px bg-border" />
                        {[['B', '*', 'font-bold', 'Bold'], ['I', '_', 'italic', 'Italic'], ['S', '~', 'line-through', 'Strikethrough'], ['</>', '```', 'font-mono text-[11px]', 'Monospace']].map(([label, mark, cls, title]) => (
                          <button key={title} type="button" title={title} aria-label={title} onClick={() => insertInBody(mark, mark)} className={cn('flex h-7 min-w-7 cursor-pointer items-center justify-center rounded px-1.5 text-[13px] text-slate-600 hover:bg-muted', cls)}>{label}</button>
                        ))}
                        <button type="button" onClick={() => insertInBody(nextVariable())} className="ml-1 inline-flex h-7 cursor-pointer items-center gap-1 rounded px-2 text-[12.5px] font-medium text-blue-700 hover:bg-blue-50"><FiPlus /> Add variable</button>
                      </div>
                    </div>
                  </div>

                  {variables.length > 0 && (
                    <div className="flex flex-col gap-2 rounded-lg bg-slate-50 px-4 py-3">
                      <div className="text-[13px] font-semibold">Sample values</div>
                      <p className="text-[12px] text-muted-foreground">Meta needs an example for each variable to review the template. Customers never see these.</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {variables.map((v) => (
                          <div key={v} className="flex items-center gap-2">
                            <code className="shrink-0 rounded bg-white px-1.5 py-1 text-[12px] text-slate-600 ring-1 ring-border">{`{{${v}}}`}</code>
                            <Input value={form.samples[v] || ''} placeholder="Sample value" onChange={(e) => setSample(v, e.target.value)} className="h-8" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <Label>Footer · <span className="font-normal text-muted-foreground">Optional</span></Label>
                    <div className="relative">
                      <Input value={form.footer} maxLength={60} placeholder="Add a short line of text to the bottom of your message" onChange={(e) => set({ footer: e.target.value })} className={cn('pr-14', error?.field === 'footer' && 'border-red-400')} />
                      <span className="absolute top-1/2 right-3 -translate-y-1/2"><Counter value={form.footer} max={60} /></span>
                    </div>
                  </div>
                </Section>
              )}

              {!isAuth && (
                <Section title="Buttons · Optional" hint="Create buttons that let customers respond to your message or take action. You can add up to 10 buttons; more than 3 appear in a list.">
                  {form.buttons.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {form.buttons.map((b, i) => {
                        const meta = BUTTON_TYPES.find((t) => t.type === b.type);
                        return (
                          <div key={i} className={cn('flex flex-col gap-2 rounded-lg border px-3 py-3 sm:flex-row sm:items-start', error?.field === 'buttons' ? 'border-red-200' : 'border-border')}>
                            <span className="flex w-36 shrink-0 items-center gap-1.5 pt-2 text-[12.5px] font-semibold text-slate-600"><meta.icon className="size-3.5" /> {meta.label}</span>
                            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                              {b.type !== 'COPY_CODE' && <Input value={b.text} maxLength={25} placeholder="Button text" onChange={(e) => updateButton(i, { text: e.target.value })} className="h-9" />}
                              {b.type === 'URL' && <Input value={b.url} placeholder="https://getnera.in" onChange={(e) => updateButton(i, { url: e.target.value.trim() })} className="h-9" />}
                              {b.type === 'URL' && /\{\{1\}\}$/.test(b.url) && <Input value={b.example || ''} placeholder="Sample full link" onChange={(e) => updateButton(i, { example: e.target.value.trim() })} className="h-9 sm:col-span-2" />}
                              {b.type === 'PHONE_NUMBER' && <Input value={b.phone_number} placeholder="+91 98765 43210" onChange={(e) => updateButton(i, { phone_number: e.target.value })} className="h-9" />}
                              {b.type === 'COPY_CODE' && <Input value={b.example} maxLength={15} placeholder="Offer code, e.g. WELCOME10" onChange={(e) => updateButton(i, { example: e.target.value.toUpperCase().replace(/\s/g, '') })} className="h-9 sm:col-span-2" />}
                            </div>
                            <Button variant="ghost" size="icon" className="size-9 shrink-0 text-slate-500 hover:text-red-600" onClick={() => removeButton(i)} aria-label="Remove button"><FiTrash2 /></Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="w-fit" disabled={form.buttons.length >= 10}><FiPlus /> Add button</Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56">
                      {BUTTON_TYPES.map((t) => (
                        <DropdownMenuItem key={t.type} disabled={countOf(t.type) >= t.max} onSelect={() => addButton(t.type)}>
                          <t.icon /> {t.label} <span className="ml-auto text-[11px] text-muted-foreground">{countOf(t.type)}/{t.max}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Section>
              )}

              <div className="sticky bottom-0 z-10 -mx-1 flex justify-between gap-2 rounded-xl border border-border bg-card/95 px-4 py-3 backdrop-blur">
                <Button variant="outline" onClick={() => (editing ? onCancel() : setStep(1))}>{editing ? 'Cancel' : 'Previous'}</Button>
                <Button onClick={goReview}>Next</Button>
              </div>
            </>
          )}

          {step === 3 && (
            <Section title="Submit for review" hint="Meta usually reviews templates within minutes; some take up to 24 hours. You can only send approved templates.">
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                {[
                  ['Name', <code key="n" className="text-[13px]">{form.name}</code>],
                  ['Language', LANGUAGES.find(([c]) => c === form.language)?.[1] || form.language],
                  ['Category', <span key="c" className="inline-flex items-center gap-2"><Badge variant="info">{category.label}</Badge><button type="button" onClick={() => setStep(isAuth ? 1 : 2)} className="cursor-pointer text-[12px] text-blue-700 hover:underline">Change</button></span>],
                  ['Header', isAuth ? 'None' : form.header_format === 'NONE' ? 'None' : form.header_format === 'TEXT' ? 'Text' : `${form.header_format.toLowerCase()} (${form.media_name || 'uploaded'})`],
                  ['Variables', isAuth ? 'Verification code' : variables.length ? variables.map((v) => `{{${v}}}`).join(', ') : 'None'],
                  ['Buttons', isAuth ? 'Copy code' : form.buttons.length ? form.buttons.map((b) => b.text || b.example || b.type).join(', ') : 'None'],
                ].map(([k, v]) => (
                  <div key={k}><dt className="text-[12px] font-medium text-muted-foreground">{k}</dt><dd className="mt-0.5">{v}</dd></div>
                ))}
              </dl>
              {mismatch && (
                <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 sm:flex-row sm:items-center">
                  <span className="flex-1">You chose {category.label}, but the message reads like <b>{CATEGORIES.find((c) => c.key === detected.category)?.label}</b>. {detected.reason} Meta may change the category on review.</span>
                  <Button size="sm" variant="outline" className="w-fit shrink-0 bg-white" onClick={() => set({ category: detected.category })}>Use {CATEGORIES.find((c) => c.key === detected.category)?.label}</Button>
                </div>
              )}
              {form.category === 'MARKETING' && (
                <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800"><FiInfo className="mt-0.5 shrink-0" /> Marketing templates can only be sent to customers who agreed to receive them.</p>
              )}
              <div className="flex justify-between gap-2">
                <Button variant="outline" onClick={() => setStep(2)} disabled={saving}>Previous</Button>
                <Button onClick={submit} disabled={saving}>{saving && <Spinner />} {editing ? 'Submit changes' : 'Submit for review'}</Button>
              </div>
            </Section>
          )}
        </div>

        <aside className="flex flex-col gap-3 lg:sticky lg:top-20">
          <TemplatePreview template={step === 1 ? category.sample : previewShape} />
          {step === 1 && (
            <Card className="gap-2 px-4 py-4 text-[13px]">
              <div className="font-bold">This template is good for</div>
              <p className="text-muted-foreground">{category.goodFor}</p>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
};

export default TemplateEditor;
