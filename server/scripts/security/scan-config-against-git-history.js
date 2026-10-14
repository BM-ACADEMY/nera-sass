#!/usr/bin/env node
/**
 * Task S1 / Gate G3 — "Nera's running configuration contains 0 values that
 * appear anywhere in Git history."
 *
 * Reads a configuration (env files and/or the live process environment) and
 * searches every blob Git can still reach (all refs + reflog) for each value.
 * Read-only: no network, no database, nothing written unless --json-out is given.
 * Prints key names and file paths only — never a value.
 *
 * Usage (from server/):
 *   node scripts/security/scan-config-against-git-history.js                  # scans server/.env
 *   node scripts/security/scan-config-against-git-history.js --env-file /etc/nera/nera.env
 *   node scripts/security/scan-config-against-git-history.js --process-env    # the environment this process was started with
 *   ... --json-out ../../evidence/g3-scan.json                                # evidence file (names only)
 *
 * Exit code: 0 = no credential-class value found in history, 1 = at least one found, 2 = could not run.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const SERVER_DIR = path.resolve(__dirname, '..', '..');
const MIN_SUBSTRING_LENGTH = 8; // shorter values are only compared against historical env values
const CHUNK_BYTES = 64 * 1024 * 1024;
const MAX_BUFFER = 1024 * 1024 * 1024;

// Plain settings that may legitimately keep the same value as before. Anything
// that does not match is treated as a credential and must not appear in history.
const NON_SECRET_KEY = new RegExp(
  '^(PORT|NODE_ENV|DB_HOST|DB_PORT|DB_NAME)$' +
  '|^DISABLE_|_ENABLED$|_SECURE$|_HOST$|_PORT$|_PROVIDER$' +
  '|_MODELS?$|_VERSION$|_TIME_ZONE$|_MAX$|_SECONDS$|_MS$|_CHARS$|_TEMPLATE$|_APP_NAME$|^VITE_APP_NAME$' +
  '|_FROM$|_FROM_NAME$|_REPLY_TO$|_EMAIL$|_NUMBER$|_PHONE$' +
  '|^(PORTAL_URL|ADMIN_PANEL_URL|FRONTEND_URL|API_URL|API_BASE_URL|PUBLIC_API_URL|VITE_API_URL|OPENROUTER_SITE_URL)$' +
  '|_REDIRECT_URI$|_CALLBACK_URL$|^GOOGLE_CALLBACK_'
);

function parseArgs(argv) {
  const args = { envFiles: [], processEnv: false, jsonOut: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--env-file') args.envFiles.push(path.resolve(argv[++i]));
    else if (arg === '--process-env') args.processEnv = true;
    else if (arg === '--json-out') args.jsonOut = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.envFiles.length && !args.processEnv) args.envFiles.push(path.join(SERVER_DIR, '.env'));
  return args;
}

function git(args, input) {
  return execFileSync('git', args, { cwd: SERVER_DIR, input, maxBuffer: MAX_BUFFER });
}

function isEnvFilePath(filePath) {
  return /^\.env/.test(path.posix.basename(filePath)) && !filePath.includes('node_modules/');
}

// Every blob reachable from any ref or reflog entry, with the first path it was seen at.
function listBlobs() {
  const pathBySha = new Map();
  for (const line of git(['rev-list', '--all', '--reflog', '--objects']).toString('utf8').split('\n')) {
    const space = line.indexOf(' ');
    if (space === -1) continue; // commits have no path
    const sha = line.slice(0, space);
    if (!pathBySha.has(sha)) pathBySha.set(sha, line.slice(space + 1));
  }
  const check = git(['cat-file', '--batch-check'], [...pathBySha.keys()].join('\n') + '\n').toString('utf8');
  const blobs = [];
  for (const line of check.split('\n')) {
    const [sha, type, size] = line.split(' ');
    if (type === 'blob') blobs.push({ sha, size: Number(size), path: pathBySha.get(sha) });
  }
  return blobs;
}

function* readBlobs(blobs) {
  let chunk = [];
  let chunkBytes = 0;
  const flush = function* () {
    const out = git(['cat-file', '--batch'], chunk.map((blob) => blob.sha).join('\n') + '\n');
    let offset = 0;
    for (const blob of chunk) {
      const headerEnd = out.indexOf(0x0a, offset);
      const size = Number(out.subarray(offset, headerEnd).toString('utf8').split(' ')[2]);
      yield { ...blob, content: out.subarray(headerEnd + 1, headerEnd + 1 + size) };
      offset = headerEnd + 1 + size + 1;
    }
    chunk = [];
    chunkBytes = 0;
  };
  for (const blob of blobs) {
    chunk.push(blob);
    chunkBytes += blob.size;
    if (chunkBytes >= CHUNK_BYTES) yield* flush();
  }
  if (chunk.length) yield* flush();
}

// Keys the server code reads, so --process-env ignores unrelated OS variables.
function keysReadByCode(dir, found = new Set()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'uploads') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) keysReadByCode(full, found);
    else if (/\.(c|m)?js$/.test(entry.name)) {
      const source = fs.readFileSync(full, 'utf8');
      for (const match of source.matchAll(/process\.env\.([A-Za-z0-9_]+)|process\.env\[['"]([A-Za-z0-9_]+)['"]\]|_env:\s*['"]([A-Z0-9_]+)['"]/g)) {
        found.add(match[1] || match[2] || match[3]);
      }
    }
  }
  return found;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const head = git(['rev-parse', 'HEAD']).toString('utf8').trim();
  const blobs = listBlobs();

  // Pass 1: historical env files give the exact-value set and the historical key names.
  const historicalEnvValues = new Set();
  const historicalEnvKeys = new Set();
  for (const blob of readBlobs(blobs.filter((b) => isEnvFilePath(b.path)))) {
    for (const [key, value] of Object.entries(dotenv.parse(blob.content))) {
      historicalEnvKeys.add(key);
      if (value) historicalEnvValues.add(value);
    }
  }

  const config = new Map(); // key -> { value, source }
  for (const file of args.envFiles) {
    for (const [key, value] of Object.entries(dotenv.parse(fs.readFileSync(file)))) {
      config.set(key, { value, source: file });
    }
  }
  if (args.processEnv) {
    const relevant = new Set([...keysReadByCode(SERVER_DIR), ...historicalEnvKeys]);
    for (const key of relevant) {
      if (process.env[key] !== undefined) config.set(key, { value: process.env[key], source: 'process.env' });
    }
  }

  const results = [];
  const pending = [];
  for (const [key, { value, source }] of config) {
    const result = { key, source, credential: !NON_SECRET_KEY.test(key), inHistory: false, foundIn: [] };
    results.push(result);
    if (!value) { result.empty = true; continue; }
    if (historicalEnvValues.has(value)) result.inHistory = true;
    if (value.length >= MIN_SUBSTRING_LENGTH) pending.push({ result, needle: Buffer.from(value, 'utf8') });
  }

  // Pass 2: substring search of every blob for every value.
  for (const blob of readBlobs(blobs)) {
    for (const { result, needle } of pending) {
      if (result.foundIn.length >= 3 || blob.size < needle.length || result.foundIn.includes(blob.path)) continue;
      if (blob.content.includes(needle)) {
        result.inHistory = true;
        result.foundIn.push(blob.path);
      }
    }
  }

  const exposed = results.filter((r) => r.credential && r.inHistory);
  const reusedSettings = results.filter((r) => !r.credential && r.inHistory);
  const credentials = results.filter((r) => r.credential && !r.empty);

  console.log(`Git history scan — HEAD ${head.slice(0, 12)}, ${blobs.length} blobs (all refs + reflog)`);
  console.log(`Configuration: ${[...args.envFiles, ...(args.processEnv ? ['process.env'] : [])].join(', ')}`);
  console.log('');
  for (const r of results.sort((a, b) => a.key.localeCompare(b.key))) {
    if (r.empty) continue;
    const status = !r.inHistory ? 'clean  ' : r.credential ? 'EXPOSED' : 'setting';
    const where = r.foundIn.length ? `  <- ${r.foundIn.join(', ')}` : r.inHistory ? '  <- historical env file' : '';
    console.log(`  ${status}  ${r.key}${where}`);
  }
  console.log('');
  console.log(`Credential-class values present in Git history: ${exposed.length} of ${credentials.length}`);
  console.log(`Plain settings unchanged from history (informational): ${reusedSettings.length}`);
  console.log(exposed.length === 0 ? 'RESULT: PASS' : 'RESULT: FAIL — the keys marked EXPOSED must be replaced before this configuration is used.');

  if (args.jsonOut) {
    fs.writeFileSync(args.jsonOut, JSON.stringify({
      scannedAt: new Date().toISOString(),
      head,
      blobsScanned: blobs.length,
      configuration: [...args.envFiles, ...(args.processEnv ? ['process.env'] : [])],
      pass: exposed.length === 0,
      results: results.filter((r) => !r.empty).map(({ key, source, credential, inHistory, foundIn }) => ({ key, source, credential, inHistory, foundIn })),
    }, null, 2));
    console.log(`Evidence written to ${args.jsonOut}`);
  }
  process.exit(exposed.length === 0 ? 0 : 1);
}

try {
  main();
} catch (error) {
  console.error(`Scan could not run: ${error.message}`);
  process.exit(2);
}
