import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  FiCreditCard, FiPackage, FiZap, FiUsers, FiSmartphone, FiFileText, FiExternalLink, FiPlus, FiRefreshCw, FiAlertTriangle, FiCheck, FiInfo,
} from 'react-icons/fi';
import { C } from '../../constants/theme.js';
import { api } from '../../services/api.js';
import {
  formatInr, formatRupees, canManageBilling, allowanceBar, aiStatusLine, planAction, validTopup, ledgerLabel,
} from '../settings/billingPolicy.js';
import { Callout, FormRow } from '../settings/SettingsKit.jsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
const when = (value) => new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

// Loads Razorpay Checkout once. Only the public key id ever reaches the browser.
function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${CHECKOUT_SRC}"]`);
    if (existing) { existing.addEventListener('load', resolve); existing.addEventListener('error', reject); return; }
    const script = document.createElement('script');
    script.src = CHECKOUT_SRC;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not open the payment window. Check your connection and try again.'));
    document.body.appendChild(script);
  });
}

// Opens Checkout for an order the server created; resolves with Razorpay's result.
function pay({ checkout, me }) {
  return new Promise((resolve, reject) => {
    const razorpay = new window.Razorpay({
      key: checkout.key_id,
      amount: checkout.amount,
      currency: checkout.currency,
      name: 'Getnera',
      description: checkout.name,
      order_id: checkout.order_id,
      prefill: { name: me?.name || '', email: me?.email || '' },
      theme: { color: C.accent },
      handler: resolve,
      modal: { ondismiss: () => reject(new Error('Payment cancelled')) },
    });
    razorpay.on('payment.failed', (event) => reject(new Error(event?.error?.description || 'The payment did not go through. No money was taken.')));
    razorpay.open();
  });
}

const BAR_COLORS = { error: 'bg-red-500', warn: 'bg-amber-500', ok: 'bg-green-600' };
const Bar = ({ percent, tone }) => (
  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
    <div className={cn('h-full rounded-full', BAR_COLORS[tone] || BAR_COLORS.ok)} style={{ width: `${Math.min(percent, 100)}%` }} />
  </div>
);

const UsageRow = ({ icon: Icon, label, value, hint }) => (
  <div className="flex items-center gap-3 py-2.5">
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" /></span>
    <div className="min-w-0 flex-1">
      <div className="text-sm font-medium">{label}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
    <div className="text-sm font-bold tabular-nums">{value}</div>
  </div>
);

// Opens the printable invoice page. The window opens first (so the browser
// does not block it), then shows the page fetched with the login token.
async function openInvoice(id) {
  const win = window.open('', '_blank');
  try {
    const res = await fetch(`${api.baseUrl}/api/billing/invoices/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${api.token}` } });
    if (!res.ok) throw new Error('not ok');
    const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/html' }));
    if (win) win.location.href = url; else window.location.href = url;
  } catch {
    win?.close();
    toast.error('Could not open the invoice. Please try again.');
  }
}

