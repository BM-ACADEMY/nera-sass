/**
 * Customer panel WhatsApp Number page: the connected number with Meta's status
 * and profile from the inventory, template counts, and nothing secret.
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
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
test.beforeEach(async () => { await clearCollections(); });

test('WhatsApp overview', async (t) => {
  const { Users, Tenants, Clients, MetaWhatsappPhoneNumbers, MetaWhatsappTemplates } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const { encryptToken } = require('../services/clientSecrets');
  const sys = (fn) => runAsSystem(fn, 'test');
  const user = async (tenantId, role) => (await sys(() => Users.create({
    tenant_id: tenantId, role, email: `${role}${tenantId}@shop.test`, name: role, password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
  }))).toObject();
  const bearer = (u) => ({ Authorization: `Bearer ${makeToken(u)}` });

  await t.test('W1. A connected workspace sees its number, Meta status, profile and template counts, never the token', async () => {
    await sys(() => Tenants.create([{ id: 1, name: 'Dress Shop', status: 'active' }, { id: 2, name: 'Other', status: 'active' }]));
    await runAsTenant(1, () => Clients.create({ name: 'Dress Brand', phone_number_id: 'P1234567', wa_business_id: 'W7654321', whatsapp_number: '15556740157', whatsapp_status: 'verified', ...encryptToken('test-dummy-secret-token') }));
    await runAsTenant(2, () => Clients.create({ name: 'Other Brand' }));
    await sys(() => MetaWhatsappPhoneNumbers.create({ phone_number_id: 'P1234567', waba_id: 'W7654321', display_phone_number: '+1 555-674-0157', verified_name: 'Dress Shop', connection_status: 'CONNECTED', quality_rating: 'GREEN', profile_about: 'Best dresses', profile_websites: ['https://dress.test'] }));
    await sys(() => MetaWhatsappTemplates.create([
      { template_id: 'T1', waba_id: 'W7654321', name: 'a', status: 'APPROVED' },
      { template_id: 'T2', waba_id: 'W7654321', name: 'b', status: 'PENDING' },
      { template_id: 'T3', waba_id: 'OTHER', name: 'c', status: 'APPROVED' },
    ]));
    const owner = await user(1, 'owner');
    const res = await request(app).get('/api/whatsapp/overview').set(bearer(owner));
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.connected, true);
    assert.strictEqual(res.body.number.display_phone_number, '+1 555-674-0157');
    assert.strictEqual(res.body.number.quality_rating, 'GREEN');
    assert.strictEqual(res.body.number.phone_number_id, '•••• 4567');
    assert.strictEqual(res.body.profile.about, 'Best dresses');
    assert.deepStrictEqual(res.body.templates, { total: 2, approved: 1, pending: 1, rejected: 0 });
    assert.strictEqual(res.body.can_send, true);
    assert.ok(!JSON.stringify(res.body).includes('test-dummy-secret-token'));
    assert.ok(!JSON.stringify(res.body).includes('P1234567'), 'full Meta ids are masked');

    const other = await request(app).get('/api/whatsapp/overview').set(bearer(await user(2, 'owner')));
    assert.strictEqual(other.body.connected, false, 'another workspace never sees this number');
  });
});
