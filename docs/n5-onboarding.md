# Guided customer onboarding (N5)

A setup checklist on the customer's Home screen, a Notices box above it, and a
staff-only screen for connecting a customer's WhatsApp. Everything is per
workspace: state rows carry `tenant_id` and are filtered by the tenant-scope
plugin, and the customer API only runs in the signed-in user's tenant.

## The six steps

Each step is **Done**, **In review**, **To do** or **Locked**. The rules live in
`server/services/onboarding/steps.js` and are used both for what the customer
sees and for what Go live re-checks on the server.

| # | Step | Done when | In review | Locked while |
| - | ---- | --------- | --------- | ------------ |
| 1 | Business details | name, website and address are saved (`clients`) | n/a | never |
| 2 | Connect WhatsApp | the brand has a number, a saved token and `whatsapp_status = verified` | the customer asked our team, or verification is pending | never |
| 3 | Add services | at least one active service with a price and a duration | n/a | never |
| 4 | Message templates | at least one template Meta approved | Meta is reviewing and none is approved | WhatsApp is not Done |
| 5 | Send a test message | a test template reached Meta for the customer's own phone | n/a | WhatsApp is not Done, or no approved template |
| 6 | Go live | AI replies and campaigns are on | n/a | any of 1 to 5 is not Done |

Each template is listed with Meta's own status: Approved, In review (PENDING,
IN_APPEAL), Rejected, Paused by Meta (PAUSED, DISABLED, FLAGGED).

## Connecting WhatsApp

**Mode B, staff-assisted (always available).** The customer presses "Ask our
team to connect" (`POST /api/onboarding/whatsapp/request`); the step becomes
In review and the request appears first in the staff queue. Platform staff
(founder and ops, permission `platform.whatsapp.connect`) open Admin >
Onboarding and enter the WhatsApp number, Meta Phone Number ID, WhatsApp
Business Account ID and access token
(`PUT /api/admin/tenants/:id/onboarding/whatsapp`). The save also asks Meta to
verify them.

* The token is written through the `clients` model, which encrypts it with the
  existing `clientSecrets` code (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`). The
  tenant sender reads it back from there; nothing new decrypts it.
* The form is write-only. No response returns the token or any part of it, not
  even the last four characters. Changing it means entering it again.
* A number already connected to another workspace is refused (409).
* A failed Meta check is shown to staff; the customer only sees "our team is
  looking at it".

**Mode A, Meta Embedded Signup (feature flag, off).** `WA_EMBEDDED_SIGNUP_ENABLED`
stays off until Meta approves Getnera as a Tech Provider. While it is off the
customer sees only Mode B, and `POST /api/onboarding/whatsapp/embedded-signup`
answers 404 without calling Meta. When it is on (and `META_APP_ID`,
`META_EMBEDDED_SIGNUP_CONFIG_ID`, `NERA_META_APP_SECRET` are set) the browser
opens Meta's popup, the server exchanges the one-time code for the customer's
own token, stores it encrypted and verifies the number. The app secret never
goes to the browser. The older `/api/meta/embedded-signup/*` routes are left as
they were (still paused).

## Services

A service is an AI Brain knowledge document of kind `product` (so the AI reads
it with no extra wiring) plus a `service` object: name, price in rupees,
duration in minutes, optional availability and notes, and up to ten
question-and-answer pairs the AI may use. The text the AI reads is generated
server-side, with the price written as `₹500` so the Brain's price check can
match it.

## The test message

`POST /api/onboarding/test-message` sends one approved template with no
variables from the customer's own number to the owner's own phone. It goes
through the **N1 send policy** (`sendPolicy.checkSend`) and the number limits
(`numberHealth.reserveSlot`), exactly like any business-initiated message:
STOP, erasure, paused numbers, tenant send state and the daily cap all apply.

* The phone is the one on the owner's profile; if there is none, the one they
  give is saved as theirs. At most `ONBOARDING_TEST_MAX_PER_DAY` attempts a day.
* A marketing-class template needs the owner to confirm the number is their own;
  that is recorded as consent (`source: onboarding_test`). A number that said
  STOP is never messaged.
* The one exception to the "marketing waits for go live" rule is this call
  (`onboardingTest: true`). No other caller can set it.

## Go live

`POST /api/onboarding/go-live` (owner/admin) re-checks steps 1 to 5 on the
server and answers 409 `NOT_READY` with the steps still open if any is not Done.
Then it sets `tenants.campaigns_enabled = true`, and when the AI Brain profile is
complete and `N8N_BRAIN_WEBHOOK_URL` is set it also turns the AI Brain on (the
same two fields the existing AI toggle writes). If the Brain is not ready the
workspace is still live, campaigns are on, and a notice tells the owner what is
missing. Calling it again changes nothing.

Until a workspace goes live:

* `POST /api/campaigns` answers 403 `NOT_LIVE`;
* `sendPolicy` refuses marketing sends with `NOT_LIVE` (retryable, so queued
  rows wait and go out after go live). Utility messages and replies are not
  held back.

Workspaces created before this release have no `campaigns_enabled` value and
are treated as live. New workspaces are provisioned with it set to `false`.

## Notices

`GET /api/onboarding` returns `notices`, most urgent first (critical, warning,
info): WhatsApp could not be verified, marketing paused on the number, rejected
or paused templates, plan ending or ended, AI replies paused, and an unfinished
AI Brain after go live. Plan and trial wording comes from the existing N3 state
(`billing.subscriptions`, `billing.aiAllowance.check`, `billing.alerts.recent`),
read only. N3 has no separate trial record: a plan granted by staff
(`source: staff:<id>`) is shown as a trial, a paid plan as a plan. Billing code
is not changed and onboarding writes no billing row.

## API

| Route | Who | What |
| ----- | --- | ---- |
| `GET /api/onboarding` | any member | steps, notices, live state |
| `POST /api/onboarding/whatsapp/request` | owner, admin | ask our team to connect |
| `POST /api/onboarding/whatsapp/embedded-signup` | owner, admin | Mode A (flag) |
| `GET/POST /api/onboarding/services`, `PUT/PATCH/DELETE .../:id` | read: any member; write: owner, admin, manager | services |
| `POST /api/onboarding/test-message` | owner, admin | step 5 |
| `POST /api/onboarding/go-live` | owner, admin | step 6 |
| `GET /api/admin/onboarding/whatsapp-queue` | founder, ops | customers waiting |
| `GET/PUT /api/admin/tenants/:id/onboarding/whatsapp` | founder, ops | staff-assisted connect |

Business details use the existing `PATCH /api/clients/:id`.

## Environment variables

| Name | Default | Secret | Meaning |
| ---- | ------- | ------ | ------- |
| `WA_EMBEDDED_SIGNUP_ENABLED` | off | no | feature flag for Mode A |
| `ONBOARDING_TEST_MAX_PER_DAY` | 5 | no | test messages per workspace per day |

Mode A also reads three variables that already exist: `META_APP_ID`,
`META_EMBEDDED_SIGNUP_CONFIG_ID` and `NERA_META_APP_SECRET` (secret).

## Migration

`server/migrations/039_onboarding.js` (run by hand, never by the server):
creates the `onboarding_states` indexes and marks existing workspaces live.
`--dry-run` reports, `--apply` writes.
