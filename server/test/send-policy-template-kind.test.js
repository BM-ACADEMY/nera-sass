/**
 * sendPolicy.templateKind: a template's kind (marketing needs opt-in) comes
 * only from the sending workspace's own template (its WABA, its language),
 * never from another workspace's template with the same name. Unknown
 * templates count as marketing. Meta is stubbed; no real call leaves.
 */
const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, TEST_INTERNAL_KEY } = require('./setup');

let app;
const metaCalls = [];
const realPost = axios.post;

let Users, Tenants, Clients, Leads, Conversations, Messages, Templates, MetaWhatsappTemplates, MetaWhatsappPhoneNumbers;
let runAsSystem, runAsTenant, encryptToken, sendPolicy, consent;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  delete process.env.WA_UNKNOWN_TEMPLATE_KIND;
  await startTestDb();
  ({ Users, Tenants, Clients, Leads, Conversations, Messages, Templates, MetaWhatsappTemplates, MetaWhatsappPhoneNumbers } = require('../models'));
  ({ runAsSystem, runAsTenant } = require('../services/tenantContext'));
  ({ encryptToken } = require('../services/clientSecrets'));
  sendPolicy = require('../services/sendPolicy');
  consent = require('../services/consent');
  ({ app } = require('../server'));
  axios.post = async (url, body) => {
    if (!/^https:\/\/graph\.facebook\.com\//.test(url)) throw new Error(`Unexpected URL in test: ${url}`);
    metaCalls.push({ url, body });
    return { data: { messages: [{ id: `wamid.${metaCalls.length}` }] } };
  };
});

test.after(async () => {
  axios.post = realPost;
  await stopTestDb();
});

test.beforeEach(async () => {
  metaCalls.length = 0;
  await clearCollections();
});

const service = (tenantId) => ({ 'x-internal-key': TEST_INTERNAL_KEY, 'x-tenant-id': String(tenantId) });

// A workspace with one verified brand on its own number and WABA, a lead whose
// 24-hour window is closed, and no consent recorded.
async function seed(tenantId, { withPhoneRow = true } = {}) {
  const phoneNumberId = `PN${tenantId}`;
  const wabaId = `WABA${tenantId}`;
  await runAsSystem(() => Tenants.create({ id: tenantId, name: `Shop ${tenantId}`, status: 'active', owner_user_id: null }), 'test');
  const owner = (await runAsSystem(() => Users.create({
    tenant_id: tenantId, role: 'owner', email: `owner${tenantId}@shop.test`, name: 'Owner', password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
  }), 'test')).toObject();
  await runAsSystem(() => Tenants.updateOne({ id: tenantId }, { $set: { owner_user_id: owner.id } }), 'test');
  return runAsTenant(tenantId, async () => {
    const brand = (await Clients.create({
      name: `Brand ${tenantId}`, phone_number_id: phoneNumberId, wa_business_id: wabaId, whatsapp_number: `+91 90000 0000${tenantId}`, whatsapp_status: 'verified', ...encryptToken(`test-dummy-token-${tenantId}`),
    })).toObject();
    if (withPhoneRow) await MetaWhatsappPhoneNumbers.create({ phone_number_id: phoneNumberId, waba_id: wabaId, client_id: brand.id });
    const phone = `91987654321${tenantId}`;
    const lead = (await Leads.create({ name: 'Ravi', phone, client_id: brand.id, status: 'new' })).toObject();
    const conversation = await Conversations.create({ lead_id: lead.id, phone: phone.slice(-10), status: 'open' });
    const old = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    await Messages.create({ conversation_id: conversation.id, direction: 'inbound', content: 'hi', sent_at: old });
    await Leads.updateOne({ id: lead.id }, { $set: { last_inbound_at: old } });
    return { brand, lead, phoneNumberId, wabaId };
  });
}

const metaTemplate = (tenantId, fields) => runAsTenant(tenantId, () => MetaWhatsappTemplates.create({ status: 'APPROVED', components: [{ type: 'BODY', text: 'Hi' }], ...fields }));

test('TK1. same template name, different category in two workspaces: each gets its own', async () => {
  const one = await seed(1);
  const two = await seed(2);
  await metaTemplate(1, { template_id: 'M1', waba_id: one.wabaId, name: 'offer_update', language: 'en', category: 'MARKETING' });
  await metaTemplate(2, { template_id: 'M2', waba_id: two.wabaId, name: 'offer_update', language: 'en', category: 'UTILITY' });

  const scope1 = { phoneNumberId: one.phoneNumberId, clientId: one.brand.id, language: 'en' };
  const scope2 = { phoneNumberId: two.phoneNumberId, clientId: two.brand.id, language: 'en' };
  assert.strictEqual(await runAsTenant(1, () => sendPolicy.templateKind('offer_update', scope1)), 'marketing');
  assert.strictEqual(await runAsTenant(2, () => sendPolicy.templateKind('offer_update', scope2)), 'utility');
  // Without the sender, inside a workspace: only that workspace's own rows.
  assert.strictEqual(await runAsTenant(1, () => sendPolicy.templateKind('offer_update')), 'marketing');
  assert.strictEqual(await runAsTenant(2, () => sendPolicy.templateKind('offer_update')), 'utility');

  // Through the real send path: tenant 1's marketing template still needs
  // consent although tenant 2 has a utility template with the same name.
  const blocked = await request(app).post('/api/internal/send-template').set(service(1)).send({ lead_id: one.lead.id, template: 'offer_update' });
  assert.strictEqual(blocked.status, 403, JSON.stringify(blocked.body));
  assert.strictEqual(blocked.body.code, 'CONSENT_REQUIRED');
  assert.strictEqual(metaCalls.length, 0);

  // And tenant 2's utility template is not blocked by tenant 1's marketing one.
  const sent = await request(app).post('/api/internal/send-template').set(service(2)).send({ lead_id: two.lead.id, template: 'offer_update' });
  assert.strictEqual(sent.status, 200, JSON.stringify(sent.body));
  assert.strictEqual(metaCalls.length, 1);

  await runAsTenant(1, () => consent.recordOptIn({ leadId: one.lead.id, source: 'form', text: 'Agreed' }));
  const allowed = await request(app).post('/api/internal/send-template').set(service(1)).send({ lead_id: one.lead.id, template: 'offer_update' });
  assert.strictEqual(allowed.status, 200, JSON.stringify(allowed.body));
});

