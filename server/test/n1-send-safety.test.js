/**
 * N1: sending at volume is safe. Meta is stubbed; no real call ever leaves.
 *
 *   A. consent per contact (source, timestamp, text) gates marketing
 *   B. STOP / START in English and Tamil, via the signed Meta webhook
 *   C. the send queue: per-number minute limit, daily cap and its growth,
 *      retries with backoff, permanent failures
 *   D. Meta quality signals pause marketing and tell the owner
 *   E. the 24-hour window: free text inside it, templates outside it
 */
const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken, TEST_INTERNAL_KEY } = require('./setup');

let app;
let metaReply;
const metaCalls = [];
const realPost = axios.post;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  process.env.WA_VERIFY_TOKEN = 'test_verify_token';
  process.env.NERA_META_APP_SECRET = 'test-dummy-webhook-secret';
  await startTestDb();
  loadModules();
  ({ app } = require('../server'));
  axios.post = async (url, body, options) => {
    if (!/^https:\/\/graph\.facebook\.com\//.test(url)) throw new Error(`Unexpected URL in test: ${url}`);
    metaCalls.push({ url, body, auth: options?.headers?.Authorization });
    return metaReply(url, body);
  };
});

test.after(async () => {
  axios.post = realPost;
  await stopTestDb();
});

test.beforeEach(async () => {
  metaCalls.length = 0;
  metaReply = async () => ({ data: { messages: [{ id: `wamid.${metaCalls.length}` }] } });
  delete process.env.WA_SEND_PER_MINUTE;
  delete process.env.WA_DAILY_CAP_START;
  delete process.env.WA_QUEUE_MAX_ATTEMPTS;
  await clearCollections();
  notify.outbox().length = 0;
});

// Loaded after the in-memory database is up: db/mongo.js reads MONGODB_URI
// when it is first required.
let models, Users, Tenants, Clients, Leads, Conversations, Messages, Templates, Campaigns, CampaignLogs, CampaignMessageQueue, WhatsappConsents, WhatsappNumberState;
let runAsSystem, runAsTenant, encryptToken, consent, numberHealth, sendQueue, notify;
function loadModules() {
  models = require('../models');
  ({ Users, Tenants, Clients, Leads, Conversations, Messages, Templates, Campaigns, CampaignLogs, CampaignMessageQueue, WhatsappConsents, WhatsappNumberState } = models);
  ({ runAsSystem, runAsTenant } = require('../services/tenantContext'));
  ({ encryptToken } = require('../services/clientSecrets'));
  consent = require('../services/consent');
  numberHealth = require('../services/numberHealth');
  sendQueue = require('../services/whatsappSendQueue');
  notify = require('../services/notify');
}

const PHONE = '919876543210';
const service = (tenantId) => ({ 'x-internal-key': TEST_INTERNAL_KEY, 'x-tenant-id': String(tenantId) });
const signed = (url, payload) => {
  const body = JSON.stringify(payload);
  const signature = 'sha256=' + crypto.createHmac('sha256', process.env.NERA_META_APP_SECRET).update(body).digest('hex');
  return request(app).post(url).set('Content-Type', 'application/json').set('X-Hub-Signature-256', signature).send(body);
};
const inboundWebhook = (phoneNumberId, from, text, extra = {}) => signed('/webhook/whatsapp', {
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA1', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: '919000000001', phone_number_id: phoneNumberId },
    contacts: [{ profile: { name: 'Ravi' }, wa_id: from }],
    messages: [{ from, id: `wamid.in.${crypto.randomUUID()}`, timestamp: '1700000000', type: 'text', text: { body: text }, ...extra }],
  } }] }],
});

// A workspace with a verified brand number and one lead. `inboundAgo` opens the window.
async function seed({ tenantId = 1, phoneNumberId = 'PN1', inboundAgo = null, phone = PHONE } = {}) {
  await runAsSystem(() => Tenants.create({ id: tenantId, name: `Shop ${tenantId}`, status: 'active', owner_user_id: null }), 'test');
  const owner = (await runAsSystem(() => Users.create({
    tenant_id: tenantId, role: 'owner', email: `owner${tenantId}@shop.test`, name: 'Owner', password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
  }), 'test')).toObject();
  await runAsSystem(() => Tenants.updateOne({ id: tenantId }, { $set: { owner_user_id: owner.id } }), 'test');
  return runAsTenant(tenantId, async () => {
    const brand = (await Clients.create({
      name: `Brand ${tenantId}`, phone_number_id: phoneNumberId, wa_business_id: 'WABA1', whatsapp_number: '+91 90000 00001', whatsapp_status: 'verified', ...encryptToken(`test-dummy-token-${tenantId}`),
    })).toObject();
    const lead = (await Leads.create({ name: 'Ravi', phone, client_id: brand.id, status: 'new' })).toObject();
    if (inboundAgo != null) {
      const conversation = await Conversations.create({ lead_id: lead.id, phone: phone.slice(-10), status: 'open' });
      await Messages.create({ conversation_id: conversation.id, direction: 'inbound', content: 'hi', sent_at: new Date(Date.now() - inboundAgo) });
      await Leads.updateOne({ id: lead.id }, { $set: { last_inbound_at: new Date(Date.now() - inboundAgo) } });
    }
    return { brand, lead, owner, headers: { Authorization: `Bearer ${makeToken(owner)}` } };
  });
}

