import test from 'node:test';
import assert from 'node:assert';
import {
  settingsSections, findSection, workspaceInfo, languageOptions, profileChanges, canEditWorkspace, canEditBrand, connectWhatsApp, maskId, whatsappSummary, roleLabel, profileSaveMessage,
} from './settingsPolicy.js';

const FLAGS = {
  owner: { manage_team: true, manage_settings: true, manage_whatsapp: true },
  admin: { manage_team: true, manage_settings: true, manage_whatsapp: true },
  manager: { manage_team: false, manage_settings: false, manage_whatsapp: false },
  agent: { manage_team: false, manage_settings: false, manage_whatsapp: false },
};
test('Settings sections: no WhatsApp or Billing (they have their own pages)', () => {
  assert.deepStrictEqual(settingsSections().map((s) => s.key), ['profile', 'brand', 'two-step', 'password']);
  assert.deepStrictEqual(
    settingsSections({ view_team: true, view_activity: true, manage_integrations: true }).map((s) => s.key),
    ['profile', 'brand', 'two-step', 'password', 'activity', 'integrations'],
  );
  assert.strictEqual(findSection('whatsapp'), null);
  assert.strictEqual(findSection('billing'), null);
  assert.strictEqual(findSection('profile').title, 'Profile & workspace');
});

test('Team is not a Settings section any more (it has its own page, /team)', () => {
  assert.ok(!settingsSections({ view_team: true }).some((s) => s.key === 'team'));
  assert.strictEqual(findSection('team'), null);
});

test('Integrations section: only with the manage_integrations permission', () => {
  assert.ok(settingsSections({ manage_integrations: true }).some((s) => s.key === 'integrations'));
  assert.ok(!settingsSections({ manage_integrations: false }).some((s) => s.key === 'integrations'));
  assert.strictEqual(findSection('integrations').title, 'Integrations');
});

test('workspace info is shown read-only with friendly labels', () => {
  const info = workspaceInfo({ tenant: { id: 7, name: 'Dress Shop', currency: 'INR', timezone: 'Asia/Kolkata', tax_treatment: 'gst' }, lifecycle: { state: 'active' } });
  assert.deepStrictEqual(info.map((row) => [row.key, row.value]), [
    ['name', 'Dress Shop'], ['id', '7'], ['status', 'Active'], ['currency', 'INR'], ['timezone', 'Asia/Kolkata'], ['tax_treatment', 'GST (India)'],
  ]);
  assert.strictEqual(workspaceInfo(null).find((r) => r.key === 'id').value, '');
});

test('language options keep an unknown stored value', () => {
  assert.ok(languageOptions('ta').every((o) => o.value !== 'xx'));
  assert.strictEqual(languageOptions('ta').length, 6);
  assert.deepStrictEqual(languageOptions('fr').at(-1), { value: 'fr', label: 'fr' });
});

test('WhatsApp profile: only changed fields, Meta limits and email format', () => {
  const current = { about: 'Hi', description: 'Old', address: '', email: '' };
  assert.deepStrictEqual(profileChanges({ ...current, address: ' 12 Road ' }, current), { ok: true, changes: { address: '12 Road' } });
  assert.match(profileChanges({ ...current, about: 'a'.repeat(140) }, current).error, /139/);
  assert.match(profileChanges({ ...current, description: 'd'.repeat(513) }, current).error, /512/);
  assert.match(profileChanges({ ...current, address: 'x'.repeat(257) }, current).error, /256/);
  assert.match(profileChanges({ ...current, email: 'nope' }, current).error, /valid email/);
  assert.match(profileChanges({ ...current, about: '' }, current).error, /About cannot be empty/);
  assert.match(profileChanges(current, current).error, /Nothing has changed/);
});

test('editing follows the server permission flags', () => {
  for (const role of ['owner', 'admin']) {
    assert.strictEqual(canEditWorkspace(FLAGS[role]), true);
    assert.strictEqual(canEditBrand(FLAGS[role]), true);
  }
  for (const role of ['manager', 'agent']) {
    assert.strictEqual(canEditWorkspace(FLAGS[role]), false);
    assert.strictEqual(canEditBrand(FLAGS[role]), false);
  }
  assert.strictEqual(canEditBrand(undefined), false);
});

