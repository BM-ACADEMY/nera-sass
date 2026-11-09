/**
 * N4: campaigns, templates and customer alerts. Meta is stubbed; no real call leaves.
 *
 *   A. template library: Meta's rejection reason, edit and resubmit
 *   B. customer alerts: five kinds, email always, WhatsApp only when allowed
 *   C. Notices box and the platform "Needs your attention" list
 *   D. campaign preview, audience by tag, queue still enforces opt-in
 *   E. delivered / read / reply counts
 */
const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

let app;
const metaCalls = [];
const realPost = axios.post;
let models, runAsSystem, runAsTenant, encryptToken, consent, numberHealth, sendQueue, notify, alerts, billingWallet;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  process.env.NERA_META_APP_SECRET = 'test-dummy-webhook-secret';
  process.env.RAZORPAY_WEBHOOK_SECRET = 'test-razorpay-webhook-secret';
  await startTestDb();
  models = require('../models');
  ({ runAsSystem, runAsTenant } = require('../services/tenantContext'));
  ({ encryptToken } = require('../services/clientSecrets'));
  consent = require('../services/consent');
  numberHealth = require('../services/numberHealth');
  sendQueue = require('../services/whatsappSendQueue');
  notify = require('../services/notify');
  alerts = require('../services/alerts');
  billingWallet = require('../services/billing/wallet');
  ({ app } = require('../server'));
  axios.post = async (url, body, options) => {
    if (!/^https:\/\/graph\.facebook\.com\//.test(url)) throw new Error(`Unexpected URL in test: ${url}`);
    metaCalls.push({ url, body, auth: options?.headers?.Authorization });
    return { data: { id: 'T-NEW', messages: [{ id: `wamid.${metaCalls.length}` }] } };
  };
});
test.after(async () => { axios.post = realPost; await stopTestDb(); });
test.beforeEach(async () => {
  metaCalls.length = 0;
  for (const name of ['NERA_ALERT_PHONE_NUMBER_ID', 'NERA_ALERT_ACCESS_TOKEN', 'NERA_ALERT_WABA_ID', 'NERA_ALERT_TEMPLATE_TEMPLATE_REJECTED', 'NERA_ALERT_TEMPLATE_WALLET_LOW']) delete process.env[name];
  await clearCollections();
  notify.outbox().length = 0;
});

const signedWebhook = (payload) => {
  const body = JSON.stringify(payload);
  const signature = 'sha256=' + crypto.createHmac('sha256', process.env.NERA_META_APP_SECRET).update(body).digest('hex');
  return request(app).post('/webhook/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', signature).send(body);
};
const templateStatusHook = (phoneNumberId, change) => signedWebhook({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA1', changes: [{ field: 'message_template_status_update', value: { ...change }, metadata: { phone_number_id: phoneNumberId } },
    { field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phoneNumberId, display_phone_number: '919000000001' } } }] }],
});

async function seed({ tenantId = 1, phoneNumberId = `PN${tenantId}`, waba = `WABA${tenantId}`, createdDaysAgo = 0, alertsWhatsapp = null } = {}) {
  await runAsSystem(() => models.Tenants.create({
    id: tenantId, name: `Shop ${tenantId}`, status: 'active', created_at: new Date(Date.now() - createdDaysAgo * 86400000), ...(alertsWhatsapp ? { alerts_whatsapp: alertsWhatsapp } : {}),
  }), 'test');
  const owner = (await runAsSystem(() => models.Users.create({
    tenant_id: tenantId, role: 'owner', email: `owner${tenantId}@shop.test`, name: 'Owner', password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
  }), 'test')).toObject();
  await runAsSystem(() => models.Tenants.updateOne({ id: tenantId }, { $set: { owner_user_id: owner.id } }), 'test');
  const brand = await runAsTenant(tenantId, async () => (await models.Clients.create({
    name: `Brand ${tenantId}`, phone_number_id: phoneNumberId, wa_business_id: waba, whatsapp_number: '+91 90000 00001', whatsapp_status: 'verified', ...encryptToken(`test-dummy-token-${tenantId}`),
  })).toObject());
  return { tenantId, brand, owner, headers: { Authorization: `Bearer ${makeToken(owner)}` } };
}
const staffHeaders = async () => {
  const staff = (await runAsSystem(() => models.Users.create({
    tenant_id: null, is_platform_staff: true, staff_role: 'founder', role: 'founder', email: 'founder@nera.test', name: 'Founder', password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
  }), 'test')).toObject();
  return { Authorization: `Bearer ${makeToken(staff, { mfa: true })}` };
};
const noticesOf = (tenantId, filter = {}) => runAsTenant(tenantId, () => models.CustomerAlerts.find(filter, { _id: 0 }).lean());
const mailTo = (email) => notify.outbox().filter((m) => m.to === email);

