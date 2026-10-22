/**
 * Staff edit a workspace's WhatsApp Business profile. Meta is stubbed: every
 * outbound axios call is recorded and answered locally, nothing leaves the test.
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const axiosModule = require('axios');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

let app;
const calls = [];
const realRequest = axiosModule.Axios.prototype.request;
let metaProfile = { about: '', description: 'Old description', address: '', email: '', websites: [], vertical: 'OTHER', profile_picture_url: null };

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.META_INVENTORY_ACCESS_TOKEN = 'dummy-inventory-token';
  axiosModule.Axios.prototype.request = async function stub(config) {
    const url = String(config.url || '');
    calls.push({ method: String(config.method || 'get').toUpperCase(), url, data: config.data, auth: config.headers?.Authorization });
    if (!url.startsWith('https://graph.facebook.com/')) throw new Error(`unexpected outbound call ${url}`);
    if (url.endsWith('/whatsapp_business_profile') && String(config.method).toLowerCase() === 'post') {
      const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
      metaProfile = { ...metaProfile, ...body };
      return { data: { success: true }, status: 200 };
    }
    if (url.endsWith('/whatsapp_business_profile')) return { data: { data: [metaProfile] }, status: 200 };
    throw new Error(`unstubbed ${url}`);
  };
  await startTestDb();
  ({ app } = require('../server'));
});

test.after(async () => {
  axiosModule.Axios.prototype.request = realRequest;
  await stopTestDb();
});

const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user, { mfa: true })}` });

test('WhatsApp business profile', async (t) => {
  const { Users, Tenants, Clients, MetaWhatsappAccounts, MetaWhatsappPhoneNumbers, AuditEvents } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const sys = (fn) => runAsSystem(fn, 'test');

  async function seed({ withNumber = true } = {}) {
    await clearCollections();
    calls.length = 0;
    const staff = async (role) => (await sys(() => Users.create({
      tenant_id: null, is_platform_staff: true, staff_role: role, email: `${role}@nera.test`, name: role,
      password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
    }))).toObject();
    const ops = await staff('ops');
    await sys(() => Tenants.create({ id: 1, name: 'Acme', status: 'active' }));
    await runAsTenant(1, () => Clients.create({ name: 'Acme Brand', ...(withNumber ? { phone_number_id: 'P1', wa_business_id: 'W1' } : {}) }));
    await sys(() => MetaWhatsappAccounts.create({ waba_id: 'W1', name: 'Acme WABA', business_id: 'B1' }));
    await sys(() => MetaWhatsappPhoneNumbers.create({ phone_number_id: 'P1', waba_id: 'W1', display_phone_number: '+91 98765 43210', verified_name: 'Acme', raw_data: { name_status: 'APPROVED' } }));
    return { ops };
  }

  await t.test('P1. Reads the live profile from Meta with the platform credential', async () => {
    const { ops } = await seed();
    const res = await request(app).get('/api/admin/tenants/1/whatsapp-profile').set(bearer(ops));
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.source, 'meta');
    assert.strictEqual(res.body.can_sync, true);
    assert.strictEqual(res.body.profile.description, 'Old description');
    assert.strictEqual(res.body.number.name_status, 'APPROVED');
    assert.ok(res.body.manager_url.includes('phone_number_id=P1'));
    assert.ok(calls.every((c) => c.auth === 'Bearer dummy-inventory-token'));
  });

  await t.test('P2. Saving sends the profile to Meta, updates the brand and is audited', async () => {
    const { ops } = await seed();
    const res = await request(app).put('/api/admin/tenants/1/whatsapp-profile').set(bearer(ops)).send({
      vertical: 'PROF_SERVICES', description: 'An AI-powered WhatsApp CRM', address: 'First Floor, 78 Lenin Street',
      email: 'support@getnera.in', websites: ['https://getnera.in', 'https://www.getnera.in'],
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/P1/whatsapp_business_profile'));
    const sent = typeof post.data === 'string' ? JSON.parse(post.data) : post.data;
    assert.strictEqual(sent.vertical, 'PROF_SERVICES');
    assert.deepStrictEqual(sent.websites, ['https://getnera.in', 'https://www.getnera.in']);
    const brand = await runAsTenant(1, () => Clients.findOne({}).lean());
    assert.strictEqual(brand.wa_category, 'Professional services');
    assert.strictEqual(brand.wa_email, 'support@getnera.in');
    assert.strictEqual(brand.wa_website_2, 'https://www.getnera.in');
    assert.ok(await sys(() => AuditEvents.exists({ event: 'BRAND_UPDATED', tenant_id: 1 })));
  });

  await t.test('P3. Invalid input is refused before anything reaches Meta', async () => {
    const { ops } = await seed();
    for (const bad of [{ vertical: 'NOPE' }, { email: 'not-an-email' }, { websites: ['getnera.in'] }, { description: 'x'.repeat(513) }]) {
      const res = await request(app).put('/api/admin/tenants/1/whatsapp-profile').set(bearer(ops)).send({ vertical: 'OTHER', ...bad });
      assert.strictEqual(res.status, 400, JSON.stringify(bad));
    }
    assert.strictEqual(calls.filter((c) => c.method === 'POST').length, 0);
  });

  await t.test('P4. Without a number the profile is saved in Getnera only; customers cannot use these routes', async () => {
    const { ops } = await seed({ withNumber: false });
    const view = await request(app).get('/api/admin/tenants/1/whatsapp-profile').set(bearer(ops));
    assert.strictEqual(view.body.can_sync, false);
    // Saved on the brand only; it goes to Meta once a number is connected.
    const save = await request(app).put('/api/admin/tenants/1/whatsapp-profile').set(bearer(ops)).send({ vertical: 'RETAIL', email: 'hi@acme.test' });
    assert.strictEqual(save.status, 200, JSON.stringify(save.body));
    assert.strictEqual(save.body.saved_to_meta, false);
    const brand = await runAsTenant(1, () => Clients.findOne({}).lean());
    assert.strictEqual(brand.wa_category, 'Shopping and retail');
    assert.strictEqual(brand.wa_email, 'hi@acme.test');
    const owner = (await runAsTenant(1, () => Users.create({ role: 'owner', email: 'o@acme.test', name: 'O', is_active: true, token_version: 0 }))).toObject();
    assert.strictEqual((await request(app).get('/api/admin/tenants/1/whatsapp-profile').set(bearer(owner))).status, 403);
    assert.strictEqual(calls.length, 0);
  });
});
