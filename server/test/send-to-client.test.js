/**
 * Admin "Send to client": a new workspace's owner gets a one-time
 * set-password link and sign-in details on WhatsApp from the platform number.
 * Real server.js app on an in-memory MongoDB; every Meta call is stubbed and
 * no request leaves the test.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const axiosModule = require('axios');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

const PLATFORM_PHONE = 'PLATFORM_PHONE_W';
const OWNER_PASSWORD = 'Owner-Secret-Pass-42';
const BODY = 'Hi {{1}}, your Getnera workspace {{2}} is ready.\n\nStep 1: Set your password with this link: {{3}}\nThe link works once and expires in 72 hours.\n\nStep 2: Sign in at https://app.getnera.in with your email {{4}} and the password you set.\n\nNeed help? Just reply to this message.';
let app;
let metaFail = false;
const metaCalls = [];
const realRequest = axiosModule.Axios.prototype.request;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.NERA_APP_URL = 'https://app.getnera.in';
  process.env.PLATFORM_WA_PHONE_NUMBER_ID = PLATFORM_PHONE;
  process.env.PLATFORM_WA_ACCESS_TOKEN = 'dummy-platform-token';
  process.env.PLATFORM_WA_BUSINESS_ACCOUNT_ID = 'WABA_W';
  process.env.WORKSPACE_READY_TEMPLATE = 'workspace_ready';
  process.env.WORKSPACE_READY_TEMPLATE_LANG = 'en';
  delete process.env.WORKSPACE_READY_MAX_PER_HOUR;
  axiosModule.Axios.prototype.request = async function stub(config) {
    const url = String(config.url || '');
    const data = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    metaCalls.push({ url, data });
    if (url.startsWith('https://graph.facebook.com/') && url.endsWith('/messages')) {
      if (metaFail) {
        const error = new Error('Request failed with status code 400');
        error.response = { status: 400, data: { error: { message: '(#131026) Message undeliverable' } } };
        throw error;
      }
      return { data: { messages: [{ id: `wamid.out.${metaCalls.length}` }] }, status: 200 };
    }
    throw new Error(`blocked outbound call ${url}`);
  };
  await startTestDb();
  ({ app } = require('../server'));
});

test.after(async () => {
  axiosModule.Axios.prototype.request = realRequest;
  await stopTestDb();
});

const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user, { mfa: true })}` });
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const sends = () => metaCalls.filter((c) => c.url.endsWith('/messages'));

test('Send to client', async (t) => {
  const { Users, Tenants, Clients, AuditEvents, PlatformWaMessages, MetaWhatsappTemplates, Invitations } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const notify = require('../services/notify');
  const sys = (fn) => runAsSystem(fn, 'test');

  async function seed({ template = { status: 'APPROVED', category: 'UTILITY' } } = {}) {
    await clearCollections();
    notify.clearOutbox();
    metaCalls.length = 0;
    metaFail = false;
    const staff = async (role) => (await sys(() => Users.create({
      tenant_id: null, is_platform_staff: true, staff_role: role, email: `${role}@nera.test`, name: role,
      password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
    }))).toObject();
    const ops = await staff('ops');
    const support = await staff('support');
    const founder = await staff('founder');
    await sys(() => Tenants.create({ id: 7, name: 'Kaveri Motors', status: 'active', alerts_whatsapp: { opted_in: true, number: '919876543210' } }));
    await runAsTenant(7, () => Clients.create({ name: 'Kaveri' }));
    const owner = (await runAsTenant(7, () => Users.create({
      role: 'owner', email: 'ravi@kaveri.test', name: 'Ravi', is_active: true, token_version: 0,
      password_hash: bcrypt.hashSync(OWNER_PASSWORD, 4),
    }))).toObject();
    await sys(() => Tenants.updateOne({ id: 7 }, { $set: { owner_user_id: owner.id } }));
    if (template) {
      await sys(() => MetaWhatsappTemplates.create({
        template_id: 'TW', waba_id: 'WABA_W', name: 'workspace_ready', language: 'en', status: template.status, category: template.category,
        components: [{ type: 'BODY', text: BODY, example: { body_text: [['Ravi', 'Kaveri Motors', 'https://app.getnera.in/reset-password/AbC123', 'ravi@kaveri.in']] } }],
      }));
    }
    return { ops, support, founder, owner };
  }

  const send = (user, body = { phone: '+91 98765 43210', phone_confirm: '+919876543210', confirm_opt_in: true }) => request(app).post('/api/admin/tenants/7/welcome-message').set(bearer(user)).send(body);
  const linkOf = (call) => call.data.template.components[0].parameters[2].text;
  const tokenOf = (call) => linkOf(call).split('/reset-password/')[1];

  await t.test('W1. Only staff who manage users can preview or send', async () => {
    const { support } = await seed();
    const preview = await request(app).get('/api/admin/tenants/7/welcome-message').set(bearer(support));
    assert.strictEqual(preview.status, 403);
    const res = await send(support);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(sends().length, 0);
    const owner = await sys(() => Users.findOne({ email: 'ravi@kaveri.test' }).lean());
    assert.ok(!owner.reset_token_hash, 'no link was created');
  });

  await t.test('W2. A missing, pending or non-utility template gives a clear message and sends nothing', async () => {
    for (const [template, code] of [[null, 'TEMPLATE_MISSING'], [{ status: 'PENDING', category: 'UTILITY' }, 'TEMPLATE_NOT_APPROVED'], [{ status: 'APPROVED', category: 'MARKETING' }, 'TEMPLATE_NOT_UTILITY']]) {
      const { ops } = await seed({ template });
      const preview = await request(app).get('/api/admin/tenants/7/welcome-message').set(bearer(ops));
      assert.strictEqual(preview.status, 200);
      assert.strictEqual(preview.body.template.ok, false);
      assert.strictEqual(preview.body.template.code, code);
      assert.match(preview.body.template.message, /workspace_ready/);
      const res = await send(ops);
      assert.strictEqual(res.status, 409, code);
      assert.strictEqual(res.body.code, code);
      assert.match(res.body.error, /workspace_ready/);
      assert.strictEqual(sends().length, 0);
      const owner = await sys(() => Users.findOne({ email: 'ravi@kaveri.test' }).lean());
      assert.ok(!owner.reset_token_hash, 'no link was created');
    }
  });

  await t.test('W3. The preview prefills the alert number and never creates a link', async () => {
    const { ops } = await seed();
    const res = await request(app).get('/api/admin/tenants/7/welcome-message').set(bearer(ops));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.suggested_number, '+919876543210');
    assert.strictEqual(res.body.template.ok, true);
    assert.match(res.body.preview_text, /Hi Ravi, your Getnera workspace Kaveri Motors is ready/);
    assert.match(res.body.preview_text, /\[one-time set-password link\]/);
    assert.match(res.body.preview_text, /ravi@kaveri\.test/);
    assert.deepStrictEqual(res.body.rate, { limit: 3, used: 0, remaining: 3 });
    const owner = await sys(() => Users.findOne({ email: 'ravi@kaveri.test' }).lean());
    assert.ok(!owner.reset_token_hash);
  });

  await t.test('W4. Send: a one-time link, never the password; the link stays out of history; audited with a masked number', async () => {
    const { ops } = await seed();
    const res = await send(ops);
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body.to, '+91******3210');
    assert.strictEqual(sends().length, 1);
    const call = sends()[0];
    assert.match(call.url, new RegExp(`/${PLATFORM_PHONE}/messages$`));
    assert.strictEqual(call.data.to, '919876543210');
    assert.strictEqual(call.data.template.name, 'workspace_ready');
    assert.strictEqual(call.data.template.language.code, 'en');
    const params = call.data.template.components[0].parameters.map((p) => p.text);
    assert.deepStrictEqual([params[0], params[1], params[3]], ['Ravi', 'Kaveri Motors', 'ravi@kaveri.test']);
    assert.match(params[2], /^https:\/\/app\.getnera\.in\/reset-password\/[A-Za-z0-9_-]{40,}$/);
    const raw = JSON.stringify(call.data);
    assert.ok(!raw.includes(OWNER_PASSWORD), 'the password is never in the payload');
    assert.ok(!/password_hash|\$2[aby]\$/.test(raw), 'no password hash either');

    const token = tokenOf(call);
    const owner = await sys(() => Users.findOne({ email: 'ravi@kaveri.test' }).lean());
    assert.strictEqual(owner.reset_token_hash, sha256(token), 'only the hash is stored');
    const hours = (new Date(owner.reset_token_expires_at) - Date.now()) / 3600000;
    assert.ok(hours > 71.9 && hours <= 72, `link valid 72 hours (got ${hours})`);

    const stored = await PlatformWaMessages.find({}).lean();
    assert.strictEqual(stored.length, 1);
    assert.ok(!stored[0].text.includes(token), 'the link is not kept in the admin inbox');
    assert.match(stored[0].text, /\[one-time set-password link\]/);

    const events = await sys(() => AuditEvents.find({ event: 'WORKSPACE_LOGIN_LINK_SENT' }).sort({ created_at: 1 }).lean());
    assert.deepStrictEqual(events.map((e) => e.meta.status), ['attempted', 'sent'], 'an attempt row before the send, then the result');
    const event = events[1];
    assert.strictEqual(event.tenant_id, 7);
    assert.strictEqual(event.actor_type, 'staff');
    assert.strictEqual(event.actor_user_id, ops.id);
    assert.strictEqual(event.meta.to, '+91******3210');
    assert.strictEqual(event.meta.status, 'sent');
    const auditRaw = JSON.stringify(event);
    assert.ok(!auditRaw.includes('919876543210'), 'full number not in the audit log');
    assert.ok(!auditRaw.includes(token), 'link not in the audit log');

    const mails = notify.outbox().filter((m) => m.to === 'ravi@kaveri.test');
    assert.strictEqual(mails.length, 1, 'the owner is told by email');
    assert.match(mails[0].text, /\+91\*\*\*\*\*\*3210/);
    assert.ok(!mails[0].text.includes(token) && !mails[0].html.includes(token), 'the email never carries the link');
  });

  await t.test('W5. The link works once; a newer link replaces the older one', async () => {
    const { ops } = await seed();
    await send(ops);
    await send(ops);
    const [first, second] = sends().map(tokenOf);
    const old = await request(app).post('/api/auth/password/reset').send({ token: first, password: 'Brand-New-Pass-9' });
    assert.strictEqual(old.status, 410, 'the older link stopped working');
    const ok = await request(app).post('/api/auth/password/reset').send({ token: second, password: 'Brand-New-Pass-9' });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    const again = await request(app).post('/api/auth/password/reset').send({ token: second, password: 'Another-Pass-10' });
    assert.strictEqual(again.status, 410, 'single use');
    const owner = await sys(() => Users.findOne({ email: 'ravi@kaveri.test' }).lean());
    assert.ok(bcrypt.compareSync('Brand-New-Pass-9', owner.password_hash));
  });

  await t.test('W6. An expired link is refused', async () => {
    const { ops } = await seed();
    await send(ops);
    const token = tokenOf(sends()[0]);
    await sys(() => Users.updateOne({ email: 'ravi@kaveri.test' }, { $set: { reset_token_expires_at: new Date(Date.now() - 1000) } }));
    const res = await request(app).post('/api/auth/password/reset').send({ token, password: 'Brand-New-Pass-9' });
    assert.strictEqual(res.status, 410);
  });

  await t.test('W7. At most 3 sends per workspace per hour', async () => {
    const { ops } = await seed();
    for (let i = 0; i < 3; i++) assert.strictEqual((await send(ops)).status, 201);
    const res = await send(ops);
    assert.strictEqual(res.status, 429);
    assert.strictEqual(res.body.code, 'RATE_LIMITED');
    assert.strictEqual(sends().length, 3, 'the fourth never reached WhatsApp');
    const preview = await request(app).get('/api/admin/tenants/7/welcome-message').set(bearer(ops));
    assert.strictEqual(preview.body.rate.remaining, 0);
  });

  await t.test('W8. The number must be international and the client must have agreed', async () => {
    const { ops } = await seed();
    for (const phone of ['9876543210', '+91 98765', 'abc', '']) {
      const res = await send(ops, { phone, confirm_opt_in: true });
      assert.strictEqual(res.status, 400, phone);
      assert.strictEqual(res.body.code, 'BAD_NUMBER');
    }
    const res = await send(ops, { phone: '+919876543210', phone_confirm: '+919876543210' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, 'OPT_IN_REQUIRED');
    assert.strictEqual(sends().length, 0);
  });

  await t.test('W9. When WhatsApp refuses, the link is cancelled and the attempt is audited', async () => {
    const { ops } = await seed();
    metaFail = true;
    const res = await send(ops);
    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.code, 'SEND_FAILED');
    assert.match(res.body.error, /undeliverable/);
    assert.match(res.body.error, /try again/);
    const owner = await sys(() => Users.findOne({ email: 'ravi@kaveri.test' }).lean());
    assert.ok(!owner.reset_token_hash, 'link cancelled');
    const event = await sys(() => AuditEvents.findOne({ event: 'WORKSPACE_LOGIN_LINK_SENT', 'meta.status': 'failed' }).lean());
    assert.ok(event, 'the failure is audited');
  });

  await t.test('W10. A pending owner invitation gets a fresh invitation link instead', async () => {
    const { ops, owner } = await seed();
    await sys(() => Users.deleteOne({ id: owner.id }));
    await sys(() => Tenants.updateOne({ id: 7 }, { $set: { owner_user_id: null } }));
    await runAsTenant(7, () => Invitations.create({ tenant_id: 7, email: 'ravi@kaveri.test', name: 'Ravi', role: 'owner', token_hash: 'old', expires_at: new Date(Date.now() + 3600000) }));
    const res = await send(ops);
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body.link_kind, 'invitation');
    const link = linkOf(sends()[0]);
    assert.match(link, /^https:\/\/app\.getnera\.in\/invite\//);
    const token = link.split('/invite/')[1];
    const preview = await request(app).get(`/api/auth/invitations/${token}`);
    assert.strictEqual(preview.status, 200);
    assert.strictEqual(preview.body.invitation.email, 'ravi@kaveri.test');
  });

  await t.test('W11. Suspended workspaces and deactivated owners are refused', async () => {
    const { ops } = await seed();
    await sys(() => Users.updateOne({ email: 'ravi@kaveri.test' }, { $set: { is_active: false } }));
    assert.strictEqual((await send(ops)).body.code, 'OWNER_INACTIVE');
    await sys(() => Tenants.updateOne({ id: 7 }, { $set: { status: 'suspended' } }));
    assert.strictEqual((await send(ops)).body.code, 'WORKSPACE_SUSPENDED');
    assert.strictEqual(sends().length, 0);
  });

  const signIn = () => sys(() => Users.updateOne({ email: 'ravi@kaveri.test' }, { $set: { last_login: new Date() } }));
  const preview = (user) => request(app).get('/api/admin/tenants/7/welcome-message').set(bearer(user));

  await t.test('W13. Ops cannot send a link to an owner who already signs in', async () => {
    const { ops } = await seed();
    await signIn();
    const view = await preview(ops);
    assert.strictEqual(view.status, 200);
    assert.strictEqual(view.body.can_send, false);
    assert.match(view.body.blocked_message, /Only the Admin \(Owner\)/);
    const res = await send(ops);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'OWNER_ALREADY_SIGNED_IN');
    assert.match(res.body.error, /Forgot password/);
    assert.strictEqual(sends().length, 0);
    const owner = await sys(() => Users.findOne({ email: 'ravi@kaveri.test' }).lean());
    assert.ok(!owner.reset_token_hash, 'no link was created');
    assert.strictEqual(notify.outbox().length, 0);
  });

  await t.test('W14. The founder can still send, with a short "Forgot password" link life, and the owner is emailed', async () => {
    const { founder } = await seed();
    await signIn();
    const view = await preview(founder);
    assert.strictEqual(view.body.can_send, true);
    assert.strictEqual(view.body.link_valid_minutes, 60);
    const res = await send(founder);
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    const owner = await sys(() => Users.findOne({ email: 'ravi@kaveri.test' }).lean());
    assert.strictEqual(owner.reset_token_hash, sha256(tokenOf(sends()[0])));
    const minutes = (new Date(owner.reset_token_expires_at) - Date.now()) / 60000;
    assert.ok(minutes > 59.5 && minutes <= 60, `link valid 60 minutes (got ${minutes})`);
    const event = await sys(() => AuditEvents.findOne({ event: 'WORKSPACE_LOGIN_LINK_SENT', 'meta.status': 'sent' }).lean());
    assert.strictEqual(event.meta.owner_signed_in, true);
    assert.strictEqual(event.actor_user_id, founder.id);
    const mails = notify.outbox().filter((m) => m.to === 'ravi@kaveri.test');
    assert.strictEqual(mails.length, 1);
    assert.match(mails[0].subject, /sign-in link was sent on WhatsApp/);
    assert.match(mails[0].text, /sign in now or use "Forgot password"/);
    assert.match(mails[0].text, /\+91\*\*\*\*\*\*3210/);
  });

  await t.test('W15. A first-time owner (never signed in) still gets a 72-hour link from ops', async () => {
    const { ops } = await seed();
    const view = await preview(ops);
    assert.strictEqual(view.body.can_send, true);
    assert.strictEqual(view.body.link_valid_minutes, 72 * 60);
    assert.strictEqual(view.body.blocked_message, null);
    const res = await send(ops);
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    const hours = (new Date(res.body.expires_at) - Date.now()) / 3600000;
    assert.ok(hours > 71.9 && hours <= 72, `link valid 72 hours (got ${hours})`);
  });

  await t.test('W16. The number must be typed twice and match', async () => {
    const { ops } = await seed();
    for (const confirm of ['+91 98765 43211', '', undefined, 'abc']) {
      const res = await send(ops, { phone: '+91 98765 43210', phone_confirm: confirm, confirm_opt_in: true });
      assert.strictEqual(res.status, 400, String(confirm));
      assert.strictEqual(res.body.code, 'NUMBER_MISMATCH');
    }
    assert.strictEqual(sends().length, 0);
    const owner = await sys(() => Users.findOne({ email: 'ravi@kaveri.test' }).lean());
    assert.ok(!owner.reset_token_hash, 'no link was created');
    // The same number written differently is a match.
    const ok = await send(ops, { phone: '+91 98765 43210', phone_confirm: '0091-98765-43210', confirm_opt_in: true });
    assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
  });

  await t.test('W17. Signing in or changing the password kills an unused welcome link', async () => {
    const { ops, owner } = await seed();
    await send(ops);
    const token = tokenOf(sends()[0]);
    const login = await request(app).post('/api/auth/login').send({ email: 'ravi@kaveri.test', password: OWNER_PASSWORD });
    assert.strictEqual(login.status, 200, JSON.stringify(login.body));
    let row = await sys(() => Users.findOne({ id: owner.id }).lean());
    assert.ok(!row.reset_token_hash && !row.reset_token_expires_at, 'sign-in cleared the link');
    const reset = await request(app).post('/api/auth/password/reset').send({ token, password: 'Brand-New-Pass-9' });
    assert.strictEqual(reset.status, 410, 'the old welcome link no longer works');

    // A password change does the same (a "Forgot password" link left over).
    await sys(() => Users.updateOne({ id: owner.id }, { $set: { reset_token_hash: sha256('left-over'), reset_token_expires_at: new Date(Date.now() + 3600000) } }));
    const fresh = await sys(() => Users.findOne({ id: owner.id }).lean());
    const change = await request(app).post('/api/auth/change-password').set(bearer(fresh))
      .send({ current: OWNER_PASSWORD, newPassword: 'Changed-Pass-2026' });
    assert.strictEqual(change.status, 200, JSON.stringify(change.body));
    row = await sys(() => Users.findOne({ id: owner.id }).lean());
    assert.ok(!row.reset_token_hash, 'password change cleared the link');
    assert.ok(row.password_claimed_at, 'changing the password counts as taking control');
  });

  await t.test('W18. An owner who set their own password through the link has taken control, even before signing in', async () => {
    const { ops, founder, owner } = await seed();
    await send(ops);
    const ok = await request(app).post('/api/auth/password/reset').send({ token: tokenOf(sends()[0]), password: 'Brand-New-Pass-9' });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    const row = await sys(() => Users.findOne({ id: owner.id }).lean());
    assert.ok(!row.last_login, 'not signed in yet');
    assert.ok(row.password_claimed_at, 'the reset is recorded');
    const view = await preview(ops);
    assert.strictEqual(view.body.owner.signed_in, true);
    assert.strictEqual(view.body.can_send, false);
    const res = await send(ops);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'OWNER_ALREADY_SIGNED_IN');
    assert.strictEqual(sends().length, 1, 'no second link went out');
    assert.strictEqual((await preview(founder)).body.link_valid_minutes, 60, 'the founder gets the short link life');
  });

  await t.test('W19. A pending owner invitation in a workspace that already has users is founder-only', async () => {
    const { ops, founder, owner } = await seed();
    // The owner login record is gone, but another login is still in the workspace.
    await sys(() => Users.updateOne({ id: owner.id }, { $set: { role: 'agent', email: 'agent@kaveri.test' } }));
    await sys(() => Tenants.updateOne({ id: 7 }, { $set: { owner_user_id: null } }));
    await runAsTenant(7, () => Invitations.create({ tenant_id: 7, email: 'ravi@kaveri.test', name: 'Ravi', role: 'owner', token_hash: 'old', expires_at: new Date(Date.now() + 3600000) }));
    const view = await preview(ops);
    assert.strictEqual(view.body.owner.kind, 'invitation');
    assert.strictEqual(view.body.can_send, false);
    const res = await send(ops);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'WORKSPACE_HAS_USERS');
    assert.strictEqual(sends().length, 0);
    const ok = await send(founder);
    assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
    assert.strictEqual(ok.body.link_kind, 'invitation');
    const minutes = (new Date(ok.body.expires_at) - Date.now()) / 60000;
    assert.ok(minutes > 59.5 && minutes <= 60, `short link life (got ${minutes})`);
  });

  await t.test('W20. One-time tokens in URLs are not written to the request log', async () => {
    const morgan = require('morgan');
    const logged = (url) => morgan.url({ originalUrl: url, url });
    assert.strictEqual(logged('/api/auth/invitations/AbC123-xyz_9'), '/api/auth/invitations/[token]');
    assert.strictEqual(logged('/reset-password/AbC123?from=wa'), '/reset-password/[token]?from=wa');
    assert.strictEqual(logged('/invite/AbC123'), '/invite/[token]');
    assert.strictEqual(logged('/api/auth/invitations/accept'), '/api/auth/invitations/accept');
    assert.strictEqual(logged('/api/admin/tenants/7/invitations/12/resend'), '/api/admin/tenants/7/invitations/12/resend');
  });

  await t.test('W21. A never-signed-in owner login in a workspace already in use is founder-only', async () => {
    const { Leads } = require('../models');
    const { ops, founder } = await seed();
    // Another login in the workspace.
    const agent = (await runAsTenant(7, () => Users.create({ role: 'agent', email: 'asha@kaveri.test', name: 'Asha', is_active: true, token_version: 0, password_hash: bcrypt.hashSync('Agent-Pass-1', 4) }))).toObject();
    let view = await preview(ops);
    assert.strictEqual(view.body.can_send, false);
    let res = await send(ops);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'WORKSPACE_HAS_USERS');
    assert.strictEqual(sends().length, 0);
    const ok = await send(founder);
    assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
    const minutes = (new Date(ok.body.expires_at) - Date.now()) / 60000;
    assert.ok(minutes > 59.5 && minutes <= 60, `short link life (got ${minutes})`);

    // No other login, but contacts already exist.
    await sys(() => Users.deleteOne({ id: agent.id }));
    await runAsTenant(7, () => Leads.create({ name: 'A customer', phone: '919800000001' }));
    view = await preview(ops);
    assert.strictEqual(view.body.can_send, false);
    res = await send(ops);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'WORKSPACE_IN_USE');
  });

  await t.test('W22. A sign-in between the check and the link write stops the link (non-founder sends)', async () => {
    const welcome = require('../services/workspaceWelcome');
    const { owner } = await seed();
    const tenant = await sys(() => Tenants.findOne({ id: 7 }).lean());
    const stale = { kind: 'user', id: owner.id, signed_in: false, in_use: null };
    await sys(() => Users.updateOne({ id: owner.id }, { $set: { last_login: new Date() } }));
    await assert.rejects(welcome.issueLink(tenant, stale, { unclaimedOnly: true }), (error) => error.code === 'OWNER_CHANGED');
    let row = await sys(() => Users.findOne({ id: owner.id }).lean());
    assert.ok(!row.reset_token_hash, 'no link was written');
    // The founder path is not conditional.
    await welcome.issueLink(tenant, stale, { unclaimedOnly: false });
    row = await sys(() => Users.findOne({ id: owner.id }).lean());
    assert.ok(row.reset_token_hash);
  });

  await t.test('W23. No audit row, no send; a failed audit after the send still emails the owner and counts', async () => {
    const { ops } = await seed();
    const realCreate = AuditEvents.create;
    try {
      AuditEvents.create = async () => { throw new Error('audit store down'); };
      const res = await send(ops);
      assert.strictEqual(res.status, 500);
      assert.strictEqual(sends().length, 0, 'nothing sent without the audit row');
      const owner = await sys(() => Users.findOne({ email: 'ravi@kaveri.test' }).lean());
      assert.ok(!owner.reset_token_hash, 'no link was created');

      AuditEvents.create = function create(doc, ...rest) {
        if (doc?.meta?.status === 'sent') return Promise.reject(new Error('audit store down'));
        return realCreate.call(this, doc, ...rest);
      };
      const ok = await send(ops);
      assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
      assert.strictEqual(sends().length, 1);
      assert.strictEqual(notify.outbox().filter((m) => m.to === 'ravi@kaveri.test').length, 1, 'the owner was still emailed');
    } finally {
      AuditEvents.create = realCreate;
    }
    const view = await preview(ops);
    assert.strictEqual(view.body.rate.used, 1, 'the attempt counts toward the hourly limit');
  });

  await t.test('W24. If building the message fails after the link was written, the link is cancelled and the failure audited', async () => {
    const inbox = require('../services/platformInbox');
    const { ops } = await seed();
    const realBuild = inbox.buildTemplateMessage;
    try {
      inbox.buildTemplateMessage = () => { throw new Error('template could not be built'); };
      const res = await send(ops);
      assert.strictEqual(res.status, 502, JSON.stringify(res.body));
      assert.strictEqual(res.body.code, 'SEND_FAILED');
      assert.match(res.body.error, /link was cancelled/);
    } finally {
      inbox.buildTemplateMessage = realBuild;
    }
    assert.strictEqual(sends().length, 0);
    const owner = await sys(() => Users.findOne({ email: 'ravi@kaveri.test' }).lean());
    assert.ok(!owner.reset_token_hash, 'the new link was cancelled');
    const failed = await sys(() => AuditEvents.findOne({ event: 'WORKSPACE_LOGIN_LINK_SENT', 'meta.status': 'failed' }).lean());
    assert.ok(failed, 'the failure is audited');
    assert.ok(!failed.meta.revoke_failed);
  });

  await t.test('W25. If the link cannot be cancelled after a failed send, staff are told and the audit row says so', async () => {
    const { ops } = await seed();
    metaFail = true;
    const realUpdate = Users.updateOne;
    try {
      Users.updateOne = function updateOne(filter, update, ...rest) {
        if (filter?.reset_token_hash && update?.$unset?.reset_token_hash !== undefined) return Promise.reject(new Error('database unavailable'));
        return realUpdate.call(this, filter, update, ...rest);
      };
      const res = await send(ops);
      assert.strictEqual(res.status, 502);
      assert.strictEqual(res.body.code, 'SEND_FAILED');
      assert.doesNotMatch(res.body.error, /link was cancelled/);
      assert.match(res.body.error, /could not be cancelled/);
    } finally {
      Users.updateOne = realUpdate;
    }
    const failed = await sys(() => AuditEvents.findOne({ event: 'WORKSPACE_LOGIN_LINK_SENT', 'meta.status': 'failed' }).lean());
    assert.strictEqual(failed.meta.revoke_failed, true);
  });

  await t.test('W12. Provisioning a workspace never sends anything by itself', async () => {
    const { founder } = await seed();
    const res = await request(app).post('/api/admin/tenants').set(bearer(founder)).send({
      business_name: 'Cauvery Foods', owner_name: 'Meena', owner_email: 'meena@cauvery.test', owner_password: 'Meena-Pass-2026',
      alerts_whatsapp: { opt_in: true, number: '919812345678' },
    });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(sends().length, 0);
    assert.strictEqual(await sys(() => AuditEvents.countDocuments({ event: 'WORKSPACE_LOGIN_LINK_SENT' })), 0);
  });
});
