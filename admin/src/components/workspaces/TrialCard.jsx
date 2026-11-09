import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FiClock, FiGift } from 'react-icons/fi';
import axiosClient from '../../api/axiosClient';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { shortDate, fullDateTime } from '../../utils/time';

const apiError = (err, fallback) => err?.response?.data?.error || err?.message || fallback;

// N7: a workspace's plan, free trial and invoices as staff see them
// (GET /admin/tenants/:id/billing). The Admin (Owner) can extend a trial to
// 14 days; the reason is required and lands in the audit log.
const TrialCard = ({ tenantId, canManageBilling = false }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const res = await axiosClient.get(`/admin/tenants/${tenantId}/billing`);
      setData(res.data);
      setError('');
    } catch (err) {
      setError(apiError(err, 'Billing could not be loaded'));
    }
  };
  useEffect(() => { setData(null); load(); }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const extend = async () => {
    if (reason.trim().length < 3) return toast.error('Give a reason of at least 3 characters');
    setSaving(true);
    try {
      const body = { reason: reason.trim() };
      if (days !== '') body.days = Number(days);
      const res = await axiosClient.post(`/admin/tenants/${tenantId}/billing/trial/extend`, body);
      toast.success(`Trial extended to ${res.data.trial.days} days`);
      setReason('');
      setDays('');
      load();
    } catch (err) {
      toast.error(apiError(err, 'Could not extend the trial'));
    } finally {
      setSaving(false);
    }
    return undefined;
  };

  const sub = data?.subscription;
  const trial = data?.trial;
  const status = trial?.status;
  const badge = status === 'active' ? { variant: 'success', label: `Trial · ${trial.days_left} day${trial.days_left === 1 ? '' : 's'} left` }
    : status === 'expired' ? { variant: 'danger', label: 'Trial ended' }
      : status === 'converted' ? { variant: 'muted', label: 'Trial converted' } : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><FiGift size={16} /></span>
            <div>
              <CardTitle className="text-base">Plan and trial</CardTitle>
              <CardDescription>What this workspace pays for, and its free trial.</CardDescription>
            </div>
          </div>
          {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        {!data && !error && <div className="text-xs text-muted-foreground">Loading…</div>}
        {data && (
          <>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Plan</dt><dd className="mt-0.5">{sub ? `${sub.plan_name} (${sub.status})` : 'None'}</dd></div>
              <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Paid until</dt><dd className="mt-0.5">{sub?.current_period_end ? shortDate(sub.current_period_end) : '—'}{sub?.period_months ? ` · ${sub.period_months} month${sub.period_months === 1 ? '' : 's'}` : ''}</dd></div>
              <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Wallet</dt><dd className="mt-0.5">₹{((data.wallet?.balance_paise || 0) / 100).toLocaleString('en-IN')}</dd></div>
              {trial && (
                <>
                  <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Trial business</dt><dd className="mt-0.5">{trial.business_name}<div className="text-xs text-muted-foreground">{trial.website}</div></dd></div>
                  <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Trial period</dt><dd className="mt-0.5">{shortDate(trial.started_at)} to {shortDate(trial.ends_at)}<div className="text-xs text-muted-foreground">{trial.days} of {trial.max_days} days</div></dd></div>
                  <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">AI replies</dt><dd className="mt-0.5">{data.ai?.used ?? 0} of {trial.ai_replies_total} used</dd></div>
                </>
              )}
            </dl>

            {trial?.extensions?.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Extensions</div>
                <ol className="flex flex-col gap-1 text-xs">
                  {trial.extensions.map((e, i) => (
                    <li key={i} className="flex items-start gap-2"><FiClock className="mt-0.5 shrink-0 text-muted-foreground" /><span>+{e.days} day{e.days === 1 ? '' : 's'} on {fullDateTime(e.at)}: {e.reason}</span></li>
                  ))}
                </ol>
              </div>
            )}

            {trial && trial.can_extend && canManageBilling && (
              <div className="rounded-xl border border-border p-3">
                <div className="mb-2 text-xs font-semibold">Extend the trial (to {trial.max_days} days at most)</div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <Input type="number" min="1" max={trial.max_days - trial.days} value={days} onChange={(e) => setDays(e.target.value)} placeholder={`Days (default ${trial.max_days - trial.days})`} className="sm:w-44" />
                  <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required, goes to the audit log)" rows={2} className="flex-1" />
                  <Button onClick={extend} disabled={saving}>{saving ? 'Saving…' : 'Extend'}</Button>
                </div>
              </div>
            )}
            {trial && !trial.can_extend && status !== 'converted' && <div className="text-xs text-muted-foreground">This trial has reached the {trial.max_days}-day limit; the customer upgrades from Settings &gt; Billing.</div>}

            {data.invoices?.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Invoices</div>
                <ul className="flex flex-col gap-1 text-xs">
                  {data.invoices.slice(0, 5).map((inv) => (
                    <li key={inv.id} className="flex justify-between gap-3"><span>{inv.invoice_number} · {inv.description}</span><span className="font-semibold">₹{(inv.total_paise / 100).toLocaleString('en-IN')}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default TrialCard;
