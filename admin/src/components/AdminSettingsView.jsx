import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { FiLock, FiServer } from 'react-icons/fi';
import axiosClient from '../api/axiosClient';
import { FormField, IconInput } from './FormField';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

const EMPTY_PASSWORDS = { currentPassword: '', newPassword: '', confirmPassword: '' };

const StatusDot = ({ ok, children }) => (
  <span className="inline-flex items-center gap-2">
    <span className={`size-2 rounded-full ${ok ? 'bg-green-500' : 'bg-slate-300'}`} />
    {children}
  </span>
);

const AdminSettingsView = ({ userProfile }) => {
  const [systemInfo, setSystemInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwords, setPasswords] = useState(EMPTY_PASSWORDS);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    async function loadSettings() {
      setLoading(true);
      try {
        const res = await axiosClient.get('/admin/settings');
        setSystemInfo(res.data?.system || null);
      } catch (err) {
        // Fallback gracefully
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const set = (key) => (e) => {
    setPasswords((p) => ({ ...p, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    const nextErrors = {};
    if (!passwords.currentPassword) nextErrors.currentPassword = 'Current password is required';
    if (!passwords.newPassword) nextErrors.newPassword = 'New password is required';
    else if (passwords.newPassword.length < 10) nextErrors.newPassword = 'Password must be at least 10 characters';
    if (!passwords.confirmPassword) nextErrors.confirmPassword = 'Please confirm your new password';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    if (passwords.newPassword !== passwords.confirmPassword) {
      toast.error('New password and confirmation do not match');
      return;
    }
    setPasswordLoading(true);
    try {
      const res = await axiosClient.post('/admin/settings/password', {
        currentPassword: passwords.currentPassword,
        newPassword: passwords.newPassword,
      });
      // Changing the password signs out every other session; keep this one
      // with the fresh token the server returns.
      if (res.data?.token) localStorage.setItem('adminToken', res.data.token);
      toast.success('Password updated. Other sessions have been signed out.');
      setPasswords(EMPTY_PASSWORDS);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update password');
    } finally {
      setPasswordLoading(false);
    }
  };

  const rows = [
    {
      label: 'Environment',
      value: (
        <StatusDot ok={systemInfo?.environment === 'production'}>
          {String(systemInfo?.environment || 'development').toUpperCase()}
        </StatusDot>
      ),
    },
    { label: 'Node Runtime', value: systemInfo?.nodeVersion || 'v22.x' },
    { label: 'API Port', value: systemInfo?.port || 3601 },
    { label: 'Email Outbox Mode', value: <Badge variant="info">{systemInfo?.emailDelivery || 'outbox'}</Badge> },
    {
      label: 'MFA Enforcement',
      value: <StatusDot ok={systemInfo?.mfaEnforced}>{systemInfo?.mfaEnforced ? 'Enabled' : 'Disabled (Dev Mode)'}</StatusDot>,
    },
    {
      label: 'Server Uptime',
      value: systemInfo?.uptimeSeconds ? `${Math.floor(systemInfo.uptimeSeconds / 60)} minutes` : 'Active',
    },
  ];

  return (
    <div>
      <div className="mb-5">
        <div className="text-base font-extrabold">Platform Settings & System Configuration</div>
        <div className="text-xs text-slate-400">
          Platform infrastructure diagnostics, server runtime environment, and administrator account security.
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[7fr_5fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <FiServer className="text-blue-600" /> Server Runtime Environment
            </CardTitle>
            {loading && <Spinner className="text-muted-foreground" />}
          </CardHeader>
          <CardContent>
            <dl className="overflow-hidden rounded-lg border border-border">
              {rows.map((row) => (
                <div key={row.label} className="grid grid-cols-[180px_1fr] border-b border-border text-sm last:border-b-0">
                  <dt className="bg-muted/60 px-4 py-3 font-medium text-muted-foreground">{row.label}</dt>
                  <dd className="px-4 py-3">{row.value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <FiLock className="text-blue-600" /> Change Administrator Password
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} noValidate className="flex flex-col gap-4">
              <FormField label="Current Password" htmlFor="currentPassword" error={errors.currentPassword}>
                <IconInput id="currentPassword" type="password" autoComplete="current-password" icon={FiLock} value={passwords.currentPassword} onChange={set('currentPassword')} />
              </FormField>
              <FormField label="New Password" htmlFor="newPassword" error={errors.newPassword}>
                <IconInput id="newPassword" type="password" autoComplete="new-password" icon={FiLock} value={passwords.newPassword} onChange={set('newPassword')} />
              </FormField>
              <FormField label="Confirm New Password" htmlFor="confirmPassword" error={errors.confirmPassword}>
                <IconInput id="confirmPassword" type="password" autoComplete="new-password" icon={FiLock} value={passwords.confirmPassword} onChange={set('confirmPassword')} />
              </FormField>
              <Button type="submit" size="lg" disabled={passwordLoading} className="mt-2 w-full font-semibold">
                {passwordLoading && <Spinner />} Update Admin Password
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AdminSettingsView;
