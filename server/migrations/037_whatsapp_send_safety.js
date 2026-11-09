#!/usr/bin/env node
/**
 * Migration 038 — WhatsApp send safety (plan N1).
 *
 * MongoDB migration, written as a file only: it is never run by the server.
 * Run it once by hand against the target database:
 *
 *   MONGODB_URI=... node migrations/037_whatsapp_send_safety.js --dry-run   # report only
 *   MONGODB_URI=... node migrations/037_whatsapp_send_safety.js --apply
 *
 * What it does (idempotent):
 *   1. Creates the indexes of whatsapp_consents, whatsapp_number_state and the
 *      extended campaign_message_queue.
 *   2. Backfills whatsapp_consents from the lead flags that existed before:
 *        leads.whatsapp_opt_in = true           → opted_in  (source legacy_backfill)
 *        leads.whatsapp_opt_out / opted_out     → opted_out (source legacy_backfill)
 *      One row per (tenant, last-10-digits phone); an opt-out wins over an
 *      opt-in for the same number. Existing consent rows are left alone.
 *   3. Gives every open campaign_message_queue row the new fields:
 *      kind = 'marketing', next_attempt_at = now, msg_type = 'template'.
 *   4. Creates a whatsapp_number_state row for every connected brand number
 *      so the daily cap starts at WA_DAILY_CAP_START (default 250).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const apply = process.argv.includes('--apply');
if (!apply && !process.argv.includes('--dry-run')) {
  console.error('Pass --dry-run to report or --apply to write.');
  process.exit(2);
}

async function main() {
  const { connectMongo, mongoose } = require('../db/mongo');
  const { Leads, Clients, WhatsappConsents, WhatsappNumberState, CampaignMessageQueue } = require('../models');
  const { runAsSystem } = require('../services/tenantContext');
  await connectMongo();
  const startCap = Number(process.env.WA_DAILY_CAP_START) > 0 ? Number(process.env.WA_DAILY_CAP_START) : 250;
  const now = new Date();

  await runAsSystem(async () => {
    // 1. indexes
    if (apply) await Promise.all([WhatsappConsents.createIndexes(), WhatsappNumberState.createIndexes(), CampaignMessageQueue.createIndexes()]);
    console.log(`[038] indexes ${apply ? 'created' : 'would be created'}`);

    // 2. consent backfill
    const flagged = await Leads.find(
      { $or: [{ whatsapp_opt_in: true }, { whatsapp_opt_out: true }, { opted_out: true }], tenant_id: { $ne: null }, phone: { $nin: [null, ''] } },
      { _id: 0, id: 1, tenant_id: 1, phone: 1, whatsapp_opt_in: 1, whatsapp_opt_in_at: 1, whatsapp_opt_out: 1, whatsapp_opt_out_at: 1, opted_out: 1, opted_out_at: 1 },
    ).lean();
    const byKey = new Map();
    for (const lead of flagged) {
      const digits = String(lead.phone).replace(/\D/g, '');
      const key = digits.slice(-10);
      if (key.length < 10) continue;
      const mapKey = `${lead.tenant_id}:${key}`;
      const out = Boolean(lead.whatsapp_opt_out || lead.opted_out);
      const current = byKey.get(mapKey);
      if (current?.status === 'opted_out') continue;
      if (out) {
        byKey.set(mapKey, { tenant_id: lead.tenant_id, lead_id: lead.id, phone: digits, phone_key: key, status: 'opted_out', at: lead.whatsapp_opt_out_at || lead.opted_out_at || now });
      } else if (lead.whatsapp_opt_in && !current) {
        byKey.set(mapKey, { tenant_id: lead.tenant_id, lead_id: lead.id, phone: digits, phone_key: key, status: 'opted_in', at: lead.whatsapp_opt_in_at || now });
      }
    }
    let created = 0;
    let kept = 0;
    for (const entry of byKey.values()) {
      const exists = await WhatsappConsents.exists({ tenant_id: entry.tenant_id, phone_key: entry.phone_key });
      if (exists) { kept++; continue; }
      created++;
      if (!apply) continue;
      const event = { type: entry.status === 'opted_in' ? 'opt_in' : 'opt_out', source: 'legacy_backfill', text: 'Backfilled from the lead flags by migration 037', at: entry.at, by: null };
      const doc = {
        tenant_id: entry.tenant_id, lead_id: entry.lead_id, phone: entry.phone, phone_key: entry.phone_key, status: entry.status, events: [event], created_at: now, updated_at: now,
      };
      if (entry.status === 'opted_in') Object.assign(doc, { opt_in_source: 'legacy_backfill', opt_in_at: entry.at, opt_in_text: event.text });
      else Object.assign(doc, { opt_out_source: 'legacy_backfill', opt_out_at: entry.at, opt_out_text: event.text });
      try { await WhatsappConsents.create(doc); } catch (error) { if (error.code !== 11000) throw error; }
    }
    console.log(`[038] consent rows: ${created} ${apply ? 'created' : 'to create'}, ${kept} already present`);

    // 3. queue rows
    const openRows = await CampaignMessageQueue.countDocuments({ status: { $in: ['pending', 'processing'] }, kind: { $exists: false } });
    if (apply) {
      await CampaignMessageQueue.updateMany({ kind: { $exists: false } }, { $set: { kind: 'marketing', msg_type: 'template', source: 'campaign' } });
      await CampaignMessageQueue.updateMany({ status: 'pending', next_attempt_at: { $exists: false } }, { $set: { next_attempt_at: now } });
    }
    console.log(`[038] open queue rows ${apply ? 'updated' : 'to update'}: ${openRows}`);

    // 4. number state
    const brands = await Clients.find({ phone_number_id: { $nin: [null, ''] }, tenant_id: { $ne: null } }, { _id: 0, id: 1, tenant_id: 1, phone_number_id: 1 }).lean();
    let states = 0;
    for (const brand of brands) {
      const exists = await WhatsappNumberState.exists({ tenant_id: brand.tenant_id, phone_number_id: String(brand.phone_number_id) });
      if (exists) continue;
      states++;
      if (!apply) continue;
      try {
        await WhatsappNumberState.create({
          tenant_id: brand.tenant_id, client_id: brand.id, phone_number_id: String(brand.phone_number_id), day: now.toISOString().slice(0, 10),
          minute: now.toISOString().slice(0, 16), daily_cap: startCap, quality_rating: 'UNKNOWN', created_at: now, updated_at: now,
        });
      } catch (error) { if (error.code !== 11000) throw error; }
    }
    console.log(`[038] number state rows ${apply ? 'created' : 'to create'}: ${states} (daily cap ${startCap})`);
  }, 'migration-037');

  await mongoose.disconnect();
  console.log(`[038] ${apply ? 'applied' : 'dry run complete'}`);
}

main().catch((error) => {
  console.error('[038] failed:', error.message);
  process.exit(1);
});
