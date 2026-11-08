# Getnera launch gap — inventory (Task 1)

Date: 2026-11-08 · Base: `main` @ `28ae8ef` · Scope: `server/` (LeadOS routes, services, models, tests), with the customer app and admin panel read where a screen matters.

Read-only inventory. No application code was changed. Line numbers refer to the base commit above.

## How to read the table

- **Status** — *built and working* = the code does it and a test covers it; *partly* = some paths do it, others do not, or it works but is not enforced where the checklist needs it; *missing* = nothing to build on.
- **Effort** — developer hours for code plus tests, assuming no design round-trips. Ranges are honest, not padded.
- **Risk** — what goes wrong at a pilot if this ships as it is today (Low / Med / High), one line.
- "Pilot" below means the free, manually onboarded customers in the brief: each on their own WhatsApp Business Account (WABA), paying Meta directly.

### Test baseline (what actually ran)

`server/npm test` runs 32 files on an in-memory MongoDB (`mongodb-memory-server`). Two environment facts and one code fact shaped the run:

- The MongoDB binary download (`fastdl.mongodb.org`) was refused by this sandbox's proxy until that host was allowed; after that it downloaded and cached fine.
- `test/media-store.test.js` needs `mediaserver/node_modules` as well as `server/node_modules` (it loads `mediaserver/src/app.js`). With both installed it passes 6/6.
- **`npm test` never exits as a whole**: `routes/mafiya-reviews.js:2409` registers a `node-cron` job every 5 seconds *at require time*, outside the `JOBS_ENABLED` and `DISABLED_MODULES` switches, and `server.js:1146` requires that file unconditionally. Every test file that imports the server (25 of 32) finishes its tests and then hangs on that timer, so the runner's final summary is never printed and a parallel run looks stuck. The same job also runs every 5 seconds on the Nera API in production even with Mafiya disabled. A two-line guard fixes both; it is listed under item 3 and proposed as a separate, labelled change in Task 2 because Task 2's tests need a runnable suite.

Run one file at a time with a 60-second cap and read the TAP lines (not the missing summary), the result on `main` @ `28ae8ef` is:

