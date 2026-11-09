# AI greeting, FAQ and booking for clinics and education (N2)

Built on the AI Brain (`services/brainEngine.js`). Everything is per tenant:
the new `appointments` collection is in the tenant-scope list, so every query
is filtered by the workspace and a booking can never touch another
workspace's calendar.

## What the customer gets

* **Greeting.** On a customer's first message the assistant greets them by
  the business name (or the saved `greeting_message`), says what it can do and
  answers what was asked.
* **FAQ answers only from saved facts.** The prompt allows answers only from
  the business profile and documents. Two server checks back it up: a reply
  the model marks `answered_from: general_knowledge`, and a reply containing a
  phone number (10+ digits) that is not in the saved facts, are both replaced
  by "I will check this with the team" and the chat is handed to a person.
  Existing price checks still apply. `industry` (`clinic` or `education`) adds
  rules: no medical advice, no admission or placement promises.
* **Language.** English or Tamil. The model replies in the customer's language
  (Tamil script, or Tanglish when they typed Tamil in English letters). The
  fixed booking sentences are written by the server in English or Tamil
  (Tamil when the customer used Tamil script).

## Booking flow (`booking_mode: "appointments"` in the brain profile)

The model only *proposes* `appointment {name, service, start, confirm, cancel}`
from what the customer said. `services/appointmentFlow.js` decides and writes
the reply:

1. ask the **name**, then the **service** (must be one of the saved
   `products_and_services`), then a **date and time**;
2. check the time: in the future (30 min notice), on the 15-minute grid,
   inside business hours, and a free seat (`appointment_capacity` per time);
   if taken, offer the next three free times;
3. **confirm**: the customer is shown name, service and time and must say yes.
   Only a "yes" to that exact question books; a different time asks again;
4. book. The unique `(tenant_id, slot_key)` index makes two simultaneous
   requests for the last seat safe;
5. queue a **reminder** (below). Cancelling frees the seat and cancels the
   queued reminder.

Profile fields: `industry`, `greeting_message`, `booking_mode`
(`meetings` keeps the existing Google Meet flow, the default),
`appointment_minutes`, `appointment_capacity`, `reminder_hours`.

## Reminders use the N1 queue

The reminder is a row in `campaign_message_queue` (`source:
appointment_reminder`), sent by `whatsappSendQueue` which runs the N1 send
policy (consent, STOP, window, number health, rate limit, retries) when the
row is due. Nothing here sends directly. A template Meta has not confirmed as
UTILITY is queued as marketing and so needs the customer's opt-in. Sent
`reminder_hours` before the visit (default 24); if booked later than that,
one hour before; if the visit is under an hour away, none.

## The AI gate (N3)

N3 is not in this repository yet. The booking runs inside
`brainEngine.respond`, after `aiAutomation.aiBlockReason` (workspace can send,
AI on, chat not paused, not opted out, hourly cap) and the monthly reply
quota, and every message goes out through `sendToLead` and the send policy.
No path skips them. When N3 lands, its checks belong next to
`aiBlockReason`.

## Cost per reply

Every row of `ai_reply_logs` has `model`, `language`, `prompt_tokens`,
`completion_tokens`, `total_tokens`, `cost_usd` and `cost_basis`
(`estimated`, `unknown` when the provider sent no usage, `none` for replies
that needed no model call). Failed drafts that were billed are logged too.
`GET /api/brain/usage?from=&to=` returns the workspace's totals, the cost per
sent reply and a split by language.

## Environment variables (none is a secret)

| Name | Default | Meaning |
| --- | --- | --- |
| `AI_PRICE_INPUT_USD_PER_MTOK` | 0.15 | model input price, USD per million tokens |
| `AI_PRICE_OUTPUT_USD_PER_MTOK` | 0.60 | model output price, USD per million tokens |
| `WA_APPOINTMENT_REMINDER_TEMPLATE` | appointment_reminder | approved English reminder template |
| `WA_APPOINTMENT_REMINDER_TEMPLATE_TA` | appointment_reminder_ta | approved Tamil reminder template |
| `APPOINTMENT_REMINDER_HOURS` | 24 | hours before the visit (profile `reminder_hours` wins) |

## Migration

`server/migrations/038_appointments.js` (by hand, never by the server):
creates the indexes. `--dry-run` reports, `--apply` writes.