// A marketing campaign row for the lead, as executeCampaign would queue it.
async function queueCampaignRow(tenantId, brand, lead, { kind = 'marketing' } = {}) {
  return runAsTenant(tenantId, async () => {
    const template = await Templates.create({ name: `promo_${tenantId}_${lead.id}`, category: 'MARKETING', body: 'Hello {{1}}', status: 'approved', client_id: brand.id, meta_template_id: 'T1' });
    const campaign = await Campaigns.create({ name: 'Diwali', client_id: brand.id, template_id: template.id, target_status: 'all', status: 'running', template_parameters: { body: { 1: { source: 'recipient_name' } } } });
    await sendQueue.enqueueCampaign(campaign.id, [lead], {
      template_name: template.name, template_language: 'en', template_body: template.body, template_header: '', template_parameters: campaign.template_parameters,
      campaign_name: campaign.name, brand_name: brand.name, phone_number_id: brand.phone_number_id,
    });
    if (kind !== 'marketing') await CampaignMessageQueue.updateMany({ campaign_id: campaign.id }, { $set: { kind } });
    return { campaign, template };
  });
}

const rowsOf = (tenantId, filter = {}) => runAsTenant(tenantId, () => CampaignMessageQueue.find(filter, { _id: 0 }).sort({ id: 1 }).lean());
const stateOf = (tenantId, phoneNumberId = 'PN1') => runAsTenant(tenantId, () => WhatsappNumberState.findOne({ phone_number_id: phoneNumberId }, { _id: 0 }).lean());

