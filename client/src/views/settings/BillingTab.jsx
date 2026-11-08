import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { C } from '../../constants/theme.js';
import { api } from '../../services/api.js';
import { SectionTitle, SubTitle, Button, Notice, Divider } from './ui.jsx';
import { inputStyle } from './styles.js';
import {
  formatInr, formatRupees, canManageBilling, allowanceBar, aiStatusLine, planAction, validTopup, ledgerLabel,
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

// Billing: GET /api/billing/{plans,summary,wallet/ledger}; orders are created
// and verified on the server; the wallet is credited only by Razorpay's
// webhook, so a top-up can take a moment to show.
export const BillingTab = ({ me }) => {
  const [summary, setSummary] = useState(null);
  const [plans, setPlans] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [topup, setTopup] = useState('500');
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    let active = true;
    Promise.all([api.getBillingSummary(), api.getBillingPlans(), api.getWalletLedger(30).catch(() => ({ entries: [] }))])
      .then(([s, p, l]) => {
        if (!active) return;
        setSummary(s);
        setPlans(p.plans || []);
        setLedger(l.entries || []);
        setError('');
      })
      .catch((err) => { if (active) setError(err.message || 'Could not load billing'); });
    return () => { active = false; };
  }, [reloadKey]);

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

  if (error && !summary) {
    return <Notice tone="error">Billing could not be loaded: {error} <button type="button" onClick={load} style={{ background: 'none', border: 'none', color: C.accent, fontWeight: 700, cursor: 'pointer' }}>Retry</button></Notice>;
  }
  if (!summary) return <p style={{ fontSize: 12, color: C.muted }}>Loading…</p>;

  const sub = summary.subscription;
  const bar = allowanceBar(summary.ai);
  const alerts = summary.alerts || [];

  return (
    <div>
      <SectionTitle>Billing</SectionTitle>
      {!manage && <Notice tone="muted">Only the workspace Owner or an Admin can change the plan or add money.</Notice>}
      {!paymentsOn && <Notice tone="muted">Online payments are not available right now. Contact Getnera to pay for a plan.</Notice>}
      {summary.ai && !summary.ai.allowed && <Notice tone="error">{summary.ai.reason}</Notice>}
      {alerts.slice(0, 2).map((alert) => (
        <Notice key={alert.id} tone={alert.kind === 'ai_blocked' ? 'error' : 'info'}>{alert.message}</Notice>
      ))}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Stat label="Plan" value={sub?.status === 'active' ? sub.plan_name : 'None'} hint={sub?.status === 'active' ? `${formatRupees(sub.price_inr)} a month · ${sub.days_left} days left` : sub?.status === 'expired' ? 'Expired: renew below' : 'Choose a plan below'} />
        <Stat label="Wallet" value={formatInr(summary.wallet.balance_paise)} hint="Pays AI replies beyond the plan, extra seats and numbers" />
        <Stat label="Seats" value={`${summary.seats.used} / ${summary.seats.limit}`} hint={summary.seats.extra ? `${summary.seats.extra} extra this period` : 'Included in the plan'} />
        <Stat label="WhatsApp numbers" value={`${summary.numbers.used} / ${summary.numbers.limit}`} hint={summary.numbers.extra ? `${summary.numbers.extra} extra this period` : 'Included in the plan'} />
      </div>

      <Divider />
      <SubTitle>AI replies</SubTitle>
      <p style={{ fontSize: 12, color: C.text, margin: '0 0 6px' }}>{aiStatusLine(summary)}</p>
      {bar && (<><Bar percent={bar.percent} tone={bar.tone} /><p style={{ fontSize: 10, color: C.muted, margin: 0 }}>{bar.label}</p></>)}
      <p style={{ fontSize: 10, color: C.muted, marginTop: 8 }}>{summary.meta_billing_note}</p>

      <Divider />
      <SubTitle>Plans</SubTitle>
      <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        {plans.map((plan) => {
          const currentPlan = sub?.status === 'active' && sub.plan_code === plan.code;
          return (
            <div key={plan.code} style={{ border: '1px solid ' + (currentPlan ? C.accent : C.border), borderRadius: 12, padding: 14, background: currentPlan ? C.accentDim : C.surface }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{plan.name}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: C.text, margin: '4px 0' }}>{formatRupees(plan.price_inr)}<span style={{ fontSize: 11, color: C.muted, fontWeight: 500 }}> / month</span></div>
              <div style={{ fontSize: 11, color: C.muted, minHeight: 28 }}>{plan.description}</div>
              <ul style={{ paddingLeft: 16, margin: '8px 0', fontSize: 11, color: C.text }}>
                {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
                <li>{plan.ai_replies_month === -1 ? 'Unlimited AI replies' : `${plan.ai_replies_month.toLocaleString('en-IN')} AI replies, then ${formatInr(plan.ai_overage_price_paise)} each`}</li>
                <li>Extra seat {formatRupees(plan.extra_seat_price_inr)} · extra number {formatRupees(plan.extra_number_price_inr)}</li>
              </ul>
              {manage && (
                <Button type="button" busy={busy === plan.code} disabled={!paymentsOn || Boolean(busy)} onClick={() => checkout({ purpose: 'subscription', plan_code: plan.code }, plan.code)} style={{ width: '100%' }}>
                  {busy === plan.code ? 'Opening payment…' : planAction(plan, sub)}
                </Button>
              )}
              {currentPlan && <div style={{ fontSize: 10, color: C.accent, fontWeight: 700, marginTop: 6 }}>Current plan</div>}
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 10, color: C.muted, marginTop: 8 }}>WhatsApp conversation charges are billed by Meta directly to your WhatsApp Business account.</p>

      <Divider />
      <SubTitle>Wallet</SubTitle>
      {manage && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '0 0 160px' }}>
            <label style={{ display: 'block', fontSize: 9, color: C.muted, marginBottom: 5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Top up (₹)</label>
            <input value={topup} onChange={(e) => setTopup(e.target.value)} inputMode="numeric" style={inputStyle()} />
          </div>
          <Button type="button" busy={busy === 'topup'} disabled={!paymentsOn || Boolean(busy)} onClick={startTopup}>{busy === 'topup' ? 'Opening payment…' : 'Add money'}</Button>
          {sub?.status === 'active' && (
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
