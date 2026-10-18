import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { FiBriefcase, FiMail, FiUser, FiShield, FiCheckCircle, FiAlertCircle, FiLock, FiEye, FiEyeOff, FiRefreshCw, FiCopy } from 'react-icons/fi';
import axiosClient from '../api/axiosClient';
import { FormField, IconInput } from './FormField';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TERM_OPTIONS = [
  { value: '1', label: '1 Month' },
  { value: '3', label: '3 Months (5% off)' },
  { value: '6', label: '6 Months (10% off)' },
  { value: '12', label: '12 Months (15% off)' },
];

const INITIAL = {
  business_name: '',
  owner_name: '',
  owner_email: '',
  owner_password: '',
  plan_code: '',
  term_months: '12',
  payment_reference: '',
  grant_reason: '',
  is_founding_client: false,
};

// A strong random password: letters and digits without look-alike characters.
const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function generatePassword(length = 14) {
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  let out = Array.from(bytes, (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join('');
  if (!/\d/.test(out)) out = out.slice(0, -1) + '7';
  if (!/[A-Za-z]/.test(out)) out = 'K' + out.slice(1);
  return out;
}

const validate = (v) => {
  const e = {};
  if (!v.business_name.trim()) e.business_name = 'Business name is required';
  if (!v.owner_name.trim()) e.owner_name = 'Owner name is required';
  if (!EMAIL_RE.test(v.owner_email.trim())) e.owner_email = 'A valid owner email is required';
  const pw = v.owner_password;
  if (!pw) e.owner_password = 'Set a password for the owner';
  else if (pw.length < 10) e.owner_password = 'Password must be at least 10 characters';
  else if (pw.length > 128) e.owner_password = 'Password must be at most 128 characters';
  else if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) e.owner_password = 'Password must contain at least one letter and one number';
  else if (pw.toLowerCase() === v.owner_email.trim().toLowerCase()) e.owner_password = 'Password cannot be the owner email';
  if (!v.plan_code) e.plan_code = 'Plan is required';
  const ref = v.payment_reference.trim();
  if (!ref) e.payment_reference = 'Enter the approval or bank reference for this grant';
  else if (ref.length < 3 || ref.length > 120) e.payment_reference = 'Reference must be 3–120 characters';
  const reason = v.grant_reason.trim();
  if (!reason) e.grant_reason = 'Explain why this grant is authorized';
  else if (reason.length < 10 || reason.length > 500) e.grant_reason = 'Reason must be 10–500 characters';
  return e;
};

// Creates the workspace, brand profile, subscription and the Owner's login.
// Staff set the Owner's password here and hand it over themselves; no email
// is sent.
const CreateTenantModal = ({ onTenantCreated, onCancel }) => {
  const [values, setValues] = useState(INITIAL);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  // Plans come only from the server's catalogue; there is no built-in list.
  const [availablePlans, setAvailablePlans] = useState([]);
  const [plansState, setPlansState] = useState('loading'); // loading | ready | unavailable
  const [createdResult, setCreatedResult] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    async function loadPlans() {
      try {
        const res = await axiosClient.get('/admin/plans');
        const plans = res.data?.plans || [];
        setAvailablePlans(plans.map(p => ({
          code: p.code,
          name: `${p.name} (₹${p.monthly_price?.toLocaleString('en-IN')}/mo · ${p.limits?.max_users === -1 ? 'unlimited' : p.limits?.max_users} users)`,
        })));
        setPlansState(plans.length ? 'ready' : 'unavailable');
      } catch (err) {
        setPlansState('unavailable');
      }
    }
    loadPlans();
  }, []);

  const set = (key, value) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setLoading(true);
    try {
      const payload = {
        business_name: values.business_name.trim(),
        owner_name: values.owner_name.trim(),
        owner_email: values.owner_email.trim().toLowerCase(),
        owner_password: values.owner_password,
        plan_code: values.plan_code,
        term_months: Number(values.term_months || 12),
        // A manual grant: staff record who approved it (their own login), the
        // approval/bank reference and why. Nothing is filled in automatically.
        payment_reference: values.payment_reference.trim(),
        grant_reason: values.grant_reason.trim(),
        is_founding_client: Boolean(values.is_founding_client),
        settings: {
          language: 'en',
          currency: 'INR',
          tax_treatment: 'gst',
          timezone: 'Asia/Kolkata',
        },
      };

      const res = await axiosClient.post('/admin/tenants', payload);
      toast.success(`Workspace "${payload.business_name}" provisioned`);
      setCreatedResult({ ...res.data, owner_password: values.owner_password });
      setValues(INITIAL);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to provision workspace');
    } finally {
      setLoading(false);
    }
  };

  const handleFinishAndClose = () => {
    if (onTenantCreated && createdResult) {
      onTenantCreated(createdResult);
    } else if (onCancel) {
      onCancel();
    }
  };

  const copyCredentials = async () => {
    const text = `Workspace: ${createdResult.tenant?.name}\nLogin email: ${createdResult.owner?.email}\nPassword: ${createdResult.owner_password}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Login details copied');
    } catch {
      toast.error('Could not copy. Select and copy the details manually.');
    }
  };

  // Success view: the workspace and the Owner's login exist.
  if (createdResult) {
    const fieldLabel = 'text-[11px] font-bold tracking-wide text-slate-400 uppercase';
    return (
      <div className="px-3 py-2 text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-green-50 text-green-600">
          <FiCheckCircle size={30} />
        </div>
        <div className="mb-1 text-lg font-extrabold">Workspace Provisioned</div>
        <div className="mb-5 text-[13px] text-muted-foreground">
          The Owner can sign in now with the email and password below. No email was sent; share these details with the Owner yourself.
        </div>

        <div className="mb-5 rounded-xl border border-border bg-muted/50 p-4 text-left">
          <div className="mb-3">
            <span className={fieldLabel}>Workspace</span>
            <div className="text-sm font-bold">
              {createdResult.tenant?.name} <span className="text-xs font-medium text-slate-400">(ID: #{createdResult.tenant?.id})</span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2">
            <div className="min-w-0">
              <span className={fieldLabel}>Owner Login Email</span>
              <div className="text-[13.5px] font-semibold break-all">{createdResult.owner?.email}</div>
            </div>
            <div className="min-w-0">
              <span className={fieldLabel}>Password</span>
              <div className="font-mono text-[13.5px] font-semibold break-all">{createdResult.owner_password}</div>
            </div>
          </div>
        </div>

        <div className="flex justify-center gap-3">
          <Button variant="outline" size="lg" onClick={copyCredentials}>
            <FiCopy /> Copy login details
          </Button>
          <Button size="lg" onClick={handleFinishAndClose} className="min-w-24 font-semibold">
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex items-center gap-3 border-b border-border pb-4 pr-6">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          <FiBriefcase size={21} />
        </div>
        <div>
          <div className="text-base font-extrabold">Provision New Workspace</div>
          <div className="text-xs text-slate-400">
            Creates the workspace, brand profile, subscription and the Owner's login. No email is sent.
          </div>
        </div>
      </div>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {plansState === 'unavailable' && (
          <Alert variant="destructive">
            <FiAlertCircle />
            <div>
              <AlertTitle>Plan catalogue unavailable</AlertTitle>
              <AlertDescription>
                The plan catalogue could not be loaded, so workspaces cannot be created right now. Load the catalogue on the server, then reopen this form.
              </AlertDescription>
            </div>
          </Alert>
        )}

        <FormField label="Business / Brand Name" htmlFor="business_name" error={errors.business_name}>
          <IconInput id="business_name" icon={FiBriefcase} placeholder="e.g. Acme Motors" value={values.business_name} onChange={(e) => set('business_name', e.target.value)} />
        </FormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Owner Full Name" htmlFor="owner_name" error={errors.owner_name}>
            <IconInput id="owner_name" icon={FiUser} placeholder="e.g. Rajesh Kumar" value={values.owner_name} onChange={(e) => set('owner_name', e.target.value)} />
          </FormField>
          <FormField label="Owner Email" htmlFor="owner_email" error={errors.owner_email} hint="The Owner signs in with this email.">
            <IconInput id="owner_email" type="email" icon={FiMail} placeholder="owner@company.com" value={values.owner_email} onChange={(e) => set('owner_email', e.target.value)} />
          </FormField>
        </div>

        <FormField
          label="Owner Password"
          htmlFor="owner_password"
          error={errors.owner_password}
          hint="At least 10 characters with a letter and a number. You will share it with the Owner yourself."
        >
          <div className="flex gap-2">
            <div className="relative flex-1">
              <IconInput
                id="owner_password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                icon={FiLock}
                placeholder="Set the owner's password"
                value={values.owner_password}
                onChange={(e) => set('owner_password', e.target.value)}
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
            <Button type="button" variant="outline" className="h-10" onClick={() => { set('owner_password', generatePassword()); setShowPassword(true); }}>
              <FiRefreshCw /> Generate
            </Button>
          </div>
        </FormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr]">
          <FormField label="Subscription Plan" error={errors.plan_code}>
            <Select value={values.plan_code} onValueChange={(v) => set('plan_code', v)} disabled={plansState !== 'ready'}>
              <SelectTrigger size="lg" className="h-10">
                <SelectValue placeholder={plansState === 'loading' ? 'Loading plan catalogue…' : 'Select a plan'} />
              </SelectTrigger>
              <SelectContent>
                {availablePlans.map((p) => <SelectItem key={p.code} value={p.code}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Term">
            <Select value={values.term_months} onValueChange={(v) => set('term_months', v)}>
              <SelectTrigger size="lg" className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TERM_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
        </div>

        <FormField
          label="Manual Grant Reference"
          htmlFor="payment_reference"
          error={errors.payment_reference}
          hint="This workspace is created as a manual grant authorized by you. Enter the approval or bank-transfer reference. Razorpay payments are recorded automatically, not here."
        >
          <IconInput id="payment_reference" icon={FiShield} placeholder="Approval or bank reference" value={values.payment_reference} onChange={(e) => set('payment_reference', e.target.value)} />
        </FormField>

        <FormField label="Reason for Manual Grant" htmlFor="grant_reason" error={errors.grant_reason} hint="Recorded in the audit log with your name.">
          <Textarea
            id="grant_reason"
            rows={2}
            maxLength={500}
            placeholder="e.g. Pilot client approved by the founder; paid by bank transfer"
            value={values.grant_reason}
            onChange={(e) => set('grant_reason', e.target.value)}
          />
        </FormField>

        <label htmlFor="is_founding_client" className="flex cursor-pointer items-center justify-between rounded-lg border border-border bg-muted/50 px-3.5 py-2.5">
          <div>
            <div className="text-[13px] font-semibold">Founding Client Status</div>
            <div className="text-[11.5px] text-slate-400">Flag this workspace as a launch pilot founding client</div>
          </div>
          <Switch id="is_founding_client" checked={values.is_founding_client} onCheckedChange={(v) => set('is_founding_client', v)} />
        </label>

        <div className="mt-2 flex justify-end gap-2.5 border-t border-border pt-4">
          {onCancel && <Button type="button" variant="outline" size="lg" onClick={onCancel}>Cancel</Button>}
          <Button type="submit" size="lg" disabled={loading || plansState !== 'ready'} className="font-semibold">
            {loading && <Spinner />} Provision Workspace
          </Button>
        </div>
      </form>
    </div>
  );
};

export default CreateTenantModal;