test('A. Consent per contact', async (t) => {
  await t.test('A1. An opt-in stores source, time and the exact wording; the lead mirrors it', async () => {
    const { lead, headers } = await seed();
    const missing = await request(app).post(`/api/leads/${lead.id}/consent`).set(headers).send({ source: 'shop' });
    assert.strictEqual(missing.status, 400, 'the wording the contact agreed to is required');
    const before = Date.now();
    const res = await request(app).post(`/api/leads/${lead.id}/consent`).set(headers)
      .send({ source: 'shop', text: 'Ticked "Send me offers on WhatsApp" on the enrolment form' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.consent.status, 'opted_in');
    assert.strictEqual(res.body.consent.opt_in.source, 'shop');
    assert.match(res.body.consent.opt_in.text, /Send me offers/);
    assert.ok(new Date(res.body.consent.opt_in.at).getTime() >= before - 1000);
    assert.strictEqual(res.body.consent.events.length, 1);

    const shown = await request(app).get(`/api/leads/${lead.id}/consent`).set(headers);
    assert.strictEqual(shown.body.consent.status, 'opted_in');
    const stored = await runAsTenant(1, () => Leads.findOne({ id: lead.id }, { _id: 0 }).lean());
    assert.strictEqual(stored.whatsapp_opt_in, true);
    assert.ok(stored.whatsapp_opt_in_at);
    const row = await runAsTenant(1, () => WhatsappConsents.findOne({ lead_id: lead.id }, { _id: 0 }).lean());
    assert.strictEqual(row.phone_key, PHONE.slice(-10));
    assert.strictEqual(row.tenant_id, 1);
  });

  await t.test('A2. The queue skips a marketing message to a contact without opt-in and sends it once they opted in', async () => {
    const { brand, lead } = await seed();
    const { campaign } = await queueCampaignRow(1, brand, lead);
    let outcome = await sendQueue.processBatch();
    assert.strictEqual(outcome.skipped, 1, JSON.stringify(outcome));
    assert.strictEqual(metaCalls.length, 0, 'nothing reached Meta');
    let [row] = await rowsOf(1);
    assert.strictEqual(row.status, 'skipped');
    assert.match(row.skip_reason, /not opted in/);
    const logs = await runAsTenant(1, () => CampaignLogs.find({ campaign_id: campaign.id }, { _id: 0 }).lean());
    assert.strictEqual(logs[0].status, 'skipped');

    await runAsTenant(1, () => consent.recordOptIn({ leadId: lead.id, source: 'form', text: 'Website form checkbox' }));
    await runAsTenant(1, () => CampaignMessageQueue.updateOne({ id: row.id }, { $set: { status: 'pending', next_attempt_at: new Date(), skip_reason: null } }));
    outcome = await sendQueue.processBatch();
    assert.strictEqual(outcome.sent, 1, JSON.stringify(outcome));
    assert.strictEqual(metaCalls.length, 1);
    assert.match(metaCalls[0].url, /\/PN1\/messages$/);
    assert.strictEqual(metaCalls[0].auth, 'Bearer test-dummy-token-1');
    assert.strictEqual(metaCalls[0].body.to, PHONE);
    assert.match(metaCalls[0].body.template.name, /^promo_1_/);
    assert.deepStrictEqual(metaCalls[0].body.template.components[0].parameters, [{ type: 'text', text: 'Ravi' }]);
    [row] = await rowsOf(1);
    assert.strictEqual(row.status, 'sent');
    assert.strictEqual(row.wa_message_id, 'wamid.1');
    const mirrored = await runAsTenant(1, () => Messages.findOne({ wa_msg_id: 'wamid.1' }, { _id: 0 }).lean());
    assert.strictEqual(mirrored.content, 'Hello Ravi');
    const state = await stateOf(1);
    assert.strictEqual(state.templates_today, 1);
    assert.strictEqual(state.daily_cap, 250);
  });

  await t.test('A3. Consent belongs to one workspace: another tenant with the same number has none', async () => {
    const one = await seed({ tenantId: 1, phoneNumberId: 'PN1' });
    const two = await seed({ tenantId: 2, phoneNumberId: 'PN2' });
    await runAsTenant(1, () => consent.recordOptIn({ leadId: one.lead.id, source: 'form', text: 'Agreed' }));
    assert.strictEqual((await runAsTenant(2, () => consent.getConsent({ phone: PHONE }))), null);
    assert.strictEqual((await runAsTenant(2, () => consent.marketingAllowed({ lead: two.lead }))).code, 'CONSENT_REQUIRED');
    await queueCampaignRow(1, one.brand, one.lead);
    await queueCampaignRow(2, two.brand, two.lead);
    const outcome = await sendQueue.processBatch();
    assert.deepStrictEqual([outcome.sent, outcome.skipped], [1, 1], JSON.stringify(outcome));
    assert.strictEqual(metaCalls.length, 1);
    assert.match(metaCalls[0].url, /\/PN1\//, 'only tenant 1 sent, with its own number');
    assert.strictEqual((await rowsOf(2))[0].status, 'skipped');
    const shown = await request(app).get(`/api/leads/${one.lead.id}/consent`).set(two.headers);
    assert.strictEqual(shown.status, 404, 'tenant 2 cannot read tenant 1 consent');
  });

  await t.test('A4. Creating a lead with consent needs the wording; an import column records it', async () => {
    const { headers } = await seed();
    const noText = await request(app).post('/api/leads').set(headers).send({ name: 'Mala', phone: '919811111111', whatsapp_opt_in: true });
    assert.strictEqual(noText.status, 400);
    const res = await request(app).post('/api/leads').set(headers).send({ name: 'Mala', phone: '919811111111', whatsapp_opt_in: true, opt_in_source: 'call', opt_in_text: 'Said yes to WhatsApp offers on the call' });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    const row = await runAsTenant(1, () => WhatsappConsents.findOne({ phone_key: '9811111111' }, { _id: 0 }).lean());
    assert.strictEqual(row.status, 'opted_in');
    assert.strictEqual(row.opt_in_source, 'call');
    const plain = await request(app).post('/api/leads').set(headers).send({ name: 'Kumar', phone: '919822222222' });
    assert.strictEqual(plain.status, 201);
    assert.strictEqual(await runAsTenant(1, () => consent.getConsent({ phone: '919822222222' })), null, 'no consent without the flag');
  });
});

test('B. STOP and START keywords', async (t) => {
  await t.test('B1. STOP opts the contact out, cancels queued marketing, stops the AI and is confirmed', async () => {
    const { brand, lead } = await seed({ inboundAgo: 60000 });
    await runAsTenant(1, () => consent.recordOptIn({ leadId: lead.id, source: 'form', text: 'Agreed' }));
    await queueCampaignRow(1, brand, lead);
    const res = await inboundWebhook('PN1', PHONE, 'STOP');
    assert.strictEqual(res.status, 200);
    const row = await runAsTenant(1, () => WhatsappConsents.findOne({ lead_id: lead.id }, { _id: 0 }).lean());
    assert.strictEqual(row.status, 'opted_out');
    assert.strictEqual(row.opt_out_source, 'inbound_keyword');
    assert.strictEqual(row.opt_out_text, 'STOP');
    assert.ok(row.opt_out_at);
    assert.deepStrictEqual(row.events.map((e) => e.type), ['opt_in', 'opt_out']);
    const stored = await runAsTenant(1, () => Leads.findOne({ id: lead.id }, { _id: 0 }).lean());
    assert.strictEqual(stored.opted_out, true);
    assert.strictEqual(stored.whatsapp_opt_out, true);
    assert.strictEqual(stored.ai_followup_due, null);
    const [queued] = await rowsOf(1);
    assert.strictEqual(queued.status, 'cancelled');
    assert.strictEqual(queued.skip_reason, 'Contact opted out');
    assert.strictEqual(metaCalls.length, 1, 'one confirmation, nothing else');
    assert.strictEqual(metaCalls[0].body.to, PHONE);
    assert.match(metaCalls[0].body.text.body, /no longer receive marketing/);
    assert.strictEqual(metaCalls[0].auth, 'Bearer test-dummy-token-1');

    // Nothing marketing goes out afterwards, by queue or by hand.
    metaCalls.length = 0;
    const outcome = await sendQueue.processBatch();
    assert.strictEqual(outcome.sent, 0);
    assert.strictEqual(metaCalls.length, 0);
    const blocked = await runAsTenant(1, () => consent.marketingAllowed({ lead: stored }));
    assert.strictEqual(blocked.code, 'CONTACT_OPTED_OUT');
  });

  await t.test('B2. Tamil STOP words work the same and are confirmed in Tamil', async () => {
    const { lead } = await seed({ inboundAgo: 60000 });
    await runAsTenant(1, () => consent.recordOptIn({ leadId: lead.id, source: 'form', text: 'Agreed' }));
    await inboundWebhook('PN1', PHONE, 'இனி மெசேஜ் அனுப்ப வேண்டாம்');
    const row = await runAsTenant(1, () => WhatsappConsents.findOne({ lead_id: lead.id }, { _id: 0 }).lean());
    assert.strictEqual(row.status, 'opted_out');
    assert.strictEqual(row.opt_out_text, 'இனி மெசேஜ் அனுப்ப வேண்டாம்');
    assert.match(metaCalls.at(-1).body.text.body, /[஀-௿]/, 'Tamil confirmation');
    assert.match(metaCalls.at(-1).body.text.body, /START/);
  });

  await t.test('B3. START opts back in; a long message mentioning stop does nothing', async () => {
    const { lead } = await seed({ inboundAgo: 60000 });
    await inboundWebhook('PN1', PHONE, 'niruthunga');
    assert.strictEqual((await runAsTenant(1, () => consent.getConsent({ phone: PHONE }))).status, 'opted_out');
    await inboundWebhook('PN1', PHONE, 'START');
    const row = await runAsTenant(1, () => consent.getConsent({ phone: PHONE }));
    assert.strictEqual(row.status, 'opted_in');
    assert.strictEqual(row.opt_in_source, 'inbound_keyword');
    assert.strictEqual(row.opt_in_text, 'START');
    const stored = await runAsTenant(1, () => Leads.findOne({ id: lead.id }, { _id: 0 }).lean());
    assert.strictEqual(stored.opted_out, false);
    assert.strictEqual(stored.whatsapp_opt_in, true);
    metaCalls.length = 0;
    await inboundWebhook('PN1', PHONE, 'Please do not stop the evening class, we all want it to continue next month too');
    assert.strictEqual((await runAsTenant(1, () => consent.getConsent({ phone: PHONE }))).status, 'opted_in');
    assert.strictEqual(metaCalls.length, 0);
    assert.strictEqual(await runAsTenant(1, () => Messages.countDocuments({ direction: 'inbound' })), 4, 'every inbound message is still stored');
  });

  await t.test('B4. A STOP in one workspace does not touch the same number in another', async () => {
    await seed({ tenantId: 1, phoneNumberId: 'PN1', inboundAgo: 60000 });
    const two = await seed({ tenantId: 2, phoneNumberId: 'PN2' });
    await runAsTenant(2, () => consent.recordOptIn({ leadId: two.lead.id, source: 'form', text: 'Agreed' }));
    await inboundWebhook('PN1', PHONE, 'STOP');
    assert.strictEqual((await runAsTenant(1, () => consent.getConsent({ phone: PHONE }))).status, 'opted_out');
    assert.strictEqual((await runAsTenant(2, () => consent.getConsent({ phone: PHONE }))).status, 'opted_in');
  });
});

test('C. The send queue', async (t) => {
  async function optedInLeads(tenantId, brand, count) {
    return runAsTenant(tenantId, async () => {
      const leads = [];
      for (let i = 0; i < count; i++) {
        const lead = (await Leads.create({ name: `Lead ${i}`, phone: `9198000000${String(i).padStart(2, '0')}`, client_id: brand.id, status: 'new' })).toObject();
        await consent.recordOptIn({ leadId: lead.id, source: 'form', text: 'Agreed' });
        leads.push(lead);
      }
      return leads;
    });
  }

  await t.test('C1. Per-number minute limit: the rest waits for the next minute', async () => {
    process.env.WA_SEND_PER_MINUTE = '2';
    const { brand } = await seed();
    const leads = await optedInLeads(1, brand, 3);
    for (const lead of leads) await queueCampaignRow(1, brand, lead);
    const outcome = await sendQueue.processBatch();
    assert.deepStrictEqual([outcome.sent, outcome.deferred], [2, 1], JSON.stringify(outcome));
    assert.strictEqual(metaCalls.length, 2);
    const waiting = (await rowsOf(1, { status: 'pending' }))[0];
    assert.match(waiting.error_message, /per minute/);
    assert.ok(waiting.next_attempt_at > new Date(), 'retried after the minute turns');
    assert.ok(waiting.next_attempt_at - Date.now() <= 60000);
    assert.strictEqual(waiting.attempts, 0, 'a deferred row does not use up an attempt');
    assert.strictEqual((await stateOf(1)).sent_this_minute, 2);
  });

  await t.test('C2. Daily cap: once reached, business-initiated messages wait for the next UTC day', async () => {
    const { brand } = await seed();
    const [lead] = await optedInLeads(1, brand, 1);
    await runAsTenant(1, async () => {
      const state = await numberHealth.stateFor('PN1');
      await WhatsappNumberState.updateOne({ phone_number_id: 'PN1' }, { $set: { templates_today: state.daily_cap, sent_today: state.daily_cap } });
    });
    const { campaign } = await queueCampaignRow(1, brand, lead);
    const outcome = await sendQueue.processBatch();
    assert.strictEqual(outcome.deferred, 1, JSON.stringify(outcome));
    assert.strictEqual(metaCalls.length, 0);
    const [row] = await rowsOf(1);
    assert.match(row.error_message, /Daily limit of 250/);
    assert.strictEqual(row.next_attempt_at.toISOString(), numberHealth.nextUtcMidnight().toISOString());
    const stats = await runAsTenant(1, () => models.CampaignRateStats.findOne({ campaign_id: campaign.id }, { _id: 0 }).lean());
    assert.strictEqual(stats.rate_limited_count, 1);

    // A reply inside the window (service, free text) is not a business-initiated message and still goes.
    await runAsTenant(1, async () => {
      const conversation = await Conversations.create({ lead_id: lead.id, phone: lead.phone.slice(-10), status: 'open' });
      await Messages.create({ conversation_id: conversation.id, direction: 'inbound', content: 'hi', sent_at: new Date() });
      await sendQueue.enqueue({ leadId: lead.id, phone: lead.phone, phoneNumberId: 'PN1', kind: 'service', payload: { type: 'text', text: { body: 'Thanks for writing' } }, content: 'Thanks for writing', source: 'test' });
    });
    const second = await sendQueue.processBatch();
    assert.strictEqual(second.sent, 1, JSON.stringify(second));
    assert.strictEqual(metaCalls[0].body.text.body, 'Thanks for writing');
  });

  await t.test('C3. The cap grows slowly: it doubles after a healthy day of real use, not otherwise', async () => {
    await seed();
    const yesterday = numberHealth.utcDay(new Date(Date.now() - 86400000));
    await runAsTenant(1, async () => {
      await numberHealth.stateFor('PN1');
      await WhatsappNumberState.updateOne({ phone_number_id: 'PN1' }, { $set: { day: yesterday, templates_today: 130, daily_cap: 250, quality_rating: 'GREEN' } });
      assert.strictEqual((await numberHealth.rollover('PN1')).daily_cap, 500, 'half the cap used with GREEN quality: doubled');
      await WhatsappNumberState.updateOne({ phone_number_id: 'PN1' }, { $set: { day: yesterday, templates_today: 10 } });
      assert.strictEqual((await numberHealth.rollover('PN1')).daily_cap, 500, 'little use: unchanged');
      await WhatsappNumberState.updateOne({ phone_number_id: 'PN1' }, { $set: { day: yesterday, templates_today: 400, quality_rating: 'YELLOW' } });
      assert.strictEqual((await numberHealth.rollover('PN1')).daily_cap, 500, 'YELLOW quality: growth frozen');
      await WhatsappNumberState.updateOne({ phone_number_id: 'PN1' }, { $set: { day: yesterday, templates_today: 400, quality_rating: 'GREEN', messaging_limit: 'TIER_1K' } });
      assert.strictEqual((await numberHealth.rollover('PN1')).daily_cap, 1000, 'never above the Meta tier');
      await WhatsappNumberState.updateOne({ phone_number_id: 'PN1' }, { $set: { day: yesterday, templates_today: 900 } });
      assert.strictEqual((await numberHealth.rollover('PN1')).daily_cap, 1000, 'stays at the tier');
      const state = await WhatsappNumberState.findOne({ phone_number_id: 'PN1' }, { _id: 0 }).lean();
      assert.strictEqual(state.templates_today, 0, 'counters reset for the new day');
    });
    assert.strictEqual(numberHealth.nextDailyCap({ daily_cap: 250, templates_today: 250, quality_rating: 'RED' }), 250);
    assert.strictEqual(numberHealth.nextDailyCap({ daily_cap: 250, templates_today: 250, marketing_paused: true }), 250);
  });

  await t.test('C4. Meta rate limits and 5xx retry with exponential backoff, then fail for good', async () => {
    process.env.WA_QUEUE_MAX_ATTEMPTS = '3';
    const { brand } = await seed();
    const [lead] = await optedInLeads(1, brand, 1);
    const { campaign } = await queueCampaignRow(1, brand, lead);
    metaReply = async () => {
      const err = new Error('Request failed with status code 429');
      err.response = { status: 429, data: { error: { code: 130429, message: 'Rate limit hit' } } };
      throw err;
    };
    const first = await sendQueue.processBatch();
    assert.strictEqual(first.retry, 1, JSON.stringify(first));
    let [row] = await rowsOf(1);
    assert.strictEqual(row.status, 'pending');
    assert.strictEqual(row.attempts, 1);
    const firstDelay = row.next_attempt_at - Date.now();
    assert.ok(firstDelay > 25000 && firstDelay <= 36000, `first retry about 30s away, got ${firstDelay}`);
    assert.match(row.error_message, /Rate limit hit \(Meta error 130429\)/);
    assert.strictEqual((await stateOf(1)).rate_limit_hits, 1);

    // Not due yet: nothing is claimed.
    assert.strictEqual((await sendQueue.processBatch()).retry, 0);
    await runAsTenant(1, () => CampaignMessageQueue.updateOne({ id: row.id }, { $set: { next_attempt_at: new Date(Date.now() - 1000) } }));
    metaReply = async () => { const err = new Error('boom'); err.response = { status: 503, data: {} }; throw err; };
    await sendQueue.processBatch();
    [row] = await rowsOf(1);
    assert.strictEqual(row.attempts, 2);
    const secondDelay = row.next_attempt_at - Date.now();
    assert.ok(secondDelay > 55000 && secondDelay <= 72000, `second retry about 60s away, got ${secondDelay}`);

    await runAsTenant(1, () => CampaignMessageQueue.updateOne({ id: row.id }, { $set: { next_attempt_at: new Date(Date.now() - 1000) } }));
    metaReply = async () => { throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }); };
    const last = await sendQueue.processBatch();
    assert.strictEqual(last.failed, 1, JSON.stringify(last));
    [row] = await rowsOf(1);
    assert.strictEqual(row.status, 'failed');
    assert.match(row.error_message, /gave up after 3 attempts/);
    const logs = await runAsTenant(1, () => CampaignLogs.find({ campaign_id: campaign.id }, { _id: 0 }).lean());
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].status, 'failed');
    assert.strictEqual((await runAsTenant(1, () => Campaigns.findOne({ id: campaign.id }, { _id: 0 }).lean())).status, 'failed');
    assert.strictEqual(metaCalls.length, 3);
    for (const [attempt, min, max] of [[1, 30000, 36000], [2, 60000, 72000], [3, 120000, 144000], [10, 3600000, 4320000]]) {
      const ms = sendQueue.backoffMs(attempt, { backoffMs: 30000 });
      assert.ok(ms >= min && ms <= max, `attempt ${attempt}: ${ms}`);
    }
  });

  await t.test('C5. A Meta 4xx that is not a rate limit fails at once, without retries', async () => {
    const { brand } = await seed();
    const [lead] = await optedInLeads(1, brand, 1);
    await queueCampaignRow(1, brand, lead);
    metaReply = async () => {
      const err = new Error('Request failed with status code 400');
      err.response = { status: 400, data: { error: { code: 132001, message: 'Template name does not exist in the translation' } } };
      throw err;
    };
    const outcome = await sendQueue.processBatch();
    assert.strictEqual(outcome.failed, 1, JSON.stringify(outcome));
    const [row] = await rowsOf(1);
    assert.strictEqual(row.status, 'failed');
    assert.match(row.error_message, /Template name does not exist/);
    assert.strictEqual(metaCalls.length, 1);
  });

  await t.test('C6. The workspace sees its number health and queue, never another tenant\'s rows', async () => {
    const one = await seed({ tenantId: 1, phoneNumberId: 'PN1' });
    const two = await seed({ tenantId: 2, phoneNumberId: 'PN2' });
    await queueCampaignRow(1, one.brand, one.lead);
    const health = await request(app).get('/api/whatsapp/health').set(one.headers);
    assert.strictEqual(health.status, 200, JSON.stringify(health.body));
    assert.strictEqual(health.body.health.daily_cap, 250);
    assert.strictEqual(health.body.health.remaining_today, 250);
    assert.strictEqual(health.body.health.marketing_paused, false);
    assert.strictEqual(health.body.queue.pending, 1);
    const queue = await request(app).get('/api/whatsapp/send-queue').set(two.headers);
    assert.strictEqual(queue.status, 200);
    assert.strictEqual(queue.body.rows.length, 0, 'tenant 2 sees none of tenant 1\'s rows');
    const own = await request(app).get('/api/whatsapp/send-queue').set(one.headers);
    assert.strictEqual(own.body.rows.length, 1);
    assert.strictEqual(own.body.rows[0].phone, '…3210', 'the list masks numbers');
  });
});

