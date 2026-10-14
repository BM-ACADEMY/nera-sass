#!/usr/bin/env node
/**
 * Task S1 acceptance — run ONLY AFTER the agreed rotation window has closed:
 *   - a connection with the old database password is refused
 *   - a token signed with the old JWT secret returns 401
 *   - a Graph API call with the old Meta token is rejected
 *   - the old Razorpay key is rejected
 *
 * The old values are read from Git history (every historical version of
 * server/.env), or from --old-env-file once history has been purged (Task S2).
 * Each check is a single read-only request. Prints key names only — never a value.
 *
 * Running this BEFORE the window would log in to production systems with the
 * exposed credentials, so it refuses to run without --window-closed.
 *
 * Usage (from server/):
 *   node scripts/security/verify-old-credentials-rejected.js --window-closed --api-url https://<nera-api-host>
 *   ... [--old-env-file <path>] [--db-host <host>] [--db-port <port>] [--db-name <name>]
 *
 * Exit code: 0 = every old credential was rejected, 1 = at least one still works
 * or could not be tested, 2 = could not run.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');

const SERVER_DIR = path.resolve(__dirname, '..', '..');
const ENV_PATH_IN_REPO = 'server/.env';
const GRAPH_URL = 'https://graph.facebook.com/v19.0';
const TIMEOUT_MS = 15000;
const JWT_FALLBACK_FILES = ['controllers/authController.js', 'middleware/authMiddleware.js'];
const META_TOKEN_KEYS = ['META_PAGE_ACCESS_TOKEN', 'ALLIANCE_WA_ACCESS_TOKEN', 'META_SYSTEM_USER_ACCESS_TOKEN'];
const META_APP_PAIRS = [['META_APP_ID', 'META_APP_SECRET'], ['META_CONTENT_OS_APP_ID', 'META_CONTENT_OS_APP_SECRET']];

function parseArgs(argv) {
  const args = { windowClosed: false };
  const valueFlags = { '--api-url': 'apiUrl', '--old-env-file': 'oldEnvFile', '--db-host': 'dbHost', '--db-port': 'dbPort', '--db-name': 'dbName' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--window-closed') args.windowClosed = true;
    else if (valueFlags[argv[i]]) args[valueFlags[argv[i]]] = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

function git(args) {
  return execFileSync('git', args, { cwd: SERVER_DIR, maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
}

// Every distinct value each key has ever had: key -> Set(values)
function loadOldValues(oldEnvFile) {
  const versions = [];
  if (oldEnvFile) {
    versions.push(fs.readFileSync(oldEnvFile));
  } else {
    const commits = git(['log', '--all', '--format=%H', '--', `:/${ENV_PATH_IN_REPO}`]).split('\n').filter(Boolean);
    for (const commit of commits) versions.push(git(['show', `${commit}:${ENV_PATH_IN_REPO}`]));
  }
  if (!versions.length) throw new Error('No old configuration found. History purged? Pass --old-env-file.');
  const old = new Map();
  for (const version of versions) {
    for (const [key, value] of Object.entries(dotenv.parse(version))) {
      if (!value) continue;
      if (!old.has(key)) old.set(key, new Set());
      old.get(key).add(value);
    }
  }
  return old;
}

// The hardcoded fallback used when JWT_SECRET is unset is also a published signing key.
function jwtFallbackSecrets() {
  const found = new Set();
  for (const file of JWT_FALLBACK_FILES) {
    const full = path.join(SERVER_DIR, file);
    if (!fs.existsSync(full)) continue;
    const match = fs.readFileSync(full, 'utf8').match(/process\.env\.JWT_SECRET\s*\|\|\s*['"]([^'"]+)['"]/);
    if (match) found.add(match[1]);
  }
  return found;
}

const values = (old, key) => [...(old.get(key) || [])];
const last = (old, key) => values(old, key).pop();

async function checkDatabase(old, args) {
  const results = [];
  for (const user of values(old, 'DB_USER')) {
    for (const password of values(old, 'DB_PASS')) {
      const client = new Client({
        host: args.dbHost || last(old, 'DB_HOST'),
        port: Number(args.dbPort || last(old, 'DB_PORT') || 5432),
        database: args.dbName || last(old, 'DB_NAME'),
        user,
        password,
        connectionTimeoutMillis: TIMEOUT_MS,
      });
      try {
        await client.connect();
        await client.end();
        results.push({ status: 'FAIL', detail: 'old DB_USER/DB_PASS still logs in' });
      } catch (error) {
        // 28P01 invalid_password, 28000 invalid_authorization (role removed or blocked in pg_hba)
        if (error.code === '28P01' || error.code === '28000') results.push({ status: 'PASS', detail: `refused (${error.code})` });
        else results.push({ status: 'INCONCLUSIVE', detail: `not an authentication refusal: ${error.code || error.message}` });
      }
    }
  }
  return results;
}

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
  let body = null;
  try { body = await response.json(); } catch { /* non-JSON body */ }
  return { status: response.status, body };
}

