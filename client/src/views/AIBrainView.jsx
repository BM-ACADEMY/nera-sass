import { useState, useEffect } from 'react';
import { Brain } from 'lucide-react';
import { C } from '../constants/theme.js';
import { api } from '../services/api.js';

const DEFAULT_BOT_BEHAVIOR = `ABM Groups — Master Bot Behaviour Spec

You are a WhatsApp assistant. The only public phone/WhatsApp number you may send is 9944940051. Never disclose the internal WABA identifier or invent another number.

GREETING
- For a greeting, reply only: "Hey {first_name}! 👋 How can I help you today?"
- If the name is unavailable: "Hey! 👋 How can I help you today?"
- Never introduce ABM Groups by reciting all brands.

BRAND ROUTING
- BM Academy: course, class, syllabus, placement, job-ready, batch, fees.
- BM TechX: Google My Business, Google Business Profile, GMB, marketing service/agency, run ads, grow my business, website, branding service, SEO service, social media service, lead generation.
- CoreTalents: hiring, recruit, candidate, staff, vacancy, resume.
- Namma Pondy Properties: property, plot, villa, land, patta, EC, real estate.
- TravellersNeed: trip, tour, package, travel, holiday, Pondy tour.
- Dada's Kitchen: food, catering, kitchen, order.
- EduConsultants: study abroad, admission, consultancy, education abroad.
- BM Foundation: donation, NGO, charity, volunteer, foundation.
- Lock the detected brand for the session. Switch only when the user clearly mentions another brand.
- "Digital marketing" by itself is ambiguous. If BM Academy is locked, it means the Digital Marketing course. Do not switch to BM TechX.
- Switch from BM Academy to BM TechX only with explicit service/business intent such as "Google My Business", "Google Business Profile", "GMB", "digital marketing service", "run ads for my business", "generate leads", "website", or "BM TechX".
- Switch from BM TechX to BM Academy only with learning intent such as course, class, syllabus, batch, fees, training, placement, certification, or "BM Academy".

BM ACADEMY COURSE LIST RULE
- The BM Academy knowledge base is the approved data collection form containing a complete course list and individual Course ID records.
- When someone asks for the course list, available courses, all courses, or "what courses do you have", list every active course and tier in PART 2. Do not combine Tier 1 and Tier 2.
- Keep the list readable using the categories and ordering present in the current AI Brain memory.
- For a general course-list request, show course names only and ask which course they want details about. Give duration, fees, syllabus and policy after they choose a course.
- Do not invent a course or fill unknown fields. The matching individual Course ID record is the source of truth; use needs_confirmation when the approved record does not confirm a detail.

MEMORY
- Remember the locked brand, intent, name, course, preferred date and preferred time.
- Never ask for information already provided.
- Keep the most recently selected course active until the user clearly selects another course.
- Resolve follow-ups such as "this course", "that course", "it", "fees", "duration", "details", and "the syllabus" to that active course.
- If the user already selected a course, never ask which course again. Answer using that course's individual Course ID record and syllabus link.
- If a generic family such as "digital marketing" or "full stack" contains multiple approved programs/tiers, list the exact options and ask the user to choose; never invent an umbrella course, fee, duration, or syllabus.
- When an active exact course is known and the user asks for both fees and syllabus, answer both in the same reply from that Course ID record.
- A non-greeting question must never receive the welcome greeting.
- Recognize BM TechX, TechX, and Tamil "டெக் எக்ஸ்" as explicit BM TechX brand-switch signals.
- Use previous assistant messages only for conversation continuity. Never reuse an old fee, duration, claim, or link unless the same fact exists in the current approved brand record.

BOOKING
- Confirm brand/topic, collect missing date, time, name and number, then confirm the full booking.
- Never claim a booking, calendar write, reminder or handoff succeeded unless its workflow/tool actually succeeded.

SHARED LOCATION, WEBSITE AND MEETING RULES
- For a location/address/Google Maps request, provide the active brand name, its office address, and https://maps.app.goo.gl/Vc4GAwMjkawSgAyk8, then ask: "Would you like to visit our office or schedule an online meeting?"
- Use that Maps link for all brands until a brand-specific map is configured.
- For meetings collect name, mobile, email, preferred date and preferred time. Do not confirm until the scheduling automation verifies availability and creates the event.
- The automation alone creates Google Calendar events and Google Meet links, prevents duplicate bookings, sends confirmations, and updates CRM.
- Official websites: ABM Groups https://abmgroups.in; BM Academy https://thebmacademy.com; BM TechX https://bmtechx.in; Namma Pondy Properties https://nammapondyproperties.com; CoreTalents https://coretalents.in.
- For "your website" use the active brand. Share ABM Groups website only when specifically requested.

FALLBACKS
- Voice note: "Got your voice note 🎧 — could you type it quickly so I can help right away?"
- Unclear message: ask one short clarifying question.
- Send exactly one reply for each inbound WhatsApp message.`;

