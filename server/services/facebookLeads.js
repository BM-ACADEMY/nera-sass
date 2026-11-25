/**
 * Facebook Lead Ads (Instant Forms) per workspace.
 *
 * Each workspace connects its own Facebook Pages with Facebook Login for
 * Business. For every connected Page Getnera keeps the Page token (encrypted
 * with encryptToken, like WhatsApp tokens) and subscribes the app to the
 * Page's `leadgen` webhook field. When a person submits a Lead Form, Meta
 * calls /api/webhooks/facebook-leads; the workspace is found from the stored
 * page id only (never from names in the payload), the lead is fetched from the
 * Graph API with that Page's token and saved to that workspace.
 *
 * Off unless FACEBOOK_LEADS_ENABLED=true. The older leadgen handlers
 * (routes/leados/webhook-meta-leads.js, controllers/integrationsController.js)
 * are separate and untouched.
 */
const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const {
  FacebookLeadPages, FacebookLeadConnections, Leads, Clients, ProcessedWebhookEvents, FailedWebhooks,
} = require('../models');
const { insertIgnore, phoneTailRegex, ieq } = require('../db/mongo');
const { runAsSystem, runAsTenant, requireTenantId } = require('./tenantContext');
const { encryptToken, decryptToken } = require('./clientSecrets');
const audit = require('./audit');
const { notifyWorkspace } = require('./realtime');
const consent = require('./consent');

const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'];
const LEAD_FIELDS = 'field_data,created_time,ad_id,ad_name,adset_name,campaign_id,campaign_name,form_id,platform';
const PENDING_MINUTES = 30;
const STATE_TTL = '15m';
const PROVIDER = 'facebook_leadgen';

let graphVersion = process.env.META_GRAPH_VERSION || 'v19.0';
// server.js passes its META_GRAPH_VERSION constant here at startup.
function setGraphVersion(version) {
  if (version) graphVersion = version;
}
const graphBase = () => `https://graph.facebook.com/${graphVersion}`;

class FacebookLeadsError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// ── Configuration ──────────────────────────────────────────
const enabled = () => String(process.env.FACEBOOK_LEADS_ENABLED || '').trim().toLowerCase() === 'true';
const appId = () => String(process.env.FACEBOOK_APP_ID || '').trim();
// The Meta app that owns Facebook Login and the Page webhook. When it is the
// same app as WhatsApp, NERA_META_APP_SECRET already holds its secret.
const appSecret = () => String(process.env.FACEBOOK_APP_SECRET || process.env.NERA_META_APP_SECRET || '').trim();
const loginConfigId = () => String(process.env.FACEBOOK_LOGIN_CONFIG_ID || '').trim();
const verifyToken = () => String(process.env.FACEBOOK_LEADS_VERIFY_TOKEN || '').trim();
const apiUrl = () => String(process.env.PUBLIC_API_URL || process.env.API_URL || 'http://localhost:3601').replace(/\/+$/, '');
const appUrl = () => String(process.env.NERA_APP_URL || process.env.PORTAL_URL || 'http://localhost:5173').replace(/\/+$/, '');
const redirectUri = () => String(process.env.FACEBOOK_LEADS_REDIRECT_URI || `${apiUrl()}/api/facebook-leads/callback`).trim();
const configured = () => Boolean(appId() && appSecret());

function requireConfigured() {
  if (!configured()) {
    throw new FacebookLeadsError('Facebook connection is not set up on this server yet. Please contact Getnera support.', 'NOT_CONFIGURED', 409);
  }
}

// ── Graph API ──────────────────────────────────────────────
// appsecret_proof ties every call to this app, so a leaked token alone cannot
// be used from elsewhere through Getnera.
const proof = (token) => crypto.createHmac('sha256', appSecret()).update(token).digest('hex');

