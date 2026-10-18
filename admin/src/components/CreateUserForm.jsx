import React, { useState } from 'react';
import { toast } from 'sonner';
import { FiUser, FiMail } from 'react-icons/fi';
import axiosClient from '../api/axiosClient';
import { FormField, IconInput } from './FormField';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ROLE_OPTIONS = [
  { value: 'owner', label: 'Owner (Full Access & Billing)' },
  { value: 'admin', label: 'Admin (Workspace Management)' },
  { value: 'manager', label: 'Manager (Team Management)' },
  { value: 'agent', label: 'Agent (Standard Access)' },
];

const INITIAL = { tenant_id: '', name: '', email: '', role: 'agent' };

// Invites a user into an existing workspace. The invited person receives a
// one-time link and sets their own password; staff never choose or see it.
const CreateUserForm = ({ onUserCreated, onCancel, tenants = [] }) => {
  const [values, setValues] = useState(INITIAL);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const set = (key, value) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const validate = () => {
    const next = {};
    if (!values.tenant_id) next.tenant_id = 'Choose the workspace this user belongs to';
    if (!EMAIL_RE.test(values.email.trim())) next.email = 'A valid email is required';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await axiosClient.post('/admin/users', {
        tenant_id: Number(values.tenant_id),
        name: values.name || undefined,
        email: values.email.trim(),
        role: values.role,
      });
      if (res.data?.delivery?.delivered === false) {
        toast.warning('Invitation created, but the email could not be sent. Resend it from the workspace once email is configured.');
      } else {
        toast.success(`Invitation sent to ${values.email.trim()}`);
      }
      setValues(INITIAL);
      if (onUserCreated) onUserCreated();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send invitation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center gap-3 border-b border-border pb-4 pr-6">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          <FiUser size={20} />
        </div>
        <div>
          <div className="text-base font-extrabold">Invite Workspace User</div>
          <div className="text-xs text-slate-400">The user receives an email link and sets their own password. The workspace's plan user limit applies.</div>
        </div>
      </div>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormField label="Workspace" error={errors.tenant_id}>
          <Select value={values.tenant_id} onValueChange={(v) => set('tenant_id', v)} disabled={!tenants.length}>
            <SelectTrigger size="lg">
              <SelectValue placeholder={tenants.length ? 'Select workspace' : 'Create a workspace first'} />
            </SelectTrigger>
            <SelectContent>
              {tenants.map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>{t.name} (ID: #{t.id})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField label="Name" htmlFor="invite-name">
          <IconInput id="invite-name" icon={FiUser} placeholder="Full name (optional)" value={values.name} onChange={(e) => set('name', e.target.value)} />
        </FormField>

        <FormField label="Email" htmlFor="invite-email" error={errors.email}>
          <IconInput id="invite-email" type="email" icon={FiMail} placeholder="Enter email address" value={values.email} onChange={(e) => set('email', e.target.value)} aria-invalid={Boolean(errors.email)} />
        </FormField>

        <FormField label="Workspace Role">
          <Select value={values.role} onValueChange={(v) => set('role', v)}>
            <SelectTrigger size="lg"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </FormField>

        <div className="mt-3 flex justify-end gap-2.5">
          {onCancel && <Button type="button" variant="outline" size="lg" onClick={onCancel}>Cancel</Button>}
          <Button type="submit" size="lg" disabled={loading || !tenants.length}>
            {loading && <Spinner />} Send Invitation
          </Button>
        </div>
      </form>
    </div>
  );
};

export default CreateUserForm;