test('A. Template library: rejection reason, edit and resubmit', async (t) => {
  await t.test('A1. Meta rejects a template: reason saved, shown in plain words, notice raised and emailed', async () => {
    const { tenantId, brand, headers } = await seed();
    await runAsTenant(tenantId, () => models.Templates.create({ name: 'promo_one', category: 'MARKETING', body: 'Hi {{1}}', status: 'pending', client_id: brand.id, meta_template_id: 'MT1' }));
    const res = await templateStatusHook('PN1', { event: 'REJECTED', message_template_id: 'MT1', message_template_name: 'promo_one', reason: 'INVALID_FORMAT' });
    assert.strictEqual(res.status, 200);
    const list = await request(app).get('/api/templates').set(headers);
    const row = list.body.templates.find((x) => x.name === 'promo_one');
    assert.strictEqual(row.status, 'rejected');
    assert.strictEqual(row.category, 'MARKETING');
    assert.strictEqual(row.rejection.code, 'INVALID_FORMAT');
    assert.match(row.rejection.message, /format/i);
    assert.ok(row.rejection.fix);
    const notices = await noticesOf(tenantId, { type: 'template_rejected' });
    assert.strictEqual(notices.length, 1);
    assert.strictEqual(notices[0].status, 'open');
    assert.strictEqual(mailTo('owner1@shop.test').length, 1, 'the owner is always emailed');
    // The same webhook again changes nothing and sends no second email.
    await templateStatusHook('PN1', { event: 'REJECTED', message_template_id: 'MT1', message_template_name: 'promo_one', reason: 'INVALID_FORMAT' });
    assert.strictEqual((await noticesOf(tenantId, { type: 'template_rejected' })).length, 1);
    assert.strictEqual(mailTo('owner1@shop.test').length, 1);
  });

  await t.test('A2. Editing a rejected template resubmits it and closes the notice; Meta text is never shown', async () => {
    const { tenantId, brand, headers } = await seed();
    const tpl = await runAsTenant(tenantId, () => models.Templates.create({ name: 'promo_two', category: 'MARKETING', body: 'Hi', status: 'pending', client_id: brand.id, meta_template_id: 'MT2' }));
    await templateStatusHook('PN1', { event: 'REJECTED', message_template_id: 'MT2', message_template_name: 'promo_two', reason: 'SCAM' });
    const res = await request(app).put(`/api/templates/${tpl.id}`).set(headers).send({ body: 'Hi there, our new range is in.' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.template.status, 'pending');
    assert.strictEqual(res.body.template.rejection_reason, null);
    assert.strictEqual(metaCalls.length, 1, 'the edit went to Meta once');
    assert.strictEqual((await noticesOf(tenantId, { status: 'open' })).length, 0);
    // Rejected again with another reason: a new notice, a new email.
    await templateStatusHook('PN1', { event: 'REJECTED', message_template_id: 'MT2', message_template_name: 'promo_two', reason: 'ABUSIVE_CONTENT' });
    assert.strictEqual((await noticesOf(tenantId, { status: 'open' })).length, 1);
    assert.strictEqual(mailTo('owner1@shop.test').length, 2);
  });

  await t.test('A3. An unknown Meta reason shows a generic sentence, never the raw code text', async () => {
    const { explainRejection } = require('../services/templateRejection');
    const unknown = explainRejection('SOMETHING_NEW_FROM_META');
    assert.strictEqual(unknown.code, 'SOMETHING_NEW_FROM_META');
    assert.match(unknown.message, /did not approve/i);
    assert.strictEqual(explainRejection('NONE').code, null);
  });
});

test('B. Customer alerts', async (t) => {
  await t.test('B1. Wallet below 20 percent of the last top-up: notice and email; a top-up closes it', async () => {
    const { tenantId } = await seed();
    await runAsTenant(tenantId, async () => {
      await billingWallet.credit({ amountPaise: 100000, reason: 'topup', referenceType: 'razorpay_payment', referenceId: 'pay_1' });
      await billingWallet.debit({ amountPaise: 50000, reason: 'ai_overage', referenceType: 'ai', referenceId: 'm1' });
      await alerts.evaluateWallet();
      assert.strictEqual((await models.CustomerAlerts.find({ type: 'wallet_low' }).lean()).length, 0, '50% left: no notice');
      await billingWallet.debit({ amountPaise: 35000, reason: 'ai_overage', referenceType: 'ai', referenceId: 'm2' });
      await alerts.evaluateWallet();
      await alerts.evaluateWallet();
      const open = await models.CustomerAlerts.find({ type: 'wallet_low', status: 'open' }).lean();
      assert.strictEqual(open.length, 1);
      assert.match(open[0].message, /15%/);
      await billingWallet.credit({ amountPaise: 100000, reason: 'topup', referenceType: 'razorpay_payment', referenceId: 'pay_2' });
      await alerts.evaluateWallet();
      assert.strictEqual((await models.CustomerAlerts.find({ type: 'wallet_low', status: 'open' }).lean()).length, 0);
    });
    assert.strictEqual(mailTo('owner1@shop.test').length, 1, 'one email, however often it was checked');
  });

  await t.test('B2. Number quality drop: one notice, one email (not two), closed when Meta recovers', async () => {
    const { tenantId } = await seed();
    await runAsTenant(tenantId, () => numberHealth.recordQuality('PN1', { rating: 'RED', event: 'DOWNGRADE' }));
    const open = await noticesOf(tenantId, { type: 'number_quality', status: 'open' });
    assert.strictEqual(open.length, 1);
    assert.strictEqual(open[0].severity, 'critical');
    assert.strictEqual(mailTo('owner1@shop.test').length, 1);
    assert.strictEqual(open[0].email_status, 'sent');
    await runAsTenant(tenantId, () => numberHealth.recordQuality('PN1', { rating: 'GREEN', event: 'UPGRADE' }));
    assert.strictEqual((await noticesOf(tenantId, { type: 'number_quality', status: 'open' })).length, 0);
  });

  await t.test('B3. Setup step unfinished: only after the grace period, listing the open steps', async () => {
    const young = await seed({ tenantId: 1 });
    await alerts.evaluateTenant(young.tenantId);
    assert.strictEqual((await noticesOf(1, { type: 'setup_unfinished' })).length, 0, 'a brand new workspace is not nagged');
    const old = await seed({ tenantId: 2, createdDaysAgo: 3 });
    await alerts.evaluateTenant(old.tenantId);
    const [notice] = await noticesOf(2, { type: 'setup_unfinished', status: 'open' });
    assert.ok(notice);
    assert.deepStrictEqual(notice.details.steps.map((s) => s.step), ['template_approved']);
    await runAsTenant(2, () => models.Templates.create({ name: 'welcome', status: 'approved', body: 'Hi' }));
    await alerts.evaluateTenant(2);
    assert.strictEqual((await noticesOf(2, { type: 'setup_unfinished', status: 'open' })).length, 0);
  });

  await t.test('B4. Payment failed: the tenant comes from our order row, the signed webhook raises it, a top-up closes it', async () => {
    const { tenantId } = await seed();
    await runAsTenant(tenantId, () => models.BillingOrders.create({ purpose: 'wallet_topup', amount_paise: 50000, currency: 'INR', razorpay_order_id: 'order_1', status: 'created' }));
    const event = { event: 'payment.failed', payload: { payment: { entity: { id: 'pay_f1', order_id: 'order_1', amount: 50000, currency: 'INR', notes: { nera_tenant_id: 999 } } } } };
    const body = JSON.stringify(event);
    const unsigned = await request(app).post('/webhook/razorpay/billing').set('Content-Type', 'application/json').send(body);
    assert.ok([401, 200, 503].includes(unsigned.status));
    assert.strictEqual((await noticesOf(tenantId, { type: 'payment_failed' })).length, 0, 'unsigned events do nothing');
    const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
    await request(app).post('/webhook/razorpay/billing').set('Content-Type', 'application/json').set('x-razorpay-signature', signature).send(body);
    const open = await noticesOf(tenantId, { type: 'payment_failed', status: 'open' });
    assert.strictEqual(open.length, 1);
    assert.match(open[0].message, /₹500/);
    assert.strictEqual(await runAsSystem(() => models.CustomerAlerts.countDocuments({ tenant_id: 999 })), 0, 'notes never choose the tenant');
    assert.strictEqual(mailTo('owner1@shop.test').length, 1);
  });

  await t.test('B5. Email is always sent: a failed email is retried; no recipient is recorded, not lost', async () => {
    const { tenantId } = await seed();
    process.env.EMAIL_DELIVERY = 'off'; // nothing is delivered: the notice must say so and try again
    try {
      await runAsTenant(tenantId, () => alerts.paymentFailed({ reference: 'p1', amount: 10 }));
      let [row] = await noticesOf(tenantId, { type: 'payment_failed' });
      assert.strictEqual(row.email_status, 'failed');
      process.env.EMAIL_DELIVERY = 'memory';
      await alerts.evaluateTenant(tenantId);
      [row] = await noticesOf(tenantId, { type: 'payment_failed' });
      assert.strictEqual(row.email_status, 'sent');
      assert.strictEqual(mailTo('owner1@shop.test').length, 1);
    } finally { process.env.EMAIL_DELIVERY = 'memory'; }
    await runAsSystem(() => models.Users.updateMany({ tenant_id: tenantId }, { $set: { email: '' } }));
    await runAsTenant(tenantId, () => alerts.paymentFailed({ reference: 'p2', amount: 10 }));
    const rows = await noticesOf(tenantId, { dedupe_key: 'payment_failed:p2' });
    assert.strictEqual(rows[0].email_status, 'no_recipient');
  });

  await t.test('B6. WhatsApp: only opted-in numbers, only an approved utility template, never free text', async () => {
    const optIn = { opted_in: true, number: '919811112222', opted_in_at: new Date(), source: 'signup', text: 'Send me alerts' };
    Object.assign(process.env, { NERA_ALERT_PHONE_NUMBER_ID: 'PLATFORM1', NERA_ALERT_ACCESS_TOKEN: 'test-dummy-alert-token', NERA_ALERT_WABA_ID: 'PLATFORM_WABA', NERA_ALERT_TEMPLATE_PAYMENT_FAILED: 'nera_payment_failed' });
    const inventory = (status, category) => runAsSystem(async () => {
      await models.MetaWhatsappTemplates.deleteMany({});
      await models.MetaWhatsappTemplates.create({ template_id: 'PT1', waba_id: 'PLATFORM_WABA', name: 'nera_payment_failed', language: 'en', status, category, tenant_id: null });
    }, 'test');
    const fire = (tenantId) => runAsTenant(tenantId, () => alerts.paymentFailed({ reference: `r${Math.random()}`, amount: 1 }));
    const whatsapp = () => metaCalls.filter((c) => /PLATFORM1\/messages/.test(c.url));

    await seed({ tenantId: 1 }); // never opted in
    await inventory('APPROVED', 'UTILITY');
    await fire(1);
    assert.strictEqual(whatsapp().length, 0);
    assert.strictEqual((await noticesOf(1, {}))[0].whatsapp_status, 'not_opted_in');

    await seed({ tenantId: 2, alertsWhatsapp: optIn });
    await inventory('APPROVED', 'MARKETING');
    await fire(2);
    assert.strictEqual(whatsapp().length, 0, 'a marketing template is never used');
    assert.strictEqual((await noticesOf(2, {}))[0].whatsapp_status, 'no_template');
    await inventory('PENDING', 'UTILITY');
    await fire(2);
    assert.strictEqual(whatsapp().length, 0, 'an unapproved template is never used');

    await inventory('APPROVED', 'UTILITY');
    await fire(2);
    assert.strictEqual(whatsapp().length, 1);
    const sent = whatsapp()[0];
    assert.strictEqual(sent.body.type, 'template');
    assert.strictEqual(sent.body.template.name, 'nera_payment_failed');
    assert.strictEqual(sent.body.to, '919811112222');
    assert.strictEqual(sent.auth, 'Bearer test-dummy-alert-token', "platform credentials, not the workspace's");
    assert.ok(mailTo('owner2@shop.test').length >= 1, 'the email still goes too');

    // Opted out later: nothing more is sent.
    await runAsSystem(() => models.Tenants.updateOne({ id: 2 }, { $set: { 'alerts_whatsapp.opted_in': false } }));
    const before = whatsapp().length;
    await fire(2);
    assert.strictEqual(whatsapp().length, before);
  });

  await t.test('B7. WhatsApp alerts can be switched off in the panel but not on; opt-in is taken at signup', async () => {
    const { headers } = await seed({ tenantId: 1, alertsWhatsapp: { opted_in: true, number: '919811112222', opted_in_at: new Date(), source: 'signup' } });
    const prefs = await request(app).get('/api/notices/preferences').set(headers);
    assert.strictEqual(prefs.body.whatsapp.opted_in, true);
    assert.ok(!JSON.stringify(prefs.body).includes('919811112222'), 'the number is masked');
    assert.strictEqual((await request(app).put('/api/notices/preferences').set(headers).send({ whatsapp_opt_in: true })).status, 400);
    assert.strictEqual((await request(app).put('/api/notices/preferences').set(headers).send({ whatsapp_opt_out: true })).status, 200);
    assert.strictEqual((await request(app).get('/api/notices/preferences').set(headers)).body.whatsapp.opted_in, false);
  });

  await t.test('B8. Signup: provisioning stores the alert opt-in only when asked for, with a valid number', async () => {
    const provisioning = require('../services/provisioning');
    const founder = (await runAsSystem(() => models.Users.create({
      tenant_id: null, is_platform_staff: true, staff_role: 'founder', role: 'founder', email: 'f@nera.test', name: 'F', password_hash: 'x', is_active: true, token_version: 0,
    }), 'test')).toObject();
    const base = { business_name: 'Opt Shop', owner_email: 'opt@shop.test', owner_name: 'Opt', owner_password: 'Original-Pass-12!' };
    await assert.rejects(provisioning.provisionTenant({ ...base, alerts_whatsapp: { opt_in: true, number: '123' } }, { actorUserId: founder.id }), /valid WhatsApp number/);
    const made = await provisioning.provisionTenant({ ...base, alerts_whatsapp: { opt_in: true, number: '+91 98111 12222', text: 'Send alerts' } }, { actorUserId: founder.id });
    const tenant = await runAsSystem(() => models.Tenants.findOne({ name: 'Opt Shop' }, { _id: 0 }).lean(), 'test');
    assert.strictEqual(tenant.alerts_whatsapp.opted_in, true);
    assert.strictEqual(tenant.alerts_whatsapp.number, '919811112222');
    assert.strictEqual(tenant.alerts_whatsapp.source, 'signup');
    assert.ok(made);
    const plain = await provisioning.provisionTenant({ ...base, business_name: 'Plain Shop', owner_email: 'plain@shop.test' }, { actorUserId: founder.id });
    assert.ok(plain);
    assert.strictEqual((await runAsSystem(() => models.Tenants.findOne({ name: 'Plain Shop' }, { _id: 0 }).lean(), 'test')).alerts_whatsapp ?? null, null);
  });
});

test('C. Notices box and Needs your attention', async (t) => {
  await t.test('C1. A workspace sees only its own notices; read marks are per notice', async () => {
    const a = await seed({ tenantId: 1 });
    const b = await seed({ tenantId: 2 });
    await runAsTenant(1, () => alerts.paymentFailed({ reference: 'a1', amount: 5 }));
    await runAsTenant(2, () => alerts.paymentFailed({ reference: 'b1', amount: 7 }));
    const mine = await request(app).get('/api/notices').set(a.headers);
    assert.strictEqual(mine.body.notices.length, 1);
    assert.strictEqual(mine.body.unread, 1);
    assert.ok(!JSON.stringify(mine.body).includes('b1'));
    // Another workspace cannot mark this notice read.
    await request(app).post(`/api/notices/${mine.body.notices[0].id}/read`).set(b.headers);
    assert.strictEqual((await request(app).get('/api/notices').set(a.headers)).body.unread, 1);
    await request(app).post(`/api/notices/${mine.body.notices[0].id}/read`).set(a.headers);
    assert.strictEqual((await request(app).get('/api/notices').set(a.headers)).body.unread, 0);
    assert.strictEqual((await request(app).get('/api/notices')).status, 401);
  });

  await t.test('C2. Staff see every workspace\'s problems, worst first; customers cannot', async () => {
    const a = await seed({ tenantId: 1 });
    await seed({ tenantId: 2 });
    await runAsTenant(1, () => alerts.paymentFailed({ reference: 'a1', amount: 5 }));
    await runAsTenant(2, () => numberHealth.recordQuality('PN2', { rating: 'RED', event: 'FLAGGED' }));
    await runAsTenant(2, () => alerts.templateRejected({ id: 'X1', name: 'promo', status: 'REJECTED', reason: 'SCAM' }));
    const staff = await staffHeaders();
    const res = await request(app).get('/api/admin/attention').set(staff);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.total, 3);
    assert.deepStrictEqual(Object.keys(res.body.counts).sort(), ['number_quality', 'payment_failed', 'template_rejected']);
    assert.ok(res.body.items.every((i) => i.workspace.startsWith('Shop')));
    assert.strictEqual(res.body.items[0].severity, 'critical');
    assert.strictEqual(res.body.items.at(-1).type, 'template_rejected');
    assert.ok(!JSON.stringify(res.body).includes('test-dummy-token'));
    const denied = await request(app).get('/api/admin/attention').set(a.headers);
    assert.ok([401, 403].includes(denied.status));
  });
});

