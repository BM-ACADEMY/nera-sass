/**
 * Staff invitation flow, end to end against the real app on an in-memory
 * MongoDB: an Admin (Owner) invites a team member, the email carries an
 * admin-panel link, the person accepts and signs in, and the Admin manages them.
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
  require('../services/notify').clearOutbox();
});

const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user, { mfa: true })}` });

async function createStaff(role, email) {
  const { Users } = require('../models');
  const { runAsSystem } = require('../services/tenantContext');
  return (await runAsSystem(() => Users.create({
    tenant_id: null, is_platform_staff: true, staff_role: role, email, name: role,
    password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
  }))).toObject();
}

test('Staff invitation flow', async (t) => {
  const notify = require('../services/notify');

  await t.test('Admin invites, the email links to the admin panel, the person accepts and signs in', async () => {
    const admin = await createStaff('founder', 'admin@nera.test');
    const invite = await request(app).post('/api/admin/staff/invitations').set(bearer(admin)).send({ name: 'Priya', email: 'Priya@Team.test', staff_role: 'ops' });
    assert.strictEqual(invite.status, 201, JSON.stringify(invite.body));
    assert.strictEqual(invite.body.delivery.delivered, true);

    const mail = notify.outbox().find((m) => m.to === 'priya@team.test');
    assert.ok(mail, 'invitation emailed');
    assert.match(mail.text, /as Staff\./);
    const link = mail.text.match(/(https?:\/\/\S+\/invite\/([A-Za-z0-9_-]+))/);
    assert.ok(link[1].startsWith(notify.adminUrl()), `link goes to the admin panel: ${link[1]}`);
    const token = link[2];

    const listed = await request(app).get('/api/admin/staff').set(bearer(admin));
    assert.strictEqual(listed.body.invitations.length, 1);
    assert.strictEqual(listed.body.invitations[0].invited_by_name, 'founder');

    const preview = await request(app).get(`/api/auth/invitations/${token}`);
    assert.strictEqual(preview.status, 200);
    assert.strictEqual(preview.body.invitation.role, 'ops');

    const accept = await request(app).post('/api/auth/invitations/accept').send({ token, name: 'Priya S', password: 'Team-Member-2026' });
    assert.strictEqual(accept.status, 201, JSON.stringify(accept.body));
    assert.strictEqual((await request(app).post('/api/auth/invitations/accept').send({ token, name: 'Again', password: 'Team-Member-2026' })).status, 410);

    const login = await request(app).post('/api/auth/login').send({ email: 'priya@team.test', password: 'Team-Member-2026' });
    assert.strictEqual(login.status, 200, JSON.stringify(login.body));
    assert.ok(login.body.token);
    const me = await request(app).get('/api/admin/me').set({ Authorization: `Bearer ${login.body.token}` });
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.body.user.staff_role, 'ops');

    const after = await request(app).get('/api/admin/staff').set(bearer(admin));
    assert.strictEqual(after.body.invitations.length, 0);
    assert.strictEqual(after.body.staff.length, 2);
  });

  await t.test('Admin sets the password; after accepting, a second email brings the overview and login details', async () => {
    const admin = await createStaff('founder', 'admin@nera.test');
    const { Invitations } = require('../models');
    const { runAsSystem } = require('../services/tenantContext');

    const weak = await request(app).post('/api/admin/staff/invitations').set(bearer(admin)).send({ name: 'Arun', email: 'arun@team.test', staff_role: 'ops', password: 'short' });
    assert.strictEqual(weak.status, 400);

    const invite = await request(app).post('/api/admin/staff/invitations').set(bearer(admin)).send({ name: 'Arun', email: 'arun@team.test', staff_role: 'ops', password: 'Admin-Chosen-2026' });
    assert.strictEqual(invite.status, 201, JSON.stringify(invite.body));
    assert.ok(!JSON.stringify(invite.body).includes('Admin-Chosen-2026'), 'password never returned');
    const stored = await runAsSystem(() => Invitations.findOne({ email: 'arun@team.test' }).lean());
    assert.ok(stored.password_enc && !stored.password_enc.includes('Admin-Chosen-2026'), 'stored encrypted');

    const inviteMail = notify.outbox().at(-1);
    assert.ok(!inviteMail.text.includes('Admin-Chosen-2026'), 'invitation email has no password');
    assert.match(inviteMail.text, /email you your login details/);
    const token = inviteMail.text.match(/\/invite\/([A-Za-z0-9_-]+)/)[1];

    const preview = await request(app).get(`/api/auth/invitations/${token}`);
    assert.strictEqual(preview.body.invitation.password_preset, true);

    const accept = await request(app).post('/api/auth/invitations/accept').send({ token, name: 'Arun K' });
    assert.strictEqual(accept.status, 201, JSON.stringify(accept.body));
    assert.strictEqual(accept.body.welcome_email_sent, true);

    const welcome = notify.outbox().at(-1);
    assert.strictEqual(welcome.to, 'arun@team.test');
    assert.match(welcome.subject, /Welcome/);
    assert.match(welcome.text, /as Staff/);
    assert.match(welcome.text, /Email: arun@team\.test/);
    assert.match(welcome.text, /Password: Admin-Chosen-2026/);
    assert.match(welcome.text, /\/login/);

    const after = await runAsSystem(() => Invitations.findOne({ email: 'arun@team.test' }).lean());
    assert.ok(!after.password_enc, 'encrypted password erased after accepting');

    const login = await request(app).post('/api/auth/login').send({ email: 'arun@team.test', password: 'Admin-Chosen-2026' });
    assert.strictEqual(login.status, 200, JSON.stringify(login.body));
  });

  await t.test('Resend replaces the link; cancel stops it; Staff cannot invite', async () => {
    const admin = await createStaff('founder', 'admin@nera.test');
    const ops = await createStaff('ops', 'ops@nera.test');
    const invite = await request(app).post('/api/admin/staff/invitations').set(bearer(admin)).send({ email: 'new@team.test', staff_role: 'ops' });
    const firstToken = notify.outbox().at(-1).text.match(/\/invite\/([A-Za-z0-9_-]+)/)[1];

    const resend = await request(app).post(`/api/admin/staff/invitations/${invite.body.invitation.id}/resend`).set(bearer(admin));
    assert.strictEqual(resend.status, 200, JSON.stringify(resend.body));
    const secondToken = notify.outbox().at(-1).text.match(/\/invite\/([A-Za-z0-9_-]+)/)[1];
    assert.notStrictEqual(firstToken, secondToken);
    assert.strictEqual((await request(app).get(`/api/auth/invitations/${firstToken}`)).status, 410, 'old link stops working');

    const cancel = await request(app).delete(`/api/admin/staff/invitations/${invite.body.invitation.id}`).set(bearer(admin));
    assert.strictEqual(cancel.status, 200);
    assert.strictEqual((await request(app).get(`/api/auth/invitations/${secondToken}`)).status, 410);

    assert.strictEqual((await request(app).post('/api/admin/staff/invitations').set(bearer(ops)).send({ email: 'x@team.test', staff_role: 'ops' })).status, 403);
    assert.strictEqual((await request(app).post(`/api/admin/staff/${admin.id}/revoke-sessions`).set(bearer(ops))).status, 403);
  });

  await t.test('Admin signs a team member out, changes the role and deactivates them', async () => {
    const admin = await createStaff('founder', 'admin@nera.test');
    const ops = await createStaff('ops', 'ops@nera.test');
    const opsHeaders = bearer(ops);
    assert.strictEqual((await request(app).get('/api/admin/me').set(opsHeaders)).status, 200);

    assert.strictEqual((await request(app).post(`/api/admin/staff/${ops.id}/revoke-sessions`).set(bearer(admin))).status, 200);
    assert.strictEqual((await request(app).get('/api/admin/me').set(opsHeaders)).status, 401, 'old session ended');

    const role = await request(app).patch(`/api/admin/staff/${ops.id}`).set(bearer(admin)).send({ staff_role: 'founder' });
    assert.strictEqual(role.status, 200);
    assert.strictEqual(role.body.user.staff_role, 'founder');

    assert.strictEqual((await request(app).post(`/api/admin/staff/${ops.id}/deactivate`).set(bearer(admin))).status, 200);
    const login = await request(app).post('/api/auth/login').send({ email: 'ops@nera.test', password: 'Original-Pass-1' });
    assert.notStrictEqual(login.status, 200);

    assert.strictEqual((await request(app).post(`/api/admin/staff/${admin.id}/deactivate`).set(bearer(admin))).status, 400, 'cannot deactivate yourself');
  });
});
