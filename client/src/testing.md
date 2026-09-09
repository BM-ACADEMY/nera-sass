leados-workflows-final\updated-workflow
inside i have all the 8 workflow i given testing document first analysis given test with already implemented workflow given 

LeadOS Workflows
Updated Spec & Testing Guide (v2)
Prepared for the development team — issues found in live testing (15–25 July) with required fixes and acceptance tests.
This document updates the original Executive Testing Guide. The 8-workflow architecture is sound and should not be rebuilt. The issue is execution: several engines exist but do not behave as described when tested live. Each section below keeps the original purpose, then adds Issues found, Required fixes, and How to test (acceptance). Please implement the fixes and confirm every acceptance test passes.
At-a-glance status
Engine	Status	Headline finding
1. Lead Integrator	Partly broken	428 leads/day + split WhatsApp tags = dedup / tag normalization not working
2. Sales Engine	Broken	Hot leads owner = null; DM syllabus returned web-dev PDFs; fallback re-greets
3. Follow-up Engine	Unverified	Designed till-close & hourly — must prove it sends after 24h and stops on close
4. Reminder Engine	Unverified	Summaries arrived 5:30/7:00pm, not the scheduled 8:00am
5. Customer Journey	Unverified	Never run — revenue is 0; test with a dummy payment
6. Marketing Automation	Unverified	Bulk sends to old leads need approved templates
7. Founder Dashboard	Broken	$0 (should be INR), invented scores, contradictory runs 90 min apart
8. Admin Maintenance	Caveat	Retry only fixes temporary failures, not 24h/template policy blocks
Cross-cutting fixes (affect multiple engines)
A. WhatsApp 24-hour window & approved templates. Outside 24 hours of a lead's last inbound message, WhatsApp blocks free-form messages — only pre-approved templates deliver. This affects Follow-up (#3) and Marketing (#6) directly. Confirm approved templates exist and are wired for every follow-up step and campaign; otherwise messages to quiet/old leads silently fail.
B. Calculate in code, narrate with the LLM. Every number (dashboard, scores, counts) must be computed in a SQL/Function node from one source and passed to the LLM as validated JSON. The LLM only writes sentences — it must never source data, count, or score. This is the root cause of the invalid dashboard.
C. Deduplicate by phone number + normalize channel tags. A 'lead' = one distinct person (deduped by phone), not a message or webhook event. Lowercase channel tags before grouping so 'WhatsApp' and 'whatsapp' are one channel. This is what inflated 428.
D. Sticky brand + correct fallback. Persist the detected brand per phone number in session memory. The greeting fires only on a fresh session; if a brand is locked and a message doesn't match a keyword (e.g. 'contact number'), stay in the flow — never re-greet. Store booking fields so answered questions are never re-asked.
E. Currency = INR (₹). All revenue/financial figures must be in INR, not USD. '$0' indicates a hardcoded template default, not real billing data.
 1. Lead Integrator
