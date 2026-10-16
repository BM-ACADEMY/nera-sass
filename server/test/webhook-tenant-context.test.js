const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections } = require('./setup');

test.before(async () => {
  process.env.WA_VERIFY_TOKEN = 'test_verify_token';
  await startTestDb();
});

test.after(async () => {
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearCollections();
});

test('P0 Webhook Tenant Context & Isolation Suite', async (t) => {
  const models = require('../models');
  const { Clients, Leads, Messages, Conversations, Templates, CampaignLogs, FailedWebhooks, BrandSocialAccounts, Tenants } = models;
  const { runAsTenant, runAsSystem } = require('../services/tenantContext');
  const cryptoHelper = require('../utils/crypto');

  // Set up Express app and mock context with captured socket events
  const app = express();
  app.use(express.json());

  const emittedSocketEvents = [];
  const io = {
    emit(event, payload) {
      const { currentTenantId } = require('../services/tenantContext');
      emittedSocketEvents.push({ event, payload, tenantId: currentTenantId() });
      return true;
    },
  };

  const mockAxios = {
    post: async () => ({ data: { success: true } }),
    get: async (url) => {
      if (url.includes('LEADGEN_TEST_1')) {
        return {
          data: {
            field_data: [
              { name: 'full_name', values: ['John Doe Meta'] },
              { name: 'phone_number', values: ['+919876543210'] },
              { name: 'email', values: ['john@metaexample.com'] },
            ],
          },
        };
      }
      return { data: {} };
    },
  };

  const leadosContext = {
    auth: (req, res, next) => next(),
    CampaignLogs,
    Clients,
    Conversations,
    Leads,
    Messages,
    NO_ID: { _id: 0 },
    Templates,
    FailedWebhooks,
    models,
    aiReplyQueue: new Map(),
    axios: mockAxios,
    fs: require('fs'),
    path: require('path'),
    io,
    openRouter: { isConfigured: false },
    phoneTailRegex: (p) => new RegExp(p + '$'),
    upsertOne: async (model, query, update, insertDoc) => {
      let doc = await model.findOne(query).lean();
      if (!doc) {
        doc = (await model.create(insertDoc)).toObject();
      } else {
        await model.updateOne(query, update);
      }
      return doc;
    },
    SERVER_ROOT: __dirname,
    cryptoHelper,
  };

  require('../routes/leados/webhook-whatsapp')(app, leadosContext);
  require('../routes/leados/webhook-meta-leads')(app, leadosContext);

  await t.test('1. Meta Webhook Verification (Challenge-Response) & Security', async () => {
    // Correct token returns challenge
    const resSuccess = await request(app)
      .get('/webhook/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'test_verify_token', 'hub.challenge': '123456789' });
    assert.strictEqual(resSuccess.status, 200);
    assert.strictEqual(resSuccess.text, '123456789');

    // Invalid token returns 403
    const resFail = await request(app)
      .get('/webhook/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong_token', 'hub.challenge': '123456789' });
    assert.strictEqual(resFail.status, 403);
  });

  await t.test('2. Valid WhatsApp Webhook resolves correct tenant and processes message', async () => {
    emittedSocketEvents.length = 0;
    const tenant1Id = 101;
    const tenant2Id = 102;

    // Seed Tenant 1 brand with Phone Number ID 'PHONE_101'
    await runAsSystem(() => Tenants.create({ id: tenant1Id, name: 'Tenant 1 Logistics', status: 'active' }));
    const brand1 = await runAsTenant(tenant1Id, () => Clients.create({
      name: 'Tenant 1 Brand',
      phone_number_id: 'PHONE_101',
      whatsapp_number: '+919876543210',
    }));

    // Seed Tenant 2 brand with Phone Number ID 'PHONE_102'
    await runAsSystem(() => Tenants.create({ id: tenant2Id, name: 'Tenant 2 Retail', status: 'active' }));
    await runAsTenant(tenant2Id, () => Clients.create({
      name: 'Tenant 2 Brand',
      phone_number_id: 'PHONE_102',
      whatsapp_number: '+919988776655',
    }));

    const incomingPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'WABA_101',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '919876543210', phone_number_id: 'PHONE_101' },
            contacts: [{ profile: { name: 'Alice Customer' }, wa_id: '919111222333' }],
            messages: [{
              from: '919111222333',
              id: 'wamid.HBgLMTIzNDU2Nzg5MA==',
              timestamp: '1700000000',
              text: { body: 'Inquiry for Tenant 1 services' },
              type: 'text',
            }],
          },
        }],
      }],
    };

    const res = await request(app)
      .post('/webhook/whatsapp')
      .send(incomingPayload);

    assert.strictEqual(res.status, 200);

    // Verify Tenant 1 has the newly created lead and message
    const tenant1Lead = await runAsTenant(tenant1Id, () => Leads.findOne({ phone: '919111222333' }).lean());
    assert.ok(tenant1Lead, 'Lead must exist in Tenant 1');
    assert.strictEqual(tenant1Lead.name, 'Alice Customer');
    assert.strictEqual(tenant1Lead.tenant_id, tenant1Id);
    assert.strictEqual(tenant1Lead.client_id, brand1.id);

    const tenant1Msg = await runAsTenant(tenant1Id, () => Messages.findOne({ wa_msg_id: 'wamid.HBgLMTIzNDU2Nzg5MA==' }).lean());
    assert.ok(tenant1Msg, 'Inbound message must exist in Tenant 1');
    assert.strictEqual(tenant1Msg.content, 'Inquiry for Tenant 1 services');
    assert.strictEqual(tenant1Msg.tenant_id, tenant1Id);

    // Verify Tenant 2 CANNOT see Tenant 1's lead or message
    const tenant2Lead = await runAsTenant(tenant2Id, () => Leads.findOne({ phone: '919111222333' }).lean());
    assert.strictEqual(tenant2Lead, null, 'Tenant 2 must NOT see Tenant 1 lead');

    const tenant2Msg = await runAsTenant(tenant2Id, () => Messages.findOne({ wa_msg_id: 'wamid.HBgLMTIzNDU2Nzg5MA==' }).lean());
    assert.strictEqual(tenant2Msg, null, 'Tenant 2 must NOT see Tenant 1 message');

    // Verify Socket.io event was emitted with Tenant 1 scope
    const socketEvent = emittedSocketEvents.find((e) => e.event === 'incoming_message');
    assert.ok(socketEvent, 'Must emit incoming_message socket event');
    assert.strictEqual(socketEvent.tenantId, tenant1Id, 'Socket event must be scoped to Tenant 1');
  });

  await t.test('3. Idempotency: Duplicate WhatsApp message is skipped safely', async () => {
    const tenantId = 101;
    await runAsSystem(() => Tenants.create({ id: tenantId, name: 'Tenant 101 Corp', status: 'active' }));
    await runAsTenant(tenantId, () => Clients.create({
      name: 'Tenant 101 Brand',
      phone_number_id: 'PHONE_IDEMP',
    }));

    const messagePayload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'WABA_IDEMP',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: 'PHONE_IDEMP' },
            contacts: [{ profile: { name: 'Bob Idempotent' } }],
            messages: [{
              from: '919444555666',
              id: 'wamid.UNIQUE_ID_9999',
              text: { body: 'First attempt' },
              type: 'text',
            }],
          },
        }],
      }],
    };

    // First send
    await request(app).post('/webhook/whatsapp').send(messagePayload);
    const countAfterFirst = await runAsTenant(tenantId, () => Messages.countDocuments({ wa_msg_id: 'wamid.UNIQUE_ID_9999' }));
    assert.strictEqual(countAfterFirst, 1);

    // Second send (duplicate delivery from Meta)
    await request(app).post('/webhook/whatsapp').send(messagePayload);
    const countAfterSecond = await runAsTenant(tenantId, () => Messages.countDocuments({ wa_msg_id: 'wamid.UNIQUE_ID_9999' }));
    assert.strictEqual(countAfterSecond, 1, 'Duplicate message must not be inserted twice');
  });

  await t.test('4. Unknown or Unmapped phone_number_id fails safely without processing', async () => {
    const unknownPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'WABA_UNKNOWN',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: 'PHONE_UNKNOWN_888' },
            messages: [{ from: '919999999999', id: 'wamid.UNKNOWN', text: { body: 'Hello?' } }],
          },
        }],
      }],
    };

    const res = await request(app).post('/webhook/whatsapp').send(unknownPayload);
    assert.strictEqual(res.status, 200);

    // Verify nothing created anywhere in system
    const allLeads = await runAsSystem(() => Leads.find({}).lean(), 'test-check');
    assert.strictEqual(allLeads.length, 0);
  });

  await t.test('5. Valid Meta Lead Webhook resolves correct tenant and stores lead', async () => {
    const tenantId = 201;
    await runAsSystem(() => Tenants.create({ id: tenantId, name: 'Tenant 201 Motors', status: 'active' }));
    const brand = await runAsTenant(tenantId, () => Clients.create({ name: 'Tenant 201 Brand' }));

    // Seed social account mapped to Tenant 201
    await runAsSystem(() => BrandSocialAccounts.create({
      facebook_page_id: 'PAGE_META_201',
      brand_name: 'Tenant 201 Brand',
      tenant_id: tenantId,
      access_token: cryptoHelper.encrypt('VALID_META_TOKEN_123'),
    }));

    const metaLeadPayload = {
      object: 'page',
      entry: [{
        id: 'PAGE_META_201',
        changes: [{
          field: 'leadgen',
          value: {
            page_id: 'PAGE_META_201',
            leadgen_id: 'LEADGEN_TEST_1',
          },
        }],
      }],
    };

    const res = await request(app).post('/webhook/meta-leads').send(metaLeadPayload);
    assert.strictEqual(res.status, 200);

    // Verify lead stored in Tenant 201
    const lead = await runAsTenant(tenantId, () => Leads.findOne({ leadgen_id: 'LEADGEN_TEST_1' }).lean());
    assert.ok(lead, 'Meta lead must be saved in Tenant 201');
    assert.strictEqual(lead.name, 'John Doe Meta');
    assert.strictEqual(lead.phone, '919876543210');
    assert.strictEqual(lead.email, 'john@metaexample.com');
    assert.strictEqual(lead.tenant_id, tenantId);
    assert.strictEqual(lead.client_id, brand.id);
  });

  await t.test('6. Cross-Tenant Protection: Webhook cannot overwrite another tenant lead', async () => {
    const tenant1Id = 301;
    const tenant2Id = 302;

    await runAsSystem(() => Tenants.create({ id: tenant1Id, name: 'Tenant 301 A', status: 'active' }));
    await runAsTenant(tenant1Id, () => Clients.create({ name: 'Brand 301', phone_number_id: 'PHONE_301' }));

    await runAsSystem(() => Tenants.create({ id: tenant2Id, name: 'Tenant 302 B', status: 'active' }));
    await runAsTenant(tenant2Id, () => Clients.create({ name: 'Brand 302', phone_number_id: 'PHONE_302' }));

    // Tenant 2 has a lead with phone 919777777777
    const lead2 = await runAsTenant(tenant2Id, () => Leads.create({
      name: 'Original Tenant 2 Customer',
      phone: '919777777777',
      status: 'qualified',
    }));

    // Customer sends message to Tenant 1's phone number from the same phone
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'WABA_301',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: 'PHONE_301' },
            contacts: [{ profile: { name: 'Tenant 1 Caller' } }],
            messages: [{
              from: '919777777777',
              id: 'wamid.CROSS_TEST_01',
              text: { body: 'Message for Tenant 1' },
              type: 'text',
            }],
          },
        }],
      }],
    };

    await request(app).post('/webhook/whatsapp').send(payload);

    // Tenant 2's lead must remain untouched
    const checkLead2 = await runAsTenant(tenant2Id, () => Leads.findOne({ id: lead2.id }).lean());
    assert.strictEqual(checkLead2.name, 'Original Tenant 2 Customer');
    assert.strictEqual(checkLead2.status, 'qualified');

    // Tenant 1 gets their own separate lead
    const checkLead1 = await runAsTenant(tenant1Id, () => Leads.findOne({ phone: '919777777777' }).lean());
    assert.ok(checkLead1);
    assert.strictEqual(checkLead1.tenant_id, tenant1Id);
    assert.notStrictEqual(checkLead1.id, lead2.id);
  });

  await t.test('7. Template status update updates template under correct tenant context', async () => {
    const tenantId = 401;
    await runAsSystem(() => Tenants.create({ id: tenantId, name: 'Tenant 401 Ltd', status: 'active' }));
    const tpl = await runAsTenant(tenantId, () => Templates.create({
      name: 'seasonal_sale_alert',
      meta_template_id: 'META_TPL_999',
      status: 'submitted',
      category: 'MARKETING',
      language: 'en_US',
    }));

    const statusPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'WABA_401',
        changes: [{
          field: 'message_template_status_update',
          value: {
            event: 'APPROVED',
            message_template_id: 'META_TPL_999',
            message_template_name: 'seasonal_sale_alert',
          },
        }],
      }],
    };

    const res = await request(app).post('/webhook/whatsapp').send(statusPayload);
    assert.strictEqual(res.status, 200);

    const updated = await runAsTenant(tenantId, () => Templates.findOne({ id: tpl.id }).lean());
    assert.strictEqual(updated.status, 'approved');
    assert.ok(updated.approved_at);
  });

  await t.test('8. Missing, malformed, or untrusted payload fails safely without TenantContextError', async () => {
    // 1. Missing body
    const res1 = await request(app).post('/webhook/whatsapp').send({});
    assert.strictEqual(res1.status, 200);

    // 2. Untrusted tenant_id supplied in body (must be ignored)
    const spoofedPayload = {
      object: 'whatsapp_business_account',
      tenant_id: 999999,
      entry: [{
        changes: [{
          field: 'messages',
          value: { metadata: { phone_number_id: 'UNKNOWN_PHONE' }, messages: [] },
        }],
      }],
    };
    const res2 = await request(app).post('/webhook/whatsapp').send(spoofedPayload);
    assert.strictEqual(res2.status, 200);

    // 3. Meta lead webhook with unmapped page_id
    const metaUnmapped = {
      object: 'page',
      entry: [{
        changes: [{
          field: 'leadgen',
          value: { page_id: 'UNMAPPED_PAGE_999', leadgen_id: 'LEADGEN_999' },
        }],
      }],
    };
    const res3 = await request(app).post('/webhook/meta-leads').send(metaUnmapped);
    assert.strictEqual(res3.status, 200);

    // Verify FailedWebhooks contains sanitized diagnostic record
    const failedLog = await runAsSystem(() => FailedWebhooks.findOne({ page_id: 'UNMAPPED_PAGE_999' }).lean(), 'check-failed');
    assert.ok(failedLog);
    assert.strictEqual(failedLog.leadgen_id, 'LEADGEN_999');
  });
});

