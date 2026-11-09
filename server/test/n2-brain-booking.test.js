/**
 * N2 end to end: greeting, FAQ answers and appointment booking through the
 * AI Brain reply route. In-memory MongoDB; the LLM and Meta are replaced, so
 * nothing leaves the test. (Needs the MongoMemoryServer binary, like the other
 * route tests.)
 */
const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken, TEST_INTERNAL_KEY } = require('./setup');

let app;

const PROFILE = {
  business_name: 'Sunrise Dental',
  business_description: 'Family dental clinic in Chennai',
  service_area: 'Anna Nagar',
  business_hours: { days: [0, 1, 2, 3, 4, 5, 6], open: '09:00', close: '18:00' },
  timezone: 'Asia/Kolkata',
  products_and_services: ['Cleaning - from Rs 500', 'Braces'],
  qualifying_questions: ['Treatment needed?', 'Preferred day?'],
  conversation_goal: 'book_appointment',
  tone: 'Warm',
  languages: ['English', 'Tamil'],
  pricing_policy: 'share_listed',
  after_hours_message: 'We are closed and will reply at 9 AM',
  handoff_contacts: 'Front desk',
  industry: 'clinic',
  booking_mode: 'appointments',
  appointment_minutes: 30,
  appointment_capacity: 1,
  reminder_hours: 24,
};

// 11:00 in Kolkata, three days from now: always inside hours and in the future.
function localSlot(daysAhead = 3, time = '11:00') {
  const d = new Date(Date.now() + daysAhead * 24 * 3600 * 1000);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
  return `${day}T${time}`;
}

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