// A Meta error as a sentence a business owner can act on. Never includes tokens.
function plainGraphError(error) {
  const meta = error?.response?.data?.error;
  if (!meta) return 'Could not reach Facebook. Please try again in a few minutes.';
  if (meta.code === 190 || meta.type === 'OAuthException' && /expired|session/i.test(meta.message || '')) {
    return 'Facebook access has expired or was removed. Please reconnect Facebook.';
  }
  if ([10, 200, 210, 230, 299].includes(meta.code) || (meta.code >= 200 && meta.code < 300)) {
    return 'Facebook did not give Getnera permission for this. Reconnect Facebook and keep every permission switched on, and make sure you manage this Page.';
  }
  if (meta.code === 4 || meta.code === 17 || meta.code === 32 || meta.code === 613) {
    return 'Facebook is limiting requests right now. Please try again in a few minutes.';
  }
  return `Facebook said: ${String(meta.error_user_msg || meta.message || 'unknown error').slice(0, 200)}`;
}

async function graphGet(path, token, params = {}) {
  const res = await axios.get(`${graphBase()}/${path}`, {
    params: { ...params, appsecret_proof: proof(token) },
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000,
  });
  return res.data;
}

async function graphPost(path, token, params = {}) {
  const res = await axios.post(`${graphBase()}/${path}`, null, {
    params: { ...params, appsecret_proof: proof(token) },
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000,
  });
  return res.data;
}

async function graphDelete(path, token, params = {}) {
  const res = await axios.delete(`${graphBase()}/${path}`, {
    params: { ...params, appsecret_proof: proof(token) },
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000,
  });
  return res.data;
}

// Every Page the Facebook user manages, with Page tokens (follows paging).
async function listUserPages(userToken) {
  const pages = [];
  let after = null;
  for (let i = 0; i < 10; i += 1) {
    const data = await graphGet('me/accounts', userToken, { fields: 'id,name,access_token,tasks', limit: 100, ...(after ? { after } : {}) });
    pages.push(...(data?.data || []));
    after = data?.paging?.next ? data?.paging?.cursors?.after : null;
    if (!after) break;
  }
  return pages.filter((p) => p && p.id && p.access_token);
}

// ── OAuth connect flow ─────────────────────────────────────
const stateSecret = () => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
  return crypto.createHash('sha256').update(`${process.env.JWT_SECRET}:facebook-leads-oauth`).digest();
};

// The Facebook Login dialog URL for the current workspace.
function getAuthorizationUrl({ userId } = {}) {
  requireConfigured();
  const tenantId = requireTenantId();
  const state = jwt.sign({ t: tenantId, u: userId || null, n: crypto.randomUUID() }, stateSecret(), { expiresIn: STATE_TTL });
  const params = new URLSearchParams({
    client_id: appId(),
    redirect_uri: redirectUri(),
    state,
    response_type: 'code',
  });
  // Facebook Login for Business uses a configuration (permissions chosen in
  // the Meta dashboard); plain Facebook Login takes the scopes directly.
  if (loginConfigId()) params.set('config_id', loginConfigId());
  else params.set('scope', SCOPES.join(','));
  return `https://www.facebook.com/${graphVersion}/dialog/oauth?${params}`;
}

function verifyState(state) {
  try {
    const payload = jwt.verify(String(state || ''), stateSecret());
    if (!Number.isInteger(payload.t) || payload.t <= 0) throw new Error('bad tenant');
    return { tenantId: payload.t, userId: payload.u || null };
  } catch {
    throw new FacebookLeadsError('This Facebook sign-in link has expired. Start again from Settings > Integrations.', 'BAD_STATE');
  }
}

