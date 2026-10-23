/**
 * Server side of the n8n AI workflows: the context n8n reads, handover that
 * really pauses the AI, the AI follow-up schedule (separate from SalesOS),
 * and the checks that keep paused or opted-out chats away from the AI.
 * In-memory MongoDB; no n8n, LLM or Meta call is made.
 */
const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken, TEST_INTERNAL_KEY } = require('./setup');

let app;
const DAY = 86400000;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  process.env.AI_SENDING_HOURS = '0-24'; // F4 checks the real hours
  await startTestDb();
  ({ app } = require('../server'));
});

test.after(async () => {
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearCollections();
});

test('n8n AI automation', async (t) => {
  const { Tenants, Clients, Leads, Conversations, Messages, BrainDocs, Users } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const ai = require('../services/aiAutomation');
  const sys = (fn) => runAsSystem(fn, 'test');
  const service = (tenantId) => ({ 'x-internal-key': TEST_INTERNAL_KEY, 'x-tenant-id': String(tenantId) });
  const platform = { 'x-internal-key': TEST_INTERNAL_KEY };

  async function seed() {
    await sys(() => Tenants.create([
      { id: 1, name: 'Acme Homes', status: 'active', timezone: 'Asia/Kolkata', language: 'en' },
      { id: 2, name: 'Beta Foods', status: 'active', timezone: 'Asia/Kolkata', language: 'en' },
    ]));
    const brand = (await runAsTenant(1, () => Clients.create({ name: 'Acme Brand', phone_number_id: 'PN1', wa_access_token: 'test-dummy-token' }))).toObject();
    const lead = (await runAsTenant(1, () => Leads.create({ name: 'Ravi', phone: '919876543210', client_id: brand.id, status: 'new' }))).toObject();
    return { brand, lead };
  }

  async function thread(tenantId, lead, texts) {
    return runAsTenant(tenantId, async () => {
      const conversation = await Conversations.create({ lead_id: lead.id, phone: String(lead.phone).slice(-10), status: 'open' });
      const saved = [];
      for (const [direction, content] of texts) {
        saved.push((await Messages.create({ conversation_id: conversation.id, direction, content, msg_type: 'text', is_ai: direction === 'outbound', sent_at: new Date() })).toObject());
      }
      return saved;
    });
  }

  await t.test('C1. Context returns the stored message history (older than the message being answered), knowledge and lead', async () => {
    const { brand, lead } = await seed();
    await runAsTenant(1, () => BrainDocs.create({ client_id: brand.id, doc_type: 'pricing', content: '2BHK from 45 lakh' }));
    const msgs = await thread(1, lead, [['inbound', 'Hi'], ['outbound', 'Hello! How can I help?'], ['inbound', 'Price of 2BHK?']]);
    const res = await request(app).get('/api/internal/context').set(service(1)).query({ lead_id: lead.id, before_message_id: msgs[2].id });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.business_name, 'Acme Homes');
    assert.deepStrictEqual(res.body.messages.map((m) => m.content), ['Hi', 'Hello! How can I help?']);
    assert.strictEqual(res.body.messages[1].direction, 'outbound');
    assert.deepStrictEqual(res.body.brain, [{ doc_type: 'pricing', content: '2BHK from 45 lakh' }]);
    assert.strictEqual(res.body.ai_paused, false);
    assert.ok(!JSON.stringify(res.body).includes('test-dummy-token'), 'no WhatsApp token in the context');
  });

  await t.test('C2. Another tenant gets 404 for this lead; a wrong key is refused', async () => {
    const { lead } = await seed();
    assert.strictEqual((await request(app).get('/api/internal/context').set(service(2)).query({ lead_id: lead.id })).status, 404);
    assert.strictEqual((await request(app).get('/api/internal/context').set({ 'x-internal-key': 'wrong', 'x-tenant-id': '1' }).query({ lead_id: lead.id })).status, 401);
    assert.strictEqual((await request(app).post('/api/internal/handover').set(service(2)).send({ lead_id: lead.id, reason: 'x' })).status, 404);
  });

  await t.test('H1. Handover is saved, pauses the AI, and a person can hand the chat back', async () => {
    const { lead } = await seed();
    const res = await request(app).post('/api/internal/handover').set(service(1)).send({ lead_id: lead.id, reason: 'Asked for a discount', draft: 'Our team will confirm.' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const saved = await runAsTenant(1, () => Leads.findOne({ id: lead.id }).lean());
    assert.strictEqual(saved.ai_paused, true);
    assert.strictEqual(saved.needs_human, true);
    assert.strictEqual(saved.handover_reason, 'Asked for a discount');
    assert.strictEqual(saved.ai_draft, 'Our team will confirm.');
    const tenant = await sys(() => Tenants.findOne({ id: 1 }).lean());
    assert.strictEqual(await runAsTenant(1, () => ai.aiBlockReason(tenant, saved)), 'AI paused for this chat');
    const ctx = await request(app).get('/api/internal/context').set(service(1)).query({ lead_id: lead.id });
    assert.strictEqual(ctx.body.ai_paused, true, 'n8n sees the pause too');

    const agent = (await sys(() => Users.create({ tenant_id: 1, role: 'agent', email: 'agent@acme.test', name: 'Agent', is_active: true, token_version: 0 }))).toObject();
    const resume = await request(app).post(`/api/leads/${lead.id}/ai`).set('Authorization', `Bearer ${makeToken(agent)}`).send({ paused: false });
    assert.strictEqual(resume.status, 200, JSON.stringify(resume.body));
    const after = await runAsTenant(1, () => Leads.findOne({ id: lead.id }).lean());
    assert.strictEqual(after.ai_paused, false);
    assert.strictEqual(after.needs_human, false);
    assert.strictEqual(after.ai_draft, null);
  });

  await t.test('H2. notify keeps the AI on; a hot-lead alert is raised once per lead', async () => {
    const { lead } = await seed();
    await request(app).post('/api/internal/handover').set(service(1)).send({ lead_id: lead.id, reason: 'LLM down', mode: 'notify' });
    let saved = await runAsTenant(1, () => Leads.findOne({ id: lead.id }).lean());
    assert.strictEqual(saved.needs_human, true);
    assert.notStrictEqual(saved.ai_paused, true);
    const first = await request(app).post('/api/internal/handover').set(service(1)).send({ lead_id: lead.id, reason: 'Hot lead', mode: 'hot' });
    const second = await request(app).post('/api/internal/handover').set(service(1)).send({ lead_id: lead.id, reason: 'Hot lead', mode: 'hot' });
    assert.strictEqual(first.body.notified, true);
    assert.strictEqual(second.body.notified, false);
    assert.strictEqual((await request(app).post('/api/internal/handover').set(service(1)).send({ lead_id: lead.id, mode: 'shout' })).status, 400);
  });

  await t.test('B1. Opted-out customers and paused chats are blocked; the hourly cap blocks extra AI replies', async () => {
    const { lead } = await seed();
    const tenant = await sys(() => Tenants.findOne({ id: 1 }).lean());
    assert.strictEqual(await runAsTenant(1, () => ai.aiBlockReason(tenant, lead)), null);
    assert.strictEqual(await runAsTenant(1, () => ai.aiBlockReason(tenant, { ...lead, opted_out: true })), 'customer opted out');
    process.env.AI_REPLIES_PER_TENANT_HOUR = '2';
    try {
      await thread(1, lead, [['outbound', 'a'], ['outbound', 'b']]);
      assert.strictEqual(await runAsTenant(1, () => ai.aiBlockReason(tenant, lead)), 'hourly AI limit reached');
      assert.strictEqual(await runAsTenant(2, () => ai.aiBlockReason({ ...tenant, id: 2 }, lead)), null, 'the cap is per workspace');
    } finally {
      delete process.env.AI_REPLIES_PER_TENANT_HOUR;
    }
  });

  await t.test('F1. Follow-ups use their own schedule: SalesOS next_followup_due leads are never returned', async () => {
    const { brand } = await seed();
    const past = new Date(Date.now() - DAY);
    await runAsTenant(1, () => Leads.create([
      { name: 'Sales call', phone: '919000000001', client_id: brand.id, status: 'new', next_followup_due: past },
      { name: 'Quiet one', phone: '919000000002', client_id: brand.id, status: 'new', ai_followup_due: past, ai_followup_step: 0 },
    ]));
    const res = await request(app).get('/api/internal/followups/due').set(platform);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(res.body.items.map((i) => i.name), ['Quiet one']);
    assert.strictEqual(res.body.items[0].step, 1);
    assert.strictEqual(res.body.items[0].tenant_id, 1);
  });

  await t.test('F2. A returned lead is leased (not returned twice); paused, opted-out and closed leads are skipped', async () => {
    const { brand } = await seed();
    const past = new Date(Date.now() - DAY);
    await runAsTenant(1, () => Leads.create([
      { name: 'Due', phone: '919000000003', client_id: brand.id, status: 'new', ai_followup_due: past },
      { name: 'Paused', phone: '919000000004', client_id: brand.id, status: 'new', ai_followup_due: past, ai_paused: true },
      { name: 'Opted out', phone: '919000000005', client_id: brand.id, status: 'new', ai_followup_due: past, opted_out: true },
      { name: 'Won', phone: '919000000006', client_id: brand.id, status: 'converted', ai_followup_due: past },
      { name: 'Done', phone: '919000000007', client_id: brand.id, status: 'new', ai_followup_due: past, ai_followup_step: 3 },
    ]));
    const first = await request(app).get('/api/internal/followups/due').set(platform);
    const second = await request(app).get('/api/internal/followups/due').set(platform);
    assert.deepStrictEqual(first.body.items.map((i) => i.name), ['Due']);
    assert.deepStrictEqual(second.body.items, [], 'a leased lead is not returned twice');
  });

  await t.test('F4. Sending hours follow the workspace time zone', () => {
    const tenant = { timezone: 'Asia/Kolkata' };
    delete process.env.AI_SENDING_HOURS;
    try {
      assert.strictEqual(ai.inSendingHours(tenant, new Date(Date.UTC(2026, 9, 21, 6, 30))), true, '12:00 IST');
      assert.strictEqual(ai.inSendingHours(tenant, new Date(Date.UTC(2026, 9, 21, 17, 0))), false, '22:30 IST');
      assert.strictEqual(ai.inSendingHours(tenant, new Date(Date.UTC(2026, 9, 21, 1, 0))), false, '06:30 IST');
    } finally {
      process.env.AI_SENDING_HOURS = '0-24';
    }
  });

  await t.test('F3. Mark schedules the next step (day 5, day 10) and stops after step 3; a new message restarts', async () => {
    const { lead } = await seed();
    const mark = (step) => request(app).post('/api/internal/followups/mark').set(service(1)).send({ lead_id: lead.id, step });
    assert.strictEqual((await mark(1)).status, 200);
    let saved = await runAsTenant(1, () => Leads.findOne({ id: lead.id }).lean());
    assert.strictEqual(saved.ai_followup_step, 1);
    assert.ok(Math.abs(new Date(saved.ai_followup_due) - (Date.now() + 3 * DAY)) < 60000);
    await mark(3);
    saved = await runAsTenant(1, () => Leads.findOne({ id: lead.id }).lean());
    assert.strictEqual(saved.ai_followup_due, null);
    assert.strictEqual((await mark(9)).status, 400);
    await runAsTenant(1, () => ai.recordInbound(lead.id));
    saved = await runAsTenant(1, () => Leads.findOne({ id: lead.id }).lean());
    assert.strictEqual(saved.ai_followup_step, 0);
    assert.ok(Math.abs(new Date(saved.ai_followup_due) - (Date.now() + 2 * DAY)) < 60000);
  });
});
