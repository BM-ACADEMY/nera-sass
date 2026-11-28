import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FiUsers, FiUserPlus, FiKey, FiSlash, FiCheckCircle, FiShield } from 'react-icons/fi';
import axiosClient from '../../api/axiosClient';
import ConfirmDialog from '../ConfirmDialog';
import { FormField } from '../FormField';
import UserAvatar from '../UserAvatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { relativeTime, fullDateTime } from '../../utils/time';

const apiError = (err, fallback) => err.response?.data?.error || fallback;
// Customer roles (server permissions.TENANT_ROLES). New Admins and Staff get the
// default sections; the workspace Owner changes them in the app's Team page.
const ROLES = [['owner', 'Owner'], ['admin', 'Admin'], ['staff', 'Staff']];
const RETIRED_ROLES = { manager: 'Staff', agent: 'Staff' };
const roleName = (role) => (ROLES.find(([value]) => value === role) || [null, RETIRED_ROLES[role] || role || '—'])[1];

// Same rules as server/utils/passwordPolicy.js.
const passwordProblem = (password, email) => {
  if (!password || password.length < 10) return 'Use at least 10 characters';
  if (password.length > 128) return 'Use at most 128 characters';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Use at least one letter and one number';
  if (email && password.toLowerCase() === email.trim().toLowerCase()) return 'The password cannot be the email address';
  return null;
};

const SHARE = 'Share it with them yourself. They must choose their own password when they first sign in.';

