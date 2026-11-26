/**
 * Facebook Lead Ads per workspace (services/facebookLeads.js, routes/facebookLeads.js).
 *  - off unless FACEBOOK_LEADS_ENABLED=true (404)
 *  - webhook needs Meta's X-Hub-Signature-256; the workspace comes from the
 *    stored page id only; unknown Pages are ignored
 *  - leads land only in the connected workspace, once per leadgen_id, merged
 *    by phone inside that workspace
 *  - owner/admin connect Pages through Facebook Login; disconnect unsubscribes
 *    and deletes the Page token
 * In-memory MongoDB; Meta's Graph API is mocked (no real HTTP).
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const axiosModule = require('axios');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

const APP_SECRET = 'test-dummy-facebook-app-secret';
const sign = (raw, secret = APP_SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;

// ── Graph API mock ─────────────────────────────────────────
const calls = [];
const metaLeads = new Map(); // leadgen_id -> lead object
const userPages = []; // what /me/accounts returns
let grantedScopes = ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'];
const realRequest = axiosModule.Axios.prototype.request;

function graphMock(config) {
  const url = new URL(String(config.url));
  const path = url.pathname.replace(/^\/v[\d.]+\//, '');
  const method = String(config.method || 'get').toLowerCase();
  const token = String(config.headers?.Authorization || config.headers?.authorization || '').replace(/^Bearer /, '') || config.params?.access_token || null;
  calls.push({ method, path, token, params: config.params || {} });
  if (url.hostname !== 'graph.facebook.com') throw new Error(`unexpected outbound HTTP to ${url.hostname}`);
  const ok = (data) => ({ data, status: 200, statusText: 'OK', headers: {}, config });
  const metaError = (code, message) => {
    const error = new Error(message);
    error.response = { status: 400, data: { error: { code, message, type: 'OAuthException' } } };
    throw error;
  };
  if (path === 'oauth/access_token') {
    if (config.params.code) return ok({ access_token: `short-${config.params.code}` });
    return ok({ access_token: `long-${config.params.fb_exchange_token}` });
  }
  if (path === 'me/permissions') return ok({ data: grantedScopes.map((permission) => ({ permission, status: 'granted' })) });
  if (path === 'me/accounts') return ok({ data: userPages });
  const sub = path.match(/^(\w+)\/subscribed_apps$/);
  if (sub) return ok({ success: true });
  if (metaLeads.has(path)) return ok({ id: path, ...metaLeads.get(path) });
  return metaError(100, `Unsupported get request. Object with ID '${path}' does not exist`);
}

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  process.env.NERA_APP_URL = 'http://app.test';
  process.env.PUBLIC_API_URL = 'http://api.test';
  await startTestDb();
  axiosModule.Axios.prototype.request = async function mockedRequest(config) { return graphMock(config); };
});
test.after(async () => {
  axiosModule.Axios.prototype.request = realRequest;
  await stopTestDb();
});
test.beforeEach(async () => {
  await clearCollections();
  calls.length = 0;
  metaLeads.clear();
  userPages.length = 0;
  grantedScopes = ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'];
  process.env.FACEBOOK_LEADS_ENABLED = 'true';
  process.env.FACEBOOK_APP_ID = 'test-app-id';
  process.env.FACEBOOK_APP_SECRET = APP_SECRET;
  process.env.FACEBOOK_LEADS_VERIFY_TOKEN = 'test-verify-token';
  delete process.env.FACEBOOK_LOGIN_CONFIG_ID;
  delete process.env.N8N_NEW_LEAD_WEBHOOK_URL;
});

test('Facebook lead forms', async (t) => {
  const { app } = require('../server');
  const facebookLeads = require('../services/facebookLeads');
  const { Users, Tenants, Clients, Leads, FacebookLeadPages, FacebookLeadConnections, AuditEvents } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const { encryptToken } = require('../services/clientSecrets');
  const sys = (fn) => runAsSystem(fn, 'test');

  const user = async (tenantId, role) => (await sys(() => Users.create({
    tenant_id: tenantId, role, email: `${role}${tenantId}@shop.test`, name: role, password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
  }))).toObject();
  const bearer = (u) => ({ Authorization: `Bearer ${makeToken(u)}` });
  const seed = async () => {
    await sys(() => Tenants.create([{ id: 1, name: 'Dress Shop', status: 'active' }, { id: 2, name: 'Bakery', status: 'active' }]));
    await runAsTenant(1, () => Clients.create({ name: 'Dress Shop' }));
    await runAsTenant(2, () => Clients.create({ name: 'Bakery' }));
    return { owner: await user(1, 'owner'), agent: await user(1, 'agent'), bakery: await user(2, 'owner') };
  };
  const connectPage = (tenantId, pageId, token) => runAsTenant(tenantId, () => {
    const enc = encryptToken(token);
    return FacebookLeadPages.create({ page_id: pageId, page_name: `Page ${pageId}`, page_token_enc: enc.wa_access_token_enc, page_token_last4: enc.wa_token_last4, subscribed: true });
  });
  const leadgenBody = (pageId, leadgenId) => ({
    object: 'page',
    entry: [{ id: pageId, time: 1, changes: [{ field: 'leadgen', value: { page_id: pageId, leadgen_id: leadgenId, form_id: 'FORM1', created_time: 1 } }] }],
  });
  const deliver = async (body, { signature } = {}) => {
    const raw = JSON.stringify(body);
    const req = request(app).post('/api/webhooks/facebook-leads').set('Content-Type', 'application/json');
    if (signature !== null) req.set('X-Hub-Signature-256', signature || sign(raw));
    const res = await req.send(raw);
    await facebookLeads.whenIdle();
    return res;
  };
  const metaLead = (overrides = {}) => ({
    created_time: '2026-11-20T10:00:00+0000',
    ad_id: 'AD1', ad_name: 'Diwali offer ad', adset_name: 'Chennai 25-40', campaign_id: 'CMP1', campaign_name: 'Diwali Sale', form_id: 'FORM1', platform: 'fb',
    field_data: [
      { name: 'full_name', values: ['Priya Raman'] },
      { name: 'phone_number', values: ['+91 98765 43210'] },
      { name: 'email', values: ['Priya@Example.com'] },
      { name: 'which_saree_type?', values: ['Silk'] },
    ],
    ...overrides,
  });
  const leadsOf = (tenantId) => runAsTenant(tenantId, () => Leads.find({}, { _id: 0 }).lean());
  const leadFetches = () => calls.filter((c) => c.method === 'get' && /^\d|^LG/.test(c.path));

  await t.test('F1. Feature flag off: every route answers 404', async () => {
    const { owner } = await seed();
    process.env.FACEBOOK_LEADS_ENABLED = 'false';
    assert.strictEqual((await request(app).get('/api/webhooks/facebook-leads').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'test-verify-token', 'hub.challenge': 'x' })).status, 404);
    await connectPage(1, 'PAGE_A', 'page-token-a');
    metaLeads.set('LG1', metaLead());
    assert.strictEqual((await deliver(leadgenBody('PAGE_A', 'LG1'))).status, 404);
    assert.strictEqual((await request(app).get('/api/facebook-leads/status').set(bearer(owner))).status, 404);
    assert.strictEqual((await request(app).post('/api/facebook-leads/connect').set(bearer(owner))).status, 404);
    assert.strictEqual((await request(app).get('/api/facebook-leads/callback').query({ code: 'x', state: 'y' })).status, 404);
    assert.strictEqual((await leadsOf(1)).length, 0);
    assert.strictEqual(calls.length, 0);
    // Unset (the production default) is off too.
    delete process.env.FACEBOOK_LEADS_ENABLED;
    assert.strictEqual((await request(app).get('/api/facebook-leads/status').set(bearer(owner))).status, 404);
    assert.strictEqual((await request(app).post('/api/facebook-leads/connect').set(bearer(owner))).status, 404);
    assert.strictEqual((await deliver(leadgenBody('PAGE_A', 'LG1'))).status, 404);
    assert.strictEqual((await leadsOf(1)).length, 0);
    assert.strictEqual(calls.length, 0);
  });

  await t.test('F2. Webhook verification uses the verify token from env', async () => {
    const ok = await request(app).get('/api/webhooks/facebook-leads').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'test-verify-token', 'hub.challenge': '12345' });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.text, '12345');
    const bad = await request(app).get('/api/webhooks/facebook-leads').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '12345' });
    assert.strictEqual(bad.status, 403);
  });

  await t.test('F3. Missing or invalid signature: 401 and nothing is fetched or saved', async () => {
    await seed();
    await connectPage(1, 'PAGE_A', 'page-token-a');
    metaLeads.set('LG1', metaLead());
    assert.strictEqual((await deliver(leadgenBody('PAGE_A', 'LG1'), { signature: null })).status, 401);
    assert.strictEqual((await deliver(leadgenBody('PAGE_A', 'LG1'), { signature: sign('{}') })).status, 401);
    assert.strictEqual((await deliver(leadgenBody('PAGE_A', 'LG1'), { signature: sign(JSON.stringify(leadgenBody('PAGE_A', 'LG1')), 'other-secret') })).status, 401);
    assert.strictEqual((await deliver(leadgenBody('PAGE_A', 'LG1'), { signature: 'sha256=nothex' })).status, 401);
    assert.strictEqual(calls.length, 0);
    assert.strictEqual((await leadsOf(1)).length, 0);
  });

  await t.test('F4. A lead from a Page no workspace connected is ignored', async () => {
    await seed();
    metaLeads.set('LG1', metaLead());
    const res = await deliver(leadgenBody('PAGE_UNKNOWN', 'LG1'));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(calls.length, 0, 'no Graph call for an unknown page');
    assert.strictEqual(await sys(() => Leads.countDocuments({})), 0);
  });

  await t.test('F5. The lead is saved only to the connected workspace, with the ad details', async () => {
    await seed();
    await connectPage(1, 'PAGE_A', 'page-token-a');
    metaLeads.set('LG1', metaLead());
    const res = await deliver(leadgenBody('PAGE_A', 'LG1'));
    assert.strictEqual(res.status, 200);

    const fetches = leadFetches();
    assert.strictEqual(fetches.length, 1);
    assert.strictEqual(fetches[0].token, 'page-token-a', 'fetched with the Page token of that workspace');
    assert.match(fetches[0].params.fields, /field_data/);
    assert.match(fetches[0].params.fields, /campaign_name/);
    assert.ok(fetches[0].params.appsecret_proof, 'calls carry appsecret_proof');

    const [lead] = await leadsOf(1);
    assert.strictEqual(lead.name, 'Priya Raman');
    assert.strictEqual(lead.phone, '919876543210');
    assert.strictEqual(lead.email, 'priya@example.com');
    assert.strictEqual(lead.source, 'facebook');
    assert.strictEqual(lead.leadgen_id, 'LG1');
    assert.strictEqual(lead.campaign_name, 'Diwali Sale');
    assert.strictEqual(lead.ad_name, 'Diwali offer ad');
    assert.strictEqual(lead.adset_name, 'Chennai 25-40');
    assert.strictEqual(lead.lead_ad_form_id, 'FORM1');
    assert.match(lead.notes, /which saree type\?: Silk/);
    assert.deepStrictEqual(lead.lead_form_answers, [{ question: 'which_saree_type?', answer: 'Silk' }]);
    assert.strictEqual(lead.tenant_id, 1);
    assert.strictEqual((await leadsOf(2)).length, 0, 'the other workspace gets nothing');

    const page = await runAsTenant(1, () => FacebookLeadPages.findOne({ page_id: 'PAGE_A' }).lean());
    assert.ok(page.last_lead_at);
    assert.strictEqual(page.leads_received, 1);
    const events = await sys(() => AuditEvents.find({ event: 'FACEBOOK_LEAD_RECEIVED' }).lean());
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].tenant_id, 1);
    assert.strictEqual(events[0].meta.leadgen_id, 'LG1');
  });

  await t.test('F6. Two workspaces stay isolated; Instagram leads are marked instagram', async () => {
    const { owner, bakery } = await seed();
    await connectPage(1, 'PAGE_A', 'page-token-a');
    await connectPage(2, 'PAGE_B', 'page-token-b');
    metaLeads.set('LG_A', metaLead());
    metaLeads.set('LG_B', metaLead({ platform: 'ig', field_data: [{ name: 'full_name', values: ['Karthik'] }, { name: 'phone_number', values: ['+919000000002'] }] }));
    await deliver(leadgenBody('PAGE_A', 'LG_A'));
    await deliver(leadgenBody('PAGE_B', 'LG_B'));

    const a = await leadsOf(1);
    const b = await leadsOf(2);
    assert.deepStrictEqual(a.map((l) => l.leadgen_id), ['LG_A']);
    assert.deepStrictEqual(b.map((l) => l.leadgen_id), ['LG_B']);
    assert.strictEqual(b[0].source, 'instagram');
    const tokens = Object.fromEntries(leadFetches().map((c) => [c.path, c.token]));
    assert.deepStrictEqual(tokens, { LG_A: 'page-token-a', LG_B: 'page-token-b' });

    const statusA = await request(app).get('/api/facebook-leads/status').set(bearer(owner));
    const statusB = await request(app).get('/api/facebook-leads/status').set(bearer(bakery));
    assert.deepStrictEqual(statusA.body.pages.map((p) => p.page_id), ['PAGE_A']);
    assert.deepStrictEqual(statusB.body.pages.map((p) => p.page_id), ['PAGE_B']);
    assert.ok(!JSON.stringify(statusA.body).includes('page_token'), 'status never exposes a token');
  });

  await t.test('F7. A duplicate leadgen_id is ignored', async () => {
    await seed();
    await connectPage(1, 'PAGE_A', 'page-token-a');
    metaLeads.set('LG1', metaLead());
    await deliver(leadgenBody('PAGE_A', 'LG1'));
    await deliver(leadgenBody('PAGE_A', 'LG1'));
    // Two changes for the same lead in one delivery as well.
    const body = leadgenBody('PAGE_A', 'LG1');
    body.entry[0].changes.push(body.entry[0].changes[0]);
    await deliver(body);
    assert.strictEqual((await leadsOf(1)).length, 1);
    assert.strictEqual(leadFetches().length, 1, 'Meta is asked for the lead once');
    const page = await runAsTenant(1, () => FacebookLeadPages.findOne({ page_id: 'PAGE_A' }).lean());
    assert.strictEqual(page.leads_received, 1);
  });

  await t.test('F8. Same phone in the workspace: merged into the existing contact, not duplicated', async () => {
    await seed();
    await connectPage(1, 'PAGE_A', 'page-token-a');
    await connectPage(2, 'PAGE_B', 'page-token-b');
    await runAsTenant(1, () => Leads.create({ name: 'Priya', phone: '9876543210', source: 'WhatsApp', notes: 'Asked about silk' }));
    await runAsTenant(2, () => Leads.create({ name: 'Other shop contact', phone: '919000000009', source: 'Manual' }));
    metaLeads.set('LG1', metaLead());
    metaLeads.set('LG2', metaLead({ field_data: [{ name: 'full_name', values: ['Priya R'] }, { name: 'phone_number', values: ['+919876543210'] }] }));
    await deliver(leadgenBody('PAGE_A', 'LG1'));

    const a = await leadsOf(1);
    assert.strictEqual(a.length, 1, 'no second contact for the same phone');
    assert.strictEqual(a[0].name, 'Priya', 'existing name kept');
    assert.strictEqual(a[0].source, 'WhatsApp', 'first source kept');
    assert.strictEqual(a[0].leadgen_id, 'LG1');
    assert.strictEqual(a[0].campaign_name, 'Diwali Sale');
    assert.strictEqual(a[0].email, 'priya@example.com');
    assert.match(a[0].notes, /Asked about silk[\s\S]*Silk/);

    // The same phone in another workspace is a different contact there.
    await deliver(leadgenBody('PAGE_B', 'LG2'));
    const b = await leadsOf(2);
    assert.strictEqual(b.length, 2);
    assert.ok(b.some((l) => l.phone === '919876543210' && l.source === 'facebook'));
    assert.strictEqual((await leadsOf(1)).length, 1);
  });

  await t.test('F9. Owner connects Pages through Facebook Login; agents cannot', async () => {
    const { owner, agent, bakery } = await seed();
    assert.strictEqual((await request(app).post('/api/facebook-leads/connect').set(bearer(agent))).status, 403);
    assert.strictEqual((await request(app).post('/api/facebook-leads/pages').set(bearer(agent)).send({ page_ids: ['PAGE_A'] })).status, 403);

    const started = await request(app).post('/api/facebook-leads/connect').set(bearer(owner));
    assert.strictEqual(started.status, 200, JSON.stringify(started.body));
    const dialog = new URL(started.body.url);
    assert.strictEqual(dialog.hostname, 'www.facebook.com');
    assert.strictEqual(dialog.searchParams.get('client_id'), 'test-app-id');
    assert.strictEqual(dialog.searchParams.get('scope'), 'pages_show_list,pages_read_engagement,pages_manage_metadata,leads_retrieval');
    const state = dialog.searchParams.get('state');

    // A forged state never stores anything.
    const forged = await request(app).get('/api/facebook-leads/callback').query({ code: 'c', state: 'forged' });
    assert.strictEqual(forged.status, 302);
    assert.match(forged.headers.location, /facebook=error/);

    userPages.push({ id: 'PAGE_A', name: 'Dress Shop Page', access_token: 'page-token-a' }, { id: 'PAGE_X', name: 'Side Page', access_token: 'page-token-x' });
    const back = await request(app).get('/api/facebook-leads/callback').query({ code: 'abc', state });
    assert.strictEqual(back.status, 302);
    assert.match(back.headers.location, /^http:\/\/app\.test\/settings\/integrations\?facebook=choose/);
    const pending = await runAsTenant(1, () => FacebookLeadConnections.findOne({}).lean());
    assert.ok(pending.user_token_enc && !pending.user_token_enc.includes('long-short-abc'), 'user token stored encrypted');

    const status = await request(app).get('/api/facebook-leads/status').set(bearer(owner));
    assert.deepStrictEqual(status.body.pending.pages.map((p) => p.name), ['Dress Shop Page', 'Side Page']);
    assert.strictEqual(status.body.can_manage, true);

    const chosen = await request(app).post('/api/facebook-leads/pages').set(bearer(owner)).send({ page_ids: ['PAGE_A'] });
    assert.strictEqual(chosen.status, 200, JSON.stringify(chosen.body));
    assert.deepStrictEqual(chosen.body.connected, ['PAGE_A']);
    const subscribe = calls.find((c) => c.method === 'post' && c.path === 'PAGE_A/subscribed_apps');
    assert.ok(subscribe, 'app subscribed to the page');
    assert.strictEqual(subscribe.token, 'page-token-a');
    assert.strictEqual(subscribe.params.subscribed_fields, 'leadgen');
    const stored = await runAsTenant(1, () => FacebookLeadPages.findOne({ page_id: 'PAGE_A' }).lean());
    assert.ok(stored.page_token_enc && !stored.page_token_enc.includes('page-token-a'), 'page token stored encrypted');
    assert.strictEqual(await runAsTenant(1, () => FacebookLeadConnections.countDocuments({})), 0, 'user token dropped after choosing');
    assert.ok(await sys(() => AuditEvents.exists({ event: 'FACEBOOK_PAGE_CONNECTED', tenant_id: 1 })));

    // The same Page cannot feed a second workspace.
    const startB = await request(app).post('/api/facebook-leads/connect').set(bearer(bakery));
    const stateB = new URL(startB.body.url).searchParams.get('state');
    await request(app).get('/api/facebook-leads/callback').query({ code: 'b', state: stateB });
    const taken = await request(app).post('/api/facebook-leads/pages').set(bearer(bakery)).send({ page_ids: ['PAGE_A'] });
    assert.strictEqual(taken.status, 400);
    assert.match(taken.body.error, /another Getnera workspace/);
    assert.strictEqual(await runAsTenant(2, () => FacebookLeadPages.countDocuments({})), 0);
  });

  await t.test('F10. Missing permissions are explained in plain English', async () => {
    const { owner } = await seed();
    grantedScopes = ['pages_show_list'];
    userPages.push({ id: 'PAGE_A', name: 'Dress Shop Page', access_token: 'page-token-a' });
    const started = await request(app).post('/api/facebook-leads/connect').set(bearer(owner));
    const state = new URL(started.body.url).searchParams.get('state');
    const back = await request(app).get('/api/facebook-leads/callback').query({ code: 'abc', state });
    assert.match(decodeURIComponent(back.headers.location.replace(/\+/g, ' ')), /permissions were switched off \(.*leads_retrieval/);
    assert.strictEqual(await runAsTenant(1, () => FacebookLeadConnections.countDocuments({})), 0);
  });

  await t.test('F11. Disconnect unsubscribes the Page and deletes its token', async () => {
    const { owner, agent } = await seed();
    await connectPage(1, 'PAGE_A', 'page-token-a');
    assert.strictEqual((await request(app).delete('/api/facebook-leads/pages/PAGE_A').set(bearer(agent))).status, 403);

    const res = await request(app).delete('/api/facebook-leads/pages/PAGE_A').set(bearer(owner));
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const unsubscribe = calls.find((c) => c.method === 'delete' && c.path === 'PAGE_A/subscribed_apps');
    assert.ok(unsubscribe);
    assert.strictEqual(unsubscribe.token, 'page-token-a');
    assert.strictEqual(await sys(() => FacebookLeadPages.countDocuments({})), 0, 'token removed');
    assert.ok(await sys(() => AuditEvents.exists({ event: 'FACEBOOK_PAGE_DISCONNECTED', tenant_id: 1 })));

    // Leads from that Page are no longer accepted for the workspace.
    metaLeads.set('LG1', metaLead());
    calls.length = 0;
    await deliver(leadgenBody('PAGE_A', 'LG1'));
    assert.strictEqual(calls.length, 0);
    assert.strictEqual((await leadsOf(1)).length, 0);
  });

  await t.test('F12. A Graph error is stored on the Page in plain English and the lead can be retried', async () => {
    const { owner } = await seed();
    await connectPage(1, 'PAGE_A', 'page-token-a');
    await deliver(leadgenBody('PAGE_A', 'LG_MISSING'));
    const status = await request(app).get('/api/facebook-leads/status').set(bearer(owner));
    assert.strictEqual(status.body.pages[0].status, 'error');
    assert.match(status.body.pages[0].last_error, /could not be downloaded/);
    metaLeads.set('LG_MISSING', metaLead());
    await deliver(leadgenBody('PAGE_A', 'LG_MISSING'));
    assert.strictEqual((await leadsOf(1)).length, 1, 'a redelivery after a failure is processed');
  });
});