// Runs in the workspace's tenant context (the callback route sets it).
// Exchanges the code for a long-lived user token, checks the permissions and
// keeps the list of Pages for the owner to choose from.
async function handleOAuthCode(code, { userId } = {}) {
  requireConfigured();
  requireTenantId();
  let userToken;
  try {
    const short = await axios.get(`${graphBase()}/oauth/access_token`, {
      params: { client_id: appId(), client_secret: appSecret(), redirect_uri: redirectUri(), code },
      timeout: 15000,
    });
    const long = await axios.get(`${graphBase()}/oauth/access_token`, {
      params: { grant_type: 'fb_exchange_token', client_id: appId(), client_secret: appSecret(), fb_exchange_token: short.data?.access_token },
      timeout: 15000,
    });
    userToken = long.data?.access_token || short.data?.access_token;
  } catch (error) {
    throw new FacebookLeadsError(plainGraphError(error), 'TOKEN_EXCHANGE_FAILED');
  }
  if (!userToken) throw new FacebookLeadsError('Facebook did not return an access token. Please try again.', 'NO_TOKEN');

  let pages;
  try {
    const granted = await graphGet('me/permissions', userToken);
    const ok = new Set((granted?.data || []).filter((p) => p.status === 'granted').map((p) => p.permission));
    const missing = SCOPES.filter((scope) => !ok.has(scope));
    if (missing.length) {
      throw new FacebookLeadsError(`Some permissions were switched off (${missing.join(', ')}). Connect again and keep every permission switched on so Getnera can receive your leads.`, 'SCOPE_DENIED');
    }
    pages = await listUserPages(userToken);
  } catch (error) {
    if (error instanceof FacebookLeadsError) throw error;
    throw new FacebookLeadsError(plainGraphError(error), 'PAGES_FAILED');
  }
  if (!pages.length) {
    throw new FacebookLeadsError('We could not find any Facebook Pages you manage. Make sure you chose at least one Page when Facebook asked, then try again.', 'NO_PAGES');
  }

  const enc = encryptToken(userToken);
  const fields = {
    user_token_enc: enc.wa_access_token_enc,
    user_token_last4: enc.wa_token_last4,
    pending_pages: pages.map((p) => ({ id: String(p.id), name: String(p.name || p.id) })),
    pending_expires_at: new Date(Date.now() + PENDING_MINUTES * 60 * 1000),
    connected_by: userId || null,
    updated_at: new Date(),
  };
  const existing = await FacebookLeadConnections.findOne({}, { _id: 1 }).lean();
  if (existing) await FacebookLeadConnections.updateOne({ _id: existing._id }, { $set: fields });
  else await FacebookLeadConnections.create(fields);
  return fields.pending_pages.length;
}

const pageView = (row) => ({
  page_id: row.page_id,
  page_name: row.page_name,
  status: row.status,
  subscribed: Boolean(row.subscribed),
  last_lead_at: row.last_lead_at || null,
  leads_received: row.leads_received || 0,
  last_error: row.last_error || null,
  last_error_at: row.last_error_at || null,
  connected_at: row.connected_at || null,
});

// What Settings > Integrations shows. Never includes a token.
async function getStatus() {
  requireTenantId();
  const [pages, pending] = await Promise.all([
    FacebookLeadPages.find({}, { _id: 0, page_token_enc: 0 }).sort({ connected_at: 1 }).lean(),
    FacebookLeadConnections.findOne({}, { _id: 0, user_token_enc: 0 }).lean(),
  ]);
  const pendingLive = pending && pending.pending_expires_at && new Date(pending.pending_expires_at) > new Date();
  const lastLead = pages.reduce((latest, p) => (p.last_lead_at && (!latest || p.last_lead_at > latest) ? p.last_lead_at : latest), null);
  return {
    enabled: true,
    configured: configured(),
    connected: pages.length > 0,
    pages: pages.map(pageView),
    last_lead_at: lastLead,
    pending: pendingLive ? {
      pages: (pending.pending_pages || []).map((p) => ({ id: p.id, name: p.name, connected: pages.some((c) => c.page_id === p.id) })),
      expires_at: pending.pending_expires_at,
    } : null,
  };
}

