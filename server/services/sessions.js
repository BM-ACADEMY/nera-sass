/**
 * Signed-in sessions ("My sessions"): one row per browser or device.
 *
 * A login creates a random session id (sid). The sid travels only inside the
 * signed login token; the database keeps its SHA-256 (session_hash), never the
 * token or the sid itself. Every authenticated request and socket handshake
 * looks the row up, so signing a session out takes effect on the next request.
 *
 * Tokens issued before this feature carry no sid. They keep working until
 * they expire or the user's token_version changes, and do not appear in the
 * list ("sign out all other devices" bumps token_version, which ends them too).
 *
 * Location comes from a local GeoLite2 copy (geoip-lite); no IP leaves the
 * server. Only a masked IP is stored.
 */
const crypto = require('crypto');
const { UserSessions } = require('../models');
const { runAsSystem } = require('./tenantContext');

const sys = (fn) => runAsSystem(fn, 'sessions');
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

// last_seen_at is written at most once per this interval per session.
const touchIntervalMs = () => Number(process.env.SESSION_TOUCH_INTERVAL_MS || 5 * 60 * 1000);

const newSessionId = () => crypto.randomBytes(32).toString('base64url');
const hashSessionId = (sid) => sha256(`session:${sid}`);

// ── Request details ─────────────────────────────────────────

function cleanIp(ip) {
  if (!ip || typeof ip !== 'string') return null;
  const value = ip.trim();
  return value.startsWith('::ffff:') && value.includes('.') ? value.slice(7) : value;
}

// 203.0.113.42 -> 203.0.113.x ; 2001:db8:1:2::5 -> 2001:db8:1:x:x:x:x:x
function maskIp(ip) {
  const value = cleanIp(ip);
  if (!value) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return value.split('.').slice(0, 3).concat('x').join('.');
  if (value.includes(':')) {
    const head = value.split('::')[0].split(':').filter(Boolean).slice(0, 3);
    return [...head, 'x', 'x', 'x', 'x', 'x'].slice(0, 8).join(':');
  }
  return null;
}

const isPrivateIp = (ip) => /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i.test(ip || '');

let geoip; // undefined = not loaded yet, null = unavailable
function geoLookup(ip) {
  if (process.env.SESSION_GEOIP === 'off') return null;
  if (geoip === undefined) {
    try {
      // Loaded on first use only: the city database takes memory.
      geoip = require('geoip-lite');
    } catch (error) {
      console.warn('[sessions] geoip-lite not available; locations are not shown:', error.message);
      geoip = null;
    }
  }
  if (!geoip) return null;
  try {
    return geoip.lookup(ip);
  } catch {
    return null;
  }
}

let countryNames;
function countryName(code) {
  if (!code) return null;
  try {
    countryNames = countryNames || new Intl.DisplayNames(['en'], { type: 'region' });
    return countryNames.of(code) || code;
  } catch {
    return code;
  }
}

function locate(ip) {
  const value = cleanIp(ip);
  if (!value) return null;
  if (isPrivateIp(value)) return { city: null, region: null, country: null, country_code: null, private: true };
  const hit = geoLookup(value);
  if (!hit || !hit.country) return null;
  return { city: hit.city || null, region: hit.region || null, country: countryName(hit.country), country_code: hit.country };
}

