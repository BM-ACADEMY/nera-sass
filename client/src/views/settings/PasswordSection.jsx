import { useState } from 'react';
import toast from 'react-hot-toast';
import { FiLock, FiLogOut } from 'react-icons/fi';
import { api } from '../../services/api.js';
import { SettingsPageHeader, FormRow } from './SettingsKit.jsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

// Change password and "sign out of all devices" through the existing auth endpoints.
export const PasswordSection = ({ onSignedOutEverywhere }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const changePassword = async (event) => {
    event.preventDefault();
    if (!current || !next) return toast.error('Enter your current password and a new one.');
    setSavingPassword(true);
    try {
      // The API stores the fresh token, so this session stays signed in;
      // every other session is signed out by the server.
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      toast.success('Password changed. You have been signed out on your other devices.', { duration: 6000 });
    } catch (error) {
      toast.error(error.message || 'Could not change the password. Please try again.');
    } finally {
      setSavingPassword(false);
    }
  };

  const signOutEverywhere = async () => {
    if (!window.confirm('Sign out of all devices, including this one? You will need to sign in again.')) return;
    setSigningOut(true);
    try {
      await api.logoutAll();
      onSignedOutEverywhere?.();
    } catch (error) {
      toast.error(error.message || 'Could not sign out of all devices. Please try again.');
      setSigningOut(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <SettingsPageHeader section="password" />
      <div className="flex flex-col gap-5">
        <Card className="gap-4">
          <CardHeader className="block"><CardTitle>Change password</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={changePassword} className="flex flex-col gap-4">
              <FormRow label="Current password" htmlFor="current-password">
                <Input id="current-password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
              </FormRow>
              <FormRow label="New password" htmlFor="new-password">
                <Input id="new-password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
              </FormRow>
              <div className="flex justify-end">
                <Button type="submit" disabled={savingPassword}>{savingPassword ? <Spinner /> : <FiLock />} Update password</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="gap-4">
          <CardHeader className="block">
            <CardTitle>Sessions</CardTitle>
            <CardDescription className="mt-1">Signs you out everywhere, including this browser. You will need to sign in again.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700" disabled={signingOut} onClick={signOutEverywhere}>
              {signingOut ? <Spinner /> : <FiLogOut />} Sign out of all devices
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
