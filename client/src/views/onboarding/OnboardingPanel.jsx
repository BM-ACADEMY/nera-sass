import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { CheckCircle2, Clock, Circle, Lock, AlertTriangle, Info, ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { C } from '../../constants/theme.js';
import { api } from '../../services/api.js';
import { useAuth } from '../../hooks/useAuth.js';
import { launchMetaEmbeddedSignup } from '../../utils/metaEmbeddedSignup.js';
import {
  NOTICE_TONES, STATUS_TONES, TEMPLATE_TONES, canManageSetup, progressLine, serviceBody, showChecklist, statusLabel,
  stepAction, testMessageHint, validateService,
} from './onboardingPolicy.js';

const ICONS = { done: CheckCircle2, in_review: Clock, todo: Circle, locked: Lock };

const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12 };
const inputStyle = { width: '100%', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, color: C.text, background: '#fff' };
const buttonStyle = (primary = true, disabled = false) => ({
  padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: primary ? 'none' : `1px solid ${C.border}`,
  background: primary ? C.accent : '#fff', color: primary ? '#fff' : C.text, opacity: disabled ? 0.6 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
});

const Chip = ({ tone, children }) => (
  <span style={{ fontSize: 11.5, fontWeight: 600, padding: '2px 9px', borderRadius: 999, color: tone.color, background: tone.background, border: `1px solid ${tone.border}`, whiteSpace: 'nowrap' }}>
    {children}
  </span>
);

const Field = ({ label, error, children }) => (
  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted }}>
    {label}
    <div style={{ marginTop: 4 }}>{children}</div>
    {error && <div style={{ color: C.red, fontWeight: 500, marginTop: 3 }}>{error}</div>}
  </label>
);

