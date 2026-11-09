/**
 * N2 (clinics and education): language, token cost, the booking rules, the
 * booking conversation and the prompt. No database and no network: the flow
 * runs against an in-memory store, so this file runs anywhere.
 */
const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';
const rules = require('../services/appointmentRules');
const flow = require('../services/appointmentFlow');
const { say, formatWhen } = require('../services/appointmentText');
const { detectLanguage, systemLanguage } = require('../services/replyLanguage');
const { costOf, normaliseUsage } = require('../services/aiCost');
const prompts = require('../services/brainPrompt');
const engine = require('../services/brainEngine');

const PROFILE = prompts.cleanProfile({
  business_name: 'Sunrise Dental',
  business_description: 'Family dental clinic',
  business_hours: { days: [1, 2, 3, 4, 5], open: '09:00', close: '17:00' },
  timezone: 'Asia/Kolkata',
  products_and_services: ['Cleaning - Rs 500', 'Braces'],
  languages: ['English', 'Tamil'],
  industry: 'clinic',
  booking_mode: 'appointments',
  appointment_minutes: 30,
  appointment_capacity: 1,
});
const SETTINGS = rules.settingsFromProfile(PROFILE);
// Monday 9 Nov 2026, 10:00 in Kolkata.
const NOW = new Date('2026-11-09T04:30:00Z');
const at = (local) => rules.localToDate(local, 'Asia/Kolkata');

/** In-memory stand-in for services/appointments.js. */
function memoryStore() {
  const rows = [];
  const reminders = [];
  let nextId = 1;
  return {
    rows,
    reminders,
    busyBetween: async (from, to) => rows.filter((r) => r.status === 'confirmed' && r.start_at < to && r.end_at > from),
    upcomingAt: async (leadId, start) => rows.find((r) => r.lead_id === leadId && r.status === 'confirmed' && Math.abs(r.start_at - start) < 60000) || null,
    book: async ({ lead, name, service, start, end, language, settings }) => {
      for (const key of rules.slotKeys(start, settings.capacity)) {
        if (rows.some((r) => r.slot_key === key)) continue;
        const row = { id: nextId++, lead_id: lead.id, customer_name: name, service, start_at: start, end_at: end, status: 'confirmed', slot_key: key, language };
        rows.push(row);
        return { ok: true, appointment: row };
      }
      return { ok: false, reason: 'taken' };
    },
    cancelUpcoming: async (leadId) => {
      const row = rows.find((r) => r.lead_id === leadId && r.status === 'confirmed' && r.start_at > NOW);
      if (!row) return null;
      Object.assign(row, { status: 'cancelled', slot_key: null });
      return row;
    },
    scheduleReminder: async (appointment) => { reminders.push(appointment.id); return { status: 'queued' }; },
  };
}

// One customer message through the flow; `lead` carries the saved draft between turns.
async function turn(store, lead, proposal, { lang = 'en', now = NOW } = {}) {
  const out = await flow.advance({ lead, proposal: flow.cleanProposal(proposal), lang, settings: SETTINGS, store, now });
  if (out.draft === null) delete lead.booking_draft;
  else if (out.draft) lead.booking_draft = out.draft;
  return out;
}

test('language: English, Tamil script and Tanglish', () => {
  assert.deepStrictEqual(detectLanguage('Do you have a slot tomorrow?'), { code: 'en', script: 'latin', tanglish: false });
  assert.strictEqual(detectLanguage('நாளை நேரம் இருக்கிறதா?').code, 'ta');
  assert.strictEqual(detectLanguage('unga budget evlo?').tanglish, true);
  assert.strictEqual(systemLanguage('வணக்கம்'), 'ta');
  assert.strictEqual(systemLanguage('vanakkam'), 'en'); // fixed sentences stay readable
  assert.strictEqual(systemLanguage(''), 'en');
});

test('cost: tokens become an estimated cost, unknown usage is never a made-up zero', () => {
  const saved = { ...process.env };
  try {
    delete process.env.AI_PRICE_INPUT_USD_PER_MTOK;
    delete process.env.AI_PRICE_OUTPUT_USD_PER_MTOK;
    assert.deepStrictEqual(costOf({ prompt_tokens: 1000, completion_tokens: 200 }), {
      prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost_usd: 0.00027, cost_basis: 'estimated',
    });
    process.env.AI_PRICE_INPUT_USD_PER_MTOK = '1';
    process.env.AI_PRICE_OUTPUT_USD_PER_MTOK = '2';
    assert.strictEqual(costOf({ prompt_tokens: 1_000_000, completion_tokens: 500_000 }).cost_usd, 2);
    assert.deepStrictEqual(normaliseUsage({ promptTokenCount: 7, candidatesTokenCount: 3 }), { prompt_tokens: 7, completion_tokens: 3 });
    const unknown = costOf(null);
    assert.strictEqual(unknown.cost_usd, null);
    assert.strictEqual(unknown.cost_basis, 'unknown');
    assert.strictEqual(costOf({}).cost_usd, null);
  } finally {
    process.env = saved;
  }
});

