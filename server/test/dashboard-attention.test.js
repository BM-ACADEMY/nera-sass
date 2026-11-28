/**
 * Dashboard routes (routes/leados/dashboard.js):
 *   GET /api/dashboard/attention  unanswered chats, hot leads with no reply,
 *                                 waiting AI handovers, overdue sales tasks;
 *                                 agents see their own + unassigned work and
 *                                 get "My day".
 *   GET /api/dashboard/overview   converted leads and lead sources in range.
 * Counts on seeded data, staff scoping, tenant isolation and who may call.
 * Real server.js app, in-memory MongoDB.
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const supertest = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

const request = (target) => new Proxy(supertest(target), {
  get: (agent, method) => (...args) => agent[method](...args).timeout({ deadline: 60000 }),
});

let app;
let models;
let runAsSystem;
let runAsTenant;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  delete process.env.N8N_NEW_LEAD_WEBHOOK_URL;
  await startTestDb();
  models = require('../models');
  ({ runAsSystem, runAsTenant } = require('../services/tenantContext'));
  ({ app } = require('../server'));
});
test.after(async () => { await stopTestDb(); });
test.beforeEach(async () => { await clearCollections(); });

const sys = (fn) => runAsSystem(fn, 'test');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const ago = (ms) => new Date(Date.now() - ms);
const istDay = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

async function makeUsers(tenantId, roles) {
  const out = {};
  for (const role of roles) {
    const dbRole = role.replace(/\d+$/, '');
    out[role] = (await sys(() => models.Users.create({
      tenant_id: tenantId, ...(['agent', 'manager'].includes(dbRole) ? { role: 'staff', sections: ['dashboard', 'leads', 'inbox', 'sales_tasks'] } : { role: dbRole }), email: `${role}${tenantId}@shop.test`, name: `${role} ${tenantId}`,
      password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
    }))).toObject();
  }
  const headers = Object.fromEntries(Object.entries(out).map(([role, user]) => [role, { Authorization: `Bearer ${makeToken(user)}` }]));
  return { users: out, headers };
}

// A lead with one chat; `messages` is [[direction, sentAt], ...].
async function leadWithChat(fields, messages = []) {
  const lead = (await models.Leads.create({ name: fields.name, phone: fields.phone, status: 'new', source: 'Manual', ...fields })).toObject();
  if (messages.length) {
    const conv = (await models.Conversations.create({ lead_id: lead.id, phone: lead.phone, last_message_at: messages[messages.length - 1][1] })).toObject();
    for (const [direction, at] of messages) {
      await models.Messages.create({ conversation_id: conv.id, direction, content: `${direction} ${lead.name}`, sent_at: at });
    }
  }
  return lead;
}

const sent = (tenantId, actor, leadId, at, event = 'MESSAGE_SENT') => sys(() => models.AuditEvents.create({
  tenant_id: tenantId, event, actor_type: 'user', actor_user_id: actor.id, actor_name: actor.name,
  target_type: 'lead', target_id: String(leadId), created_at: at,
}));

async function seedMain() {
  await sys(() => models.Tenants.create({ id: 1, name: 'Shop 1', status: 'active' }));
  const { users, headers } = await makeUsers(1, ['owner', 'admin', 'manager', 'agent', 'agent2']);
  const agent = users.agent.id;
  const agent2 = users.agent2.id;
  const seeded = await runAsTenant(1, async () => {
    const L = {};
    let n = 0;
    const lead = (fields, messages) => leadWithChat({ name: `L${++n}`, phone: `91980000${String(n).padStart(4, '0')}`, ...fields }, messages);
    // Unanswered chats
    L.mine = await lead({ assigned_to: agent, source: 'WhatsApp' }, [['inbound', ago(30 * MIN)]]);
    L.unassigned = await lead({ source: 'Campaign upload' }, [['outbound', ago(3 * HOUR)], ['inbound', ago(20 * MIN)]]);
    L.other = await lead({ assigned_to: agent2, source: 'XLS Sheet' }, [['inbound', ago(70 * MIN)], ['inbound', ago(60 * MIN)]]);
    L.tooNew = await lead({ source: 'WhatsApp', ad_id: 'ad-1' }, [['inbound', ago(5 * MIN)]]);
    L.windowClosed = await lead({ source: 'lead_form', leadgen_id: 'g-1' }, [['inbound', ago(30 * HOUR)]]);
    L.answered = await lead({}, [['inbound', ago(40 * MIN)], ['outbound', ago(35 * MIN)]]);
    L.deletedReply = await lead({}, [['inbound', ago(50 * MIN)]]);
    // Hot leads
    L.hotWaiting = await lead({ status: 'hot' }, [['inbound', ago(3 * MIN)]]);
    L.hotReplied = await lead({ status: 'hot', assigned_to: agent2 }, [['inbound', ago(2 * HOUR)], ['outbound', ago(HOUR)]]);
    L.hotOld = await lead({ status: 'hot', assigned_to: agent2 }, [['outbound', ago(72 * HOUR)], ['inbound', ago(48 * HOUR)]]);
    L.hotSilent = await lead({ status: 'hot' }, []);
    // AI handovers
    L.handover = await lead({ needs_human: true, handover_at: ago(HOUR), assigned_to: agent }, []);
    L.handled = await lead({ needs_human: true, handover_at: ago(2 * HOUR) }, []);
    L.handoverClosed = await lead({ needs_human: true, handover_at: ago(HOUR), status: 'converted' }, []);
    L.handoverOther = await lead({ needs_human: true, handover_at: ago(HOUR), assigned_to: agent2 }, []);
    // Follow-up lead for an automatic task, and one whose task is hidden
    L.followup = await lead({ assigned_to: agent, next_followup_due: ago(2 * HOUR) }, []);
    L.followupDone = await lead({ status: 'converted', next_followup_due: ago(2 * HOUR) }, []);
    // Old lead (outside 30 days) and an older conversion
    L.old = await lead({ created_at: ago(100 * 24 * HOUR), status: 'converted', updated_at: ago(40 * 24 * HOUR) }, []);

    // A deleted outbound message does not answer a chat.
    const conv = await models.Conversations.findOne({ lead_id: L.deletedReply.id }).lean();
    await models.Messages.create({ conversation_id: conv.id, direction: 'outbound', content: 'oops', sent_at: ago(45 * MIN), is_deleted: true });

    const task = (fields) => models.SalesTasks.create({ task_type: 'manual', title: 'Task', ...fields });
    const T = {
      mine: await task({ due_at: ago(HOUR), assigned_to: agent }),
      unassigned: await task({ due_at: ago(HOUR) }),
      other: await task({ due_at: ago(HOUR), assigned_to: agent2 }),
      completed: await task({ due_at: ago(HOUR), assigned_to: agent, status: 'completed' }),
      deleted: await task({ due_at: ago(HOUR), assigned_to: agent, deleted_at: new Date() }),
      future: await task({ due_at: new Date(Date.now() + 3 * 24 * HOUR), assigned_to: agent }),
      soon: await task({ due_at: new Date(Date.now() + MIN), assigned_to: agent }),
      followup: await models.SalesTasks.create({ lead_id: L.followup.id, task_type: 'followup' }),
      followupDone: await models.SalesTasks.create({ lead_id: L.followupDone.id, task_type: 'followup' }),
    };
    return { L, T };
  });
  // Activity log: someone replied after one handover; another only before it.
  await sent(1, users.owner, seeded.L.handled.id, ago(HOUR));
  await sent(1, users.agent2, seeded.L.handoverOther.id, ago(3 * HOUR));
  // The agent's sends today and an older one.
  await sent(1, users.agent, seeded.L.mine.id, new Date());
  await sent(1, users.agent, seeded.L.mine.id, new Date(), 'TEMPLATE_SENT');
  await sent(1, users.agent, seeded.L.mine.id, ago(3 * 24 * HOUR));
  return { users, headers, ...seeded };
}

const attention = (headers) => request(app).get('/api/dashboard/attention').set(headers);

test('Dashboard attention: counts for the whole workspace', async () => {
  const s = await seedMain();
  for (const role of ['owner', 'admin']) {
    const res = await attention(s.headers[role]);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.scope, 'all', role);
    // mine, unassigned, other and deletedReply (a deleted reply does not count)
    assert.strictEqual(res.body.unanswered.count, 4, role);
    assert.strictEqual(res.body.unanswered.after_minutes, 15);
    assert.strictEqual(res.body.unanswered.oldest_lead_id, s.L.other.id, 'oldest wait is the chat waiting 60 min');
    assert.ok(Math.abs(new Date(res.body.unanswered.oldest_at) - ago(60 * MIN)) < 5 * MIN);
    assert.strictEqual(res.body.hot_no_reply.count, 2, 'hotWaiting and hotOld');
    assert.strictEqual(res.body.handovers.count, 2, 'handover and handoverOther');
    assert.ok([s.L.handover.id, s.L.handoverOther.id].includes(res.body.handovers.oldest_lead_id));
    assert.strictEqual(res.body.overdue_tasks.count, 4, 'mine, unassigned, other and the automatic follow-up');
    assert.strictEqual(res.body.my_day, undefined, 'My day is for agents');
  }
});

test('Dashboard attention: an agent sees their own and unassigned work, and My day', async () => {
  const s = await seedMain();
  const res = await attention(s.headers.agent);
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.scope, 'mine');
  assert.strictEqual(res.body.unanswered.count, 3, 'mine, unassigned, deletedReply - not agent2\'s');
  assert.strictEqual(res.body.unanswered.oldest_lead_id, s.L.deletedReply.id);
  assert.strictEqual(res.body.hot_no_reply.count, 1, 'hotWaiting only');
  assert.strictEqual(res.body.handovers.count, 1);
  assert.strictEqual(res.body.handovers.oldest_lead_id, s.L.handover.id);
  assert.strictEqual(res.body.overdue_tasks.count, 3, 'mine, unassigned, follow-up');

  // Open leads assigned to the agent: mine, handover, followup.
  assert.strictEqual(res.body.my_day.open_leads, 3);
  assert.strictEqual(res.body.my_day.replies_today, 2);
  const today = istDay(new Date());
  const expectedDue = [ago(HOUR), ago(2 * HOUR), new Date(Date.now() + MIN)].filter((d) => istDay(d) === today).length;
  assert.strictEqual(res.body.my_day.tasks_due_today, expectedDue);

  const other = await attention(s.headers.agent2);
  assert.strictEqual(other.body.unanswered.count, 3, 'unassigned, other, deletedReply');
  assert.strictEqual(other.body.hot_no_reply.count, 2, 'hotWaiting (unassigned) and hotOld');
  assert.strictEqual(other.body.handovers.count, 1, 'handoverOther');
  assert.strictEqual(other.body.overdue_tasks.count, 2, 'unassigned and other');
  assert.strictEqual(other.body.my_day.replies_today, istDay(ago(3 * HOUR)) === today ? 1 : 0, 'its send before the handover, if that was today');
});

test('Dashboard attention: another workspace never counts', async () => {
  const s = await seedMain();
  await sys(() => models.Tenants.create({ id: 2, name: 'Shop 2', status: 'active' }));
  const b = await makeUsers(2, ['owner', 'agent']);
  await runAsTenant(2, async () => {
    await leadWithChat({ name: 'B1', phone: '919811111111', status: 'hot' }, [['inbound', ago(30 * MIN)]]);
    await leadWithChat({ name: 'B2', phone: '919811111112', needs_human: true, handover_at: ago(HOUR) }, []);
    await models.SalesTasks.create({ task_type: 'manual', title: 'B task', due_at: ago(HOUR) });
  });
  // Workspace B's owner sent to a workspace A lead id: must not mark A's handover handled.
  await sent(2, b.users.owner, s.L.handover.id, new Date());

  const resB = await attention(b.headers.owner);
  assert.strictEqual(resB.status, 200);
  assert.strictEqual(resB.body.unanswered.count, 1);
  assert.strictEqual(resB.body.hot_no_reply.count, 1);
  assert.strictEqual(resB.body.handovers.count, 1);
  assert.strictEqual(resB.body.overdue_tasks.count, 1);
  const agentB = await attention(b.headers.agent);
  assert.strictEqual(agentB.body.my_day.replies_today, 0);

  const resA = await attention(s.headers.owner);
  assert.strictEqual(resA.body.unanswered.count, 4);
  assert.strictEqual(resA.body.hot_no_reply.count, 2);
  assert.strictEqual(resA.body.handovers.count, 2);
  assert.strictEqual(resA.body.overdue_tasks.count, 4);
});

test('Dashboard routes: sign-in required, customer workspaces only', async () => {
  await seedMain();
  const staff = (await sys(() => models.Users.create({
    tenant_id: null, is_platform_staff: true, staff_role: 'founder', email: 'founder@nera.test', name: 'Founder',
    password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
  }))).toObject();
  for (const path of ['/api/dashboard/attention', '/api/dashboard/overview']) {
    assert.strictEqual((await request(app).get(path)).status, 401, path);
    assert.strictEqual((await request(app).get(path).set({ 'x-internal-key': process.env.INTERNAL_API_KEY, 'x-tenant-id': '1' })).status, 401, `${path} service key`);
    assert.strictEqual((await request(app).get(path).set({ Authorization: `Bearer ${makeToken(staff)}` })).status, 403, `${path} platform staff`);
  }
});

test('Dashboard overview: converted and lead sources in range, per brand', async () => {
  const s = await seedMain();
  const res = await request(app).get('/api/dashboard/overview?range=30d').set(s.headers.owner);
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.range, '30d');
  assert.strictEqual(res.body.converted, 2, 'handoverClosed and followupDone; not the lead converted 40 days ago');
  const kinds = Object.fromEntries(res.body.sources.map((r) => [r.kind, r.count]));
  assert.deepStrictEqual(kinds, { manual: 12, whatsapp: 1, campaign: 1, import: 1, whatsapp_ad: 1, facebook: 1 });
  assert.strictEqual(res.body.total_leads, 17, 'the 100-day-old lead is outside 30 days');
  assert.strictEqual(res.body.sources[0].kind, 'manual', 'largest first');

  const ninety = await request(app).get('/api/dashboard/overview?range=90d').set(s.headers.agent);
  assert.strictEqual(ninety.body.converted, 3);
  const bogus = await request(app).get('/api/dashboard/overview?range=$where').set(s.headers.owner);
  assert.strictEqual(bogus.body.range, '30d');

  const brand = await runAsTenant(1, async () => {
    const client = (await models.Clients.create({ name: 'Brand A' })).toObject();
    await models.Leads.updateOne({ id: s.L.mine.id }, { $set: { client_id: client.id } });
    return client;
  });
  const perBrand = await request(app).get(`/api/dashboard/overview?range=30d&client_id=${brand.id}`).set(s.headers.owner);
  assert.deepStrictEqual(perBrand.body.sources, [{ kind: 'whatsapp', count: 1 }]);
  assert.strictEqual(perBrand.body.converted, 0);
});