// Opted-in contact, opted-out contact, contact who never agreed, contact with a bad number; two carry the tag.
async function seedAudience(tenantId = 1) {
  const ctx = await seed({ tenantId });
  return runAsTenant(tenantId, async () => {
    const mk = (name, phone) => models.Leads.create({ name, phone, client_id: ctx.brand.id, status: 'new' }).then((l) => l.toObject());
    const yes = await mk('Asha', '919800000001');
    const stopped = await mk('Bala', '919800000002');
    const never = await mk('Chitra', '919800000003');
    const bad = await mk('Dev', '12345');
    await consent.recordOptIn({ phone: yes.phone, leadId: yes.id, source: 'shop', text: 'Ticked the offers box' });
    await consent.recordOptIn({ phone: stopped.phone, leadId: stopped.id, source: 'shop', text: 'Ticked the offers box' });
    await consent.recordOptOut({ phone: stopped.phone, leadId: stopped.id, source: 'inbound_keyword', text: 'STOP' });
    const tag = (await models.AllianceInboxTags.create({ name: `vip-${tenantId}` })).toObject();
    for (const lead of [yes, stopped, never, bad]) await models.LeadTags.create({ lead_id: lead.id, tag_id: tag.id });
    const template = (await models.Templates.create({ name: `promo_${tenantId}`, category: 'MARKETING', body: 'Hi {{1}}, new stock is in', status: 'approved', client_id: ctx.brand.id, meta_template_id: `T${tenantId}` })).toObject();
    return { ...ctx, yes, stopped, never, bad, tag, template, params: { body: { 1: { source: 'recipient_name' } } } };
  });
}

