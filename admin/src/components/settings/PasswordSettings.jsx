import React, { useState } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { FiLock, FiLogOut } from 'react-icons/fi';
import axiosClient from '../../api/axiosClient';
import { FormField } from '../FormField';
import ConfirmDialog from '../ConfirmDialog';
import { SettingsPageHeader } from './SettingsPageHeader';
import PasswordInput from '../security/PasswordInput';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

const EMPTY = { current: '', next: '', confirm: '' };

// Rough strength from length and character variety; the server applies the real rules.
const strength = (pw) => {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 10) score += 1;
  if (pw.length >= 14) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score += 1;
  return score;
};
const LEVELS = [
  { label: 'Too short', bar: 'bg-red-400' },
  { label: 'Weak', bar: 'bg-red-400' },
  { label: 'Fair', bar: 'bg-amber-400' },
  { label: 'Good', bar: 'bg-lime-500' },
  { label: 'Strong', bar: 'bg-emerald-500' },
];

const PasswordSettings = () => {
  const navigate = useNavigate();
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const score = strength(values.next);

  const set = (key) => (e) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!values.current) next.current = 'Enter your current password';
    if (values.next.length < 10) next.next = 'Use at least 10 characters';
    if (values.confirm !== values.next) next.confirm = 'The passwords do not match';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      const res = await axiosClient.post('/admin/settings/password', { currentPassword: values.current, newPassword: values.next });
      if (res.data?.token) localStorage.setItem('adminToken', res.data.token);
      toast.success('Password changed. Other devices were signed out.');
      setValues(EMPTY);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not change the password');
    } finally {
      setSaving(false);
    }
  };

  const logoutEverywhere = async () => {
    await axiosClient.post('/auth/logout-all');
    localStorage.removeItem('adminToken');
    toast.success('Signed out of every device');
    navigate('/login');
  };

  return (
    <div className="max-w-6xl">
      <SettingsPageHeader section="password" />
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm"><FiLock className="text-amber-600" /> Change password</CardTitle>
            <CardDescription>Changing it signs you out on every other device.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} noValidate className="flex max-w-md flex-col gap-4">
              <FormField label="Current password" htmlFor="current" error={errors.current}>
                <PasswordInput id="current" autoComplete="current-password" value={values.current} onChange={set('current')} />
              </FormField>
              <FormField label="New password" htmlFor="next" error={errors.next}>
                <PasswordInput id="next" autoComplete="new-password" value={values.next} onChange={set('next')} />
                {values.next && (
                  <div className="flex items-center gap-2">
                    <div className="flex flex-1 gap-1">
                      {[1, 2, 3, 4].map((i) => <span key={i} className={cn('h-1.5 flex-1 rounded-full', i <= score ? LEVELS[score].bar : 'bg-slate-200')} />)}
                    </div>
                    <span className="w-14 text-right text-xs text-muted-foreground">{LEVELS[score].label}</span>
                  </div>
                )}
              </FormField>
              <FormField label="Confirm new password" htmlFor="confirm" error={errors.confirm}>
                <PasswordInput id="confirm" autoComplete="new-password" value={values.confirm} onChange={set('confirm')} />
              </FormField>
              <Button type="submit" disabled={saving} className="mt-1 w-fit">{saving && <Spinner />} Update password</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm"><FiLogOut className="text-rose-600" /> Sign out everywhere</CardTitle>
            <CardDescription>Lost a laptop or signed in on a shared computer? End every session, including this one.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => setConfirmLogout(true)}>
              <FiLogOut /> Sign out of all devices
            </Button>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        confirm={confirmLogout ? {
          title: 'Sign out of all devices?',
          description: 'Every session ends, including this one. You will sign in again with your password and two-step code.',
          actionLabel: 'Sign out everywhere',
          destructive: true,
          run: logoutEverywhere,
        } : null}
        onClose={() => setConfirmLogout(false)}
      />
    </div>
  );
};

export default PasswordSettings;
