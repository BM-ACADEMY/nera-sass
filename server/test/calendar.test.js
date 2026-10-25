/**
 * Customer panel Calendar: each workspace connects its own Google Calendar
 * through a signed OAuth state, keeps its own booking rules, and only ever
 * sees and books on its own calendar. Google is stubbed.
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { google } = require('googleapis');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

let app;
const inserted = [];
const real = { getToken: google.auth.OAuth2.prototype.getToken, revokeToken: google.auth.OAuth2.prototype.revokeToken, oauth2: google.oauth2, calendar: google.calendar };

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  process.env.GOOGLE_CLIENT_ID = 'test-client';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost/api/auth/google/callback-calender';
  process.env.NERA_APP_URL = 'http://app.test';
  await startTestDb();
  ({ app } = require('../server'));
  // Booking notification emails must never leave the test run (.env is loaded by the server).
  for (const key of ['EMAIL_HOST', 'ALLIANCE_EMAIL_SMTP_HOST']) delete process.env[key];
  google.auth.OAuth2.prototype.getToken = async (code) => ({
    tokens: { refresh_token: `test-refresh-${code}`, scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy' },
  });
  google.auth.OAuth2.prototype.revokeToken = async () => ({});
  google.oauth2 = () => ({ userinfo: { get: async () => ({ data: { email: 'owner@shop.test' } }) } });
  google.calendar = ({ auth }) => ({
    freebusy: { query: async () => ({ data: { calendars: { primary: { busy: [] } } } }) },
    events: {
      list: async () => ({ data: { items: [] } }),
      insert: async ({ requestBody }) => {
        inserted.push({ token: auth.credentials.refresh_token, requestBody });
        return { data: { id: 'EV1', htmlLink: 'https://calendar.test/EV1', hangoutLink: 'https://meet.test/abc', start: requestBody.start, end: requestBody.end } };
      },
    },
  });
});
test.after(async () => {
  Object.assign(google.auth.OAuth2.prototype, { getToken: real.getToken, revokeToken: real.revokeToken });
  Object.assign(google, { oauth2: real.oauth2, calendar: real.calendar });
  await stopTestDb();
});
test.beforeEach(async () => { await clearCollections(); inserted.length = 0; });

test('Customer calendar', async (t) => {
  const { Users, Tenants, Leads, GoogleCalendarCredentials } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const sys = (fn) => runAsSystem(fn, 'test');
  const user = async (tenantId, role) => (await sys(() => Users.create({
    tenant_id: tenantId, role, email: `${role}${tenantId}@shop.test`, name: role, password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
  }))).toObject();
  const bearer = (u) => ({ Authorization: `Bearer ${makeToken(u)}` });
  const seed = async () => {
    await sys(() => Tenants.create([{ id: 1, name: 'Dress Shop', status: 'active' }, { id: 2, name: 'Bakery', status: 'active' }]));
    return { owner: await user(1, 'owner'), agent: await user(1, 'agent'), bakery: await user(2, 'owner') };
  };
  const connect = async (u, code) => {
    const started = await request(app).post('/api/calendar/google/connect').set(bearer(u));
    assert.strictEqual(started.status, 200, JSON.stringify(started.body));
    const state = new URL(started.body.url).searchParams.get('state');
    return request(app).get('/api/auth/google/callback-calender').query({ code, state });
  };

  await t.test('K1. Each workspace connects its own Google account through a signed state', async () => {
    const { owner, bakery } = await seed();
    const done = await connect(owner, 'dress');
    assert.strictEqual(done.status, 302);
    assert.match(done.headers.location, /^http:\/\/app\.test\/calendar\?calendar=connected/);
    await connect(bakery, 'bakery');

    const rows = await sys(() => GoogleCalendarCredentials.find({}).lean());
    assert.deepStrictEqual(rows.map((r) => r.tenant_id).sort(), [1, 2]);
    assert.ok(rows.every((r) => !String(r.refresh_token_encrypted).includes('test-refresh')), 'the token is stored encrypted');

    const status = await request(app).get('/api/calendar/status').set(bearer(owner));
    assert.strictEqual(status.body.connected, true, JSON.stringify(status.body));
    assert.strictEqual(status.body.email, 'owner@shop.test');
  });

  await t.test('K2. A forged or missing state never stores a token', async () => {
    await seed();
    const forged = await request(app).get('/api/auth/google/callback-calender').query({ code: 'x', state: 'not-a-state' });
    assert.strictEqual(forged.status, 302);
    assert.match(forged.headers.location, /calendar=error/);
    assert.strictEqual(await sys(() => GoogleCalendarCredentials.countDocuments({})), 0);
  });

  await t.test('K3. Agents cannot connect or change settings; settings stay per workspace', async () => {
    const { owner, agent, bakery } = await seed();
    assert.strictEqual((await request(app).post('/api/calendar/google/connect').set(bearer(agent))).status, 403);
    assert.strictEqual((await request(app).put('/api/calendar/settings').set(bearer(agent)).send({ booking_enabled: false })).status, 403);

    const saved = await request(app).put('/api/calendar/settings').set(bearer(owner)).send({ work_days: [1, 2, 3], work_start: '09:00', work_end: '17:00', meeting_minutes: 45 });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    assert.deepStrictEqual(saved.body.settings.work_days, [1, 2, 3]);
    const bad = await request(app).put('/api/calendar/settings').set(bearer(owner)).send({ work_start: '18:00', work_end: '09:00' });
    assert.strictEqual(bad.status, 400);

    const other = await request(app).get('/api/calendar/status').set(bearer(bakery));
    assert.deepStrictEqual(other.body.settings.work_days, [1, 2, 3, 4, 5, 6], 'the other workspace keeps its defaults');
    assert.strictEqual(other.body.connected, false);
  });

  await t.test('K4. A booking lands on the workspace\'s own calendar, inside working hours', async () => {
    const { owner, bakery } = await seed();
    await connect(owner, 'dress');
    await connect(bakery, 'bakery');
    await request(app).put('/api/calendar/settings').set(bearer(owner)).send({ work_days: [0, 1, 2, 3, 4, 5, 6], work_start: '00:00', work_end: '23:59' });
    const lead = await runAsTenant(1, () => Leads.create({ name: 'Ravi', phone: '919000000001', email: 'ravi@lead.test' }));

    const tomorrowNoon = new Date(Date.now() + 24 * 60 * 60 * 1000);
    tomorrowNoon.setUTCHours(6, 30, 0, 0); // 12:00 in Asia/Kolkata
    const booked = await request(app).post('/api/leads/book-call').set(bearer(owner)).send({ lead_id: lead.id, booking_time: tomorrowNoon.toISOString() });
    assert.strictEqual(booked.status, 200, JSON.stringify(booked.body));
    assert.strictEqual(booked.body.calendar.meet_link, 'https://meet.test/abc');
    assert.strictEqual(inserted.length, 1);
    assert.strictEqual(inserted[0].token, 'test-refresh-dress', 'booked with this workspace\'s own Google account');

    const meetings = await request(app).get('/api/calendar/meetings').set(bearer(owner));
    assert.deepStrictEqual(meetings.body.upcoming.map((m) => m.name), ['Ravi']);
    const otherMeetings = await request(app).get('/api/calendar/meetings').set(bearer(bakery));
    assert.deepStrictEqual(otherMeetings.body.upcoming, []);
  });

  await t.test('K5. Working hours are checked in the workspace time zone', () => {
    const { withinWorkingHours } = require('../services/googleCalendar');
    const settings = { time_zone: 'Asia/Kolkata', work_days: [1, 2, 3, 4, 5], work_start: '10:00', work_end: '18:00' };
    const at = (iso, minutes = 30) => withinWorkingHours(new Date(iso), new Date(new Date(iso).getTime() + minutes * 60000), settings);
    assert.strictEqual(at('2026-10-26T05:30:00Z'), true, 'Monday 11:00 IST');
    assert.strictEqual(at('2026-10-26T03:30:00Z'), false, 'Monday 09:00 IST is before opening');
    assert.strictEqual(at('2026-10-26T12:00:00Z'), true, 'Monday 17:30–18:00 IST ends at closing');
    assert.strictEqual(at('2026-10-26T12:15:00Z'), false, 'Monday 17:45–18:15 IST runs past closing');
    assert.strictEqual(at('2026-10-25T05:30:00Z'), false, 'Sunday is not a working day');
  });

  await t.test('K6. Without a calendar the panel is told to connect one', async () => {
    const { owner } = await seed();
    const lead = await runAsTenant(1, () => Leads.create({ name: 'Ravi', phone: '919000000001', email: 'ravi@lead.test' }));
    const res = await request(app).post('/api/leads/book-call').set(bearer(owner)).send({ lead_id: lead.id, booking_time: new Date(Date.now() + 86400000).toISOString() });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.code, 'CALENDAR_NOT_CONNECTED');
  });
});
