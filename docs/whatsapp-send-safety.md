# WhatsApp send safety (N1)

How Getnera keeps marketing on WhatsApp safe at volume. Everything here is
per tenant: consent, number state and queue rows all carry `tenant_id` and
are filtered by the tenant-scope plugin.

## 1. Consent per contact

Collection `whatsapp_consents`, one row per (tenant, last 10 digits of the
phone). It stores the current status (`none`, `opted_in`, `opted_out`), how,
when and with which wording the contact opted in (`opt_in_source`,
`opt_in_at`, `opt_in_text`), the same for the opt-out, and an `events` history.
The lead row mirrors the booleans (`whatsapp_opt_in`, `whatsapp_opt_out`,
`opted_out`) so existing filters keep working.

Opt-in is recorded by:

| Source | Where |
| --- | --- |
| `manual`, any short word | `POST /api/leads/:id/consent { source, text }` — `text` (the wording the contact agreed to) is required |
| `manual` / `call` / ... | `POST /api/leads` with `whatsapp_opt_in: true, opt_in_source, opt_in_text` |
| `import` | a sheet column `whatsapp_opt_in` / `Opt In` / `consent` with yes/true/1, optional `opt_in_text` and `opt_in_source` columns |
| `lead_form` | a Meta lead-ad form question whose name mentions WhatsApp, consent, opt-in, marketing or agree, answered with anything but no/false |
| `inbound_keyword` | the contact sends START, UNSTOP, SUBSCRIBE, தொடங்கு, ... |
| `legacy_backfill` | migration 037 from the old lead flags |

A contact who simply writes in is **not** opted in to marketing: they can be
replied to inside the 24-hour window, and a template can be sent once they
have consented.

Marketing to a contact without `opted_in` is refused with `CONSENT_REQUIRED`;
to a contact who opted out with `CONTACT_OPTED_OUT`.

## 2. STOP and START

`services/optOutKeywords.js` recognises STOP, UNSUBSCRIBE, CANCEL, END, QUIT,
"opt out", "remove me", and short sentences such as "stop sending me
messages"; in Tamil நிறுத்து / நிறுத்துங்கள் / வேண்டாம் / ரத்து and phrases such
as "மெசேஜ் அனுப்ப வேண்டாம்", plus Latin transliterations (niruthunga, vendam,
message vendam, ...). Long messages are never treated as opt-outs.

On a match the inbound webhook records the opt-out (source
`inbound_keyword`, text = the message), cancels every queued marketing row
for the number, clears the AI follow-up schedule, stops the pending AI reply
and confirms in the customer's language. Utility (transactional) messages
and replies inside the window continue; only marketing stops.

## 3. The send queue

`services/whatsappSendQueue.js` works the `campaign_message_queue` collection
(campaign rows keep their shape; other rows carry a ready Graph `payload`).
Each row has a `kind`: `marketing`, `utility` or `service`. Before every send
the worker asks `services/sendPolicy.js`, then reserves a slot with
`services/numberHealth.js`:

* **Per-number minute limit** `WA_SEND_PER_MINUTE` (default 60), reserved
  atomically in `whatsapp_number_state`, so several API instances can share a
  number.
* **Daily cap** for business-initiated (template) messages. A new number
  starts at `WA_DAILY_CAP_START` (250). After a UTC day in which at least
  half the cap was used with GREEN quality and no pause, the cap doubles,
  never above Meta's messaging tier for the number nor `WA_DAILY_CAP_MAX`
  (10000). A quality drop halves it. Replies inside the window do not use
  the cap.
* **Retries with backoff**: Meta 429, rate-limit codes (130429, 131056, ...),
  5xx and network errors retry after `WA_QUEUE_BACKOFF_MS` × 2^(attempt-1)
  (30s, 60s, 2m, ... up to an hour, with jitter), at most
  `WA_QUEUE_MAX_ATTEMPTS` (5). Other 4xx fail at once. Policy blocks that can
  clear (paused number, daily cap, minute limit, blocked workspace) defer
  the row without using an attempt; blocks that cannot (no consent, opted
  out, bad phone) mark it `skipped`.

Statuses: `pending`, `processing`, `sent`, `failed`, `skipped`, `cancelled`.
`GET /api/whatsapp/send-queue` lists the workspace's rows with masked numbers.

## 4. Meta quality signals

`whatsapp_number_state` keeps the number's `quality_rating`, last
`quality_event` and `messaging_limit`. Signals come from the webhook fields
`phone_number_quality_update` (FLAGGED, UNFLAGGED, UPGRADE, DOWNGRADE,
current_limit) and `account_update` (restrictions, bans), from failed
delivery receipts with Meta error 131048 (spam rate), and from the
15-minute Meta inventory sync (`quality_rating`, `messaging_limit_tier`).

On a drop (YELLOW, RED, FLAGGED, DOWNGRADE, restriction) marketing on the
number is paused, the cap is halved and the workspace owner gets an email
plus a live `whatsapp_quality_changed` event. An automatic pause lifts when
Meta reports GREEN or UNFLAGGED; an owner or admin can resume by hand
(`POST /api/whatsapp/health/resume`) unless Meta still rates the number RED
or flagged, and can pause by hand (`.../pause`); a manual pause is never
lifted by Meta. `GET /api/whatsapp/health` shows all of it.

## 5. The 24-hour window

`sendPolicy.assertCanSend` refuses free text, media and AI replies with
`WINDOW_CLOSED` (409) when the contact has not written in the last 24 hours;
only templates may be sent then. Templates are classed by Meta category:
MARKETING → `marketing`; UTILITY / AUTHENTICATION → `utility`; unknown →
`WA_UNKNOWN_TEMPLATE_KIND` (default `marketing`, the safe choice). Campaign
blasts are always marketing. The inbox wake-up template
(`WA_WAKEUP_TEMPLATE`, default `common_welcome_message`) follows the same
rules and counts against the daily cap.

## Environment variables

| Name | Default | Meaning |
| --- | --- | --- |
| `WA_SEND_PER_MINUTE` | 60 | messages per minute per number |
| `WA_DAILY_CAP_START` | 250 | daily business-initiated cap for a new number |
| `WA_DAILY_CAP_MAX` | 10000 | ceiling the cap can grow to |
| `WA_QUEUE_TICK_MS` | 2000 | how often the queue worker runs |
| `WA_QUEUE_BATCH_SIZE` | 10 | rows claimed per run |
| `WA_QUEUE_MAX_ATTEMPTS` | 5 | attempts before a row fails |
| `WA_QUEUE_BACKOFF_MS` | 30000 | first retry delay |
| `WA_UNKNOWN_TEMPLATE_KIND` | marketing | kind of a template with no known category |
| `WA_WAKEUP_TEMPLATE` | common_welcome_message | template the inbox sends to reopen a closed window |

None of them is a secret.

## Migration

`server/migrations/037_whatsapp_send_safety.js` (run by hand, never by the
server): creates the indexes, backfills `whatsapp_consents` from the old lead
flags, tags existing queue rows as marketing and creates a number-state row
for every connected brand number. `--dry-run` reports, `--apply` writes.