The 'Front Door' — intake, dedup, brand tagging.
What it does: Listens for every new contact from WhatsApp, Meta (FB/IG) ads, website forms, and email; checks for duplicates; identifies the brand; saves the lead to the CRM.
Issues found in testing
●	Founder Dashboard reported 428 leads in one day — not credible for current volume.
●	It counted 'WhatsApp' and 'whatsapp' as two separate channels, then merged them after the fact — tags are not normalized.
●	Together these show leads are likely counted as raw events/messages, not deduped people.
Required fixes
●	Define a 'lead' as one distinct phone number created in the period.
●	Deduplicate on phone number at intake so repeat messages don't create new leads.
●	Normalize (lowercase) channel tags before storing/grouping.
How to test (acceptance)
●	Send a test message, then send again from the same number — must remain ONE lead.
●	Count distinct phone numbers created today in the CRM and compare to the dashboard's lead count; they should match.
2. Sales Engine
The 'AI Salesperson' — reply, KB lookup, scoring, assignment.
What it does: On each new lead it reads intent, checks objections, looks up answers in the knowledge base, replies, scores the lead (hot/cold), and assigns a sales rep.
Issues found in testing
●	Two hot leads were shown with owner = null — rep assignment is not firing.
●	A request for the Digital Marketing syllabus returned Java/MEAN/MERN (web-dev) PDFs — KB lookup pulls the wrong brand/course.
●	Any message that doesn't match a brand keyword resets to the greeting and wipes an in-progress booking.
●	'Digital marketing' while already in BM Academy wrongly jumped to BM TechX services.
●	Lead scores include perfect 100/100 values with no visible formula — likely LLM-invented.
●	Contact name rendered as a broken fragment ('Hey ilaya.Ve!').
Required fixes
●	Ensure rep assignment always writes a real owner (never null); add a fallback owner + SLA alert if none.
●	Fix KB retrieval to filter by locked brand AND course before returning documents; DM syllabus must return DM content.
●	Apply the fallback rule from Cross-cutting D: never re-greet mid-session; treat FAQ (contact/timings/fees) as inline answers, then resume.
●	Disambiguate 'digital marketing' by context: if BM Academy is locked, it means the course; only offer course-vs-service when unlocked or the user says 'my business'.
●	Ground scores in a defined formula from real fields, or remove them — no LLM-invented numbers.
●	Sanitize the contact name; if malformed or missing, use no name ('Hey!').
How to test (acceptance)
●	Ask 'digital marketing course fees' → correct BM Academy answer, no jump to TechX.
●	Ask 'syllabus' → the DM syllabus (not web-dev).
●	Generate a hot lead → an owner is assigned (not null).
●	Mid-booking, ask 'can I have your contact number' → number given inline, booking resumes, NO reset.
3. Follow-up Engine
The 'Persistent Closer' — hourly, until the lead closes.
What it does: Every hour it checks who is due for follow-up and sends the next message in their sequence (AI WhatsApp text, WhatsApp template, or email), updating status. Intended to run until the lead purchases or books the counselor.
Issues found in testing
●	Not yet verified live. On paper this is the best-built engine and correctly names WhatsApp templates.
●	The close-handoff depends on booking writing a 'closed/booked' status — and booking currently never completes (Engine 2), so the till-close loop may not actually close.
●	Whether follow-ups deliver after 24h of silence (template requirement) is unconfirmed.
Required fixes
●	Confirm approved WhatsApp templates are live for each follow-up step (Cross-cutting A).
●	Define the exact stop conditions: lead replies → pause; lead books counselor → stop; lead pays → stop (hand to Engine 5); 'stop/not interested' → opt-out; max attempts → mark cold.
●	Ensure booking / counselor-contact writes the status change that halts follow-up — this is the specific link that makes 'follow-up till purchase/counselor' real.
How to test (acceptance)
●	Set a test lead's follow-up time to now → a message goes out within the hour.
●	Go silent on a test number 2–3 days → follow-ups arrive on schedule AND still deliver after 24h.
●	Book a counselor call on a test lead → follow-ups STOP.
●	Reply 'not interested' → follow-ups STOP.
●	Confirm it stops after a set max attempts (no infinite chasing).
4. Reminder Engine
The 'Morning Briefing' — 8:00am daily.
What it does: Every morning at 8:00am, each salesperson gets a WhatsApp list of who to contact; the founder gets a master summary.
Issues found in testing
●	The summaries actually received were timestamped 5:30pm and 7:00pm — not 8:00am.
●	This overlaps with the Founder Dashboard (#7); it's unclear which engine produced the messages seen.
Required fixes
●	Confirm the schedule matches (8:00am) or update the doc to the real time.
●	Clarify the split between Reminder Engine (rep briefings) and Founder Dashboard (exec summary) so they don't duplicate or contradict.
●	Apply the same 'calculate in code' rule to any numbers in the briefing.
How to test (acceptance)
●	At 8:00am, reps receive their briefing and the founder receives the master summary.
●	Two summary systems don't send conflicting numbers for the same day.
5. Customer Journey
The 'Onboarding Team' — on payment.
What it does: When a payment succeeds it runs onboarding: welcome message, receipt/invoice email, add to VIP WhatsApp group, grant platform login, and later request a Google review or referral.
Issues found in testing
●	Never exercised — revenue is 0, so this has likely never run in production.
Required fixes
●	No change requested to the design; it needs a controlled test before real customers rely on it.
●	Confirm each step (welcome, receipt, group add, login, review request) is individually toggleable and logged.
How to test (acceptance)
●	Mark a dummy invoice as 'Paid' → welcome + receipt + access steps fire as configured.
●	Confirm the delayed review/referral message schedules correctly.
6. Marketing Automation
The 'Campaign Manager' — 9:00am daily.
What it does: Every day at 9:00am it picks up scheduled campaigns and sends promotional messages to the selected audience.
Issues found in testing
●	Not verified. Bulk sends to leads older than 24h carry the same template requirement as follow-up.
Required fixes
●	Ensure campaigns to 24h+ audiences use approved templates (Cross-cutting A).
●	Add audience dedup + opt-out suppression so opted-out leads are never blasted.
●	Add a send-rate / throttle to protect the WhatsApp number's quality rating.
How to test (acceptance)
●	Schedule a tiny campaign to 2–3 test numbers for today → it sends at 9:00am.
●	Include an opted-out test number → it is skipped.
7. Founder Dashboard
The 'Daily Business Report' — 9:30am daily.
What it does: At 9:30am it compiles revenue, conversion, lead sources, and AI performance, has the AI write a human-readable summary, and WhatsApps it to the founder.
Issues found in testing
●	Revenue shown as '$0' — should be INR, and appears disconnected from real billing.
●	428 leads/day (see Engine 1) — inflated, not deduped.
●	Two runs 90 minutes apart contradicted each other (SLA risk vs 0 breaches; different lead totals).
●	Invented scores (100/100, 95%, 80.2% with no formula).
●	Dead numbers spun positively ('$0 revenue' framed as 'Pipeline Win' / 'efficiency excellent').
●	Arrived at 5:30/7:00pm, not the scheduled 9:30am.
Required fixes
●	Compute all numbers in a SQL/Function node from one source; validate a fixed JSON schema; LLM only narrates (Cross-cutting B).
●	Fix currency to INR from real billing.
●	Use the deduped lead definition and normalized channels.
●	Ground or remove all scores; neutral reporting, no spin.
●	Pin one fixed schema so every run reports the same KPIs in the same structure.
How to test (acceptance)
●	Run the summary twice within one hour with no new data → the two outputs are IDENTICAL.
●	Cross-check 2–3 figures (revenue, lead count) against the database — they match.
●	Confirm currency is INR and no field reads 100/100 without a formula.
8. Admin Maintenance
The 'Janitor' — 2:00am nightly.
What it does: Each night it retries failed tasks (e.g. a message that didn't send while WhatsApp was down), clears old logs, and refreshes the AI's memory.
Issues found in testing
●	Retry only recovers TEMPORARY failures. A message blocked by the 24h/template rule is a policy block, not a glitch, and will not be fixed by retrying — so it must not be relied on to cover silent non-responses.
Required fixes
●	Keep the nightly retry/cleanup.
●	Add alerting when a task fails for a NON-transient reason (e.g. outside 24h with no template) so it surfaces instead of silently retrying forever.
●	Log every failed send with its reason code.
How to test (acceptance)
●	Force a transient send failure → it is retried and delivered by morning.
●	Force a 24h/template block → it is flagged for attention, not silently looped.
 Consolidated acceptance sign-off
Please confirm each item passes before we consider the system production-trusted:
●	☐  Same number tested twice stays ONE lead (dedup).
●	☐  Channel tags normalized (WhatsApp = whatsapp).
●	☐  DM course query returns BM Academy course + correct DM syllabus.
●	☐  Hot lead gets a real owner (never null).
●	☐  'Contact number' mid-booking does NOT reset the chat.
●	☐  Booking writes to Calendar + Sheet, confirms the slot, and the lead gets a reminder.
●	☐  Follow-ups deliver after 24h of silence (templates approved).
●	☐  Follow-ups STOP when a lead books the counselor or pays.
●	☐  Dummy payment triggers the onboarding steps.
●	☐  Founder summary: INR, deduped counts, grounded scores, identical on a repeat run.
●	☐  Every inbound message gets a reply (no silent drops).
Three questions that settle most of this
1. Sales Engine — Why are hot leads assigned null, and why did the DM syllabus return web-dev PDFs? (rep assignment + KB lookup)
2. Follow-up & Marketing — Are the WhatsApp templates approved and live? Without them, nothing sends after 24h.
3. Founder Dashboard — Does a SQL/code node compute the numbers, or the LLM? And when a lead books the counselor or pays, what field changes to stop the follow-up?
Bottom line: the architecture is right — keep it. The work now is wiring each engine to real logic and proving it with the tests above.
