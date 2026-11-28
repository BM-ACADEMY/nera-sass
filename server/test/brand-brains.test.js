/**
 * Brand brains: several brands on one WhatsApp number, one AI brain each, and
 * the fixed router that picks the brand before any prompt is built.
 * In-memory MongoDB; the LLM and Meta are replaced, nothing leaves the test.
 */
const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken, TEST_INTERNAL_KEY } = require('./setup');

let app;

const BASE = {
  business_hours: { days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '23:59' },
  timezone: 'Asia/Kolkata',
  qualifying_questions: ['What do you need?', 'When?'],
  conversation_goal: 'collect_requirement',
  tone: 'Warm',
  languages: ['English', 'Tamil'],
  pricing_policy: 'share_listed',
  after_hours_message: 'We are closed now',
  handoff_contacts: 'Front desk',
};
const TECHX = {
  ...BASE,
  business_name: 'BM TechX',
  business_description: 'TECHXDESC Google Maps listings and websites',
  products_and_services: ['Google Maps listing', 'Website'],
  route_keywords: ['bm techx', 'google maps', 'website'],
};
const ACADEMY = {
  ...BASE,
  business_name: 'BM Academy',
  business_description: 'ACADEMYDESC Python and Java courses with placement support',
  products_and_services: ['Python course', 'Java course'],
  route_keywords: ['bm academy', 'course', 'placement'],
};

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  process.env.N8N_BRAIN_WEBHOOK_URL = 'http://n8n.test/brain';
  await startTestDb();
  ({ app } = require('../server'));
});

test.after(async () => {
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearCollections();
});

