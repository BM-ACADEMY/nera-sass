import { useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../services/api.js';
import { canEditWorkspace } from './settingsPolicy.js';
import { SectionTitle, Field, ReadOnly, Button, Notice, Actions } from './ui.jsx';
import { inputStyle } from './styles.js';

const SETTING_FIELDS = [
  ['language', 'Language', 'en'],
  ['currency', 'Currency', 'INR'],
  ['timezone', 'Timezone', 'Asia/Kolkata'],
  ['tax_treatment', 'Tax treatment', ''],
];

// Workspace: GET /api/tenant (all roles); PATCH /api/tenant/settings
// (owner/admin). The workspace comes from the session, never the browser.
export const WorkspaceTab = ({ tenantInfo, onSaved }) => {
  const tenant = tenantInfo?.tenant || {};
  const editable = canEditWorkspace(tenantInfo?.permissions);
  // Initial values from the loaded workspace; the page remounts this tab after each reload.
  const [values, setValues] = useState(() => Object.fromEntries(SETTING_FIELDS.map(([key]) => [key, tenant[key] || ''])));
  const [saving, setSaving] = useState(false);

  const save = async (event) => {
    event.preventDefault();
    const changes = Object.fromEntries(Object.entries(values).filter(([key, value]) => value.trim() && value !== (tenant[key] || '')));
    if (!Object.keys(changes).length) return toast('Nothing to save');
    setSaving(true);
    try {
      await api.updateTenantSettings(changes);
      toast.success('Workspace settings saved');
      onSaved?.();
    } catch (error) {
      toast.error(error.message || 'Could not save workspace settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save}>
      <SectionTitle>Workspace</SectionTitle>
      {!editable && <Notice tone="muted">Only the workspace Owner or an Admin can change these settings.</Notice>}
      <ReadOnly label="Workspace name" value={tenant.name} />
      <ReadOnly label="Status" value={tenantInfo?.lifecycle?.state} />
      {SETTING_FIELDS.map(([key, label, placeholder]) => (
        <Field key={key} label={label}>
          <input
            value={values[key] || ''}
            onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            placeholder={placeholder}
            readOnly={!editable}
            maxLength={40}
            style={inputStyle(editable)}
          />
        </Field>
      ))}
      {editable && <Actions><Button type="submit" busy={saving}>{saving ? 'Saving…' : 'Save workspace settings'}</Button></Actions>}
    </form>
  );
};
