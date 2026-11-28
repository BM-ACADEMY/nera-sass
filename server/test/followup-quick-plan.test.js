/**
 * Per-workspace 'quick' AI follow-up plan (tenant.ai_followup_plan) next to the
 * unchanged default 2/3/5-day plan. In-memory MongoDB; no n8n, LLM or Meta call.
 */
const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, TEST_INTERNAL_KEY } = require('./setup');

let app;
const HOUR = 3600000;
const DAY = 24 * HOUR;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  process.env.AI_SENDING_HOURS = '0-24';
  await startTestDb();
  ({ app } = require('../server'));
});
test.after(async () => { await stopTestDb(); });
test.beforeEach(async () => { await clearCollections(); });

test('quick follow-up plan', async (t) => {
  const { Tenants, Leads, Users } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const ai = require('../services/aiAutomation');
  const sys = (fn) => runAsSystem(fn, 'test');
  const platform = { 'x-internal-key': TEST_INTERNAL_KEY };
  const service = (tenantId) => ({ 'x-internal-key': TEST_INTERNAL_KEY, 'x-tenant-id': String(tenantId) });
  let phone = 919100000000;

  const seed = (extra = {}) => sys(() => Tenants.create([
    { id: 1, name: 'Quick Co', status: 'active', timezone: 'Asia/Kolkata', language: 'en', ai_followup_plan: 'quick', ...extra },
    { id: 2, name: 'Other Co', status: 'active', timezone: 'Asia/Kolkata', language: 'en' },
  ]));
  const lead = (tenantId, fields = {}) => runAsTenant(tenantId, async () => (await Leads.create({ name: 'L', phone: String(phone++), status: 'new', whatsapp_opt_in: true, ...fields })).toObject());
  const get = (tenantId, id) => runAsTenant(tenantId, () => Leads.findOne({ id }).lean());
  const due = async () => (await request(app).get('/api/internal/followups/due').set(platform)).body.items;
  // An instant at hh:mm IST on a fixed November day.
  const ist = (day, hh, mm = 0) => new Date(Date.UTC(2026, 10, day, hh, mm) - 5.5 * HOUR);
  const tenantOf = (extra = {}) => ({ id: 1, timezone: 'Asia/Kolkata', ai_followup_plan: 'quick', ...extra });

  await t.test('default plan unchanged: gap 2/3/5, max 3, first due = inbound + 2 days', async () => {
    await seed();
    assert.deepStrictEqual(ai.FOLLOWUP_GAP_DAYS, [2, 3, 5]);
    assert.strictEqual(ai.MAX_FOLLOWUP_STEPS, 3);
    assert.strictEqual(ai.maxStepsFor({}), 3);
    const l = await lead(2);
    const at = new Date();
    await runAsTenant(2, () => ai.recordInbound(l.id, at));
    assert.strictEqual((await get(2, l.id)).ai_followup_due.getTime(), at.getTime() + 2 * DAY);
    await runAsTenant(2, () => ai.markFollowupSent(l.id, 1));
    const after = await get(2, l.id);
    assert.ok(Math.abs(after.ai_followup_due.getTime() - (Date.now() + 3 * DAY)) < 60000);
    assert.strictEqual(await runAsTenant(2, () => ai.markFollowupSent(l.id, 4)), false);
  });

  await t.test('quick: nudge 1 is due 2 hours after the inbound; due list carries plan fields', async () => {
    await seed();
    const l = await lead(1);
    const at = new Date(Date.now() - 3 * HOUR);
    await runAsTenant(1, () => ai.recordInbound(l.id, at));
    const saved = await get(1, l.id);
    assert.strictEqual(saved.ai_followup_due.getTime(), at.getTime() + 2 * HOUR);
    const items = await due();
    assert.strictEqual(items.length, 1);
    assert.deepStrictEqual([items[0].step, items[0].plan, items[0].max_steps, items[0].in_window], [1, 'quick', 2, true]);
  });

  await t.test('quick: nudge 2 is the next 09:30 when inside the window', () => {
    const at = ai.quickSecondNudgeAt(tenantOf(), ist(10, 12), ist(10, 10));
    assert.strictEqual(at.getTime(), ist(11, 9, 30).getTime());
  });

  await t.test('quick: when 09:30 is after the window, nudge 2 is the last in-hours moment; never outside 9-21', () => {
    const prev = process.env.AI_SENDING_HOURS;
    process.env.AI_SENDING_HOURS = '9-21';
    try {
      // Inbound 08:00: window closes 08:00 next day, 07:30 is out of hours -> 20:59 the same day.
      assert.strictEqual(ai.quickSecondNudgeAt(tenantOf(), ist(10, 10), ist(10, 8)).getTime(), ist(10, 20, 59).getTime());
      // Inbound 09:10, nudge 1 at 11:10: 09:30 next day is past window end 09:10 -> 20:59.
      assert.strictEqual(ai.quickSecondNudgeAt(tenantOf(), ist(10, 11, 10), ist(10, 9, 10)).getTime(), ist(10, 20, 59).getTime());
      // Inbound 13:00: morning slot is inside the window.
      assert.strictEqual(ai.quickSecondNudgeAt(tenantOf(), ist(10, 15), ist(10, 13)).getTime(), ist(11, 9, 30).getTime());
      for (let h = 0; h < 24; h += 1) {
        const inbound = ist(10, h, 15);
        const r = ai.quickSecondNudgeAt(tenantOf(), new Date(inbound.getTime() + 2 * HOUR), inbound);
        assert.ok(ai.inSendingHours(tenantOf(), r), `hour ${h}: ${r.toISOString()} must be in sending hours`);
        assert.ok(r.getTime() <= inbound.getTime() + DAY, `hour ${h}: not after the window`);
      }
    } finally {
      process.env.AI_SENDING_HOURS = prev;
    }
  });

  await t.test('quick: nudge 2 scheduled inside the window; after nudge 2 it stops unless template opted in', async () => {
    await seed();
    const l = await lead(1);
    const inbound = new Date(Date.now() - 3 * HOUR);
    await runAsTenant(1, () => ai.recordInbound(l.id, inbound));
    await runAsTenant(1, () => ai.markFollowupSent(l.id, 1));
    const s1 = await get(1, l.id);
    assert.strictEqual(s1.ai_followup_step, 1);
    assert.ok(s1.ai_followup_due.getTime() <= inbound.getTime() + DAY);
    await runAsTenant(1, () => ai.markFollowupSent(l.id, 2));
    const s2 = await get(1, l.id);
    assert.strictEqual(s2.ai_followup_step, 2);
    assert.strictEqual(s2.ai_followup_due, null);
    assert.strictEqual(await runAsTenant(1, () => ai.markFollowupSent(l.id, 3)), false);
  });

  await t.test('quick + template opt-in: step 3 waits for the window to close and goes out as a template', async () => {
    await seed({ ai_followup_template_after_window: true });
    const l = await lead(1);
    const inbound = new Date(Date.now() - 3 * HOUR);
    await runAsTenant(1, () => ai.recordInbound(l.id, inbound));
    await runAsTenant(1, () => ai.markFollowupSent(l.id, 1));
    await runAsTenant(1, () => ai.markFollowupSent(l.id, 2));
    const s2 = await get(1, l.id);
    assert.ok(s2.ai_followup_due.getTime() > inbound.getTime() + DAY);
    // Window still open now: nothing is returned even if due.
    await runAsTenant(1, () => Leads.updateOne({ id: l.id }, { $set: { ai_followup_due: new Date(Date.now() - HOUR) } }));
    assert.deepStrictEqual(await due(), []);
    // Window closed: the template step is returned.
    await runAsTenant(1, () => Leads.updateOne({ id: l.id }, { $set: { last_inbound_at: new Date(Date.now() - 25 * HOUR), ai_followup_due: new Date(Date.now() - HOUR) } }));
    const items = await due();
    assert.strictEqual(items.length, 1);
    assert.deepStrictEqual([items[0].step, items[0].in_window, items[0].max_steps], [3, false, 3]);
    assert.ok(items[0].template);
    await runAsTenant(1, () => ai.markFollowupSent(l.id, 3));
    assert.strictEqual((await get(1, l.id)).ai_followup_due, null);
  });

  await t.test('quick: never free text after the window closed (stops, or template when opted in)', async () => {
    await seed();
    const l = await lead(1, { ai_followup_step: 0, ai_followup_due: new Date(Date.now() - HOUR), last_inbound_at: new Date(Date.now() - 30 * HOUR) });
    assert.deepStrictEqual(await due(), []);
    assert.strictEqual((await get(1, l.id)).ai_followup_due, null);
    await clearCollections();
    await seed({ ai_followup_template_after_window: true });
    const l2 = await lead(1, { ai_followup_step: 1, ai_followup_due: new Date(Date.now() - HOUR), last_inbound_at: new Date(Date.now() - 30 * HOUR) });
    const items = await due();
    assert.strictEqual(items.length, 1);
    assert.deepStrictEqual([items[0].lead_id, items[0].step, items[0].in_window], [l2.id, 3, false]);
  });

  await t.test('quick: a reply resets the cycle (step 0, next nudge 2h later)', async () => {
    await seed();
    const l = await lead(1, { ai_followup_step: 1, ai_followup_due: new Date(Date.now() + HOUR) });
    const at = new Date();
    await runAsTenant(1, () => ai.recordInbound(l.id, at));
    const saved = await get(1, l.id);
    assert.strictEqual(saved.ai_followup_step, 0);
    assert.strictEqual(saved.ai_followup_due.getTime(), at.getTime() + 2 * HOUR);
  });

  await t.test('assignment: reply after a nudge goes to the telecaller; no overwrite; none without a nudge', async () => {
    await seed();
    const tele = await sys(() => Users.create({ tenant_id: 1, email: 't1@example.com', name: 'Tele', role: 'telecaller', password_hash: 'x' }));
    const nudged = await lead(1, { ai_followup_step: 1 });
    const fresh = await lead(1, { ai_followup_step: 0 });
    const taken = await lead(1, { ai_followup_step: 2, assigned_to: 4242 });
    for (const l of [nudged, fresh, taken]) await runAsTenant(1, () => ai.recordInbound(l.id));
    assert.strictEqual((await get(1, nudged.id)).assigned_to, tele.id);
    assert.ok(!(await get(1, fresh.id)).assigned_to);
    assert.strictEqual((await get(1, taken.id)).assigned_to, 4242);
  });

  await t.test('assignment: followup_assignee_user_id must belong to the same tenant, else needs_human', async () => {
    await seed();
    const foreign = await sys(() => Users.create({ tenant_id: 2, email: 'o@example.com', name: 'Other', role: 'agent', password_hash: 'x' }));
    await sys(() => Tenants.updateOne({ id: 1 }, { $set: { followup_assignee_user_id: foreign.id } }));
    const a = await lead(1, { ai_followup_step: 1 });
    await runAsTenant(1, () => ai.recordInbound(a.id));
    const sa = await get(1, a.id);
    assert.ok(!sa.assigned_to, 'cross-tenant user is never assigned');
    assert.strictEqual(sa.needs_human, true);

    const mine = await sys(() => Users.create({ tenant_id: 1, email: 'm@example.com', name: 'Mine', role: 'agent', password_hash: 'x' }));
    await sys(() => Tenants.updateOne({ id: 1 }, { $set: { followup_assignee_user_id: mine.id } }));
    const b = await lead(1, { ai_followup_step: 1 });
    await runAsTenant(1, () => ai.recordInbound(b.id));
    assert.strictEqual((await get(1, b.id)).assigned_to, mine.id);
  });

  await t.test('default plan: a reply after a nudge assigns nobody and flags nothing', async () => {
    await seed();
    await sys(() => Users.create({ tenant_id: 2, email: 'd@example.com', name: 'Tele2', role: 'telecaller', password_hash: 'x' }));
    const l = await lead(2, { ai_followup_step: 1 });
    await runAsTenant(2, () => ai.recordInbound(l.id));
    const saved = await get(2, l.id);
    assert.ok(!saved.assigned_to);
    assert.ok(!saved.needs_human);
  });

  await t.test('safety: paused, opted-out, closed, needs_human, followups off and AI off are excluded', async () => {
    await seed();
    const past = new Date(Date.now() - HOUR);
    const base = { ai_followup_step: 0, ai_followup_due: past, last_inbound_at: new Date(Date.now() - 3 * HOUR) };
    const ok = await lead(1, base);
    await lead(1, { ...base, ai_paused: true });
    await lead(1, { ...base, opted_out: true });
    await lead(1, { ...base, status: 'converted' });
    await lead(1, { ...base, needs_human: true });
    assert.deepStrictEqual((await due()).map((i) => i.lead_id), [ok.id]);
    await runAsTenant(1, () => Leads.updateOne({ id: ok.id }, { $set: { ai_followup_due: past } }));
    await sys(() => Tenants.updateOne({ id: 1 }, { $set: { ai_followups_enabled: false } }));
    assert.deepStrictEqual(await due(), []);
    await sys(() => Tenants.updateOne({ id: 1 }, { $set: { ai_followups_enabled: true, ai_enabled: false } }));
    assert.deepStrictEqual(await due(), []);
  });

  await t.test('mark route uses the plan limits', async () => {
    await seed();
    const l = await lead(1, { last_inbound_at: new Date(Date.now() - HOUR) });
    assert.strictEqual((await request(app).post('/api/internal/followups/mark').set(service(1)).send({ lead_id: l.id, step: 1 })).status, 200);
    assert.strictEqual((await request(app).post('/api/internal/followups/mark').set(service(1)).send({ lead_id: l.id, step: 3 })).status, 400);
  });
});