test('D. Meta quality signals', async (t) => {
  const qualityWebhook = (field, value) => signed('/webhook/whatsapp', {
    object: 'whatsapp_business_account', entry: [{ id: 'WABA1', changes: [{ field, value }] }],
  });

  await t.test('D1. A FLAGGED number pauses marketing, halves the cap and emails the owner; utility still flows', async () => {
    const { brand, lead } = await seed({ inboundAgo: 60000 });
    await runAsTenant(1, () => consent.recordOptIn({ leadId: lead.id, source: 'form', text: 'Agreed' }));
    await queueCampaignRow(1, brand, lead);
    const res = await qualityWebhook('phone_number_quality_update', { display_phone_number: '919000000001', event: 'FLAGGED', current_limit: 'TIER_1K' });
    assert.strictEqual(res.status, 200);
    const state = await stateOf(1);
    assert.strictEqual(state.marketing_paused, true);
    assert.match(state.marketing_paused_reason, /flagged/i);
    assert.strictEqual(state.quality_event, 'FLAGGED');
    assert.strictEqual(state.messaging_limit, 'TIER_1K');
    assert.strictEqual(state.daily_cap, 125, 'cap halved');
    assert.ok(state.owner_notified_at);
    const mail = notify.outbox();
    assert.strictEqual(mail.length, 1);
    assert.strictEqual(mail[0].to, 'owner1@shop.test');
    assert.match(mail[0].subject, /marketing paused/i);
    assert.match(mail[0].text, /FLAGGED/);

    // Marketing waits; a utility template to the same contact is sent.
    const outcome = await sendQueue.processBatch();
    assert.strictEqual(outcome.deferred, 1, JSON.stringify(outcome));
    assert.strictEqual(metaCalls.length, 0);
    const [row] = await rowsOf(1);
    assert.match(row.error_message, /Marketing is paused/);
    await runAsTenant(1, () => sendQueue.enqueue({ leadId: lead.id, phone: lead.phone, phoneNumberId: 'PN1', kind: 'utility', payload: { type: 'template', template: { name: 'payment_received', language: { code: 'en' } } }, content: '[Template] payment_received', source: 'test' }));
    const second = await sendQueue.processBatch();
    assert.strictEqual(second.sent, 1, JSON.stringify(second));
    assert.strictEqual(metaCalls[0].body.template.name, 'payment_received');

    const health = await request(app).get('/api/whatsapp/health').set((await runAsTenant(1, async () => ({ headers: { Authorization: `Bearer ${makeToken(await Users.findOne({ role: 'owner' }).lean())}` } }))).headers);
    assert.strictEqual(health.body.health.marketing_paused, true);
  });

  await t.test('D2. UNFLAGGED resumes marketing automatically; the owner may resume by hand unless Meta still says RED', async () => {
    const { headers } = await seed();
    await qualityWebhook('phone_number_quality_update', { display_phone_number: '919000000001', event: 'FLAGGED' });
    assert.strictEqual((await stateOf(1)).marketing_paused, true);
    const refused = await request(app).post('/api/whatsapp/health/resume').set(headers).send({});
    assert.strictEqual(refused.status, 409, 'still flagged: stays paused');
    assert.strictEqual(refused.body.code, 'QUALITY_STILL_LOW');
    await qualityWebhook('phone_number_quality_update', { display_phone_number: '919000000001', event: 'UNFLAGGED' });
    assert.strictEqual((await stateOf(1)).marketing_paused, false);
    assert.strictEqual(notify.outbox().length, 2, 'paused and resumed mails');
    assert.match(notify.outbox()[1].subject, /resumed/i);

    // A YELLOW rating from the inventory sync pauses; the owner can override it by hand.
    await runAsTenant(1, () => numberHealth.recordQuality('PN1', { rating: 'YELLOW', source: 'inventory_sync' }));
    assert.strictEqual((await stateOf(1)).marketing_paused, true);
    const resumed = await request(app).post('/api/whatsapp/health/resume').set(headers).send({});
    assert.strictEqual(resumed.status, 200, JSON.stringify(resumed.body));
    assert.strictEqual(resumed.body.health.marketing_paused, false);
    await runAsTenant(1, () => numberHealth.recordQuality('PN1', { rating: 'RED', source: 'inventory_sync' }));
    assert.strictEqual((await stateOf(1)).marketing_paused, true);
    assert.strictEqual((await request(app).post('/api/whatsapp/health/resume').set(headers).send({})).status, 409);
  });

  await t.test('D3. Meta error 131048 (spam rate) on a delivery receipt pauses the number; an account restriction too', async () => {
    await seed();
    await signed('/webhook/whatsapp', {
      object: 'whatsapp_business_account', entry: [{ id: 'WABA1', changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp', metadata: { display_phone_number: '919000000001', phone_number_id: 'PN1' },
        statuses: [{ id: 'wamid.X', status: 'failed', errors: [{ code: 131048, title: 'Spam rate limit hit' }] }],
      } }] }],
    });
    const state = await stateOf(1);
    assert.strictEqual(state.marketing_paused, true);
    assert.match(notify.outbox()[0].text, /131048|spam/i);
    await runAsTenant(1, () => WhatsappNumberState.updateOne({ phone_number_id: 'PN1' }, { $set: { marketing_paused: false, quality_event: 'UNFLAGGED' } }));
    await qualityWebhook('account_update', { event: 'ACCOUNT_RESTRICTION', restriction_info: [{ restriction_type: 'RESTRICTED_ADD_PHONE_NUMBER_ACTION' }] });
    assert.strictEqual((await stateOf(1)).marketing_paused, true, 'WABA-level restriction reaches the number by its WABA id');
  });

  await t.test('D4. Only owners and admins can pause or resume; agents cannot; a manual pause is not lifted by Meta', async () => {
    const { brand, headers } = await seed();
    const paused = await request(app).post('/api/whatsapp/health/pause').set(headers).send({ reason: 'Fixing the template first' });
    assert.strictEqual(paused.status, 200, JSON.stringify(paused.body));
    assert.strictEqual(paused.body.health.marketing_paused, true);
    await qualityWebhook('phone_number_quality_update', { display_phone_number: '919000000001', event: 'UNFLAGGED' });
    assert.strictEqual((await stateOf(1)).marketing_paused, true, 'Meta cannot lift a pause a person set');
    assert.strictEqual((await request(app).post('/api/whatsapp/health/resume').set(headers).send({})).status, 200);
    assert.strictEqual((await stateOf(1)).marketing_paused, false);
    const agent = (await runAsSystem(() => Users.create({ tenant_id: 1, role: 'agent', email: 'agent@shop.test', name: 'Agent', password_hash: 'x', is_active: true, token_version: 0 }), 'test')).toObject();
    const res = await request(app).post('/api/whatsapp/health/pause').set({ Authorization: `Bearer ${makeToken(agent)}` }).send({ reason: 'test' });
    assert.strictEqual(res.status, 403);
    assert.strictEqual((await stateOf(1, brand.phone_number_id)).marketing_paused, false);
  });
});

