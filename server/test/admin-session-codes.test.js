/**
 * The admin app signs a user out only on 401, or on 403 with STAFF_ONLY or
 * NO_WORKSPACE (admin/src/api/sessionPolicy.js). These tests pin the server
 * responses that policy relies on. Real server.js app, in-memory MongoDB; no
 * Meta credential is configured, so no Meta call can be made.
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

process.env.META_INVENTORY_ACCESS_TOKEN = '';
process.env.META_PHONE_REGISTRATION_ENABLED = '';

let app;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  await startTestDb();
  ({ app } = require('../server'));
});

test.after(async () => {
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearCollections();
});

test('Admin session codes', async (t) => {
  const { Users, Tenants } = require('../models');
  const { runAsSystem } = require('../services/tenantContext');
  const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user, { mfa: true })}` });
  const createUser = async (fields) => (await runAsSystem(() => Users.create({
    password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0, ...fields,
  }))).toObject();
  const staff = (role, extra = {}) => createUser({ tenant_id: null, is_platform_staff: true, staff_role: role, email: `${role}@nera.test`, name: role, ...extra });

  await t.test('S1. A permission denial is 403 with `permission` and no session-ending code', async () => {
    const ops = await staff('ops');
    const res = await request(app).delete('/api/admin/meta/whatsapp/cache/wabas/waba-1').set(bearer(ops));
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.permission, 'platform.meta.admin');
    assert.ok(!['STAFF_ONLY', 'NO_WORKSPACE'].includes(res.body.code));
    // The same session still works afterwards.
    assert.strictEqual((await request(app).get('/api/admin/me').set(bearer(ops))).status, 200);
  });

  await t.test('S2. A business refusal (registration disabled) is 403 REGISTRATION_DISABLED', async () => {
    const founder = await staff('founder');
    const res = await request(app).post('/api/admin/meta/whatsapp/phone-numbers/p-1/register').set(bearer(founder)).send({ pin: '123456' });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'REGISTRATION_DISABLED');
  });

  await t.test('S3. A customer token on the admin API is 403 STAFF_ONLY', async () => {
    await runAsSystem(() => Tenants.create({ id: 10, name: 'Customer', status: 'active' }));
    const owner = await createUser({ tenant_id: 10, role: 'owner', email: 'owner@acme.test', name: 'Owner' });
    const res = await request(app).get('/api/admin/me').set(bearer(owner));
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'STAFF_ONLY');
  });

  await t.test('S4. An account with no workspace and no staff role is 403 NO_WORKSPACE', async () => {
    const orphan = await createUser({ tenant_id: null, role: 'agent', email: 'orphan@nera.test', name: 'Orphan' });
    const res = await request(app).get('/api/admin/me').set(bearer(orphan));
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'NO_WORKSPACE');
  });

  await t.test('S5. Missing, invalid, revoked and deactivated sessions are 401', async () => {
    const founder = await staff('founder');
    const revokedToken = makeToken(founder, { mfa: true });
    await runAsSystem(() => Users.updateOne({ id: founder.id }, { $set: { token_version: 1 } }));
    const inactive = await staff('ops', { is_active: false });
    const attempts = [
      ['missing', {}],
      ['invalid', { Authorization: 'Bearer not-a-real-token' }],
      ['revoked', { Authorization: `Bearer ${revokedToken}` }],
      ['deactivated', bearer(inactive)],
    ];
    for (const [label, headers] of attempts) {
      const res = await request(app).get('/api/admin/me').set(headers);
      assert.strictEqual(res.status, 401, `${label} returned ${res.status}`);
    }
  });
});
