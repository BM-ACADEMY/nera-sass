import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FiUser, FiPhone, FiMail, FiLock, FiClock } from 'react-icons/fi';
import axiosClient from '../../api/axiosClient';
import { FormField, IconInput } from '../FormField';
import UserAvatar from '../UserAvatar';
import { SettingsPageHeader } from './SettingsPageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

const ROLE_NAMES = { founder: 'Admin (Owner)', ops: 'Staff' };
const when = (value) => (value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never');

const ProfileSettings = ({ account, userProfile, onSaved }) => {
  const source = account || userProfile;
  const [form, setForm] = useState({ name: '', phone: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (source) setForm({ name: source.name || '', phone: source.phone || '' });
  }, [source?.name, source?.phone]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = source && (form.name !== (source.name || '') || form.phone !== (source.phone || ''));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await axiosClient.patch('/auth/profile', { name: form.name, phone: form.phone });
      toast.success('Profile saved');
      onSaved?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not save the profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-6xl">
      <SettingsPageHeader section="profile" />
      <div className="grid gap-5 md:grid-cols-[240px_1fr]">
        <Card className="items-center gap-3 py-6 text-center">
          <UserAvatar name={source?.name} role={source?.staff_role} size={72} />
          <div className="px-4">
            <div className="font-bold">{source?.name || '—'}</div>
            <div className="text-xs break-all text-muted-foreground">{source?.email}</div>
          </div>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">{ROLE_NAMES[source?.staff_role] || 'Staff'}</span>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><FiClock /> Last sign-in: {when(account?.last_login)}</div>
        </Card>

        <Card>
          <CardContent>
            <form onSubmit={save} className="flex flex-col gap-4">
              <FormField label="Full name" htmlFor="name">
                <IconInput id="name" icon={FiUser} value={form.name} maxLength={80} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </FormField>
              <FormField label="Phone number" htmlFor="phone" hint="With country code, for example +91 98765 43210">
                <IconInput id="phone" icon={FiPhone} value={form.phone} maxLength={20} placeholder="+91" onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </FormField>
              <FormField label="Sign-in email" htmlFor="email" hint="Your login. Ask the Admin (Owner) to change it.">
                <div className="relative">
                  <IconInput id="email" icon={FiMail} value={source?.email || ''} readOnly disabled className="pr-9" />
                  <FiLock className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground" />
                </div>
              </FormField>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" disabled={!dirty || saving} onClick={() => setForm({ name: source?.name || '', phone: source?.phone || '' })}>Cancel</Button>
                <Button type="submit" disabled={!dirty || saving}>{saving && <Spinner />} Save changes</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ProfileSettings;
