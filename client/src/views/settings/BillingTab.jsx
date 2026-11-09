import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { C } from '../../constants/theme.js';
import { api } from '../../services/api.js';
import { SectionTitle, SubTitle, Button, Notice, Divider } from './ui.jsx';
import { inputStyle } from './styles.js';
import {
  formatInr, formatRupees, canManageBilling, allowanceBar, aiStatusLine, planAction, validTopup, ledgerLabel,
  periodPricing, periodLabel, trialStatus, validTrialForm,
} from './billingPolicy.js';

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

// Loads Razorpay Checkout once. Only the public key id ever reaches the browser.
function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${CHECKOUT_SRC}"]`);
    if (existing) { existing.addEventListener('load', resolve); existing.addEventListener('error', reject); return; }
    const script = document.createElement('script');
    script.src = CHECKOUT_SRC;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load the payment window'));
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
    razorpay.on('payment.failed', (event) => reject(new Error(event?.error?.description || 'Payment failed')));
    razorpay.open();
  });
}

const Bar = ({ percent, tone }) => {
  const color = tone === 'error' ? C.red : tone === 'warn' ? '#d97706' : C.green;
  return (
    <div style={{ height: 8, background: C.border, borderRadius: 4, overflow: 'hidden', margin: '6px 0' }}>
      <div style={{ width: `${Math.min(percent, 100)}%`, height: '100%', background: color }} />
    </div>
  );
};

const Stat = ({ label, value, hint }) => (
  <div style={{ flex: 1, minWidth: 140, border: '1px solid ' + C.border, borderRadius: 10, padding: 12 }}>
    <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
    <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginTop: 4 }}>{value}</div>
    {hint && <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{hint}</div>}
  </div>
);

const PERIODS = [1, 3, 6];