| Result | Count |
|---|---|
| Files | 32 |
| Sub-tests passed | 214 (208 + media-store's 6) |
| Sub-tests failed | 1 |

The one failure is pre-existing and unrelated to this checklist: `phase1-security.test.js` D1 "Staff password change" — after a platform-staff user changes their password, `POST /api/admin/settings/password` returns a fresh token that `GET /api/admin/me` then rejects with 401 (`test/phase1-security.test.js:247`). It reproduces alone, twice. Worth a look by the developer; it does not block the pilot.

## 1. Checklist table

| # | Item | Status | Files involved | Effort (h) | Risk |
|---|---|---|---|---|---|
| 1 | Meta `X-Hub-Signature-256` verified on every WhatsApp webhook; fail closed when the app secret is unset | **partly** — done on `/webhook/whatsapp`; two other Meta-facing POST routes unsigned | `services/metaWebhookSignature.js`, `routes/leados/webhook-whatsapp.js`, `routes/leados/webhook-meta-leads.js`, `routes/leados/webhook-meta.js`, `server.js:1059` (raw body), tests `task1b0-webhook-security`, `webhook-tenant-context` | 2–3 | Med — an unsigned lead-ads or status webhook can be forged |
| 2 | No fallback to a global token or phone anywhere; tenant credentials encrypted at rest; clear error without credentials | **partly** — encryption and the main send paths are done; 6 global-credential sites remain | `routes/leados/followups.js:189`, `routes/leados/templates.js:195,254`, `routes/salesos.js:675,1646,2809`, `routes/leados/webhook-whatsapp.js:121`, `services/clientSecrets.js`, `utils/crypto.js`, `models/Clients.js`, `models/CampaignMessageQueue.js` | 5–7 | **High** — `followups.js:189` sends a customer's follow-up from the platform number with a global token |
| 3 | Tenant isolation on every query and route | **built and working** for LeadOS collections; **partly** for non-LeadOS modules, two dead routes and one module job that ignores the module switch | `db/tenantScope.js`, `services/tenantContext.js`, `middleware/authMiddleware.js`, `server.js:76-81,1118-1134,1146`, `routes/leados/webhook-meta.js`, `routes/mafiya-reviews.js:2409`, tests `tenant-isolation`, `phase1/2/3-security`, `webhook-tenant-context` | 2–3 | Low — modules are staff-only and disabled on Nera; the stray cron is a hygiene and test-blocker issue |
| 4 | Opt-in records, STOP handling, 24-hour window, approved templates only outside it | **partly** — window and STOP work inside the AI Brain; campaigns ignore opt-outs; no opt-in capture; manual wake-up uses a hard-coded template | `services/brainEngine.js`, `services/aiAutomation.js`, `routes/leados/whatsapp.js:64-118`, `server.js:1476-1560` (executeCampaign), `routes/leados/campaigns.js:64-72`, `models/Leads.js:18-19,43-46`, `routes/leados/internal.js:241` | 8–10 | **High** — a campaign can message a contact who replied STOP |
| 5 | Per-tenant send queue, rate limits, frequency caps, quality-rating watch with automatic pause | **partly** — persistent queue and adaptive limiter exist but are global, not per tenant or per number; no frequency cap; no quality watch | `server.js:495-790` (queue), `models/CampaignMessageQueue.js`, `models/CampaignRateStats.js`, `models/MetaWhatsappPhoneNumbers.js` (quality_rating synced for inventory numbers only) | 10–14 | Med — one tenant's campaign throttles everyone; a RED-rated number keeps sending |
| 6 | AI replies: light greeting mirroring the customer, sticky brand/topic, booking that captures and persists date, time, contact and confirms, human handover | **partly** — handover, booking, opt-out, window, quota, language mirroring built and tested; no explicit greeting or topic-stickiness rule; name capture not persisted | `services/brainPrompt.js`, `services/brainEngine.js`, `services/brainBooking.js`, `services/aiAutomation.js`, tests `ai-brain` (18 cases), `n8n-automation` | 4–6 | Low–Med — behaviour is prompt-driven; needs sandbox evaluation, not just unit tests |
| 7 | Inbox, CRM, team roles | **built and working**; team *seats* **partly** (one login per workspace is enforced) | `routes/leados/inbox.js`, `messages.js`, `leads*.js`, `routes/team.js`, `services/permissions.js`, `services/invitations.js:56-64`, `services/entitlements.js`, client `InboxWorkspace.jsx` | 3–4 | Low |
| 8 | Plans table with enforced limits, then wallet ledger | **missing** — code states "there are no plans"; only `tenants.ai_reply_quota_month` is enforced | `services/lifecycle.js`, `services/entitlements.js`, `models/Tenants.js`, `models/Clients.js` (`plan` string, unused), `routes/admin.js`, `models/Payments.js` (per-lead Razorpay links, not subscriptions) | plans 12–16; wallet 8–12 (later) | Med — pilots are free, so not launch-blocking; blocking for paid go-live |
| 9 | Campaigns with cost preview; template create/submit/status | **partly** — campaigns and both template lifecycles work; no cost preview exists | `routes/leados/campaigns.js`, `server.js:1476`, `routes/leados/wa-templates.js`, `services/metaTemplateApi.js`, `routes/leados/templates.js`, client `CampaignsView.jsx`, `TemplatesView.jsx` | 4–6 | Low |
| 10 | Onboarding a customer's own WABA | **partly** — manual entry + verification works (admin and customer API); our app is never subscribed to the customer's WABA for webhooks; Embedded Signup paused by design | `routes/admin.js:210-252`, `routes/leados/clients.js:190`, `server.js:287` (verifyClientWhatsApp), `routes/adminMetaInventory.js:207` (subscribed_apps for inventory numbers only), admin `WhatsAppConfigModal.jsx`, client `settingsPolicy.js` | 3–4 + runbook 1 | Med — a verified number that never calls our webhook looks "connected" and receives nothing |
| 11 | Raw webhook payloads never on disk or in a public folder; Alliance webhook refuses everything when `INTERNAL_API_KEY` is unset | **partly** — full payloads are appended to `uploads/incoming_payloads.log`; an error file under `uploads/` is publicly served; Alliance relay fails **open** when the key is unset | `routes/leados/webhook-whatsapp.js:77-80,371`, `routes/leados/whatsapp.js:166-173`, `server.js:1068-1071`, `routes/alliance-inbox-v2.js:56-59,249-257` | 1–2 | Med — customer messages and phone numbers accumulate in a plain-text file |

## 2. Findings per item

### 1. Webhook signature

Built: `services/metaWebhookSignature.js` verifies `sha256=<hex>` over the exact raw body (`server.js:1059` stores `req.rawBody`) with a constant-time compare, reads the secret from **`NERA_META_APP_SECRET` only** (deliberately no fallback to `META_APP_SECRET`, which ContentOS uses for OAuth), returns 503 when the secret is unset so Meta retries, 400 without a raw body, 401 on a bad or missing header. `/webhook/whatsapp` is gated before any logging, storage, socket or AI work (`webhook-whatsapp.js:56`). Tests W1–W10 cover valid, missing, malformed, wrong-secret, tampered-body, unset-secret and non-JSON cases.

Gaps:
- `POST /webhook/meta-leads` (`webhook-meta-leads.js:30`) is registered and has **no signature check**; it fetches lead data with the page's stored token based on an unverified `page_id`/`leadgen_id`.
- `POST /api/webhooks/meta` (`webhook-meta.js:36`) is registered, unsigned, and runs with no tenant context, so its first tenant-scoped write throws `TenantContextError`. It is dead weight that still accepts public POSTs. Remove it or gate it.
- `POST /api/integrations/meta/webhook` sits behind `staffAuth` (`server.js:1133-1134`), so Meta cannot reach it; harmless on Nera (ContentOS is disabled).
- Naming: the brief says `META_APP_SECRET`; the code's choice of `NERA_META_APP_SECRET` is the safer one and should stay. The deploy checklist must use that name.

### 2. Global credentials and encryption at rest

Built: tokens are written only to `clients.wa_access_token_enc` (AES-256-GCM, `utils/crypto.js`, key `TOKEN_ENCRYPTION_KEY`, required at boot `server.js:2053`); the model decrypts on read and re-encrypts on write (`models/Clients.js:7-46`); `sanitizeClient`/`responseGuard` strip tokens from every response; `lead-token.test.js` checks lead details carry no token. The main send paths resolve the brand's own credentials and return **409 `WHATSAPP_NOT_CONNECTED`** without them: manual send (`whatsapp.js:58-61`), n8n relay (`internal.js:76-81`), campaigns (`server.js:213-217` `tenantWhatsAppSender`), reactions (`messages.js:149-151`), customer templates (`wa-templates.js:29`). Test R5 in `n8n-send-reply.test.js` proves a brand without WhatsApp never falls back to the platform number.

Remaining global-credential sites (production code, `test/` excluded):

| Site | What it does | Fix |
|---|---|---|
| `followups.js:189-190` | `POST /api/ai/followup` sends the AI text with `META_PAGE_ACCESS_TOKEN` + `WA_PHONE_NUMBER_ID`, i.e. **from the platform number, for any tenant** | resolve the lead's brand like `internal.js`; 409 without it |
| `templates.js:195-200` | media upload defaults to the global token, overridden by the client token if present | require the client token; 409 without it |
| `templates.js:254-262` | status sync uses `META_SYSTEM_USER_ACCESS_TOKEN`/`META_PAGE_ACCESS_TOKEN` + `WA_BUSINESS_ACCOUNT_ID` for templates with scope `alliance`/`shared` | tenant token only; the shared scope belongs to the disabled Alliance module |
| `salesos.js:1646-1647`, `2809-2810` | founder report and staff alerts sent **to the founder** with the global token | send through the platform inbox credentials (`services/platformInbox.js`, `PLATFORM_WA_*`), or skip with a logged, clear reason |
| `salesos.js:675`, `webhook-whatsapp.js:121` | `WA_PHONE_NUMBER_ID` is treated as a "managed" number, letting platform-number traffic into the LeadOS path where tenant resolution then fails | drop the env comparison; only `clients.phone_number_id` is managed |
| `models/CampaignMessageQueue.js` | still declares a `wa_token` column; nothing writes it any more (`server.js` has no `wa_token` reference) | remove the field so a token can never land in a queue row again |

`chatbot.js:146-168` reads a `wa_phone_number_id` field that does not exist on `clients`; it is staff-only and effectively dead. Alliance workers read `ALLIANCE_WA_*` by design (BM's own module, disabled on Nera via `DISABLED_MODULES`). `platformInbox.js` reads `PLATFORM_WA_*` by design for Getnera's own support number; that is not a tenant send.

### 3. Tenant isolation

Built: `AsyncLocalStorage` context set by auth (`authMiddleware.js`), per webhook delivery and per job; a Mongoose plugin on 40 LeadOS collections adds `tenant_id` to every find/update/delete/count/aggregate/insert, forbids moving documents between tenants, blocks `$lookup` in tenant context, and **throws when there is no context** (`db/tenantScope.js`). Service calls need `x-internal-key` + `x-tenant-id`; the key compare is constant-time and fails closed (`authMiddleware.js:42-50`). Socket events are routed per tenant room (`server.js:98-110`). `phone_number_id` is unique across tenants (`assertPhoneNumberAvailable`). Covered by `tenant-isolation`, `phase1/2/3-security`, `webhook-tenant-context`, `ai-brain` (isolation case).

Gaps: AllianceOS, ContentOS, Mafiya, knowledge/pipeline/analyze/chatbot and `salesos.js` (127 Mongo ops, 14 tenant references) are not scoped at the route level; on Nera they are staff-only (`modulesAuth`, `server.js:1118`) and should stay in `DISABLED_MODULES`. `webhook-meta.js` (above) has no context. `GET /api/templates/:id/campaign-sheet` (`leads.js:42-45`) verifies a token by hand instead of using `auth`, so it runs without tenant context and fails closed rather than leaking; it should use `auth`. `routes/mafiya-reviews.js:2409` starts a 5-second `node-cron` job at require time; `server.js:1146` requires the file even when `mafiya` is in `DISABLED_MODULES`, so the job runs on Nera regardless and keeps every test process alive (see the test baseline above). Guard it with `jobsEnabled()` and the module switch, or move the `cron.schedule` into `startBackgroundJobs()`.

### 4. Consent, STOP, 24-hour window, approved templates

Built: `leads` has `whatsapp_opt_in(_at)`, `opted_out(_at)`, `whatsapp_opt_out(_at)`. Inside the AI Brain, "stop / unsubscribe / opt out" gets one confirmation and `markOptedOut` (`brainEngine.js:20,148-153,236`); the AI refuses free-form text outside 24 h (`:156-158`); `aiAutomation.aiBlockReason` blocks opted-out and paused leads and the hourly cap; follow-ups exclude opted-out leads (`internal.js:241-242`). Campaign creation accepts only templates whose stored status is approved/active (`campaigns.js:64-72`); template status is refreshed from Meta (`wa-templates.js` check-pending, webhook status updates). Manual send checks for an inbound message in the last 24 h (`whatsapp.js:64-69`).

Gaps:
- **STOP is handled only when the AI Brain is on.** The inbound webhook itself never looks for STOP (`webhook-whatsapp.js` has no opt-out handling), so a workspace with AI off records nothing.
- **Campaigns do not filter opted-out leads.** `executeCampaign` selects by `client_id` and `status` only (`server.js:1550-1558`); CSV audiences are not checked either.
- **Nothing ever sets `whatsapp_opt_in`.** There is no opt-in record (source, timestamp, evidence) for campaign recipients; the Alliance module has a consent model (`alliance.js:76-81,792-802`) but it is not used by LeadOS.
- When the window is closed, manual send **silently sends a hard-coded `common_welcome_message` (en) template** (`whatsapp.js:77-91`) that may not exist or be approved on the tenant's WABA, and reports 200 to the agent.
- The "approved" check trusts the local status column; a template rejected or paused by Meta after creation is only caught once the status sync runs.

### 5. Queue, rate limits, frequency caps, quality watch

Built: persistent `campaign_message_queue` with claim/retry/attempt tracking, batch of 10, adaptive back-off on Meta rate-limit errors, per-campaign daily stats (`server.js:495-790`); `tenantCanSend` gate per row; AI replies capped per tenant per hour (`AI_REPLIES_PER_TENANT_HOUR`) and to sending hours; manual wake-up template throttled to one per 30 minutes.

Gaps: the limiter is **one in-process counter for the whole server** (15/min, 500/h, 5000/day across all tenants), not per tenant or per `phone_number_id`, which is what Meta actually enforces. No per-contact frequency cap (a lead in two campaigns gets both). `quality_rating` is synced only for numbers in the platform's Meta inventory (`server.js:415`), not for customer-owned WABAs, and nothing reads it: no pause on RED/FLAGGED, no reaction to error 131056 (pair rate limit) or 130429 beyond back-off. Two processes would double the limits.

### 6. AI replies

Built: three-layer server-built prompt with fixed platform rules (`brainPrompt.js`), including "reply in the language and script of the customer's latest message" and "call the business by its exact name"; `brainEngine.js` does opt-out, 24-hour window, monthly quota, after-hours message, price guard, holding reply + handover on unknown answers, duplicate-reply guard, one log row per reply with idempotent retry; `brainBooking.js` parses the proposed date/time in the workspace time zone, books through Google Calendar, **persists `call_booked_at`, `booking_status`, `calendar_event_id`, `google_meet_link` and the captured email on the lead, and writes the confirmation from the real outcome** (requested / confirmed / slot unavailable / outside hours / calendar error, each with a team handoff where needed). `ai-brain.test.js` covers 18 behaviours; `n8n-automation.test.js` covers handover, pause/resume, caps and follow-up schedule. Handover modes: notify (default), pause (`AI_HANDOVER_PAUSES=true`), hot-lead alert once per lead.

Gaps vs the brief: no explicit **greeting** rule ("light greeting that mirrors the customer"); no explicit **topic stickiness** rule beyond "never reveal other businesses" (history is the last 10 messages); `lead_updates` writes qualifying answers and `interest` but **not the customer's name or phone** (`brainEngine.js:102-113`), so "contact" is persisted only as email. All three are prompt + small code changes, but they need a sandbox evaluation (there is a sandbox endpoint, see the "Sandbox" test) rather than only unit tests.

### 7. Inbox, CRM, team roles

Built: inbox list/read, per-thread messages with media through the encrypted media server, reactions, AI typing/pause indicators; leads CRUD, import, notes, tags, export, pipeline stages; roles owner/admin/manager/agent with `requirePermission` on team and settings routes (`permissions.js`, `team.js`); invitations with expiry; optional MFA. Gap: `invitations.assertSingleLogin` (`invitations.js:56-64`) allows **one login per workspace**, so the plan seat counts (3/5/10) cannot be used until that rule is replaced by a plan-driven seat limit (`entitlements.seatUsage` already counts seats).

### 8. Plans and wallet

Missing. `lifecycle.js` and `entitlements.js` state there are no plans or limits; `clients.plan` is an unused string; the only enforced limit is `tenants.ai_reply_quota_month`. The Mafiya and Thedal modules have their own plan tables, which show the pattern but are not reusable as-is. `payments` + `webhook-razorpay` are per-lead payment links a customer sends to their customers, not subscriptions. Needed: a `plans` collection (seeded Desk / WhatsApp / Complete from the brief, editable by staff), `tenant.plan_id`, and enforcement points for seats (invitations), numbers (clients), contacts (lead create/import), AI replies (reuse the quota check), campaigns on/off (campaign create). Wallet ledger follows, only for AI replies beyond plan, extra seats and extra numbers.

### 9. Campaigns and templates

Built: campaign create/schedule/execute/retry/logs/queue status with CSV audiences and positional parameter mapping; two template paths — the legacy `templates` collection (draft → submit to Meta → pending → approved via webhook) and the newer `wa-templates` API that creates, edits, deletes, uploads media and checks review status directly on the tenant's WABA with the tenant's token and review-timing logs. Gap: **no cost preview** anywhere (no rate card, no estimate on the campaign screen). Since customers pay Meta directly, the preview is informational: recipients × Meta's per-category conversation price for India, plus the plan's remaining campaign allowance. Two template stores is a maintenance risk, not a launch blocker.

### 10. Onboarding a customer's own WABA

Built (manual, which the brief accepts for pilots): staff set number, phone number ID, WABA ID and token on the tenant's brand (`admin.js:210-237`, token encrypted, audited, never returned) or the owner sets them (`clients.js:190`); verification checks the phone belongs to the WABA, matches the saved number, updates the business profile, registers the number with the Cloud API if needed and marks `whatsapp_status = verified` (`server.js:287-335`); phone number IDs are unique across tenants. Embedded Signup is intentionally paused (503, tests M18/B7) and the customer Settings "Connect WhatsApp" button is disabled until a secure signup is enabled.

Gap: verification never calls `POST /{waba_id}/subscribed_apps` for the **customer's** WABA (only inventory numbers do, `adminMetaInventory.js:207,248,357`), so unless someone subscribes the Getnera app in the customer's Meta Business settings by hand, inbound messages and template status updates never arrive. That step, plus the system-user token scope the customer must grant, belongs in a one-page pilot runbook.

### 11. Payload logging and Alliance fail-closed

- `webhook-whatsapp.js:77-80` appends the **entire JSON payload of every verified webhook** to `server/uploads/incoming_payloads.log` (unbounded, plain text, customer phone numbers and message bodies). The static mount refuses `*.log` (`server.js:1068`), so it is not public, but it is on disk.
- `webhook-whatsapp.js:371` writes audio-transcription errors with stack traces to `uploads/audio_error.txt`; `.txt` is **not** excluded by `PRIVATE_UPLOADS`, so it is served at `/uploads/audio_error.txt`.
- `whatsapp.js:166-173` writes Meta media-upload responses to `uploads/media_upload.log` (excluded from static serving, still on disk).
- `routes/alliance-inbox-v2.js:56-59`: `relayAuthorized` returns `true` when `INTERNAL_API_KEY` is unset — it fails **open**. In production `start()` refuses to boot without the key (`server.js:2053`) and the Alliance module is disabled on Nera, so the exposure is dev/test only, but the brief's requirement is explicit and the fix is one line. The relay from the WhatsApp webhook sends `INTERNAL_API_KEY || ''` (`webhook-whatsapp.js:104`), which pairs with that bug.
- Not a problem: `failed_webhooks` stores lead-ads change values in the database (not disk); `notify.js` writes a `.dev-outbox` only outside production; tenant archives go to `uploads/tenant-archives`, which is excluded from static serving.

## 3. Launch-critical path (build order)

Each slice is one PR-sized change. "Parallel" means the slices do not edit the same files. `server.js` is large and shared; slices that touch different regions of it are marked "same file, rebase".

| Order | Slice | Items | Files touched | Parallel with | Blocks |
|---|---|---|---|---|---|
| **S1** (Task 2) | Signed webhooks everywhere, no global credentials, no payload logging, Alliance fail-closed | 1, 2, 11 | `routes/leados/followups.js`, `templates.js`, `webhook-whatsapp.js`, `webhook-meta-leads.js`, `webhook-meta.js`, `whatsapp.js` (log lines only), `routes/salesos.js` (2 sites), `routes/alliance-inbox-v2.js`, `models/CampaignMessageQueue.js`, new tests | S3, S5, S7 | S2, S4 |
| **S2** | Consent & compliance: STOP in the webhook path (AI on or off), opt-in capture with source/time, campaigns skip opted-out leads, closed-window send asks for an approved tenant template instead of a hard-coded one, `campaign-sheet` route behind `auth`, remove `webhook-meta.js` if S1 only gated it | 4, 3 | `webhook-whatsapp.js`, `whatsapp.js`, `server.js:1476-1560` (executeCampaign), `routes/leados/campaigns.js`, `leads.js`, `models/Leads.js`, `services/aiAutomation.js` | S3, S5 (keep STOP logic in `aiAutomation.js`/webhook, not `brainEngine.js`) | S4, S6 |
| **S3** | Plans table + enforced limits + seats | 8, 7 | new `models/Plans.js`, `models/Tenants.js`, `services/entitlements.js`, `services/lifecycle.js`, `services/invitations.js`, `routes/admin.js`, `routes/team.js`, `routes/leados/clients.js`, `leads-import.js`, admin UI plan picker | S1, S2, S5, S7 | S6, wallet |
| **S4** | Per-number send queue, per-tenant limits, per-contact frequency cap, quality-rating watch with auto-pause (move the queue out of `server.js` into `services/campaignQueue.js` first) | 5 | `server.js:495-790` → new `services/campaignQueue.js`, `models/CampaignRateStats.js`, `models/MetaWhatsappPhoneNumbers.js`, `models/Campaigns.js` (paused_reason) | S3, S5, S7 | — |
| **S5** | AI polish: greeting rule, topic stickiness, persist name/phone from `lead_updates`, sandbox evaluation set | 6 | `services/brainPrompt.js`, `services/brainEngine.js`, `test/ai-brain.test.js` | S1, S2, S3, S4, S7 | — |
| **S6** | Campaign cost preview (India rate card by category × recipients, plan allowance) | 9 | `routes/leados/campaigns.js`, new `services/metaRates.js`, client `CampaignsView.jsx` | S4, S5, S7 | — |
| **S7** | WABA onboarding: subscribe our app to the customer's WABA during verification; pilot runbook | 10 | `server.js:287-335` (verifyClientWhatsApp, same file as S4 but a different region → rebase), `docs/pilot-onboarding.md` | S1, S2, S3, S5 | — |
| later | Wallet ledger (AI replies beyond plan, extra seats, extra numbers) | 8 | new `models/WalletLedger.js`, `services/entitlements.js`, admin UI | — | — |

Minimum to put a free pilot on their own number safely: **S1 → S2 → S7**, with S5 in parallel. S3/S4/S6 can follow during the pilot because pilots are free and low volume.

## 4. Environment variables that matter for the launch path

Required at boot today: `JWT_SECRET`, `INTERNAL_API_KEY`, `TOKEN_ENCRYPTION_KEY`, `PUBLIC_API_URL`, `PORTAL_URL`, `MONGODB_URI`.
Required for webhooks: `NERA_META_APP_SECRET` (signature; the app secret of the Meta app the webhooks are subscribed under), `WA_VERIFY_TOKEN` (GET challenge).
Nera platform switch: `DISABLED_MODULES=alliance,mafiya,contentos`.
Optional, platform's own support number only: `PLATFORM_WA_PHONE_NUMBER_ID`, `PLATFORM_WA_ACCESS_TOKEN`.
**To remove from the Nera `.env` after S1** (they must not exist, so nothing can fall back to them): `META_PAGE_ACCESS_TOKEN`, `WA_PHONE_NUMBER_ID`, `META_SYSTEM_USER_ACCESS_TOKEN`, `WA_BUSINESS_ACCOUNT_ID`, `ALLIANCE_WA_*`.
The full list, with what each one does, comes with Task 2.

## 5. Files the developer is actively changing

From the last ten commits (5–7 Nov): `server/server.js`, `server/routes/salesos.js`, `server/routes/leados/calendar.js`, `server/services/brainBooking.js`, `server/services/realtime.js`, `server/routes/leados/whatsapp.js`, `server/services/notify.js`, `client/src/views/calendar/*`. S1 needs two line-level edits in `salesos.js` and two log-line removals in `whatsapp.js`; those cannot sensibly move to a new file, so Task 2 will keep them minimal and call them out. New logic in S1 goes into new files (`services/tenantSender.js` for credential resolution, new test files) rather than into `server.js`.

## 6. Existing tests relevant to this checklist

`task1b0-webhook-security` (signature, 10), `webhook-tenant-context` (webhook → tenant, 8), `tenant-isolation` (5), `phase1/2/3-security` (8+1 failing, 9, 6), `n8n-send-reply` (5; R5 = no platform fallback), `lead-token` (no token in lead details), `whatsapp-manual-send` (2), `wa-templates` (2), `ai-brain` (18), `n8n-automation` (9), `task1-meta-inventory` (20), `task2_0-brand-security` (8; embedded signup paused), `platform-inbox` (11), `media-store` (6), `workflow-logs` (11), `task2-settings` (13), `calendar` (6). 32 files, 215 sub-tests, 214 passing on `main` when run file by file (see the baseline note in the introduction for why `npm test` as one command does not finish).
