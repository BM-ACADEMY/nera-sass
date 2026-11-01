/**
 * Sets up the AI Brain for Nera's own workspace from the approved spec text.
 * Dry run by default. Nothing is written without --apply, and an existing row
 * is only changed by --apply on that workspace; the AI stays off either way.
 *
 *   node scripts/setup-nera-brain.js --tenant <id> [--apply]
 */
const { connectMongo } = require('../db/mongo');
const mongoose = require('mongoose');
const { BrainDocs, BrainProfiles, Clients, Tenants } = require('../models');
const { runAsSystem, runAsTenant } = require('../services/tenantContext');

const NERA_PROMPT = `You are the Nera assistant on WhatsApp, replying for Nera, a product of Afra Ventures Private Limited.

WHAT NERA IS
Nera LeadOS is a WhatsApp-first lead management platform for businesses. It brings leads from Meta lead ads and WhatsApp into one place, lets teams reply from a shared inbox, run approved template campaigns, track sales tasks, and use an AI assistant that replies to leads using the business's own knowledge.

YOUR JOB
1. Understand what the person's business does and how they get leads today.
2. Answer questions about Nera using only the knowledge below.
3. Qualify: business type, monthly lead volume, team size, current WhatsApp setup.
4. Offer a demo with the Nera team and collect name, business name and preferred time.
5. Hand off to a human when the rules say so.

HOW TO WRITE
- Short WhatsApp messages: 1 to 3 sentences, one question at a time.
- Reply in the language the person uses.
- Friendly, clear, no hype, no emojis unless the person uses them.

PRICING
- Do not quote any price, discount or plan limit.
- Say plans depend on team size and usage, and that the Nera team will share the right plan and a payment link after a short call.
- Exception: if the runtime context includes approved plan data, you may share it exactly as given.

NEVER
- Promise a launch date, a feature not listed below, or Meta approval timelines.
- Claim Nera is integrated with a tool not listed below.
- Ask for passwords, OTPs, card numbers or Meta login details.
- Discuss other customers or share any customer's data.

HANDOFF
Hand off to the Nera sales team when the person asks for pricing details, a contract, a custom feature, a refund or billing issue, says they want to buy, or is an existing customer reporting a problem.`;

const NERA_KNOWLEDGE = [
  ['What Nera does', 'Captures leads from Meta lead ads and WhatsApp, shared inbox, template campaigns with rate control, sales tasks, AI auto-replies trained on the business\'s own documents.'],
  ['WhatsApp number', 'Each customer connects its own WhatsApp Business account through Meta Embedded Signup; Nera does not lend its number.'],
  ['Requirements', 'A Meta business account and a phone number that can be registered on WhatsApp Business; Meta business verification may be needed.'],
  ['AI replies', 'Answers from the business\'s own knowledge; hands off to the team for anything it cannot answer; can be switched off per business.'],
  ['Data', 'Each business sees only its own data; Nera does not share data between customers.'],
  ['Getting started', 'Demo call, plan selection, payment link from the Nera team, guided onboarding by Nera staff.'],
  ['Pricing', 'Shared by the sales team after the call.'],
  ['Seller and invoices', 'Afra Ventures Private Limited issues invoices with GST.'],
  ['Legal', 'Privacy Policy: https://getnera.in/privacy-policy/ and Terms: https://getnera.in/terms/'],
];

// Nera's prompt carries its own rules; these fields only drive hours and display.
const NERA_PROFILE = {
  business_name: 'Nera',
  timezone: 'Asia/Kolkata',
  pricing_policy: 'never_share',
};

async function main() {
  const args = process.argv.slice(2);
  const tenantId = Number(args[args.indexOf('--tenant') + 1]);
  const apply = args.includes('--apply');
  if (!args.includes('--tenant') || !Number.isInteger(tenantId) || tenantId <= 0) throw new Error('Usage: node scripts/setup-nera-brain.js --tenant <id> [--apply]');

  await connectMongo();
  const tenant = await runAsSystem(() => Tenants.findOne({ id: tenantId }, { _id: 0, id: 1, name: 1 }).lean(), 'setup-nera-brain');
  if (!tenant) throw new Error(`Workspace ${tenantId} not found`);
  console.log(`Workspace: #${tenant.id} ${tenant.name}`);
  console.log(`${apply ? 'Writing' : 'Would write'}: 1 brain profile (AI off) and ${NERA_KNOWLEDGE.length} knowledge items`);
  if (!apply) {
    console.log('Dry run. Add --apply to write.');
    return;
  }

  await runAsTenant(tenantId, async () => {
    const client = await Clients.findOne({}, { _id: 0, id: 1 }).sort({ id: 1 }).lean();
    if (!client) throw new Error('This workspace has no brand profile yet');
    await BrainProfiles.updateOne(
      {},
      {
        $set: { version_type: 'nera', system_prompt_override: NERA_PROMPT, profile: NERA_PROFILE, updated_at: new Date() },
        $inc: { brain_version: 1 },
        $setOnInsert: { ai_enabled: false },
      },
      { upsert: true },
    );
    for (const [index, [title, content]] of NERA_KNOWLEDGE.entries()) {
      await BrainDocs.updateOne(
        { client_id: client.id, doc_type: `faq:nera-${index + 1}` },
        { $set: { title, content, is_active: true, updated_at: new Date() } },
        { upsert: true },
      );
    }
  });
  console.log('Done. The AI stays off until staff approve it and it is turned on.');
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
