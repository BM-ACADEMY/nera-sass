import { useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../services/api.js';
import { canEditBrand, profileSaveMessage, normalizeWebsite } from './settingsPolicy.js';
import { SectionTitle, Field, Button, Notice, Actions } from './ui.jsx';
import { inputStyle } from './styles.js';

const CATEGORIES = ['Matrimonial service', 'Finance and banking', 'Food and groceries', 'Alcoholic drinks', 'Government', 'Hotel and lodging',
  'Medical and health', 'Over-the-counter medicine', 'Charity', 'Professional services', 'Shopping and retail',
  'Travel and transportation', 'Restaurant', 'OTHER'];

const FIELDS = ['name', 'wa_category', 'wa_description', 'wa_address', 'wa_email', 'wa_website', 'status'];

// Brand Profile: the workspace's one brand (GET /api/clients, sanitised);
// PATCH /api/clients/:id with profile fields only (owner/admin). WhatsApp
// credentials are never edited here.
export const BrandProfileTab = ({ brand, tenantInfo, onSaved }) => {
  const editable = canEditBrand(tenantInfo?.permissions);
  // Initial values from the loaded brand; the page remounts this tab after each reload.
  const [values, setValues] = useState(() => Object.fromEntries(FIELDS.map((key) => [key, brand?.[key] ?? ''])));
  const [saving, setSaving] = useState(false);

  if (!brand) {
    return (
      <div>
        <SectionTitle>Brand Profile</SectionTitle>
        <Notice tone="muted">Your workspace has no brand profile yet. Contact support to set it up.</Notice>
      </div>
    );
  }

  const save = async (event) => {
    event.preventDefault();
    if (!String(values.name || '').trim()) return toast.error('Business name is required');
    const changes = Object.fromEntries(FIELDS.filter((key) => String(values[key] ?? '') !== String(brand[key] ?? '')).map((key) => [key, values[key]]));
    if (!Object.keys(changes).length) return toast('Nothing to save');
    // Only fields being changed are checked, so an existing legacy value never
    // blocks saving something else. The server applies the same website rule.
    if (changes.wa_website !== undefined) {
      const website = normalizeWebsite(changes.wa_website);
      if (!website.ok) return toast.error('Enter a valid website, for example https://example.com');
      changes.wa_website = website.value;
    }
    if (changes.wa_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(changes.wa_email).trim())) {
      return toast.error('Enter a valid email address');
    }
    setSaving(true);
    try {
      const result = await api.updateClient(brand.id, changes);
      toast.success(profileSaveMessage(result), { duration: 6000 });
      onSaved?.();
    } catch (error) {
      toast.error(error.message || 'Could not save the brand profile');
    } finally {
      setSaving(false);
    }
  };

  const text = (key, label, props = {}) => (
    <Field label={label}>
      <input value={values[key] || ''} onChange={(e) => setValues({ ...values, [key]: e.target.value })} readOnly={!editable} style={inputStyle(editable)} {...props} />
    </Field>
  );

  return (
    // noValidate: the browser's own URL/email checks would block saving
    // unrelated fields when a stored legacy value does not match them.
    <form onSubmit={save} noValidate>
      <SectionTitle>Brand Profile</SectionTitle>
      {!editable && <Notice tone="muted">Only the workspace Owner or an Admin can change the brand profile.</Notice>}
      {text('name', 'Business name', { maxLength: 120 })}
      <Field label="Category">
        <select value={values.wa_category || 'OTHER'} onChange={(e) => setValues({ ...values, wa_category: e.target.value })} disabled={!editable} style={inputStyle(editable)}>
          {CATEGORIES.map((value) => <option key={value} value={value}>{value === 'OTHER' ? 'Other' : value}</option>)}
        </select>
      </Field>
      <Field label="Description" hint="Shown on your WhatsApp business profile once WhatsApp is connected.">
        <textarea value={values.wa_description || ''} onChange={(e) => setValues({ ...values, wa_description: e.target.value })} readOnly={!editable} rows={3} maxLength={512} style={{ ...inputStyle(editable), resize: 'vertical' }} />
      </Field>
      {text('wa_address', 'Address', { maxLength: 256 })}
      {text('wa_email', 'Email', { type: 'text', inputMode: 'email', autoComplete: 'email', maxLength: 128 })}
      {text('wa_website', 'Website', { type: 'text', inputMode: 'url', maxLength: 256, placeholder: 'https://example.com' })}
      <Field label="Automated replies">
        <select value={values.status || 'active'} onChange={(e) => setValues({ ...values, status: e.target.value })} disabled={!editable} style={inputStyle(editable)}>
          <option value="active">Active: incoming WhatsApp messages go to the AI Brain</option>
          <option value="inactive">Paused: AI auto-replies are off</option>
        </select>
      </Field>
      {editable && <Actions><Button type="submit" busy={saving}>{saving ? 'Saving…' : 'Save brand profile'}</Button></Actions>}
    </form>
  );
};
