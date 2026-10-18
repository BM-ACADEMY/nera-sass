/**
 * Founder Reports: MRR / TCV (business decisions 1–5, services/platformMetrics.js).
 *  Unit: contracted monthly amount, grace, manual grants, staff suspension,
 *        legacy fields, currencies, duplicates, orphans, renewals.
 *  API:  GET /api/admin/reports/founder-dashboard on the real server with
 *        subscriptions created by the real provisioning/renewal code.
 * In-memory MongoDB, synthetic data, no outbound calls.
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const mongoose = require('mongoose');
const { startTestDb, stopTestDb, clearCollections, seedTestPlans, makeToken } = require('./setup');
const { computeSubscriptionMetrics } = require('../services/platformMetrics');

const DAY = 86400000;
const NOW = new Date('2026-10-17T06:00:00Z');
const at = (days) => new Date(NOW.getTime() + days * DAY);
const contract = (monthly, months) => Math.round(monthly * months * (1 - ({ 1: 0, 3: 5, 6: 10, 12: 15 })[months] / 100));
// A verified paid 1-month WA-STARTER subscription in force today.
const sub = (id, tenantId, fields = {}) => {
  const months = fields.term_months ?? 1;
  const monthly = fields.monthly_price ?? 5999;
  return {
    id, tenant_id: tenantId, status: 'active', plan_code: 'WA-STARTER', currency: 'INR', payment_method: 'razorpay',
    monthly_price: monthly, term_months: months, discount_pct: ({ 1: 0, 3: 5, 6: 10, 12: 15 })[months], contract_value: contract(monthly, months),
    current_period_start: at(-10), current_period_end: at(20), ...fields,
  };
};
const tenants = [{ id: 1, status: 'active' }, { id: 2, status: 'active' }, { id: 3, status: 'suspended' }, { id: 4, status: 'deleted' }];
const run = (subscriptions, extraTenants = []) => computeSubscriptionMetrics({ tenants: [...tenants, ...extraTenants], subscriptions, now: NOW });

test('MRR rules (unit)', async (t) => {
  await t.test('D1. Discounted annual contract: MRR = contract value / term, not list price; onboarding fee excluded', () => {
    const annual = sub(1, 1, { term_months: 12, onboarding_fee: 4999, current_period_end: at(300) });
    const m = run([annual]);
    assert.strictEqual(annual.contract_value, 61190, 'Pricing Spec: 5,999 × 12 less 15%');
    assert.strictEqual(m.mrr, 5099.17, '61,190 / 12, not the 5,999 list price');
    assert.strictEqual(m.totalContractValue, 61190);
    assert.strictEqual(m.activeSubscriptions, 1);
  });

  await t.test('D2. Every authorised term (1/3/6/12) uses its own contract; an unauthorised discount is excluded, not trusted', () => {
    for (const months of [1, 3, 6, 12]) {
      const m = run([sub(1, 1, { term_months: months, current_period_end: at(months * 30) })]);
      assert.strictEqual(m.mrr, Math.round((contract(5999, months) / months) * 100) / 100, `${months} months`);
    }
    const bad = run([
      sub(1, 1, { term_months: 12, discount_pct: 40, contract_value: Math.round(5999 * 12 * 0.6) }),
      sub(2, 2, { term_months: 12, contract_value: 50000 }),
      sub(3, 3, { term_months: 2, discount_pct: 0, contract_value: 11998 }),
      sub(5, 5, { contract_value: null }),
    ], [{ id: 5, status: 'active' }]);
    assert.strictEqual(bad.mrr, 0);
    assert.deepStrictEqual(bad.excluded.contract_unverified.items.map((i) => i.reason),
      ['unauthorised_discount', 'contract_value_mismatch', 'unauthorised_term', 'missing_contract_value']);
  });

  await t.test('D3. Grace (days 1–7 after expiry) is at-risk, not MRR; day 8+ is lapsed; an approved renewal in force counts', () => {
    const m = run([
      sub(1, 1, { current_period_start: at(-33), current_period_end: at(-3) }),
      sub(2, 2, { current_period_start: at(-40), current_period_end: at(-10) }),
    ]);
    assert.strictEqual(m.mrr, 0);
    assert.deepStrictEqual([m.at_risk_grace.count, m.at_risk_grace.subscription_ids], [1, [1]]);
    assert.deepStrictEqual(m.at_risk_grace.mrr_by_currency, { INR: 5999 });
    assert.strictEqual(m.excluded.lapsed.count, 1);
    assert.strictEqual(m.totalContractValue, 0, 'ended contracts are not in TCV');
    const renewed = run([
      sub(1, 1, { current_period_start: at(-40), current_period_end: at(-10) }),
      sub(2, 1, { current_period_start: at(-10), current_period_end: at(20) }),
    ]);
    assert.strictEqual(renewed.mrr, 5999, 'the renewal in force counts');
    assert.strictEqual(renewed.excluded.lapsed.count, 1);
  });

  await t.test('D4. Manual grants (free or offline-paid, indistinguishable) are never revenue; reported separately', () => {
    const m = run([
      sub(1, 1),
      sub(2, 2, { payment_method: 'manual_grant', term_months: 12, current_period_end: at(300) }),
      sub(3, 3, { payment_method: undefined }),
    ]);
    assert.strictEqual(m.mrr, 5999, 'only the verified paid one');
    assert.strictEqual(m.activeSubscriptions, 1);
    assert.strictEqual(m.manual_grant_unverified.workspaces, 2, 'unknown payment method is also unverified');
    assert.deepStrictEqual(m.manual_grant_unverified.mrr_by_currency, { INR: 5099.17 + 5999 });
    assert.deepStrictEqual(m.manual_grant_unverified.tcv_by_currency, { INR: 61190 + 5999 });
    assert.strictEqual(m.totalContractValue, 5999, 'TCV headline is paid only');
  });

  await t.test('D5. A staff-suspended workspace with a paid contract in force still counts, and is listed separately', () => {
    const m = run([sub(1, 1), sub(3, 3)]);
    assert.strictEqual(m.mrr, 5999 * 2);
    assert.deepStrictEqual([m.staff_suspended.count, m.staff_suspended.tenant_ids], [1, [3]]);
    assert.deepStrictEqual(m.staff_suspended.mrr_by_currency, { INR: 5999 });
    const cancelled = run([sub(3, 3, { status: 'cancelled' })]);
    assert.deepStrictEqual([cancelled.mrr, cancelled.staff_suspended.count], [0, 0], 'cancellation still applies');
    const expired = run([sub(3, 3, { current_period_start: at(-40), current_period_end: at(-12) })]);
    assert.deepStrictEqual([expired.mrr, expired.staff_suspended.count], [0, 0], 'expiry still applies');
  });

  await t.test('D6. Legacy-only rows are excluded with a reason, never interpreted', () => {
    const legacy = { id: 7, tenant_id: 1, status: 'active', plan: 'starter', price_monthly: 5999, starts_at: at(-5), expires_at: at(25) };
    const m = run([legacy, { id: 8, tenant_id: 2, status: 'active', price_monthly: 'abc' }]);
    assert.strictEqual(m.mrr, 0);
    assert.deepStrictEqual(m.excluded.legacy_unconfirmed.items, [
      { subscription_id: 7, reason: 'legacy_units_and_currency_unconfirmed' },
      { subscription_id: 8, reason: 'legacy_units_and_currency_unconfirmed' },
    ]);
  });

  await t.test('D7. INR and foreign currencies are reported separately, never added', () => {
    const m = run([sub(1, 1), sub(2, 2, { currency: 'USD', monthly_price: 79, contract_value: 79 })]);
    assert.strictEqual(m.mrr, 5999);
    assert.deepStrictEqual(m.paid.mrr_by_currency, { INR: 5999, USD: 79 });
    assert.deepStrictEqual(m.paid.tcv_by_currency, { INR: 5999, USD: 79 });
    assert.strictEqual(m.totalContractValue, 5999);
    assert.strictEqual(m.activeSubscriptions, 2, 'both workspaces pay');
  });

  await t.test('D8. Duplicates: same row twice, or the same contract stored twice, count once in MRR and TCV', () => {
    const one = sub(1, 1, { term_months: 12, current_period_end: at(300) });
    const m = run([one, { ...one }, { ...one, id: 2 }]);
    assert.strictEqual(m.mrr, 5099.17);
    assert.strictEqual(m.totalContractValue, 61190);
    assert.strictEqual(m.excluded.duplicate_rows.count, 2);
  });

  await t.test('D9. Renewal scheduled after the current period: once in MRR, both contracts in TCV', () => {
    const m = run([
      sub(1, 1, { current_period_start: at(-25), current_period_end: at(5) }),
      sub(2, 1, { current_period_start: at(5), current_period_end: at(35) }),
    ]);
    assert.strictEqual(m.mrr, 5999);
    assert.strictEqual(m.excluded.scheduled.count, 1);
    assert.strictEqual(m.totalContractValue, 5999 * 2);
  });

  await t.test('D10. Orphans never count; overlapping in-force rows count the latest; empty means zeros', () => {
    const m = run([sub(1, 1), sub(10, null), sub(11, 999), sub(12, 4)]);
    assert.strictEqual(m.mrr, 5999);
    assert.deepStrictEqual(m.excluded.orphan, { count: 3, subscription_ids: [10, 11, 12] });
    const overlap = run([sub(1, 1, { current_period_start: at(-20) }), sub(2, 1, { monthly_price: 9999, contract_value: 9999, current_period_start: at(-2) })]);
    assert.strictEqual(overlap.mrr, 9999);
    assert.strictEqual(overlap.excluded.superseded_overlap.count, 1);
    const empty = run([]);
    assert.deepStrictEqual([empty.mrr, empty.totalContractValue, empty.activeSubscriptions], [0, 0, 0]);
  });
});

test('Founder Reports API', async (t) => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  await startTestDb();
  const { app } = require('../server');
  const { Users, Tenants, Subscriptions } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const provisioning = require('../services/provisioning');
  const sys = (fn) => runAsSystem(fn, 'test');
  const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user, { mfa: true })}` });
  const createUser = async (fields) => (await sys(() => Users.create({ password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0, ...fields }))).toObject();
  const grant = (reference) => ({ method: 'manual_grant', reference, reason: 'Synthetic test grant' });

  try {
    await t.test('A1. Real provisioning (manual grant) + same-plan renewal + orphan + a paid workspace', async () => {
      await clearCollections();
      await seedTestPlans();
      const founder = await createUser({ tenant_id: null, is_platform_staff: true, staff_role: 'founder', email: 'founder@nera.test', name: 'Founder' });
      const created = await provisioning.provisionTenant({
        business_name: 'Synthetic Motors', owner_email: 'owner@synthetic.test', owner_name: 'Owner', plan_code: 'WA-STARTER', term_months: 12, payment: grant('APPROVAL-1'),
      }, { actorUserId: founder.id });
      await provisioning.grantSubscription(created.tenant.id, { plan_code: 'WA-STARTER', term_months: 1, payment: grant('APPROVAL-2') }, { actorUserId: founder.id });
      // A verified paid workspace, as the gateway would record it.
      await sys(() => Tenants.create({ id: 50, name: 'Paid Co', status: 'active' }));
      await runAsTenant(50, () => Subscriptions.create({
        plan_code: 'WA-STARTER', status: 'active', payment_method: 'razorpay', payment_reference: 'pay_synthetic', currency: 'INR',
        monthly_price: 5999, term_months: 12, discount_pct: 15, contract_value: 61190,
        current_period_start: new Date(Date.now() - 5 * DAY), current_period_end: new Date(Date.now() + 360 * DAY),
      }));
      // An orphan, as found in nera-saas.
      await mongoose.connection.collection('subscriptions').insertOne({
        id: 9001, tenant_id: 2, status: 'active', payment_method: 'razorpay', plan_code: 'WA-GROWTH', monthly_price: 12999, term_months: 12, discount_pct: 15,
        contract_value: 132590, currency: 'INR', current_period_start: new Date(Date.now() - 2 * DAY), current_period_end: new Date(Date.now() + 360 * DAY),
      });

      const res = await request(app).get('/api/admin/reports/founder-dashboard').set(bearer(founder));
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const s = res.body.snapshot;
      assert.strictEqual(s.mrr, 5099.17, 'only the verified paid annual contract, at its contracted monthly amount');
      assert.strictEqual(s.activeSubscriptions, 1);
      assert.strictEqual(s.totalContractValue, 61190);
      assert.strictEqual(s.manual_grant_unverified.workspaces, 1, 'the granted workspace counted once despite its renewal');
      assert.deepStrictEqual(s.manual_grant_unverified.mrr_by_currency, { INR: 5099.17 });
      assert.deepStrictEqual(s.manual_grant_unverified.tcv_by_currency, { INR: 61190 + 5999 }, 'annual grant + scheduled 1-month renewal');
      assert.strictEqual(s.excluded.scheduled.count, 1);
      assert.deepStrictEqual(s.excluded.orphan, { count: 1, subscription_ids: [9001] });
    });

    await t.test('A2. Founder Reports stay staff-only', async () => {
      await clearCollections();
      await sys(() => Tenants.create({ id: 10, name: 'W10', status: 'active' }));
      const owner = await createUser({ tenant_id: 10, role: 'owner', email: 'o@w10.test', name: 'O' });
      await runAsTenant(10, () => Subscriptions.create({ plan_code: 'T', status: 'active', limits: {}, current_period_start: new Date(Date.now() - DAY), current_period_end: new Date(Date.now() + 30 * DAY) }));
      assert.strictEqual((await request(app).get('/api/admin/reports/founder-dashboard').set(bearer(owner))).status, 403);
      assert.strictEqual((await request(app).get('/api/admin/reports/founder-dashboard')).status, 401);
      for (const role of ['founder', 'ops']) {
        const staff = await createUser({ tenant_id: null, is_platform_staff: true, staff_role: role, email: `${role}2@nera.test`, name: role });
        assert.strictEqual((await request(app).get('/api/admin/reports/founder-dashboard').set(bearer(staff))).status, 200, role);
      }
      // The retired "support" role carries no permission.
      const retired = await createUser({ tenant_id: null, is_platform_staff: true, staff_role: 'support', email: 'support2@nera.test', name: 'support' });
      assert.strictEqual((await request(app).get('/api/admin/reports/founder-dashboard').set(bearer(retired))).status, 403);
    });
  } finally {
    await stopTestDb();
  }
});
