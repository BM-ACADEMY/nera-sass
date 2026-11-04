# WhatsApp reuse map: LeadOS → Getnera (Nera)

Read-only analysis. No code in either repo was changed. Method: static reading and grep of `BM-ACADEMY/leados-app` (`server/`) and this repo (`server/`). Nothing was run, so every finding is "what the code says", not "what production does". Line numbers refer to the branch heads at the time of writing and will drift.

## 0. The headline finding

**Nera is not a blank slate. It is a hardened fork of the LeadOS server, ported from Postgres to MongoDB (Mongoose) with a tenant layer.** The LeadOS monolith `server/server.js` (5,925 lines) was split into `server/routes/leados/*.js` in this repo, and most of the WhatsApp code you would want to "extract" already exists here, with several of the LeadOS security holes already closed (webhook signature, encrypted tokens, tenant scoping, authenticated media proxy).

So the real question is not "what do we copy from LeadOS?" but "what is still unported, still unsafe, or still single-tenant in Nera?". Sections 2 and 3 answer that. Section 1 is the LeadOS inventory with an "In Nera?" column so you can see which rows are already done.

Other facts that shape the plan:

- **Stack mismatch.** LeadOS = Express + Postgres (`pg`, raw SQL). Nera = Express + Mongoose, with tenant scoping enforced by `db/tenantScope.js` and `services/tenantContext.js`. LeadOS SQL cannot be reused verbatim. Anything shared would have to be DB-agnostic.
- **Thedal has no WhatsApp code.** In `leados-app`, no `thedal*.js` route sends or receives WhatsApp (the only hit is a "Connect on WhatsApp" link in generated HTML in `thedal-content.js:235`). A shared messaging service "for LeadOS, Thedal and Getnera" would currently have only two real consumers.
- **LeadOS has two WhatsApp systems on two numbers.** (a) The "LeadOS" system on `WA_PHONE_NUMBER_ID`/`META_PAGE_ACCESS_TOKEN`, with per-brand rows in `clients`. (b) The "AllianceOS" system (`alliance_*` tables, `ALLIANCE_WA_*` env vars), a separate inbox, campaign worker and AI nudges for BM Academy's own prospecting. Nera inherited both.

---

## 1. LeadOS WhatsApp module inventory

Paths are in `leados-app/server/`. "Clean" = how self-contained the code is. Verdicts are from the point of view of Getnera.

