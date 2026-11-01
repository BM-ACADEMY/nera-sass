/**
 * GET /api/leads/:id never returns the brand's WhatsApp token, to a customer
 * or to platform staff. In-memory MongoDB.
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

test.after(async () => {
  await stopTestDb();
});

test('Lead details carry no WhatsApp token', async () => {
  await clearCollections();
  const { Tenants, Clients, Leads, Users } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const SECRET = 'test-dummy-secret-token';
  await runAsSystem(() => Tenants.create({ id: 1, name: 'Acme', status: 'active' }), 'test');
  const lead = await runAsTenant(1, async () => {
    const brand = await Clients.create({ name: 'Acme', phone_number_id: 'PN1', wa_access_token: SECRET });
    return (await Leads.create({ name: 'Ravi', phone: '919876543210', client_id: brand.id })).toObject();
  });
  const users = await runAsSystem(() => Users.create([
    { tenant_id: 1, role: 'owner', email: 'owner@t.test', name: 'Owner', is_active: true, token_version: 0 },
    { tenant_id: null, is_platform_staff: true, role: 'founder', staff_role: 'founder', email: 'staff@t.test', name: 'Staff', is_active: true, token_version: 0 },
  ]), 'test');

  const customer = await request(app).get(`/api/leads/${lead.id}`).set('Authorization', `Bearer ${makeToken(users[0].toObject())}`);
  assert.strictEqual(customer.status, 200, JSON.stringify(customer.body));
  assert.strictEqual(customer.body.lead.phone_number_id, 'PN1');
  assert.ok(!JSON.stringify(customer.body).includes(SECRET));

  const staff = await request(app).get(`/api/leads/${lead.id}`).set('Authorization', `Bearer ${makeToken(users[1].toObject())}`);
  assert.ok(!JSON.stringify(staff.body).includes(SECRET), 'staff responses are not covered by the customer guard');
});
