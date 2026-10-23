/**
 * Workflow automation & engine logs.
 *   WF00–WF05: workspace events, written by the engine (service key + x-tenant-id)
 *   WF06–WF07: platform events, written by the engine with no workspace (tenant_id null)
 * Customers can neither write engine logs nor read any of them; staff reads
 * keep their existing permissions; telemetry reports only real data.
 * Real server.js app, in-memory MongoDB, synthetic data, outbound HTTP blocked.
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const axiosModule = require('axios');
const { startTestDb, stopTestDb, clearCollections, makeToken, TEST_INTERNAL_KEY } = require('./setup');

// The WF06 founder route sends a WhatsApp message when a platform number and
// token are configured: blank both so .env can never supply them here.
process.env.WA_PHONE_NUMBER_ID = '';
process.env.META_PAGE_ACCESS_TOKEN = '';
const outbound = [];
const realRequest = axiosModule.Axios.prototype.request;
let app;
const DAY = 86400000;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  axiosModule.Axios.prototype.request = function blocked(config) {
    outbound.push(String(config?.url || config));
    return Promise.reject(new Error('outbound HTTP blocked in test'));
  };
  await startTestDb();
  ({ app } = require('../server'));
});

test.after(async () => {
  axiosModule.Axios.prototype.request = realRequest;
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearCollections();
  outbound.length = 0;
});

test('Workflow automation & engine logs', async (t) => {
  const { Users, Tenants, WorkflowLogs, AiDecisions } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const sys = (fn) => runAsSystem(fn, 'test');
  const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user, { mfa: true })}` });
  const service = (tenantId) => (tenantId ? { 'x-internal-key': TEST_INTERNAL_KEY, 'x-tenant-id': String(tenantId) } : { 'x-internal-key': TEST_INTERNAL_KEY });
  const createUser = async (fields) => (await sys(() => Users.create({ password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0, ...fields }))).toObject();
  const staff = (role) => createUser({ tenant_id: null, is_platform_staff: true, staff_role: role, email: `${role}@nera.test`, name: role });
  async function workspace(id) {
    await sys(() => Tenants.create({ id, name: `Workspace ${id}`, status: 'active' }));
    return {
      owner: await createUser({ tenant_id: id, role: 'owner', email: `owner${id}@acme.test`, name: 'Owner' }),
      agent: await createUser({ tenant_id: id, role: 'agent', email: `agent${id}@acme.test`, name: 'Agent' }),
    };
  }
  const allLogs = () => sys(() => WorkflowLogs.find({}, { _id: 0 }).sort({ id: 1 }).lean());

  // ── Writing: workspace workflows ─────────────────────────
  await t.test('L1. WF00–WF05 from the engine are stored in that workspace only', async () => {
    await workspace(10);
    await workspace(20);
    for (const wf of ['WF00', 'WF01', 'WF02', 'WF03', 'WF04', 'WF05']) {
      const res = await request(app).post('/api/workflows/log').set(service(10)).send({ workflow: wf, status: 'Success', lead_id: 42, message: `${wf} ran` });
      assert.strictEqual(res.status, 200, `${wf}: ${JSON.stringify(res.body)}`);
      assert.strictEqual(res.body.scope, 'tenant');
    }
    const named = await request(app).post('/api/workflows/log').set(service(10)).send({ workflow: 'WF01: Conversational Sales', status: 'failed' });
    assert.strictEqual(named.status, 200, 'a descriptive name is reduced to its WF code');
    const rows = await allLogs();
    assert.strictEqual(rows.length, 7);
    assert.ok(rows.every((r) => r.tenant_id === 10), 'stamped with workspace 10');
    assert.strictEqual(rows[0].status, 'success', 'status normalised');
    assert.strictEqual(rows[0].lead_id, '42');
    assert.strictEqual(rows[6].workflow, 'WF01');
    assert.strictEqual(await runAsTenant(20, () => WorkflowLogs.countDocuments({})), 0, 'invisible to another workspace');
    assert.strictEqual(outbound.length, 0);
  });

  await t.test('L2. The workspace endpoint refuses platform workflows and invalid entries; nothing stored', async () => {
    await workspace(10);
    for (const wf of ['WF06', 'WF07', 'wf06: founder']) {
      const res = await request(app).post('/api/workflows/log').set(service(10)).send({ workflow: wf, status: 'success' });
      assert.strictEqual(res.status, 400, wf);
      assert.strictEqual(res.body.code, 'PLATFORM_WORKFLOW');
    }
    for (const [body, code] of [[{ workflow: 'WF99', status: 'success' }, 'INVALID_WORKFLOW'], [{ workflow: 'Lead thing', status: 'success' }, 'INVALID_WORKFLOW'], [{ workflow: 'WF01' }, 'INVALID_STATUS'], [{}, 'INVALID_WORKFLOW']]) {
      const res = await request(app).post('/api/workflows/log').set(service(10)).send(body);
      assert.strictEqual(res.status, 400, JSON.stringify(body));
      assert.strictEqual(res.body.code, code);
    }
    const noTenant = await request(app).post('/api/workflows/log').set(service()).send({ workflow: 'WF01', status: 'success' });
    assert.strictEqual(noTenant.status, 400, 'a workspace event must name its workspace');
    assert.strictEqual((await allLogs()).length, 0);
  });

  await t.test('L3. Customer sessions cannot write engine logs', async () => {
    const { owner, agent } = await workspace(10);
    for (const user of [owner, agent]) {
      const res = await request(app).post('/api/workflows/log').set(bearer(user)).send({ workflow: 'WF01', status: 'success', message: 'forged' });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.code, 'SERVICE_ONLY');
      const platform = await request(app).post('/api/platform/workflows/log').set(bearer(user)).send({ workflow: 'WF06', status: 'success', message: 'forged report' });
      assert.strictEqual(platform.status, 401);
    }
    assert.strictEqual((await allLogs()).length, 0);
  });

  // ── Writing: platform workflows ──────────────────────────
  await t.test('L4. WF06/WF07 from the engine are stored as platform events (no workspace)', async () => {
    for (const wf of ['WF06', 'WF07']) {
      const res = await request(app).post('/api/platform/workflows/log').set(service()).send({ workflow: wf, status: 'success', message: `${wf} ran`, lead_id: 99, tenant_id: 10 });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(res.body.scope, 'platform');
    }
    const rows = await allLogs();
    assert.deepStrictEqual(rows.map((r) => [r.workflow, r.tenant_id, r.lead_id]), [['WF06', null, null], ['WF07', null, null]], 'body tenant_id / lead_id ignored');
  });

  await t.test('L5. The platform endpoint refuses workspace workflows, workspace headers and anything but the service key', async () => {
    const founder = await staff('founder');
    const wrongTenant = await request(app).post('/api/platform/workflows/log').set(service()).send({ workflow: 'WF01', status: 'success' });
    assert.strictEqual(wrongTenant.status, 400);
    assert.strictEqual(wrongTenant.body.code, 'TENANT_WORKFLOW');
    const withHeader = await request(app).post('/api/platform/workflows/log').set(service(10)).send({ workflow: 'WF06', status: 'success' });
    assert.strictEqual(withHeader.status, 400);
    assert.strictEqual(withHeader.body.code, 'PLATFORM_LOG_NO_TENANT');
    for (const headers of [{}, { 'x-internal-key': 'wrong-key' }, bearer(founder)]) {
      const res = await request(app).post('/api/platform/workflows/log').set(headers).send({ workflow: 'WF07', status: 'success' });
      assert.strictEqual(res.status, 401);
    }
    assert.strictEqual((await allLogs()).length, 0);
  });

  await t.test('L6. The WF06 founder report logs a platform event even when called for a workspace', async () => {
    await workspace(10);
    const res = await request(app).post('/api/communication/send-founder').set(service(10)).send({ channel: 'whatsapp', type: 'daily', content: 'Synthetic founder report' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const rows = await allLogs();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].workflow, 'WF06');
    assert.strictEqual(rows[0].tenant_id, null, 'not attributed to workspace 10');
    assert.strictEqual(outbound.length, 0, 'no WhatsApp call without a configured number/token');
  });

  // ── Reading ──────────────────────────────────────────────
  async function seedMixed() {
    await workspace(10);
    await workspace(20);
    await request(app).post('/api/workflows/log').set(service(10)).send({ workflow: 'WF01', status: 'success', message: 'ten' });
    await request(app).post('/api/workflows/log').set(service(20)).send({ workflow: 'WF02', status: 'failed', message: 'twenty' });
    await request(app).post('/api/platform/workflows/log').set(service()).send({ workflow: 'WF06', status: 'success', message: 'founder' });
    await request(app).post('/api/platform/workflows/log').set(service()).send({ workflow: 'WF07', status: 'success', message: 'maintenance' });
  }

  await t.test('R1. Admin log view labels every row and filters by scope and workspace', async () => {
    await seedMixed();
    const ops = await staff('ops');
    const all = await request(app).get('/api/admin/workflows/logs').set(bearer(ops));
    assert.strictEqual(all.status, 200);
    const byMessage = Object.fromEntries(all.body.logs.map((l) => [l.message, l]));
    assert.deepStrictEqual([byMessage.ten.scope, byMessage.ten.tenant_name], ['tenant', 'Workspace 10']);
    assert.deepStrictEqual([byMessage.twenty.scope, byMessage.twenty.tenant_name], ['tenant', 'Workspace 20']);
    assert.deepStrictEqual([byMessage.founder.scope, byMessage.founder.tenant_name], ['platform', null]);
    assert.strictEqual(byMessage.maintenance.scope, 'platform');
    const platform = await request(app).get('/api/admin/workflows/logs').query({ scope: 'platform' }).set(bearer(ops));
    assert.deepStrictEqual(platform.body.logs.map((l) => l.workflow).sort(), ['WF06', 'WF07']);
    const tenant = await request(app).get('/api/admin/workflows/logs').query({ scope: 'tenant' }).set(bearer(ops));
    assert.deepStrictEqual(tenant.body.logs.map((l) => l.workflow).sort(), ['WF01', 'WF02']);
    const ten = await request(app).get('/api/admin/workflows/logs').query({ tenant_id: 10 }).set(bearer(ops));
    assert.deepStrictEqual(ten.body.logs.map((l) => l.message), ['ten']);
  });

  await t.test('R2. Customers cannot read any workflow logs or telemetry, platform or their own', async () => {
    await seedMixed();
    const { owner } = await (async () => ({ owner: await sys(() => Users.findOne({ email: 'owner10@acme.test' }).lean()) }))();
    for (const path of ['/api/workflows/logs', '/api/workflows/telemetry', '/api/admin/workflows/logs', '/api/admin/workflows/telemetry', '/api/admin/reports/founder-dashboard', '/api/reports/founder-dashboard']) {
      const res = await request(app).get(path).set(bearer(owner));
      assert.strictEqual(res.status, 403, `${path} returned ${res.status}`);
      assert.ok(!JSON.stringify(res.body).includes('founder') && !JSON.stringify(res.body).includes('maintenance'), `${path} leaked platform log content`);
    }
    assert.strictEqual((await request(app).get('/api/admin/workflows/logs')).status, 401);
  });

  await t.test('R3. Staff permissions: founder/ops read; the retired support role can neither read nor delete', async () => {
    await seedMixed();
    for (const role of ['founder', 'ops']) {
      assert.strictEqual((await request(app).get('/api/admin/workflows/logs').set(bearer(await staff(role)))).status, 200, role);
    }
    const support = await staff('support');
    assert.strictEqual((await request(app).get('/api/admin/workflows/logs').set(bearer(support))).status, 403);
    const target = (await allLogs())[0];
    const del = await request(app).delete(`/api/admin/workflows/logs/${target.id}`).set(bearer(support));
    assert.strictEqual(del.status, 403);
    assert.strictEqual((await allLogs()).length, 4);
  });

  await t.test('R4. Founder reports list platform WF06 events only', async () => {
    await seedMixed();
    // A legacy row written for a workspace under the WF06 name must not appear.
    await runAsTenant(10, () => WorkflowLogs.create({ workflow: 'WF06', status: 'success', message: 'legacy workspace-stamped' }));
    const founder = await staff('founder');
    const res = await request(app).get('/api/admin/reports/founder-dashboard').set(bearer(founder));
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.reports.map((r) => r.message), ['founder']);
  });

  await t.test('T1. Telemetry reports real values only: nothing assumed for an empty database', async () => {
    const ops = await staff('ops');
    const empty = await request(app).get('/api/admin/workflows/telemetry').set(bearer(ops));
    assert.deepStrictEqual(empty.body.telemetry, {
      totalExecutions: 0, successCount: 0, failedCount: 0, successRate: null, aiInterventions: 0,
      activeWorkflows: 0, platformExecutions: 0, tenantExecutions: 0,
    });
    const svc = await request(app).get('/api/workflows/telemetry').set(service());
    assert.strictEqual(svc.body.telemetry.successRate, null);
    assert.strictEqual(svc.body.telemetry.activeWorkflows, 0);

    await seedMixed();
    await runAsTenant(10, () => AiDecisions.create({ lead_id: '1', module: 'intent_detection', input: 'x', output: 'y', confidence: 0.9 }));
    await runAsTenant(10, () => WorkflowLogs.create({ workflow: 'WF03', status: 'success', created_at: new Date(Date.now() - 30 * DAY) }));
    const seeded = await request(app).get('/api/admin/workflows/telemetry').set(bearer(ops));
    assert.deepStrictEqual(seeded.body.telemetry, {
      totalExecutions: 5, successCount: 4, failedCount: 1, successRate: 80, aiInterventions: 1,
      activeWorkflows: 4, platformExecutions: 2, tenantExecutions: 3,
    }, 'WF03 from 30 days ago is not counted as active');
  });
});