| # | File / location | What it does | Clean? | In Nera? | Verdict |
|---|---|---|---|---|---|
| 1 | `server.js` ~2899–3330 `GET/POST /webhook/whatsapp` | Main inbound webhook: messages, statuses, template-status updates, media, voice notes, click-to-WhatsApp ad referrals, lead/conversation upsert, AI reply scheduling | **Tangled.** Webhook parsing, lead CRM writes, AI scheduling, n8n forwarding and Alliance routing all in one ~430-line handler. Uses in-memory `aiReplyQueue`. | Ported to `routes/leados/webhook-whatsapp.js` (476 lines) with signature check, tenant resolution by `phone_number_id`, `runAsTenant` | **Already in Nera. Do not re-copy.** Finish cleaning there. |
| 2 | `server.js` ~4866–4940 `/api/webhooks/meta` | Second, older webhook: updates `campaign_logs` status, inserts inbound messages | Tangled and buggy (looks only at `entry[0].changes[0]`, matches leads by last 10 digits across all brands) | Ported as `routes/leados/webhook-meta.js` (90 lines) | **Leave / delete.** Duplicate of #1. Make sure Nera's copy is signature-checked or removed. |
| 3 | `server.js` ~3337–3460 `/webhook/meta-leads`, `~3463 /api/meta/pages/:id/subscribe` | Facebook/Instagram Lead Ads → leads | Lead-gen, not messaging. Reuses `WA_VERIFY_TOKEN` and the global WA token | `webhook-meta-leads.js` | **Leave** for the WhatsApp service; separate feature. |
| 4 | `server.js` ~2563–2900 `sendWhatsAppTextOrMedia`, `POST /api/whatsapp/send` | Send text/media/reply/forward, 24h-window check, wake-up template when window closed, hold message in `pendingManualMessages` | Mostly clean sender, but window logic, SQL and Socket.IO emit are mixed in. Pending queue is an in-memory `Map` (lost on restart, wrong with >1 instance) | `routes/leados/whatsapp.js` (240 lines), sender token comes from the client row | **Reuse with changes.** Move pending queue to the DB. |
| 5 | `server.js` ~1738–1870 `check-24h`, `send-template` | 24h window check; send an approved template to a lead | Clean | `routes/leados/followups.js` | **Reuse with changes** (see Nera env fallback in §3). |
| 6 | `server.js` ~3629–4080 `/api/templates*` | Template CRUD, submit to Meta, sync status, bulk scope, media upload via resumable upload | Moderately clean Graph logic, but tied to `clients` and LeadOS-vs-Alliance token selection (`isAllianceTemplate`) | `routes/leados/templates.js` + `services/metaTemplateApi.js` (196 lines) + `routes/adminTemplates.js` + `routes/leados/wa-templates.js` (customer template manager) | **Partly rewritten in Nera already.** Prefer `metaTemplateApi.js`; retire the `templates.js` env fallbacks. |
| 7 | `server.js` ~107–260 Graph helpers (`graphPageData`, profile sync, inventory sync) | Business profile sync, WABA/phone inventory | Clean helpers, but env-token driven | `adminMetaInventory.js`, `adminWhatsappProfile.js`, `metaInventoryCredentials.js` | **Already in Nera** (staff-only, uses `META_INVENTORY_ACCESS_TOKEN`). |
| 8 | `server.js` ~4084–4135 Embedded Signup config and `…/meta-embedded-signup/complete` | Returns app/config id; "completes" signup by trusting `waba_id`/`phone_number_id` from the browser | **Not a real Embedded Signup.** No `code` → token exchange, no per-customer token stored, uses the platform token, locked to one `WA_BUSINESS_ACCOUNT_ID` | Nera deliberately paused it (`routes/leados/clients.js:50-64`, `SECURE_SIGNUP_PENDING`) | **Rewrite.** This is the main missing feature (§5). Frontend helper `src/utils/metaEmbeddedSignup.js` (also in `client/src/utils/`) is a usable starting point for the FB SDK popup only. |
| 9 | `server.js` ~4246–4520 phone register/map/`whatsapp-setup`, `deregister` | Register number with PIN, map phone to client, setup | Env-driven (`WA_REGISTRATION_PIN` single PIN) | `adminMetaInventory.js` (registration off unless `META_PHONE_REGISTRATION_ENABLED=true`) | **Rewrite** for per-tenant PIN/flow. |
| 10 | `server.js` ~4985–5300 campaign launch + sender loop | Bulk template sends per campaign, writes `campaign_logs` | Tangled: SQL, throttling, CSV recipient batches, token fallback in one function | `routes/leados/campaigns.js` (264 lines), models `Campaigns`, `CampaignLogs`, `CampaignMessageQueue`, `CampaignRateStats` | **Reuse with changes** (queue-based, per-tenant rate limits). |
| 11 | `server.js` 1172 `GET /api/whatsapp-media/:mediaId` | Proxy for inbound media | Tiny, clean | Nera version requires auth and uses the tenant's token (`server.js:1178`) | **Already fixed in Nera**; see §4 for remaining issues. |
| 12 | `server.js` ~1268–1500 inbox + message edit/pin/star/react/upload | Agent inbox API | CRM-coupled | `routes/leados/inbox.js`, `messages.js` | **Already in Nera.** |
| 13 | `routes/chatbot.js` | n8n-called chatbot flow engine; sends with `lead.wa_phone_number_id` | Tangled with flow tables | `routes/chatbot.js` | **Leave** (not core to Getnera v1). |
| 14 | `routes/salesos.js` (3,239 lines) | Sales OS: lead upsert on inbound, AI qualification, sends, founder alerts via WhatsApp | **Very tangled** LeadOS business logic; env-token sends at 1577, 1663, 2139, 2280, 2795 | Ported (3,197 lines), still has env fallbacks | **Leave** as a source of ideas only. Do not extract. |
| 15 | `routes/alliance-inbox-v2.js` (746) | Alliance inbox: webhook, contacts, conversations, media, send, templates | Self-contained for Alliance but hard-wired to ONE number (`alliance_inbox_settings`, env token names) | `routes/alliance-inbox-v2.js` (812) | **Rewrite as a tenant-aware inbox** or fold into `platformInbox`/`leados/inbox`. Do not copy. |
| 16 | `routes/alliance.js` (3,191) WhatsApp bits: consent sources (23), CSV audience import with consent columns, campaign sender (~2630–2650) | Alliance campaigns with an explicit consent model | Tangled | Ported + migration `029_alliance_consent_audit.sql` | **Copy the consent model only** (see §5), not the file. |
| 17 | `services/alliance-whatsapp-campaign-worker.js` (332) | Background worker for WhatsApp campaigns with approved-consent filter | Fairly self-contained, but reads `process.env[settings.access_token_env]` | Ported (562 lines, grown) | **Reuse with changes** (token per tenant). Good candidate for the shared worker. |
| 18 | `services/alliance-ai-nudge-worker.js`, `alliance-welcome.js` | AI follow-up nudges, welcome template | Self-contained, env token | Ported | **Reuse with changes** |
| 19 | `routes/alliance-external-api.js` (262) `ALL /api/alliance/external/whatsapp/send` | Public "send a WhatsApp via API key" endpoint | Self-contained but unsafe (§4) | **Not ported.** | **Rewrite** if you want an API product (per-tenant API keys). Do not copy. |
| 20 | `services/aiBrain.js`, `alliance-brain-context.js`, `alliance-prompt-rules.js`, `responseGuard`-like logic | Prompt building, KB context for AI replies | Brand-specific (BM Academy syllabus, ABM prompts) | Nera has its own `brainEngine.js`, `brainPrompt.js`, `responseGuard.js`, `aiAutomation.js` | **Leave.** Nera's customer AI Brain supersedes it. |
| 21 | `services/voice-note-encoder.js` | Convert audio to OGG/Opus for WhatsApp voice notes | **Clean, pure** | Ported | **Reuse as-is** (already there). |
| 22 | `services/web-push.js`, Socket.IO emits | Browser push on inbound | Clean | `realtime.js` | Leave. |
| 23 | `n8n_workflows` / `leados-workflows-final`, `allience/allianceos_n8n` | WF00 inbound integrator, welcome, follow-up, AI reply, callback relay | Hard-coded n8n host in LeadOS | `n8n_workflows/WF1…WF4` | **Reuse with changes** only if you keep n8n; the hard-coded host is gone in Nera. |
| 24 | Frontend: `InboxWorkspace.jsx`, `TemplatesView.jsx`, `CampaignsView.jsx`, `SettingsView.jsx`, `alliance/WhatsApp*.jsx` | UI | UI only | `client/`, `admin/` | Already in Nera; out of scope. |