test('D. Campaign builder', async (t) => {
  await t.test('D1. Preview by tag: sizes, who is left out and why, example messages; nothing is queued', async () => {
    const s = await seedAudience();
    const res = await request(app).post('/api/campaigns/preview').set(s.headers)
      .send({ name: 'Diwali', client_id: s.brand.id, template_id: s.template.id, target_tag_id: s.tag.id, template_parameters: s.params });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const p = res.body.preview;
    assert.strictEqual(p.can_send, true);
    assert.strictEqual(p.audience.kind, 'tag');
    assert.strictEqual(p.audience.total, 4);
    assert.strictEqual(p.audience.will_send, 1);
    assert.deepStrictEqual(p.audience.left_out, { opted_out: 1, no_consent: 1, invalid_phone: 1 });
    assert.strictEqual(p.sample.length, 1);
    assert.strictEqual(p.sample[0].message, 'Hi Asha, new stock is in');
    assert.ok(!p.sample[0].phone.includes('98000000'), 'numbers are masked');
    assert.strictEqual(p.template.status, 'approved');
    assert.strictEqual(p.schedule.immediate, true);
    assert.strictEqual(await runAsTenant(1, () => models.CampaignMessageQueue.countDocuments({})), 0);
    const tags = await request(app).get('/api/campaigns/tags').set(s.headers);
    assert.deepStrictEqual(tags.body.tags.map((x) => [x.name, x.lead_count]), [['vip-1', 4]]);
  });

  await t.test('D2. Preview blocks what cannot be sent: unapproved template, nobody opted in, paused number', async () => {
    const s = await seedAudience();
    await runAsTenant(1, () => models.Templates.updateOne({ id: s.template.id }, { $set: { status: 'rejected' } }));
    let p = (await request(app).post('/api/campaigns/preview').set(s.headers).send({ client_id: s.brand.id, template_id: s.template.id, target_tag_id: s.tag.id, template_parameters: s.params })).body.preview;
    assert.strictEqual(p.can_send, false);
    assert.match(p.blockers.join(' '), /approved/i);
    await runAsTenant(1, () => models.Templates.updateOne({ id: s.template.id }, { $set: { status: 'approved' } }));
    await runAsTenant(1, () => numberHealth.pauseMarketing('PN1'));
    p = (await request(app).post('/api/campaigns/preview').set(s.headers).send({ client_id: s.brand.id, template_id: s.template.id, target_tag_id: s.tag.id, template_parameters: s.params })).body.preview;
    assert.strictEqual(p.can_send, false);
    assert.match(p.blockers.join(' '), /paused/i);
  });

  await t.test('D3. A campaign cannot be created without the preview step or when the preview says no', async () => {
    const s = await seedAudience();
    const body = { name: 'Diwali', client_id: s.brand.id, template_id: s.template.id, target_tag_id: s.tag.id, template_parameters: s.params, scheduled_at: new Date(Date.now() + 86400000).toISOString() };
    const noPreview = await request(app).post('/api/campaigns').set(s.headers).send(body);
    assert.strictEqual(noPreview.status, 400);
    assert.strictEqual(noPreview.body.code, 'PREVIEW_REQUIRED');
    await runAsTenant(1, () => models.Templates.updateOne({ id: s.template.id }, { $set: { status: 'pending' } }));
    const notReady = await request(app).post('/api/campaigns').set(s.headers).send({ ...body, preview_confirmed: true });
    assert.strictEqual(notReady.status, 400);
    assert.strictEqual(notReady.body.code, 'CAMPAIGN_NOT_READY');
    await runAsTenant(1, () => models.Templates.updateOne({ id: s.template.id }, { $set: { status: 'approved' } }));
    const ok = await request(app).post('/api/campaigns').set(s.headers).send({ ...body, preview_confirmed: true });
    assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
    assert.strictEqual(ok.body.campaign.target_tag_id, s.tag.id);
    assert.strictEqual(ok.body.campaign.status, 'scheduled', 'a future schedule waits');
    assert.strictEqual(await runAsTenant(1, () => models.CampaignMessageQueue.countDocuments({})), 0);
  });

  await t.test('D4. An immediate campaign goes through the queue, and the queue still enforces opt-in', async () => {
    const s = await seedAudience();
    const res = await request(app).post('/api/campaigns').set(s.headers)
      .send({ name: 'Diwali', client_id: s.brand.id, template_id: s.template.id, target_tag_id: s.tag.id, template_parameters: s.params, preview_confirmed: true });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    let rows = [];
    for (let i = 0; i < 30 && rows.length < 4; i += 1) {
      await new Promise((r) => setTimeout(r, 200));
      rows = await runAsTenant(1, () => models.CampaignMessageQueue.find({ campaign_id: res.body.campaign.id }, { _id: 0 }).lean());
    }
    assert.strictEqual(rows.length, 4, 'every tagged lead is queued; consent is decided at send time');
    assert.ok(rows.every((r) => r.kind === 'marketing' && r.source === 'campaign'));
    for (let i = 0; i < 4; i += 1) await sendQueue.processBatch();
    const after = await runAsTenant(1, () => models.CampaignMessageQueue.find({ campaign_id: res.body.campaign.id }, { _id: 0 }).sort({ lead_id: 1 }).lean());
    const byLead = Object.fromEntries(after.map((r) => [r.lead_id, r.status]));
    assert.strictEqual(byLead[s.yes.id], 'sent');
    assert.strictEqual(byLead[s.stopped.id], 'skipped');
    assert.strictEqual(byLead[s.never.id], 'skipped');
    assert.strictEqual(metaCalls.filter((c) => /messages$/.test(c.url)).length, 1, 'exactly one message left the building');
  });

  await t.test('D5. Another workspace\'s tag and leads are never in the audience', async () => {
    const one = await seedAudience(1);
    const two = await seedAudience(2);
    const res = await request(app).post('/api/campaigns/preview').set(two.headers)
      .send({ client_id: two.brand.id, template_id: two.template.id, target_tag_id: one.tag.id, template_parameters: two.params });
    assert.strictEqual(res.body.preview.audience.total, 0);
    const own = (await request(app).get('/api/campaigns/tags').set(two.headers)).body.tags;
    assert.deepStrictEqual(own.map((x) => x.id), [two.tag.id]);
  });
});

