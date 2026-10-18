import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { FiUser, FiLock, FiAlertTriangle, FiShield } from 'react-icons/fi';
import axiosClient from '../api/axiosClient';
import { FormField, IconInput } from '../components/FormField';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { fullDateTime } from '../utils/time';

const ROLE_NAMES = { founder: 'Admin (Owner)', ops: 'Staff' };

// Same rules the server applies to every password.
function passwordProblem(password, email) {
  if (!password) return 'Choose a password';
  if (password.length < 10) return 'Use at least 10 characters';
  if (password.length > 128) return 'Use at most 128 characters';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Use at least one letter and one number';
  if (password.toLowerCase() === String(email || '').toLowerCase()) return 'Your password cannot be your email address';
  return null;
}

// Opened from the invitation email: the invited person sets their name and
// password, then signs in.
const AcceptInvite = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const [invitation, setInvitation] = useState(null);
  const [problem, setProblem] = useState(null);
  const [values, setValues] = useState({ name: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    axiosClient.get(`/auth/invitations/${encodeURIComponent(token)}`)
      .then(({ data }) => {
        setInvitation(data.invitation);
        setValues((v) => ({ ...v, name: data.invitation?.name || '' }));
      })
      .catch((err) => setProblem(err.response?.data?.error || 'This invitation link could not be opened'));
  }, [token]);

  const set = (key) => (e) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    const preset = invitation.password_preset;
    if (!values.name.trim()) next.name = 'Enter your name';
    if (!preset) {
      const pw = passwordProblem(values.password, invitation.email);
      if (pw) next.password = pw;
      else if (values.password !== values.confirm) next.confirm = 'The passwords do not match';
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    try {
      const { data } = await axiosClient.post('/auth/invitations/accept', {
        token, name: values.name.trim(), ...(preset ? {} : { password: values.password }),
      });
      if (!preset) toast.success('Your account is ready. Sign in with your new password.');
      else if (data.welcome_email_sent === false) toast.warning('Your account is ready, but the login details email could not be sent. Ask your Admin for your password.');
      else toast.success(`Your account is ready. Your login details were emailed to ${invitation.email}.`);
      localStorage.removeItem('adminToken');
      navigate('/login', { replace: true, state: { email: invitation.email } });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not accept the invitation');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-[460px] gap-6 py-8">
        {!invitation && !problem && (
          <CardContent className="flex justify-center py-10"><Spinner className="size-6 text-primary" /></CardContent>
        )}

        {problem && (
          <>
            <CardHeader className="flex-col items-center gap-3 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-amber-50 text-amber-600"><FiAlertTriangle size={24} /></div>
              <CardTitle className="text-xl">Invitation unavailable</CardTitle>
              <CardDescription>{problem}. Ask the person who invited you to send a new invitation.</CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <Button variant="outline" onClick={() => navigate('/login')}>Go to sign in</Button>
            </CardContent>
          </>
        )}

        {invitation && (
          <>
            <CardHeader className="flex-col items-center gap-2 text-center">
              <div className="mb-1 flex size-12 items-center justify-center rounded-xl bg-blue-50 text-primary"><FiShield size={24} /></div>
              <CardTitle className="text-xl">Join the admin panel</CardTitle>
              <CardDescription>
                You were invited as <b className="text-foreground">{ROLE_NAMES[invitation.role] || invitation.role}</b>.{' '}
                {invitation.password_preset ? 'Accept to activate your account. Your login details arrive by email.' : 'Set your password to finish.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-8">
              <form onSubmit={submit} noValidate className="flex flex-col gap-4">
                <FormField label="Email">
                  <div className="flex h-10 items-center rounded-md border border-border bg-muted/50 px-3 text-sm text-muted-foreground">{invitation.email}</div>
                </FormField>
                <FormField label="Your name" htmlFor="accept-name" error={errors.name}>
                  <IconInput id="accept-name" icon={FiUser} autoComplete="name" value={values.name} onChange={set('name')} />
                </FormField>
                {!invitation.password_preset && (<>
                <FormField label="Password" htmlFor="accept-password" error={errors.password} hint="At least 10 characters with a letter and a number.">
                  <IconInput id="accept-password" type="password" icon={FiLock} autoComplete="new-password" value={values.password} onChange={set('password')} />
                </FormField>
                <FormField label="Confirm password" htmlFor="accept-confirm" error={errors.confirm}>
                  <IconInput id="accept-confirm" type="password" icon={FiLock} autoComplete="new-password" value={values.confirm} onChange={set('confirm')} />
                </FormField>
                </>)}
                <Button type="submit" size="lg" disabled={saving} className="mt-2 h-11 w-full font-semibold">
                  {saving && <Spinner />} {invitation.password_preset ? 'Accept invitation' : 'Create my account'}
                </Button>
                <p className="text-center text-xs text-muted-foreground">This link expires {fullDateTime(invitation.expires_at)}.</p>
              </form>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
};

export default AcceptInvite;