---

## 2. What Getnera already has (do not duplicate)

All paths relative to `server/` in this repo.

| Capability | Where | Notes |
|---|---|---|
| Webhook signature (`X-Hub-Signature-256`, HMAC-SHA256 over raw body, constant-time, fails closed) | `services/metaWebhookSignature.js`; used by `routes/leados/webhook-whatsapp.js` | Secret is `NERA_META_APP_SECRET` only, by design. Test: `test/task1b0-webhook-security.test.js`. |
| Encrypted token at rest | `services/clientSecrets.js`, `utils/crypto.js` (AES-256-GCM), `models/Clients.js` hooks | Stores `wa_access_token_enc` + `wa_token_last4`; `sanitizeClient()` strips secrets from API output. |
| Tenant model and fail-closed scoping | `services/tenantContext.js` (AsyncLocalStorage), `db/tenantScope.js`, models `Tenants`, `TenantModules` | Queries without a tenant context throw. Webhooks resolve tenant from `phone_number_id` then `runAsTenant`. Tests: `tenant-isolation`, `webhook-tenant-context`. |
| One brand/WABA connection per tenant | `models/Clients.js` (`unique: [['tenant_id']]`) | Also the main limit: one number per tenant. |
| Platform (Getnera's own) WhatsApp inbox | `services/platformInbox.js`, `routes/adminInbox.js`, models `PlatformWaContacts/Messages` | Separate from customer inboxes; webhook diverts platform-number events first. |
| Meta inventory (WABAs, phone numbers, sync runs, assign to tenant, subscribe WABA webhook) | `routes/adminMetaInventory.js`, `services/metaInventoryCredentials.js`, models `MetaWhatsapp*` | Uses `META_INVENTORY_ACCESS_TOKEN` only; refuses to use the old leaked tokens. |
| Template management (staff and customer) | `services/metaTemplateApi.js`, `routes/adminTemplates.js`, `routes/leados/wa-templates.js`, `services/templateBuilder.js`, model `MetaWhatsappTemplates` | Includes review timing and status webhook handling. |
| Business profile management | `routes/adminWhatsappProfile.js` | |
| Encrypted media storage | `services/mediaStore.js`, `../mediaserver/` | Tenant media proxy `GET /api/whatsapp-media/:mediaId` (`server.js:1178`). |
| AI replies (customer "AI Brain") | `services/brainEngine.js`, `brainPrompt.js`, `aiAutomation.js`, `responseGuard.js`, `routes/leados/brain.js`, `n8n_workflows/WF1B` | Includes opt-out detection (`brainEngine.js:220`), handover and pause. |
| Opt-in / opt-out fields | `models/Leads.js` (`whatsapp_opt_in(_at)`, `whatsapp_opt_out(_at)`, `opted_out`); `routes/leados/internal.js:241` excludes opted-out leads | Fields exist; capture and enforcement are partial (§5). |
| Campaigns | `routes/leados/campaigns.js`, models `Campaigns`, `CampaignLogs`, `CampaignMessageQueue`, `CampaignRateStats` | |
| Workflow audit log, entitlements, usage, MFA, audit | `services/workflowLog.js`, `entitlements.js`, `usage/`, `mfa.js`, `audit.js` | |

---

## 3. Multi-tenancy gaps (single-account assumptions)

### 3a. In LeadOS (what NOT to inherit)

LeadOS assumes one WhatsApp account in at least these ways:

- **Global env credentials:** `META_PAGE_ACCESS_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_BUSINESS_ACCOUNT_ID`, `META_SYSTEM_USER_ACCESS_TOKEN`, `WA_VERIFY_TOKEN`, `WA_REGISTRATION_PIN`, `FOUNDER_WHATSAPP_PHONE`, `META_APP_ID`, `META_EMBEDDED_SIGNUP_CONFIG_ID`.
- **Silent fallback to the platform account.** The pattern `client.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN` (and the `phone_number_id` twin) appears in roughly 30 places (`server.js` 861, 1451, 1780, 2443, 2702, 3079, 3191, 3285, 3668, 3765, 3886, 3995, 4057, 4777, 5170; `salesos.js` 136, 563, 1577, 2139, 2280). A brand with no token sends from the platform's number, billed to the platform. For a multi-tenant product this is both a cost leak and a compliance problem (messages leave under the wrong business identity).
- **Webhook filter** accepts the env number or any `clients.phone_number_id` (`server.js:2956`), but then downstream code often ignores which tenant matched.
- **Embedded Signup** locked to one WABA (`server.js:4097`) and uses the platform token for the new customer's number.
- **Alliance subsystem** is hard-wired to one number: `alliance_inbox_settings` plus `access_token_env`, a column holding the *name of an env var* that holds the token (`alliance-inbox-v2.js:39`, workers, `alliance-external-api.js:87`). It cannot represent a second customer.
- **JWT carries no tenant.** `jwt.sign({id,email,role,name})` (`server.js:1232`). `auth` only verifies the signature. There is no tenant claim to scope by.
- **In-memory state:** `pendingManualMessages`, `aiReplyQueue` (per-process maps).
- **Graph API version drift:** v18.0, v19.0 and `META_GRAPH_VERSION` all in use.

### 3b. Still open in Nera (found by grep, not by running)

Nera fixed the core path but these remain:

| Location (this repo, `server/`) | Gap |
|---|---|
| `routes/leados/followups.js:189-190` | AI follow-up text still sends with `META_PAGE_ACCESS_TOKEN` + `WA_PHONE_NUMBER_ID` (global), not the lead's tenant sender. Highest priority: wrong sender identity. |
| `routes/leados/templates.js:195, 254-261` | Template media upload and sync fall back to `META_PAGE_ACCESS_TOKEN` / `META_SYSTEM_USER_ACCESS_TOKEN`. `metaInventoryCredentials.js` says those are "previously exposed credentials". |
| `routes/salesos.js:1639-1640, 2802-2803` | Founder/staff WhatsApp alerts use the global token. Acceptable only as a clearly platform-scoped notifier, using its own `PLATFORM_WA_*` settings. |
| `routes/salesos.js:674`, `webhook-whatsapp.js:121` | Still compare to `WA_PHONE_NUMBER_ID` env as a "managed" number. |
| `routes/alliance*.js`, `services/alliance-*.js` | Still `ALLIANCE_WA_*` env + `access_token_env` indirection. If Alliance stays in Nera, treat it as a platform-internal module and keep it out of the customer path; if it goes, delete it. |
| `server.js:211-214` `tenantWhatsAppSender()` | Uses `Clients.findOne({})` and relies on tenant scope to pick the row. Correct only while there is exactly one `Clients` row per tenant. A second number per tenant (common for agencies/clinic chains) needs a `whatsapp_accounts` collection and an explicit `account_id` on conversations. |
| `models/Clients.js` | WABA, phone, token and brand profile live in one document. Better split: `WhatsappAccount` (waba_id, phone_number_id, encrypted token, token expiry, quality rating, messaging tier, status, webhook subscribed) separate from brand profile. |
| Token lifecycle | No field for token type (business-integration system-user token vs. short-lived), expiry, or "needs reconnect". `wa_access_token` plain field kept for legacy rows (`Clients.js`): verify none exist in production and drop it. |
| `server.js:154` | Graph version from env but several hard-coded `v18.0` in routes. Centralise in one Graph client. |
| Webhook verify token | One global `WA_VERIFY_TOKEN`. That is normal for one Meta app; just confirm `NERA_META_APP_SECRET` belongs to the *Getnera* app, not a LeadOS/ContentOS app. |

**Target design for "per-customer, encrypted-at-rest credentials":** keep `utils/crypto.js` (AES-256-GCM). Add key versioning (`enc_key_id` prefix) so `TOKEN_ENCRYPTION_KEY` can be rotated; today a single key hashed with SHA-256 encrypts everything and a lost key loses every tenant. Put the key in a secrets manager, not `.env`. One Graph client, `graph(accountId).post(...)`, loads and decrypts the token for that account only, and is the *only* code allowed to call `graph.facebook.com` (add a lint rule or a test that greps for it).

---

## 4. Security issues in LeadOS that must NOT be copied

Severity is my judgment from reading the code.

| # | Issue | Where (LeadOS `server/`) | Severity | Status in Nera |
|---|---|---|---|---|
| 1 | **No webhook signature verification** on any WhatsApp webhook. Only the GET verify-token handshake exists; POST bodies are trusted. Anyone who knows the URL can forge inbound messages, create leads, trigger AI replies and status changes. `req.rawBody` is captured (`server.js:1016`) but only used for Razorpay. | `server.js:2913`, `4883`, `3343`; `alliance-inbox-v2.js:256` | **Critical** | Fixed on `/webhook/whatsapp` (`metaWebhookSignature.js`). **Verify** `webhook-meta.js`, `webhook-meta-leads.js` and `alliance-inbox-v2.js` also use it. |
| 2 | **Hard-coded secret fallback:** `process.env.META_CONTENT_OS_APP_SECRET \|\| process.env.META_APP_SECRET \|\| '<literal 24-char secret>'` | `controllers/contentController.js:1974` | **Critical** (treat that value as leaked; rotate it) | Check `nera-sass/server/controllers/contentController.js` and remove; Nera's signature module explicitly bans fallbacks. |
| 3 | **Hard-coded DB password fallback** (`process.env.DB_PASS || '<literal>'`) in ~15 scripts/routes (`setup-gaphunter-db.js`, `seed-limits.js`, `migrate_header.js`, many `thedal-*` routes…) and a default `postgres` credential pair in one. | many | High | Do not copy any of these files. |
| 4 | **Seeded admin account with a hard-coded password**, printed to the console on setup | `setup-db.js:220-226, 321` | High | Do not copy `setup-db.js`. |
| 5 | **Unauthenticated media proxy** using the global WA token, response `Cache-Control: public, max-age=31536000`. Any media id is fetchable by anyone; ids are guessable only by Meta, but the proxy is still an open oracle on the platform token. | `server.js:1172` | High | Fixed (auth + tenant token). Remaining: JWT passed in `?token=` ends up in logs and referrers; use short-lived signed media URLs, and `Cache-Control: private`. |
| 6 | **Unauthenticated routes touching WhatsApp data:** `GET /api/templates/:id/campaign-sheet`, `GET /api/leads/template` have no `auth`; `/api/chatbot` mounted without `auth`; `/api/knowledge` mounted without auth ("let's check auth middleware later"). `/api/mafiya/gmb` has no auth by design. | `server.js:1541, 1559, 1062, 1066, 1152` | Medium–High | Re-check Nera mounts. |
| 7 | **No tenant scoping anywhere.** `auth` only verifies a JWT with no tenant claim. `GET /api/campaigns` selects every campaign with no `WHERE`; the `/webhook/whatsapp` inbound path and the `/api/webhooks/meta` handler match leads by *last 10 digits of the phone across all brands*. Cross-customer data exposure by design. (`docs/thedal-audit.md` records the same for Thedal.) | `server.js:4980`, `4912-4930` | **Critical for SaaS** | Replaced by `tenantScope`. Re-test every ported route; the 3,000-line `salesos.js` and `alliance.js` are the likeliest to have raw un-scoped queries. |
| 8 | **Public "send WhatsApp" API with a single shared key.** `router.all` (GET works), key accepted from the **query string** (ends up in logs/proxies), one global `ALLIANCE_EXTERNAL_API_KEY`, no rate limit, no per-key audit, sends from the platform number. | `routes/alliance-external-api.js:40-70` | High | Not ported. Keep it that way. If you want an API product, build per-tenant hashed API keys with scopes and rate limits. |
| 9 | **Internal-key check that fails open:** `relayAuthorized = !expected \|\| header === expected`. If `INTERNAL_API_KEY` is unset, the Alliance webhook accepts anyone. Also compares with `===` (not constant-time). | `alliance-inbox-v2.js:41`, ported unchanged to Nera `alliance-inbox-v2.js:56` | High | **Still open in Nera.** Fail closed and add the HMAC check. |
| 10 | **Raw webhook payloads written to disk and forwarded to a hard-coded third-party host.** Full payloads (phone numbers, message text) appended to `uploads/incoming_payloads.log`, which is under a directory served by `express.static('/uploads')`; each payload is POSTed to `https://leados-n8n.abmgroups.org/webhook/whatsapp-inbound`; `?source=n8n` skips forwarding. | `server.js:2918, 2988-2994, 1020-1021` | High (privacy, and the log may be web-readable) | Forward hard-code removed. **Check Nera still appends payloads to `uploads/incoming_payloads.log`** (`webhook-whatsapp.js` ~line 59) and that `/uploads` is not static-served. Drop the log or redact. |
| 11 | **CORS reflects any origin with credentials:** `origin: (o, cb) => cb(null, o \|\| true)`, `credentials: true`. | `server.js:1006-1011` | Medium–High | Check Nera `server.js:56` area; use an allow-list. |
| 12 | **Tokens in plain text.** `clients.wa_access_token TEXT`; Alliance tokens in env only. JWT valid 7 days, no revocation. | `setup-db.js:38`, `server.js:1232` | High | Nera encrypts; see §3b for legacy column and key rotation. |
| 13 | **Verify token reuse.** The one `WA_VERIFY_TOKEN` also guards the Lead Ads webhook; no per-endpoint secret. | `server.js:3339` | Low | |
| 14 | **Business-logic hazards:** a default founder phone number literal in code (a real-looking personal number); `ALTER TABLE`/`CREATE TABLE IF NOT EXISTS` in request paths; Meta Graph error bodies logged verbatim. | `salesos.js:1663`; `alliance-external-api.js:10-35` | Medium | Nera's `FOUNDER_WHATSAPP_PHONE` has no default (`salesos.js:1638`). Good. |
| 15 | **Embedded Signup "complete" endpoint trusts client-supplied `waba_id`/`phone_number_id`**, checked only against what the platform token can see. | `server.js:4091-4135` | Medium | Paused in Nera. Build it properly (§5). |

---

## 5. Meta compliance checklist for selling to other businesses

Based on what the code does today. "Code" = state of this repo. Business/legal items are outside the code and are listed because they gate go-live; confirm current requirements in Meta's documentation, since programme names and review steps change.

| # | Requirement | What the code does today | Gap / action |
|---|---|---|---|
| 1 | **Business verification of Getnera's own Meta business** and an approved **Tech Provider** (or Solution Partner) status so you can onboard other businesses' WABAs | Nothing in code. Docs in `leados-app/dev_documents/` (Nera-*.md) do not describe it. | Business action. Required before Embedded Signup works for customers outside your own business. Plan lead time (weeks). |
| 2 | **Dedicated Meta app for Getnera** with WhatsApp product, webhooks subscribed (`messages`, `message_template_status_update`, quality/phone updates), **App Review** for `whatsapp_business_management` and `whatsapp_business_messaging` (Advanced Access) | App ids and secrets are env-based; `NERA_META_APP_SECRET` is Nera-only (good) | Create/confirm the app; do not share it with LeadOS/ContentOS (LeadOS shares `META_APP_SECRET` across features and has a literal fallback; see §4 #2). |
| 3 | **Embedded Signup** (Facebook Login for Business config, `FB.login` with `config_id`, receive `code` + WABA/phone ids via `WA_EMBEDDED_SIGNUP` message event, **exchange `code` server-side** for a business token, subscribe WABA to the app webhook, register the phone number, store token encrypted per tenant) | LeadOS: placeholder that trusts browser ids, uses platform token. Nera: disabled (`SECURE_SIGNUP_PENDING`). `metaEmbeddedSignup.js` front-end helper exists. `adminMetaInventory` can subscribe a WABA to the webhook. | **Build.** The main deliverable. Needs: code exchange, `debug_token` check that granted WABA matches, idempotency, error states, disconnect/offboard (unsubscribe + delete token). |
| 4 | **Per-customer credentials**, least privilege, rotation | Encrypted single token per `Clients` row, no expiry tracking | §3b. Add token type/expiry, reconnect flow, key versioning. |
| 5 | **Webhook security** | Signature check on the main WhatsApp webhook; failed deliveries stored (`FailedWebhooks` model) | Verify all webhooks; make handler idempotent on `wamid`; respond 200 fast and process async (the LeadOS handler awaits n8n and DB work inline). |
| 6 | **Template management:** create, submit, status sync, categories (Marketing/Utility/Authentication), language, quality, rejection reasons, edit limits, pause/disable on low quality | Create/submit/sync/delete exist (`metaTemplateApi.js`, `wa-templates.js`); status webhook handled; review timing tracked | Add: category selection guard (Meta can re-categorise), per-template quality and `PAUSED`/`DISABLED` handling, block campaign sends for non-`APPROVED` templates (LeadOS checks `status in (approved, active)` at campaign creation, `server.js:4960`; re-check at send time), template-per-WABA ownership (templates belong to a WABA, not a tenant row). |
| 7 | **Opt-in tracking** (consent before business-initiated messages: who, when, how, evidence, scope) | LeadOS Alliance side has a real model: `consent`, `consent_source` (whitelist at `alliance.js:23`), `consent_at`, `consent_evidence`, `consent_scope`; worker only sends to approved sources (`alliance-whatsapp-campaign-worker.js:21`). Nera migration `029_alliance_consent_audit.sql`. **LeadOS main CRM side has none**: only `opted_out` flags. Nera `Leads` has `whatsapp_opt_in/_at`, but no source/evidence/scope. | **Copy the consent model** (the one reusable *concept* from LeadOS) into `Leads`/contacts: source, timestamp, evidence reference, scope (marketing/utility), captured-by. Hard-block marketing templates when no valid opt-in. Immutable consent audit log. Click-to-WhatsApp and inbound-first messages should auto-record `inbound_whatsapp_optin`. |
| 8 | **Opt-out handling** (honour STOP and equivalents, immediately, across channels) | Nera: AI Brain detects opt-out intent (`brainEngine.js:220`) and campaigns exclude `opted_out` / `whatsapp_opt_out` (`leados/internal.js:241`). LeadOS: not found in the main webhook. | Add deterministic keyword opt-out (STOP/UNSUBSCRIBE/localised) *before* any AI step; confirm campaign queue and follow-up workers all check the flag at send time; offer customers an unsubscribe in marketing templates. |
| 9 | **24-hour customer-service window** | Implemented (`/api/whatsapp/check-24h`, window test in `leados/whatsapp.js`); wake-up template when closed; free-text queue is in memory | Persist the queue; compute window from last *inbound* message per conversation; also respect the free-entry-point 72h window from click-to-WhatsApp ads if you use it. |
| 10 | **Messaging limits and quality rating** (tier, per-number caps, quality flags, throttling) | Inventory syncs phone number status; `CampaignRateStats` exists; `alliance` has bulk-send limits | Surface quality rating and messaging tier per number in the tenant UI, auto-pause campaigns on RED quality, enforce per-tenant daily caps. Handle error codes for rate limits, 131026 (undeliverable), 131047 (re-engagement), 130429, 131056. |
| 11 | **Pricing / conversation billing** (per-message pricing, categories) | Not modelled | Record category and billable status from status webhooks (`pricing` object) per message to support usage billing and tenant invoices. |
| 12 | **Business profile and display-name approval** | `adminWhatsappProfile.js`, profile fields on `Clients` | Wire to the per-account model; show display-name review status. |
| 13 | **Data protection:** privacy policy, terms, data deletion, retention, DPA with customers | `landingpage` has Privacy/Terms pages; no deletion/retention code seen | Data-deletion callback URL for the Meta app; tenant offboarding that deletes tokens, media (`mediaserver`) and messages; message retention setting; remove raw payload log (§4 #10). |
| 14 | **Prohibited-content and commerce policy acceptance** by tenants | Not in code | Add acceptance at onboarding; keep a record per tenant. |
| 15 | **Audit trail** of sends, template changes, connect/disconnect | `services/audit.js`, `workflowLog.js` exist | Make sure connect/disconnect, token rotation and opt-in changes are audited. |

---

## 6. Recommended extraction plan

### Options

1. **Copy once.** Port the remaining pieces into Getnera and let the repos diverge.
2. **Shared messaging service** consumed by LeadOS, Thedal and Getnera.

### Recommendation: copy once, and stop copying (Option 1), with a small shared library later only if LeadOS asks for it

Reasons from the code:

- **Already done.** The fork is in this repo. Most of the value of extraction (get a clean, multi-tenant WhatsApp layer) is achieved by finishing Nera, not by re-extracting from LeadOS.
- **The two codebases cannot share a data layer.** Postgres raw SQL vs. Mongoose with ambient tenant scoping. A shared service would need its own database and an API boundary, which is a new product to build and operate, not a refactor.
- **Thedal has no WhatsApp code**, and LeadOS's WhatsApp is tangled with its CRM, Alliance and n8n. Making LeadOS a client of a shared service means rewriting its 5,925-line `server.js` send/receive paths with no new customer benefit.
- **Opposite security postures.** LeadOS has no tenant model and several critical issues (§4). Wiring it to a shared service would either import those issues or force a LeadOS rewrite.
- **Risk to revenue.** Getnera is what you will sell; LeadOS is what runs your agency today. Don't couple them.

If it later becomes worthwhile, extract a **pure, DB-less library** (not a service): a single Graph client, signature verification, webhook payload normaliser (messages/statuses/templates into typed events), template-payload builder, 24-hour-window calculator, error-code map. Most of this already exists in Getnera as `metaWebhookSignature.js`, `metaTemplateApi.js`, `templateBuilder.js`, `whatsappIdentity.js`. It could be published as an internal package and adopted by LeadOS opportunistically. Only consider the full shared service if a third product (Thedal or another) actually needs WhatsApp *and* you want one Meta app/Tech Provider identity serving all of them.

### Rough effort

These are rough engineer-day estimates for one developer familiar with the code; they exclude Meta's review calendar time and assume no major surprises.

| Work | Effort | Notes |
|---|---|---|
| A. Close the open Nera gaps in §3b and §4 (remove global-token fallbacks in `followups.js`, `templates.js`; fail-closed internal key; signature on every webhook; remove raw payload log; CORS allow-list; signed media URLs; key versioning) | **5–8 days** | Mostly small edits plus tests, following the existing `task1b0` test style. |
| B. Account model split (`WhatsappAccount` collection, token expiry/reconnect, optional >1 number per tenant) and a single Graph client | **5–8 days** | Migration of `Clients` WhatsApp fields. |
| C. Real Embedded Signup (code exchange, WABA checks, webhook subscribe, register, offboarding) | **8–12 days** | Plus Meta business verification, Tech Provider and App Review, which are business-side and typically take **weeks** of calendar time. Start this first. |
| D. Consent/opt-in model + deterministic STOP handling + send-time enforcement | **4–6 days** | Port the Alliance consent whitelist and audit idea. |
| E. Template governance, quality/tier surfacing, campaign auto-pause, pricing capture | **6–10 days** | |
| F. Durable queues (pending manual messages, AI reply delay, campaign sender) replacing in-memory maps | **3–5 days** | |
| G. (Optional) Pure shared library for LeadOS | **5–8 days** | Defer. |
| H. (Not recommended) Shared messaging service with its own DB, API and tenant model, LeadOS and Getnera as clients | **6–10 weeks** | Includes rewriting LeadOS send/receive paths. |

Suggested order: **C (start the Meta paperwork immediately) → A → B → D → F → E.** Total for A–F is roughly **6–9 weeks of engineering**, much of which can run while Meta approvals are pending.

### Immediate non-code actions

- Rotate the literal secret at `leados-app/server/controllers/contentController.js:1974`, and treat the LeadOS `META_PAGE_ACCESS_TOKEN`, the hard-coded DB password fallback and the seeded admin password (`setup-db.js:220`) as compromised if this repo has ever been visible outside the team.
- Make sure the Getnera Meta app has its own secret and no LeadOS/ContentOS credentials are present in Getnera deployments.

---

### Limits of this analysis

- Static read only; nothing executed, no database or production config inspected.
- I read the WhatsApp-relevant sections of the large files, not every line. `salesos.js`, `alliance.js` and `contentController.js` (3–4k lines each) were sampled by grep; they probably contain more env-token and un-scoped-query cases than listed.
- Nera findings in §3b and §4 "Status in Nera" come from grep of this branch; "Fixed" means the code path I read is fixed, not that all call sites are.
- Meta programme names and requirements change; verify the §5 items against current Meta documentation before committing dates.