async function checkJwt(old, args) {
  if (!args.apiUrl) return [{ status: 'INCONCLUSIVE', detail: '--api-url not given' }];
  const results = [];
  for (const secret of new Set([...values(old, 'JWT_SECRET'), ...jwtFallbackSecrets()])) {
    const token = jwt.sign({ id: 0, role: 'none', name: 's1-acceptance' }, secret, { expiresIn: '60s' });
    try {
      // /api/users only verifies the signature before answering; id 0 matches no user.
      const { status } = await request(`${args.apiUrl.replace(/\/$/, '')}/api/users`, { headers: { Authorization: `Bearer ${token}` } });
      if (status === 401) results.push({ status: 'PASS', detail: 'HTTP 401' });
      else results.push({ status: status < 500 ? 'FAIL' : 'INCONCLUSIVE', detail: `HTTP ${status} — token signed with an old secret was not rejected with 401` });
    } catch (error) {
      results.push({ status: 'INCONCLUSIVE', detail: error.message });
    }
  }
  return results;
}

async function checkMeta(old) {
  const results = [];
  const judge = (key, { status, body }) => {
    // 190 = invalid/expired/revoked access token, 101 = invalid app credentials
    const code = body?.error?.code;
    if (status >= 400 && (code === 190 || code === 101 || status === 401)) return { key, status: 'PASS', detail: `rejected (HTTP ${status}, code ${code})` };
    if (status === 200) return { key, status: 'FAIL', detail: 'Graph API accepted the old credential' };
    return { key, status: 'INCONCLUSIVE', detail: `HTTP ${status}, code ${code}` };
  };
  for (const key of META_TOKEN_KEYS) {
    for (const token of values(old, key)) {
      try {
        results.push(judge(key, await request(`${GRAPH_URL}/me?fields=id`, { headers: { Authorization: `Bearer ${token}` } })));
      } catch (error) {
        results.push({ key, status: 'INCONCLUSIVE', detail: error.message });
      }
    }
  }
  for (const [idKey, secretKey] of META_APP_PAIRS) {
    for (const secret of values(old, secretKey)) {
      const appId = last(old, idKey);
      if (!appId) continue;
      try {
        results.push(judge(secretKey, await request(`${GRAPH_URL}/${appId}?fields=id`, { headers: { Authorization: `Bearer ${appId}|${secret}` } })));
      } catch (error) {
        results.push({ key: secretKey, status: 'INCONCLUSIVE', detail: error.message });
      }
    }
  }
  return results;
}

async function checkRazorpay(old) {
  const results = [];
  for (const keyId of values(old, 'RAZORPAY_KEY_ID')) {
    for (const secret of values(old, 'RAZORPAY_SECRET')) {
      try {
        const basic = Buffer.from(`${keyId}:${secret}`).toString('base64');
        const { status } = await request('https://api.razorpay.com/v1/payments?count=1', { headers: { Authorization: `Basic ${basic}` } });
        if (status === 401) results.push({ status: 'PASS', detail: 'HTTP 401' });
        else if (status === 200) results.push({ status: 'FAIL', detail: 'Razorpay accepted the old key' });
        else results.push({ status: 'INCONCLUSIVE', detail: `HTTP ${status}` });
      } catch (error) {
        results.push({ status: 'INCONCLUSIVE', detail: error.message });
      }
    }
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const old = loadOldValues(args.oldEnvFile);

  if (!args.windowClosed) {
    console.log('Not run. This test logs in with the exposed credentials, so it is only valid AFTER the rotation window.');
    console.log(`Old values loaded for ${old.size} keys. Re-run with --window-closed --api-url <nera api> once the window has closed.`);
    process.exit(2);
  }

  const groups = [
    ['Database login (DB_USER / DB_PASS)', await checkDatabase(old, args)],
    ['JWT signed with old secret (JWT_SECRET + hardcoded fallback)', await checkJwt(old, args)],
    ['Meta Graph API (tokens and app secrets)', await checkMeta(old)],
    ['Razorpay (RAZORPAY_KEY_ID / RAZORPAY_SECRET)', await checkRazorpay(old)],
  ];

  let allPassed = true;
  console.log(`Old-credential rejection test — ${new Date().toISOString()}`);
  for (const [title, results] of groups) {
    console.log(`\n${title}`);
    if (!results.length) { console.log('  INCONCLUSIVE  no old value found for this check'); allPassed = false; }
    for (const result of results) {
      console.log(`  ${result.status.padEnd(12)}  ${result.key ? `${result.key}: ` : ''}${result.detail}`);
      if (result.status !== 'PASS') allPassed = false;
    }
  }
  console.log(`\nRESULT: ${allPassed ? 'PASS — every old credential was rejected' : 'FAIL — see the lines above that are not PASS'}`);
  process.exit(allPassed ? 0 : 1);
}

main().catch((error) => {
  console.error(`Test could not run: ${error.message}`);
  process.exit(2);
});