export const AIBrainView = () => {
  const [clients, setClients] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [tab, setTab] = useState('prompt');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [docs, setDocs] = useState({});

  const [promptText, setPromptText] = useState('');
  const [behaviorText, setBehaviorText] = useState(DEFAULT_BOT_BEHAVIOR);
  const [welcomeTemplate, setWelcomeTemplate] = useState('');
  const [migrating, setMigrating] = useState(false);
  const [dupCheckResult, setDupCheckResult] = useState(null);
  const [dupChecking, setDupChecking] = useState(false);

  useEffect(() => {
    const loadClients = async () => {
      try {
        const res = await api.getClients();
        setClients(res.clients || []);
        if (res.clients && res.clients.length > 0) {
          setSelectedClientId(res.clients[0].id);
        }
      } catch (err) {
        console.error('Error fetching clients:', err);
      }
    };
    loadClients();
  }, []);

  const selectedBrand = clients.find(c => c.id === selectedClientId);
  const selectedBrandName = selectedBrand?.name || 'Your Brand';
  const abmGroupClient = clients.find(c => c.name === 'ABM Groups') || clients[0];
  const abmGroupId = abmGroupClient?.id;

  useEffect(() => {
    if (!selectedClientId || !abmGroupId) return;
    const loadBrainDocs = async () => {
      setLoading(true);
      try {
        const [brandDocsRes, abmDocsRes] = await Promise.all([
          api.getBrainDocs(selectedClientId),
          api.getBrainDocs(abmGroupId)
        ]);
        
        const docMap = {};
        // Global behaviour and master knowledge are shared by all brands.
        abmDocsRes.docs?.forEach(d => {
          if (d.doc_type === 'prompt') {
            docMap[d.doc_type] = d.content;
          }
          if (d.doc_type === 'training') {
            docMap[d.doc_type] = d.content;
          }
        });
        // Product, pricing and welcome content belong to the selected brand.
        // A brand-specific document overrides the global fallback.
        brandDocsRes.docs?.forEach(d => {
          if (d.doc_type === 'welcome_template') {
            docMap[d.doc_type] = d.content;
          }
        });
        setDocs(docMap);
      } catch (err) {
        console.error('Error loading brain docs:', err);
      } finally {
        setLoading(false);
      }
    };
    loadBrainDocs();
  }, [selectedClientId, abmGroupId]);

  useEffect(() => {
    if (!selectedClientId || !abmGroupId) return;

    const legacyDefaultTemplate = `
# ABM Groups — Master Knowledge Base
**For: KAI (LeadOS internal) · WhatsApp Auto-Responder (shared number, all brands) · AllianceOS AI Brain**
**Approved BM source:** \`documentation/updated-brain-data.md\` exclusively supplies BM Academy and BM TechX facts.
Last updated: [update when edited] · Owner: Karthika (content) · Kamar (approval)

> **Critical architecture note:** This AI Brain runs on an internal shared WABA across **all 8 ABM Groups brands**. Never disclose that internal identifier. The only approved public contact number is **9944940051**. Every inbound message must pass through **brand detection FIRST**, before program/service detection. Answering a CoreTalents recruiter with BM Academy course pricing is a worse outcome than no automation. See \`BRAND_ROUTER\` below — this is the mandatory first chunk retrieved on every conversation.

> **Format note for dev:** Each \`##\` section is a self-contained RAG chunk. Every chunk now carries a \`brand:\` tag in addition to existing tags — filter on \`brand:\` first, then narrow by other tags.

---

## BRAND_ROUTER
tags: internal, brand-detection, ai-brain-only, mandatory-first-step

**Purpose:** identify which of the 8 ABM Groups brands an inbound message is about, BEFORE retrieving any program/service content.

| Brand | Signals to detect | Audience | Primary owner (routing) |
|---|---|---|---|
| **BM Academy** | course, training, program, placement, job, learn, student, admission | Students/job seekers | Kamar (closes ~80% direct) / counselor |
| **BM TechX** | agency, marketing services, ads for my business, website for my shop, SEO, social media management | Local business owners | Babila (SMM/Ads) / Imran (content) / delivery leads |
| **CoreTalents** | hiring, recruitment, placement fee, need staff, TPO, campus drive | Employers, colleges | Kamar / recruitment delivery lead |
| **Namma Pondy Properties (NPP)** | plot, property, land, villa, sq.ft, real estate, site visit | Buyers, investors, NRIs | Kamar / NPP delivery lead |
| **TravellersNeed** | trip, tour, package, IV trip, industrial visit, Pondicherry package | Students/colleges, families | Karthika (ops) / delivery lead |
| **Dada's Kitchen** | catering, food order, event food, wedding catering | Families, event planners | [confirm owner with Kamar] |
| **EduConsultants** | study abroad, visa, university admission, IELTS | Students wanting abroad study | [confirm owner with Kamar] |
| **BM Foundation** | CSR, donation, NGO, social work, sponsorship | CSR partners, community | [confirm owner with Kamar] |

**If brand is ambiguous** (e.g., "hi, I want to know more" with no other signal): AI Brain should ask ONE clarifying question — "Neenga edha pathi ketkareenga — course, agency services, jobs, property, illa trip?" — rather than guessing. Do not default to BM Academy just because it's the most common inbound topic; a wrong-brand answer damages trust across the whole ABM Groups relationship, not just one brand.

**Escalation default:** if a HOT lead's brand is unclear or spans multiple brands (e.g., a business owner asking about BM TechX services AND hiring via CoreTalents), route to Kamar directly — cross-brand opportunities are exactly the flywheel leads worth a human touch immediately.

---

## ABM_GROUPS_PROFILE
tags: company, brand, identity, all-brands

**ABM Groups** — multi-brand business ecosystem based in Kottakuppam, Pondicherry, Tamil Nadu. Founder & CEO: Kamarudeen BM (Kamar). Co-founder: Kamar's brother (opens ABM Groups Anniversary Week each Sept 5).

**Eight brands:**
1. BM Academy — digital skills training (see Module 2)
2. BM TechX — digital marketing agency (see Module 3)
3. CoreTalents — recruitment & placement (see Module 4)
4. Namma Pondy Properties (NPP) — real estate (see Module 5)
5. TravellersNeed — travel & college IV trips (see Module 6)
6. Dada's Kitchen — catering (see Module 7 — stub)
7. EduConsultants — study abroad (see Module 8 — stub)
8. BM Foundation — CSR (see Module 9 — stub)

**Team structure (for routing):**
- Kamar — strategy, sales closing, partnerships, high-score lead conversion (Friday audits)
- Karthika — admin/ops/SEO/WhatsApp coordination
- Babila — SMM and Meta Ads (BM TechX)
- Imran — video/design/creator delivery
- Role-based delivery leads — per technical program/service

**Contact isolation:** Never reuse one brand's phone number for another brand. BM Academy and BM TechX use the primary phone/WhatsApp details in their approved modules. Other brands use only their own confirmed records.

**Cross-brand flywheel** (mention when relevant to a cross-sell conversation): BM Academy trains → Velaivaaipu/CoreTalents place → BM TechX serves the employers those graduates work with. A BM TechX client could also be a BM Academy training prospect for their staff, etc.

---

__APPROVED_BM_ACADEMY_AND_BM_TECHX_MODULES__

## MODULE 4 — CORETALENTS
tags: brand:coretalents, module-header

**CoreTalents** — recruitment & placement, B2B employer side (locked to this side of the market; Velaivaaipu owns the student-facing jobs board).

**Placement fee model:**
- Freshers: ₹3,000–₹5,000 flat fee
- Experienced hires: 8.33% of CTC
- Senior hires: 12.5% of CTC

**College channel:** TPO (Training & Placement Officer) is the door-opener; Principal/Correspondent signs the cheque. Six-session Placement Readiness program sold to colleges at three tiers: Partner ₹25,000 / Pro ₹50,000 / Elite ₹75,000. Cluster recruitment drives pool students across colleges against shared employer inventory.

**Ideal client:** businesses needing to hire, colleges wanting placement support for students.

**Routing:** Kamar / recruitment delivery lead. College-side inquiries may need TPO-specific handling — escalate rather than auto-answer pricing to a college contact without human context.

**Objection handling:**
**"How is this different from Velaivaaipu?"** → Velaivaaipu is the student-facing job marketplace (candidates browse jobs); CoreTalents is the B2B side working directly with employers and colleges on recruitment contracts.

### CORETALENTS_BULK_CAMPAIGN_FOLLOWUP
tags: brand:coretalents, campaign-followup, deterministic, whatsapp-broadcast

Applies only when the assistant's most recent outbound message to this contact is the Core Talents bulk hiring broadcast (template: \`hiring_template\`) below:
"Hi 👋 Thank you for applying to Core Talents. We are currently hiring for 3 positions: 1) Business Development Executive (BDE) 2) Telecaller 3) Business Development Manager (BDM) — with a Google Form link to view the JD and book an interview slot, interview days July 28 to August 01."

- On the candidate's very FIRST reply after that broadcast (any content at all — "yes", "ok", a question, a role name, anything), reply with EXACTLY this line and nothing else. No greeting, no extra sentence, no brand recap:
  "For more details, kindly call this number: 9944940051."
- From the candidate's SECOND reply onward in the same conversation, stop sending the fixed line. Resume normal behavior — answer using the CoreTalents module above (roles, JD, interview process, "How is this different from Velaivaaipu?") or escalate per the routing rule for anything not covered here.
- This fixed-first-reply rule only applies to conversations that started from this exact bulk broadcast. Do not apply it to CoreTalents leads who came in through another channel or an older/different campaign template.

---

## MODULE 5 — NAMMA PONDY PROPERTIES (NPP)
tags: brand:npp, module-header

**Namma Pondy Properties** — real estate brand. Note: NPP is intentionally kept OUTSIDE the ABM Groups investor agreement — do not imply investor terms apply here.

**Positioning:** trust, documentation, and clarity-first. Property intake follows a strict SOP: compass-verified facing, original-photography-only listings (no stock/reused images).

**Channel model:** works with channel partners (e.g., G1 Properties as a B2B broker relationship).

**Example pricing reference (NOT a general rate — flag to human before quoting):** a past listing in Reddiyarpalayam was priced around ₹2,900/sq.ft. Property prices vary significantly by location/type — **never quote a price to a lead without confirming current listing details with a human first.**

**Ideal client:** buyers, investors, families, NRI buyers in Tamil Nadu/Pondicherry.

**Routing:** Kamar / NPP delivery lead. Property inquiries are high-trust, high-value — lean toward human handoff over full automation for anything beyond general "what areas do you have listings in" type questions.

**AI Brain caution:** do not auto-quote specific property prices, availability, or site-visit scheduling — always route to human for anything beyond general brand/process info.

---

## MODULE 6 — TRAVELLERSNEED
tags: brand:travellersneed, module-header

**TravellersNeed** — travel & college IV (industrial visit) trips.

**Strategy:** Pondicherry packages = hero cash product; college IV trips = second channel.

**IV trip pricing (per head):**
- Day IV trip: ₹650
- 2-day IV trip: ₹2,200
- Bangalore 2-day IV trip: ₹3,500

**Positioning:** authority-first marketing, destination menu approach (brochures don't lead with pricing).

**Ideal client:** students/colleges (IV trips), families/tourists (Pondicherry packages).

**Routing:** Karthika (ops) / delivery lead. Group bookings (colleges) may need custom quotes — escalate group-size-specific pricing beyond the standard IV rates above.

---

## MODULE 7 — DADA'S KITCHEN
tags: brand:dadas-kitchen, module-header, stub

**Dada's Kitchen** — catering brand under ABM Groups.

**Status: insufficient data in this KB.** No confirmed pricing, menu, or positioning details available yet. AI Brain should NOT attempt to answer specific catering inquiries (pricing, menu, availability) — route directly to a human and flag to Kamar/Karthika to supply content for this module.

---

## MODULE 8 — EDUCONSULTANTS
tags: brand:educonsultants, module-header, stub

**EduConsultants** — study abroad consulting brand under ABM Groups.

**Status: insufficient data in this KB.** No confirmed service scope, country focus, or pricing available yet. AI Brain should NOT attempt to answer specific study-abroad inquiries — route directly to a human and flag to Kamar/Karthika to supply content for this module.

---

## MODULE 9 — BM FOUNDATION
tags: brand:bm-foundation, module-header, stub

**BM Foundation** — CSR arm of ABM Groups.

**Status: insufficient data in this KB.** No confirmed program details, donation process, or partnership terms available yet. AI Brain should NOT attempt to answer specific CSR/donation inquiries — route directly to a human and flag to Kamar/Karthika to supply content for this module.

---

## DOCUMENT_LIBRARY
tags: internal, documents, ai-brain-only, all-brands

Maps which PDF/document exists for each brand/program, so the AI Brain never promises to send something that isn't built yet.

| Asset | Brand / Program | Status | Send trigger |
|---|---|---|---|
| Agency Accelerator Brochure (9-page) | BM Academy — Agency Accelerator | ✅ Built | Lead asks about Agency Accelerator, or requests a brochure |
| Main Program Guide PDF | BM Academy — all programs (umbrella) | ❌ Not yet built | Should be first-touch for any general BM Academy inquiry — **priority build** |
| Program-specific guides (DM Pro, Data Analytics, FSD, Content Creator, WordPress, AI Tools, UI/UX) | BM Academy — individual | ❌ Not yet built as PDFs (Google Drive syllabus links now available for most programs — see individual entries above; these are syllabus docs, not the full sales-guide PDFs) | After program/tier narrows down — matches existing funnel step |
| BM TechX Client Portfolio (18-page, Outstation Edition) | BM TechX | ⚠️ Exists per records — confirm current file location before wiring | Business inquiry about BM TechX services |
| NPP property listings/brochure | NPP | ❌ Not confirmed | Property inquiry |
| CoreTalents / TravellersNeed / Dada's Kitchen / EduConsultants / BM Foundation | — | ❌ Not built | — |

**AI Brain rule:** only send a PDF marked ✅ in this table. Google Drive syllabus links attached to individual BM Academy programs above may be shared directly when a lead asks for a syllabus specifically — this is distinct from the "Program Guide PDF" send-trigger, which still does not exist. If the relevant asset is ❌ or ⚠️, describe the program in the chat response instead (using the KB program chunk) and move straight to the call-booking CTA — do not claim a PDF is on its way if it doesn't exist.

---

## NURTURE_SEQUENCE
tags: internal, nurture, follow-up, ai-brain-only, all-brands

WF02 checks due leads every 10 minutes, but never messages a lead every 10 minutes. Each lead gets at most five staged touches: +4 hours, then +8 hours, +12 hours, +24 hours, and +3 days after the preceding touch.

Before every reminder, inspect the latest 10 messages from oldest to newest. Send only when the conversation is genuinely stuck after an assistant/outbound message. If the latest message is inbound and awaiting an answer, do not send a reminder; the sales conversation must answer it instead. Continue the exact active brand, course, service, job, property, trip, order, admission, or donation topic. Never ask the lead to repeat known information.

Generate follow-ups dynamically from the conversation context: warm, human, specific, no pressure, no invented facts/offers/deadlines, maximum 3 short sentences, and exactly one easy next-step question. Optimize for the appropriate conversion: booking/demo/enrollment for BM Academy, consultation/client call for BM TechX, application/hiring step for CoreTalents, site visit for NPP, trip booking for TravellersNeed, order for Dada's Kitchen, admission consultation for EduConsultants, and donation/volunteer action for BM Foundation.

WhatsApp policy is mandatory: AI free-text is allowed only inside the 24-hour customer-service window. Outside that window, use an approved brand template. Gemini may select the context and CTA but must not bypass the template requirement.

Automates the waiting gaps in the existing enrollment funnel (Enquiry → Program Guide PDF → program-specific guide → placement question → timeline qualification → correct tier pitch → uncertain leads → **Kamar direct call, ~80% close rate**). This sequence keeps a lead warm between "asked a question" and "got on the call" — it does not replace the human close.

**Touch 0 — Immediate (auto, on first inbound message):**
Answer the question (KB retrieval) → send relevant PDF if one exists in \`DOCUMENT_LIBRARY\` → ask ONE qualifying question if not already known ("Job venuma illa business venuma?" / "Eppo start panna ready?").

**Touch 1 — +4 hours, if no reply:**
Soft nudge referencing what was sent. E.g., "Program guide paathinga ah? Edhachum doubt irundha kelunga 🙂" — no new information, just a gentle re-open.

**Touch 2 — +8 hours after Touch 1, if still stuck:**
Send program-specific detail or proof (placement stat, testimonial, relevant guide if one exists) + a direct call CTA.

**Touch 3 — +12 hours after Touch 2:**
Urgency/social proof angle (e.g., seats filling, batch starting) + directly ask for a good day/time for a call.

**Touch 4 — +24 hours after Touch 3:**
Use an approved WhatsApp template because the service window may be closed. Keep the CTA aligned to the unfinished topic.

**Touch 5 — +3 days after Touch 4:**
Final respectful check-in. If no response after this, stop active automation and create a human-review task; do not keep daily-pinging.

**Stop conditions (sequence ends immediately if any of these happen):**
- Lead books a call/demo → stop, notify the brand owner, mark \`call_booked = true\`
- Lead enrolls → stop, hand off to student/client lifecycle
- Lead explicitly says not interested / opts out → stop immediately, send a respectful one-line exit, mark cold — never re-engage without an explicit later opt-in
- Unresponsive past Touch 5 → exit active automation and move to human review/monthly re-engagement only

**Brand note:** this exact cadence is modeled on BM Academy's proven funnel. For other brands (BM TechX, CoreTalents, NPP, TravellersNeed), reuse the same touch-timing skeleton but swap in brand-appropriate proof/CTA — do not copy BM Academy's exact wording into a B2B or property context.

---

## CALL_BOOKING_CTA
tags: internal, call-booking, ai-brain-only, all-brands

**Language consistency:** use the CTA phrasing that matches each program's existing collateral — don't mix them:
- Agency Accelerator → "Book a Free 1:1 Counseling Call" (matches its brochure)
- All other BM Academy programs → "Book Your Free 1:1 Demo" (matches their landing pages)
- Other brands → no established phrasing yet; default to "Free 1:1 call" until brand-specific collateral exists

**Booking mechanism (Google Calendar automation active):**
AI Brain collects the lead's name, mobile number, email, preferred date, and preferred time. The backend checks the organizer Calendar before confirming. If available, automation creates the Calendar event and Google Meet link, sends confirmations, updates CRM, and schedules the 60-, 30-, and 10-minute WhatsApp reminders. If occupied, ask for another time. Never claim confirmation unless the Calendar operation succeeds.

**Golden rule:** every AI Brain response should be working toward one of three outcomes — a booked call, an engaged lead with a next scheduled touch, or a respectful close if the lead has opted out. Never end a conversation with just an answer and no forward motion, unless the lead has explicitly asked to be left alone.

---

## LEAD_QUALIFICATION_SIGNALS
tags: internal, lead-scoring, ai-brain-only, all-brands

Cross-brand scoring framework — reconcile with LeadOS's existing 14-rule CRM business logic spec before final deployment; this is the AI Brain's input into that system, not a replacement.

**HOT signals (route to human within SLA) — apply across all brands:**
- Names a specific program/service + asks pricing/EMI in same message
- Asks about refund/placement/contract-specific policy
- Asks "when can we start" / timeline-specific
- Requests a call, demo, or site visit directly
- Mentions their own deadline
- Repeat visitor (check CRM history)
- **Any NPP property inquiry beyond general info** (auto-escalate — high-value, trust-sensitive)
- **Any cross-brand signal** (e.g., business owner asking about BOTH BM TechX services and hiring via CoreTalents) — route to Kamar directly, these are flywheel opportunities

**WARM signals (auto-answer via KB, soft-CTA to book a call):**
General inquiry about a named brand/program, curriculum/service-scope questions, comparing options.

**COLD signals (auto-answer + nurture, no urgent escalation):**
Generic "hi/tell me more" with no brand or program named — trigger the BRAND_ROUTER clarifying question first.

**Never let the AI Brain do (any brand):**
- Quote NPP property prices without human confirmation
- Promise placement outcomes/salary as guaranteed
- Offer discounts beyond documented policy
- Answer Dada's Kitchen / EduConsultants / BM Foundation inquiries beyond "let me connect you with our team"
- Guess which brand a message is about when genuinely ambiguous — ask, don't assume
- Claim a PDF was sent if it isn't marked ✅ in \`DOCUMENT_LIBRARY\`
- Auto-confirm a specific call time without human confirmation (see \`CALL_BOOKING_CTA\`)
- Continue the nurture sequence after a lead has booked a call, enrolled, or opted out

---

## AI_RESPONSE_STYLE_GUIDE
tags: internal, tone, ai-brain-only, all-brands

- Tanglish tone throughout, matching Kamar's direct/warm/non-corporate style — consistent across brands, but slightly more formal for B2B (BM TechX, CoreTalents, NPP) vs. peer-to-peer casual for BM Academy student conversations.
- WhatsApp-short: 2–4 sentences, multiple messages over one long paragraph.
- Never sound scripted — vary phrasing across similar questions.
- Always end with a clear next step (answer + soft question, or direct CTA).
- If outside KB scope, say so honestly and route to human — never guess, especially on pricing, refunds, placement guarantees, or property details.
- Use BM Academy and BM TechX terminology only as written in their approved modules.
- Always confirm brand context before diving into program/service details — if unclear, ask the BRAND_ROUTER clarifying question first.
- For Kids & Teens track programs, address the parent, not the student — reassurance-first tone, not peer-to-peer career framing.

---

## GAPS_TO_FILL
tags: internal, todo

- [ ] Dada's Kitchen — full content module needed (pricing, menu, positioning).
- [ ] EduConsultants — full content module needed (services, countries, pricing).
- [ ] BM Foundation — full content module needed (programs, donation process).
- [ ] Confirm owners for Dada's Kitchen / EduConsultants / BM Foundation routing (currently unassigned in BRAND_ROUTER table).
- [ ] Reconcile LEAD_QUALIFICATION_SIGNALS with existing LeadOS 14-rule CRM spec.
- [ ] Decide on calendar integration for call-booking (currently manual slot-confirmation via human) — Google Calendar via n8n is the natural fit given existing tool access.

`;

    const approvedBrandModules = `## MODULE 2 — BM ACADEMY
tags: brand:bm-academy, memory-managed

Use only the current BM Academy product/pricing memory. No course facts are stored in this shared prompt.

---

## MODULE 3 — BM TECHX
tags: brand:bm-techx, memory-managed

Use only the current BM TechX product/pricing memory. No service facts are stored in this shared prompt.

---

`;
    const defaultTemplate = legacyDefaultTemplate.replace(
      '__APPROVED_BM_ACADEMY_AND_BM_TECHX_MODULES__',
      approvedBrandModules
    );

    // The shared prompt contains routing/behavior only. All mutable BM Academy
    // and BM TechX facts live in their brand-specific memory documents.
    const replaceBrandModules = (content) => {
      const source = String(content || '');
      const moduleRange = /## MODULE 2[^\n]*BM ACADEMY[\s\S]*?(?=## MODULE 4[^\n]*CORETALENTS)/i;
      return moduleRange.test(source) ? source.replace(moduleRange, approvedBrandModules) : defaultTemplate;
    };
    const promptVal = replaceBrandModules(docs.prompt);
    // Shared behavior is code-managed to prevent an older saved training row
    // from restoring legacy BM brand rules or contact details.
    const behaviorVal = DEFAULT_BOT_BEHAVIOR;
    const welcomeTemplateVal = docs.welcome_template || '';

    setPromptText(promptVal);
    setBehaviorText(behaviorVal);
    setWelcomeTemplate(welcomeTemplateVal);
  }, [docs, selectedClientId, selectedBrandName]);

  const handleSave = async () => {
    if (!selectedClientId || !abmGroupId) return;
    setSaving(true);
    try {
      await Promise.all([
        api.saveBrainDoc(abmGroupId, 'prompt', promptText),
        api.saveBrainDoc(abmGroupId, 'training', behaviorText),
        api.saveBrainDoc(selectedClientId, 'welcome_template', welcomeTemplate),
      ]);
      alert('AI Brain settings saved for ' + selectedBrandName + '. Brand facts come from documentation/updated-brain-data.md.');
    } catch (err) {
      alert('Failed to save AI Brain config: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleMigrateDB = async () => {
    setMigrating(true);
    try {
      const res = await api.post('/leads/migrate-flow-step', {});
      alert(res.message || 'DB migration successful!');
    } catch (err) {
      alert('Migration failed: ' + err.message);
    } finally {
      setMigrating(false);
    }
  };

  const handleCheckDuplicates = async () => {
    setDupChecking(true);
    setDupCheckResult(null);
    try {
      const res = await api.getClients();
      const allClients = res.clients || [];

      // Group clients by normalized name (lowercase, strip spaces/hyphens/underscores)
      const groups = {};
      allClients.forEach(c => {
        const key = c.name.toLowerCase().replace(/[\s\-_]+/g, '');
        if (!groups[key]) groups[key] = [];
        groups[key].push(c);
      });

      // Find groups with more than 1 client (duplicates)
      const duplicateGroups = Object.values(groups).filter(g => g.length > 1);

      if (duplicateGroups.length === 0) {
        setDupCheckResult({ message: 'No duplicate brands found! All brands are unique.', type: 'ok' });
        return;
      }

      // For each duplicate group, check which one has brain docs or leads
      const results = [];
      for (const group of duplicateGroups) {
        const checked = await Promise.all(group.map(async (c) => {
          let hasBrainDocs = false;
          let hasLeads = false;
          try {
            const brainRes = await api.getBrainDocs(c.id);
            hasBrainDocs = (brainRes.docs || []).some(d => d.content && d.content.trim().length > 0);
          } catch (e) { }
          try {
            const leadsRes = await api.getLeads({ brand: c.name, limit: 1 });
            hasLeads = (leadsRes.leads || []).length > 0;
          } catch (e) { }
          return { ...c, hasBrainDocs, hasLeads, isActive: hasBrainDocs || hasLeads };
        }));
        results.push(checked);
      }

      setDupCheckResult({ groups: results, type: 'found' });
    } catch (err) {
      setDupCheckResult({ message: 'Check failed: ' + err.message, type: 'error' });
    } finally {
      setDupChecking(false);
    }
  };

  const handleDeleteDuplicate = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete "${name}" (ID: ${id})?\n\nThis is the INACTIVE duplicate with no leads or brain data. This action cannot be undone.`)) return;
    try {
      await api.deleteClient(id);
      const res = await api.getClients();
      setClients(res.clients || []);
      setDupCheckResult({ message: `"${name}" was successfully deleted. The duplicate has been removed!`, type: 'ok' });
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  };

  return (
    <div className="p-mobile" style={{ padding: 26, overflowY: 'auto', height: '100%' }}>
      <div className="flex-col-mobile" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 22 }}>
        <div>
          <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: 21, fontWeight: 800, color: C.text }}>AI Brain Configuration</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>Configure what each brand AI agent knows and how it closes</p>
        </div>
        <select 
          value={selectedClientId || ''} 
          onChange={(e) => setSelectedClientId(parseInt(e.target.value))} 
          style={{ 
            display: tab === 'settings' ? 'block' : 'none',
            background: C.card, 
            border: '1px solid ' + C.border, 
            borderRadius: 7, 
            color: C.text, 
            padding: '8px 12px', 
            fontSize: 12, 
            outline: 'none' 
          }}
        >
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>Loading AI Brain Configuration...</div>
      ) : (
        <>
          <div className="flex-col-mobile" style={{ background: C.accent + '10', border: '1px solid ' + C.accentDim, borderRadius: 11, padding: '11px 15px', marginBottom: 18, display: 'flex', alignItems: 'flex-start', gap: 9 }}>
            <Brain size={15} color={C.accent} />
            <p style={{ fontSize: 12, color: C.accent }}>AI Agent for <strong>{selectedBrandName}</strong> is <strong>Active</strong> · Status: Connected to Postgres DB</p>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, background: C.card, border: '1px solid ' + C.border, borderRadius: 9, overflow: 'hidden', marginBottom: 18 }}>
            {['prompt', 'settings', 'guide'].map((t) => (
              <button key={t} onClick={() => setTab(t)} style={{ padding: '7px 15px', fontSize: 11, fontWeight: 600, border: 'none', background: tab === t ? C.accent : 'transparent', color: tab === t ? '#fff' : C.muted, textTransform: 'capitalize' }}>
                {t === 'prompt' ? 'System Prompt' : t === 'settings' ? '⚙ Settings' : '📖 How to Use'}
              </button>
            ))}
          </div>

          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 14, padding: 22 }}>

            {tab === 'prompt' && (
              <div>
                <h3 style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>Agent Behaviour — <span style={{ color: C.accent }}>ABM Groups Shared WhatsApp</span></h3>
                <div style={{ background: C.accent + '08', border: '1px solid ' + C.accentDim, borderRadius: 7, padding: 11, marginBottom: 13 }}>
                  <p style={{ fontSize: 11, color: C.accent }}>This text is sent as the bot’s behaviour/system layer. Put greeting, routing, memory, booking and fallback rules here—not course prices or property inventory.</p>
                </div>
                <textarea
                  value={behaviorText}
                  onChange={(e) => setBehaviorText(e.target.value)}
                  style={{ width: '100%', height: 320, background: C.surface, border: '1px solid ' + C.border, borderRadius: 7, color: '#60a5fa', padding: 16, fontSize: 13, outline: 'none', fontFamily: 'monospace', lineHeight: 1.7, resize: 'vertical', marginBottom: 22 }}
                />

                <h3 style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Shared AI Routing Rules</h3>
                <p style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>BM Academy and BM TechX facts are read only from documentation/updated-brain-data.md. This editor contains shared routing rules, not duplicated product or pricing details.</p>
                <textarea
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  style={{ width: '100%', height: 280, background: C.surface, border: '1px solid ' + C.border, borderRadius: 7, color: '#10b981', padding: 16, fontSize: 13, outline: 'none', fontFamily: 'monospace', lineHeight: 1.8, resize: 'vertical', marginBottom: 18 }}
                />

              </div>
            )}

            {tab === 'settings' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                <h3 style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>Brand Automation Settings</h3>

                {/* Welcome Template */}
                <div style={{ background: C.surface, border: '1px solid ' + C.border, borderRadius: 9, padding: 18 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>📱 WhatsApp Welcome Template Name</label>
                  <p style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>The exact Meta-approved template name to send when a new lead is added for <strong style={{ color: C.accent }}>{selectedBrandName}</strong>. Must be approved in your Meta Business Manager.</p>
                  <input
                    type="text"
                    value={welcomeTemplate}
                    onChange={(e) => setWelcomeTemplate(e.target.value)}
                    placeholder="e.g. bm_academy_welcome  or  common_welcome_message"
                    style={{ width: '100%', background: C.bg, border: '1px solid ' + C.border, borderRadius: 7, padding: '10px 13px', color: C.text, fontSize: 13, outline: 'none', fontFamily: 'monospace' }}
                  />
                  <p style={{ fontSize: 10, color: C.muted, marginTop: 7 }}>💡 Each brand can have its own unique template. Add a new brand anytime — just set its template name here and save.</p>
                </div>

                {/* Duplicate Brand Checker */}
                <div style={{ background: '#1a2a1a', border: '1px solid #16a34a33', borderRadius: 9, padding: 18 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#16a34a', marginBottom: 6 }}>🔍 Check & Remove Duplicate Brands</label>
                  <p style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>
                    Scans all brands, detects duplicates by similar name, checks which one has active leads or brain data, and marks the safe-to-delete one. The <strong style={{ color: '#16a34a' }}>active brand</strong> is always kept. Only the <strong style={{ color: '#dc2626' }}>empty duplicate</strong> gets a delete button.
                  </p>
                  <button
                    type="button"
                    onClick={handleCheckDuplicates}
                    disabled={dupChecking}
                    style={{ background: '#16a34a', border: 'none', borderRadius: 7, color: '#fff', padding: '8px 20px', fontSize: 12, fontWeight: 700, cursor: dupChecking ? 'not-allowed' : 'pointer', opacity: dupChecking ? 0.6 : 1 }}
                  >
                    {dupChecking ? '⏳ Checking...' : '🔍 Run Duplicate Check'}
                  </button>

                  {dupCheckResult && dupCheckResult.type !== 'found' && (
                    <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 7, background: dupCheckResult.type === 'ok' ? '#16a34a22' : '#dc262622', border: '1px solid ' + (dupCheckResult.type === 'ok' ? '#16a34a55' : '#dc262655') }}>
                      <p style={{ fontSize: 12, color: dupCheckResult.type === 'ok' ? '#16a34a' : '#dc2626', margin: 0 }}>{dupCheckResult.message}</p>
                    </div>
                  )}

                  {dupCheckResult && dupCheckResult.type === 'found' && dupCheckResult.groups.map((group, gi) => (
                    <div key={gi} style={{ marginTop: 14, background: C.surface, border: '1px solid ' + C.border, borderRadius: 9, overflow: 'hidden' }}>
                      <div style={{ padding: '8px 14px', background: '#2a1a00', borderBottom: '1px solid ' + C.border }}>
                        <p style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>⚠ Duplicate Group Detected</p>
                      </div>
                      {group.map(c => (
                        <div key={c.id} style={{ padding: '12px 14px', borderBottom: '1px solid ' + C.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                          <div>
                            <p style={{ fontSize: 13, fontWeight: 700, color: c.isActive ? '#16a34a' : '#dc2626' }}>
                              {c.isActive ? '✅' : '❌'} {c.name} <span style={{ fontSize: 10, color: C.muted, fontWeight: 400 }}>(ID: {c.id})</span>
                            </p>
                            <p style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
                              {c.hasBrainDocs ? '🧠 Has brain docs' : '🧠 No brain docs'} &nbsp;·&nbsp; {c.hasLeads ? '👤 Has leads' : '👤 No leads'}
                            </p>
                          </div>
                          {!c.isActive ? (
                            <button
                              type="button"
                              onClick={() => handleDeleteDuplicate(c.id, c.name)}
                              style={{ background: '#dc2626', border: 'none', borderRadius: 6, color: '#fff', padding: '7px 16px', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                            >
                              🗑 Delete (Safe)
                            </button>
                          ) : (
                            <span style={{ fontSize: 10, color: '#16a34a', fontWeight: 700, whiteSpace: 'nowrap', background: '#16a34a22', padding: '4px 10px', borderRadius: 5 }}>KEEP — Active</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                {/* DB Migration */}
                <div style={{ background: '#1a1a2e', border: '1px solid #3b82f633', borderRadius: 9, padding: 18 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#3b82f6', marginBottom: 6 }}>🛢 One-Time Database Migration</label>
                  <p style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>Run this once to add the <code style={{ color: '#3b82f6' }}>flow_step</code> column to your leads table. Required for the conversation flow tracking to work. Safe to run multiple times.</p>
                  <button
                    type="button"
                    onClick={handleMigrateDB}
                    disabled={migrating}
                    style={{ background: '#3b82f6', border: 'none', borderRadius: 7, color: '#fff', padding: '8px 20px', fontSize: 12, fontWeight: 700, cursor: migrating ? 'not-allowed' : 'pointer', opacity: migrating ? 0.6 : 1 }}
                  >
                    {migrating ? 'Running Migration...' : '▶ Run DB Migration'}
                  </button>
                </div>

                {/* How It Works */}
                <div style={{ background: C.accent + '08', border: '1px solid ' + C.accentDim, borderRadius: 9, padding: 18 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.accent, marginBottom: 10 }}>⚡ How the Automation Works</label>
                  <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.9 }}>
                    <p>1. <strong style={{ color: C.text }}>New Lead Added</strong> → Webhook fires to n8n → Sends your brand's welcome template to the lead via WhatsApp</p>
                    <p>2. <strong style={{ color: C.text }}>Lead Replies</strong> → Meta sends to your server → Server forwards to n8n AI Agent</p>
                    <p>3. <strong style={{ color: C.text }}>n8n reads Conv Flow</strong> → Checks lead's <code>flow_step</code> → Asks the next qualifying question using Gemini AI</p>
                    <p>4. <strong style={{ color: C.text }}>After all questions</strong> → AI switches to free mode using your System Prompt knowledge</p>
                    <p>5. <strong style={{ color: C.text }}>Lead Score updates</strong> → InboxView shows the conversation in real-time</p>
                  </div>
                </div>
              </div>
            )}

            {tab === 'guide' && (
              <div style={{ lineHeight: 1.7, padding: '0 10px' }}>
                <h3 style={{ fontFamily: "'Syne',sans-serif", fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 18 }}>📖 AI Brain Configuration Guide</h3>

                <div style={{ marginBottom: 20 }}>
                  <h4 style={{ fontSize: 13, color: C.accent, marginBottom: 6 }}>1. Select Your Brand</h4>
                  <p style={{ fontSize: 12, color: C.muted }}>Use the top-right dropdown to switch between brands. Each brand has its own separate System Prompt stored independently in the database. Switching brands loads that brand's specific configuration.</p>
                </div>

                <div style={{ marginBottom: 20 }}>
                  <h4 style={{ fontSize: 13, color: C.accent, marginBottom: 6 }}>2. Edit the System Prompt</h4>
                  <p style={{ fontSize: 12, color: C.muted }}>The "System Prompt" tab contains the complete instruction set for the AI. Fill in each section directly in the text box — WORKFLOW STRUCTURE, PRODUCT KNOWLEDGE, PRICING, HANDLING OBJECTIONS, SOCIAL PROOF, and AI TRAINING INSTRUCTIONS.</p>
                </div>

                <div style={{ marginBottom: 24 }}>
                  <h4 style={{ fontSize: 13, color: C.accent, marginBottom: 6 }}>3. Settings & Maintenance</h4>
                  <p style={{ fontSize: 12, color: C.muted }}>Use the "Settings" tab to configure the WhatsApp welcome template for each brand. You can also run the duplicate brand checker here to keep your brand list clean.</p>
                </div>

                <div style={{ background: C.accent + '11', border: '1px solid ' + C.accent + '44', padding: 16, borderRadius: 8 }}>
                  <h4 style={{ fontSize: 13, color: C.text, marginBottom: 6 }}>Don't forget to Save!</h4>
                  <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>When you are done editing, click the orange <strong>Save and Activate</strong> button. Changes apply immediately to all new AI responses for the selected brand.</p>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, marginTop: 18, paddingTop: 18, borderTop: '1px solid ' + C.border }}>
            <button type="button" onClick={() => setDocs({ ...docs })} style={{ background: 'transparent', border: '1px solid ' + C.border, borderRadius: 7, color: C.muted, padding: '7px 14px', fontSize: 12, cursor: 'pointer' }}>Reset</button>
            <button type="button" onClick={handleSave} disabled={saving} style={{ background: C.accent, border: 'none', borderRadius: 7, color: '#fff', padding: '7px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Activating...' : 'Save and Activate'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};
