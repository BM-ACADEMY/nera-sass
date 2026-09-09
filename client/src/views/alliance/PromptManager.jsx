import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/api.js';
import './alliance.css';

const EMPTY_RULE = { name: '', job: 'reply_suggestion', channel: 'all', audience: '', condition_text: '', instruction_text: '', priority: 100, active: true };
const RULE_TEXT_TEMPLATE = `Rule Name: Placement guarantee questions
Brand / Audience: BM Academy
Channel: WhatsApp
AI Job: Reply suggestion
Condition: When a lead asks about placement guarantee, guaranteed salary, job assurance, or placement refund.
Instruction: Never promise a job or guaranteed placement. Use only the approved placement support information available in AI Brain. If the requested detail is unavailable, say the team will confirm it and offer to connect the lead with a mentor.
Priority: 100
Active: Yes`;
const JOBS = [
  ['all', 'All AI jobs'], ['campaign_message', 'Campaign message'], ['followup', 'Follow-up / reminder'],
  ['reply_suggestion', 'Reply suggestion'], ['classify', 'Reply classification'],
];
const labelFor = (options, value) => options.find(([key]) => key === value)?.[1] || value;

export const PromptManager = () => {
  const [rules, setRules] = useState([]);
  const [audiences, setAudiences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_RULE);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [extracting, setExtracting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [ruleData, audienceData] = await Promise.all([api.getAlliancePromptRules(), api.getAllianceAudiences()]);
      setRules(ruleData.rules || []); setAudiences(audienceData.audiences || []);
    } catch (error) { toast.error(error.message || 'Failed to load prompt rules'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(EMPTY_RULE); setPasteText(''); setShowPaste(false); setEditing('new'); };
  const openEdit = (rule) => {
    setForm({ name:rule.name, job:rule.job, channel:rule.channel, audience:rule.audience || '', condition_text:rule.condition_text || '', instruction_text:rule.instruction_text, priority:rule.priority, active:rule.active });
    setEditing(rule);
  };
  const extractFromText = async () => {
    if (!pasteText.trim()) { toast.error('Paste some rule text first.'); return; }
    setExtracting(true);
    try {
      const data = await api.extractAlliancePromptRule(pasteText);
      setForm({ ...EMPTY_RULE, ...(data.extracted || {}) });
      setShowPaste(false);
      toast.success('Rule fields extracted. Review them before saving.');
    } catch (error) { toast.error(error.message || 'Failed to extract rule'); }
    finally { setExtracting(false); }
  };
  const copyTemplate = async () => {
    try { await navigator.clipboard.writeText(RULE_TEXT_TEMPLATE); toast.success('Rule template copied'); }
    catch { toast.error('Could not copy the template'); }
  };
  const save = async (event) => {
    event.preventDefault(); setSaving(true);
    try {
      if (editing === 'new') await api.createAlliancePromptRule(form);
      else await api.updateAlliancePromptRule(editing.id, form);
      toast.success(editing === 'new' ? 'AI rule added' : 'AI rule updated'); setEditing(null); await load();
    } catch (error) { toast.error(error.message || 'Failed to save rule'); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    try { await api.deleteAlliancePromptRule(deleting.id); toast.success('AI rule deleted'); setDeleting(null); await load(); }
    catch (error) { toast.error(error.message || 'Failed to delete rule'); }
  };

  return (
    <div className="al-wrap">
      <div className="al-eyebrow">AllianceOS · Screen 6 · Behavior rules</div>
      <div className="al-prompt-title-row">
        <div><div className="al-page-title">AI Prompts &amp; Rules</div><p className="al-page-desc">Control how AI behaves across campaigns, follow-ups, and reply suggestions. Facts always come from the AI Brain.</p></div>
        <button className="al-btn" onClick={openNew}><Plus size={16} /> Add rule</button>
      </div>

      <div className="al-prompt-guard"><ShieldCheck size={20} /><div><b>Brain facts remain authoritative</b><span>Before AI generation, active rule conditions are matched against the current recipient message or campaign context. Only matching rules are applied, in priority order. Rules cannot authorize invented prices, dates, policies, or course details.</span></div></div>

      {loading ? <div className="al-brain-empty">Loading AI rules...</div> : !rules.length ? (
        <div className="al-brain-empty">No custom rules yet. The protected system defaults still apply.</div>
      ) : <div className="al-prompt-rule-list">{rules.map((rule) => (
        <article className={`al-prompt-rule ${rule.active ? '' : 'inactive'}`} key={rule.id}>
          <header><div><b>{rule.name}</b><div className="al-prompt-tags"><span>{labelFor(JOBS, rule.job)}</span><span>{rule.channel === 'all' ? 'Email + WhatsApp' : rule.channel}</span><span>{rule.audience_label || 'All audiences'}</span><span>Priority {rule.priority}</span>{!rule.active && <span>Inactive</span>}</div></div><div className="al-prompt-actions"><button title="Edit rule" onClick={() => openEdit(rule)}><Pencil size={15} /></button><button className="danger" title="Delete rule" onClick={() => setDeleting(rule)}><Trash2 size={15} /></button></div></header>
          {rule.condition_text && <div className="al-prompt-condition"><span>When</span>{rule.condition_text}</div>}
          <div className="al-prompt-instruction">{rule.instruction_text}</div>
        </article>
      ))}</div>}

      {editing && <div className="al-wa-modal-backdrop" role="presentation" onMouseDown={() => !saving && setEditing(null)}><form className="al-brain-modal al-prompt-modal" onSubmit={save} onMouseDown={(e) => e.stopPropagation()}>
        <header><b>{editing === 'new' ? 'Add AI behavior rule' : `Edit ${editing.name}`}</b><button type="button" className="al-wa-detail-close" onClick={() => setEditing(null)} aria-label="Close">×</button></header>
        <div className="al-brain-modal-body">
          <div className="al-brain-section al-prompt-paste-section">
            <div className="al-prompt-paste-head"><div><b>Paste from plain text</b><span>Extract a condition and instruction automatically.</span></div><button type="button" className="al-btn ghost sm" onClick={() => setShowPaste((value) => !value)}>{showPaste ? 'Hide' : 'Paste rule text'}</button></div>
            {showPaste && <div className="al-prompt-paste-body"><div className="al-field"><textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={RULE_TEXT_TEMPLATE} /></div><div className="al-prompt-paste-actions"><button type="button" className="al-btn ghost sm" onClick={() => setPasteText(RULE_TEXT_TEMPLATE)}>Use template</button><button type="button" className="al-btn ghost sm" onClick={copyTemplate}>Copy template</button><button type="button" className="al-btn sm" disabled={extracting} onClick={extractFromText}>{extracting ? 'Extracting...' : 'Extract into fields'}</button></div></div>}
          </div>
          <div className="al-field"><label>Rule name *</label><input required value={form.name} placeholder="Example: Escalate placement guarantee questions" onChange={(e) => setForm({...form,name:e.target.value})} /></div>
          <div className="al-fields"><div className="al-field"><label>AI job</label><select value={form.job} onChange={(e) => setForm({...form,job:e.target.value})}>{JOBS.map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></div><div className="al-field"><label>Channel</label><select value={form.channel} onChange={(e) => setForm({...form,channel:e.target.value})}><option value="all">Email + WhatsApp</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option></select></div><div className="al-field"><label>Audience / brand</label><select value={form.audience} onChange={(e) => setForm({...form,audience:e.target.value})}><option value="">All audiences</option>{audiences.map((a) => <option key={a.code} value={a.code}>{a.label}{a.brand ? ` · ${a.brand}` : ''}</option>)}</select></div></div>
          <div className="al-field"><label>Condition <span>Optional</span></label><textarea value={form.condition_text} placeholder="Example: The lead asks about placement guarantee, refund, or guaranteed salary" onChange={(e) => setForm({...form,condition_text:e.target.value})} /><small className="al-help">Write in plain language. The AI applies the instruction only when this condition matches the current message or campaign context.</small></div>
          <div className="al-field"><label>Instruction *</label><textarea required className="al-prompt-rule-textarea" value={form.instruction_text} placeholder="Example: Do not promise placement. Explain only the approved placement support from the Brain and offer to connect the lead with a mentor." onChange={(e) => setForm({...form,instruction_text:e.target.value})} /></div>
          <div className="al-fields"><div className="al-field"><label>Priority</label><input type="number" min="1" max="999" value={form.priority} onChange={(e) => setForm({...form,priority:Number(e.target.value)})} /><small className="al-help">Lower numbers are applied first.</small></div><label className="al-prompt-toggle"><input type="checkbox" checked={form.active} onChange={(e) => setForm({...form,active:e.target.checked})} /><span>Rule active</span></label></div>
        </div><footer><button type="button" className="al-btn ghost" onClick={() => setEditing(null)}>Cancel</button><button className="al-btn" disabled={saving}>{saving ? 'Saving...' : 'Save rule'}</button></footer>
      </form></div>}

      {deleting && <div className="al-wa-modal-backdrop" role="presentation" onMouseDown={() => setDeleting(null)}><div className="al-wa-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}><div className="al-wa-modal-icon">!</div><h2>Delete {deleting.name}?</h2><p>The AI will stop applying this rule immediately.</p><footer><button className="al-btn ghost" onClick={() => setDeleting(null)}>Cancel</button><button className="al-btn al-wa-confirm-delete" onClick={remove}>Delete rule</button></footer></div></div>}
    </div>
  );
};