// Connects the chosen Pages from the pending sign-in: stores each Page token
// encrypted and subscribes the app to the Page's leadgen field.
async function connectPages(pageIds, { userId = null, req = null } = {}) {
  requireConfigured();
  const tenantId = requireTenantId();
  const wanted = [...new Set((Array.isArray(pageIds) ? pageIds : []).map(String).filter(Boolean))];
  if (!wanted.length) throw new FacebookLeadsError('Choose at least one Page to connect.', 'NO_PAGES_CHOSEN');
  const pending = await FacebookLeadConnections.findOne({}).lean();
  if (!pending || !pending.user_token_enc || !(new Date(pending.pending_expires_at) > new Date())) {
    throw new FacebookLeadsError('Your Facebook sign-in has expired. Click "Connect Facebook" again.', 'NO_PENDING', 409);
  }
  const offered = new Map((pending.pending_pages || []).map((p) => [String(p.id), p.name]));
  const userToken = decryptToken(pending.user_token_enc);
  if (!userToken) throw new FacebookLeadsError('Your Facebook sign-in could not be read. Click "Connect Facebook" again.', 'BAD_PENDING', 409);

  let livePages;
  try {
    livePages = new Map((await listUserPages(userToken)).map((p) => [String(p.id), p]));
  } catch (error) {
    throw new FacebookLeadsError(plainGraphError(error), 'PAGES_FAILED');
  }

  const connected = [];
  const errors = [];
  for (const pageId of wanted) {
    const page = livePages.get(pageId);
    const name = page?.name || offered.get(pageId) || pageId;
    if (!offered.has(pageId) || !page) {
      errors.push({ page_id: pageId, page_name: name, error: 'This Page was not in your Facebook sign-in. Connect Facebook again and choose it there.' });
      continue;
    }
    // A Page can feed one workspace only.
    const owner = await runAsSystem(() => FacebookLeadPages.findOne({ page_id: pageId }, { _id: 0, tenant_id: 1 }).lean(), 'facebook-leads-page-owner');
    if (owner && Number(owner.tenant_id) !== tenantId) {
      errors.push({ page_id: pageId, page_name: name, error: 'This Page is already connected to another Getnera workspace. Disconnect it there first.' });
      continue;
    }
    try {
      await graphPost(`${pageId}/subscribed_apps`, page.access_token, { subscribed_fields: 'leadgen' });
    } catch (error) {
      errors.push({ page_id: pageId, page_name: name, error: plainGraphError(error) });
      continue;
    }
    const enc = encryptToken(page.access_token);
    const set = {
      page_name: name,
      page_token_enc: enc.wa_access_token_enc,
      page_token_last4: enc.wa_token_last4,
      subscribed: true,
      status: 'connected',
      last_error: null,
      last_error_at: null,
      connected_by: userId,
      updated_at: new Date(),
    };
    try {
      if (owner) await FacebookLeadPages.updateOne({ page_id: pageId }, { $set: set });
      else await FacebookLeadPages.create({ page_id: pageId, connected_at: new Date(), leads_received: 0, ...set });
    } catch (error) {
      if (error.code === 11000) {
        errors.push({ page_id: pageId, page_name: name, error: 'This Page is already connected to another Getnera workspace. Disconnect it there first.' });
        continue;
      }
      throw error;
    }
    await audit.record(audit.EVENTS.FACEBOOK_PAGE_CONNECTED, { tenantId, req, targetType: 'facebook_page', targetId: pageId, meta: { page_name: name } });
    connected.push(pageId);
  }

  // The user token is only needed to list Pages; drop it once Pages are saved.
  if (connected.length) await FacebookLeadConnections.deleteMany({});
  return { connected, errors };
}

// Unsubscribes the app from the Page and deletes its stored token.
async function disconnectPage(pageId, { req = null } = {}) {
  const tenantId = requireTenantId();
  const page = await FacebookLeadPages.findOne({ page_id: String(pageId) }).lean();
  if (!page) throw new FacebookLeadsError('This Page is not connected to your workspace.', 'NOT_FOUND', 404);
  let warning = null;
  const token = decryptToken(page.page_token_enc);
  if (token && configured()) {
    try {
      await graphDelete(`${page.page_id}/subscribed_apps`, token);
    } catch (error) {
      warning = `Disconnected in Getnera, but Facebook did not confirm it: ${plainGraphError(error)} You can also remove Getnera under your Page's Settings > Business integrations.`;
    }
  }
  await FacebookLeadPages.deleteOne({ page_id: page.page_id });
  await audit.record(audit.EVENTS.FACEBOOK_PAGE_DISCONNECTED, { tenantId, req, targetType: 'facebook_page', targetId: page.page_id, meta: { page_name: page.page_name, unsubscribed: !warning } });
  return { disconnected: page.page_id, warning };
}

