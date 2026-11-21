/**
 * Campaigns page: audience counts, the number's daily limit (shown and
 * enforced), Schedule Later end to end (time zone, scheduler, cancel, edit),
 * the custom list uploader and the live progress endpoint. Meta is stubbed.
 */
const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const xlsx = require('xlsx');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

let app, runDueCampaigns, models, runAsSystem, runAsTenant, encryptToken, consent, schedule, upload;
const realPost = axios.post;
const metaCalls = [];

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  await startTestDb();
  models = require('../models');
  ({ runAsSystem, runAsTenant } = require('../services/tenantContext'));
  ({ encryptToken } = require('../services/clientSecrets'));
  consent = require('../services/consent');
  schedule = require('../services/campaignSchedule');
  upload = require('../services/campaignUpload');
  ({ app, runDueCampaigns } = require('../server'));
  axios.post = async (url, body) => {
    if (!/^https:\/\/graph\.facebook\.com\//.test(url)) throw new Error(`Unexpected URL in test: ${url}`);
    metaCalls.push({ url, body });
    return { data: { messages: [{ id: `wamid.${metaCalls.length}` }] } };
  };
});
test.after(async () => { axios.post = realPost; await stopTestDb(); });
test.beforeEach(async () => { metaCalls.length = 0; await clearCollections(); });

async function seed(tenantId = 1, { timezone = 'Asia/Kolkata' } = {}) {
  await runAsSystem(() => models.Tenants.create({ id: tenantId, name: `Shop ${tenantId}`, status: 'active', timezone }), 'test');
  const owner = (await runAsSystem(() => models.Users.create({
    tenant_id: tenantId, role: 'owner', email: `owner${tenantId}@shop.test`, name: 'Owner', password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
  }), 'test')).toObject();
  return runAsTenant(tenantId, async () => {
    const brand = (await models.Clients.create({
      name: `Brand ${tenantId}`, phone_number_id: `PN${tenantId}`, wa_business_id: `WABA${tenantId}`, whatsapp_number: '+91 90000 00001', whatsapp_status: 'verified', ...encryptToken(`test-dummy-token-${tenantId}`),
    })).toObject();
    const template = (await models.Templates.create({ name: `promo_${tenantId}`, category: 'MARKETING', body: 'Hi {{1}}, new stock is in', status: 'approved', client_id: brand.id, meta_template_id: `T${tenantId}` })).toObject();
    return { tenantId, brand, template, owner, headers: { Authorization: `Bearer ${makeToken(owner)}` }, params: { body: { 1: { source: 'recipient_name' } } } };
  });
}

/** `n` opted-in leads with status `status`. */
async function optedInLeads(s, n, status = 'hot', start = 0) {
  return runAsTenant(s.tenantId, async () => {
    const out = [];
    for (let i = start; i < start + n; i += 1) {
      const lead = (await models.Leads.create({ name: `Lead ${i}`, phone: `9198${String(s.tenantId)}${String(i).padStart(7, '0')}`, client_id: s.brand.id, status })).toObject();
      await consent.recordOptIn({ phone: lead.phone, leadId: lead.id, source: 'shop', text: 'Ticked the offers box' });
      out.push(lead);
    }
    return out;
  });
}

const setUsedToday = (s, used, cap = 250) => runAsTenant(s.tenantId, () => models.WhatsappNumberState.updateOne(
  { phone_number_id: `PN${s.tenantId}` },
  { $set: { day: new Date().toISOString().slice(0, 10), templates_today: used, daily_cap: cap, messaging_limit: 'TIER_1K' }, $setOnInsert: { minute: '', sent_this_minute: 0 } },
  { upsert: true },
));

const book = (rows, type = 'xlsx') => {
  const sheet = xlsx.utils.aoa_to_sheet(rows);
  if (type === 'csv') return Buffer.from(xlsx.utils.sheet_to_csv(sheet));
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, sheet, 'Contacts');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

