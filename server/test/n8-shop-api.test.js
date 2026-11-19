/**
 * N8: products and orders API. Real server.js app, in-memory MongoDB.
 */
const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

let app;
test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  await startTestDb();
  ({ app } = require('../server'));
});
test.after(async () => { await stopTestDb(); });

test('N8: shop products and orders', async (t) => {
  const { Users, Tenants } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const shop = require('../services/shopOrders');
  const sys = (fn) => runAsSystem(fn, 'test');
  const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user)}` });
  t.beforeEach(async () => { await clearCollections(); });

  async function workspace(tenantId) {
    const mk = async (role) => (await sys(() => Users.create({ is_active: true, token_version: 0, password_hash: 'x', tenant_id: tenantId, role, email: `${role}${tenantId}@acme.test`, name: role }))).toObject();
    const owner = await mk('owner');
    await sys(() => Tenants.create({ id: tenantId, name: `Workspace ${tenantId}`, status: 'active', owner_user_id: owner.id }));
    return { owner, agent: await mk('agent') };
  }

  await t.test('P1. Owners manage products; prices are validated; names are unique per workspace; remove switches off', async () => {
    const a = await workspace(1);
    const made = await request(app).post('/api/shop/products').set(bearer(a.owner)).send({ name: 'Chicken Biryani', price_inr: 180.5, description: 'Serves one' });
    assert.strictEqual(made.status, 201, JSON.stringify(made.body));
    assert.strictEqual(made.body.product.price_paise, 18050);
    for (const bad of [{ name: '', price_inr: 10 }, { name: 'X', price_inr: 0 }, { name: 'X', price_inr: -5 }, { name: 'X', price_inr: 10.555 }, { name: 'X', price_inr: 999999 }, { name: 'X' }]) {
      assert.strictEqual((await request(app).post('/api/shop/products').set(bearer(a.owner)).send(bad)).status, 400, JSON.stringify(bad));
    }
    assert.strictEqual((await request(app).post('/api/shop/products').set(bearer(a.owner)).send({ name: '  chicken   BIRYANI ', price_inr: 1 })).status, 409, 'same name in other letters');
    const updated = await request(app).put(`/api/shop/products/${made.body.product.id}`).set(bearer(a.owner)).send({ price_inr: 200 });
    assert.strictEqual(updated.body.product.price_paise, 20000);
    const removed = await request(app).delete(`/api/shop/products/${made.body.product.id}`).set(bearer(a.owner));
    assert.strictEqual(removed.body.product.active, false);
    assert.strictEqual((await runAsTenant(1, () => shop.listProducts({ activeOnly: true }))).length, 0);
    assert.strictEqual((await request(app).post('/api/shop/products').set(bearer(a.agent)).send({ name: 'Raita', price_inr: 30 })).status, 403, 'an agent cannot change the price list');
    assert.strictEqual((await request(app).get('/api/shop/products')).status, 401);
  });

  await t.test('P2. Another workspace never sees or changes these products or orders', async () => {
    const a = await workspace(1); const b = await workspace(2);
    const made = await request(app).post('/api/shop/products').set(bearer(a.owner)).send({ name: 'Raita', price_inr: 30 });
    assert.strictEqual((await request(app).get('/api/shop/products').set(bearer(b.owner))).body.products.length, 0);
    assert.strictEqual((await request(app).put(`/api/shop/products/${made.body.product.id}`).set(bearer(b.owner)).send({ price_inr: 1 })).status, 404);
    const order = await runAsTenant(1, () => shop.store.place({ lead: { id: 5, phone: '919876543210' }, name: 'Ravi', items: [{ product_id: 1, name: 'Raita', unit_paise: 3000, quantity: 2 }], total: 6000, language: 'en' }));
    assert.strictEqual((await request(app).get('/api/shop/orders').set(bearer(b.owner))).body.orders.length, 0);
    assert.strictEqual((await request(app).put(`/api/shop/orders/${order.id}`).set(bearer(b.owner)).send({ status: 'paid' })).status, 404);
  });

  await t.test('P3. Orders are numbered per workspace and move pending -> paid -> fulfilled; no skipping or going back', async () => {
    const a = await workspace(1); const b = await workspace(2);
    const place = (tenantId) => runAsTenant(tenantId, () => shop.store.place({ lead: { id: 5 }, name: 'Ravi', items: [{ product_id: 1, name: 'Raita', unit_paise: 3000, quantity: 1 }], total: 3000, language: 'en' }));
    const first = await place(1); const second = await place(1); const other = await place(2);
    assert.deepStrictEqual([first.order_no, second.order_no, other.order_no], [1, 2, 1]);
    const list = await request(app).get('/api/shop/orders?status=pending_payment').set(bearer(a.owner));
    assert.strictEqual(list.body.orders.length, 2);
    assert.strictEqual((await request(app).put(`/api/shop/orders/${first.id}`).set(bearer(a.owner)).send({ status: 'fulfilled' })).status, 409, 'cannot fulfil before paid');
    const paid = await request(app).put(`/api/shop/orders/${first.id}`).set(bearer(a.owner)).send({ status: 'paid' });
    assert.strictEqual(paid.status, 200, JSON.stringify(paid.body));
    assert.ok(paid.body.order.paid_at);
    assert.strictEqual((await request(app).put(`/api/shop/orders/${first.id}`).set(bearer(a.owner)).send({ status: 'fulfilled' })).status, 200);
    assert.strictEqual((await request(app).put(`/api/shop/orders/${first.id}`).set(bearer(a.owner)).send({ status: 'cancelled' })).status, 409, 'a fulfilled order is final');
    assert.strictEqual((await request(app).put(`/api/shop/orders/${first.id}`).set(bearer(a.owner)).send({ status: 'bogus' })).status, 400);
    assert.ok(b.owner);
  });
});