// Small user-agent reader: browser, OS and device type for display only.
function parseUserAgent(raw) {
  const ua = String(raw || '');
  const pick = (rules) => {
    for (const [re, name] of rules) {
      const m = re.exec(ua);
      if (m) return m[1] ? `${name} ${m[1].split('.')[0]}` : name;
    }
    return null;
  };
  const browser = pick([
    [/Edg(?:e|A|iOS)?\/([\d.]+)/, 'Edge'],
    [/OPR\/([\d.]+)/, 'Opera'],
    [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
    [/(?:Firefox|FxiOS)\/([\d.]+)/, 'Firefox'],
    [/CriOS\/([\d.]+)/, 'Chrome'],
    [/Chrome\/([\d.]+)/, 'Chrome'],
    [/Version\/([\d.]+).*Safari\//, 'Safari'],
    [/PostmanRuntime\/([\d.]+)/, 'Postman'],
    [/curl\/([\d.]+)/, 'curl'],
  ]);
  let os = null;
  if (/Windows NT 10/.test(ua)) os = 'Windows';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/(iPhone|iPad|iPod)/.test(ua)) os = /iPad/.test(ua) ? 'iPadOS' : 'iOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  let deviceType = 'desktop';
  if (/iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) deviceType = 'tablet';
  else if (/Mobi|iPhone|iPod/.test(ua)) deviceType = 'mobile';
  else if (!ua || (!os && !browser)) deviceType = 'unknown';
  return { browser, os, device_type: deviceType };
}

function clientInfo(req) {
  const userAgent = String(req?.headers?.['user-agent'] || '').slice(0, 400);
  const ip = req?.ip || req?.socket?.remoteAddress || null;
  return { userAgent, ip };
}

// Socket.io handshake details (the same proxy hop rule as Express: only a
// loopback peer may set X-Forwarded-For).
function socketClientInfo(socket) {
  const hs = socket?.handshake || {};
  const peer = cleanIp(hs.address);
  const forwarded = String(hs.headers?.['x-forwarded-for'] || '').split(',').pop().trim();
  const ip = forwarded && (peer === '127.0.0.1' || peer === '::1') ? forwarded : peer;
  return { userAgent: String(hs.headers?.['user-agent'] || '').slice(0, 400), ip };
}

// ── Lifecycle ───────────────────────────────────────────────

function tokenExpiry() {
  const raw = String(process.env.JWT_EXPIRES_IN || '7d');
  const m = /^(\d+)\s*([smhd])?$/.exec(raw);
  const unit = { s: 1, m: 60, h: 3600, d: 86400 }[m?.[2] || 's'];
  const seconds = m ? Number(m[1]) * unit : 7 * 86400;
  return new Date(Date.now() + seconds * 1000);
}

/** Creates a session row for a fresh login; returns the raw sid (for the token only). */
async function createSession(user, info = {}) {
  const sid = newSessionId();
  const now = new Date();
  await sys(() => UserSessions.create({
    user_id: user.id,
    tenant_id: user.tenant_id ?? null,
    session_hash: hashSessionId(sid),
    token_version: Number(user.token_version || 0),
    user_agent: info.userAgent || '',
    ...parseUserAgent(info.userAgent),
    ip_masked: maskIp(info.ip),
    location: locate(info.ip),
    created_at: now,
    last_seen_at: now,
    expires_at: tokenExpiry(),
    revoked_at: null,
  }));
  return sid;
}

/** A new token for an existing session (password change, MFA enrolment): keep the row, refresh it. */
async function renewSession(sid, user) {
  await sys(() => UserSessions.updateOne(
    { session_hash: hashSessionId(sid), user_id: user.id, revoked_at: null },
    { $set: { token_version: Number(user.token_version || 0), expires_at: tokenExpiry() } },
  ));
}

/** The live row for a token's sid, or null when it is unknown, revoked or someone else's. */
async function findActive(sid, userId) {
  if (!sid || typeof sid !== 'string') return null;
  const row = await sys(() => UserSessions.findOne({ session_hash: hashSessionId(sid) }, { _id: 0 }).lean());
  if (!row || row.revoked_at || Number(row.user_id) !== Number(userId)) return null;
  return row;
}

/** Records activity at most once per interval; never blocks or fails the request. */
function touch(row, info = {}) {
  if (!row) return null;
  const last = new Date(row.last_seen_at || 0).getTime();
  if (Date.now() - last < touchIntervalMs()) return null;
  const set = { last_seen_at: new Date() };
  const masked = maskIp(info.ip);
  if (masked && masked !== row.ip_masked) {
    set.ip_masked = masked;
    set.location = locate(info.ip);
  }
  // Conditional on the value read, so parallel requests write once.
  return sys(() => UserSessions.updateOne({ id: row.id, last_seen_at: row.last_seen_at, revoked_at: null }, { $set: set }))
    .catch((error) => console.error('[sessions] last-seen update failed:', error.message));
}

const activeFilter = (user) => ({ user_id: user.id, revoked_at: null, token_version: Number(user.token_version || 0), expires_at: { $gt: new Date() } });

function present(row, currentHash) {
  const loc = row.location || null;
  return {
    id: row.id,
    current: Boolean(currentHash && row.session_hash === currentHash),
    browser: row.browser || null,
    os: row.os || null,
    device_type: row.device_type || 'unknown',
    ip: row.ip_masked || null,
    location: loc ? { city: loc.city || null, region: loc.region || null, country: loc.country || null, private: Boolean(loc.private) } : null,
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
  };
}

/** The user's own live sessions, current first, then most recently active. */
async function listForUser(user, currentSid) {
  const rows = await sys(() => UserSessions.find(activeFilter(user), { _id: 0 }).sort({ last_seen_at: -1 }).limit(100).lean());
  const currentHash = currentSid ? hashSessionId(currentSid) : null;
  return rows.map((row) => present(row, currentHash)).sort((a, b) => Number(b.current) - Number(a.current));
}

// Live sockets of revoked sessions are dropped (server.js registers this).
let disconnectSessions = null;
const setDisconnector = (fn) => { disconnectSessions = fn; };
function dropSockets(ids) {
  if (!disconnectSessions || !ids.length) return;
  try {
    disconnectSessions(ids);
  } catch (error) {
    console.error('[sessions] socket disconnect failed:', error.message);
  }
}

async function revokeWhere(filter, reason) {
  const rows = await sys(() => UserSessions.find({ ...filter, revoked_at: null }, { id: 1, _id: 0 }).lean());
  if (!rows.length) return 0;
  const ids = rows.map((r) => r.id);
  await sys(() => UserSessions.updateMany({ id: { $in: ids }, revoked_at: null }, { $set: { revoked_at: new Date(), revoked_reason: reason } }));
  dropSockets(ids);
  return ids.length;
}

/** Signs one of the user's own sessions out. Returns false when it is not theirs or not live. */
async function revokeOne(user, sessionId, reason = 'signed_out') {
  const id = Number(sessionId);
  if (!Number.isInteger(id) || id <= 0) return false;
  const count = await revokeWhere({ ...activeFilter(user), id }, reason);
  return count === 1;
}

/** Signs out every session of the user except `keepSid` (if given). */
async function revokeOthers(userId, keepSid, reason) {
  const filter = { user_id: Number(userId) };
  if (keepSid) filter.session_hash = { $ne: hashSessionId(keepSid) };
  return revokeWhere(filter, reason);
}

module.exports = {
  newSessionId,
  hashSessionId,
  maskIp,
  locate,
  parseUserAgent,
  clientInfo,
  socketClientInfo,
  createSession,
  renewSession,
  findActive,
  touch,
  listForUser,
  revokeOne,
  revokeOthers,
  setDisconnector,
};