// Add a user to the workspace: an invitation email, or a temporary password
// they must change at first sign-in. Same rules and seat check as the
// customer's Settings > Team (POST /api/admin/tenants/:id/users).
function AddUserDialog({ open, onOpenChange, tenantId, onSaved }) {
  const empty = { name: '', email: '', phone: '', role: 'staff', method: 'invite', password: '' };
  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setValues(empty); setErrors({}); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: typeof e === 'string' ? e : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (values.name.trim().length < 2) next.name = 'Enter their name';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) next.email = 'Enter a valid email';
    if (values.phone.trim() && !/^\+?[0-9 ()-]{7,20}$/.test(values.phone.trim())) next.phone = 'Enter a valid phone number';
    if (values.method === 'password') {
      const problem = passwordProblem(values.password, values.email);
      if (problem) next.password = problem;
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      const body = { name: values.name.trim(), email: values.email.trim(), phone: values.phone.trim() || null, role: values.role, method: values.method };
      if (values.method === 'password') body.password = values.password;
      const res = await axiosClient.post(`/admin/tenants/${tenantId}/users`, body);
      if (values.method === 'invite') {
        toast[res.data.delivery?.delivered === false ? 'warning' : 'success'](res.data.delivery?.delivered === false ? 'Invitation created, but the email was not sent' : `Invitation sent to ${body.email}`);
      } else if (res.data.delivery?.delivered) {
        toast.success(`User added and emailed how to sign in (without the password). ${SHARE}`);
      } else {
        toast.warning(`User added, but the email was not sent. ${SHARE}`);
      }
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      toast.error(apiError(err, 'Failed to add the user'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>Adds a login to this workspace. It uses one of the workspace's seats.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Name" htmlFor="au-name" error={errors.name}><Input id="au-name" value={values.name} onChange={set('name')} /></FormField>
            <FormField label="Email" htmlFor="au-email" error={errors.email}><Input id="au-email" type="email" value={values.email} onChange={set('email')} /></FormField>
            <FormField label="Phone (optional)" htmlFor="au-phone" error={errors.phone}><Input id="au-phone" type="tel" value={values.phone} onChange={set('phone')} placeholder="+91 98765 43210" /></FormField>
            <FormField label="Role" htmlFor="au-role">
              <Select value={values.role} onValueChange={set('role')}>
                <SelectTrigger id="au-role" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
            </FormField>
          </div>
          <div className="flex flex-col gap-2">
            {[
              ['invite', 'Send an invitation email', 'They choose their own password from a one-time link.'],
              ['password', 'Set a temporary password', 'They must change it when they first sign in.'],
            ].map(([value, title, text]) => (
              <label key={value} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3', values.method === value ? 'border-primary bg-primary/5' : 'border-border')}>
                <input type="radio" name="au-method" value={value} checked={values.method === value} onChange={() => set('method')(value)} className="mt-1" />
                <span><span className="block text-sm font-semibold">{title}</span><span className="block text-xs text-muted-foreground">{text}</span></span>
              </label>
            ))}
          </div>
          {values.method === 'password' && (
            <FormField label="Temporary password" htmlFor="au-password" error={errors.password} hint="At least 10 characters, with a letter and a number.">
              <Input id="au-password" type="password" autoComplete="new-password" value={values.password} onChange={set('password')} />
            </FormField>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? <Spinner /> : <FiUserPlus />} Add user</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose, onSaved }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setPassword(''); setError(''); }, [user]);

  const submit = async (e) => {
    e.preventDefault();
    const problem = passwordProblem(password, user?.email);
    if (problem) return setError(problem);
    setSaving(true);
    try {
      await axiosClient.post(`/admin/users/${user.id}/reset-password`, { password });
      toast.success(`Temporary password set. ${SHARE}`);
      onClose();
      onSaved?.();
    } catch (err) {
      toast.error(apiError(err, 'Failed to reset the password'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(user)} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Reset password for {user?.name || user?.email}</DialogTitle>
            <DialogDescription>They are signed out everywhere and must choose their own password at the next sign-in.</DialogDescription>
          </DialogHeader>
          <FormField label="Temporary password" htmlFor="rp-password" error={error} hint="At least 10 characters, with a letter and a number.">
            <Input id="rp-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? <Spinner /> : <FiKey />} Set temporary password</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Everyone with a login to this workspace: add a user, and per user disable /
// enable and reset the password.
const TeamCard = ({ tenantId, users = [], invitations = [], seats, onChanged }) => {
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const act = (request, success, failure) => async () => {
    try {
      await request();
      toast.success(success);
      await onChanged?.();
    } catch (err) {
      toast.error(apiError(err, failure));
      throw err;
    }
  };

  return (
    <Card className="gap-4">
      <CardHeader className="px-4 sm:px-6">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-[15px]"><FiUsers className="text-primary" /> Users</CardTitle>
          <CardDescription className="mt-1 text-xs">
            Everyone who can sign in to this workspace{seats?.limit ? ` · ${seats.used} of ${seats.limit} seats used` : ''}.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setAdding(true)}><FiUserPlus /> Add user</Button>
      </CardHeader>
      <CardContent className="px-4 sm:px-6">
        {users.length === 0 && invitations.length === 0 ? (
          <div className="py-4 text-sm text-muted-foreground">No users yet.</div>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {users.map((u) => {
              const who = u.name || u.email;
              return (
                <li key={`u${u.id}`} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <UserAvatar name={u.name} role="customer" size={36} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{who}</div>
                      <div className="truncate text-xs text-muted-foreground">{u.email}{u.phone ? ` · ${u.phone}` : ''}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="muted">{roleName(u.role)}</Badge>
                    <Badge variant={u.is_active ? (u.must_change_password ? 'warning' : 'success') : 'danger'}>
                      {u.is_active ? (u.must_change_password ? 'Temporary password' : 'Active') : 'Disabled'}
                    </Badge>
                    <Badge variant={u.mfa_enabled ? 'success' : 'muted'}><FiShield /> {u.mfa_enabled ? '2-step on' : '2-step off'}</Badge>
                    <span className="text-xs text-muted-foreground" title={fullDateTime(u.last_login)}>{relativeTime(u.last_login) || 'Never signed in'}</span>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="outline" onClick={() => setResetting(u)}><FiKey /> Reset password</Button>
                    {u.is_active ? (
                      <Button size="sm" variant="outline" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setConfirm({
                        title: `Disable ${who}?`,
                        description: 'They are signed out now and cannot sign in until enabled again. No data is deleted.',
                        actionLabel: 'Disable',
                        destructive: true,
                        run: act(() => axiosClient.post(`/admin/users/${u.id}/deactivate`), 'User disabled', 'Failed to disable'),
                      })}><FiSlash /> Disable</Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setConfirm({
                        title: `Enable ${who}?`,
                        description: 'They can sign in again with their password. This uses a seat.',
                        actionLabel: 'Enable',
                        run: act(() => axiosClient.post(`/admin/users/${u.id}/reactivate`), 'User enabled', 'Failed to enable'),
                      })}><FiCheckCircle /> Enable</Button>
                    )}
                  </div>
                </li>
              );
            })}
            {invitations.map((inv) => (
              <li key={`i${inv.id}`} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{inv.name || inv.email}</div>
                  <div className="truncate text-xs text-muted-foreground">{inv.email}</div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="muted">{roleName(inv.role)}</Badge>
                  <Badge variant={inv.status === 'expired' ? 'danger' : 'info'}>{inv.status === 'expired' ? 'Invite expired' : 'Invite sent'}</Badge>
                  <span className="text-xs text-muted-foreground">Expires {relativeTime(inv.expires_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <AddUserDialog open={adding} onOpenChange={setAdding} tenantId={tenantId} onSaved={onChanged} />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} onSaved={onChanged} />
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </Card>
  );
};

export default TeamCard;