test('N2 booking through the AI Brain', async (t) => {
  const axios = require('axios');
  const openRouter = require('../services/openrouter');
  const { Appointments, AiReplyLogs, BrainProfiles, CampaignMessageQueue, Tenants, Clients, Leads, Conversations, Messages, Users } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const sys = (fn) => runAsSystem(fn, 'test');
  const service = (tenantId) => ({ 'x-internal-key': TEST_INTERNAL_KEY, 'x-tenant-id': String(tenantId) });
  const realPost = axios.post;
  const realGenerate = openRouter.models.generateContent;
  let sends;
  let prompts;

  const llmReturns = (output, usage = { prompt_tokens: 1000, completion_tokens: 100 }) => {
    openRouter.models.generateContent = async ({ contents, config }) => {
      prompts.push({ user: contents, system: config.system });
      return { text: JSON.stringify({ handoff: false, handoff_reason: null, lead_updates: {}, opt_out: false, ...output }), usage };
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

  async function owner(tenantId) {
    const user = (await sys(() => Users.create({ tenant_id: tenantId, role: 'owner', email: `o${tenantId}@t.test`, name: 'Owner', is_active: true, token_version: 0 }))).toObject();
    return { Authorization: `Bearer ${makeToken(user)}` };
  }

  async function seed(tenantId = 1, { profile = PROFILE } = {}) {
    await sys(() => Tenants.create({ id: tenantId, name: `T${tenantId}`, status: 'active', timezone: 'Asia/Kolkata' }));
    return runAsTenant(tenantId, async () => {
      const brand = (await Clients.create({ name: `Brand ${tenantId}`, phone_number_id: `PN${tenantId}`, wa_access_token: 'test-dummy-token' })).toObject();
      await BrainProfiles.create({ profile, ai_enabled: true, brain_version: 1, version_type: 'client' });
      const lead = (await Leads.create({ name: 'Ravi', phone: `91987654321${tenantId}`, client_id: brand.id, status: 'new', last_inbound_at: new Date() })).toObject();
      const conversation = await Conversations.create({ lead_id: lead.id, phone: `987654321${tenantId}`, status: 'open' });
      return { brand, lead, conversation };
    });
  }

  // One customer message answered by the (mocked) model.
  async function say(tenantId, { lead, conversation }, text, output) {
    llmReturns({ reply: 'model reply', ...output });
    const message = await runAsTenant(tenantId, async () => (await Messages.create({
      conversation_id: conversation.id, direction: 'inbound', content: text, msg_type: 'text', sent_at: new Date(),
    })).toObject());
    const res = await request(app).post('/api/internal/ai/reply').set(service(tenantId)).send({ lead_id: lead.id, message_id: message.id });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    return { res, text: sends[sends.length - 1]?.body?.text?.body };
  }
  const appointmentsOf = (tenantId) => runAsTenant(tenantId, () => Appointments.find({}).lean());

  await t.test('Greeting, FAQ answer, then the full booking: name, service, time, confirm, reminder queued, cost logged', async () => {
    const chat = await seed(1);
    const slot = localSlot();

    const greeting = await say(1, chat, 'Hello', { reply: 'Welcome to Sunrise Dental! How can I help?', answered_from: 'greeting' });
    assert.match(greeting.text, /Welcome to Sunrise Dental/);
    assert.match(prompts[0].user, /First message from this customer: yes/);

    assert.match((await say(1, chat, 'I want to book', { appointment: {} })).text, /your name/i);
    assert.match((await say(1, chat, 'Ravi', { appointment: { name: 'Ravi' } })).text, /Which service/);
    assert.match((await say(1, chat, 'cleaning', { appointment: { service: 'Cleaning' } })).text, /What date and time/);
    assert.match((await say(1, chat, 'tomorrow 11', { appointment: { start: slot } })).text, /Please confirm: Cleaning for Ravi/);
    assert.deepStrictEqual(await appointmentsOf(1), [], 'nothing is booked before the customer confirms');

    const done = await say(1, chat, 'yes', { appointment: { confirm: true } });
    assert.match(done.text, /Your Cleaning appointment is confirmed/);
    const rows = await appointmentsOf(1);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].tenant_id, 1);
    assert.strictEqual(rows[0].customer_name, 'Ravi');
    assert.strictEqual(rows[0].status, 'confirmed');
    assert.strictEqual(rows[0].reminder_status, 'queued');

    // The reminder is a row in the N1 send queue, not a direct send.
    const queued = await runAsTenant(1, () => CampaignMessageQueue.find({ source: 'appointment_reminder' }).lean());
    assert.strictEqual(queued.length, 1);
    assert.strictEqual(queued[0].id, rows[0].reminder_queue_id);
    assert.strictEqual(queued[0].status, 'pending');
    assert.strictEqual(queued[0].tenant_id, 1);
    assert.strictEqual(queued[0].payload.template.name, 'appointment_reminder');
    assert.deepStrictEqual(queued[0].payload.template.components[0].parameters.map((p) => p.text).slice(0, 2), ['Ravi', 'Cleaning']);
    assert.ok(new Date(queued[0].next_attempt_at) > new Date());
    assert.ok(['marketing', 'utility'].includes(queued[0].kind));

    // Every reply is logged with tokens and cost.
    const logs = await runAsTenant(1, () => AiReplyLogs.find({}).sort({ id: 1 }).lean());
    assert.strictEqual(logs.length, 6);
    for (const log of logs) {
      assert.strictEqual(log.prompt_tokens, 1000);
      assert.strictEqual(log.completion_tokens, 100);
      assert.strictEqual(log.total_tokens, 1100);
      assert.strictEqual(typeof log.cost_usd, 'number');
      assert.ok(log.cost_usd > 0);
      assert.strictEqual(log.language, 'en');
      assert.ok(log.model);
    }
    assert.strictEqual(logs[5].appointment_id, rows[0].id);
    assert.strictEqual(logs[5].answered_from, 'booking');

    // Cost per reply for the workspace.
    const usage = await request(app).get('/api/brain/usage').set(await owner(1));
    assert.strictEqual(usage.status, 200, JSON.stringify(usage.body));
    assert.strictEqual(usage.body.sent_replies, 6);
    assert.strictEqual(usage.body.prompt_tokens, 6000);
    assert.ok(usage.body.cost_per_sent_reply_usd > 0);
  });

  await t.test('A customer writing in Tamil gets Tamil questions and a Tamil confirmation', async () => {
    const chat = await seed(1);
    const slot = localSlot(4);
    assert.match((await say(1, chat, 'முன்பதிவு செய்ய வேண்டும்', { appointment: {} })).text, /பெயரை/);
    await say(1, chat, 'ரவி', { appointment: { name: 'ரவி' } });
    await say(1, chat, 'Cleaning', { appointment: { service: 'Cleaning' } });
    const ask = await say(1, chat, 'நாளை 11 மணி', { appointment: { start: slot } });
    assert.match(ask.text, /உறுதிப்படுத்துங்கள்/);
    assert.match((await say(1, chat, 'ஆம்', { appointment: { confirm: true } })).text, /உறுதி செய்யப்பட்டது/);
    const [row] = await appointmentsOf(1);
    assert.strictEqual(row.language, 'ta');
    const queued = await runAsTenant(1, () => CampaignMessageQueue.findOne({ source: 'appointment_reminder' }).lean());
    assert.strictEqual(queued.payload.template.name, 'appointment_reminder_ta');
    assert.strictEqual(queued.payload.template.language.code, 'ta');
    assert.strictEqual((await runAsTenant(1, () => AiReplyLogs.findOne({}).lean())).language, 'ta');
  });

  await t.test('A taken time is refused, and cancelling frees it and stops the reminder', async () => {
    const a = await seed(1);
    const slot = localSlot();
    await say(1, a, 'book', { appointment: { name: 'Ravi', service: 'Braces', start: slot } });
    await say(1, a, 'yes', { appointment: { confirm: true } });
    assert.strictEqual((await appointmentsOf(1)).length, 1);

    // A second customer in the same workspace asks for the same time.
    const other = await runAsTenant(1, async () => {
      const lead = (await Leads.create({ name: 'Meena', phone: '919000011111', client_id: a.brand.id, status: 'new', last_inbound_at: new Date() })).toObject();
      return { lead, conversation: await Conversations.create({ lead_id: lead.id, phone: '9000011111', status: 'open' }) };
    });
    const refused = await say(1, other, 'book', { appointment: { name: 'Meena', service: 'Braces', start: slot } });
    assert.match(refused.text, /not available/);
    await say(1, other, 'yes', { appointment: { confirm: true } });
    assert.strictEqual((await appointmentsOf(1)).length, 1, 'still one booking for that time');

    const cancelled = await say(1, a, 'cancel it', { appointment: { cancel: true } });
    assert.match(cancelled.text, /has been cancelled/);
    const [row] = await appointmentsOf(1);
    assert.strictEqual(row.status, 'cancelled');
    assert.strictEqual(row.slot_key, null);
    const queued = await runAsTenant(1, () => CampaignMessageQueue.findOne({ id: row.reminder_queue_id }).lean());
    assert.strictEqual(queued.status, 'cancelled');
  });

  await t.test('Isolation: another workspace has its own calendar and never sees these appointments', async () => {
    const one = await seed(1);
    const two = await seed(2);
    const slot = localSlot();
    await say(1, one, 'book', { appointment: { name: 'Ravi', service: 'Braces', start: slot } });
    await say(1, one, 'yes', { appointment: { confirm: true } });
    // The same time is free in workspace 2.
    await say(2, two, 'book', { appointment: { name: 'Kumar', service: 'Braces', start: slot } });
    const booked = await say(2, two, 'yes', { appointment: { confirm: true } });
    assert.match(booked.text, /confirmed/);
    assert.deepStrictEqual((await appointmentsOf(1)).map((r) => r.customer_name), ['Ravi']);
    assert.deepStrictEqual((await appointmentsOf(2)).map((r) => r.customer_name), ['Kumar']);
    assert.ok((await appointmentsOf(1)).every((r) => r.tenant_id === 1));
    // Costs are per workspace too.
    const usage = await request(app).get('/api/brain/usage').set(await owner(2));
    assert.strictEqual(usage.body.sent_replies, 2);
  });

  await t.test('Unsure: an answer from outside the business facts becomes a holding reply and a handoff, in Tamil for Tamil', async () => {
    const chat = await seed(1);
    const english = await say(1, chat, 'Is chocolate bad for teeth?', { reply: 'Yes, sugar causes cavities.', answered_from: 'general_knowledge' });
    assert.match(english.text, /check this with the team/);
    assert.doesNotMatch(english.text, /sugar/);
    const tamil = await say(1, chat, 'சாக்லேட் பற்களுக்கு கெடுதலா?', { reply: 'Yes.', answered_from: 'general_knowledge' });
    assert.match(tamil.text, /குழுவிடம்/);
    const lead = await runAsTenant(1, () => Leads.findOne({ id: chat.lead.id }).lean());
    assert.strictEqual(lead.needs_human, true);
  });

  await t.test('N3 gate and N1 policy still apply: opted-out customers and paused chats get no booking', async () => {
    const chat = await seed(1);
    await runAsTenant(1, () => Leads.updateOne({ id: chat.lead.id }, { $set: { ai_paused: true } }));
    llmReturns({ reply: 'x', appointment: { name: 'Ravi', service: 'Braces', start: localSlot() } });
    const message = await runAsTenant(1, async () => (await Messages.create({ conversation_id: chat.conversation.id, direction: 'inbound', content: 'book', msg_type: 'text', sent_at: new Date() })).toObject());
    const res = await request(app).post('/api/internal/ai/reply').set(service(1)).send({ lead_id: chat.lead.id, message_id: message.id });
    assert.strictEqual(res.body.sent, false);
    assert.strictEqual(prompts.length, 0, 'the model is not even called');
    assert.strictEqual(sends.length, 0);
    assert.deepStrictEqual(await appointmentsOf(1), []);
  });
});
