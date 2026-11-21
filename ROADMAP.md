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

## Before the first paid customer
- [ ] Full pilot dry run on a test number (connect, message, reply, STOP, START)
- [ ] Remove old global WhatsApp variables from the live settings (docs/launch-gap.md §4)
- [ ] Seats per plan instead of one login per workspace
- [ ] App Review approval, then Embedded Signup
- [ ] Fix the staff password-change test (phase1-security D1)

## Later
- [ ] Campaign cost preview (Meta India price × recipients)
- [ ] AI reply polish: sandbox test set
- [ ] Wallet charging for AI overage, extra seats and extra numbers

## Decisions for Kamar
- [ ] Pilot customers and pilot length
