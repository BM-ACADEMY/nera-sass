# Pilot onboarding: a customer's own WhatsApp number

One page for onboarding a free-pilot customer who brings their own WhatsApp
Business Account (WABA) and pays Meta directly. Campaigns stay off during the
pilot; only replies, inbox and opt-in contacts.

## Before you start (customer and Aakash)

1. The customer has a Meta Business account and a WABA with the number they
   want to use. The number must not be linked to another Getnera workspace.
2. A token for that WABA, issued for the Getnera Meta app, with the
   `whatsapp_business_management` and `whatsapp_business_messaging`
   permissions. Meta subscribes the app that issued the token, so a token from
   any other app subscribes the wrong app. Confirm the exact steps in Meta
   with the customer before the call.
3. Send the token by secure note, never in chat or email.
4. The Meta Phone Number ID, the WABA ID and the number itself.

## Connect (staff or the workspace owner)

1. Enter the number, Phone Number ID, WABA ID and token on the customer's
   brand (admin panel, or Settings by the owner).
2. Run WhatsApp verification. Verification now does four things in order:
   checks the number belongs to the WABA and matches the saved number, updates
   the business profile, registers the number with Cloud API if Meta has not,
   and **subscribes our app to the customer's WABA**.
3. Open the WhatsApp overview for the workspace and read `webhook_subscribed`:
   * `true`: Meta will deliver this customer's inbound messages and template
     status updates to our webhook.
   * `false`: the number is verified but we receive nothing. `webhook_error`
     shows Meta's reason (usually a missing permission or a token from another
     app). Fix the token, then run verification again; it is safe to repeat.

## Check before the customer uses it

* From a second phone, send a message to the number and see it in the inbox
  within a minute. If nothing arrives, `webhook_subscribed` is the first thing
  to check.
* Reply from the inbox within 24 hours of that message.
* Send STOP from the second phone, then confirm the contact shows as opted out
  and the confirmation arrives. Send START to opt back in.
* Do not send any marketing message in the pilot. A contact who only wrote in
  has not opted in to marketing, and the system refuses it (`CONSENT_REQUIRED`).

## Limits to expect

* A new number starts at 250 business-initiated (template) messages a day and
  doubles only after full, green-quality days. Replies inside 24 hours do not
  use the cap.
* A quality drop pauses marketing on the number automatically and emails the
  workspace owner. See `docs/whatsapp-send-safety.md`.

## If something is wrong

| Sign | Likely cause | Action |
| --- | --- | --- |
| Verified but nothing arrives | Our app is not subscribed to the WABA | Read `webhook_error`, fix the token, verify again |
| Verification fails with a Meta message | Wrong IDs, number on another WABA, missing permission | Correct the field named in the message |
| Number already connected | It belongs to another workspace | Release it there first; never reuse it |
| Messages arrive, replies fail with 409 `WHATSAPP_NOT_CONNECTED` | Token missing or removed | Re-enter the token and verify |