test('TK2. the template is looked up in the sender WABA and language', async () => {
  const one = await seed(1);
  // Two WABAs in the same workspace, and two languages in one WABA.
  await metaTemplate(1, { template_id: 'M1', waba_id: one.wabaId, name: 'order_note', language: 'en_US', category: 'UTILITY' });
  await metaTemplate(1, { template_id: 'M2', waba_id: one.wabaId, name: 'order_note', language: 'ta', category: 'MARKETING' });
  await metaTemplate(1, { template_id: 'M3', waba_id: 'WABA_OTHER', name: 'other_waba_only', language: 'en', category: 'UTILITY' });

  const scope = { phoneNumberId: one.phoneNumberId, clientId: one.brand.id };
  const kind = (name, language) => runAsTenant(1, () => sendPolicy.templateKind(name, { ...scope, language }));
  assert.strictEqual(await kind('order_note', 'en_US'), 'utility');
  assert.strictEqual(await kind('order_note', 'en'), 'utility', 'same base language');
  assert.strictEqual(await kind('order_note', 'ta'), 'marketing');
  assert.strictEqual(await kind('order_note', 'hi'), 'marketing', 'language not in the WABA counts as unknown');
  assert.strictEqual(await kind('order_note', null), 'marketing', 'languages disagree and none was given: marketing');
  assert.strictEqual(await kind('other_waba_only', 'en'), 'marketing', 'a template of another WABA does not count');
});

test('TK3. unknown templates count as marketing (consent required)', async () => {
  const one = await seed(1);
  // Another workspace has a utility template with this name; this one has none.
  const two = await seed(2);
  await metaTemplate(2, { template_id: 'M9', waba_id: two.wabaId, name: 'shipping_info', language: 'en', category: 'UTILITY' });

  assert.strictEqual(await runAsTenant(1, () => sendPolicy.templateKind('shipping_info', { phoneNumberId: one.phoneNumberId, clientId: one.brand.id, language: 'en' })), 'marketing');
  assert.strictEqual(await runAsTenant(1, () => sendPolicy.templateKind('shipping_info')), 'marketing');
  assert.strictEqual(await runAsTenant(1, () => sendPolicy.templateKind('')), 'marketing');
  // Outside any workspace with no sender: nothing to look in, so marketing.
  assert.strictEqual(await runAsSystem(() => sendPolicy.templateKind('shipping_info'), 'test'), 'marketing');

  const blocked = await request(app).post('/api/internal/send-template').set(service(1)).send({ lead_id: one.lead.id, template: 'shipping_info' });
  assert.strictEqual(blocked.status, 403, JSON.stringify(blocked.body));
  assert.strictEqual(blocked.body.code, 'CONSENT_REQUIRED');
  assert.strictEqual(metaCalls.length, 0);
});

test('TK4. a template written in Getnera counts once Meta has it, for its brand', async () => {
  const one = await seed(1, { withPhoneRow: false });
  await runAsTenant(1, () => Templates.create({ name: 'payment_done', category: 'UTILITY', body: 'Paid', status: 'approved', client_id: one.brand.id, meta_template_id: 'T1' }));
  await runAsTenant(1, () => Templates.create({ name: 'draft_only', category: 'UTILITY', body: 'Draft', status: 'draft', client_id: one.brand.id }));
  await runAsTenant(1, () => Templates.create({ name: 'other_brand', category: 'UTILITY', body: 'Other', status: 'approved', client_id: one.brand.id + 100, meta_template_id: 'T2' }));

  const kind = (name) => runAsTenant(1, () => sendPolicy.templateKind(name, { phoneNumberId: one.phoneNumberId, clientId: one.brand.id, language: 'en' }));
  assert.strictEqual(await kind('payment_done'), 'utility');
  assert.strictEqual(await kind('draft_only'), 'marketing', 'not yet with Meta: the schema default is not trusted');
  assert.strictEqual(await kind('other_brand'), 'marketing', 'another brand of the workspace');

  const sent = await request(app).post('/api/internal/send-template').set(service(1)).send({ lead_id: one.lead.id, template: 'payment_done' });
  assert.strictEqual(sent.status, 200, JSON.stringify(sent.body));
});
