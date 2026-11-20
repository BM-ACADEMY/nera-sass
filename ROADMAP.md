# Nera (Getnera) roadmap

DRAFT, written 2026-11-20 by Claude from docs/launch-gap.md, docs/pilot-onboarding.md, docs/claude-pr-log.md and a look at the code. Owners and dates are guesses: the web team should correct them from their own notes before this is used to plan a sprint.

Start: 2026-11-20

Nera is the WhatsApp inbox, CRM and AI reply product. Pilots are free and manual: each customer brings their own WhatsApp Business account and pays Meta directly. Marketing campaigns stay off during the pilot.
Tick a box when done. Dates are targets.

## Before the first free pilot

### Confirm the launch-critical slices are live on the server
- Owner: Aakash
- Due: 2026-11-27
- Priority: High
The code for these is in the repo (signed webhooks, no global WhatsApp credentials, STOP and consent, subscribing our app to the customer's WhatsApp account). Check each one is deployed and works on the live server, using the checks in docs/pilot-onboarding.md. Also remove the old global WhatsApp variables from the live .env (listed in docs/launch-gap.md section 4).

### Run one full pilot dry run on a test number
- Owner: Aakash
- Due: 2026-11-30
- Priority: High
Follow docs/pilot-onboarding.md end to end with a second phone: connect, verify, check webhook_subscribed, send a message and see it in the inbox, reply, send STOP and START. Write down anything that did not match the page.

### Fix the failing staff password change test
- Owner: Aakash
- Due: 2026-12-04
- Priority: Normal
test/phase1-security.test.js D1: after a staff user changes their password, the new token is rejected with 401. Found in the 2026-11-08 inventory; check if it is still failing.

## Next, during the pilot

### Plans, limits and seats
- Owner: Aakash
- Due: 2026-12-18
- Priority: Normal
Models/Plans.js and services/entitlements.js exist. Check seats, numbers, contacts and campaigns are enforced per plan, and replace the one-login-per-workspace rule with a plan seat limit. Not blocking while pilots are free; blocking for paid go-live.

### Campaign cost preview
- Owner: Aakash
- Due: 2027-01-15
- Priority: Low
Show recipients times Meta's per-category price for India on the campaign screen, with the plan's remaining campaign allowance. No rate card exists in the code yet.

### Check the AI reply polish with a sandbox test set
- Owner: Aakash
- Due: 2026-12-11
- Priority: Normal
Greeting that mirrors the customer, staying on the same brand and topic, saving the customer's name and phone from the chat. docs/n2-ai-booking.md covers the greeting and booking for clinics and education; confirm what is left and run a sandbox set of real-style chats.

### Wallet ledger for extras
- Owner: Aakash
- Due: 2027-02-15
- Priority: Low
models/WalletLedger.js exists. Finish charging for AI replies beyond the plan, extra seats and extra numbers. Needs pricing from Kamar first.

## Decisions for Kamar

### Pilot customers and pricing
- Owner: Kamar
- Due: 2026-12-04
- Priority: Normal
Which customers get the first free pilots, for how long, and what the paid plans cost (the plan list in the brief: Desk, WhatsApp, Complete).

## Done (from the repo docs, confirm with the team)

- Launch gap inventory written (docs/launch-gap.md, 2026-11-08).
- Pilot onboarding page written (docs/pilot-onboarding.md).
- Our app is subscribed to the customer's WhatsApp account when verifying (PR #19).
- Staff can pause sending for one workspace and export appeal evidence (PR #20).
- STOP handling in the webhook path, consent records and send-safety rules (docs/whatsapp-send-safety.md; fix on 2026-11-18).
- AI greeting, FAQ from saved facts and appointment booking for clinics and education (docs/n2-ai-booking.md).