test('rules: services, hours and free slots', () => {
  assert.deepStrictEqual(SETTINGS.services, ['Cleaning', 'Braces']);
  assert.strictEqual(rules.matchService('cleaning', SETTINGS.services), 'Cleaning');
  assert.strictEqual(rules.matchService('teeth cleaning please', SETTINGS.services), 'Cleaning');
  assert.strictEqual(rules.matchService('surgery', SETTINGS.services), null);
  assert.strictEqual(rules.matchService('', SETTINGS.services), null);
  assert.strictEqual(rules.matchService('c', ['Cleaning', 'Crowns']), null, 'ambiguous is not a match');

  assert.strictEqual(rules.timeProblem(at('2026-11-10T11:00'), SETTINGS, NOW), null);
  assert.strictEqual(rules.timeProblem(at('2026-11-10T08:00'), SETTINGS, NOW), 'outsideHours');
  assert.strictEqual(rules.timeProblem(at('2026-11-10T16:45'), SETTINGS, NOW), 'outsideHours', 'must end by closing time');
  assert.strictEqual(rules.timeProblem(at('2026-11-14T11:00'), SETTINGS, NOW), 'outsideHours', 'Saturday is closed');
  assert.strictEqual(rules.timeProblem(at('2026-11-10T11:10'), SETTINGS, NOW), 'outsideHours', 'off the 15-minute grid');
  assert.strictEqual(rules.timeProblem(at('2026-11-09T09:00'), SETTINGS, NOW), 'pastTime');
  assert.strictEqual(rules.timeProblem(at('2026-11-09T10:15'), SETTINGS, NOW), 'pastTime', 'less than 30 minutes ahead');

  const busy = [{ start_at: at('2026-11-10T11:00'), end_at: at('2026-11-10T11:30') }];
  const slots = rules.nextFreeSlots({ from: at('2026-11-10T11:00'), settings: SETTINGS, busy, now: NOW });
  assert.deepStrictEqual(slots.map((s) => s.toISOString()), [at('2026-11-10T11:30'), at('2026-11-10T11:45'), at('2026-11-10T12:00')].map((d) => d.toISOString()));
  // Capacity 2 lets two people share the slot.
  const two = { ...SETTINGS, capacity: 2 };
  assert.strictEqual(rules.nextFreeSlots({ from: at('2026-11-10T11:00'), settings: two, busy, now: NOW })[0].toISOString(), at('2026-11-10T11:00').toISOString());
});

test('flow (English): name, then service, then time, availability, confirmation, booking, reminder', async () => {
  const store = memoryStore();
  const lead = { id: 1, phone: '919876543210' };

  let out = await turn(store, lead, { });
  assert.match(out.reply, /your name/i);
  out = await turn(store, lead, { name: 'Ravi' });
  assert.match(out.reply, /Which service/);
  assert.match(out.reply, /Cleaning, Braces/);
  out = await turn(store, lead, { service: 'cleaning' });
  assert.match(out.reply, /What date and time/);
  assert.match(out.reply, /Mon, Tue, Wed, Thu, Fri 09:00 to 17:00/);
  out = await turn(store, lead, { start: '2026-11-10T11:00' });
  assert.match(out.reply, /Please confirm: Cleaning for Ravi/);
  assert.strictEqual(store.rows.length, 0, 'nothing is booked before the customer confirms');
  assert.strictEqual(lead.booking_draft.awaiting_confirm, true);

  out = await turn(store, lead, { confirm: true });
  assert.match(out.reply, /Your Cleaning appointment is confirmed/);
  assert.match(out.reply, /reminder/);
  assert.strictEqual(store.rows.length, 1);
  assert.strictEqual(store.rows[0].customer_name, 'Ravi');
  assert.strictEqual(store.rows[0].start_at.toISOString(), at('2026-11-10T11:00').toISOString());
  assert.deepStrictEqual(store.reminders, [1]);
  assert.strictEqual(out.draft, null);
  assert.match(out.handoffReason, /Appointment booked/);
});

test('flow: details given together still need a confirmation, and "yes" alone books nothing', async () => {
  const store = memoryStore();
  const lead = { id: 2, phone: '919876500000' };
  let out = await turn(store, lead, { confirm: true, name: 'Meena', service: 'Braces', start: '2026-11-10T14:00' });
  assert.match(out.reply, /Please confirm: Braces for Meena/);
  assert.strictEqual(store.rows.length, 0);
  const stranger = { id: 3, phone: '919000000000' };
  out = await turn(store, stranger, { confirm: true });
  assert.match(out.reply, /your name/i);
  assert.strictEqual(store.rows.length, 0);
});