test('Connect WhatsApp: hidden without manage_whatsapp, disabled while secure signup is pending', () => {
  const pending = { enabled: false, reason: 'SECURE_SIGNUP_PENDING', message: 'Temporarily unavailable' };
  assert.deepStrictEqual(connectWhatsApp({ permissions: FLAGS.agent, signupConfig: pending }), { visible: false, enabled: false, reason: null });
  assert.deepStrictEqual(connectWhatsApp({ permissions: FLAGS.owner, signupConfig: pending }), { visible: true, enabled: false, reason: 'Temporarily unavailable' });
  assert.strictEqual(connectWhatsApp({ permissions: FLAGS.owner, signupConfig: undefined }).enabled, false, 'no config = disabled');
  assert.strictEqual(connectWhatsApp({ permissions: FLAGS.owner, signupConfig: { enabled: 'true' } }).enabled, false, 'only a real true enables');
  assert.strictEqual(connectWhatsApp({ permissions: FLAGS.manager, signupConfig: { enabled: true } }).visible, false);
  assert.deepStrictEqual(connectWhatsApp({ permissions: FLAGS.admin, signupConfig: { enabled: true } }), { visible: true, enabled: true, reason: null });
});

test('identifiers are masked to the last four characters', () => {
  assert.strictEqual(maskId('109876543210'), '•••• 3210');
  assert.strictEqual(maskId('123'), '123');
  assert.strictEqual(maskId(''), '');
  assert.strictEqual(maskId(null), '');
});

test('WhatsApp summary shows status and masked ids, never a credential', () => {
  const summary = whatsappSummary({
    whatsapp_status: 'verified', whatsapp_number: '919876543210', phone_number_id: '109876543210', wa_business_id: '2233445566',
    wa_token_configured: true, wa_token_last4: '4421', wa_access_token: 'must-not-appear', wa_access_token_enc: 'nor-this',
  });
  assert.deepStrictEqual(summary, {
    status: 'Connected', number: '+919876543210', phoneId: '•••• 3210', wabaId: '•••• 5566', credential: 'Configured (ending 4421)',
  });
  assert.ok(!JSON.stringify(summary).includes('must-not-appear'));
  assert.strictEqual(whatsappSummary(null).status, 'Not connected');
  assert.strictEqual(whatsappSummary({ whatsapp_status: 'not_configured' }).credential, 'Not configured');
});

test('the authenticated role is shown as-is, nothing invented', () => {
  assert.strictEqual(roleLabel('owner'), 'Owner');
  assert.strictEqual(roleLabel('agent'), 'Agent');
  assert.strictEqual(roleLabel('platform_staff'), '');
  assert.strictEqual(roleLabel(undefined), '');
});

test('profile save messages explain a pending WhatsApp sync', () => {
  assert.match(profileSaveMessage({ meta_profile_synced: true }), /published/);
  assert.match(profileSaveMessage({ meta_profile_pending: true, meta_profile_pending_reason: 'WHATSAPP_CREDENTIAL_MISSING' }), /no WhatsApp credential/);
  assert.match(profileSaveMessage({ meta_profile_pending: true, meta_profile_pending_reason: 'WHATSAPP_NOT_CONNECTED' }), /once WhatsApp is connected/);
  assert.strictEqual(profileSaveMessage({}), 'Saved.');
});

// ── Task 2A ──────────────────────────────────────────────
test('website rule matches the server: normalise, refuse unsafe, empty clears', async () => {
  const { normalizeWebsite } = await import('./settingsPolicy.js');
  assert.deepStrictEqual(normalizeWebsite('example.org'), { ok: true, value: 'https://example.org' });
  assert.deepStrictEqual(normalizeWebsite(' http://shop.example.in/path '), { ok: true, value: 'http://shop.example.in/path' });
  assert.deepStrictEqual(normalizeWebsite(''), { ok: true, value: '' });
  for (const bad of ['javascript:alert(1)', 'ftp://example.org', 'not a url', 'localhost', 'https://user:pass@example.org', `https://${'a'.repeat(260)}.com`]) {
    assert.strictEqual(normalizeWebsite(bad).ok, false, bad);
  }
});

test('Settings load states: error with retry before data, keep data on a failed reload', async () => {
  const { settingsLoadState } = await import('./settingsPolicy.js');
  assert.strictEqual(settingsLoadState({ loaded: false, error: '' }), 'loading');
  assert.strictEqual(settingsLoadState({ loaded: false, error: 'Network error' }), 'error', 'never an empty "no brand" page');
  assert.strictEqual(settingsLoadState({ loaded: true, error: '' }), 'ready');
  assert.strictEqual(settingsLoadState({ loaded: true, error: 'Network error' }), 'ready-with-error');
});

test('a missing WABA ID is explained as such, not as a missing credential', () => {
  const message = profileSaveMessage({ meta_profile_pending: true, meta_profile_pending_reason: 'WHATSAPP_ACCOUNT_ID_MISSING' });
  assert.match(message, /WhatsApp Business Account ID is missing/);
  assert.doesNotMatch(message, /credential/);
});
