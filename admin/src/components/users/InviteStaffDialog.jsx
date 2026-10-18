import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FiMail, FiUser, FiCheckCircle, FiAlertTriangle, FiLock, FiEye, FiEyeOff, FiRefreshCw } from 'react-icons/fi';
import axiosClient from '../../api/axiosClient';
import { FormField, IconInput } from '../FormField';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { fullDateTime } from '../../utils/time';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Letters and digits without look-alike characters, always with both.
const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function generatePassword(length = 14) {
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  let out = Array.from(bytes, (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join('');
  if (!/\d/.test(out)) out = out.slice(0, -1) + '7';
  if (!/[A-Za-z]/.test(out)) out = 'K' + out.slice(1);
  return out;
}

// Same rules the server applies to every password.
function passwordProblem(password, email) {
  if (!password) return 'Set a password for them';
  if (password.length < 10) return 'Use at least 10 characters';
  if (password.length > 128) return 'Use at most 128 characters';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Use at least one letter and one number';
  if (password.toLowerCase() === email.trim().toLowerCase()) return 'The password cannot be their email';
  return null;
}

export const STAFF_ROLE_OPTIONS = [
  { value: 'ops', label: 'Staff', description: 'Workspaces, customers, WhatsApp numbers and reports. No billing and no team changes.' },
  { value: 'founder', label: 'Admin (Owner)', description: 'Full access, including billing, creating workspaces and managing the team.' },
];

// What happened to the email, in words: sent, kept in the local dev outbox, or failed.
export function deliveryNotice(delivery) {
  if (!delivery || delivery.delivered === false) {
    return { ok: false, text: 'The email could not be sent. Check the server email settings, then use Resend from Pending invitations.' };
  }
  if (delivery.mode === 'outbox') {
    return { ok: false, text: 'Email is not configured on this server, so the email was saved to server/.dev-outbox instead of being sent.' };
  }
  return { ok: true, text: null };
}

const InviteStaffDialog = ({ open, onOpenChange, onInvited }) => {
  const [values, setValues] = useState({ name: '', email: '', password: '', staff_role: 'ops' });
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (open) {
      setValues({ name: '', email: '', password: '', staff_role: 'ops' });
      setShowPassword(false);
      setErrors({});
      setResult(null);
    }
  }, [open]);

  const set = (key, value) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!values.name.trim()) next.name = 'Enter their name';
    if (!EMAIL_RE.test(values.email.trim())) next.email = 'Enter a valid email address';
    const pw = passwordProblem(values.password, values.email);
    if (pw) next.password = pw;
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    try {
      const { data } = await axiosClient.post('/admin/staff/invitations', {
        name: values.name.trim(),
        email: values.email.trim().toLowerCase(),
        staff_role: values.staff_role,
        password: values.password,
      });
      setResult(data);
      onInvited?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send the invitation');
    } finally {
      setSaving(false);
    }
  };

  const notice = result && deliveryNotice(result.delivery);
  const roleLabel = STAFF_ROLE_OPTIONS.find((o) => o.value === values.staff_role)?.label;

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        {result ? (
          <>
            <div className="flex flex-col items-center gap-3 pt-2 text-center">
              <div className={cn('flex size-12 items-center justify-center rounded-full', notice.ok ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600')}>
                {notice.ok ? <FiCheckCircle size={24} /> : <FiAlertTriangle size={24} />}
              </div>
              <DialogTitle>{notice.ok ? 'Invitation sent' : 'Invitation created'}</DialogTitle>
              <DialogDescription className="max-w-sm leading-relaxed">
                {notice.ok
                  ? `${result.invitation.email} will get an email to join as ${roleLabel}. When they accept, a second email brings an overview of their role and their login details. The link works once and expires ${fullDateTime(result.invitation.expires_at)}.`
                  : notice.text}
              </DialogDescription>
            </div>
            <DialogFooter className="sm:justify-center">
              <Button variant="outline" onClick={() => { setResult(null); setShowPassword(false); setValues((v) => ({ ...v, name: '', email: '', password: '' })); }}>Invite another</Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-5">
            <DialogHeader>
              <DialogTitle>Invite a team member</DialogTitle>
              <DialogDescription>
                They get an invitation email. Once they accept it, a second email brings an overview of their role and these login details.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Name" htmlFor="invite-name" error={errors.name}>
                <IconInput id="invite-name" icon={FiUser} placeholder="Full name" value={values.name} onChange={(e) => set('name', e.target.value)} />
              </FormField>
              <FormField label="Email" htmlFor="invite-email" error={errors.email}>
                <IconInput id="invite-email" type="email" icon={FiMail} placeholder="name@company.com" value={values.email} onChange={(e) => set('email', e.target.value)} />
              </FormField>
            </div>

            <FormField label="Password" htmlFor="invite-password" error={errors.password} hint="At least 10 characters with a letter and a number. Emailed to them after they accept.">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <IconInput
                    id="invite-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    icon={FiLock}
                    placeholder="Set their password"
                    value={values.password}
                    onChange={(e) => set('password', e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <FiEyeOff /> : <FiEye />}
                  </button>
                </div>
                <Button type="button" variant="outline" className="h-10" onClick={() => { set('password', generatePassword()); setShowPassword(true); }}>
                  <FiRefreshCw /> Generate
                </Button>
              </div>
            </FormField>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-[12.5px] font-semibold">Role</legend>
              {STAFF_ROLE_OPTIONS.map((option) => {
                const checked = values.staff_role === option.value;
                return (
                  <label
                    key={option.value}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                      checked ? 'border-primary bg-blue-50/60 ring-1 ring-primary' : 'border-border hover:bg-muted/50'
                    )}
                  >
                    <input
                      type="radio"
                      name="staff_role"
                      value={option.value}
                      checked={checked}
                      onChange={() => set('staff_role', option.value)}
                      className="mt-1 accent-[var(--primary)]"
                    />
                    <span>
                      <span className="block text-sm font-semibold">{option.label}</span>
                      <span className="block text-xs text-muted-foreground">{option.description}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Spinner /> : <FiMail />} Send invitation
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default InviteStaffDialog;
