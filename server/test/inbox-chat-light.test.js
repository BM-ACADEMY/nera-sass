/**
 * Customer WhatsApp Chat: the light requests the inbox makes when a chat opens.
 * - GET /api/leads/:id?messages=0 leaves out the whole thread (the inbox pages
 *   it through /messages) and adds last_inbound_at + workspace_ai_enabled.
 * - PUT /api/conversations/:id/read also clears the lead's Sales Task badge.
 * Every answer stays inside the caller's workspace.
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

test.after(async () => {
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearCollections();
});

test('Customer inbox: light chat requests', async (t) => {
  const { Users, Tenants, Clients, Leads, Conversations, Messages, SalesTasks } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');

  async function workspace(tenantId, { aiEnabled, messages = 30 } = {}) {
    await runAsSystem(() => Tenants.create({ id: tenantId, name: `Shop ${tenantId}`, status: 'active', ...(aiEnabled === undefined ? {} : { ai_enabled: aiEnabled }) }), 'test');
    const owner = (await runAsSystem(() => Users.create({
      tenant_id: tenantId, role: 'owner', email: `owner${tenantId}@shop.test`, name: 'Owner', password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
    }), 'test')).toObject();
    const seeded = await runAsTenant(tenantId, async () => {
      const brand = await Clients.create({ name: `Brand ${tenantId}` });
      const lead = await Leads.create({ name: 'Ravi', phone: `9198765432${tenantId}`, client_id: brand.id, status: 'new' });
      const conversation = await Conversations.create({ lead_id: lead.id, phone: `98765432${tenantId}`, status: 'open', unread_count: 3 });
      const start = Date.now() - 2 * 60 * 60 * 1000;
      for (let i = 0; i < messages; i++) {
        await Messages.create({
          conversation_id: conversation.id,
          direction: i % 2 ? 'outbound' : 'inbound',
          content: `message ${i} ${'x'.repeat(200)}`,
          sent_at: new Date(start + i * 60000),
        });
      }
      await SalesTasks.create({ lead_id: lead.id, task_type: 'handover', unread: true });
      return { lead, conversation, lastInbound: new Date(start + (messages % 2 ? messages - 1 : messages - 2) * 60000) };
    });
    return { ...seeded, headers: { Authorization: `Bearer ${makeToken(owner)}` } };
  }

  await t.test('L1. ?messages=0 leaves out the thread and adds the reply window and the workspace AI flag', async () => {
    const { lead, headers, lastInbound } = await workspace(1, { messages: 30 });

    const full = await request(app).get(`/api/leads/${lead.id}`).set(headers);
    assert.strictEqual(full.status, 200);
    assert.strictEqual(full.body.conversations.length, 30, 'the default answer is unchanged');

    const light = await request(app).get(`/api/leads/${lead.id}`).query({ messages: '0' }).set(headers);
    assert.strictEqual(light.status, 200, JSON.stringify(light.body));
    assert.strictEqual(light.body.conversations, undefined);
    assert.strictEqual(light.body.lead.id, lead.id);
    assert.strictEqual(light.body.lead.name, 'Ravi');
    assert.strictEqual(new Date(light.body.lead.last_inbound_at).getTime(), lastInbound.getTime());
    assert.strictEqual(light.body.workspace_ai_enabled, true, 'AI counts as on unless the workspace turned it off');
    assert.ok(light.text.length * 5 < full.text.length, `light ${light.text.length} B vs full ${full.text.length} B`);
  });

  await t.test('L2. A workspace with AI turned off reports workspace_ai_enabled: false', async () => {
    const { lead, headers } = await workspace(2, { aiEnabled: false, messages: 2 });
    const res = await request(app).get(`/api/leads/${lead.id}`).query({ messages: '0' }).set(headers);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.workspace_ai_enabled, false);
  });

  await t.test('L3. Another workspace\'s lead stays hidden, and its AI flag is never read', async () => {
    const a = await workspace(3, { aiEnabled: false, messages: 2 });
    const b = await workspace(4, { messages: 2 });
    const res = await request(app).get(`/api/leads/${a.lead.id}`).query({ messages: '0' }).set(b.headers);
    assert.strictEqual(res.status, 404);
    const own = await request(app).get(`/api/leads/${b.lead.id}`).query({ messages: '0' }).set(b.headers);
    assert.strictEqual(own.body.workspace_ai_enabled, true);
  });

  await t.test('L4. Marking a chat read also clears its Sales Task badge, only in the caller\'s workspace', async () => {
    const a = await workspace(5, { messages: 2 });
    const b = await workspace(6, { messages: 2 });

    const res = await request(app).put(`/api/conversations/${a.lead.id}/read`).set(a.headers);
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await runAsTenant(5, () => Conversations.findOne({ id: a.conversation.id }).lean())).unread_count, 0);
    assert.strictEqual(await runAsTenant(5, () => SalesTasks.countDocuments({ unread: true })), 0);

    // Workspace 6 reads a lead id of workspace 5: nothing of workspace 5 changes.
    const unreadBefore = await runAsTenant(6, () => SalesTasks.countDocuments({ unread: true }));
    await request(app).put(`/api/conversations/${a.lead.id}/read`).set(b.headers);
    assert.strictEqual(await runAsTenant(6, () => SalesTasks.countDocuments({ unread: true })), unreadBefore);
    assert.strictEqual((await runAsTenant(6, () => Conversations.findOne({ id: b.conversation.id }).lean())).unread_count, 3);
  });
});