// Billing (UI only): GET /api/billing/{summary,plans,wallet/ledger,invoices,
// invoice-details}. Orders are created and verified on the server; the wallet
// is credited only by Razorpay's webhook, so a top-up can take a moment to show.
export default function BillingPage() {
  const [summary, setSummary] = useState(null);
  const [plans, setPlans] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [invoices, setInvoices] = useState(null);
  const [details, setDetails] = useState(null);
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [topup, setTopup] = useState('500');
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.getBillingSummary(),
      api.getBillingPlans(),
      api.getWalletLedger(30).catch(() => ({ entries: [] })),
      api.get('/billing/invoices').catch(() => null),
      api.get('/billing/invoice-details').catch(() => null),
      api.getMe().catch(() => null),
    ]).then(([s, p, l, inv, det, profile]) => {
      if (!active) return;
      setSummary(s);
      setPlans(p.plans || []);
      setLedger(l.entries || []);
      setInvoices(inv ? inv.invoices || [] : null);
      setDetails(det);
      setMe(profile);
      setError('');
    }).catch((err) => { if (active) setError(err.message || 'Please check your connection and try again.'); });
    return () => { active = false; };
  }, [reloadKey]);

  const manage = canManageBilling(summary);
  const paymentsOn = summary?.payments?.enabled;

  // Creates the order on the server, pays, then lets the server verify the signature.
  const checkout = async (order, label) => {
    setBusy(label);
    try {
      await loadCheckout();
      const { checkout: info } = await api.createBillingOrder(order);
      const result = await pay({ checkout: info, me });
      const verified = await api.verifyBillingPayment({
        razorpay_order_id: result.razorpay_order_id,
        razorpay_payment_id: result.razorpay_payment_id,
        razorpay_signature: result.razorpay_signature,
      });
      toast.success(verified.message || 'Payment confirmed', { duration: 7000 });
      load();
      if (verified.wallet_credit_pending) setTimeout(load, 8000);
    } catch (err) {
      if (err.message !== 'Payment cancelled') toast.error(err.message || 'The payment did not go through. Please try again.');
    } finally {
      setBusy('');
    }
  };

  const buyExtra = async (kind) => {
    const price = kind === 'seat' ? summary?.plan?.extra_seat_price_inr : summary?.plan?.extra_number_price_inr;
    if (!window.confirm(`Add one extra ${kind} for ${formatRupees(price)} from the wallet, until the end of this period?`)) return;
    setBusy(kind);
    try {
      const result = await api.buyBillingExtra(kind, 1);
      toast.success(`Extra ${kind} added. Wallet: ${formatInr(result.balance_paise)}`);
      load();
    } catch (err) {
      toast.error(err.message || `Could not add an extra ${kind}. Please try again.`);
    } finally {
      setBusy('');
    }
  };

  const startTopup = () => {
    const check = validTopup(topup, summary?.wallet);
    if (!check.ok) return toast.error(check.reason);
    return checkout({ purpose: 'wallet_topup', amount_inr: check.inr }, 'topup');
  };

  if (error && !summary) {
    return (
      <div className="p-4 md:p-8">
        <Card className="max-w-xl items-center gap-3 px-6 py-12 text-center">
          <FiAlertTriangle className="size-7 text-amber-500" />
          <div className="font-semibold">Billing could not be loaded</div>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={load}><FiRefreshCw /> Try again</Button>
        </Card>
      </div>
    );
  }
  if (!summary) {
    return (
      <div className="flex max-w-6xl flex-col gap-5 p-4 md:p-8">
        <Skeleton className="h-10 w-48 rounded-lg" />
        <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-40 rounded-xl" /><Skeleton className="h-40 rounded-xl" /><Skeleton className="h-40 rounded-xl" /></div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const sub = summary.subscription;
  const active = sub?.status === 'active';
  const bar = allowanceBar(summary.ai);
  const alerts = summary.alerts || [];

  return (
    <div className="flex max-w-6xl flex-col gap-5 p-4 md:p-8">
      <div className="flex items-center gap-3.5">
        <span className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600 ring-4 ring-blue-100"><FiCreditCard size={20} /></span>
        <div>
          <h1 className="text-lg font-extrabold tracking-tight">Billing</h1>
          <p className="text-[13px] text-muted-foreground">Your plan, usage, wallet and invoices.</p>
        </div>
      </div>

      {!manage && <Callout><FiInfo className="mr-1 inline" /> Only the workspace Owner or an Admin can change the plan or add money.</Callout>}
      {!paymentsOn && <Callout tone="warn">Online payments are not available right now. Contact Getnera to pay for a plan.</Callout>}
      {summary.ai && !summary.ai.allowed && <Callout tone="error">{summary.ai.reason}</Callout>}
      {alerts.slice(0, 2).map((alert) => (
        <Callout key={alert.id} tone={alert.kind === 'ai_blocked' ? 'error' : 'info'}>{alert.message}</Callout>
      ))}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Current plan */}
        <Card className="gap-3 px-5 py-5">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-muted-foreground">Current plan</span>
            {active ? <Badge variant="success">Active</Badge> : sub?.status === 'expired' ? <Badge variant="danger">Expired</Badge> : <Badge variant="muted">No plan</Badge>}
          </div>
          <div className="text-2xl font-extrabold">{active ? sub.plan_name : 'None'}</div>
          <p className="text-[13px] text-muted-foreground">
            {active ? `${formatRupees(sub.price_inr)} a month · ${sub.days_left} days left` : sub?.status === 'expired' ? 'Your plan has expired. Renew it below.' : 'Choose a plan below to get started.'}
          </p>
          <Button variant="outline" className="mt-auto" onClick={() => document.getElementById('plans')?.scrollIntoView({ behavior: 'smooth' })}>
            <FiPackage /> {active ? 'Change or renew plan' : 'See plans'}
          </Button>
        </Card>

        {/* Usage */}
        <Card className="gap-1 px-5 py-5">
          <span className="text-[13px] font-medium text-muted-foreground">Usage this period</span>
          <div className="mt-1 text-sm">{aiStatusLine(summary)}</div>
          {bar && <div className="mt-2 flex flex-col gap-1"><Bar percent={bar.percent} tone={bar.tone} /><span className="text-xs text-muted-foreground">{bar.label}</span></div>}
          <div className="mt-1 divide-y divide-border">
            <UsageRow icon={FiUsers} label="Seats" value={`${summary.seats.used} / ${summary.seats.limit}`} hint={summary.seats.extra ? `${summary.seats.extra} extra this period` : 'Included in the plan'} />
            <UsageRow icon={FiSmartphone} label="WhatsApp numbers" value={`${summary.numbers.used} / ${summary.numbers.limit}`} hint={summary.numbers.extra ? `${summary.numbers.extra} extra this period` : 'Included in the plan'} />
          </div>
          {manage && active && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => buyExtra('seat')}>{busy === 'seat' ? <Spinner /> : <FiPlus />} Seat ({formatRupees(summary.plan?.extra_seat_price_inr)})</Button>
              <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => buyExtra('number')}>{busy === 'number' ? <Spinner /> : <FiPlus />} Number ({formatRupees(summary.plan?.extra_number_price_inr)})</Button>
            </div>
          )}
        </Card>

        {/* Wallet */}
        <Card className="gap-3 px-5 py-5">
          <span className="text-[13px] font-medium text-muted-foreground">Wallet</span>
          <div className="text-2xl font-extrabold tabular-nums">{formatInr(summary.wallet.balance_paise)}</div>
          <p className="text-[13px] text-muted-foreground">Pays AI replies beyond the plan, extra seats and numbers.</p>
          {manage && (
            <div className="mt-auto flex items-end gap-2">
              <FormRow label="Top up (₹)" htmlFor="topup">
                <Input id="topup" value={topup} onChange={(e) => setTopup(e.target.value)} inputMode="numeric" className="w-32" />
              </FormRow>
              <Button disabled={!paymentsOn || Boolean(busy)} onClick={startTopup}>{busy === 'topup' ? <Spinner /> : <FiPlus />} Add money</Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Money added shows here once Razorpay confirms the payment, usually within a minute.</p>
        </Card>
      </div>

      {/* Plans */}
      <Card id="plans" className="gap-4">
        <CardHeader className="block">
          <CardTitle>Plans</CardTitle>
          <CardDescription className="mt-1">Prices are per month, plus GST. WhatsApp conversation charges are billed by Meta directly to your WhatsApp Business account.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => {
            const currentPlan = active && sub.plan_code === plan.code;
            return (
              <div key={plan.code} className={cn('flex flex-col gap-2 rounded-xl border p-4', currentPlan ? 'border-blue-500 bg-blue-50/50 ring-1 ring-blue-500' : 'border-border')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[15px] font-extrabold">{plan.name}</span>
                  {currentPlan && <Badge variant="info">Current plan</Badge>}
                </div>
                <div className="text-2xl font-extrabold">{formatRupees(plan.price_inr)}<span className="text-xs font-medium text-muted-foreground"> / month + GST</span></div>
                {plan.description && <p className="text-[13px] text-muted-foreground">{plan.description}</p>}
                <ul className="flex flex-col gap-1.5 text-[13px]">
                  {[...plan.features,
                    plan.ai_replies_month === -1 ? 'Unlimited AI replies' : `${plan.ai_replies_month.toLocaleString('en-IN')} AI replies, then ${formatInr(plan.ai_overage_price_paise)} each`,
                    `Extra seat ${formatRupees(plan.extra_seat_price_inr)} · extra number ${formatRupees(plan.extra_number_price_inr)}`,
                  ].map((feature) => <li key={feature} className="flex gap-2"><FiCheck className="mt-0.5 shrink-0 text-green-600" /> {feature}</li>)}
                </ul>
                {manage && (
                  <Button className="mt-auto" variant={currentPlan ? 'outline' : 'default'} disabled={!paymentsOn || Boolean(busy)} onClick={() => checkout({ purpose: 'subscription', plan_code: plan.code }, plan.code)}>
                    {busy === plan.code ? <><Spinner /> Opening payment…</> : <><FiZap /> {planAction(plan, sub)}</>}
                  </Button>
                )}
              </div>
            );
          })}
        </CardContent>
        {summary.meta_billing_note && <p className="px-6 text-xs text-muted-foreground">{summary.meta_billing_note}</p>}
      </Card>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        {/* Invoices */}
        <Card className="gap-3">
          <CardHeader className="block">
            <CardTitle>Invoices</CardTitle>
            <CardDescription className="mt-1">GST tax invoices for plan payments. Open one to print or save it as a PDF.</CardDescription>
          </CardHeader>
          <CardContent>
            {invoices === null ? (
              <p className="text-sm text-muted-foreground">Invoices could not be loaded right now.</p>
            ) : invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No invoices yet. One is issued for every plan payment.</p>
            ) : (
              <div className="divide-y divide-border">
                {invoices.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-3 py-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><FiFileText className="size-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{inv.invoice_number}</div>
                      <div className="truncate text-xs text-muted-foreground">{new Date(inv.issued_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })}{inv.description ? ` · ${inv.description}` : ''}</div>
                    </div>
                    <span className="text-sm font-bold tabular-nums">{formatInr(inv.total_paise)}</span>
                    <Button size="sm" variant="ghost" onClick={() => openInvoice(inv.id)}><FiExternalLink /> Open</Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <InvoiceDetails key={JSON.stringify(details)} details={details} manage={manage} onSaved={load} />
      </div>

      {/* Wallet history */}
      <Card className="gap-3">
        <CardHeader className="block"><CardTitle>Wallet history</CardTitle></CardHeader>
        <CardContent>
          {ledger.length === 0 ? (
            <p className="text-sm text-muted-foreground">No wallet activity yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">When</th>
                    <th className="py-2 pr-3 font-medium">What</th>
                    <th className="py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((entry) => (
                    <tr key={entry.id} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">{when(entry.created_at)}</td>
                      <td className="py-2 pr-3">{ledgerLabel(entry.reason)}{entry.description && entry.reason !== 'ai_overage' ? ` · ${entry.description}` : ''}</td>
                      <td className={cn('py-2 text-right font-semibold tabular-nums', entry.direction === 'credit' && 'text-green-700')}>{entry.direction === 'credit' ? '+' : '−'}{formatInr(entry.amount_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// The business details printed on invoices (GET/PUT /api/billing/invoice-details).
// Remounted (key) after each load so it shows what the server sent.
function InvoiceDetails({ details, manage, onSaved }) {
  const saved = details?.profile || {};
  const start = { legal_name: saved.legal_name || details?.workspace_name || '', gstin: saved.gstin || '', address: saved.address || '', state_code: saved.state_code || '' };
  const [values, setValues] = useState(start);
  const [saving, setSaving] = useState(false);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.put('/billing/invoice-details', values);
      toast.success('Invoice details saved. They apply to new invoices.');
      onSaved?.();
    } catch (err) {
      toast.error(err.message || 'Could not save the invoice details. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const field = (key, label, props = {}) => (
    <FormRow label={label} htmlFor={`inv-${key}`}>
      <Input id={`inv-${key}`} value={values[key]} readOnly={!manage} onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))} {...props} />
    </FormRow>
  );

  return (
    <Card className="gap-3">
      <CardHeader className="block">
        <CardTitle>Invoice details</CardTitle>
        <CardDescription className="mt-1">The business name and GSTIN printed on your invoices.</CardDescription>
      </CardHeader>
      <CardContent>
        {!details ? (
          <p className="text-sm text-muted-foreground">Invoice details could not be loaded right now.</p>
        ) : (
          <form onSubmit={save} className="flex flex-col gap-3.5">
            {field('legal_name', 'Business name', { maxLength: 120 })}
            {field('gstin', 'GSTIN (optional)', { maxLength: 15, placeholder: '34ABGCA7083D1ZS' })}
            {field('address', 'Address', { maxLength: 300 })}
            {field('state_code', 'GST state code', { maxLength: 2, inputMode: 'numeric', placeholder: '34' })}
            {manage && <div className="flex justify-end"><Button type="submit" disabled={saving}>{saving && <Spinner />} Save details</Button></div>}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
