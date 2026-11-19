/**
 * N7: the overnight "while you slept" summary. Real server.js app, in-memory
 * MongoDB; nothing leaves the test (email delivery is the in-memory outbox).
 */
const test = require('node:test');
const assert = require('node:assert');
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

test('N7: overnight summary', async (t) => {
  const { Users, Tenants, AiReplyLogs, Appointments } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const overnight = require('../services/overnightSummary');
  const notify = require('../services/notify');
  const sys = (fn) => runAsSystem(fn, 'test');
  const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user)}` });
  t.beforeEach(async () => { await clearCollections(); notify.clearOutbox(); });

  async function workspace(tenantId) {
    const owner = (await sys(() => Users.create({ is_active: true, token_version: 0, password_hash: 'x', tenant_id: tenantId, role: 'owner', email: `owner${tenantId}@acme.test`, name: `Owner ${tenantId}` }))).toObject();
    await sys(() => Tenants.create({ id: tenantId, name: `Workspace ${tenantId}`, status: 'active', owner_user_id: owner.id }));
    return owner;
  }
  // 2026-11-19 05:00 IST = 2026-11-18 23:30 UTC; the window is 18 Nov 23:00 IST to 19 Nov 08:00 IST.
  const NOW = new Date('2026-11-19T03:00:00Z'); // 08:30 IST
  const at = (iso) => new Date(iso);
  async function night(tenantId) {
    await runAsTenant(tenantId, async () => {
      const row = (message_id, conversation_id, created_at, extra = {}) => AiReplyLogs.create({ lead_id: 1, conversation_id, message_id, status: 'sent', created_at, ...extra });
      await row(1, 10, at('2026-11-18T18:00:00Z')); // 23:30 IST, in
      await row(2, 10, at('2026-11-18T20:00:00Z')); // same chat, in
      await row(3, 11, at('2026-11-19T01:00:00Z'), { handoff: true }); // 06:30 IST, in, handed over
      await row(4, 12, at('2026-11-18T10:00:00Z')); // 15:30 IST yesterday, out
      await row(5, 13, at('2026-11-19T03:00:00Z')); // 08:30 IST, out
      await Appointments.create({ lead_id: 1, customer_name: 'Ravi', start_at: at('2026-11-20T05:00:00Z'), end_at: at('2026-11-20T05:30:00Z'), slot_key: 'a#1', created_at: at('2026-11-19T00:00:00Z'), source: 'ai_brain' });
      await Appointments.create({ lead_id: 2, customer_name: 'Mala', start_at: at('2026-11-20T06:00:00Z'), end_at: at('2026-11-20T06:30:00Z'), slot_key: 'a#2', created_at: at('2026-11-19T00:10:00Z'), source: 'ai_brain', status: 'cancelled' });
    });
  }

  await t.test('W1. The window is 23:00 to 08:00 India time and moves to the right morning', () => {
    const w = overnight.lastWindow(NOW);
    assert.strictEqual(w.end.toISOString(), '2026-11-19T02:30:00.000Z');
    assert.strictEqual(w.start.toISOString(), '2026-11-18T17:30:00.000Z');
    const early = overnight.lastWindow(new Date('2026-11-19T00:30:00Z')); // 06:00 IST: last night is the previous morning's window
    assert.strictEqual(early.end.toISOString(), '2026-11-18T02:30:00.000Z');
  });

  await t.test('S1. Counts come from our records, only inside the window, per workspace', async () => {
    await workspace(1); await workspace(2);
    await night(1);
    const s = await runAsTenant(1, () => overnight.buildSummary(overnight.lastWindow(NOW)));
    assert.strictEqual(s.chats_answered, 2);
    assert.strictEqual(s.replies_sent, 3);
    assert.strictEqual(s.handed_to_team, 1);
    assert.strictEqual(s.appointments_booked, 1, 'a cancelled appointment is not counted');
    const other = await runAsTenant(2, () => overnight.buildSummary(overnight.lastWindow(NOW)));
    assert.strictEqual(other.chats_answered, 0, 'another workspace sees nothing');
  });

  await t.test('E1. The morning run emails owners with activity only, and respects the switch', async () => {
    await workspace(1); await workspace(2); const owner3 = await workspace(3);
    await night(1); await night(3);
    await sys(() => Tenants.updateOne({ id: 3 }, { $set: { overnight_summary_enabled: false } }));
    const result = await overnight.runMorningSummaries(NOW);
    assert.deepStrictEqual(result, { sent: 1, quiet: 1, off: 1, no_owner: 0, failed: 0 });
    const mail = notify.outbox();
    assert.strictEqual(mail.length, 1);
    assert.strictEqual(mail[0].to, 'owner1@acme.test');
    assert.match(JSON.stringify(mail[0]), /answered 2 chats/);
    assert.ok(owner3);
  });

  await t.test('R1. The API shows last night to the workspace and lets the owner switch the email off', async () => {
    const owner = await workspace(1);
    const res = await request(app).get('/api/summary/overnight').set(bearer(owner));
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.email_enabled, true);
    assert.strictEqual(typeof res.body.chats_answered, 'number');
    assert.strictEqual((await request(app).put('/api/summary/overnight').set(bearer(owner)).send({ email_enabled: 'no' })).status, 400);
    const off = await request(app).put('/api/summary/overnight').set(bearer(owner)).send({ email_enabled: false });
    assert.strictEqual(off.status, 200);
    assert.strictEqual((await request(app).get('/api/summary/overnight').set(bearer(owner))).body.email_enabled, false);
    assert.strictEqual((await request(app).get('/api/summary/overnight')).status, 401);
  });
});
