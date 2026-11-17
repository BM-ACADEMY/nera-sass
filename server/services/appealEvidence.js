/**
 * Appeal evidence for one workspace.
 *
 * What staff attach to a Meta appeal or a customer dispute when a number is
 * flagged or restricted: how contacts opted in, how STOP was honoured, what was
 * sent, the number's quality history and what staff did. It is built for
 * showing to a third party, so it carries no message text, no contact names and
 * no full phone numbers (last four digits only), and never a token or secret.
 */
const { Tenants, Clients, WhatsappConsents, WhatsappNumberState, CampaignMessageQueue, AuditEvents, MetaWhatsappTemplates } = require('../models');
const { runAsSystem, runAsTenant } = require('./tenantContext');
const { stripSecrets } = require('./clientSecrets');

const DAY_MS = 24 * 60 * 60 * 1000;
const maskPhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? `•••• ${digits.slice(-4)}` : null;
};
const shorten = (value, max = 300) => (value == null ? null : String(value).slice(0, max));
const countsBy = (rows, field) => Object.fromEntries(rows.map((r) => [r._id ?? 'unknown', r.n]));

async function buildAppealEvidence(tenantId, { days = 90, sampleSize = 25, now = new Date() } = {}) {
  const id = Number(tenantId);
  const tenant = await runAsSystem(() => Tenants.findOne({ id }, { _id: 0 }).lean(), 'appeal-evidence');
  if (!tenant) return null;
  const windowDays = Math.min(Math.max(Number(days) || 90, 1), 365);
  const size = Math.min(Math.max(Number(sampleSize) || 25, 1), 100);
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const body = await runAsTenant(id, async () => {
    const brand = await Clients.findOne({}, { _id: 0, id: 1, name: 1, whatsapp_number: 1, phone_number_id: 1, wa_business_id: 1, whatsapp_status: 1, whatsapp_verified_at: 1 }).lean();

    const [byStatus, optInBySource, optOutBySource, optInSample, optOutSample] = await Promise.all([
      WhatsappConsents.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      WhatsappConsents.aggregate([{ $match: { opt_in_at: { $ne: null } } }, { $group: { _id: '$opt_in_source', n: { $sum: 1 } } }]),
      WhatsappConsents.aggregate([{ $match: { opt_out_at: { $ne: null } } }, { $group: { _id: '$opt_out_source', n: { $sum: 1 } } }]),
      WhatsappConsents.find({ opt_in_at: { $ne: null } }, { _id: 0, phone: 1, opt_in_source: 1, opt_in_at: 1, opt_in_text: 1 }).sort({ opt_in_at: -1 }).limit(size).lean(),
      WhatsappConsents.find({ opt_out_at: { $ne: null } }, { _id: 0, phone: 1, opt_out_source: 1, opt_out_at: 1, opt_out_text: 1 }).sort({ opt_out_at: -1 }).limit(size).lean(),
    ]);

    const [sendsByKindStatus, skipReasons, firstSent, lastSent] = await Promise.all([
      CampaignMessageQueue.aggregate([{ $match: { created_at: { $gte: since } } }, { $group: { _id: { kind: '$kind', status: '$status' }, n: { $sum: 1 } } }]),
      CampaignMessageQueue.aggregate([{ $match: { created_at: { $gte: since }, status: 'skipped' } }, { $group: { _id: '$skip_reason', n: { $sum: 1 } } }]),
      CampaignMessageQueue.findOne({ status: 'sent' }, { _id: 0, processed_at: 1 }).sort({ processed_at: 1 }).lean(),
      CampaignMessageQueue.findOne({ status: 'sent' }, { _id: 0, processed_at: 1 }).sort({ processed_at: -1 }).lean(),
    ]);

    const numberStates = await WhatsappNumberState.find({}, {
      _id: 0, phone_number_id: 1, quality_rating: 1, quality_event: 1, quality_updated_at: 1, quality_source: 1, messaging_limit: 1,
      daily_cap: 1, cap_raised_at: 1, first_send_at: 1, marketing_paused: 1, marketing_paused_reason: 1, marketing_paused_at: 1,
      marketing_resumed_at: 1, rate_limit_hits: 1, last_rate_limited_at: 1,
    }).lean();

    const audit = await AuditEvents.find({ created_at: { $gte: since } }, { _id: 0, event: 1, actor_type: 1, created_at: 1, meta: 1 })
      .sort({ created_at: -1 }).limit(200).lean();

    return { brand, byStatus, optInBySource, optOutBySource, optInSample, optOutSample, sendsByKindStatus, skipReasons, firstSent, lastSent, numberStates, audit };
  });

  const wabaId = body.brand?.wa_business_id;
  const templates = wabaId
    ? await runAsSystem(() => MetaWhatsappTemplates.find({ waba_id: wabaId }, { _id: 0, name: 1, language: 1, status: 1, category: 1 }).lean(), 'appeal-evidence')
    : [];

  const sends = {};
  for (const row of body.sendsByKindStatus) {
    const kind = row._id.kind || 'marketing';
    sends[kind] = sends[kind] || {};
    sends[kind][row._id.status || 'unknown'] = row.n;
  }

  return stripSecrets({
    generated_at: now.toISOString(),
    window: { days: windowDays, since: since.toISOString() },
    note: 'No message text, contact names or full phone numbers are included. Phone numbers show the last four digits only.',
    workspace: {
      id: tenant.id,
      name: tenant.name,
      status: tenant.status,
      sending_paused: Boolean(tenant.sending_paused),
      sending_paused_reason: tenant.sending_paused ? tenant.sending_paused_reason || null : null,
      sending_paused_at: tenant.sending_paused ? tenant.sending_paused_at || null : null,
      created_at: tenant.created_at || null,
    },
    whatsapp_number: body.brand ? {
      number: maskPhone(body.brand.whatsapp_number),
      status: body.brand.whatsapp_status || null,
      verified_at: body.brand.whatsapp_verified_at || null,
    } : null,
    consent: {
      contacts_by_status: countsBy(body.byStatus),
      opt_ins_by_source: countsBy(body.optInBySource),
      opt_outs_by_source: countsBy(body.optOutBySource),
      recent_opt_ins: body.optInSample.map((r) => ({ phone: maskPhone(r.phone), source: r.opt_in_source || null, at: r.opt_in_at, wording: shorten(r.opt_in_text) })),
      recent_opt_outs: body.optOutSample.map((r) => ({ phone: maskPhone(r.phone), source: r.opt_out_source || null, at: r.opt_out_at, wording: shorten(r.opt_out_text) })),
    },
    sending: {
      first_message_sent_at: body.firstSent?.processed_at || null,
      last_message_sent_at: body.lastSent?.processed_at || null,
      messages_by_kind_and_status: sends,
      skipped_by_reason: countsBy(body.skipReasons),
    },
    number_quality: body.numberStates.map((s) => ({ ...s, phone_number_id: s.phone_number_id ? `••••${String(s.phone_number_id).slice(-4)}` : null })),
    templates: templates.map((t) => ({ name: t.name, language: t.language, category: t.category, status: t.status })),
    staff_and_system_actions: body.audit.map((e) => ({ event: e.event, by: e.actor_type, at: e.created_at, reason: shorten(e.meta?.reason, 200) })),
  });
}

module.exports = { buildAppealEvidence, maskPhone };
