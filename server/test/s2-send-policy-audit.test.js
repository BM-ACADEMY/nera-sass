/**
 * Slice S2: every code path that sends a WhatsApp message to a contact goes
 * through services/sendPolicy.js. This is a source scan, so a NEW send path
 * that skips the policy fails here until it either calls
 * sendPolicy.checkSend / assertCanSend (or a wrapper counted below) or is added
 * to EXEMPT with a written reason.
 *
 * A send site is a Graph API URL ending in "/<phone number id>/messages".
 * For a covered file, the number of policy checks must be at least the number
 * of send sites, so adding a second send next to an existing check also fails.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SERVER_ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'test', 'scripts', 'uploads', 'migrations']);

// Files that send WhatsApp messages without sendPolicy, and why that is intended.
const EXEMPT = {
  'services/founderNotify.js': 'Alerts the platform owner on their own number; not a contact of any tenant.',
  'services/platformInbox.js': 'Platform-staff inbox on the platform\'s own number (opt-in contacts who wrote to Nera); no tenant lead, consent or wallet.',
  'routes/leados/webhook-whatsapp.js': 'STOP/START confirmation sent inside the window the customer just opened; it is the consent confirmation itself.',
  'routes/alliance.js': 'AllianceOS is a separate, tenant-less module with its own prospects, suppression list and caps (reported in the PR, not routed here).',
  'routes/alliance-inbox-v2.js': 'AllianceOS inbox (see routes/alliance.js).',
  'services/alliance-welcome.js': 'AllianceOS (see routes/alliance.js).',
  'services/alliance-ai-nudge-worker.js': 'AllianceOS (see routes/alliance.js).',
  'services/alliance-whatsapp-campaign-worker.js': 'AllianceOS (see routes/alliance.js).',
};

const SEND_SITE = /\/\$\{[^}]+\}\/messages[`'"]/;
const POLICY_CALL = /\b(?:sendPolicy\.checkSend|sendPolicy\.assertCanSend|assertPolicy|checkSend|assertCanSend)\(/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function scan() {
  const report = [];
  for (const file of walk(SERVER_ROOT)) {
    const rel = path.relative(SERVER_ROOT, file).split(path.sep).join('/');
    if (rel === 'services/sendPolicy.js') continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const sites = lines.filter((l) => SEND_SITE.test(l) && !l.trim().startsWith('//')).length;
    if (!sites) continue;
    const checks = lines.filter((l) => POLICY_CALL.test(l) && !/function\s+\w+/.test(l) && !l.includes('checkSend(options)')).length;
    report.push({ rel, sites, checks });
  }
  return report;
}

test('S2-5. every WhatsApp send site is covered by sendPolicy or explicitly exempt', () => {
  const report = scan();
  assert.ok(report.length >= 8, `scan found only ${report.length} files with send sites; the pattern is stale`);
  const failures = [];
  for (const { rel, sites, checks } of report) {
    if (EXEMPT[rel]) continue;
    if (checks < sites) failures.push(`${rel}: ${sites} send site(s) but ${checks} sendPolicy check(s)`);
  }
  assert.deepStrictEqual(failures, [], 'Route new send paths through sendPolicy.checkSend, or add them to EXEMPT with a reason');
});

test('S2-5b. EXEMPT entries are still real (no stale allow-list)', () => {
  const sendFiles = new Set(scan().map((r) => r.rel));
  for (const rel of Object.keys(EXEMPT)) assert.ok(sendFiles.has(rel), `${rel} no longer has a send site; remove it from EXEMPT`);
});

test('S2-5c. the paths named in the audit are all covered', () => {
  const covered = new Map(scan().map((r) => [r.rel, r]));
  for (const rel of [
    'routes/leados/whatsapp.js', 'routes/leados/messages.js', 'routes/leados/internal.js', 'routes/leados/followups.js',
    'routes/salesos.js', 'routes/chatbot.js', 'services/whatsappSendQueue.js',
  ]) {
    const row = covered.get(rel);
    assert.ok(row, `${rel} has no send site`);
    assert.ok(row.checks >= row.sites, `${rel} bypasses sendPolicy`);
  }
});
