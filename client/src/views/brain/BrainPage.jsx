import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { FiBook, FiCheckCircle, FiClock, FiCpu, FiEye, FiEyeOff, FiMessageCircle, FiPlus, FiSave, FiSend, FiTrash2, FiUpload } from 'react-icons/fi';
import { api } from '../../services/api.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// ABM's own server keeps its multi-brand editor.
const LegacyBrainEditor = lazy(() => import('../AIBrainView.jsx').then((m) => ({ default: m.AIBrainView })));

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const GOALS = [
  ['book_appointment', 'Book an appointment'],
  ['collect_requirement', 'Collect the requirement'],
  ['share_brochure', 'Share the brochure'],
  ['callback_request', 'Arrange a callback'],
  ['custom', 'Something else'],
];
const PRICING = [
  ['share_listed', 'Share listed prices'],
  ['ranges_only', 'Share price ranges only'],
  ['never_share', 'Never share prices'],
];
const TONES = ['Warm and professional', 'Friendly and casual', 'Formal'];
const DOC_KINDS = [['faq', 'FAQ'], ['product', 'Product'], ['policy', 'Policy'], ['brochure', 'Brochure'], ['other', 'Other']];
const KNOWLEDGE = /^(faq|product|policy|brochure|other):/;
const selectClass = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

const splitLines = (value) => String(value || '').split('\n').map((line) => line.trim()).filter(Boolean);
const splitComma = (value) => String(value || '').split(',').map((part) => part.trim()).filter(Boolean);