test('E. The 24-hour window', async (t) => {
  await t.test('E1. An AI reply (free text) is refused outside the window and sent inside it', async () => {
    const { lead } = await seed({ inboundAgo: 25 * 3600 * 1000 });
    const closed = await request(app).post('/api/internal/send-reply').set(service(1)).send({ lead_id: lead.id, message: 'Hello again' });
    assert.strictEqual(closed.status, 409, JSON.stringify(closed.body));
    assert.strictEqual(closed.body.code, 'WINDOW_CLOSED');
    assert.strictEqual(metaCalls.length, 0);
    await runAsTenant(1, async () => {
      const conversation = await Conversations.findOne({ lead_id: lead.id }).lean();
      await Messages.create({ conversation_id: conversation.id, direction: 'inbound', content: 'hello?', sent_at: new Date() });
    });
    const open = await request(app).post('/api/internal/send-reply').set(service(1)).send({ lead_id: lead.id, message: 'Hello again' });
    assert.strictEqual(open.status, 200, JSON.stringify(open.body));
    assert.strictEqual(metaCalls.length, 1);
    assert.strictEqual(metaCalls[0].body.text.body, 'Hello again');
    assert.strictEqual((await stateOf(1)).templates_today, 0, 'a reply in the window does not use the daily cap');
    assert.strictEqual((await stateOf(1)).sent_this_minute, 1, 'but counts for the per-minute limit');
  });

  await t.test('E2. Outside the window only templates go: utility to anyone, marketing only with opt-in', async () => {
    const { brand, lead } = await seed({ inboundAgo: 3 * 24 * 3600 * 1000 });
    await runAsTenant(1, () => Templates.create({ name: 'payment_received', category: 'UTILITY', body: 'Paid', status: 'approved', client_id: brand.id, meta_template_id: 'T2' }));
    const utility = await request(app).post('/api/internal/send-template').set(service(1)).send({ lead_id: lead.id, template: 'payment_received' });
    assert.strictEqual(utility.status, 200, JSON.stringify(utility.body));
    assert.strictEqual(metaCalls[0].body.template.name, 'payment_received');

    const marketing = await request(app).post('/api/internal/send-template').set(service(1)).send({ lead_id: lead.id, template: 'follow_up' });
    assert.strictEqual(marketing.status, 403, JSON.stringify(marketing.body));
    assert.strictEqual(marketing.body.code, 'CONSENT_REQUIRED');
    assert.strictEqual(metaCalls.length, 1);

    await runAsTenant(1, () => consent.recordOptIn({ leadId: lead.id, source: 'form', text: 'Agreed' }));
    const allowed = await request(app).post('/api/internal/send-template').set(service(1)).send({ lead_id: lead.id, template: 'follow_up' });
    assert.strictEqual(allowed.status, 200, JSON.stringify(allowed.body));
    assert.strictEqual((await stateOf(1)).templates_today, 2);

    await runAsTenant(1, () => consent.recordOptOut({ leadId: lead.id, source: 'manual', text: 'Asked on the phone' }));
    const stopped = await request(app).post('/api/internal/send-template').set(service(1)).send({ lead_id: lead.id, template: 'follow_up' });
    assert.strictEqual(stopped.status, 403);
    assert.strictEqual(stopped.body.code, 'CONTACT_OPTED_OUT');
    const stillUtility = await request(app).post('/api/internal/send-template').set(service(1)).send({ lead_id: lead.id, template: 'payment_received' });
    assert.strictEqual(stillUtility.status, 200, 'a STOP ends marketing only');
  });

  await t.test('E3. The inbox wake-up template obeys STOP and consent; free text inside the window is a reply', async () => {
    const { lead, headers } = await seed({ inboundAgo: 2 * 24 * 3600 * 1000 });
    const noConsent = await request(app).post('/api/whatsapp/send').set(headers).send({ lead_id: lead.id, message: 'Hello', msg_type: 'text' });
    assert.strictEqual(noConsent.status, 200);
    assert.strictEqual(noConsent.body.window_closed, true);
    assert.strictEqual(noConsent.body.blocked, true);
    assert.strictEqual(noConsent.body.code, 'CONSENT_REQUIRED');
    assert.strictEqual(metaCalls.length, 0, 'no wake-up template without consent');

    await runAsTenant(1, () => consent.recordOptIn({ leadId: lead.id, source: 'form', text: 'Agreed' }));
    const wake = await request(app).post('/api/whatsapp/send').set(headers).send({ lead_id: lead.id, message: 'Hello', msg_type: 'text' });
    assert.strictEqual(wake.body.window_closed, true);
    assert.strictEqual(wake.body.blocked, undefined);
    assert.strictEqual(metaCalls.length, 1);
    assert.strictEqual(metaCalls[0].body.type, 'template');

    await runAsTenant(1, () => consent.recordOptOut({ leadId: lead.id, source: 'inbound_keyword', text: 'STOP' }));
    metaCalls.length = 0;
    await runAsTenant(1, () => Messages.deleteMany({ msg_type: 'template' }));
    const stopped = await request(app).post('/api/whatsapp/send').set(headers).send({ lead_id: lead.id, message: 'Hello', msg_type: 'text' });
    assert.strictEqual(stopped.body.code, 'CONTACT_OPTED_OUT');
    assert.strictEqual(metaCalls.length, 0);

    // The customer writes back: the agent's free-text reply is a service message and goes through.
    await inboundWebhook('PN1', PHONE, 'ok tell me more');
    metaCalls.length = 0;
    const reply = await request(app).post('/api/whatsapp/send').set(headers).send({ lead_id: lead.id, message: 'Sure, here are the details', msg_type: 'text' });
    assert.strictEqual(reply.status, 200, JSON.stringify(reply.body));
    assert.strictEqual(reply.body.success, true);
    assert.strictEqual(metaCalls[0].body.text.body, 'Sure, here are the details');
  });
});