// ── Notices ─────────────────────────────────────────────────
export function NoticesBox({ notices, onNavigate }) {
  if (!notices?.length) return null;
  return (
    <section aria-label="Notices" style={{ ...card, padding: 14, marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 8 }}>Notices</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {notices.map((notice) => {
          const tone = NOTICE_TONES[notice.severity] || NOTICE_TONES.info;
          const Icon = notice.severity === 'info' ? Info : AlertTriangle;
          return (
            <div key={notice.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 10, background: tone.background, border: `1px solid ${tone.border}` }}>
              <Icon size={16} style={{ color: tone.color, marginTop: 2, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: tone.color }}>{notice.title}</div>
                <div style={{ fontSize: 12.5, color: C.text, marginTop: 2 }}>{notice.message}</div>
              </div>
              {notice.action && (
                <button type="button" onClick={() => onNavigate(notice.action.path)} style={{ ...buttonStyle(false), padding: '5px 10px', fontSize: 12 }}>
                  {notice.action.label}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Step bodies ─────────────────────────────────────────────
function BusinessForm({ overview, onSaved }) {
  const brand = overview.brand || {};
  const [form, setForm] = useState({ name: brand.name || '', wa_website: brand.website || '', wa_address: brand.address || '' });
  const [saving, setSaving] = useState(false);
  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/clients/${brand.id}`, form);
      toast.success('Business details saved');
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <form onSubmit={save} style={{ display: 'grid', gap: 10, maxWidth: 520 }}>
      <Field label="Business name"><input style={inputStyle} value={form.name} onChange={set('name')} required /></Field>
      <Field label="Website"><input style={inputStyle} value={form.wa_website} onChange={set('wa_website')} placeholder="https://example.com" /></Field>
      <Field label="Address"><textarea style={{ ...inputStyle, minHeight: 60 }} value={form.wa_address} onChange={set('wa_address')} /></Field>
      <div><button type="submit" disabled={saving} style={buttonStyle(true, saving)}>{saving ? 'Saving…' : 'Save details'}</button></div>
    </form>
  );
}

function WhatsappBody({ step, overview, canManage, onChanged }) {
  const [busy, setBusy] = useState(false);
  const embedded = overview.embedded_signup;
  const ask = async () => {
    setBusy(true);
    try {
      await api.requestWhatsappConnect();
      toast.success('Our team has been told. We will connect your number and show it here.');
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  const connectWithMeta = async () => {
    setBusy(true);
    try {
      const details = await launchMetaEmbeddedSignup(embedded);
      await api.completeEmbeddedSignup({ code: details.code, phone_number_id: details.phone_number_id, waba_id: details.waba_id });
      toast.success('WhatsApp connected');
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  if (step.status === 'done') return <div style={{ fontSize: 13, color: C.muted }}>Your WhatsApp number is connected.</div>;
  if (step.status === 'in_review') return <div style={{ fontSize: 13, color: C.muted }}>Our team is connecting your WhatsApp number. You do not need to do anything.</div>;
  if (!canManage) return <div style={{ fontSize: 13, color: C.muted }}>Ask the account owner to connect WhatsApp.</div>;
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {embedded?.enabled && <button type="button" onClick={connectWithMeta} disabled={busy} style={buttonStyle(true, busy)}>Connect with Meta</button>}
      <button type="button" onClick={ask} disabled={busy} style={buttonStyle(!embedded?.enabled, busy)}>Ask our team to connect</button>
    </div>
  );
}

const emptyService = () => ({ name: '', price_inr: '', duration_minutes: '', availability: '', notes: '', answers: [{ question: '', answer: '' }] });

function ServicesBody({ canManage, onChanged }) {
  const [services, setServices] = useState(null);
  const [form, setForm] = useState(null); // { id, ...fields } while adding or editing
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((current) => current + 1), []);
  useEffect(() => {
    let cancelled = false;
    api.getOnboardingServices()
      .then((result) => { if (!cancelled) setServices(result.services); })
      .catch((err) => { if (!cancelled) toast.error(err.message); });
    return () => { cancelled = true; };
  }, [version]);

  const save = async (event) => {
    event.preventDefault();
    const check = validateService(form);
    setErrors(check.errors);
    if (!check.ok) return;
    setSaving(true);
    try {
      await api.saveOnboardingService(serviceBody(form), form.id || null);
      setForm(null);
      load();
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };
  const remove = async (id) => {
    try {
      await api.deleteOnboardingService(id);
      load();
      onChanged();
    } catch (err) {
      toast.error(err.message);
    }
  };
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const setAnswer = (index, key) => (event) => setForm((current) => ({ ...current, answers: current.answers.map((item, i) => (i === index ? { ...item, [key]: event.target.value } : item)) }));

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {(services || []).map((service) => (
        <div key={service.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8, opacity: service.is_active ? 1 : 0.55 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{service.name}</div>
            <div style={{ fontSize: 12, color: C.muted }}>₹{service.price_inr} · {service.duration_minutes} min · {service.answers?.length || 0} answers{service.is_active ? '' : ' · off'}</div>
          </div>
          {canManage && (
            <>
              <button type="button" style={{ ...buttonStyle(false), padding: '4px 10px', fontSize: 12 }} onClick={() => { setErrors({}); setForm({ ...emptyService(), ...service, answers: service.answers?.length ? service.answers : [{ question: '', answer: '' }] }); }}>Edit</button>
              <button type="button" aria-label={`Delete ${service.name}`} style={{ ...buttonStyle(false), padding: '4px 8px' }} onClick={() => remove(service.id)}><Trash2 size={13} /></button>
            </>
          )}
        </div>
      ))}
      {services && !services.length && !form && <div style={{ fontSize: 13, color: C.muted }}>No services yet. Add what you sell, with its price and how long it takes.</div>}
      {form ? (
        <form onSubmit={save} style={{ display: 'grid', gap: 10, maxWidth: 560, padding: 12, border: `1px solid ${C.border}`, borderRadius: 10 }}>
          <Field label="Service name" error={errors.name}><input style={inputStyle} value={form.name} onChange={set('name')} /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Price (₹)" error={errors.price_inr}><input style={inputStyle} inputMode="decimal" value={form.price_inr} onChange={set('price_inr')} /></Field>
            <Field label="Takes (minutes)" error={errors.duration_minutes}><input style={inputStyle} inputMode="numeric" value={form.duration_minutes} onChange={set('duration_minutes')} /></Field>
          </div>
          <Field label="When is it available? (optional)"><input style={inputStyle} value={form.availability} onChange={set('availability')} placeholder="Mon to Sat, 9 am to 6 pm" /></Field>
          <Field label="Anything else the AI should know (optional)"><input style={inputStyle} value={form.notes} onChange={set('notes')} /></Field>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 4 }}>Questions and answers the AI may use</div>
            {form.answers.map((item, index) => (
              <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 6 }}>
                <input style={inputStyle} placeholder="Question" value={item.question} onChange={setAnswer(index, 'question')} />
                <input style={inputStyle} placeholder="Answer" value={item.answer} onChange={setAnswer(index, 'answer')} />
              </div>
            ))}
            {errors.answers && <div style={{ color: C.red, fontSize: 12 }}>{errors.answers}</div>}
            {form.answers.length < 10 && (
              <button type="button" style={{ ...buttonStyle(false), padding: '4px 10px', fontSize: 12 }} onClick={() => setForm((current) => ({ ...current, answers: [...current.answers, { question: '', answer: '' }] }))}>
                <Plus size={12} /> Add a question
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={saving} style={buttonStyle(true, saving)}>{saving ? 'Saving…' : 'Save service'}</button>
            <button type="button" style={buttonStyle(false)} onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      ) : (canManage && <div><button type="button" style={buttonStyle(true)} onClick={() => { setErrors({}); setForm(emptyService()); }}>Add a service</button></div>)}
    </div>
  );
}

function TemplatesBody({ step, onNavigate }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {step.templates?.length ? step.templates.map((template) => (
        <div key={template.template_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{template.name}</div>
            <div style={{ fontSize: 12, color: C.muted }}>{[template.category, template.language].filter(Boolean).join(' · ')}</div>
          </div>
          <Chip tone={TEMPLATE_TONES[template.status] || TEMPLATE_TONES.unknown}>{template.status_label}</Chip>
        </div>
      )) : <div style={{ fontSize: 13, color: C.muted }}>{step.detail}</div>}
      {step.status !== 'locked' && <div><button type="button" style={buttonStyle(false)} onClick={() => onNavigate('/templates')}>Open templates</button></div>}
    </div>
  );
}

function TestBody({ step, overview, onChanged }) {
  const [phone, setPhone] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [hint, setHint] = useState({});
  const [busy, setBusy] = useState(false);
  const needsPhone = !overview.test_phone || hint.needsPhone;
  const send = async () => {
    setBusy(true);
    try {
      const result = await api.sendOnboardingTestMessage({ ...(needsPhone && phone ? { phone } : {}), confirm_own_phone: confirm });
      toast.success(`Test message sent to the number ending ${result.to_last4}`);
      setHint({});
      onChanged();
    } catch (err) {
      setHint(testMessageHint(err));
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  if (step.status === 'locked') return <div style={{ fontSize: 13, color: C.muted }}>{step.detail}</div>;
  return (
    <div style={{ display: 'grid', gap: 10, maxWidth: 420 }}>
      <div style={{ fontSize: 13, color: C.muted }}>{step.detail}</div>
      {needsPhone
        ? <Field label="Your own mobile number"><input style={inputStyle} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+91 98765 43210" /></Field>
        : <div style={{ fontSize: 13, color: C.text }}>It will go to your number {overview.test_phone}.</div>}
      {hint.needsConfirm && (
        <label style={{ fontSize: 12.5, color: C.text, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} />
          This number is my own and I want to receive this test message.
        </label>
      )}
      <div><button type="button" onClick={send} disabled={busy} style={buttonStyle(true, busy)}>{busy ? 'Sending…' : (step.status === 'done' ? 'Send another' : 'Send a test message')}</button></div>
    </div>
  );
}

function GoLiveBody({ step, onChanged }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const result = await api.goLive();
      toast.success(result.ai_replies ? 'You are live. AI replies and campaigns are on.' : 'You are live. Campaigns are on. Finish your AI Brain to turn on AI replies.');
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
  if (step.status === 'locked') return <div style={{ fontSize: 13, color: C.muted }}>{step.detail}</div>;
  return (
    <div style={{ display: 'grid', gap: 10, maxWidth: 460 }}>
      <div style={{ fontSize: 13, color: C.muted }}>Going live turns on AI replies and campaigns for your workspace.</div>
      {confirming ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={go} disabled={busy} style={buttonStyle(true, busy)}>{busy ? 'Going live…' : 'Yes, go live'}</button>
          <button type="button" onClick={() => setConfirming(false)} style={buttonStyle(false)}>Not yet</button>
        </div>
      ) : <div><button type="button" onClick={() => setConfirming(true)} style={buttonStyle(true)}>Go live</button></div>}
    </div>
  );
}

// ── Checklist ───────────────────────────────────────────────
function StepRow({ step, overview, canManage, open, onToggle, onChanged, onNavigate }) {
  const tone = STATUS_TONES[step.status] || STATUS_TONES.todo;
  const Icon = ICONS[step.status] || Circle;
  const action = stepAction(step, { canManage, embeddedSignup: overview.embedded_signup?.enabled });
  const bodies = {
    business: <BusinessForm overview={overview} onSaved={onChanged} />,
    whatsapp: <WhatsappBody step={step} overview={overview} canManage={canManage} onChanged={onChanged} />,
    services: <ServicesBody canManage={canManage} onChanged={onChanged} />,
    templates: <TemplatesBody step={step} onNavigate={onNavigate} />,
    test: <TestBody step={step} overview={overview} onChanged={onChanged} />,
    go_live: <GoLiveBody step={step} onChanged={onChanged} />,
  };
  return (
    <li style={{ borderTop: `1px solid ${C.border}`, listStyle: 'none' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 4px', background: 'transparent', border: 'none', textAlign: 'left' }}
      >
        <Icon size={18} style={{ color: tone.color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: step.status === 'locked' ? C.muted : C.text }}>{step.title}</div>
          <div style={{ fontSize: 12.5, color: C.muted, marginTop: 1 }}>{step.detail}</div>
        </div>
        <Chip tone={tone}>{statusLabel(step.status)}</Chip>
        {action && <span style={{ fontSize: 12, fontWeight: 600, color: C.accent, whiteSpace: 'nowrap' }}>{action}</span>}
        {open ? <ChevronUp size={16} color={C.muted} /> : <ChevronDown size={16} color={C.muted} />}
      </button>
      {open && <div style={{ padding: '4px 4px 16px 34px' }}>{bodies[step.key]}</div>}
    </li>
  );
}

export function OnboardingPanel() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);
  const [version, setVersion] = useState(0);
  // undefined until the customer opens or closes a step; then their choice wins.
  const [chosen, setChosen] = useState(undefined);
  const canManage = canManageSetup(user?.role);
  const load = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    api.getOnboarding()
      // The Home screen works without the setup panel; nothing raw is shown.
      .then((result) => { if (!cancelled) setOverview(result); })
      .catch(() => { if (!cancelled) setOverview(null); });
    return () => { cancelled = true; };
  }, [version]);

  // By default the first step that still needs the customer is open.
  const open = chosen !== undefined ? chosen : overview?.steps.find((step) => step.status === 'todo')?.key || false;

  if (!overview) return null;
  return (
    <div data-testid="onboarding-panel">
      <NoticesBox notices={overview.notices} onNavigate={navigate} />
      {showChecklist(overview) && (
        <section aria-label="Setup checklist" style={{ ...card, padding: '14px 16px', marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Finish setting up</div>
            <div style={{ fontSize: 12.5, color: C.muted }}>{progressLine(overview)}</div>
          </div>
          <ul style={{ margin: 0, padding: 0 }}>
            {overview.steps.map((step) => (
              <StepRow
                key={step.key}
                step={step}
                overview={overview}
                canManage={canManage}
                open={open === step.key}
                onToggle={() => setChosen(open === step.key ? false : step.key)}
                onChanged={load}
                onNavigate={navigate}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default OnboardingPanel;
