/**
 * The email a person gets when added to a workspace: temporary password (never
 * in the mail) or invitation, escaping of typed values, and a mail failure that
 * does not fail the request. Real server.js app, in-memory MongoDB, mail kept
 * in memory.
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');
const { memberEmail, oneLine } = require('../utils/memberEmail');

const TEMP = 'Temporary-Pass-1';
const RLO = String.fromCodePoint(0x202E); // right-to-left override
let app;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  process.env.NERA_PRODUCT_NAME = 'Getnera';
  process.env.NERA_APP_URL = 'https://app.example.test/';
  delete process.env.BILLING_REQUIRE_PLAN;
  await startTestDb();
  ({ app } = require('../server'));
});

test.after(async () => {
  await stopTestDb();
});

test('the template escapes typed values and keeps the subject on one line', () => {
  const mail = memberEmail({
    method: 'password', product: 'Getnera', to: 'a&b@acme.test', role: 'agent', url: 'https://app.example.test/login',
    name: '<img src=x onerror=alert(1)>', inviterName: '"Eve" <a href="https://evil.test">click</a>',
    workspaceName: `Tom's <Shop>\r\nBcc: victim@evil.test${RLO}`,
  });
  assert.ok(!/[\r\n]/.test(mail.subject) && !mail.subject.includes(RLO), 'no line breaks or direction overrides in the subject');
  assert.strictEqual(mail.subject, "You've been added to Tom's <Shop> Bcc: victim@evil.test on Getnera");
  assert.ok(!mail.html.includes('<img'));
  assert.ok(!mail.html.includes('<a href="https://evil.test"'));
  assert.ok(!mail.html.includes('<Shop>'));
  assert.ok(mail.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(mail.html.includes('Tom&#39;s &lt;Shop&gt;'));
  assert.ok(mail.html.includes('a&amp;b@acme.test'));
  assert.ok(!mail.text.includes('\r'), 'typed line breaks do not reach the plain text either');
  assert.strictEqual(oneLine('x'.repeat(300), 80).length, 80);
});

test('adding people', async (t) => {
  const { Users, Tenants, Invitations } = require('../models');
  const { runAsSystem } = require('../services/tenantContext');
  const billing = require('../services/billing');
  const notify = require('../services/notify');
  const sys = (fn) => runAsSystem(fn, 'test');
  let owner;

  t.beforeEach(async () => {
    await clearCollections();
    notify.clearOutbox();
    process.env.EMAIL_DELIVERY = 'memory';
    await billing.plans.ensureDefaultPlans();
    owner = (await sys(() => Users.create({
      email: 'owner@acme.test', name: 'Asha Owner', password_hash: bcrypt.hashSync('Existing-Pass-1', 4),
      is_active: true, token_version: 0, tenant_id: 1, role: 'owner',
    }))).toObject();
    await sys(() => Tenants.create({ id: 1, name: 'Acme <Traders>', status: 'active', owner_user_id: owner.id, timezone: 'Asia/Kolkata' }));
    await billing.subscriptions.activate({ tenantId: 1, plan: await billing.plans.planByCode('complete') });
  });

  const add = (body) => request(app).post('/api/team/users').set({ Authorization: `Bearer ${makeToken(owner)}` }).send(body);
  const priya = { name: 'Priya Agent', email: 'priya@acme.test', role: 'agent', method: 'password', password: TEMP };

  await t.test('temporary password: sign-in details by email, never the password', async () => {
    const res = await add(priya);
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.deepStrictEqual(res.body.delivery, { delivered: true, mode: 'memory' });
    assert.strictEqual(notify.outbox().length, 1);
    const [mail] = notify.outbox();
    assert.strictEqual(mail.to, 'priya@acme.test');
    assert.strictEqual(mail.subject, "You've been added to Acme <Traders> on Getnera");
    for (const body of [mail.text, mail.html]) {
      assert.ok(!body.includes(TEMP), 'the password is not in the mail');
      assert.ok(body.includes('https://app.example.test/login'));
      assert.ok(body.includes('Asha Owner'));
      assert.ok(body.includes('Agent'));
      assert.match(body, /temporary password that Asha Owner will share with you/);
      assert.match(body, /must change the temporary one at your first sign-in/);
    }
    assert.ok(mail.text.includes('Workspace: Acme <Traders>'));
    assert.ok(mail.html.includes('Acme &lt;Traders&gt;'));
    assert.ok(!mail.html.includes('<Traders>'));
  });

  await t.test('invitation: the designed email with the one-time link', async () => {
    const res = await add({ name: 'Ravi', email: 'ravi@acme.test', role: 'manager', method: 'invite' });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body.delivery.delivered, true);
    assert.strictEqual(notify.outbox().length, 1);
    const [mail] = notify.outbox();
    assert.strictEqual(mail.subject, "You're invited to Acme <Traders> on Getnera");
    const link = /https:\/\/app\.example\.test\/invite\/[A-Za-z0-9_-]+/.exec(mail.text)[0];
    assert.ok(mail.html.includes(`href="${link}"`));
    for (const body of [mail.text, mail.html]) {
      assert.ok(body.includes('Asha Owner'));
      assert.ok(body.includes('Manager'));
      assert.match(body, /Choose your own password/);
      assert.match(body, /works once and expires on/);
    }
    assert.ok(!mail.html.includes('<Traders>'));
  });

  await t.test('a mail failure never fails the creation, and the answer says so', async (st) => {
    st.mock.method(notify, 'memberAddedEmail', async () => { throw new Error('SMTP down'); });
    st.mock.method(console, 'error', () => {});
    const res = await add(priya);
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.deepStrictEqual(res.body.delivery, { delivered: false, mode: 'error' });
    assert.strictEqual(await sys(() => Users.countDocuments({ email: 'priya@acme.test' })), 1);
  });

  await t.test('email switched off: created, delivered false, on both paths', async () => {
    process.env.EMAIL_DELIVERY = 'off';
    const byPassword = await add(priya);
    assert.strictEqual(byPassword.status, 201);
    assert.strictEqual(byPassword.body.delivery.delivered, false);
    const byInvite = await add({ name: 'Ravi', email: 'ravi@acme.test', role: 'agent', method: 'invite' });
    assert.strictEqual(byInvite.status, 201);
    assert.strictEqual(byInvite.body.delivery.delivered, false);
    assert.strictEqual(await sys(() => Invitations.countDocuments({ email: 'ravi@acme.test' })), 1);
    assert.strictEqual(notify.outbox().length, 0);
  });

  await t.test('a refused creation sends nothing', async () => {
    const res = await add({ ...priya, password: 'short1' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(notify.outbox().length, 0);
  });
});