async function disconnectAll({ req = null } = {}) {
  requireTenantId();
  const pages = await FacebookLeadPages.find({}, { _id: 0, page_id: 1 }).lean();
  const warnings = [];
  for (const page of pages) {
    const result = await disconnectPage(page.page_id, { req });
    if (result.warning) warnings.push(result.warning);
  }
  await FacebookLeadConnections.deleteMany({});
  return { disconnected: pages.map((p) => p.page_id), warnings };
}

async function cancelPending() {
  requireTenantId();
  await FacebookLeadConnections.deleteMany({});
}

// ── Webhook ────────────────────────────────────────────────
function isValidVerifyToken(token) {
  const expected = verifyToken();
  if (!expected) return false;
  const a = Buffer.from(String(token || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Leads are processed after Meta has its 200. Tests (and shutdown) can wait.
const inFlight = new Set();
function track(promise) {
  inFlight.add(promise);
  promise.finally(() => inFlight.delete(promise));
  return promise;
}
async function whenIdle() {
  while (inFlight.size) await Promise.allSettled([...inFlight]);
}

function handleWebhookBody(body) {
  return track(processWebhook(body).catch((error) => console.error('[Facebook Leads] Webhook processing failed:', error.message)));
}

async function processWebhook(body) {
  if (body?.object !== 'page') return;
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change?.field !== 'leadgen') continue;
      const pageId = String(change.value?.page_id || entry.id || '');
      const leadgenId = String(change.value?.leadgen_id || '');
      if (!pageId || !leadgenId) continue;
      try {
        await processLeadgen({ pageId, leadgenId, formId: change.value?.form_id });
      } catch (error) {
        console.error(`[Facebook Leads] Lead ${leadgenId} from page ${pageId} failed:`, error.message);
      }
    }
  }
}

