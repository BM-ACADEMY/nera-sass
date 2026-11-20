import { useState } from 'react';
import toast from 'react-hot-toast';
import { FiGlobe, FiInfo } from 'react-icons/fi';
import { api } from '../../services/api.js';
import { canEditWorkspace, roleLabel, workspaceInfo, languageOptions } from './settingsPolicy.js';
import { SettingsPageHeader, InfoList, FormRow, Callout } from './SettingsKit.jsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';

// Profile & workspace: who is signed in and the workspace facts, read-only.
// The only workspace setting a customer changes is the language
// (PATCH /api/tenant/settings, owner/admin); the rest is set by the Getnera team.
export const ProfileSection = ({ tenantInfo, me, onSaved }) => {
  const tenant = tenantInfo?.tenant || {};
  const editable = canEditWorkspace(tenantInfo?.permissions);
  const [language, setLanguage] = useState(tenant.language || 'en');
  const [saving, setSaving] = useState(false);
  const dirty = language !== (tenant.language || 'en');

  const save = async (event) => {
    event.preventDefault();
    if (!dirty) return;
    setSaving(true);
    try {
      await api.updateTenantSettings({ language });
      toast.success('Language saved');
      onSaved?.();
    } catch (error) {
      toast.error(error.message || 'Could not save the language. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-6xl">
      <SettingsPageHeader section="profile" />
      <div className="grid gap-5 md:grid-cols-[240px_1fr]">
        <Card className="items-center gap-3 self-start py-6 text-center">
          <span className="flex size-[72px] items-center justify-center rounded-full bg-blue-100 text-2xl font-extrabold text-blue-700">
            {me?.name ? me.name.trim()[0].toUpperCase() : 'U'}
          </span>
          <div className="px-4">
            <div className="font-bold">{me?.name || '—'}</div>
            <div className="text-xs break-all text-muted-foreground">{me?.email}</div>
          </div>
          {roleLabel(me?.role) && <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">{roleLabel(me.role)}</span>}
        </Card>

        <div className="flex flex-col gap-5">
          <Card className="gap-3">
            <CardHeader className="block">
              <CardTitle>Workspace</CardTitle>
              <CardDescription className="mt-1">Set up by the Getnera team. Contact support if anything here needs to change.</CardDescription>
            </CardHeader>
            <CardContent>
              <InfoList rows={workspaceInfo(tenantInfo).map((row) => ({ ...row, locked: true, mono: row.key === 'id' }))} />
            </CardContent>
          </Card>

          <Card className="gap-3">
            <CardHeader className="block">
              <CardTitle>Language</CardTitle>
              <CardDescription className="mt-1">Used for automatic WhatsApp follow-up messages.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={save} className="flex flex-col gap-4">
                {!editable && <Callout><FiInfo className="mr-1 inline" /> Only the workspace Owner or an Admin can change the language.</Callout>}
                <FormRow label="Language" htmlFor="language">
                  <Select value={language} onValueChange={setLanguage} disabled={!editable}>
                    <SelectTrigger id="language" className="sm:max-w-xs"><FiGlobe className="text-muted-foreground" /><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {languageOptions(tenant.language).map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormRow>
                {editable && (
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" disabled={!dirty || saving} onClick={() => setLanguage(tenant.language || 'en')}>Cancel</Button>
                    <Button type="submit" disabled={!dirty || saving}>{saving && <Spinner />} Save changes</Button>
                  </div>
                )}
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};
