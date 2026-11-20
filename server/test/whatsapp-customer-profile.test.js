/**
 * Customer owner/admin edits the WhatsApp Business profile from the WhatsApp
 * Number page (PUT /api/whatsapp/profile, POST /api/whatsapp/profile/photo).
 * Meta is stubbed: every outbound axios call is recorded and answered locally.
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const axiosModule = require('axios');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

let app;
const calls = [];
const realRequest = axiosModule.Axios.prototype.request;
let metaProfile;
let refuseNext = false;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  process.env.META_INVENTORY_ACCESS_TOKEN = 'dummy-inventory-token';
  axiosModule.Axios.prototype.request = async function stub(config) {
    const url = String(config.url || '');
    const method = String(config.method || 'get').toUpperCase();
    calls.push({ method, url, data: config.data, auth: config.headers?.Authorization });
    if (!url.startsWith('https://graph.facebook.com/')) throw new Error(`unexpected outbound call ${url}`);
    if (url.endsWith('/whatsapp_business_profile') && method === 'POST') {
      if (refuseNext) {
        refuseNext = false;
        throw Object.assign(new Error('Request failed'), { response: { status: 400, data: { error: { message: '(#100) Param about is too long', error_user_msg: 'The About text is not allowed.' } } } });
      }
      const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
      metaProfile = { ...metaProfile, ...body };
      return { data: { success: true }, status: 200 };
    }
    if (url.endsWith('/whatsapp_business_profile')) return { data: { data: [metaProfile] }, status: 200 };
    throw new Error(`unstubbed ${url}`);
  };
  await startTestDb();
  ({ app } = require('../server'));
});

test.after(async () => {
  axiosModule.Axios.prototype.request = realRequest;
  await stopTestDb();
});

const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user)}` });

test('Customer WhatsApp business profile', async (t) => {
  const { Users, Tenants, Clients, MetaWhatsappPhoneNumbers, AuditEvents } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const sys = (fn) => runAsSystem(fn, 'test');
  const user = async (tenantId, role) => (await sys(() => Users.create({
    tenant_id: tenantId, role, email: `${role}${tenantId}@shop.test`, name: role, password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
  }))).toObject();

  async function seed({ inventory = true, number = true } = {}) {
    await clearCollections();
    calls.length = 0;
    refuseNext = false;
    metaProfile = { about: 'Old about', description: 'Old description', address: '', email: '', websites: ['https://shop.test'], vertical: 'RETAIL' };
    await sys(() => Tenants.create([{ id: 1, name: 'Shop', status: 'active' }, { id: 2, name: 'Other', status: 'active' }]));
    await runAsTenant(1, () => Clients.create({ name: 'Shop Brand', ...(number ? { phone_number_id: 'P1', wa_business_id: 'W1' } : {}) }));
    await runAsTenant(2, () => Clients.create({ name: 'Other Brand', phone_number_id: 'P2', wa_business_id: 'W2', wa_description: 'Untouched' }));
    if (inventory) {
      await sys(() => MetaWhatsappPhoneNumbers.create([
        { phone_number_id: 'P1', waba_id: 'W1', display_phone_number: '+91 90000 00001' },
        { phone_number_id: 'P2', waba_id: 'W2', display_phone_number: '+91 90000 00002' },
      ]));
    }
    return { owner: await user(1, 'owner'), admin: await user(1, 'admin'), manager: await user(1, 'manager'), agent: await user(1, 'agent') };
  }

  await t.test('C1. Owner saves About, Description, Address and Email to Meta with the server credential', async () => {
    const { owner } = await seed();
    const res = await request(app).put('/api/whatsapp/profile').set(bearer(owner)).send({
      about: 'Open 9 to 6', description: 'Dresses for every occasion', address: '12 Market Road, Chennai', email: 'hello@shop.test',
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/P1/whatsapp_business_profile'));
    assert.ok(post, 'sent to Meta for this workspace\'s number');
    const sent = typeof post.data === 'string' ? JSON.parse(post.data) : post.data;
    assert.deepStrictEqual(Object.keys(sent).sort(), ['about', 'address', 'description', 'email', 'messaging_product']);
    assert.ok(calls.every((c) => c.auth === 'Bearer dummy-inventory-token'));
    assert.ok(!JSON.stringify(res.body).includes('dummy-inventory-token'), 'the token never reaches the browser');
    assert.strictEqual(res.body.profile.about, 'Open 9 to 6');
    assert.deepStrictEqual(res.body.profile.websites, ['https://shop.test'], 'website unchanged');

    const brand = await runAsTenant(1, () => Clients.findOne({}).lean());
    assert.strictEqual(brand.wa_email, 'hello@shop.test');
    assert.strictEqual(brand.wa_address, '12 Market Road, Chennai');
    const cached = await sys(() => MetaWhatsappPhoneNumbers.findOne({ phone_number_id: 'P1' }).lean());
    assert.strictEqual(cached.profile_about, 'Open 9 to 6');
    assert.ok(await sys(() => AuditEvents.exists({ event: 'BRAND_UPDATED', tenant_id: 1 })));
    const other = await runAsTenant(2, () => Clients.findOne({}).lean());
    assert.strictEqual(other.wa_description, 'Untouched', 'another workspace is never touched');
  });

  await t.test('C2. Admin may edit; manager and agent get 403 and nothing reaches Meta', async () => {
    const { admin, manager, agent } = await seed();
    assert.strictEqual((await request(app).put('/api/whatsapp/profile').set(bearer(admin)).send({ address: 'New address' })).status, 200);
    calls.length = 0;
    for (const u of [manager, agent]) {
      const res = await request(app).put('/api/whatsapp/profile').set(bearer(u)).send({ about: 'Nope' });
      assert.strictEqual(res.status, 403, u.role);
      const photo = await request(app).post('/api/whatsapp/profile/photo').set(bearer(u)).attach('photo', Buffer.from('x'), { filename: 'a.png', contentType: 'image/png' });
      assert.strictEqual(photo.status, 403, u.role);
    }
    assert.strictEqual(calls.length, 0);
  });

  await t.test('C3. Meta limits and email format are checked first, with plain-language errors', async () => {
    const { owner } = await seed();
    const cases = [
      [{ about: 'a'.repeat(140) }, /About can be at most 139 characters/],
      [{ description: 'd'.repeat(513) }, /Description can be at most 512 characters/],
      [{ address: 'x'.repeat(257) }, /Address can be at most 256 characters/],
      [{ email: 'not-an-email' }, /valid email address/],
      [{ websites: ['https://evil.test'] }, /Getnera team/],
      [{ vertical: 'OTHER' }, /Getnera team/],
      [{}, /Nothing to save/],
      [{ about: { $gt: '' } }, /About must be text/],
    ];
    for (const [body, message] of cases) {
      const res = await request(app).put('/api/whatsapp/profile').set(bearer(owner)).send(body);
      assert.strictEqual(res.status, 400, JSON.stringify(body));
      assert.match(res.body.error, message, JSON.stringify(body));
    }
    // Exactly at the limits is fine.
    const ok = await request(app).put('/api/whatsapp/profile').set(bearer(owner)).send({ about: 'a'.repeat(139), description: 'd'.repeat(512), address: 'x'.repeat(256) });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(calls.filter((c) => c.method === 'POST').length, 1);
  });

  await t.test('C4. A blank About keeps the current one (Meta does not allow it empty)', async () => {
    const { owner } = await seed();
    const res = await request(app).put('/api/whatsapp/profile').set(bearer(owner)).send({ about: '  ', description: '' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const post = calls.find((c) => c.method === 'POST');
    const sent = typeof post.data === 'string' ? JSON.parse(post.data) : post.data;
    assert.strictEqual(sent.about, undefined);
    assert.strictEqual(sent.description, '');
  });

  await t.test('C5. Meta refusing the change returns a friendly message and leaves the brand unchanged', async () => {
    const { owner } = await seed();
    refuseNext = true;
    const res = await request(app).put('/api/whatsapp/profile').set(bearer(owner)).send({ about: 'Something', email: 'new@shop.test' });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /WhatsApp did not accept this change/);
    assert.doesNotMatch(res.body.error, /#100/, 'no raw Meta error codes');
    const brand = await runAsTenant(1, () => Clients.findOne({}).lean());
    assert.strictEqual(brand.wa_email ?? null, null);
  });

  await t.test('C6. Without a number, or a number outside the platform inventory, nothing is sent to Meta', async () => {
    let { owner } = await seed({ number: false });
    let res = await request(app).put('/api/whatsapp/profile').set(bearer(owner)).send({ about: 'Hi' });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.code, 'WHATSAPP_NOT_CONNECTED');
    ({ owner } = await seed({ inventory: false }));
    res = await request(app).put('/api/whatsapp/profile').set(bearer(owner)).send({ about: 'Hi' });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.code, 'PROFILE_NOT_EDITABLE');
    assert.strictEqual(calls.length, 0);
  });

  await t.test('C7. The overview tells the page who may edit, and never shows the token', async () => {
    const { owner, agent } = await seed();
    const mine = await request(app).get('/api/whatsapp/overview').set(bearer(owner));
    assert.strictEqual(mine.status, 200, JSON.stringify(mine.body));
    assert.strictEqual(mine.body.profile_editable, true);
    const theirs = await request(app).get('/api/whatsapp/overview').set(bearer(agent));
    assert.strictEqual(theirs.body.profile_editable, false);
    assert.ok(!JSON.stringify(mine.body).includes('dummy-inventory-token'));
  });

  await t.test('C8. Photo upload refuses non-images before calling Meta', async () => {
    const { owner } = await seed();
    process.env.META_APP_ID = 'APP1';
    try {
      const res = await request(app).post('/api/whatsapp/profile/photo').set(bearer(owner)).attach('photo', Buffer.from('not an image'), { filename: 'a.png', contentType: 'image/png' });
      assert.strictEqual(res.status, 400);
      assert.match(res.body.error, /JPEG or PNG/);
      const none = await request(app).post('/api/whatsapp/profile/photo').set(bearer(owner));
      assert.strictEqual(none.status, 400);
      assert.strictEqual(calls.length, 0);
    } finally {
      delete process.env.META_APP_ID;
    }
  });
});
