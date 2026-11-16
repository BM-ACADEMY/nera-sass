# Claude pull requests: what each one does and how to review it

One entry per pull request written by a Claude session. Aakash reviews, merges
and deploys; Claude does not deploy or touch the live server. Newest first.

Every entry answers the same five questions: what changed, which files, how to
test it, what to check on the server, and how to undo it.

---

## #20 Staff send pause and appeal-evidence export

**What:** Staff can pause all WhatsApp sending for one workspace (reason
required, audited) while its people still sign in and read their data, then
resume. Staff can also download an evidence file for a Meta appeal: consent and
STOP records, send counts, number quality history, template approvals and staff
actions, with no message text, names or full phone numbers.

**Files:** `server/models/Tenants.js`, `server/services/lifecycle.js`,
`server/services/audit.js`, `server/routes/admin.js`,
`server/services/appealEvidence.js`, `server/test/n8-send-pause.test.js`.

**Test:** `cd server && node --test test/n8-send-pause.test.js`, then the
send-safety tests (`n1-send-safety`, `s2-send-policy-audit`). Claude could not
run them; dependencies would not install in its sandbox.

**Check on the server after deploy:**
1. `POST /api/admin/tenants/<id>/pause-sending` with a reason on a test
   workspace; confirm a manual send is refused with `SEND_BLOCKED` and the
   workspace owner can still sign in.
2. `POST .../resume-sending`; confirm sending works again.
3. `GET .../appeal-evidence`; confirm no message text and only last four digits
   of numbers.

**Undo:** revert the PR. No migration; the new tenant fields are optional.
Paused workspaces would send again after a revert.

**Known gaps:** API only, no admin screen button. Queued marketing rows wait
during a pause and send after a resume; cancel them first if that is not wanted.

---

## #19 Subscribe our app to a customer's WhatsApp account on verification

**What:** Verifying a customer's own WhatsApp number now also subscribes our
Meta app to their WABA, so Meta delivers their inbound messages and template
status updates to our webhook. A failure keeps the number verified but is
recorded and shown as `webhook_subscribed: false` in the WhatsApp overview.

**Files:** `server/server.js` (`verifyClientWhatsApp`), `server/models/Clients.js`,
`server/routes/leados/whatsapp-overview.js`, `server/routes/admin.js`,
`server/routes/adminMetaInventory.js`, `server/routes/leados/clients.js`,
`server/test/n7-waba-subscribe.test.js`, `docs/pilot-onboarding.md`.

**Test:** `cd server && node --test test/n7-waba-subscribe.test.js`, plus the
existing `task2_0-brand-security` and `task1-meta-inventory` tests (they stub
Meta calls strictly). Claude could not run them.

**Check on the server after deploy:** verify a pilot customer's number, open the
WhatsApp overview and read `webhook_subscribed`; send a message to the number
from a second phone and confirm it reaches the inbox.

**Undo:** revert the PR. Stored `whatsapp_webhook_*` fields are ignored.

**Open question for Aakash:** confirm the token a customer issues is for the
Getnera app and the permission names in `docs/pilot-onboarding.md`.
