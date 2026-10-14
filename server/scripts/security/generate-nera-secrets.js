#!/usr/bin/env node
/**
 * Task S1 step 2 — generates the Nera secrets that need no third party:
 * JWT_SECRET and INTERNAL_API_KEY.
 *
 * Values are written to a new file OUTSIDE any Git work tree and are never
 * printed. Load that file into the server environment or a secret manager,
 * then delete it. Database, Meta, Razorpay, AI-provider and SMTP credentials
 * are issued by their providers (Tasks S3, W1, B4) and are not generated here.
 *
 * TOKEN_ENCRYPTION_KEY is deliberately not generated: rows already encrypted
 * with the old key must be re-encrypted in the same step (Task S8).
 *
 * Usage: node scripts/security/generate-nera-secrets.js --out <path outside the repository>
 */
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function insideGitWorkTree(dir) {
  try {
    return execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() === 'true';
  } catch {
    return false;
  }
}

const outIndex = process.argv.indexOf('--out');
if (outIndex === -1 || !process.argv[outIndex + 1]) {
  console.error('Usage: node scripts/security/generate-nera-secrets.js --out <path outside the repository>');
  process.exit(2);
}
const outFile = path.resolve(process.argv[outIndex + 1]);
const outDir = path.dirname(outFile);

if (!fs.existsSync(outDir)) {
  console.error(`Directory does not exist: ${outDir}`);
  process.exit(2);
}
if (fs.existsSync(outFile)) {
  console.error(`File already exists, not overwriting: ${outFile}`);
  process.exit(2);
}
if (insideGitWorkTree(outDir)) {
  console.error('Refusing to write secrets inside a Git work tree. Choose a path outside the repository.');
  process.exit(2);
}

const secrets = {
  JWT_SECRET: crypto.randomBytes(64).toString('hex'),
  INTERNAL_API_KEY: crypto.randomBytes(32).toString('base64url'),
};
const body = Object.entries(secrets).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';

// 'wx' fails if the file exists, so an earlier set is never silently replaced.
fs.writeFileSync(outFile, body, { flag: 'wx', mode: 0o600 });

console.log(`Generated ${Object.keys(secrets).join(', ')} -> ${outFile}`);
console.log('Next: load into the server environment or secret manager, then delete this file.');
console.log('Changing JWT_SECRET signs every user out (tokens last 7 days); do it inside the agreed window.');
