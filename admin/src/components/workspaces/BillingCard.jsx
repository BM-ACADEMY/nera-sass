import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FiCreditCard } from 'react-icons/fi';
import axiosClient from '../../api/axiosClient';
import { FormField } from '../FormField';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { shortDate } from '../../utils/time';

const apiError = (err, fallback) => err.response?.data?.error || fallback;
const NOTE_HELP = 'Why you are doing this (3 to 300 characters). It is saved in the audit trail.';
const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

const Stat = ({ label, children }) => (
  <div className="min-w-0">
    <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
    <dd className="mt-1 text-[13.5px] font-medium break-words">{children ?? <span className="text-muted-foreground">None</span>}</dd>
  </div>
);

// Plan and AI allowance of one workspace, with the two manual actions staff
// need while payments are off: put the workspace on a plan, or add days.
// Both need a written note and are audited by the server.
const BillingCard = ({ tenantId }) => {
  const [data, setData] = useState(null);
  const [plans, setPlans] = useState([]);
  const [hidden, setHidden] = useState(false);
  const [dialog, setDialog] = useState(null); // 'grant' | 'extend' | null
  const [planCode, setPlanCode] = useState('');
  const [days, setDays] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [billing, list] = await Promise.all([
        axiosClient.get(`/admin/tenants/${tenantId}/billing`),
        axiosClient.get('/admin/billing/plans'),
      ]);
      setData(billing.data);
      setPlans((list.data.plans || []).filter((p) => p.is_active !== false));
      setHidden(false);
    } catch (err) {
      // Staff without billing access simply do not see this card.
      if (err.response?.status === 403) setHidden(true);
      else toast.error(apiError(err, 'Could not load billing for this workspace'));
    }
  }, [tenantId]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  if (hidden) return null;

  const sub = data?.subscription || null;
  const ai = data?.ai || null;
  const chosen = plans.find((p) => p.code === planCode) || null;

  const open = (kind) => {
    setDialog(kind);
    setNote('');
    setDays('');
    setError('');
    setPlanCode(sub?.plan_code || plans[0]?.code || '');
  };
  const close = () => { if (!saving) setDialog(null); };

  const submit = async (e) => {
    e.preventDefault();
    const trimmed = note.trim();
    if (trimmed.length < 3 || trimmed.length > 300) { setError('Write a note of 3 to 300 characters.'); return; }
    setSaving(true);
    try {
      if (dialog === 'grant') {
        if (!planCode) { setError('Choose a plan.'); setSaving(false); return; }
        await axiosClient.post(`/admin/tenants/${tenantId}/billing/grant`, { plan_code: planCode, note: trimmed });
        toast.success(`${chosen?.name || 'Plan'} granted`);
      } else {
        const n = Number(days);
        if (!Number.isInteger(n) || n < 1 || n > 365) { setError('Days must be a whole number from 1 to 365.'); setSaving(false); return; }
        await axiosClient.post(`/admin/tenants/${tenantId}/billing/extend`, { days: n, note: trimmed });
        toast.success(`${n} day${n === 1 ? '' : 's'} added`);
      }
      setDialog(null);
      load();
    } catch (err) {
      setError(apiError(err, 'That did not work. Nothing was changed.'));
    } finally {
      setSaving(false);
    }
  };

  const sameLive = chosen && sub && sub.status === 'active' && sub.plan_code === chosen.code;
  const grantHint = sameLive
    ? `${chosen.name} is already active here, so this adds one more month to the end of the paid period.`
    : sub && sub.status === 'active'
      ? 'This workspace already has a plan. Granting a different plan starts a fresh month from today on the new plan and clears any extra seats or numbers.'
      : 'Starts one month from today. No payment is taken and no invoice is issued.';

  return (
    <Card className="gap-4">
      <CardHeader className="px-4 sm:px-6">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-[15px]"><FiCreditCard className="text-primary" /> Plan and AI replies</CardTitle>
          <CardDescription className="mt-1 text-xs">Plans are granted by hand while online payments are off. Every change needs a note and is audited.</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={!data || !sub} onClick={() => open('extend')}>Add days</Button>
          <Button size="sm" disabled={!data || plans.length === 0} onClick={() => open('grant')}>Grant plan</Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 sm:px-6">
        {!data ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner /> Loading</div>
        ) : (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Plan">{sub ? <span className="flex items-center gap-2">{sub.plan_name}<Badge variant={sub.status === 'active' ? 'success' : 'muted'}>{sub.status}</Badge></span> : null}</Stat>
            <Stat label="Paid until">{sub ? `${shortDate(sub.current_period_end)} (${sub.days_left} days left)` : null}</Stat>
            <Stat label="AI replies">{ai ? (ai.allowance != null && ai.source !== 'none' ? `${ai.used ?? 0} used, ${ai.left ?? 0} left of ${ai.allowance}` : 'Not limited yet (plans are not required)') : null}</Stat>
            <Stat label="AI right now">{ai ? (ai.allowed ? 'Allowed' : `Blocked: ${ai.reason || 'no allowance'}`) : null}</Stat>
          </dl>
        )}
      </CardContent>

      <Dialog open={Boolean(dialog)} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit} noValidate className="flex flex-col gap-5">
            <DialogHeader>
              <DialogTitle>{dialog === 'grant' ? 'Grant a plan' : 'Add days to the paid period'}</DialogTitle>
              <DialogDescription>
                {dialog === 'grant' ? grantHint : 'Adds whole days to the end of the paid period. Use it to make good for a service problem instead of a refund.'}
              </DialogDescription>
            </DialogHeader>
            {dialog === 'grant' ? (
              <FormField label="Plan" htmlFor="g-plan">
                <select id="g-plan" className={selectClass} value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
                  {plans.map((p) => <option key={p.code} value={p.code}>{p.name} (₹{p.price_inr} a month)</option>)}
                </select>
              </FormField>
            ) : (
              <FormField label="Days to add" htmlFor="g-days">
                <Input id="g-days" type="number" min="1" max="365" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} placeholder="e.g. 5" />
              </FormField>
            )}
            <FormField label="Note" htmlFor="g-note" hint={NOTE_HELP} error={error}>
              <Textarea id="g-note" rows={3} maxLength={300} value={note} onChange={(e) => { setNote(e.target.value); setError(''); }} placeholder="e.g. Pilot workspace, free for the first month" />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={saving} onClick={close}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving && <Spinner />} {dialog === 'grant' ? 'Grant plan' : 'Add days'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default BillingCard;