const digitsOnly = (value) => String(value || '').replace(/\D/g, '');
const firstValue = (field) => (Array.isArray(field?.values) ? field.values[0] : field?.values);
const KNOWN = new Set(['full_name', 'first_name', 'last_name', 'phone_number', 'email']);
const CONSENT_QUESTION = /whatsapp|consent|opt[_-]?in|marketing|agree/i;
const CONSENT_NO = /^(no|false|0|never|decline|declined|இல்லை)$/i;
const label = (name) => String(name || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

// Meta's lead into Getnera's lead fields. Standard questions map to name,
// phone and email; every other answer is kept in lead_form_answers and notes.
function mapLead(metaLead) {
  const fields = {};
  const answers = [];
  for (const f of metaLead?.field_data || []) {
    const key = String(f?.name || '').trim();
    if (!key) continue;
    const value = String(firstValue(f) ?? '').trim();
    fields[key.toLowerCase()] = value;
    if (!KNOWN.has(key.toLowerCase()) && value) answers.push({ question: key, answer: value });
  }
  const name = fields.full_name || [fields.first_name, fields.last_name].filter(Boolean).join(' ').trim() || '';
  // Same format as the rest of the app: digits only, country code as given.
  const phone = digitsOnly(fields.phone_number);
  const email = (fields.email || '').toLowerCase() || null;
  const platform = String(metaLead?.platform || '').toLowerCase();
  const source = platform === 'ig' || platform === 'instagram' ? 'instagram' : 'facebook';
  return { name, phone: phone.length >= 7 ? phone : '', email, answers, source, platform: platform || null };
}

function answersNote(answers, { formId, source }) {
  if (!answers.length) return '';
  const where = source === 'instagram' ? 'Instagram' : 'Facebook';
  return [`${where} lead form${formId ? ` (form ${formId})` : ''} answers:`, ...answers.map((a) => `- ${label(a.question)}: ${a.answer}`)].join('\n');
}

async function markPageError(pageId, message) {
  await FacebookLeadPages.updateOne({ page_id: pageId }, { $set: { status: 'error', last_error: message, last_error_at: new Date(), updated_at: new Date() } }).catch(() => {});
}

async function processLeadgen({ pageId, leadgenId, formId }) {
  // The workspace comes from the stored page id only.
  const page = await runAsSystem(
    () => FacebookLeadPages.findOne({ page_id: pageId }, { _id: 0, tenant_id: 1, page_id: 1, page_name: 1, page_token_enc: 1 }).lean(),
    'facebook-leads-page-lookup',
  );
  if (!page || !page.tenant_id) {
    console.warn(`[Facebook Leads] Ignored lead ${leadgenId}: page ${pageId} is not connected to any workspace`);
    return { ignored: 'unknown_page' };
  }
  const tenantId = Number(page.tenant_id);

  return runAsTenant(tenantId, async () => {
    // Idempotent on leadgen_id: Meta may deliver the same lead more than once.
    if (await Leads.exists({ leadgen_id: leadgenId })) return { ignored: 'duplicate' };
    const claim = await insertIgnore(ProcessedWebhookEvents, { provider: PROVIDER, event_id: leadgenId, created_at: new Date() });
    if (!claim) return { ignored: 'duplicate' };
    const release = () => ProcessedWebhookEvents.deleteOne({ provider: PROVIDER, event_id: leadgenId }).catch(() => {});
    try {
      return await saveLead({ page, pageId, leadgenId, formId, tenantId, release });
    } catch (error) {
      // Not saved: a redelivery of this lead may try again.
      await release();
      throw error;
    }
  });
}

// Inside the workspace's tenant context, after the leadgen_id was claimed.
async function saveLead({ page, pageId, leadgenId, formId, tenantId, release }) {
  const token = decryptToken(page.page_token_enc);
  if (!token) {
    await release();
    await markPageError(pageId, 'The stored Facebook access for this Page could not be read. Please reconnect Facebook.');
    return { ignored: 'no_token' };
  }

  let metaLead;
  try {
    metaLead = await graphGet(leadgenId, token, { fields: LEAD_FIELDS });
  } catch (error) {
    await release();
    const message = plainGraphError(error);
    await markPageError(pageId, `A new lead could not be downloaded. ${message}`);
    await FailedWebhooks.create({
      page_id: pageId, leadgen_id: leadgenId, payload: { page_id: pageId, leadgen_id: leadgenId, form_id: formId || null },
      error_message: message, status: 'failed', created_at: new Date(),
    }).catch(() => {});
    return { failed: message };
  }

  const mapped = mapLead(metaLead);
  if (!mapped.phone && !mapped.email) {
    console.warn(`[Facebook Leads] Lead ${leadgenId} has no phone number or email; not saved`);
    await markPageError(pageId, 'A lead arrived without a phone number or email, so it was not saved. Add a phone number question to your Lead Form.');
    return { ignored: 'no_contact' };
  }

  const brand = await Clients.findOne({}, { _id: 0, id: 1 }).lean();
  const now = new Date();
  const resolvedFormId = String(metaLead.form_id || formId || '') || null;
  const meta = {
    leadgen_id: leadgenId,
    meta_lead_id: leadgenId,
    lead_ad_form_id: resolvedFormId,
    ad_id: metaLead.ad_id ? String(metaLead.ad_id) : null,
    ad_name: metaLead.ad_name || null,
    adset_name: metaLead.adset_name || null,
    campaign_id: metaLead.campaign_id ? String(metaLead.campaign_id) : null,
    campaign_name: metaLead.campaign_name || null,
    facebook_page_id: pageId,
    lead_form_platform: mapped.platform,
    lead_form_submitted_at: metaLead.created_time ? new Date(metaLead.created_time) : now,
    lead_form_answers: mapped.answers,
  };
  const note = answersNote(mapped.answers, { formId: resolvedFormId, source: mapped.source });

  // One contact per phone number in this workspace (last 10 digits, as the
  // rest of the app matches phones); email when there is no phone.
  const existing = mapped.phone
    ? await Leads.findOne({ phone: phoneTailRegex(mapped.phone) }, { _id: 0, id: 1, name: 1, email: 1, notes: 1 }).sort({ created_at: -1 }).lean()
    : await Leads.findOne({ email: ieq(mapped.email) }, { _id: 0, id: 1, name: 1, email: 1, notes: 1 }).sort({ created_at: -1 }).lean();

  let leadId;
  let isNew = false;
  if (existing) {
    const set = { ...meta, last_activity: now, updated_at: now };
    if (mapped.name && (!existing.name || existing.name === 'Unknown')) set.name = mapped.name;
    if (mapped.email && !existing.email) set.email = mapped.email;
    if (note) set.notes = existing.notes ? `${existing.notes}\n\n${note}` : note;
    await Leads.updateOne({ id: existing.id }, { $set: set });
    leadId = existing.id;
  } else {
    const created = await Leads.create({
      name: mapped.name || 'Facebook lead',
      phone: mapped.phone || null,
      email: mapped.email,
      source: mapped.source,
      status: 'new',
      score: 20,
      client_id: brand?.id ?? null,
      notes: note || null,
      ...meta,
      last_activity: now,
      created_at: now,
      updated_at: now,
    });
    leadId = created.id;
    isNew = true;
  }

  // A form question about WhatsApp / consent / opt-in records the contact's
  // marketing opt-in with the answer given. No such question: no consent.
  const consentAnswer = mapped.answers.find((a) => CONSENT_QUESTION.test(a.question));
  if (consentAnswer && mapped.phone && !CONSENT_NO.test(consentAnswer.answer)) {
    await consent.recordOptIn({
      leadId, phone: mapped.phone, source: 'lead_form',
      text: `Facebook lead form ${resolvedFormId || ''}: ${label(consentAnswer.question)}: ${consentAnswer.answer}`.replace(/\s+/g, ' ').trim(),
    }).catch((error) => console.error('[Facebook Leads] Consent not recorded:', error.message));
  }

  await FacebookLeadPages.updateOne({ page_id: pageId }, {
    $set: { last_lead_at: now, status: 'connected', last_error: null, last_error_at: null, updated_at: now },
    $inc: { leads_received: 1 },
  });
  await audit.record(audit.EVENTS.FACEBOOK_LEAD_RECEIVED, {
    tenantId,
    actor: { actor_type: 'system', actor_user_id: null, ip: null },
    targetType: 'lead',
    targetId: leadId,
    meta: { page_id: pageId, leadgen_id: leadgenId, form_id: resolvedFormId, source: mapped.source, merged_into_existing: !isNew },
  });
  notifyWorkspace('lead_created', { lead_id: leadId, source: mapped.source, merged: !isNew });

  // Same welcome hook as a lead added by hand; n8n sends through Getnera.
  if (isNew && mapped.phone && process.env.N8N_NEW_LEAD_WEBHOOK_URL && process.env.NODE_ENV !== 'test') {
    require('./n8n').postToN8n(process.env.N8N_NEW_LEAD_WEBHOOK_URL, {
      lead_id: leadId, tenant_id: tenantId, name: mapped.name || 'Facebook lead', phone: mapped.phone, client_id: brand?.id ?? null,
    }).catch((error) => console.error('[Facebook Leads] n8n welcome hook failed:', error.message));
  }
  return { lead_id: leadId, created: isNew };
}

module.exports = {
  SCOPES,
  LEAD_FIELDS,
  FacebookLeadsError,
  enabled,
  configured,
  appUrl,
  setGraphVersion,
  getAuthorizationUrl,
  verifyState,
  handleOAuthCode,
  getStatus,
  connectPages,
  disconnectPage,
  disconnectAll,
  cancelPending,
  isValidVerifyToken,
  appSecret,
  handleWebhookBody,
  processLeadgen,
  whenIdle,
  mapLead,
  plainGraphError,
};