test('flow: a different time after the question needs a new confirmation', async () => {
  const store = memoryStore();
  const lead = { id: 4, phone: '919876500001' };
  await turn(store, lead, { name: 'Anu', service: 'Cleaning', start: '2026-11-10T11:00' });
  let out = await turn(store, lead, { start: '2026-11-10T12:00', confirm: true });
  assert.match(out.reply, /Please confirm/);
  assert.strictEqual(store.rows.length, 0);
  out = await turn(store, lead, { confirm: true });
  assert.match(out.reply, /confirmed/);
  assert.strictEqual(store.rows[0].start_at.toISOString(), at('2026-11-10T12:00').toISOString());
});

test('flow: a taken time is refused with free alternatives, and the seat is never double booked', async () => {
  const store = memoryStore();
  const a = { id: 5, phone: '919876500002' };
  const b = { id: 6, phone: '919876500003' };
  await turn(store, a, { name: 'A', service: 'Cleaning', start: '2026-11-10T11:00' });
  await turn(store, a, { confirm: true });
  let out = await turn(store, b, { name: 'B', service: 'Cleaning', start: '2026-11-10T11:00' });
  assert.match(out.reply, /not available/);
  assert.match(out.reply, /11:30/);
  assert.strictEqual(store.rows.length, 1);
  assert.strictEqual(out.draft.start, null, 'the taken time is dropped from the draft');

  // Two confirmations racing for the last seat: the store allows one.
  const c = { id: 7, phone: '919876500004' };
  const d = { id: 8, phone: '919876500005' };
  await turn(store, c, { name: 'C', service: 'Cleaning', start: '2026-11-10T15:00' });
  await turn(store, d, { name: 'D', service: 'Cleaning', start: '2026-11-10T15:00' });
  const [x, y] = await Promise.all([turn(store, c, { confirm: true }), turn(store, d, { confirm: true })]);
  assert.strictEqual(store.rows.filter((r) => r.start_at.toISOString() === at('2026-11-10T15:00').toISOString()).length, 1);
  assert.ok([x, y].some((r) => /not available/.test(r.reply)));
});

test('flow: outside hours, the past, unknown service, and cancel', async () => {
  const store = memoryStore();
  const lead = { id: 9, phone: '919876500006' };
  let out = await turn(store, lead, { name: 'Ravi', service: 'Heart surgery' });
  assert.match(out.reply, /Which service/, 'a service the business does not list is never accepted');
  out = await turn(store, lead, { service: 'Cleaning', start: '2026-11-14T11:00' });
  assert.match(out.reply, /We take bookings/);
  out = await turn(store, lead, { start: '2026-11-09T09:00' });
  assert.match(out.reply, /future/);

  await turn(store, lead, { start: '2026-11-10T11:00' });
  await turn(store, lead, { confirm: true });
  assert.strictEqual(store.rows.length, 1);
  out = await turn(store, lead, { cancel: true });
  assert.match(out.reply, /has been cancelled/);
  assert.strictEqual(store.rows[0].status, 'cancelled');
  assert.strictEqual(store.rows[0].slot_key, null, 'the seat is free again');
  out = await turn(store, lead, { cancel: true });
  assert.match(out.reply, /could not find an upcoming appointment/);
});

test('flow (Tamil): every question and the confirmation are in Tamil', async () => {
  const store = memoryStore();
  const lead = { id: 10, phone: '919876500007' };
  const ta = { lang: 'ta' };
  assert.match((await turn(store, lead, {}, ta)).reply, /பெயரை/);
  assert.match((await turn(store, lead, { name: 'ரவி' }, ta)).reply, /எந்த சேவையை/);
  assert.match((await turn(store, lead, { service: 'Cleaning' }, ta)).reply, /எந்த தேதி/);
  const ask = await turn(store, lead, { start: '2026-11-10T11:00' }, ta);
  assert.match(ask.reply, /உறுதிப்படுத்துங்கள்/);
  assert.match(ask.reply, /ரவி/);
  const done = await turn(store, lead, { confirm: true }, ta);
  assert.match(done.reply, /உறுதி செய்யப்பட்டது/);
  assert.strictEqual(store.rows[0].language, 'ta');
  for (const key of Object.keys(require('../services/appointmentText').TEXT)) {
    const vars = { services: ['A'], hours: 'h', slots: ['s'], name: 'n', service: 'x', when: 'w' };
    assert.ok(say(key, 'ta', vars).length > 0 && say(key, 'ta', vars) !== say(key, 'en', vars), `${key} has its own Tamil text`);
  }
  assert.match(formatWhen(at('2026-11-10T11:00'), 'Asia/Kolkata', 'ta'), /2026/);
});