const Field = ({ label, required, hint, children }) => (
  <label className="flex flex-col gap-1.5">
    <span className="text-[13px] font-semibold">{label}{required && <span className="text-red-600"> *</span>}</span>
    {children}
    {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
  </label>
);

const Section = ({ title, children }) => (
  <Card className="gap-4 p-5">
    <h3 className="text-[15px] font-bold">{title}</h3>
    {children}
  </Card>
);

function StatusCard({ brain, busy, onToggle }) {
  const ready = brain.g6_approved && !brain.missing.length;
  let note = 'The AI is answering your customers from this brain.';
  if (!brain.ai_enabled) {
    if (!brain.g6_approved) note = 'The Getnera team must approve AI replies for this workspace before you can turn this on.';
    else if (brain.missing.length) note = `Fill these first: ${brain.missing.join(', ')}.`;
    else note = 'Everything is ready. Test it below, then turn it on.';
  }
  return (
    <Card className="flex-row flex-wrap items-center justify-between gap-4 p-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><FiCpu className="size-5" /></span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold">AI replies</span>
            {brain.ai_enabled
              ? <Badge variant="success"><FiCheckCircle /> On</Badge>
              : <Badge variant="muted">Off</Badge>}
            {!brain.g6_approved && <Badge variant="warning"><FiClock /> Approval pending</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{note}</p>
        </div>
      </div>
      <Button
        variant={brain.ai_enabled ? 'outline' : 'default'}
        disabled={busy || (!brain.ai_enabled && !ready)}
        onClick={() => onToggle(!brain.ai_enabled)}
      >
        {brain.ai_enabled ? 'Turn off' : 'Turn on'}
      </Button>
    </Card>
  );
}

function BusinessForm({ form, set }) {
  const hours = form.business_hours || {};
  const setHours = (changes) => set({ business_hours: { ...hours, ...changes } });
  const toggleDay = (day) => {
    const days = hours.days || [];
    setHours({ days: days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort() });
  };
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Section title="Your business">
        <Field label="Business name" required>
          <Input value={form.business_name || ''} maxLength={120} onChange={(e) => set({ business_name: e.target.value })} />
        </Field>
        <Field label="What the business does" required hint={`${(form.business_description || '').length} of 600 characters`}>
          <Textarea rows={3} maxLength={600} value={form.business_description || ''} placeholder="Family dental clinic in Chennai since 2012" onChange={(e) => set({ business_description: e.target.value })} />
        </Field>
        <Field label="Service area">
          <Input value={form.service_area || ''} placeholder="Chennai, Anna Nagar and nearby" onChange={(e) => set({ service_area: e.target.value })} />
        </Field>
        <Field label="Products and services" required hint="One on each line">
          <Textarea rows={4} value={form.products_text ?? ''} placeholder={'Cleaning\nBraces\nImplants'} onChange={(e) => set({ products_text: e.target.value })} />
        </Field>
      </Section>

      <Section title="Business hours">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Open days<span className="text-red-600"> *</span></span>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((name, day) => (
              <button
                key={name}
                type="button"
                aria-pressed={(hours.days || []).includes(day)}
                onClick={() => toggleDay(day)}
                className={cn('h-9 min-w-11 rounded-md border px-2.5 text-[13px] font-medium', (hours.days || []).includes(day) ? 'border-blue-600 bg-blue-600 text-white' : 'border-border bg-transparent')}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Opens" required><Input type="time" value={hours.open || ''} onChange={(e) => setHours({ open: e.target.value })} /></Field>
          <Field label="Closes" required><Input type="time" value={hours.close || ''} onChange={(e) => setHours({ close: e.target.value })} /></Field>
        </div>
        <Field label="Timezone" required>
          <Input value={form.timezone || ''} placeholder="Asia/Kolkata" onChange={(e) => set({ timezone: e.target.value })} />
        </Field>
        <Field label="Message when closed" required>
          <Textarea rows={3} maxLength={500} value={form.after_hours_message || ''} placeholder="We're closed now and will reply at 10 AM" onChange={(e) => set({ after_hours_message: e.target.value })} />
        </Field>
      </Section>

      <Section title="How the AI talks">
        <Field label="Goal of the conversation" required>
          <select className={selectClass} value={form.conversation_goal || ''} onChange={(e) => set({ conversation_goal: e.target.value })}>
            <option value="">Choose a goal</option>
            {GOALS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        {form.conversation_goal === 'custom' && (
          <Field label="Your goal" required>
            <Input maxLength={200} value={form.conversation_goal_custom || ''} onChange={(e) => set({ conversation_goal_custom: e.target.value })} />
          </Field>
        )}
        <Field label="Questions to ask" required hint="2 to 5 questions, one on each line. The AI asks them one at a time.">
          <Textarea rows={4} value={form.questions_text ?? ''} placeholder={'Which treatment do you need?\nWhich day suits you?'} onChange={(e) => set({ questions_text: e.target.value })} />
        </Field>
        <Field label="Tone" required>
          <Input list="brain-tones" value={form.tone || ''} placeholder="Warm and professional" onChange={(e) => set({ tone: e.target.value })} />
          <datalist id="brain-tones">{TONES.map((tone) => <option key={tone} value={tone} />)}</datalist>
        </Field>
        <Field label="Languages" required hint="Separate with commas">
          <Input value={form.languages_text ?? ''} placeholder="English, Tamil" onChange={(e) => set({ languages_text: e.target.value })} />
        </Field>
      </Section>

      <Section title="Rules">
        <Field label="Pricing" required>
          <select className={selectClass} value={form.pricing_policy || ''} onChange={(e) => set({ pricing_policy: e.target.value })}>
            <option value="">Choose a rule</option>
            {PRICING.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="Topics the AI must not discuss">
          <Textarea rows={2} maxLength={500} value={form.forbidden_topics || ''} placeholder="Medical diagnosis, competitor clinics" onChange={(e) => set({ forbidden_topics: e.target.value })} />
        </Field>
        <Field label="Who takes over from the AI" required hint="The AI hands these chats to your WhatsApp Chat with the reason.">
          <Input maxLength={300} value={form.handoff_contacts || ''} placeholder="Front desk team" onChange={(e) => set({ handoff_contacts: e.target.value })} />
        </Field>
      </Section>
    </div>
  );
}

function KnowledgeTab() {
  const [docs, setDocs] = useState(null);
  const [draft, setDraft] = useState({ kind: 'faq', title: '', content: '' });
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = async () => {
    try {
      const res = await api.get('/brain');
      setDocs((res.docs || []).filter((doc) => KNOWLEDGE.test(doc.doc_type)));
    } catch (err) {
      toast.error(err.message || 'Could not load your documents');
      setDocs([]);
    }
  };
  useEffect(() => { load(); }, []);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { doc } = await api.post('/brain/docs', draft);
      setDocs((list) => [...list, doc]);
      setDraft({ kind: draft.kind, title: '', content: '' });
    } catch (err) {
      toast.error(err.message || 'Could not add this');
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    const toastId = toast.loading('Reading the file…');
    try {
      const data = new FormData();
      data.append('file', file);
      data.append('kind', draft.kind);
      const res = await api.upload('/brain/docs/upload', data);
      setDocs((list) => [...list, res.doc]);
      toast.success(res.truncated ? 'Added. The file was long, so only the first part is used.' : 'File added', { id: toastId });
    } catch (err) {
      toast.error(err.message || 'Could not read this file', { id: toastId });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const setActive = async (doc) => {
    try {
      const res = await api.patch(`/brain/docs/${doc.id}`, { is_active: doc.is_active === false });
      setDocs((list) => list.map((d) => (d.id === doc.id ? res.doc : d)));
    } catch (err) {
      toast.error(err.message || 'Could not update this');
    }
  };

  const remove = async (doc) => {
    if (!window.confirm(`Delete "${doc.title || 'this item'}"?`)) return;
    try {
      await api.delete(`/brain/docs/${doc.id}`);
      setDocs((list) => list.filter((d) => d.id !== doc.id));
    } catch (err) {
      toast.error(err.message || 'Could not delete this');
    }
  };

  const faqCount = (docs || []).filter((doc) => doc.doc_type.startsWith('faq:')).length;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Card className="gap-4 self-start p-5">
        <h3 className="text-[15px] font-bold">Add knowledge</h3>
        <form onSubmit={add} className="flex flex-col gap-4">
          <Field label="Type">
            <select className={selectClass} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
              {DOC_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label={draft.kind === 'faq' ? 'Question' : 'Title'}>
            <Input value={draft.title} maxLength={200} placeholder={draft.kind === 'faq' ? 'What are your opening hours?' : 'Price list'} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Field label={draft.kind === 'faq' ? 'Answer' : 'Content'}>
            <Textarea rows={5} value={draft.content} maxLength={10000} required onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || !draft.content.trim()}><FiPlus /> Add</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}><FiUpload /> Upload PDF or text</Button>
            <input ref={fileRef} type="file" accept=".pdf,.txt,.md,.csv,application/pdf,text/*" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
          </div>
        </form>
      </Card>

      <Card className="gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[15px] font-bold">What the AI knows</h3>
          <span className="text-xs text-muted-foreground">{faqCount} of 10 suggested FAQs</span>
        </div>
        {docs === null && <Skeleton className="h-24" />}
        {docs?.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing yet. Add your opening hours, location, prices and booking process.</p>
        )}
        <ul className="flex flex-col divide-y divide-border">
          {(docs || []).map((doc) => (
            <li key={doc.id} className={cn('flex items-start gap-3 py-3', doc.is_active === false && 'opacity-55')}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="muted">{doc.doc_type.split(':')[0].toUpperCase()}</Badge>
                  <span className="text-sm font-semibold break-words">{doc.title || 'Untitled'}</span>
                  {doc.is_active === false && <span className="text-xs text-muted-foreground">Hidden from the AI</span>}
                </div>
                <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground break-words">{doc.content}</p>
              </div>
              <Button size="icon" variant="ghost" aria-label={doc.is_active === false ? 'Show to the AI' : 'Hide from the AI'} onClick={() => setActive(doc)}>
                {doc.is_active === false ? <FiEye /> : <FiEyeOff />}
              </Button>
              <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => remove(doc)}><FiTrash2 /></Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function TestTab({ profile }) {
  const [chat, setChat] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async (e) => {
    e.preventDefault();
    const message = text.trim();
    if (!message) return;
    const history = chat.map((m) => ({ direction: m.direction, content: m.content }));
    setChat((list) => [...list, { direction: 'inbound', content: message }]);
    setText('');
    setBusy(true);
    try {
      const res = await api.post('/brain/test', { message, history, profile });
      setChat((list) => [...list, { direction: 'outbound', content: res.reply, handoff: res.handoff ? res.handoff_reason || 'Handed to your team' : null }]);
    } catch (err) {
      setChat((list) => [...list, { direction: 'error', content: err.message || 'The AI could not answer.' }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mx-auto w-full max-w-2xl gap-4 p-5">
      <div>
        <h3 className="text-[15px] font-bold">Test your AI</h3>
        <p className="mt-1 text-sm text-muted-foreground">Chat as a customer. Nothing is sent on WhatsApp. This uses what is on your Business details tab, saved or not.</p>
      </div>
      <div className="flex min-h-64 flex-col gap-2 rounded-lg bg-muted/60 p-3" aria-live="polite">
        {!chat.length && <p className="m-auto text-sm text-muted-foreground">Try: "What are your timings?"</p>}
        {chat.map((m, i) => (
          <div key={i} className={cn('max-w-[85%] rounded-lg px-3 py-2 text-sm break-words whitespace-pre-wrap', m.direction === 'inbound' && 'self-end bg-emerald-100', m.direction === 'outbound' && 'self-start bg-background shadow-xs', m.direction === 'error' && 'self-center bg-red-50 text-red-700')}>
            {m.content}
            {m.handoff && <div className="mt-1 text-xs font-semibold text-amber-700">Handed to your team: {m.handoff}</div>}
          </div>
        ))}
        {busy && <div className="self-start text-xs text-muted-foreground">Typing…</div>}
      </div>
      <form onSubmit={send} className="flex gap-2">
        <Input value={text} maxLength={1000} placeholder="Type as a customer" aria-label="Test message" onChange={(e) => setText(e.target.value)} />
        <Button type="submit" disabled={busy || !text.trim()}><FiSend /> Send</Button>
      </form>
    </Card>
  );
}

const toForm = (profile = {}) => ({
  ...profile,
  products_text: (profile.products_and_services || []).join('\n'),
  questions_text: (profile.qualifying_questions || []).join('\n'),
  languages_text: (profile.languages || []).join(', '),
});

const toProfile = (form) => {
  const { products_text: products, questions_text: questions, languages_text: languages, ...rest } = form;
  return { ...rest, products_and_services: splitLines(products), qualifying_questions: splitLines(questions), languages: splitComma(languages) };
};

const TABS = [['business', 'Business details', FiBook], ['knowledge', 'Knowledge', FiCpu], ['test', 'Test', FiMessageCircle]];

/** Customer panel: the workspace's AI Brain feed. */
export default function BrainPage() {
  const [brain, setBrain] = useState(null);
  const [form, setForm] = useState({});
  const [tab, setTab] = useState('business');
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState('');

  const apply = (res) => { setBrain(res); setForm(toForm(res.profile)); };
  useEffect(() => {
    api.get('/brain/profile').then(apply).catch((err) => setError(err.message || 'Could not load your AI Brain'));
  }, []);

  const set = (changes) => setForm((current) => ({ ...current, ...changes }));

  const save = async () => {
    setSaving(true);
    try {
      apply(await api.put('/brain/profile', { profile: toProfile(form) }));
      toast.success('Saved');
    } catch (err) {
      toast.error(err.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (enabled) => {
    if (!enabled && !window.confirm('Turn off AI replies? Your team will answer every chat.')) return;
    setToggling(true);
    try {
      const res = await api.post('/brain/ai-toggle', { enabled });
      setBrain(res);
      toast.success(enabled ? 'AI replies are on' : 'AI replies are off');
    } catch (err) {
      toast.error(err.message || 'Could not change this');
    } finally {
      setToggling(false);
    }
  };

  if (error) return <div className="p-6"><Card className="items-center p-10 text-center text-sm text-muted-foreground">{error}</Card></div>;
  if (!brain) return <div className="flex flex-col gap-4 p-6" aria-busy="true"><Skeleton className="h-20" /><Skeleton className="h-96" /></div>;
  if (brain.legacy_editor) return <Suspense fallback={<div className="p-6"><Skeleton className="h-96" /></div>}><LegacyBrainEditor /></Suspense>;

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <StatusCard brain={brain} busy={toggling} onToggle={toggle} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1" role="tablist">
          {TABS.map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn('flex h-9 items-center gap-2 rounded-md px-3 text-[13px] font-semibold', tab === id ? 'bg-background shadow-xs' : 'text-muted-foreground')}
            >
              <Icon /> {label}
            </button>
          ))}
        </div>
        {tab === 'business' && <Button onClick={save} disabled={saving}><FiSave /> {saving ? 'Saving…' : 'Save'}</Button>}
      </div>

      {tab === 'business' && <BusinessForm form={form} set={set} />}
      {tab === 'knowledge' && <KnowledgeTab />}
      {tab === 'test' && <TestTab profile={toProfile(form)} />}
    </div>
  );
}
