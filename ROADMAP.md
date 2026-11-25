# Getnera roadmap

Updated 2026-11-21. Tick a box when done. Dates are targets.

Getnera is the WhatsApp inbox, CRM and AI reply product. Pilots are free: each
customer brings their own WhatsApp Business account and pays Meta directly.
Prices confirmed by Kamar (14 Nov): Desk ₹799, WhatsApp ₹1999, Complete ₹3999, plus GST.

## Done

### Live on production (app.getnera.in)
- [x] Signed webhooks, per-workspace WhatsApp credentials, STOP/START and consent (#8, #21; 9–18 Nov)
- [x] Staff send pause and appeal evidence export (#20); our app subscribed to the customer's WhatsApp account on verify (#19)
- [x] AI greeting, FAQ and appointment booking for clinics and education (N2)
- [x] Meta business verified; Getnera templates approved
- [x] Meta access token rotated (20 Nov); old n8n reply flow (WF1) turned off
- [x] The Plot One workspace live, AI and follow-ups off, owner not invited yet (20 Nov)
- [x] Every new subscription gets an id; plan grant to a second workspace tested (#25, 21 Nov)
- [x] Razorpay retry, 18% GST, pro-rata upgrades, GST invoices, migration 040 (#22–#24, 21 Nov). Payments still off (test keys)

### Live on staging only (staging-app.getnera.in, 21 Nov)
- [x] Campaigns: templates synced from Meta, template names unique per brand, migration 041 (#31)
- [x] Campaign builder: Schedule Later, audience counts, upload with sample file, daily Meta limit, live send progress (#33)
- [x] Plain-language errors with reference ids (#36)
- [x] Customer Settings in admin style, editable WhatsApp profile, website locked, Billing page (#34)
- [x] Customer WhatsApp Chat in the admin-chat look, faster loading (#37)
- [x] My sessions: signed-in devices, locations, sign out (#35)
- [x] Admin "Send to client" WhatsApp invite (#32)

### Monitoring
- [x] n8n health and workflow-failure alert that runs outside n8n (emails start once the addresses are set)

## Now (this week)

### Meta App Review
- Owner: Aakash · Priority: High
- [ ] Check the status of the submission (30 Oct); keep the reviewer workspace working

### Old token clean-up (call with Kamar)
- Owner: Aakash + Kamar · Due: when Kamar sets the time · Priority: High
- [ ] Move the remaining users of the old Meta token to the new one and test
- [ ] Move CoreTalents' n8n flows off the Alliance token and test
- [ ] Revoke the old Meta token and the Alliance token

### OpenRouter keys
- Owner: Aakash · Waiting on: Kamar · Priority: High
- [ ] Separate keys for the server and n8n, each with a monthly limit; test both; revoke the old key

### The Plot One go-live
- Owner: Aakash · Waiting on: Kamar · Priority: High
- [ ] AI allowance 300 replies a month (needs Kamar's OK on removing the test plan)
- [ ] Brain details from Kamar, build, Kamar approves, then AI on
- [ ] Invite the owner and the invitee list

### Alerts
- [ ] Add Kamar's 2 alert email addresses

## Next batch (Kamar's order)
- [ ] #28 AI follow-up on the day the customer names (sits on top of #27 orders-catalogue, so #27 ships with it)
- [ ] #29 GST invoices: gapless numbers and retry sweep (overlaps #38; keep one)
- [ ] Re-import the WF3 follow-up workflow after #28

## Later batch
- [ ] Merge the staging features #31–#37 after Aakash's check and Kamar's OK
  - [ ] #32: block "Send to client" for owners who already sign in, and shorten the link life (security review)
  - [ ] Submit the workspace_ready template; run migration 041 on production
- [ ] #39 Grant plan and Add days card in admin (Kamar checks it in the browser)
- [ ] Billing page client build, just before payments go live
- [ ] ₹799 + GST live test payment and its invoice, then Razorpay live keys
- [ ] #26 overnight summary for owners; #27 product list and AI order taking

## Before the first free pilot
Items from the 20 Nov draft. Owners and dates were guesses there; correct them as needed.

### Confirm the launch-critical slices work on the live server
- Owner: Aakash · Due: 2026-11-27 · Priority: High
- [x] Code is live: signed webhooks, per-workspace WhatsApp credentials, STOP and consent, subscribing our app to the customer's WhatsApp account (see Done)
- [ ] Check each one on the live server with the checks in docs/pilot-onboarding.md
- [ ] Remove the old global WhatsApp variables from the live settings (docs/launch-gap.md §4), after the old token clean-up

### Run one full pilot dry run on a test number
- Owner: Aakash · Due: 2026-11-30 · Priority: High
- [ ] Follow docs/pilot-onboarding.md end to end with a second phone: connect, verify, check webhook_subscribed, send a message and see it in the inbox, reply, send STOP and START. Write down anything that did not match the page.

### Fix the failing staff password change test
- Owner: Aakash · Due: 2026-12-04 · Priority: Normal
- [ ] test/phase1-security.test.js D1: after a staff user changes their password, the new token is rejected with 401. Check if it is still failing.

## Next, during the pilot

### Plans, limits and seats
- Owner: Aakash · Due: 2026-12-18 · Priority: Normal
- [x] Plans, subscriptions, wallet and plan grants are live (#22–#25)
- [ ] Check seats, numbers, contacts and campaigns are enforced per plan
- [ ] Replace the one-login-per-workspace rule with a plan seat limit (blocking for paid go-live)

### Check the AI reply polish with a sandbox test set
- Owner: Aakash · Due: 2026-12-11 · Priority: Normal
- [ ] Greeting that mirrors the customer, staying on the same brand and topic, saving the customer's name and phone from the chat. docs/n2-ai-booking.md covers greeting and booking for clinics and education; confirm what is left and run a sandbox set of real-style chats.

### AI Brain for every kind of business, with booking
- Owner: Aakash · Priority: Normal
Today the AI Brain mainly answers questions (FAQ and business info); booking works only for clinics and education (docs/n2-ai-booking.md).
- [ ] Business types: let the owner pick their type (shop, restaurant, salon, clinic, education, real estate, services, other) and give the AI the right questions, words and reply style for that type.
- [ ] Booking for any business: the owner sets what can be booked (appointment, table, visit, demo, service slot), the hours and the slot length; the AI offers free slots, books, confirms on WhatsApp and sends reminders.
- [ ] Owner control: the owner sees and edits each booking, and the AI hands over to a person when the customer asks for one or the AI is unsure.
- [ ] Test with real-style chats for each business type before turning it on for a customer.

### Show when customers report or block the WhatsApp number
- Owner: Aakash · Priority: High
Meta does not tell us "this customer reported you". It shows the effect: the number's quality rating drops, templates get paused, and the daily messaging limit can go down. Too many reports can get the number restricted.
- [ ] Listen to Meta's webhooks for quality rating changes, template pauses and messaging limit changes, and save each change.
- [ ] Customer app: a clear banner on WhatsApp Chat and Campaigns when quality is Medium or Low, or a template is paused, with what it means and what to do (send fewer marketing messages, only to people who opted in).
- [ ] Admin panel: the same warning per workspace, plus a list of workspaces at risk, so staff can pause sending before Meta restricts the number.
- [ ] Mark a contact who stopped replying after a marketing message, or who sent STOP, so they are not messaged again.

### Campaign cost preview
- Owner: Aakash · Due: 2027-01-15 · Priority: Low
- [ ] Show recipients × Meta's per-category price for India on the campaign screen, with the plan's remaining campaign allowance. No rate card exists in the code yet.

### Wallet charging for extras
- Owner: Aakash · Due: 2027-02-15 · Priority: Low
- [x] Wallet ledger and AI overage charging from the wallet are in the code (#22–#24)
- [ ] Charge for extra seats and extra numbers; check pricing with Kamar

### Meta App Review and Embedded Signup
- Owner: Aakash · Priority: Normal
- [ ] After App Review approval, build Embedded Signup so customers connect their own WhatsApp account

## Decisions for Kamar

### Pilot customers and pricing
- Owner: Kamar · Due: 2026-12-04 · Priority: Normal
- [x] Paid plan prices: Desk ₹799, WhatsApp ₹1999, Complete ₹3999 + GST (confirmed 14 Nov)
- [ ] Which customers get the first free pilots, and for how long

## History
- 2026-11-20: first draft written from docs/launch-gap.md, docs/pilot-onboarding.md, docs/claude-pr-log.md and the code.
- 2026-11-21: updated with the production and staging deploys of 21 Nov; old draft items kept above with their owners and dates.
- 2026-11-23: added "AI Brain for every kind of business, with booking" and "Show when customers report or block the WhatsApp number".