test('Brand brains', async (t) => {
  const axios = require('axios');
  const openRouter = require('../services/openrouter');
  const { AiReplyLogs, BrainDocs, BrainProfiles, Tenants, Clients, Leads, Conversations, Messages, Users } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const sys = (fn) => runAsSystem(fn, 'test');
  const service = (tenantId) => ({ 'x-internal-key': TEST_INTERNAL_KEY, 'x-tenant-id': String(tenantId) });
  const realPost = axios.post;
  const realGenerate = openRouter.models.generateContent;
  let sends;
  let prompts;

  const llmReturns = (output) => {
    openRouter.models.generateContent = async ({ contents, config }) => {
      prompts.push({ user: contents, system: config.system });
      return { text: JSON.stringify({ handoff: false, handoff_reason: null, lead_updates: {}, opt_out: false, ...output }), usage: { prompt_tokens: 5, completion_tokens: 2 } };
    };
  };

  t.beforeEach(async () => {
    await clearCollections();
    sends = [];
    prompts = [];
    axios.post = async (url, body) => {
      sends.push({ url, body });
      return { data: { messages: [{ id: `wamid.${sends.length}` }] } };
    };
    openRouter.models.generateContent = realGenerate;
  });
  t.after(() => {
    axios.post = realPost;
    openRouter.models.generateContent = realGenerate;
  });

  async function user(tenantId, role = 'owner', sections = undefined) {
    const row = (await sys(() => Users.create({ tenant_id: tenantId, role, ...(sections && { sections }), email: `${role}${Math.random()}@t.test`, name: role, is_active: true, token_version: 0 }))).toObject();
    return { Authorization: `Bearer ${makeToken(row)}` };
  }

  // A workspace whose one number serves BM TechX (its own client) and BM Academy.
  async function seed(tenantId = 1, { techxOn = true, academyOn = true, academy = ACADEMY, lead = {} } = {}) {
    await sys(() => Tenants.create({ id: tenantId, name: `T${tenantId}`, status: 'active', timezone: 'Asia/Kolkata' }));
    return runAsTenant(tenantId, async () => {
      const client = (await Clients.create({ name: 'BM TechX', phone_number_id: `PN${tenantId}`, wa_access_token: 'test-dummy-token' })).toObject();
      const academyId = await Clients.nextId();
      await BrainProfiles.create({ client_id: client.id, profile: TECHX, ai_enabled: techxOn, brain_version: 4, version_type: 'client' });
      if (academy) await BrainProfiles.create({ client_id: academyId, brand_name: 'BM Academy', profile: academy, ai_enabled: academyOn, brain_version: 1, version_type: 'client' });
      await BrainDocs.create({ client_id: client.id, doc_type: 'product:t', title: 'TechX price', content: 'TECHXDOC Google Maps listing costs ₹4,999' });
      await BrainDocs.create({ client_id: academyId, doc_type: 'product:a', title: 'Academy fees', content: 'ACADEMYDOC Python course fees ₹25,000' });
      const row = (await Leads.create({ name: 'Ravi', phone: '919876543210', client_id: client.id, status: 'new', last_inbound_at: new Date(), ...lead })).toObject();
      const conversation = await Conversations.create({ lead_id: row.id, phone: '9876543210', status: 'open' });
      return { client, academyId, lead: row, conversation };
    });
  }

  const inbound = (tenantId, conversation, content) => runAsTenant(tenantId, async () => (await Messages.create({
    conversation_id: conversation.id, direction: 'inbound', content, msg_type: 'text', sent_at: new Date(),
  })).toObject());
  const reply = (tenantId, leadId, messageId) => request(app).post('/api/internal/ai/reply').set(service(tenantId)).send({ lead_id: leadId, message_id: messageId });
  const lastLog = (tenantId) => runAsTenant(tenantId, () => AiReplyLogs.findOne({}).sort({ id: -1 }).lean());
  const leadOf = (tenantId, id) => runAsTenant(tenantId, () => Leads.findOne({ id }).lean());
  const noTechx = (text) => !/TECHXDOC|TECHXDESC|4,999|BM TechX/.test(text);
  const noAcademy = (text) => !/ACADEMYDOC|ACADEMYDESC|25,000|BM Academy/.test(text);

  await t.test('An Academy message goes to the Academy brain: the model never sees TechX text or prices, and the brand sticks', async () => {
    const { academyId, lead, conversation } = await seed();
    llmReturns({ reply: 'The Python course starts Monday.' });
    const first = await inbound(1, conversation, 'Python course details please');
    const res = await reply(1, lead.id, first.id);
    assert.strictEqual(res.body.sent, true, JSON.stringify(res.body));
    assert.strictEqual(res.body.brand_client_id, academyId);
    assert.strictEqual(prompts.length, 1);
    assert.ok(prompts[0].user.includes('ACADEMYDOC') && prompts[0].user.includes('BM Academy'));
    assert.ok(noTechx(prompts[0].user), 'no TechX profile, document or price reaches the model');
    assert.ok(noTechx(prompts[0].system));
    assert.strictEqual((await leadOf(1, lead.id)).brand_client_id, academyId, 'the brand is kept for the chat');
    const log = await lastLog(1);
    assert.strictEqual(log.brand_client_id, academyId);
    assert.strictEqual(log.brand_route, 'keywords');

    // The next message names no brand (and even a TechX word): still Academy.
    llmReturns({ reply: 'Fees are ₹25,000.' });
    const second = await inbound(1, conversation, 'And do you make a website for students?');
    assert.strictEqual((await reply(1, lead.id, second.id)).body.sent, true);
    assert.ok(prompts[1].user.includes('ACADEMYDOC'));
    assert.ok(!prompts[1].user.includes('TECHXDOC') && !prompts[1].user.includes('4,999'));
    assert.strictEqual((await lastLog(1)).brand_route, 'conversation');
  });

  await t.test('A TechX message goes to the TechX brain with only TechX documents', async () => {
    const { client, lead, conversation } = await seed();
    llmReturns({ reply: 'A Google Maps listing is ₹4,999.' });
    const msg = await inbound(1, conversation, 'Google Maps listing price?');
    const res = await reply(1, lead.id, msg.id);
    assert.strictEqual(res.body.sent, true, JSON.stringify(res.body));
    assert.strictEqual(res.body.brand_client_id, client.id);
    assert.ok(prompts[0].user.includes('TECHXDOC'));
    assert.ok(noAcademy(prompts[0].user));
    assert.strictEqual(sends[0].body.text.body, 'A Google Maps listing is ₹4,999.');
    assert.strictEqual((await leadOf(1, lead.id)).brand_client_id, client.id);
  });

  await t.test('The ad the lead came from wins over words in the message', async () => {
    const { academyId, lead, conversation } = await seed(1, {
      academy: { ...ACADEMY, route_ad_keywords: ['python batch'] },
      lead: { source: 'facebook', ad_name: 'Python Batch November' },
    });
    llmReturns({ reply: 'Welcome to BM Academy.' });
    const msg = await inbound(1, conversation, 'Do you also do Google Maps?');
    const res = await reply(1, lead.id, msg.id);
    assert.strictEqual(res.body.brand_client_id, academyId, JSON.stringify(res.body));
    assert.strictEqual((await lastLog(1)).brand_route, 'ad');
    assert.ok(noTechx(prompts[0].user));
  });

  await t.test('Unclear with both brands on: one fixed brand question, no model call, asked only once', async () => {
    const { lead, conversation } = await seed();
    llmReturns({ reply: 'should not be called' });
    const hi = await inbound(1, conversation, 'Hi');
    const res = await reply(1, lead.id, hi.id);
    assert.strictEqual(res.body.brand_question, true, JSON.stringify(res.body));
    assert.strictEqual(prompts.length, 0);
    assert.strictEqual(sends.length, 1);
    assert.strictEqual(sends[0].body.text.body, 'Are you asking about BM TechX or BM Academy?');
    const log = await lastLog(1);
    assert.strictEqual(log.status, 'sent');
    assert.strictEqual(log.cost_usd, 0);
    assert.strictEqual((await leadOf(1, lead.id)).brand_client_id, undefined, 'no brand fixed yet');

    const again = await inbound(1, conversation, 'Hello?');
    const second = await reply(1, lead.id, again.id);
    assert.strictEqual(second.body.sent, false);
    assert.strictEqual(sends.length, 1, 'the question is not repeated');
    assert.strictEqual(prompts.length, 0);

    // The answer settles it.
    llmReturns({ reply: 'Sure, the Academy team here.' });
    const answer = await inbound(1, conversation, 'BM Academy');
    assert.strictEqual((await reply(1, lead.id, answer.id)).body.sent, true);
    assert.ok(prompts[0].user.includes('ACADEMYDOC'));
    assert.ok(!prompts[0].user.includes('TECHXDOC') && !prompts[0].user.includes('4,999'), 'only the question names TechX; no TechX facts');
  });

  await t.test('A brand with AI off gets no reply and no model call; unclear chats go to the only brand that is on', async () => {
    const { academyId, lead, conversation } = await seed(1, { academyOn: false });
    llmReturns({ reply: 'This is BM TechX.' });
    const academy = await inbound(1, conversation, 'Placement guarantee for the course?');
    const res = await reply(1, lead.id, academy.id);
    assert.strictEqual(res.body.sent, false, JSON.stringify(res.body));
    assert.strictEqual(res.body.out_of_scope, true);
    assert.strictEqual(prompts.length, 0, 'no model call');
    assert.strictEqual(sends.length, 0);
    const saved = await leadOf(1, lead.id);
    assert.strictEqual(saved.brand_client_id, academyId);
    assert.ok(!saved.needs_human && !saved.ai_paused, 'no handover alert');
    const log = await lastLog(1);
    assert.strictEqual(log.status, 'no_send');
    assert.strictEqual(log.cost_usd, 0);

    // Another lead says only "Hi": TechX (the only brand on) answers as today.
    const other = await runAsTenant(1, async () => {
      const row = (await Leads.create({ name: 'Anu', phone: '919800000001', client_id: lead.client_id, status: 'new', last_inbound_at: new Date() })).toObject();
      return { lead: row, conversation: await Conversations.create({ lead_id: row.id, phone: '9800000001', status: 'open' }) };
    });
    const hi = await inbound(1, other.conversation, 'Hi');
    const answered = await reply(1, other.lead.id, hi.id);
    assert.strictEqual(answered.body.sent, true, JSON.stringify(answered.body));
    assert.ok(prompts[0].user.includes('TECHXDOC'));
    assert.ok(noAcademy(prompts[0].user));
    assert.strictEqual((await leadOf(1, other.lead.id)).brand_client_id, undefined, 'a fallback does not fix the brand');
  });

  await t.test('One brand brain (after migration 045): the keyword rule works as before', async () => {
    await sys(() => Tenants.create({ id: 3, name: 'T3', status: 'active', timezone: 'Asia/Kolkata' }));
    const { lead, conversation } = await runAsTenant(3, async () => {
      const client = (await Clients.create({ name: 'BM TechX', phone_number_id: 'PN3', wa_access_token: 'test-dummy-token' })).toObject();
      await BrainProfiles.create({ client_id: client.id, profile: { ...TECHX, brand_skip_keywords: ['course'], brand_keep_keywords: ['bm techx'] }, ai_enabled: true, version_type: 'client' });
      const row = (await Leads.create({ name: 'R', phone: '919811111111', client_id: client.id, status: 'new', last_inbound_at: new Date() })).toObject();
      return { lead: row, conversation: await Conversations.create({ lead_id: row.id, phone: '9811111111', status: 'open' }) };
    });
    llmReturns({ reply: 'This is BM TechX.' });
    const skip = await inbound(3, conversation, 'course details?');
    const res = await reply(3, lead.id, skip.id);
    assert.strictEqual(res.body.out_of_scope, true, JSON.stringify(res.body));
    assert.strictEqual(prompts.length, 0);
    const ok = await inbound(3, conversation, 'BM TechX website?');
    assert.strictEqual((await reply(3, lead.id, ok.id)).body.sent, true);
  });

  await t.test('Sandbox: router mode shows the brand and why with no model call; auto mode answers as that brand only', async () => {
    const { academyId } = await seed();
    const who = await user(1);
    llmReturns({ reply: 'Python course is ₹25,000.' });
    const routerOnly = await request(app).post('/api/brain/test').set(who).send({ message: 'placement for the course?', mode: 'router' });
    assert.strictEqual(routerOnly.status, 200, JSON.stringify(routerOnly.body));
    assert.strictEqual(routerOnly.body.router.client_id, academyId);
    assert.strictEqual(routerOnly.body.router.name, 'BM Academy');
    assert.strictEqual(routerOnly.body.router.reason, 'keywords');
    assert.strictEqual(prompts.length, 0);

    const auto = await request(app).post('/api/brain/test').set(who).send({ message: 'Python course fees?' });
    assert.strictEqual(auto.status, 200, JSON.stringify(auto.body));
    assert.strictEqual(auto.body.router.name, 'BM Academy');
    assert.ok(noTechx(prompts[0].user));

    const unclear = await request(app).post('/api/brain/test').set(who).send({ message: 'Hi' });
    assert.strictEqual(unclear.body.brand_question, true);
    assert.strictEqual(unclear.body.reply, 'Are you asking about BM TechX or BM Academy?');

    const chosen = await request(app).post('/api/brain/test').set(who).send({ message: 'Hi', client_id: academyId });
    assert.strictEqual(chosen.status, 200, JSON.stringify(chosen.body));
    assert.strictEqual(chosen.body.router.client_id, academyId);
    assert.ok(noTechx(prompts[prompts.length - 1].user));
    assert.strictEqual(sends.length, 0);
  });

  await t.test('API: add a brand, then read and save each brand\'s brain on its own', async () => {
    await sys(() => Tenants.create({ id: 5, name: 'T5', status: 'active', timezone: 'Asia/Kolkata' }));
    const client = await runAsTenant(5, async () => {
      const row = (await Clients.create({ name: 'BM TechX', phone_number_id: 'PN5', wa_access_token: 'test-dummy-token' })).toObject();
      await BrainProfiles.create({ profile: TECHX, ai_enabled: true, version_type: 'client', brain_version: 2 });
      return row;
    });
    const owner = await user(5);
    const single = await request(app).get('/api/brain/brands').set(owner);
    assert.strictEqual(single.status, 200);
    assert.strictEqual(single.body.multi, false);
    assert.strictEqual(single.body.brands[0].client_id, client.id);

    const added = await request(app).post('/api/brain/brands').set(owner).send({ name: 'BM Academy' });
    assert.strictEqual(added.status, 200, JSON.stringify(added.body));
    const academyId = added.body.client_id;
    assert.notStrictEqual(academyId, client.id);
    const list = await request(app).get('/api/brain/brands').set(owner);
    assert.strictEqual(list.body.multi, true);
    assert.deepStrictEqual(list.body.brands.map((b) => [b.client_id, b.name, b.ai_enabled]), [[client.id, 'BM TechX', true], [academyId, 'BM Academy', false]]);
    const legacy = await runAsTenant(5, () => BrainProfiles.findOne({ brain_version: 2 }).lean());
    assert.strictEqual(legacy.client_id, client.id, 'the old brain became the TechX brain');

    const saved = await request(app).put('/api/brain/profile').set(owner).send({ client_id: academyId, profile: ACADEMY });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    assert.strictEqual(saved.body.client_id, academyId);
    assert.deepStrictEqual(saved.body.profile.route_keywords, ['bm academy', 'course', 'placement']);
    assert.strictEqual((await request(app).get(`/api/brain/profile?client_id=${academyId}`).set(owner)).body.profile.business_name, 'BM Academy');
    assert.strictEqual((await request(app).get('/api/brain/profile').set(owner)).body.profile.business_name, 'BM TechX', 'no client_id = the workspace brain, as before');

    const doc = await request(app).post('/api/brain/docs').set(owner).send({ client_id: academyId, kind: 'faq', title: 'Fees', content: 'Python ₹25,000' });
    assert.strictEqual(doc.body.doc.client_id, academyId);
    assert.strictEqual((await request(app).get(`/api/brain?client_id=${client.id}`).set(owner)).body.docs.length, 0, 'TechX documents do not list Academy items');

    assert.strictEqual((await request(app).get('/api/brain/profile?client_id=999999').set(owner)).status, 404);
    // Another workspace cannot reach this brand.
    await sys(() => Tenants.create({ id: 6, name: 'T6', status: 'active', timezone: 'Asia/Kolkata' }));
    await runAsTenant(6, () => Clients.create({ name: 'Other', phone_number_id: 'PN6', wa_access_token: 'test-dummy-token' }));
    const stranger = await user(6);
    assert.strictEqual((await request(app).get(`/api/brain/profile?client_id=${academyId}`).set(stranger)).status, 404);
    assert.strictEqual((await request(app).put('/api/brain/profile').set(stranger).send({ client_id: academyId, profile: ACADEMY })).status, 404);
    assert.strictEqual((await runAsTenant(5, () => BrainProfiles.findOne({ client_id: academyId }).lean())).profile.business_name, 'BM Academy');
  });

  await t.test('API: only an Owner turns a brand\'s AI on or off; editing needs the AI Brain section', async () => {
    const { client, academyId } = await seed(1, { academyOn: false });
    const admin = await user(1, 'admin');
    const denied = await request(app).post('/api/brain/ai-toggle').set(admin).send({ client_id: academyId, enabled: true });
    assert.strictEqual(denied.status, 403);

    const owner = await user(1);
    const on = await request(app).post('/api/brain/ai-toggle').set(owner).send({ client_id: academyId, enabled: true });
    assert.strictEqual(on.status, 200, JSON.stringify(on.body));
    assert.strictEqual(on.body.ai_enabled, true);
    assert.strictEqual(on.body.client_id, academyId);
    const brains = await runAsTenant(1, () => BrainProfiles.find({}).sort({ id: 1 }).lean());
    assert.deepStrictEqual(brains.map((b) => b.ai_enabled), [true, true]);

    // Off for TechX leaves the workspace switch on while Academy is on.
    await request(app).post('/api/brain/ai-toggle').set(owner).send({ client_id: client.id, enabled: false });
    assert.strictEqual((await sys(() => Tenants.findOne({ id: 1 }).lean())).ai_enabled, true);
    await request(app).post('/api/brain/ai-toggle').set(owner).send({ client_id: academyId, enabled: false });
    assert.strictEqual((await sys(() => Tenants.findOne({ id: 1 }).lean())).ai_enabled, false);

    const noSection = await user(1, 'staff', ['leads', 'inbox']);
    assert.strictEqual((await request(app).get('/api/brain/brands').set(noSection)).status, 403);
    assert.strictEqual((await request(app).put('/api/brain/profile').set(noSection).send({ client_id: academyId, profile: ACADEMY })).status, 403);
    const withSection = await user(1, 'staff', ['ai_brain']);
    assert.strictEqual((await request(app).get(`/api/brain/profile?client_id=${academyId}`).set(withSection)).status, 200);
    assert.strictEqual((await request(app).put('/api/brain/profile').set(withSection).send({ client_id: academyId, profile: ACADEMY })).status, 200);
    assert.strictEqual((await request(app).post('/api/brain/ai-toggle').set(withSection).send({ client_id: academyId, enabled: true })).status, 403);
  });

  await t.test('Migration 045: dry run changes nothing, apply sets the brand, a second run is a no-op', async () => {
    const { migrate } = require('../migrations/045_brand_brains');
    const quiet = () => {};
    await sys(() => Tenants.create({ id: 12, name: 'BM', status: 'active' }));
    await sys(() => Tenants.create({ id: 13, name: 'Mixed', status: 'active' }));
    const client12 = await runAsTenant(12, async () => {
      const client = (await Clients.create({ name: 'BM TechX', phone_number_id: 'PN12', wa_access_token: 'test-dummy-token' })).toObject();
      await BrainProfiles.create({ profile: { ...TECHX, route_keywords: [], brand_keep_keywords: ['bm techx', 'google maps'], brand_skip_keywords: ['course'] }, ai_enabled: true });
      await BrainDocs.create({ client_id: client.id, doc_type: 'faq:1', content: 'x' });
      await BrainDocs.create({ client_id: client.id, doc_type: 'faq:2', content: 'y' });
      return client;
    });
    await runAsTenant(13, async () => {
      await BrainProfiles.create({ profile: TECHX });
      await BrainDocs.create({ client_id: 9001, doc_type: 'faq:1', content: 'x' });
      await BrainDocs.create({ client_id: 9002, doc_type: 'faq:2', content: 'y' });
    });
    // The index production still has from before brand brains.
    await BrainProfiles.collection.createIndex({ tenant_id: 1 }, { name: 'tenant_id_1', unique: true, partialFilterExpression: { tenant_id: { $exists: true } } });

    const dry = await migrate({ log: quiet });
    assert.strictEqual(dry.old_index_dropped, true);
    assert.strictEqual(dry.brains_assigned, 1);
    assert.strictEqual(dry.skipped, 1);
    const untouched = await runAsTenant(12, () => BrainProfiles.findOne({}).lean());
    assert.strictEqual(untouched.client_id, null);
    assert.ok((await BrainProfiles.collection.indexes()).some((ix) => ix.name === 'tenant_id_1'));

    const applied = await migrate({ apply: true, log: quiet });
    assert.strictEqual(applied.brains_assigned, 1);
    const brain = await runAsTenant(12, () => BrainProfiles.findOne({}).lean());
    assert.strictEqual(brain.client_id, client12.id);
    assert.deepStrictEqual(brain.profile.route_keywords, ['bm techx', 'google maps']);
    assert.deepStrictEqual(brain.profile.brand_skip_keywords, ['course'], 'the keyword rule is kept');
    assert.strictEqual(brain.ai_enabled, true);
    assert.strictEqual((await runAsTenant(13, () => BrainProfiles.findOne({}).lean())).client_id, null, 'documents on two brands: left alone');
    assert.ok(!(await BrainProfiles.collection.indexes()).some((ix) => ix.name === 'tenant_id_1'));
    assert.strictEqual(await runAsTenant(12, () => BrainProfiles.countDocuments({})), 1, 'no Academy brain is created');

    // A second brain per workspace is now possible; running again changes nothing.
    await runAsTenant(12, () => BrainProfiles.create({ client_id: client12.id + 1000, brand_name: 'BM Academy', profile: ACADEMY }));
    const again = await migrate({ apply: true, log: quiet });
    assert.strictEqual(again.brains_assigned, 0);
    assert.strictEqual(again.old_index_dropped, false);
    assert.strictEqual((await runAsTenant(12, () => BrainProfiles.findOne({ brand_name: null }).lean())).client_id, client12.id);
  });
});