// Billing: GET /api/billing/{plans,summary,wallet/ledger,invoices}; orders are
// created and verified on the server; the wallet is credited only by
// Razorpay's webhook, so a top-up can take a moment to show. N7 adds the
// 1 / 3 / 6 month periods with GST, the free trial and invoice downloads.
export const BillingTab = ({ me, tenantInfo }) => {
  const [summary, setSummary] = useState(null);
  const [plans, setPlans] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [topup, setTopup] = useState('500');
  const [months, setMonths] = useState(1);
  const [trialForm, setTrialForm] = useState({ business_name: '', website: '' });
  const [trialOpen, setTrialOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.getBillingSummary(),
      api.getBillingPlans(),
      api.getWalletLedger(30).catch(() => ({ entries: [] })),
      api.getBillingInvoices(20).catch(() => ({ invoices: [] })),
    ])
      .then(([s, p, l, inv]) => {
        if (!active) return;
        setSummary(s);
        setPlans(p.plans || []);
        setLedger(l.entries || []);
        setInvoices(inv.invoices || []);
        setError('');
      })
      .catch((err) => { if (active) setError(err.message || 'Could not load billing'); });
    return () => { active = false; };
  }, [reloadKey]);

  useEffect(() => {
    const name = tenantInfo?.tenant?.name || '';
    setTrialForm((form) => (form.business_name ? form : { ...form, business_name: name }));
  }, [tenantInfo]);

  const manage = canManageBilling(summary);
  const paymentsOn = summary?.payments?.enabled;

  // Creates the order on the server, pays, then lets the server verify the signature.
  const checkout = async (order, label) => {
    setBusy(label);
    try {
      await loadCheckout();
      const { checkout: details } = await api.createBillingOrder(order);
      const result = await pay({ checkout: details, me });
      const verified = await api.verifyBillingPayment({
        razorpay_order_id: result.razorpay_order_id,
        razorpay_payment_id: result.razorpay_payment_id,
        razorpay_signature: result.razorpay_signature,
      });
      toast.success(verified.message || 'Payment confirmed', { duration: 7000 });
      load();
      if (verified.wallet_credit_pending) setTimeout(load, 8000);
    } catch (err) {
      if (err.message !== 'Payment cancelled') toast.error(err.message || 'Payment did not go through');
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
      toast.error(err.message || `Could not add an extra ${kind}`);
    } finally {
      setBusy('');
    }
  };

  const startTopup = () => {
    const check = validTopup(topup, summary?.wallet);
    if (!check.ok) return toast.error(check.reason);
    return checkout({ purpose: 'wallet_topup', amount_inr: check.inr }, 'topup');
  };

  // N7: the trial starts without a card; the server checks the one-trial rules.
  const startTrial = async () => {
    const check = validTrialForm(trialForm);
    if (!check.ok) return toast.error(check.reason);
    setBusy('trial');
    try {
      const result = await api.startBillingTrial({ business_name: check.business_name, website: check.website });
      toast.success(result.message || 'Your free trial has started', { duration: 7000 });
      setTrialOpen(false);
      load();
    } catch (err) {
      toast.error(err.message || 'Could not start the trial');
    } finally {
      setBusy('');
    }
    return undefined;
  };

  // N7: one click from the trial banner to the suggested plan and period.
  const upgradeNow = (upgrade) => {
    const plan = plans.find((p) => p.code === upgrade?.plan_code) || plans[0];
    if (!plan) return;
    checkout({ purpose: 'subscription', plan_code: plan.code, period_months: upgrade?.period_months || 1 }, 'upgrade');
  };

  const downloadInvoice = async (invoice) => {
    setBusy(`invoice-${invoice.id}`);
    try {
      await api.downloadBillingInvoice(invoice);
    } catch (err) {
      toast.error(err.message || 'Could not download the invoice');
    } finally {
      setBusy('');
    }
  };

  if (error && !summary) {
    return <Notice tone="error">Billing could not be loaded: {error} <button type="button" onClick={load} style={{ background: 'none', border: 'none', color: C.accent, fontWeight: 700, cursor: 'pointer' }}>Retry</button></Notice>;
  }
  if (!summary) return <p style={{ fontSize: 12, color: C.muted }}>Loading…</p>;

  const sub = summary.subscription;
  const bar = allowanceBar(summary.ai);
  const alerts = summary.alerts || [];
  const trial = trialStatus(summary);
  const onTrial = Boolean(sub?.is_trial && sub.status === 'active');
  const planHint = !sub ? 'Choose a plan below'
    : sub.is_trial ? (sub.status === 'active' ? `Free trial · ${sub.days_left} day${sub.days_left === 1 ? '' : 's'} left` : 'Trial ended: upgrade below')
      : sub.status === 'active' ? `${formatRupees(sub.price_inr)} for ${periodLabel(sub.period_months || 1)} · ${sub.days_left} days left`
        : sub.status === 'expired' ? 'Expired: renew below' : 'Choose a plan below';

  return (
    <div>
      <SectionTitle>Billing</SectionTitle>
      {!manage && <Notice tone="muted">Only the workspace Owner or an Admin can change the plan or add money.</Notice>}
      {!paymentsOn && <Notice tone="muted">Online payments are not available right now. Contact Getnera to pay for a plan.</Notice>}

      {trial.show && (
        <Notice tone={trial.tone}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <div style={{ flex: '1 1 260px' }}>
              <div style={{ fontWeight: 800, marginBottom: 2 }}>{trial.title}</div>
              <div style={{ fontSize: 11, color: C.muted }}>{trial.text}</div>
            </div>
            {manage && trial.kind !== 'available' && trial.upgrade && (
              <Button type="button" busy={busy === 'upgrade'} disabled={!paymentsOn || Boolean(busy)} onClick={() => upgradeNow(trial.upgrade)}>
                {busy === 'upgrade' ? 'Opening payment…' : `Upgrade now · ${plans.find((p) => p.code === trial.upgrade.plan_code)?.name || 'WhatsApp'} plan`}
              </Button>
            )}
            {manage && trial.kind === 'available' && !trialOpen && (
              <Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={() => setTrialOpen(true)}>Start free trial</Button>
            )}
          </div>
          {manage && trial.kind === 'available' && trialOpen && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
              <div style={{ flex: '1 1 180px' }}>
                <label style={{ display: 'block', fontSize: 9, color: C.muted, marginBottom: 5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Business name</label>
                <input value={trialForm.business_name} onChange={(e) => setTrialForm({ ...trialForm, business_name: e.target.value })} style={inputStyle()} placeholder="Sunrise Dental" />
              </div>
              <div style={{ flex: '1 1 180px' }}>
                <label style={{ display: 'block', fontSize: 9, color: C.muted, marginBottom: 5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Website</label>
                <input value={trialForm.website} onChange={(e) => setTrialForm({ ...trialForm, website: e.target.value })} style={inputStyle()} placeholder="www.example.in" />
              </div>
              <Button type="button" busy={busy === 'trial'} disabled={Boolean(busy)} onClick={startTrial}>{busy === 'trial' ? 'Starting…' : 'Start 7-day trial'}</Button>
              <Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={() => setTrialOpen(false)}>Cancel</Button>
              <p style={{ flexBasis: '100%', fontSize: 10, color: C.muted, margin: 0 }}>No card needed. One trial per business, WhatsApp number, email and phone.</p>
            </div>
          )}
        </Notice>
      )}

      {summary.ai && !summary.ai.allowed && <Notice tone="error">{summary.ai.reason}</Notice>}
      {alerts.slice(0, 2).map((alert) => (
        <Notice key={alert.id} tone={alert.kind === 'ai_blocked' || alert.kind === 'trial_expired' ? 'error' : 'info'}>{alert.message}</Notice>
      ))}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Stat label="Plan" value={sub?.status === 'active' ? sub.plan_name : 'None'} hint={planHint} />
        <Stat label="Wallet" value={formatInr(summary.wallet.balance_paise)} hint="Pays AI replies beyond the plan, extra seats and numbers" />
        <Stat label="Seats" value={`${summary.seats.used} / ${summary.seats.limit}`} hint={summary.seats.extra ? `${summary.seats.extra} extra this period` : 'Included in the plan'} />
        <Stat label="WhatsApp numbers" value={`${summary.numbers.used} / ${summary.numbers.limit}`} hint={summary.numbers.extra ? `${summary.numbers.extra} extra this period` : 'Included in the plan'} />
      </div>

      <Divider />
      <SubTitle>AI replies</SubTitle>
      <p style={{ fontSize: 12, color: C.text, margin: '0 0 6px' }}>{aiStatusLine(summary)}</p>
      {bar && (<><Bar percent={bar.percent} tone={bar.tone} /><p style={{ fontSize: 10, color: C.muted, margin: 0 }}>{bar.label}</p></>)}
      {summary.ai?.period_end && summary.ai.allowed && !onTrial && (
        <p style={{ fontSize: 10, color: C.muted, margin: '4px 0 0' }}>The allowance resets on {new Date(summary.ai.period_end).toLocaleDateString('en-IN', { dateStyle: 'medium' })}{(sub?.period_months || 1) > 1 ? ' (every month of your paid period)' : ''}.</p>
      )}
      <p style={{ fontSize: 10, color: C.muted, marginTop: 8 }}>{summary.meta_billing_note}</p>

      <Divider />
      <SubTitle>Plans</SubTitle>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginRight: 4 }}>Pay for</span>
        {PERIODS.map((m) => (
          <button key={m} type="button" onClick={() => setMonths(m)} style={{ border: '1px solid ' + (months === m ? C.accent : C.border), background: months === m ? C.accentDim : 'transparent', color: C.text, borderRadius: 999, padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            {periodLabel(m)}
          </button>
        ))}
        <span style={{ fontSize: 10, color: C.muted }}>Prices before GST; {summary.gst_rate_percent ?? 18}% GST is added at checkout.</span>
      </div>
      <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        {plans.map((plan) => {
          const currentPlan = sub?.status === 'active' && !sub.is_trial && sub.plan_code === plan.code;
          const pricing = periodPricing(plan, months);
          return (
            <div key={plan.code} style={{ border: '1px solid ' + (currentPlan ? C.accent : C.border), borderRadius: 12, padding: 14, background: currentPlan ? C.accentDim : C.surface }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{plan.name}</div>
              {pricing ? (
                <>
                  <div style={{ fontSize: 20, fontWeight: 800, color: C.text, margin: '4px 0 0' }}>{pricing.price}<span style={{ fontSize: 11, color: C.muted, fontWeight: 500 }}> / {periodLabel(months)}</span></div>
                  <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>+ {pricing.gst} = <strong style={{ color: C.text }}>{pricing.total}</strong>{months > 1 ? ` · ${pricing.perMonth} a month${pricing.saving ? `, save ${pricing.saving}%` : ''}` : ''}</div>
                </>
              ) : (
                <div style={{ fontSize: 11, color: C.muted, margin: '4px 0' }}>Not sold for {periodLabel(months)}</div>
              )}
              <div style={{ fontSize: 11, color: C.muted, minHeight: 28 }}>{plan.description}</div>
              <ul style={{ paddingLeft: 16, margin: '8px 0', fontSize: 11, color: C.text }}>
                {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
                <li>{plan.ai_replies_month === -1 ? 'Unlimited AI replies' : `${plan.ai_replies_month.toLocaleString('en-IN')} AI replies a month, then ${formatInr(plan.ai_overage_price_paise)} each`}</li>
                <li>Extra seat {formatRupees(plan.extra_seat_price_inr)} · extra number {formatRupees(plan.extra_number_price_inr)}</li>
              </ul>
              {manage && (
                <Button type="button" busy={busy === plan.code} disabled={!paymentsOn || !pricing || Boolean(busy)} onClick={() => checkout({ purpose: 'subscription', plan_code: plan.code, period_months: months }, plan.code)} style={{ width: '100%' }}>
                  {busy === plan.code ? 'Opening payment…' : planAction(plan, sub, months)}
                </Button>
              )}
              {currentPlan && <div style={{ fontSize: 10, color: C.accent, fontWeight: 700, marginTop: 6 }}>Current plan</div>}
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 10, color: C.muted, marginTop: 8 }}>WhatsApp conversation charges are billed by Meta directly to your WhatsApp Business account. A 3 or 6 month plan resets its AI allowance every month.</p>

      {invoices.length > 0 && (
        <>
          <Divider />
          <SubTitle>Invoices</SubTitle>
          <div className="table-responsive">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ color: C.muted, textAlign: 'left' }}>
                  <th style={{ padding: '6px 4px', borderBottom: '1px solid ' + C.border }}>Invoice</th>
                  <th style={{ padding: '6px 4px', borderBottom: '1px solid ' + C.border }}>Date</th>
                  <th style={{ padding: '6px 4px', borderBottom: '1px solid ' + C.border }}>For</th>
                  <th style={{ padding: '6px 4px', borderBottom: '1px solid ' + C.border, textAlign: 'right' }}>Price</th>
                  <th style={{ padding: '6px 4px', borderBottom: '1px solid ' + C.border, textAlign: 'right' }}>GST</th>
                  <th style={{ padding: '6px 4px', borderBottom: '1px solid ' + C.border, textAlign: 'right' }}>Total</th>
                  <th style={{ padding: '6px 4px', borderBottom: '1px solid ' + C.border }} />
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td style={{ padding: '6px 4px', borderBottom: '1px solid ' + C.border, color: C.text, fontWeight: 700, whiteSpace: 'nowrap' }}>{invoice.invoice_number}</td>
                    <td style={{ padding: '6px 4px', borderBottom: '1px solid ' + C.border, color: C.muted, whiteSpace: 'nowrap' }}>{new Date(invoice.issued_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</td>
                    <td style={{ padding: '6px 4px', borderBottom: '1px solid ' + C.border, color: C.text }}>{invoice.description}</td>
                    <td style={{ padding: '6px 4px', borderBottom: '1px solid ' + C.border, textAlign: 'right' }}>{formatInr(invoice.price_paise)}</td>
                    <td style={{ padding: '6px 4px', borderBottom: '1px solid ' + C.border, textAlign: 'right' }}>{formatInr(invoice.gst_paise)}</td>
                    <td style={{ padding: '6px 4px', borderBottom: '1px solid ' + C.border, textAlign: 'right', fontWeight: 700 }}>{formatInr(invoice.total_paise)}</td>
                    <td style={{ padding: '6px 4px', borderBottom: '1px solid ' + C.border, textAlign: 'right' }}>
                      <button type="button" disabled={Boolean(busy)} onClick={() => downloadInvoice(invoice)} style={{ background: 'none', border: 'none', color: C.accent, fontWeight: 700, cursor: 'pointer', fontSize: 11 }}>
                        {busy === `invoice-${invoice.id}` ? 'Preparing…' : 'Download PDF'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Divider />
      <SubTitle>Wallet</SubTitle>
      {manage && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '0 0 160px' }}>
            <label style={{ display: 'block', fontSize: 9, color: C.muted, marginBottom: 5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Top up (₹)</label>
            <input value={topup} onChange={(e) => setTopup(e.target.value)} inputMode="numeric" style={inputStyle()} />
          </div>
          <Button type="button" busy={busy === 'topup'} disabled={!paymentsOn || Boolean(busy)} onClick={startTopup}>{busy === 'topup' ? 'Opening payment…' : 'Add money'}</Button>
          {sub?.status === 'active' && !sub.is_trial && (
            <>
              <Button type="button" variant="secondary" busy={busy === 'seat'} disabled={Boolean(busy)} onClick={() => buyExtra('seat')}>Add a seat ({formatRupees(summary.plan?.extra_seat_price_inr)})</Button>
              <Button type="button" variant="secondary" busy={busy === 'number'} disabled={Boolean(busy)} onClick={() => buyExtra('number')}>Add a number ({formatRupees(summary.plan?.extra_number_price_inr)})</Button>
            </>
          )}
        </div>
      )}
      <p style={{ fontSize: 10, color: C.muted, marginTop: 8 }}>Money added shows here once Razorpay confirms the payment, usually within a minute.</p>

      {ledger.length > 0 && (
        <div className="table-responsive" style={{ marginTop: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ color: C.muted, textAlign: 'left' }}>
                <th style={{ padding: '6px 4px', borderBottom: '1px solid ' + C.border }}>When</th>
                <th style={{ padding: '6px 4px', borderBottom: '1px solid ' + C.border }}>What</th>
                <th style={{ padding: '6px 4px', borderBottom: '1px solid ' + C.border, textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((entry) => (
                <tr key={entry.id}>
                  <td style={{ padding: '6px 4px', borderBottom: '1px solid ' + C.border, color: C.muted, whiteSpace: 'nowrap' }}>{new Date(entry.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td style={{ padding: '6px 4px', borderBottom: '1px solid ' + C.border, color: C.text }}>{ledgerLabel(entry.reason)}{entry.description && entry.reason !== 'ai_overage' ? ` · ${entry.description}` : ''}</td>
                  <td style={{ padding: '6px 4px', borderBottom: '1px solid ' + C.border, textAlign: 'right', fontWeight: 700, color: entry.direction === 'credit' ? C.green : C.text }}>{entry.direction === 'credit' ? '+' : '−'}{formatInr(entry.amount_paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