test('flow: an old draft is forgotten, and the model cannot inject markup into the name', async () => {
  const store = memoryStore();
  const lead = { id: 11, phone: '919876500008', booking_draft: { name: 'Old', service: 'Cleaning', start: at('2026-11-10T11:00'), awaiting_confirm: true, updated_at: new Date(NOW.getTime() - 3 * 3600 * 1000) } };
  const out = await turn(store, lead, { confirm: true });
  assert.match(out.reply, /your name/i);
  assert.strictEqual(store.rows.length, 0);
  assert.strictEqual(flow.cleanProposal({ name: '<b>x</b>\u0000y' }).name, ' b x /b  y'.trim());
  assert.strictEqual(flow.cleanProposal('x'), null);
  assert.strictEqual(flow.cleanProposal([]), null);
});

test('reminders: a day before, or an hour before when booked late, else none', () => {
  const settings = { ...SETTINGS, reminderHours: 24 };
  const start = at('2026-11-12T11:00');
  assert.strictEqual(require('../services/appointments').reminderTime(start, settings, NOW).toISOString(), at('2026-11-11T11:00').toISOString());
  const soon = at('2026-11-09T14:00');
  assert.strictEqual(require('../services/appointments').reminderTime(soon, settings, NOW).toISOString(), at('2026-11-09T13:00').toISOString());
  assert.strictEqual(require('../services/appointments').reminderTime(at('2026-11-09T10:45'), settings, NOW), null);
});

test('prompt: greeting, industry rules, appointment section, only this business\'s facts', () => {
  const user = (extra = {}) => prompts.assemblePrompt({
    brain: { profile: { ...PROFILE, greeting_message: 'Welcome to Sunrise Dental' }, version_type: 'client' },
    docs: [{ id: 1, doc_type: 'faq:hours', title: 'Hours', content: 'Open Monday to Friday' }],
    lead: { name: 'Ravi' }, history: [], message: 'வணக்கம்', businessOpen: true, quotaLeft: null, now: NOW, ...extra,
  });
  const first = user({ firstContact: true, appointments: { settings: SETTINGS, draft: null, upcoming: null } });
  assert.match(first.user, /First message from this customer: yes/);
  assert.match(first.user, /greet them warmly/);
  assert.match(first.user, /Welcome to Sunrise Dental/);
  assert.match(first.user, /CLINIC RULES/);
  assert.match(first.user, /<appointment_booking>/);
  assert.match(first.user, /Tamil in Tamil script/);
  assert.match(first.system, /connect a person/);
  assert.match(first.system, /general_knowledge/);
  const later = user({ firstContact: false });
  assert.doesNotMatch(later.user, /greet them warmly/);
  assert.doesNotMatch(later.user, /<appointment_booking>/);
  const school = prompts.assemblePrompt({
    brain: { profile: prompts.cleanProfile({ ...PROFILE, industry: 'education' }), version_type: 'client' },
    docs: [], lead: {}, history: [], message: 'fees?', businessOpen: true, quotaLeft: null, now: NOW,
  });
  assert.match(school.user, /EDUCATION RULES/);
  assert.doesNotMatch(school.user, /CLINIC RULES/);
  assert.strictEqual(prompts.cleanProfile({ industry: 'bank', booking_mode: 'x' }).industry, 'general');
  assert.strictEqual(prompts.cleanProfile({ booking_mode: 'x' }).booking_mode, 'meetings');
});

test('engine guards: invented phone numbers and the general-knowledge flag', () => {
  const source = 'Call us on 044 2345 6789. We are open Monday to Friday.';
  assert.strictEqual(engine.inventsPhoneNumber('Call 044 2345 6789', source), false);
  assert.strictEqual(engine.inventsPhoneNumber('Call 98765 43210', source), true);
  assert.strictEqual(engine.inventsPhoneNumber('Open at 9 and close at 5', source), false);
  assert.strictEqual(engine.inventsPhoneNumber('See you on 10-11-2026 at 11:00, fee 1,50,000', source), false, 'dates and prices are not phone numbers');
  const parsed = engine.parseOutput(JSON.stringify({ reply: 'hi', answered_from: 'general_knowledge', appointment: { name: 'R', confirm: true } }));
  assert.strictEqual(parsed.answered_from, 'general_knowledge');
  assert.strictEqual(parsed.appointment.confirm, true);
  assert.strictEqual(engine.parseOutput('{"reply":"hi","answered_from":"bogus"}').answered_from, null);
});
