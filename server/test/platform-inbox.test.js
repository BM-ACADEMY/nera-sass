/**
 * Admin WhatsApp Chat: the platform's own number. Real server.js app on an
 * in-memory MongoDB; Meta is stubbed and no request leaves the test.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const axiosModule = require('axios');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

const SECRET = 'test-webhook-secret';
const PLATFORM_PHONE = 'PLATFORM_PHONE_1';
let app;
const metaCalls = [];
const realRequest = axiosModule.Axios.prototype.request;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.NERA_META_APP_SECRET = SECRET;
  process.env.PLATFORM_WA_PHONE_NUMBER_ID = PLATFORM_PHONE;
  process.env.PLATFORM_WA_ACCESS_TOKEN = 'dummy-platform-token';
  process.env.PLATFORM_WA_BUSINESS_ACCOUNT_ID = 'WABA_P'; // ignore the real one in server/.env
  axiosModule.Axios.prototype.request = async function stub(config) {
    const url = String(config.url || '');
    metaCalls.push({ url, data: typeof config.data === 'string' ? JSON.parse(config.data) : config.data, auth: config.headers?.Authorization });
    if (url.startsWith('https://graph.facebook.com/') && url.endsWith('/messages')) {
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
const sign = (raw) => `sha256=${crypto.createHmac('sha256', SECRET).update(raw).digest('hex')}`;

test('Platform WhatsApp inbox', async (t) => {
  const models = require('../models');
  const { Users, Tenants, Clients, Leads, Messages, PlatformWaContacts, PlatformWaMessages, MetaWhatsappPhoneNumbers, MetaWhatsappTemplates } = models;
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const sys = (fn) => runAsSystem(fn, 'test');

  async function seed() {
    await clearCollections();
    metaCalls.length = 0;
    const staff = async (role) => (await sys(() => Users.create({
      tenant_id: null, is_platform_staff: true, staff_role: role, email: `${role}@nera.test`, name: role === 'ops' ? 'Priya' : role,
      password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
    }))).toObject();
    const ops = await staff('ops');
    const support = await staff('support');
    await sys(() => Tenants.create({ id: 5, name: 'Kaveri Motors', status: 'active' }));
    await runAsTenant(5, () => Clients.create({ name: 'Kaveri', whatsapp_number: '91 98765 43210' }));
    const owner = (await runAsTenant(5, () => Users.create({ role: 'owner', email: 'o@kaveri.test', name: 'Owner', is_active: true, token_version: 0 }))).toObject();
    await sys(() => MetaWhatsappPhoneNumbers.create({ phone_number_id: PLATFORM_PHONE, waba_id: 'WABA_P', display_phone_number: '+91 90000 00001', verified_name: 'Getnera' }));
    await sys(() => MetaWhatsappTemplates.create([
      { template_id: 'T1', waba_id: 'WABA_P', name: 'hello_support', language: 'en', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hi, this is Getnera support.' }] },
      { template_id: 'T2', waba_id: 'WABA_P', name: 'needs_value', language: 'en', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hi {{1}}' }] },
      { template_id: 'T3', waba_id: 'WABA_P', name: 'pending_one', language: 'en', status: 'PENDING', components: [{ type: 'BODY', text: 'x' }] },
      { template_id: 'T4', waba_id: 'WABA_P', name: 'hello_world', language: 'en_US', status: 'APPROVED', components: [{ type: 'BODY', text: 'Welcome' }] },
      { template_id: 'T5', waba_id: 'WABA_P', name: 'demo_offer', language: 'en', status: 'APPROVED', components: [
        { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['https://example.test/h.jpg'] } },
        { type: 'BODY', text: 'Hi {{customer_name}}, your demo is on {{demo_date}}.', example: { body_text_named_params: [{ param_name: 'customer_name', example: 'Ravi' }, { param_name: 'demo_date', example: '1 Nov' }] } },
        { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'OK' }, { type: 'URL', text: 'Join', url: 'https://getnera.in/d/{{1}}', example: ['https://getnera.in/d/abc'] }] },
      ], raw_data: { parameter_format: 'NAMED' } },
    ]));
    return { ops, support, owner };
  }

  const inbound = (text, from = '919876543210', minutesAgo = 0) => JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA_P', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: PLATFORM_PHONE },
      contacts: [{ wa_id: from, profile: { name: 'Ravi' } }],
      messages: [{ from, id: `wamid.in.${crypto.randomUUID()}`, timestamp: String(Math.floor((Date.now() - minutesAgo * 60000) / 1000)), type: 'text', text: { body: text } }],
    } }] }],
  });
  const postWebhook = (raw) => request(app).post('/webhook/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign(raw)).send(raw);

  await t.test('I1. A message to the platform number lands in the admin inbox only', async () => {
    const { ops } = await seed();
    const res = await postWebhook(inbound('Hello, I want a demo'));
    assert.strictEqual(res.status, 200);
    const contact = await PlatformWaContacts.findOne({ wa_id: '919876543210' }).lean();
    assert.strictEqual(contact.profile_name, 'Ravi');
    assert.strictEqual(contact.unread_count, 1);
    assert.strictEqual(await PlatformWaMessages.countDocuments({ contact_id: contact.id, direction: 'inbound' }), 1);
    assert.strictEqual(await sys(() => Leads.countDocuments({})), 0, 'no workspace lead');
    assert.strictEqual(await sys(() => Messages.countDocuments({})), 0, 'no workspace message');

    const list = await request(app).get('/api/admin/inbox/conversations').set(bearer(ops));
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.body.conversations[0].name, 'Ravi');
    assert.strictEqual(list.body.conversations[0].window_open, true);
    const detail = await request(app).get(`/api/admin/inbox/conversations/${contact.id}`).set(bearer(ops));
    assert.strictEqual(detail.body.workspaces[0].name, 'Kaveri Motors', 'matched to the workspace by number');
    const status = await request(app).get('/api/admin/inbox/status').set(bearer(ops));
    assert.strictEqual(status.body.configured, true);
    assert.strictEqual(status.body.unread_messages, 1);
  });

  await t.test('I2. Staff reply inside the 24-hour window; the token stays on the server', async () => {
    const { ops } = await seed();
    await postWebhook(inbound('Need help'));
    const contact = await PlatformWaContacts.findOne({}).lean();
    const res = await request(app).post(`/api/admin/inbox/conversations/${contact.id}/messages`).set(bearer(ops)).send({ text: 'Sure, how can I help?' });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body.message.status, 'sent');
    assert.strictEqual(res.body.message.sent_by_name, 'Priya');
    assert.ok(!JSON.stringify(res.body).includes('dummy-platform-token'));
    const call = metaCalls.at(-1);
    assert.ok(call.url.endsWith(`/${PLATFORM_PHONE}/messages`));
    assert.strictEqual(call.auth, 'Bearer dummy-platform-token');
    assert.strictEqual(call.data.to, '919876543210');
    assert.strictEqual(call.data.text.body, 'Sure, how can I help?');

    // Delivery receipts move the status forward.
    const sent = await PlatformWaMessages.findOne({ id: res.body.message.id }).lean();
    const receipt = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
      metadata: { phone_number_id: PLATFORM_PHONE }, statuses: [{ id: sent.wa_message_id, status: 'read' }],
    } }] }] });
    await postWebhook(receipt);
    assert.strictEqual((await PlatformWaMessages.findOne({ id: sent.id }).lean()).status, 'read');
  });

  await t.test('I3. Outside the window only an approved template can be sent', async () => {
    const { ops } = await seed();
    await postWebhook(inbound('Old message', '919876543210', 25 * 60));
    const contact = await PlatformWaContacts.findOne({}).lean();
    const text = await request(app).post(`/api/admin/inbox/conversations/${contact.id}/messages`).set(bearer(ops)).send({ text: 'Hello again' });
    assert.strictEqual(text.status, 409);
    assert.strictEqual(text.body.code, 'WINDOW_CLOSED');
    assert.strictEqual(metaCalls.length, 0, 'nothing sent to Meta');

    const templates = await request(app).get('/api/admin/inbox/templates').set(bearer(ops));
    assert.deepStrictEqual(templates.body.templates.map((x) => x.name), ['demo_offer', 'hello_support', 'needs_value'], 'approved only, no test-only hello_world');
    assert.deepStrictEqual(templates.body.templates.find((x) => x.name === 'needs_value').fields.body, [{ name: '1', sample: '' }]);
    const bad = await request(app).post(`/api/admin/inbox/conversations/${contact.id}/template`).set(bearer(ops)).send({ name: 'needs_value' });
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(bad.body.code, 'TEMPLATE_VALUE_MISSING');
    assert.strictEqual(metaCalls.length, 0, 'a template with missing values never reaches Meta');

    const filled = await request(app).post(`/api/admin/inbox/conversations/${contact.id}/template`).set(bearer(ops)).send({ name: 'needs_value', language: 'en', values: { body: { 1: 'Ravi\nKumar' } } });
    assert.strictEqual(filled.status, 201, JSON.stringify(filled.body));
    assert.deepStrictEqual(metaCalls.at(-1).data.template.components, [{ type: 'body', parameters: [{ type: 'text', text: 'Ravi Kumar' }] }]);
    assert.strictEqual(filled.body.message.text, 'Hi Ravi Kumar');

    const full = await request(app).post(`/api/admin/inbox/conversations/${contact.id}/template`).set(bearer(ops)).send({
      name: 'demo_offer', language: 'en',
      values: { header_media_id: 'MEDIA_1', body: { customer_name: 'Ravi', demo_date: '2 Nov' }, buttons: { 1: 'xyz' } },
    });
    assert.strictEqual(full.status, 201, JSON.stringify(full.body));
    assert.deepStrictEqual(metaCalls.at(-1).data.template.components, [
      { type: 'header', parameters: [{ type: 'image', image: { id: 'MEDIA_1' } }] },
      { type: 'body', parameters: [{ type: 'text', text: 'Ravi', parameter_name: 'customer_name' }, { type: 'text', text: '2 Nov', parameter_name: 'demo_date' }] },
      { type: 'button', sub_type: 'url', index: '1', parameters: [{ type: 'text', text: 'xyz' }] },
    ]);
    assert.strictEqual(full.body.message.text, 'Hi Ravi, your demo is on 2 Nov.');
    const ok = await request(app).post(`/api/admin/inbox/conversations/${contact.id}/template`).set(bearer(ops)).send({ name: 'hello_support', language: 'en' });
    assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
    assert.strictEqual(metaCalls.at(-1).data.template.name, 'hello_support');
  });

  await t.test('I4. A new chat starts with a template; customers, the retired support role and anonymous callers are refused', async () => {
    const { ops, support, owner } = await seed();
    const start = await request(app).post('/api/admin/inbox/conversations').set(bearer(ops)).send({ phone: '+91 91234 56789', name: 'Lead from expo', template_name: 'hello_support', language: 'en' });
    assert.strictEqual(start.status, 201, JSON.stringify(start.body));
    const contact = await PlatformWaContacts.findOne({ id: start.body.contact_id }).lean();
    assert.strictEqual(contact.wa_id, '919123456789');
    assert.strictEqual(contact.name, 'Lead from expo');

    for (const who of [owner, support]) {
      assert.strictEqual((await request(app).get('/api/admin/inbox/conversations').set(bearer(who))).status, 403);
    }
    assert.strictEqual((await request(app).get('/api/admin/inbox/conversations')).status, 401);
  });

  await t.test('I5. The platform number cannot be assigned to a workspace', async () => {
    const { ops } = await seed();
    const brand = await runAsTenant(5, () => Clients.findOne({}).lean());
    const res = await request(app).post(`/api/admin/meta/whatsapp/phone-numbers/${PLATFORM_PHONE}/assign`).set(bearer(ops)).send({ client_id: brand.id });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.code, 'PLATFORM_NUMBER');
  });

  await t.test('I6. Without the platform token, sending is refused and status says what is missing', async () => {
    const { ops } = await seed();
    await postWebhook(inbound('hi'));
    const contact = await PlatformWaContacts.findOne({}).lean();
    const saved = process.env.PLATFORM_WA_ACCESS_TOKEN;
    delete process.env.PLATFORM_WA_ACCESS_TOKEN;
    try {
      const status = await request(app).get('/api/admin/inbox/status').set(bearer(ops));
      assert.deepStrictEqual(status.body.missing, ['PLATFORM_WA_ACCESS_TOKEN']);
      const send = await request(app).post(`/api/admin/inbox/conversations/${contact.id}/messages`).set(bearer(ops)).send({ text: 'x' });
      assert.strictEqual(send.status, 503);
      assert.strictEqual(metaCalls.length, 0);
    } finally {
      process.env.PLATFORM_WA_ACCESS_TOKEN = saved;
    }
  });

  await t.test('I7. Files: photos go as image, anything else as a document, only inside the window', async () => {
    const { ops } = await seed();
    const uploads = [];
    const realFetch = global.fetch;
    global.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.endsWith(`/${PLATFORM_PHONE}/media`)) {
        const file = options.body.get('file');
        uploads.push({ name: file.name, type: file.type, size: file.size });
        return new Response(JSON.stringify({ id: `MEDIA_${uploads.length}` }), { status: 200 });
      }
      if (target.endsWith('/MEDIA_IN_1')) return new Response(JSON.stringify({ url: 'https://lookaside.test/file', mime_type: 'application/pdf' }), { status: 200 });
      if (target === 'https://lookaside.test/file') return new Response(Buffer.from('%PDF-inbound'), { status: 200 });
      throw new Error(`blocked outbound fetch ${target}`);
    };
    try {
      await postWebhook(inbound('send me the brochure'));
      const contact = await PlatformWaContacts.findOne({}).lean();
      const sendFile = (buffer, name, type, fields = {}) => {
        const req = request(app).post(`/api/admin/inbox/conversations/${contact.id}/media`).set(bearer(ops));
        for (const [k, v] of Object.entries(fields)) req.field(k, v);
        return req.attach('file', buffer, { filename: name, contentType: type });
      };

      const photo = await sendFile(Buffer.from('png-bytes'), 'shop.png', 'image/png', { caption: 'Our shop' });
      assert.strictEqual(photo.status, 201, JSON.stringify(photo.body));
      assert.strictEqual(photo.body.message.type, 'image');
      assert.strictEqual(photo.body.message.text, 'Our shop');
      assert.deepStrictEqual(metaCalls.at(-1).data.image, { id: 'MEDIA_1', caption: 'Our shop' });

      const sheet = await sendFile(Buffer.from('xlsx-bytes'), 'Launch_Plan.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      assert.strictEqual(sheet.status, 201, JSON.stringify(sheet.body));
      assert.strictEqual(sheet.body.message.type, 'document');
      assert.strictEqual(sheet.body.message.filename, 'Launch_Plan.xlsx');
      assert.strictEqual(sheet.body.message.file_size, 10);
      assert.deepStrictEqual(metaCalls.at(-1).data.document, { id: 'MEDIA_2', filename: 'Launch_Plan.xlsx' });

      const gif = await sendFile(Buffer.from('gif'), 'fun.gif', 'image/gif');
      assert.strictEqual(gif.body.message.type, 'document', 'Meta takes only jpeg/png as image');
      const preview = await PlatformWaContacts.findOne({ id: contact.id }).lean();
      assert.strictEqual(preview.last_message_preview, '📄 fun.gif');

      // An incoming file is fetched from Meta for the panel.
      const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
        metadata: { phone_number_id: PLATFORM_PHONE }, contacts: [{ wa_id: '919876543210' }],
        messages: [{ from: '919876543210', id: 'wamid.in.doc', timestamp: String(Math.floor(Date.now() / 1000)), type: 'document', document: { id: 'MEDIA_IN_1', filename: 'quote.pdf', mime_type: 'application/pdf' } }],
      } }] }] });
      await postWebhook(raw);
      const list = await request(app).get(`/api/admin/inbox/conversations/${contact.id}/messages`).set(bearer(ops));
      const doc = list.body.messages.find((m) => m.type === 'document' && m.direction === 'inbound');
      assert.strictEqual(doc.filename, 'quote.pdf');
      assert.strictEqual(doc.text, '', 'the [Document] label is not shown as text');
      assert.strictEqual(doc.has_media, true);
      const file = await request(app).get(`/api/admin/inbox/messages/${doc.id}/media`).set(bearer(ops)).buffer(true).parse((res, cb) => {
        const parts = [];
        res.on('data', (c) => parts.push(c));
        res.on('end', () => cb(null, Buffer.concat(parts)));
      });
      assert.strictEqual(file.status, 200);
      assert.strictEqual(file.headers['content-type'], 'application/pdf');
      assert.strictEqual(file.body.toString(), '%PDF-inbound');

      // Outside the window nothing is uploaded.
      await PlatformWaContacts.updateOne({ id: contact.id }, { $set: { last_inbound_at: new Date(Date.now() - 25 * 3600000) } });
      const before = uploads.length;
      const closed = await sendFile(Buffer.from('png'), 'late.png', 'image/png');
      assert.strictEqual(closed.status, 409);
      assert.strictEqual(uploads.length, before);
    } finally {
      global.fetch = realFetch;
    }
  });

  await t.test('I9. Replies, reactions and typing', async () => {
    const { ops } = await seed();
    await postWebhook(inbound('Do you have a demo video? https://getnera.in/demo'));
    const contact = await PlatformWaContacts.findOne({}).lean();
    const first = await PlatformWaMessages.findOne({ contact_id: contact.id }).lean();
    const post = (path, body) => request(app).post(`/api/admin/inbox${path}`).set(bearer(ops)).send(body);

    const reply = await post(`/conversations/${contact.id}/messages`, { text: 'Yes, here it is', reply_to: first.id });
    assert.strictEqual(reply.status, 201, JSON.stringify(reply.body));
    assert.deepStrictEqual(metaCalls.at(-1).data.context, { message_id: first.wa_message_id });
    assert.strictEqual(reply.body.message.reply_to.text, 'Do you have a demo video? https://getnera.in/demo');

    const reacted = await post(`/messages/${first.id}/reaction`, { emoji: '👍' });
    assert.strictEqual(reacted.status, 201, JSON.stringify(reacted.body));
    assert.deepStrictEqual(metaCalls.at(-1).data.reaction, { message_id: first.wa_message_id, emoji: '👍' });

    // The customer reacts to our reply: shown on that message, not as a new one.
    const ours = await PlatformWaMessages.findOne({ id: reply.body.message.id }).lean();
    const count = await PlatformWaMessages.countDocuments({});
    await postWebhook(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
      metadata: { phone_number_id: PLATFORM_PHONE }, contacts: [{ wa_id: '919876543210' }],
      messages: [{ from: '919876543210', id: 'wamid.react', timestamp: String(Math.floor(Date.now() / 1000)), type: 'reaction', reaction: { message_id: ours.wa_message_id, emoji: '❤️' } }],
    } }] }] }));
    assert.strictEqual(await PlatformWaMessages.countDocuments({}), count);
    const list = await request(app).get(`/api/admin/inbox/conversations/${contact.id}/messages`).set(bearer(ops));
    assert.deepStrictEqual(list.body.messages.find((m) => m.id === ours.id).reactions, { customer: '❤️' });
    assert.deepStrictEqual(list.body.messages.find((m) => m.id === first.id).reactions, { staff: '👍' });

    const typing = await post(`/conversations/${contact.id}/typing`, {});
    assert.strictEqual(typing.body.sent, true);
    assert.deepStrictEqual(metaCalls.at(-1).data.typing_indicator, { type: 'text' });
    assert.strictEqual((await post(`/conversations/${contact.id}/typing`, {})).body.sent, false, 'throttled');

    const shared = await request(app).get(`/api/admin/inbox/conversations/${contact.id}/shared`).set(bearer(ops));
    assert.deepStrictEqual(shared.body.links.map((l) => l.url), ['https://getnera.in/demo']);
  });

  await t.test('I10. Assigning chats and labels', async () => {
    const { ops } = await seed();
    await postWebhook(inbound('hello'));
    const contact = await PlatformWaContacts.findOne({}).lean();
    const api = (method, path) => request(app)[method](`/api/admin/inbox${path}`).set(bearer(ops));

    const { staff } = (await api('get', '/staff')).body;
    assert.ok(staff.some((s) => s.id === ops.id), 'ops staff can be assigned');
    const assigned = await api('patch', `/conversations/${contact.id}`).send({ assigned_to: ops.id, labels: ['Hot lead', ' hot  lead ', 'Paid'] });
    assert.strictEqual(assigned.status, 200, JSON.stringify(assigned.body));
    assert.strictEqual(assigned.body.conversation.assigned_name, 'Priya');
    assert.deepStrictEqual(assigned.body.conversation.labels, ['Hot lead', 'Paid'], 'trimmed, same label once');
    assert.strictEqual((await api('patch', `/conversations/${contact.id}`).send({ assigned_to: 99999 })).status, 400);

    assert.strictEqual((await api('get', '/conversations?filter=mine')).body.conversations.length, 1);
    assert.strictEqual((await api('get', '/conversations?filter=unassigned')).body.conversations.length, 0);
    assert.strictEqual((await api('get', '/conversations?label=Paid')).body.conversations.length, 1);
    assert.ok((await api('get', '/labels')).body.labels.includes('Paid'));
  });

  await t.test('I11. Message info times, pin, star, forward and delete', async () => {
    const { ops } = await seed();
    await postWebhook(inbound('first chat', '919876543210'));
    await postWebhook(inbound('second chat', '919800000001'));
    const [a, b] = await PlatformWaContacts.find({}).sort({ id: 1 }).lean();
    const api = (method, path) => request(app)[method](`/api/admin/inbox${path}`).set(bearer(ops));

    const sent = (await api('post', `/conversations/${a.id}/messages`).send({ text: 'Price list attached' })).body.message;
    const wamid = (await PlatformWaMessages.findOne({ id: sent.id }).lean()).wa_message_id;
    const receipt = (status, ts) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
      metadata: { phone_number_id: PLATFORM_PHONE }, statuses: [{ id: wamid, status, timestamp: String(ts) }],
    } }] }] });
    await postWebhook(receipt('read', 1790000060)); // read can arrive before delivered
    await postWebhook(receipt('delivered', 1790000000));
    const info = (await api('get', `/conversations/${a.id}/messages`)).body.messages.find((m) => m.id === sent.id);
    assert.strictEqual(info.status, 'read');
    assert.strictEqual(new Date(info.read_at).getTime(), 1790000060000);
    assert.strictEqual(new Date(info.delivered_at).getTime(), 1790000000000, 'the real delivered time replaces the stand-in');

    const flagged = await api('patch', `/messages/${sent.id}`).send({ pinned: true, starred: true });
    assert.strictEqual(flagged.status, 200, JSON.stringify(flagged.body));
    assert.strictEqual(flagged.body.message.pinned, true);
    assert.strictEqual(flagged.body.message.starred, true);

    const fwd = await api('post', `/messages/${sent.id}/forward`).send({ contact_id: b.id });
    assert.strictEqual(fwd.status, 201, JSON.stringify(fwd.body));
    assert.strictEqual(fwd.body.message.is_forwarded, true);
    assert.strictEqual(metaCalls.at(-1).data.to, '919800000001');
    assert.strictEqual(metaCalls.at(-1).data.text.body, 'Price list attached');

    const del = await api('post', '/messages/delete').send({ ids: [sent.id] });
    assert.deepStrictEqual(del.body, { deleted: 1, files_deleted: 0 });
    assert.strictEqual(await PlatformWaMessages.countDocuments({ id: sent.id }), 0);
    const after = await PlatformWaContacts.findOne({ id: a.id }).lean();
    assert.strictEqual(after.last_message_preview, 'first chat', 'the list shows the newest message left');
    assert.strictEqual((await api('post', '/messages/delete').send({ ids: [] })).status, 400);
  });

  await t.test('I8. Media kinds follow Meta limits', () => {
    const { mediaKind } = require('../services/platformInbox');
    assert.strictEqual(mediaKind('image/jpeg', 1000), 'image');
    assert.strictEqual(mediaKind('image/jpeg', 6 * 1024 * 1024), 'document', 'over 5 MB');
    assert.strictEqual(mediaKind('video/mp4', 10 * 1024 * 1024), 'video');
    assert.strictEqual(mediaKind('video/quicktime', 1000), 'document');
    assert.strictEqual(mediaKind('audio/mpeg', 1000), 'audio');
    assert.strictEqual(mediaKind('audio/ogg; codecs=opus', 1000), 'audio');
    assert.strictEqual(mediaKind('application/zip', 1000), 'document');
  });
});