test('Schedule helpers', async (t) => {
  await t.test('S1. A wall-clock time is read in the workspace time zone', () => {
    const { at } = schedule.parseSchedule('2026-11-21T10:00', 'Asia/Kolkata');
    assert.strictEqual(at.toISOString(), '2026-11-21T04:30:00.000Z');
    assert.strictEqual(schedule.parseSchedule('2026-07-01T09:00', 'America/New_York').at.toISOString(), '2026-07-01T13:00:00.000Z', 'daylight saving is respected');
    assert.strictEqual(schedule.parseSchedule('2026-11-21T04:30:00.000Z', 'Asia/Kolkata').at.toISOString(), '2026-11-21T04:30:00.000Z', 'an absolute time is kept');
    assert.match(schedule.parseSchedule('tomorrow', 'Asia/Kolkata').error, /valid/);
    assert.match(schedule.scheduleProblem(new Date(Date.now() - 3600000)), /passed/);
    assert.strictEqual(schedule.scheduleProblem(new Date(Date.now() + 3600000)), null);
  });

  await t.test('S2. Phone numbers: country code, Excel short form, length', () => {
    assert.deepStrictEqual(upload.normalisePhone('+91 98765 43210'), { phone: '919876543210', addedCountryCode: false });
    assert.deepStrictEqual(upload.normalisePhone('9876543210'), { phone: '919876543210', addedCountryCode: true });
    assert.deepStrictEqual(upload.normalisePhone(919876543210), { phone: '919876543210', addedCountryCode: false });
    assert.match(upload.normalisePhone('').problem, /missing/);
    assert.match(upload.normalisePhone('9.19877E+11').problem, /Excel/);
    assert.match(upload.normalisePhone('12345').problem, /short/);
  });
});

