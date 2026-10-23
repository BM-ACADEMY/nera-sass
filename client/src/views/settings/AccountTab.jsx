import { useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../services/api.js';
import { roleLabel } from './settingsPolicy.js';
import { MfaEnrollment } from './MfaEnrollment.jsx';
import { SectionTitle, SubTitle, Field, ReadOnly, Button, Notice, Actions, Divider } from './ui.jsx';
import { inputStyle } from './styles.js';

// Account: GET /api/auth/me; change password, two-factor enrolment and
// "sign out of all devices" through the existing auth endpoints.
export const AccountTab = ({ me, onChanged, onSignedOutEverywhere }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const changePassword = async (event) => {
    event.preventDefault();
    if (!current || !next) return toast.error('Enter your current and new password');
    setSavingPassword(true);
    try {
      // The API stores the fresh token, so this session stays signed in;
      // every other session is signed out by the server.
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      toast.success('Password changed. You have been signed out on your other devices.', { duration: 6000 });
    } catch (error) {
      toast.error(error.message || 'Could not change the password');
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
      toast.error(error.message || 'Could not sign out of all devices');
      setSigningOut(false);
    }
  };

  return (
    <div>
      <SectionTitle>Account</SectionTitle>
      <ReadOnly label="Name" value={me?.name} />
      <ReadOnly label="Email" value={me?.email} />
      <ReadOnly label="Role" value={roleLabel(me?.role)} />

      <Divider />
      <form onSubmit={changePassword}>
        <SubTitle>Change password</SubTitle>
        <Field label="Current password">
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} style={inputStyle()} />
        </Field>
        <Field label="New password">
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} style={inputStyle()} />
        </Field>
        <Actions><Button type="submit" busy={savingPassword}>{savingPassword ? 'Updating…' : 'Update password'}</Button></Actions>
      </form>

      <Divider />
      <SubTitle>Two-factor authentication</SubTitle>
      {me?.mfa_enabled ? (
        <Notice tone="ok">Two-factor authentication is on. You will be asked for a code when you sign in.</Notice>
      ) : enrolling ? (
        <MfaEnrollment
          onDone={() => { setEnrolling(false); onChanged?.(); }}
          onCancel={() => setEnrolling(false)}
        />
      ) : (
        <>
          <Notice tone="muted">Two-factor authentication is off.</Notice>
          <Button type="button" onClick={() => setEnrolling(true)}>Turn on two-factor authentication</Button>
        </>
      )}

      <Divider />
      <SubTitle>Sessions</SubTitle>
      <p style={{ fontSize: 12, marginBottom: 12 }}>Signs you out everywhere, including this browser. You will need to sign in again.</p>
      <Button type="button" variant="danger" busy={signingOut} onClick={signOutEverywhere}>
        {signingOut ? 'Signing out…' : 'Sign out of all devices'}
      </Button>
    </div>
  );
};