test('E. Delivered, read and reply counts', async (t) => {
  await t.test('E1. Receipts only move forward; counts are cumulative; a reply counts once for the latest campaign', async () => {
    const s = await seedAudience();
    const { campaignA, campaignB } = await runAsTenant(1, async () => {
      const mk = (name) => models.Campaigns.create({ name, client_id: s.brand.id, template_id: s.template.id, target_status: 'all', status: 'completed' }).then((c) => c.toObject());
      return { campaignA: await mk('Old'), campaignB: await mk('New') };
    });
    const log = (campaign, leadId, wamid, status, daysAgo = 0) => runAsTenant(1, () => models.CampaignLogs.create({ campaign_id: campaign.id, lead_id: leadId, wa_message_id: wamid, status, sent_at: new Date(Date.now() - daysAgo * 86400000) }));
    await log(campaignA, s.yes.id, 'w.a', 'sent', 2);
    await log(campaignB, s.yes.id, 'w.b', 'sent', 0);
    await log(campaignB, s.stopped.id, 'w.c', 'sent', 0);
    await log(campaignB, s.never.id, 'w.d', 'sent', 0);
    const status = (id, st) => signedWebhook({ object: 'whatsapp_business_account', entry: [{ id: 'WABA1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'PN1', display_phone_number: '919000000001' }, statuses: [{ id, status: st, recipient_id: '919800000001' }] } }] }] });
    await status('w.b', 'delivered');
    await status('w.b', 'read');
    await status('w.b', 'delivered'); // late receipt: must not move it back
    await status('w.c', 'delivered');
    await status('w.d', 'failed');
    const reply = await signedWebhook({ object: 'whatsapp_business_account', entry: [{ id: 'WABA1', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { phone_number_id: 'PN1', display_phone_number: '919000000001' }, contacts: [{ profile: { name: 'Asha' }, wa_id: '919800000001' }],
      messages: [{ from: '919800000001', id: 'wamid.in.1', timestamp: '1700000000', type: 'text', text: { body: 'Interested!' } }] } }] }] });
    assert.strictEqual(reply.status, 200);
    const list = await request(app).get('/api/campaigns').set(s.headers);
    const a = list.body.campaigns.find((c) => c.name === 'Old');
    const b = list.body.campaigns.find((c) => c.name === 'New');
    assert.strictEqual(a.replied_count, 0, 'the old campaign is not credited with the reply');
    assert.deepStrictEqual([b.sent_count, b.delivered_count, b.read_count, b.replied_count, b.failed_count], [2, 2, 1, 1, 1]);
    // A second reply does not count again.
    await runAsTenant(1, () => require('../services/campaignStats').recordReply(s.yes.id));
    assert.strictEqual((await request(app).get('/api/campaigns').set(s.headers)).body.campaigns.find((c) => c.name === 'New').replied_count, 1);
  });
});
