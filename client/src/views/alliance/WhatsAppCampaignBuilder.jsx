import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Users,
  Download,
} from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../services/api.js";
import { DatePicker } from "./DatePicker.jsx";
import { WhatsAppCampaignDetail } from "./WhatsAppCampaignDetail.jsx";
import { BulkSendLimitControl } from "./BulkSendLimitControl.jsx";
import "./alliance.css";

const pad2 = (n) => String(n).padStart(2, "0");
const todayLocalISO = (() => {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
})();
const WHATSAPP_CAMPAIGN_DRAFT_KEY = "alliance_whatsapp_campaign_builder_draft_v1";
const PARAMETER_FIELD_LABELS = {
  name: "Prospect contact name", business_name: "Business name", location: "Location",
  phone: "Phone", email: "Email", audience: "Audience", industry: "Industry",
  source: "Source", status: "Status", consent_source: "Consent source",
  ai_score: "AI score", channel: "Channel", consent: "WhatsApp consent",
  campaign_name: "Campaign name", created_at: "Date added",
};

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "2-digit" });
};

export const WhatsAppCampaignBuilder = () => {
  const [templates, setTemplates] = useState([]);
  const [audiences, setAudiences] = useState([]);
  const [prospects, setProspects] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [form, setForm] = useState({
    name: "",
    template_id: "",
    audience: "",
    search: "",
    dateFrom: "",
    dateTo: "",
    delivery_mode: "now",
    scheduled_at: "",
    test_phone: "",
    followup_template_id: "",
    followup_delay_minutes: 5760,
    followup_repeat_days: 4,
    max_followups: 0,
  });
  const [mapping, setMapping] = useState([]);
  const [followupMapping, setFollowupMapping] = useState([]);
  const [selected, setSelected] = useState({});
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState("");
  const [deletingCampaign, setDeletingCampaign] = useState(null);
  const [stoppingCampaign, setStoppingCampaign] = useState(null);
  const [viewingCampaignId, setViewingCampaignId] = useState(null);
  const [draftStatus, setDraftStatus] = useState("");
  const draftReadyRef = useRef(false);
  const latestDraftRef = useRef(null);
  const discardDraftRef = useRef(false);
  const restoredMappingRef = useRef(null);
  const restoredFollowupMappingRef = useRef(null);
  const limit = 10;

  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(WHATSAPP_CAMPAIGN_DRAFT_KEY) || "null");
      if (draft?.version === 1) {
        if (draft.form) setForm((current) => ({ ...current, ...draft.form }));
        if (draft.selected && typeof draft.selected === "object") setSelected(draft.selected);
        if (Number.isInteger(draft.page)) setPage(Math.max(1, draft.page));
        restoredMappingRef.current = Array.isArray(draft.mapping) ? draft.mapping : [];
        restoredFollowupMappingRef.current = Array.isArray(draft.followupMapping) ? draft.followupMapping : [];
        setMapping(restoredMappingRef.current);
        setFollowupMapping(restoredFollowupMappingRef.current);
        setDraftStatus("Draft restored");
      }
    } catch {
      localStorage.removeItem(WHATSAPP_CAMPAIGN_DRAFT_KEY);
    } finally { draftReadyRef.current = true; }
  }, []);

  useEffect(() => {
    if (!draftReadyRef.current) return undefined;
    const hasContent = Boolean(form.name.trim() || form.template_id || form.audience || Object.keys(selected).length);
    if (!hasContent) { latestDraftRef.current = null; localStorage.removeItem(WHATSAPP_CAMPAIGN_DRAFT_KEY); return undefined; }
    discardDraftRef.current = false;
    const compactSelected = Object.fromEntries(Object.entries(selected).map(([id, lead]) => [id, {
      id: lead.id, name: lead.name, business_name: lead.business_name, phone: lead.phone,
      email: lead.email, audience: lead.audience, industry: lead.industry, location: lead.location,
      status: lead.status, source: lead.source, channel: lead.channel, channel_pref: lead.channel_pref, consent: lead.consent,
      consent_source: lead.consent_source, ai_score: lead.ai_score, campaign_name: lead.campaign_name,
      custom_fields: lead.custom_fields, created_at: lead.created_at,
    }]));
    const snapshot = { version: 1, savedAt: new Date().toISOString(), form, mapping, followupMapping, selected: compactSelected, page };
    latestDraftRef.current = snapshot;
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(WHATSAPP_CAMPAIGN_DRAFT_KEY, JSON.stringify(snapshot)); setDraftStatus("Draft saved"); }
      catch { setDraftStatus("Draft could not be saved"); }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [form, mapping, followupMapping, selected, page]);

  useEffect(() => () => {
    if (!discardDraftRef.current && latestDraftRef.current) {
      try { localStorage.setItem(WHATSAPP_CAMPAIGN_DRAFT_KEY, JSON.stringify(latestDraftRef.current)); } catch { /* Navigation must remain available. */ }
    }
  }, []);
  const refreshCampaigns = useCallback(async () => {
    try {
      const data = await api.getAllianceWhatsAppCampaigns();
      setCampaigns(data.campaigns || []);
    } catch (error) {
      toast.error(error.message);
    }
  }, []);
  useEffect(() => {
    Promise.all([
      api.getTemplates(),
      api.getAllianceCampaignBuilderOptions(),
      api.getAllianceWhatsAppCampaigns(),
      api.getAllianceAudiences(),
    ])
      .then(([templateData, options, campaignData, audienceData]) => {
        setTemplates(
          (templateData.templates || []).filter(
            (item) => String(item.status).toLowerCase() === "approved" && (!item.template_scope || ["alliance", "shared"].includes(item.template_scope)),
          ),
        );
        setAudiences(audienceData.audiences || options.audiences || []);
        setCampaigns(campaignData.campaigns || []);
      })
      .catch((error) => toast.error(error.message));
  }, []);
  useEffect(() => {
    const interval = window.setInterval(refreshCampaigns, 10000);
    return () => window.clearInterval(interval);
  }, [refreshCampaigns]);
  const loadProspects = useCallback(async () => {
    try {
      const data = await api.getAllianceWhatsAppProspects({
        audience: form.audience,
        search: form.search,
        dateFrom: form.dateFrom,
        dateTo: form.dateTo,
        limit,
        offset: (page - 1) * limit,
      });
      setProspects(data.prospects || []);
      setTotal(data.total || 0);
    } catch (error) {
      toast.error(error.message);
    }
  }, [form.audience, form.search, form.dateFrom, form.dateTo, page]);
  useEffect(() => {
    const timer = setTimeout(loadProspects, 200);
    return () => clearTimeout(timer);
  }, [loadProspects]);
  const template = templates.find(
    (item) => String(item.id) === String(form.template_id),
  );
  const templateButtons = useMemo(() => {
    try { return Array.isArray(template?.buttons) ? template.buttons : JSON.parse(template?.buttons || '[]'); }
    catch { return []; }
  }, [template]);
  const variableCount = useMemo(
    () =>
      Math.max(
        0,
        ...[...String(template?.body || "").matchAll(/\{\{(\d+)\}\}/g)].map(
          (match) => Number(match[1]),
        ),
      ),
    [template],
  );
  const followupTemplate = templates.find(
    (item) => String(item.id) === String(form.followup_template_id),
  );
  const followupVariableCount = useMemo(
    () =>
      Math.max(
        0,
        ...[
          ...String(followupTemplate?.body || "").matchAll(/\{\{(\d+)\}\}/g),
        ].map((match) => Number(match[1])),
      ),
    [followupTemplate],
  );
  const parameterFieldOptions = useMemo(() => {
    const fields = new Map(Object.entries(PARAMETER_FIELD_LABELS));
    audiences.forEach((audience) => {
      (audience.column_config || [])
        .filter((column) => column.enabled !== false)
        .forEach((column) => fields.set(column.key, column.label || column.key.replaceAll('_', ' ')));
      (audience.fields || [])
        .filter((field) => field.active !== false)
        .forEach((field) => fields.set(field.field_key, field.label || field.field_key.replaceAll('_', ' ')));
    });
    [...prospects, ...Object.values(selected)].forEach((prospect) => {
      const customFields = prospect?.custom_fields && typeof prospect.custom_fields === 'object'
        ? prospect.custom_fields : {};
      Object.keys(customFields).forEach((key) => fields.set(key, fields.get(key) || key.replaceAll('_', ' ')));
    });
    [...mapping, ...followupMapping].filter(Boolean).forEach((key) => fields.set(key, fields.get(key) || key.replaceAll('_', ' ')));
    return [...fields.entries()];
  }, [audiences, prospects, selected, mapping, followupMapping]);
  useEffect(() => {
    if (!template && restoredMappingRef.current) return;
    if (template && restoredMappingRef.current) {
      const restored = restoredMappingRef.current;
      restoredMappingRef.current = null;
      if (restored.length === variableCount) { setMapping(restored); return; }
    }
    const defaultField = (index) => {
      const source = template?.parameter_definitions?.body?.[String(index + 1)]?.default_source;
      if (source === 'recipient_name') return 'name';
      if (source === 'brand_name') return 'business_name';
      return ["name", "business_name", "location"][index] || "name";
    };
    setMapping(
      Array.from(
        { length: variableCount },
        (_, index) => defaultField(index),
      ),
    );
  }, [variableCount, template]);
  useEffect(() => {
    if (!followupTemplate && restoredFollowupMappingRef.current) return;
    if (followupTemplate && restoredFollowupMappingRef.current) {
      const restored = restoredFollowupMappingRef.current;
      restoredFollowupMappingRef.current = null;
      if (restored.length === followupVariableCount) { setFollowupMapping(restored); return; }
    }
    setFollowupMapping(
      Array.from(
        { length: followupVariableCount },
        (_, index) => {
          const source = followupTemplate?.parameter_definitions?.body?.[String(index + 1)]?.default_source;
          return source && /^[a-z][a-z0-9_]*$/.test(source)
            ? source : (["name", "business_name", "location"][index] || "name");
        },
      ),
    );
  }, [followupVariableCount, followupTemplate]);
  const selectedIds = Object.keys(selected).map(Number);
  const previewLead = Object.values(selected)[0] ||
    prospects[0] || {
    name: "Sample Contact",
    business_name: "Example Organisation",
    location: "Pondicherry",
  };
  const valueFor = (field) => field === 'campaign_name'
    ? (form.name || previewLead.campaign_name || '—')
    : (previewLead[field] ?? previewLead.custom_fields?.[field] ?? "—");
  const preview = mapping.reduce(
    (body, field, index) =>
      body.replaceAll(`{{${index + 1}}}`, valueFor(field)),
    template?.body || "Select an approved template to preview it.",
  );
  const toggle = (lead) =>
    setSelected((current) => {
      const next = { ...current };
      if (next[lead.id]) delete next[lead.id];
      else next[lead.id] = lead;
      return next;
    });
  const selectAll = async () => {
    setBusy("select");
    try {
      const data = await api.getAllianceWhatsAppProspects({
        audience: form.audience,
        search: form.search,
        dateFrom: form.dateFrom,
        dateTo: form.dateTo,
        limit: 5000,
        offset: 0,
      });
      setSelected(
        Object.fromEntries(
          (data.prospects || []).map((lead) => [lead.id, lead]),
        ),
      );
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy("");
    }
  };
  const test = async () => {
    if (!template || !form.test_phone)
      return toast.error(
        "Select a template and enter your test WhatsApp number",
      );
    setBusy("test");
    try {
      const result = await api.testAllianceWhatsAppCampaign({
        template_id: template.id,
        phone: form.test_phone,
        sample_values: mapping.map(valueFor),
      });
      toast.success(result.message);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy("");
    }
  };
  const create = async () => {
    if (!form.name.trim() || !template || !selectedIds.length)
      return toast.error(
        "Enter a name, choose an approved template, and select leads",
      );
    if (form.delivery_mode === "schedule" && !form.scheduled_at)
      return toast.error("Choose the date and time for the scheduled campaign");
    if (form.delivery_mode === "schedule" && new Date(form.scheduled_at).getTime() <= Date.now())
      return toast.error("Scheduled time must be in the future");
    setBusy("create");
    try {
      const result = await api.createAllianceWhatsAppCampaign({
        name: form.name,
        audience: form.audience,
        template_id: template.id,
        prospect_ids: selectedIds,
        parameter_mapping: mapping,
        followup_template_id: followupTemplate?.id || null,
        followup_parameter_mapping: followupMapping,
        followup_delay_minutes: Number(form.followup_delay_minutes),
        followup_repeat_days: Number(form.followup_repeat_days),
        max_followups: 0,
        scheduled_at: form.delivery_mode === "schedule" && form.scheduled_at
          ? new Date(form.scheduled_at).toISOString()
          : null,
      });
      discardDraftRef.current = true;
      latestDraftRef.current = null;
      localStorage.removeItem(WHATSAPP_CAMPAIGN_DRAFT_KEY);
      setDraftStatus("");
      toast.success(result.message);
      const data = await api.getAllianceWhatsAppCampaigns();
      setCampaigns(data.campaigns || []);
      setForm({ name: "", template_id: "", audience: "", search: "", dateFrom: "", dateTo: "", delivery_mode: "now", scheduled_at: "", test_phone: "", followup_template_id: "", followup_delay_minutes: 5760, followup_repeat_days: 4, max_followups: 0 });
      setMapping([]); setFollowupMapping([]); setSelected({}); setPage(1);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy("");
    }
  };
  const pages = Math.max(1, Math.ceil(total / limit));
  const pauseCampaign = async (item) => {
    setBusy(`pause-${item.id}`);
    try {
      const result = await api.pauseAllianceWhatsAppCampaign(item.id);
      toast.success(result.message);
      await refreshCampaigns();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy("");
    }
  };
  const resumeCampaign = async (item) => {
    setBusy(`resume-${item.id}`);
    try {
      const result = await api.resumeAllianceWhatsAppCampaign(item.id);
      toast.success(result.message);
      await refreshCampaigns();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy("");
    }
  };
  const confirmStopCampaign = async () => {
    if (!stoppingCampaign) return;
    setBusy(`stop-${stoppingCampaign.id}`);
    try {
      const result = await api.stopAllianceWhatsAppCampaign(stoppingCampaign.id);
      toast.success(result.message);
      setStoppingCampaign(null);
      await refreshCampaigns();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy("");
    }
  };
  const deleteCampaign = async () => {
    if (!deletingCampaign) return;
    setBusy(`delete-${deletingCampaign.id}`);
    try {
      const result = await api.deleteAllianceWhatsAppCampaign(deletingCampaign.id);
      setCampaigns((current) => current.filter((item) => item.id !== deletingCampaign.id));
      setDeletingCampaign(null);
      toast.success(result.message);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy("");
    }
  };
  const discardDraft = () => {
    discardDraftRef.current = true;
    latestDraftRef.current = null;
    localStorage.removeItem(WHATSAPP_CAMPAIGN_DRAFT_KEY);
    setForm({ name: "", template_id: "", audience: "", search: "", dateFrom: "", dateTo: "", delivery_mode: "now", scheduled_at: "", test_phone: "", followup_template_id: "", followup_delay_minutes: 5760, followup_repeat_days: 4, max_followups: 0 });
    setMapping([]); setFollowupMapping([]); setSelected({}); setPage(1); setDraftStatus("Draft discarded");
  };
  return (
    <div className="al-wrap al-wa-builder">
      <div className="al-eyebrow">AllianceOS · WhatsApp bulk messaging</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}><div className="al-page-title">WhatsApp campaign builder</div><div style={{ display: "flex", alignItems: "center", gap: 8 }}><small style={{ color: "var(--al-faint)" }}>{draftStatus}</small><button type="button" className="al-btn ghost sm" onClick={discardDraft}>Discard draft</button></div></div>
      <p className="al-page-desc">
        Send Meta-approved templates only to Alliance prospects with recorded
        WhatsApp consent.
      </p>
      <div className="al-wa-safety">
        <ShieldCheck size={20} />
        <div>
          <b>Consent-safe sending</b>
          <span>
            Only leads with consent=true, an approved consent source, consent time, evidence, and scope are available. Scraped, purchased, directory, or researched numbers are excluded.
            Replies, STOP, suppression, and closed lead statuses prevent
            sending.
          </span>
        </div>
      </div>
      <div className="al-wa-layout">
        <main>
          <section className="al-cb-card">
            <div className="al-cb-section-head">
              <span className="al-cb-icon">
                <MessageCircle size={20} />
              </span>
              <div>
                <h2>Campaign and registered template</h2>
                <p>
                  Templates below come directly from the same GET /api/templates
                  source used by the Templates page.
                </p>
              </div>
            </div>
            <div className="al-cb-grid two">
              <div className="al-field">
                <label>
                  Campaign name <b>*</b>
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="August opted-in colleges"
                />
              </div>
              <div className="al-field">
                <label>
                  Approved WhatsApp template <b>*</b>
                </label>
                <select
                  value={form.template_id}
                  onChange={(e) =>
                    setForm({ ...form, template_id: e.target.value })
                  }
                >
                  <option value="">Select registered template</option>
                  {templates.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.language} · {item.category}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {!templates.length && (
              <div className="al-note">
                <span>!</span>
                <div>
                  No approved templates are available. Sync or approve templates
                  from <b>/templates</b>.
                </div>
              </div>
            )}
            {template && (
              <div className="al-wa-template">
                <header>
                  <b>{template.name}</b>
                  <span>
                    {template.category} · {template.language} · approved
                  </span>
                </header>
                <div>{template.body}</div>
                {template.footer && <small>{template.footer}</small>}
                {!!templateButtons.length && <div className="al-wa-template-buttons">{templateButtons.map((button, index) => <span key={`${button.type}-${index}`}>{button.type === 'URL' ? '↗' : button.type === 'PHONE_NUMBER' ? '☎' : '↩'} {button.text}</span>)}</div>}
                <a href={`${api.baseUrl}/api/templates/${template.id}/campaign-sheet`} download className="al-button secondary" style={{ marginTop: 10, width: 'fit-content', textDecoration: 'none' }}>
                  <Download size={14} /> Download parameter Excel
                </a>
              </div>
            )}
            {variableCount > 0 && (
              <div className="al-wa-map">
                <b>Template variable mapping</b>
                {mapping.map((field, index) => (
                  <label key={index}>
                    <span>{`{{${index + 1}}}`}<small style={{ display: 'block' }}>{template?.parameter_definitions?.body?.[String(index + 1)]?.label || `Parameter ${index + 1}`}</small></span>
                    <select
                      value={field}
                      onChange={(e) =>
                        setMapping((current) =>
                          current.map((value, i) =>
                            i === index ? e.target.value : value,
                          ),
                        )
                      }
                    >
                      {parameterFieldOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                    <em>{valueFor(field)}</em>
                  </label>
                ))}
              </div>
            )}
            <div className="al-wa-followup-config">
              <div>
                <b>n8n automated reminder</b>
                <small>Optional. Uses another approved template from the same Templates API.</small>
              </div>
              <div className="al-cb-grid two">
                <div className="al-field">
                  <label>Follow-up template</label>
                  <select value={form.followup_template_id} onChange={(e) => setForm({ ...form, followup_template_id: e.target.value })}>
                    <option value="">No automated reminder</option>
                    {templates.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.language}</option>)}
                  </select>
                </div>
                <div className="al-field">
                  <label>First reminder after</label>
                  <select value={form.followup_delay_minutes} onChange={(e) => setForm({ ...form, followup_delay_minutes: e.target.value })} disabled={!followupTemplate}>
                    <option value="10">10 minutes (testing only)</option>
                    <option value="1440">1 day</option>
                    <option value="2880">2 days</option>
                    <option value="4320">3 days</option>
                    <option value="5760">4 days (recommended)</option>
                    <option value="7200">5 days</option>
                    <option value="10080">7 days</option>
                  </select>
                </div>
                <div className="al-field">
                  <label>Repeat while inactive</label>
                  <select value={form.followup_repeat_days} onChange={(e) => setForm({ ...form, followup_repeat_days: e.target.value })} disabled={!followupTemplate}>
                    <option value="1">Every 1 day</option>
                    <option value="2">Every 2 days</option>
                    <option value="3">Every 3 days</option>
                    <option value="4">Every 4 days (recommended)</option>
                    <option value="5">Every 5 days</option>
                    <option value="7">Every 7 days</option>
                  </select>
                </div>
              </div>
              {followupTemplate && <>
                <div className="al-wa-template"><header><b>{followupTemplate.name}</b><span>n8n reminder · approved</span></header><div>{followupTemplate.body}</div></div>
                {followupVariableCount > 0 && <div className="al-wa-map"><b>Follow-up variable mapping</b>{followupMapping.map((field, index) => <label key={index}><span>{`{{${index + 1}}}`}<small style={{ display: 'block' }}>{followupTemplate?.parameter_definitions?.body?.[String(index + 1)]?.label || PARAMETER_FIELD_LABELS[field] || field?.replaceAll('_', ' ') || `Parameter ${index + 1}`}</small></span><select value={field} onChange={(e) => setFollowupMapping((current) => current.map((value, i) => i === index ? e.target.value : value))}>{parameterFieldOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><em>{valueFor(field)}</em></label>)}</div>}
                <small className="al-help">The approved reminder repeats only while the lead is inactive. It stops automatically for Not Interested, Closed, Converted, Completed, Unsubscribed, or suppressed leads. A recipient reply pauses reminders; a later admin/AI reply starts a fresh inactivity timer.</small>
              </>}
            </div>
          </section>
          <section className="al-cb-card">
            <div className="al-cb-section-head">
              <span className="al-cb-icon">
                <Users size={20} />
              </span>
              <div>
                <h2>Select opted-in leads</h2>
                <p>Non-consented phone numbers are excluded by the server.</p>
              </div>
            </div>
            <div className="al-cb-grid two">
              <div className="al-field">
                <label>Audience</label>
                <select
                  value={form.audience}
                  onChange={(e) => {
                    setForm({ ...form, audience: e.target.value });
                    setPage(1);
                    setSelected({});
                  }}
                >
                  <option value="">All audiences</option>
                  {audiences.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="al-field">
                <label>Search</label>
                <div className="al-input-icon">
                  <Search size={15} />
                  <input
                    value={form.search}
                    onChange={(e) => {
                      setForm({ ...form, search: e.target.value });
                      setPage(1);
                    }}
                    placeholder="Name, business, or phone"
                  />
                </div>
              </div>
            </div>
            <div className="al-cb-grid three">
              <div className="al-field">
                <label>From date</label>
                <DatePicker
                  value={form.dateFrom}
                  max={form.dateTo}
                  onChange={(value) => {
                    setForm({ ...form, dateFrom: value });
                    setPage(1);
                    setSelected({});
                  }}
                />
              </div>
              <div className="al-field">
                <label>To date</label>
                <DatePicker
                  value={form.dateTo}
                  min={form.dateFrom}
                  onChange={(value) => {
                    setForm({ ...form, dateTo: value });
                    setPage(1);
                    setSelected({});
                  }}
                />
              </div>
              {(form.dateFrom || form.dateTo) && (
                <div className="al-field" style={{ display: "flex", alignItems: "flex-end" }}>
                  <button
                    type="button"
                    className="al-btn ghost sm"
                    onClick={() => {
                      setForm({ ...form, dateFrom: "", dateTo: "" });
                      setPage(1);
                      setSelected({});
                    }}
                  >
                    Clear dates
                  </button>
                </div>
              )}
            </div>
            <div className="al-cb-selection">
              <b>{selectedIds.length} selected</b>
              <span>{total} WhatsApp-eligible leads</span>
              <button
                className="al-btn ghost sm"
                disabled={!total || busy === "select"}
                onClick={selectAll}
              >
                Select all eligible
              </button>
              <button className="al-link" onClick={() => setSelected({})}>
                Clear
              </button>
            </div>
            <div className="al-cb-table">
              <table className="al-table">
                <thead>
                  <tr>
                    <th />
                    <th>Lead</th>
                    <th>Phone</th>
                    <th>Audience</th>
                    <th>Consent source</th>
                    <th>Date added</th>
                  </tr>
                </thead>
                <tbody>
                  {prospects.map((lead) => (
                    <tr
                      key={lead.id}
                      className={selected[lead.id] ? "selected" : ""}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={Boolean(selected[lead.id])}
                          onChange={() => toggle(lead)}
                        />
                      </td>
                      <td>
                        <b>{lead.name || lead.business_name}</b>
                        <small>{lead.business_name}</small>
                      </td>
                      <td>{lead.phone}</td>
                      <td>{lead.audience}</td>
                      <td>{lead.consent_source}</td>
                      <td>{formatDate(lead.created_at)}</td>
                    </tr>
                  ))}
                  {!prospects.length && (
                    <tr>
                      <td colSpan="6" className="al-empty">
                        No opted-in WhatsApp leads match this selection.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="al-cb-pagination">
              <span>
                Page {page} of {pages}
              </span>
              <div>
                <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft size={16} />
                </button>
                <button
                  disabled={page >= pages}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </section>
        </main>
        <aside>
          <section className="al-wa-preview">
            <header>
              <MessageCircle size={17} />
              <b>Message preview</b>
            </header>
            <div className="al-wa-phone">
              <div className="al-wa-bubble">
                {preview}
                <small>
                  {new Date().toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  ✓
                </small>
              </div>
              {!!templateButtons.length && <div className="al-wa-preview-buttons">{templateButtons.map((button, index) => button.type === 'URL' ? <a key={index} href={button.url || '#'} target="_blank" rel="noreferrer">↗ {button.text}</a> : button.type === 'PHONE_NUMBER' ? <a key={index} href={`tel:${button.phone_number || ''}`}>☎ {button.text}</a> : <button type="button" key={index}>↩ {button.text}</button>)}</div>}
            </div>
          </section>
          <section className="al-cb-summary">
            <div className="al-cb-summary-head">
              <CalendarClock size={17} />
              <b>Schedule and review</b>
            </div>
            <div className="al-field">
              <label>Delivery option</label>
              <div className="al-wa-delivery-options">
                <button
                  type="button"
                  className={form.delivery_mode === "now" ? "active" : ""}
                  onClick={() => setForm({ ...form, delivery_mode: "now", scheduled_at: "" })}
                >
                  <Send size={15} /> Send immediately
                </button>
                <button
                  type="button"
                  className={form.delivery_mode === "schedule" ? "active" : ""}
                  onClick={() => setForm({ ...form, delivery_mode: "schedule" })}
                >
                  <CalendarClock size={15} /> Schedule for later
                </button>
              </div>
              {form.delivery_mode === "schedule" && (
                <DatePicker
                  withTime
                  value={form.scheduled_at}
                  min={todayLocalISO}
                  onChange={(value) => setForm({ ...form, scheduled_at: value })}
                />
              )}
              <small className="al-help">
                {form.delivery_mode === "now"
                  ? "Messages enter the rate-safe sending queue immediately."
                  : "Messages remain queued until the selected date and time."}
              </small>
            </div>
            <BulkSendLimitControl channel="whatsapp" recipientCount={selectedIds.length} />
            <div className="al-cb-metric">
              <span>Recipients</span>
              <b>{selectedIds.length}</b>
            </div>
            <div className="al-cb-metric">
              <span>Template</span>
              <b>{template?.name || "Not selected"}</b>
            </div>
            <div className="al-field al-wa-test">
              <label>Test WhatsApp number</label>
              <input
                value={form.test_phone}
                onChange={(e) =>
                  setForm({ ...form, test_phone: e.target.value })
                }
                placeholder="919876543210"
              />
              <button
                className="al-btn ghost sm"
                disabled={busy === "test"}
                onClick={test}
              >
                <Send size={14} />
                {busy === "test" ? "Sending…" : "Send test"}
              </button>
            </div>
            <button
              className="al-btn al-wa-create"
              disabled={busy === "create"}
              onClick={create}
            >
              <Check size={16} />
              {busy === "create"
                ? form.delivery_mode === "now" ? "Starting…" : "Scheduling…"
                : form.delivery_mode === "now" ? "Review & send now" : "Review & schedule"}
            </button>
          </section>
        </aside>
      </div>
      {campaigns.length > 0 && (
        <section className="al-wa-recent">
          <h2>Recent WhatsApp campaigns</h2>
          {campaigns.slice(0, 5).map((item) => (
            <div key={item.id}>
              <span>
                <b>{item.name}</b>
                <small>
                  {item.template_name} ·{" "}
                  {new Date(item.scheduled_at).toLocaleString()}
                </small>
                <small>
                  Reminder: {item.followup_template_name || "None configured"}
                </small>
              </span>
              <em>{item.status}</em>
              <span>
                {item.sent}/{item.recipients} sent
                <small>
                  {item.delivered || 0} delivered · {item.read || 0} read · {item.failed || 0} failed · {item.skipped || 0} skipped
                </small>
                {item.next_followup_at && <small>Next reminder: {new Date(item.next_followup_at).toLocaleString()}</small>}
                {item.latest_error && <small className="al-wa-campaign-error">{item.latest_error}</small>}
              </span>
              <div className="al-wa-actions">
                <button
                  type="button"
                  className="al-btn ghost sm"
                  onClick={() => setViewingCampaignId(item.id)}
                >
                  Details
                </button>
                {["scheduled", "running"].includes(item.status) && (
                  <button
                    type="button"
                    className="al-btn ghost sm"
                    disabled={busy === `pause-${item.id}`}
                    onClick={() => pauseCampaign(item)}
                  >
                    {busy === `pause-${item.id}` ? "Pausing…" : "Pause"}
                  </button>
                )}
                {item.status === "paused" && (
                  <button
                    type="button"
                    className="al-btn sm"
                    disabled={busy === `resume-${item.id}`}
                    onClick={() => resumeCampaign(item)}
                  >
                    {busy === `resume-${item.id}` ? "Resuming…" : "Resume"}
                  </button>
                )}
                {(["scheduled", "running", "paused"].includes(item.status) || (item.status === "completed" && item.next_followup_at)) && (
                  <button
                    type="button"
                    className="al-btn ghost sm"
                    style={{ color: "#ff8f8f" }}
                    disabled={busy === `stop-${item.id}`}
                    onClick={() => setStoppingCampaign(item)}
                  >
                    {item.status === "completed" ? "Stop reminders" : "Stop"}
                  </button>
                )}
                <button
                  type="button"
                  className="al-wa-delete"
                  title="Delete campaign"
                  aria-label={`Delete ${item.name}`}
                  onClick={() => setDeletingCampaign(item)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
      {stoppingCampaign && (
        <div className="al-wa-modal-backdrop" role="presentation" onMouseDown={() => setStoppingCampaign(null)}>
          <div className="al-wa-modal" role="dialog" aria-modal="true" aria-labelledby="stop-wa-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="al-wa-modal-icon"><ShieldCheck size={20} /></div>
            <h2 id="stop-wa-title">{stoppingCampaign.status === "completed" ? "Stop pending reminders?" : "Stop WhatsApp campaign?"}</h2>
            <p>
              {stoppingCampaign.status === "completed"
                ? <>The initial send for <b>{stoppingCampaign.name}</b> is done, but future automated reminders are still scheduled. This cancels those pending reminders. Already-sent messages cannot be recalled.</>
                : <>All unsent messages and pending reminders for <b>{stoppingCampaign.name}</b> will be cancelled. Already-sent messages cannot be recalled. This cannot be undone — use Pause instead if you just want to hold off temporarily.</>}
            </p>
            <footer>
              <button className="al-btn ghost" onClick={() => setStoppingCampaign(null)}>Keep campaign</button>
              <button className="al-btn al-wa-confirm-delete" disabled={busy === `stop-${stoppingCampaign.id}`} onClick={confirmStopCampaign}>
                {busy === `stop-${stoppingCampaign.id}` ? "Stopping…" : stoppingCampaign.status === "completed" ? "Stop reminders" : "Stop permanently"}
              </button>
            </footer>
          </div>
        </div>
      )}
      {deletingCampaign && (
        <div className="al-wa-modal-backdrop" role="presentation" onMouseDown={() => setDeletingCampaign(null)}>
          <div className="al-wa-modal" role="dialog" aria-modal="true" aria-labelledby="delete-wa-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="al-wa-modal-icon"><Trash2 size={20} /></div>
            <h2 id="delete-wa-title">Delete WhatsApp campaign?</h2>
            <p><b>{deletingCampaign.name}</b> and its campaign recipient/follow-up records will be removed. Messages already stored in the Alliance Inbox will remain available.</p>
            <footer>
              <button className="al-btn ghost" onClick={() => setDeletingCampaign(null)}>Cancel</button>
              <button className="al-btn al-wa-confirm-delete" disabled={busy === `delete-${deletingCampaign.id}`} onClick={deleteCampaign}>
                {busy === `delete-${deletingCampaign.id}` ? "Deleting…" : "Delete campaign"}
              </button>
            </footer>
          </div>
        </div>
      )}
      {viewingCampaignId && (
        <WhatsAppCampaignDetail
          campaignId={viewingCampaignId}
          onClose={() => setViewingCampaignId(null)}
        />
      )}
    </div>
  );
};