test('Campaigns page API', async (t) => {
  await t.test('P1. Audience counts list only statuses that have contacts, for this workspace only', async () => {
    const s = await seed(1);
    const other = await seed(2);
    await optedInLeads(s, 3, 'hot');
    await optedInLeads(s, 1, 'new', 10);
    await optedInLeads(other, 5, 'cold');
    const res = await request(app).get(`/api/campaigns/audience-counts?client_id=${s.brand.id}`).set(s.headers);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.total, 4);
    assert.deepStrictEqual(res.body.statuses.map((x) => [x.value, x.label, x.count]), [['hot', 'Hot leads', 3], ['new', 'New leads', 1]]);
    const foreign = await request(app).get(`/api/campaigns/audience-counts?client_id=${other.brand.id}`).set(s.headers);
    assert.strictEqual(foreign.status, 404, 'another workspace brand is not visible');
  });

  await t.test('P2. Sending limit: "Today: X of Y used" with the Meta tier', async () => {
    const s = await seed(1);
    await setUsedToday(s, 40, 250);
    const res = await request(app).get(`/api/campaigns/sending-limit?client_id=${s.brand.id}`).set(s.headers);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.connected, true);
    assert.strictEqual(res.body.daily_limit, 250);
    assert.strictEqual(res.body.used_today, 40);
    assert.strictEqual(res.body.remaining_today, 210);
    assert.strictEqual(res.body.messaging_limit, 'TIER_1K');
    assert.strictEqual(res.body.tier_limit, 1000);
    assert.strictEqual(res.body.timezone, 'Asia/Kolkata');
  });

  await t.test('P3. The server refuses a campaign larger than what is left today, unless the rest may go tomorrow', async () => {
    const s = await seed(1);
    await optedInLeads(s, 5, 'hot');
    await setUsedToday(s, 248, 250);
    const body = { name: 'Big', client_id: s.brand.id, template_id: s.template.id, target_status: 'hot', template_parameters: s.params, preview_confirmed: true };
    const preview = (await request(app).post('/api/campaigns/preview').set(s.headers).send(body)).body.preview;
    assert.strictEqual(preview.sending.over_limit, true);
    assert.strictEqual(preview.sending.available_on_send_day, 2);
    assert.strictEqual(preview.sending.overflow, 3);
    const refused = await request(app).post('/api/campaigns').set(s.headers).send(body);
    assert.strictEqual(refused.status, 409, JSON.stringify(refused.body));
    assert.strictEqual(refused.body.code, 'DAILY_LIMIT_EXCEEDED');
    assert.match(refused.body.error, /2 more messages today/);
    assert.strictEqual(await runAsTenant(1, () => models.Campaigns.countDocuments({})), 0, 'nothing was created');
    const later = await request(app).post('/api/campaigns').set(s.headers).send({ ...body, scheduled_at: new Date(Date.now() + 3 * 86400000).toISOString() });
    assert.strictEqual(later.status, 201, 'a later day has the whole daily limit');
    const agreed = await request(app).post('/api/campaigns').set(s.headers).send({ ...body, send_rest_later: true });
    assert.strictEqual(agreed.status, 201, JSON.stringify(agreed.body));
    assert.strictEqual(agreed.body.campaign.send_rest_later, true);
  });

  await t.test('P4. Schedule Later: stored in UTC from IST, refused in the past, run by the scheduler when due', async () => {
    const s = await seed(1);
    await optedInLeads(s, 2, 'hot');
    const base = { name: 'Weekend', client_id: s.brand.id, template_id: s.template.id, target_status: 'hot', template_parameters: s.params, preview_confirmed: true };
    const past = await request(app).post('/api/campaigns').set(s.headers).send({ ...base, scheduled_at: '2020-01-01T10:00' });
    assert.strictEqual(past.status, 400);
    assert.strictEqual(past.body.code, 'SCHEDULE_INVALID');
    // 10:00 in India two days from now, typed as the owner sees it; stored as 04:30 UTC.
    const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const res = await request(app).post('/api/campaigns').set(s.headers).send({ ...base, scheduled_at: `${day}T10:00` });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    const campaign = res.body.campaign;
    assert.strictEqual(new Date(campaign.scheduled_at).toISOString(), `${day}T04:30:00.000Z`);
    assert.strictEqual(campaign.status, 'scheduled');
    assert.strictEqual(campaign.timezone, 'Asia/Kolkata');

    // Not due yet: the scheduler leaves it alone, and Retry cannot send it early.
    assert.deepStrictEqual(await runDueCampaigns(), []);
    const early = await request(app).post(`/api/campaigns/${campaign.id}/retry`).set(s.headers);
    assert.strictEqual(early.status, 409);

    // Due: the scheduler starts it and the messages are queued.
    assert.deepStrictEqual(await runDueCampaigns(new Date(new Date(campaign.scheduled_at).getTime() + 1000)), [campaign.id]);
    const after = await runAsTenant(1, () => models.Campaigns.findOne({ id: campaign.id }).lean());
    assert.strictEqual(after.status, 'running');
    assert.ok(after.launched_at);
    assert.strictEqual(await runAsTenant(1, () => models.CampaignMessageQueue.countDocuments({ campaign_id: campaign.id })), 2);

    const progress = await request(app).get(`/api/campaigns/${campaign.id}/progress`).set(s.headers);
    assert.strictEqual(progress.status, 200);
    assert.deepStrictEqual([progress.body.progress.total, progress.body.progress.queued, progress.body.progress.sent, progress.body.progress.done], [2, 2, 0, false]);
  });

  await t.test('P5. Cancel and edit a scheduled campaign; a cancelled one is never sent', async () => {
    const s = await seed(1);
    await optedInLeads(s, 1, 'hot');
    const when = new Date(Date.now() + 86400000).toISOString();
    const created = (await request(app).post('/api/campaigns').set(s.headers).send({ name: 'A', client_id: s.brand.id, template_id: s.template.id, target_status: 'hot', template_parameters: s.params, preview_confirmed: true, scheduled_at: when })).body.campaign;
    const moved = await request(app).patch(`/api/campaigns/${created.id}`).set(s.headers).send({ name: 'A2', scheduled_at: new Date(Date.now() + 2 * 86400000).toISOString() });
    assert.strictEqual(moved.status, 200, JSON.stringify(moved.body));
    assert.strictEqual(moved.body.campaign.name, 'A2');
    const badMove = await request(app).patch(`/api/campaigns/${created.id}`).set(s.headers).send({ scheduled_at: '2020-01-01T10:00' });
    assert.strictEqual(badMove.status, 400);
    const cancel = await request(app).post(`/api/campaigns/${created.id}/cancel`).set(s.headers);
    assert.strictEqual(cancel.status, 200);
    assert.strictEqual(cancel.body.campaign.status, 'cancelled');
    assert.strictEqual((await request(app).post(`/api/campaigns/${created.id}/cancel`).set(s.headers)).status, 409);
    assert.strictEqual((await request(app).patch(`/api/campaigns/${created.id}`).set(s.headers).send({ name: 'B' })).status, 409);
    assert.deepStrictEqual(await runDueCampaigns(new Date(Date.now() + 5 * 86400000)), []);
    assert.strictEqual(await runAsTenant(1, () => models.CampaignMessageQueue.countDocuments({})), 0);
    const list = await request(app).get('/api/campaigns').set(s.headers);
    assert.strictEqual(list.body.campaigns[0].status, 'cancelled');
    assert.strictEqual(list.body.timezone, 'Asia/Kolkata');
  });

  await t.test('P6. A "send now" campaign that never started is picked up by the scheduler; old stuck ones are not', async () => {
    const s = await seed(1);
    await optedInLeads(s, 1, 'hot');
    const [recent, old] = await runAsTenant(1, async () => [
      (await models.Campaigns.create({ name: 'R', client_id: s.brand.id, template_id: s.template.id, target_status: 'hot', status: 'scheduled', scheduled_at: null, created_at: new Date(Date.now() - 5 * 60000), template_parameters: s.params })).toObject(),
      (await models.Campaigns.create({ name: 'O', client_id: s.brand.id, template_id: s.template.id, target_status: 'hot', status: 'scheduled', scheduled_at: null, created_at: new Date(Date.now() - 3 * 86400000), template_parameters: s.params })).toObject(),
    ]);
    assert.deepStrictEqual(await runDueCampaigns(), [recent.id]);
    assert.strictEqual((await runAsTenant(1, () => models.Campaigns.findOne({ id: old.id }).lean())).status, 'scheduled');
  });

  await t.test('P7. Custom list: row-level check, then saved as an audience; a sheet "yes" never overrides STOP', async () => {
    const s = await seed(1);
    const [stopped] = await optedInLeads(s, 1, 'new', 50);
    await runAsTenant(1, () => consent.recordOptOut({ phone: stopped.phone, leadId: stopped.id, source: 'inbound_keyword', text: 'STOP' }));
    const rows = [
      ['phone', 'name', 'whatsapp_opt_in'],
      ['919811111111', 'Asha', 'yes'],
      ['9822222222', 'Bala', 'yes'],
      ['', 'No Phone', 'yes'],
      ['919811111111', 'Asha again', 'yes'],
      ['12345', 'Short', 'yes'],
      [stopped.phone, 'Stopped', 'yes'],
      ['919833333333', 'Chitra', 'no'],
    ];
    const check = await request(app).post('/api/campaigns/audience/upload').set(s.headers)
      .field('client_id', String(s.brand.id)).attach('file', book(rows), 'contacts.xlsx');
    assert.strictEqual(check.status, 200, JSON.stringify(check.body));
    const sum = check.body.summary;
    assert.deepStrictEqual([sum.ready, sum.skipped_count, sum.added_country_code], [4, 3, 1]);
    assert.deepStrictEqual(sum.skipped.map((x) => [x.row, x.reason.split(' ').slice(0, 2).join(' ')]), [[4, 'phone missing'], [5, 'same phone'], [6, 'phone is']]);
    assert.strictEqual(check.body.batch_id, undefined, 'a check writes nothing');
    assert.strictEqual(await runAsTenant(1, () => models.CampaignImportRecipients.countDocuments({})), 0);

    const saved = await request(app).post('/api/campaigns/audience/upload').set(s.headers)
      .field('client_id', String(s.brand.id)).field('save', 'true').attach('file', book(rows, 'csv'), 'contacts.csv');
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    assert.match(saved.body.batch_id, /^csv_/);
    assert.deepStrictEqual([saved.body.created, saved.body.existing], [3, 1]);
    const stillStopped = await runAsTenant(1, () => consent.getConsent({ phone: stopped.phone }));
    assert.strictEqual(stillStopped.status, 'opted_out');

    const preview = (await request(app).post('/api/campaigns/preview').set(s.headers)
      .send({ name: 'List', client_id: s.brand.id, template_id: s.template.id, target_status: saved.body.batch_id, template_parameters: s.params })).body.preview;
    assert.strictEqual(preview.audience.kind, 'uploaded_list');
    assert.strictEqual(preview.audience.total, 4);
    assert.strictEqual(preview.audience.will_send, 2, 'Asha and Bala opted in; Chitra said no; the STOP stays');
  });

  await t.test('P8. Uploader errors are plain words: wrong type, no phone column, missing template column', async () => {
    const s = await seed(1);
    const send = (buffer, name, extra = {}) => {
      const req = request(app).post('/api/campaigns/audience/upload').set(s.headers).field('client_id', String(s.brand.id));
      for (const [k, v] of Object.entries(extra)) req.field(k, v);
      return req.attach('file', buffer, name);
    };
    const txt = await send(Buffer.from('hello'), 'notes.txt');
    assert.strictEqual(txt.status, 400);
    assert.match(txt.body.error, /\.csv or \.xlsx/);
    const noPhone = await send(book([['name'], ['Asha']]), 'a.xlsx');
    assert.strictEqual(noPhone.status, 400);
    assert.match(noPhone.body.error, /"phone" column/);
    const mappings = JSON.stringify({ body: { 1: { source: 'recipient_name' }, 2: { source: 'excel_parameter' } } });
    const noVar = await send(book([['phone', 'name'], ['919811111111', 'Asha']]), 'a.xlsx', { template_parameters: mappings });
    assert.match(noVar.body.error, /Body \{\{2\}\}/);
    const emptyVar = await send(book([['phone', 'name', 'Body {{2}}'], ['919811111111', 'Asha', ''], ['919822222222', 'Bala', 'Gold']]), 'a.xlsx', { template_parameters: mappings });
    assert.strictEqual(emptyVar.status, 200);
    assert.deepStrictEqual(emptyVar.body.summary.skipped, [{ row: 2, reason: 'Body {{2}} is empty' }]);
    for (const res of [txt, noPhone, noVar]) assert.ok(!/Error|stack|undefined/.test(res.body.error), res.body.error);
  });

  await t.test('P9. The sample file has the exact columns for the template', async () => {
    const s = await seed(1);
    const mappings = encodeURIComponent(JSON.stringify({ body: { 1: { source: 'recipient_name' }, 2: { source: 'excel_parameter' } } }));
    const res = await request(app).get(`/api/campaigns/audience/sample?mappings=${mappings}`).set(s.headers).buffer(true)
      .parse((r, cb) => { const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
    assert.strictEqual(res.status, 200);
    const sheet = xlsx.read(res.body, { type: 'buffer' });
    const grid = xlsx.utils.sheet_to_json(sheet.Sheets.Contacts, { header: 1 });
    assert.deepStrictEqual(grid[0], ['phone', 'name', 'whatsapp_opt_in', 'Body {{2}}']);
    assert.strictEqual(grid[1][0], '919876543210', 'the phone is text, not a number Excel can shorten');
  });
});
