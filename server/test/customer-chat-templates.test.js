/**
 * Template messages in the customer WhatsApp Chat show the real text (header,
 * body with values, footer, buttons), looked up only in the brand's own WABA
 * and language. Covers old "[Template] name" rows, the n8n send-template
 * route (stored as a template, header values filled) and tenant isolation.
 * Meta is stubbed; no real call.
 */
const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken, TEST_INTERNAL_KEY } = require('./setup');

let app;
const metaCalls = [];
const realPost = axios.post;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  await startTestDb();
  ({ app } = require('../server'));
  axios.post = async (url, body) => {
    if (!/^https:\/\/graph\.facebook\.com\//.test(url)) throw new Error(`Unexpected URL in test: ${url}`);
    metaCalls.push({ url, body });
    return { data: { messages: [{ id: `wamid.T${metaCalls.length}` }] } };
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

const components = ({ header, body, footer, buttons }) => [
  ...(header ? [{ type: 'HEADER', format: 'TEXT', text: header }] : []),
  { type: 'BODY', text: body },
  ...(footer ? [{ type: 'FOOTER', text: footer }] : []),
  ...(buttons ? [{ type: 'BUTTONS', buttons }] : []),
];

test('placeholderName reads every old placeholder form', () => {
  const { placeholderName } = require('../services/templateText');
  assert.strictEqual(placeholderName('[Template] hello_world'), 'hello_world');
  assert.strictEqual(placeholderName('[Template: order_update]'), 'order_update');
  assert.strictEqual(placeholderName('[Template:order_update]'), 'order_update');
  assert.strictEqual(placeholderName('common_welcome_message'), 'common_welcome_message');
  assert.strictEqual(placeholderName('Hello there, how are you?'), null);
  assert.strictEqual(placeholderName('[Template]'), null);
});

test('Template text in the customer chat', async (t) => {
  const { Users, Tenants, Clients, Leads, Conversations, Messages, MetaWhatsappPhoneNumbers, MetaWhatsappTemplates } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const { encryptToken } = require('../services/clientSecrets');
  const templateText = require('../services/templateText');
  const service = (tenantId) => ({ 'x-internal-key': TEST_INTERNAL_KEY, 'x-tenant-id': String(tenantId) });

  // Tenant 1's brand is on WABA_A ("welcome_msg" in en_US and ta); an old
  // WABA of the same workspace has a "welcome_msg" with other text. Tenant 2
  // has its own brand, WABA and templates with the same names.
  async function seed() {
    await runAsSystem(() => Tenants.create([{ id: 1, name: 'One', status: 'active' }, { id: 2, name: 'Two', status: 'active' }]), 'test');
    const owner = (await runAsSystem(() => Users.create({
      tenant_id: 1, role: 'owner', email: 'owner@one.test', name: 'Owner', password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
    }), 'test')).toObject();
    const one = await runAsTenant(1, async () => {
      const brandA = await Clients.create({ name: 'Brand A', phone_number_id: 'PN_A', whatsapp_status: 'verified', ...encryptToken('test-dummy-token-a') });
      await MetaWhatsappPhoneNumbers.create([{ phone_number_id: 'PN_A', waba_id: 'WABA_A' }, { phone_number_id: 'PN_OLD', waba_id: 'WABA_OLD' }]);
      await MetaWhatsappTemplates.create([
        { template_id: 'T0', waba_id: 'WABA_OLD', name: 'welcome_msg', language: 'en_US', status: 'APPROVED', category: 'UTILITY',
          components: components({ body: 'Old WABA text {{1}}' }) },
        { template_id: 'T1', waba_id: 'WABA_A', name: 'welcome_msg', language: 'en_US', status: 'APPROVED', category: 'UTILITY',
          components: components({ header: 'Hi {{1}}', body: 'Welcome {{1}}, your order {{2}} is ready.', footer: 'Brand A', buttons: [{ type: 'URL', text: 'Track', url: 'https://a.example/track' }, { type: 'QUICK_REPLY', text: 'Thanks' }] }) },
        { template_id: 'T2', waba_id: 'WABA_A', name: 'welcome_msg', language: 'ta', status: 'APPROVED', category: 'UTILITY',
          components: components({ body: 'Vanakkam {{1}}' }) },
      ]);
      const lead = await Leads.create({ name: 'Ravi', phone: '919876543210', client_id: brandA.id, status: 'new', last_inbound_at: new Date(Date.now() - 60000) });
      const conversation = await Conversations.create({ lead_id: lead.id, phone: '9876543210', status: 'open' });
      return { brandA: brandA.toObject(), lead: lead.toObject(), conversation: conversation.toObject() };
    });
    const brandB = await runAsTenant(2, async () => {
      const brand = await Clients.create({ name: 'Brand B', phone_number_id: 'PN_B', whatsapp_status: 'verified', ...encryptToken('test-dummy-token-b') });
      await MetaWhatsappPhoneNumbers.create({ phone_number_id: 'PN_B', waba_id: 'WABA_B' });
      await MetaWhatsappTemplates.create([
        { template_id: 'T8', waba_id: 'WABA_B', name: 'welcome_msg', language: 'en_US', status: 'APPROVED', components: components({ body: 'Brand B says hello {{1}}' }) },
        { template_id: 'T9', waba_id: 'WABA_B', name: 'other_tenant_msg', language: 'en', status: 'APPROVED', components: components({ body: 'SECRET text of tenant two' }) },
      ]);
      return brand.toObject();
    });
    return { ...one, brandB, headers: { Authorization: `Bearer ${makeToken(owner)}` } };
  }

  await t.test('T1. Lookup stays in the brand WABA and language', async () => {
    const { brandA, brandB } = await seed();
    const a = await runAsTenant(1, () => templateText.renderTemplate('welcome_msg', 'en', ['Ravi', '42'], { clientId: brandA.id }));
    assert.strictEqual(a.text, 'Hi {{1}}\n\nWelcome Ravi, your order 42 is ready.\n\nBrand A', 'not the old WABA text');
    assert.deepStrictEqual(a.buttons.map((b) => b.text), ['Track', 'Thanks']);
    const ta = await runAsTenant(1, () => templateText.renderTemplate('welcome_msg', 'ta', ['Ravi'], { clientId: brandA.id }));
    assert.strictEqual(ta.text, 'Vanakkam Ravi');
    // A language the brand does not have is not swapped for another one.
    assert.strictEqual(await runAsTenant(1, () => templateText.renderTemplate('welcome_msg', 'hi', ['Ravi'], { clientId: brandA.id })), null);
    const b = await runAsTenant(2, () => templateText.renderTemplate('welcome_msg', 'en_US', ['Ravi'], { clientId: brandB.id }));
    assert.strictEqual(b.text, 'Brand B says hello Ravi');
  });

  await t.test('T2. Another workspace\'s template is never used, inside a workspace or from a system job', async () => {
    const { brandA } = await seed();
    assert.strictEqual(await runAsTenant(1, () => templateText.renderTemplate('other_tenant_msg', 'en', null, { clientId: brandA.id })), null);
    assert.strictEqual(await runAsTenant(1, () => templateText.renderTemplate('other_tenant_msg', 'en', null, {})), null);
    // System context without a WABA: no lookup at all (would cross workspaces).
    assert.strictEqual(await runAsSystem(() => templateText.renderTemplate('other_tenant_msg', 'en', null, {}), 'test'), null);
    // System context with a WABA: only that WABA.
    const sys = await runAsSystem(() => templateText.renderTemplate('welcome_msg', 'ta', ['Ravi'], { wabaId: 'WABA_A' }), 'test');
    assert.strictEqual(sys.text, 'Vanakkam Ravi');
  });

  await t.test('T3. Old "[Template] name" rows (template or text) show the real text, label and buttons', async () => {
    const { lead, conversation, headers } = await seed();
    await runAsTenant(1, () => Messages.create([
      { conversation_id: conversation.id, direction: 'inbound', content: 'hello', msg_type: 'text', sent_at: new Date(Date.now() - 5000) },
      { conversation_id: conversation.id, direction: 'outbound', content: '[Template] welcome_msg', msg_type: 'template', sent_at: new Date(Date.now() - 4000) },
      { conversation_id: conversation.id, direction: 'outbound', content: '[Template] welcome_msg', msg_type: 'text', is_ai: true, sent_at: new Date(Date.now() - 3000) },
      { conversation_id: conversation.id, direction: 'outbound', content: 'other_tenant_msg', msg_type: 'template', sent_at: new Date(Date.now() - 2000) },
      { conversation_id: conversation.id, direction: 'outbound', content: 'see my_file_name', msg_type: 'text', sent_at: new Date(Date.now() - 1000) },
    ]));
    const res = await request(app).get(`/api/leads/${lead.id}/messages`).set(headers);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const [inbound, oldTemplate, oldN8n, foreign, plain] = res.body.messages;
    assert.strictEqual(inbound.content, 'hello');
    for (const row of [oldTemplate, oldN8n]) {
      assert.strictEqual(row.type, 'template');
      assert.strictEqual(row.template_name, 'welcome_msg');
      assert.strictEqual(row.content, 'Hi {{1}}\n\nWelcome {{1}}, your order {{2}} is ready.\n\nBrand A');
      assert.deepStrictEqual(row.template_buttons, [{ type: 'URL', text: 'Track', url: 'https://a.example/track' }, { type: 'QUICK_REPLY', text: 'Thanks' }]);
    }
    assert.strictEqual(foreign.content, 'other_tenant_msg', 'tenant two\'s text never shows');
    assert.ok(!JSON.stringify(res.body).includes('SECRET'));
    assert.strictEqual(plain.type, 'text');
    assert.strictEqual(plain.content, 'see my_file_name');
    // Nothing was rewritten in the database.
    assert.strictEqual(await runAsTenant(1, () => Messages.countDocuments({ content: '[Template] welcome_msg' })), 2);
  });

  await t.test('T4. n8n send-template: stored as a template with header and body values filled', async () => {
    const { lead, headers } = await seed();
    const res = await request(app).post('/api/internal/send-template').set(service(1))
      .send({ lead_id: lead.id, template: 'welcome_msg', language: 'en_US', header_params: ['Ravi'], body_params: ['Ravi', '42'] });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(metaCalls[0].body.template, {
      name: 'welcome_msg', language: { code: 'en_US' }, components: [
        { type: 'header', parameters: [{ type: 'text', text: 'Ravi' }] },
        { type: 'body', parameters: [{ type: 'text', text: 'Ravi' }, { type: 'text', text: '42' }] },
      ],
    });
    const saved = await runAsTenant(1, () => Messages.findOne({ wa_msg_id: 'wamid.T1' }).lean());
    assert.strictEqual(saved.msg_type, 'template');
    assert.strictEqual(saved.template_name, 'welcome_msg');
    assert.strictEqual(saved.template_language, 'en_US');
    assert.strictEqual(saved.content, 'Hi Ravi\n\nWelcome Ravi, your order 42 is ready.\n\nBrand A');
    const shown = (await request(app).get(`/api/leads/${lead.id}/messages`).set(headers)).body.messages.at(-1);
    assert.strictEqual(shown.type, 'template');
    assert.strictEqual(shown.content, saved.content);
    assert.strictEqual(shown.template_buttons.length, 2);
  });

  await t.test('T5. n8n send-template for an unknown template keeps the placeholder and the Template type', async () => {
    const { lead } = await seed();
    await runAsTenant(1, () => require('../services/consent').recordOptIn({ leadId: lead.id, source: 'form', text: 'Agreed to WhatsApp updates' }));
    const res = await request(app).post('/api/internal/send-template').set(service(1)).send({ lead_id: lead.id, template: 'other_tenant_msg', language: 'en' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const saved = await runAsTenant(1, () => Messages.findOne({ wa_msg_id: 'wamid.T1' }).lean());
    assert.strictEqual(saved.msg_type, 'template');
    assert.strictEqual(saved.content, '[Template] other_tenant_msg', 'tenant two\'s text is not used');
    const bad = await request(app).post('/api/internal/send-template').set(service(1)).send({ lead_id: lead.id, template: 'welcome_msg', header_params: ['a', 'b'] });
    assert.strictEqual(bad.status, 400);
  });
});
