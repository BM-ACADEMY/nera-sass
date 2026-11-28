/**
 * Brand router: several brands on one WhatsApp number, one AI brain each.
 * Picks the brand for a chat before any prompt is built, with fixed rules and
 * no model call, so a brand's brain (and only that brand's documents) is all
 * the AI ever sees. Runs inside the caller's tenant context: every query goes
 * through the tenant scope.
 *
 * Order:
 *   a. the brand already fixed for this chat (leads.brand_client_id);
 *   b. the ad the lead came from (campaign / ad name) against each brand's
 *      route_ad_keywords;
 *   c. the customer's words against each brand's route_keywords (latest
 *      message first, then the earlier ones);
 *   d. still unclear: with two or more brand brains switched on, one fixed
 *      question naming the brands; with one switched on, that brand answers
 *      with today's keyword rule; with none, people answer.
 * A workspace with one brain (or none) is not routed at all.
 */
const { BrainProfiles, Clients, Leads } = require('../models');
const { mentions } = require('./brainPrompt');

const NO_ID = { _id: 0 };
const MAX_BRANDS = 5;

const loadBrains = () => BrainProfiles.find({}, NO_ID).sort({ id: 1 }).lean();
const workspaceClient = () => Clients.findOne({}, { _id: 0, id: 1, name: 1 }).sort({ id: 1 }).lean();

const brandName = (brain, client) => String(brain?.profile?.business_name || brain?.brand_name || client?.name || 'Brand').trim();

/**
 * The workspace's brands, one per brain. A default brain (no client_id)
 * stands for the workspace's own client unless a brain names that client.
 */
function brandsOf(brains, client) {
  const clientId = client?.id ?? null;
  const named = new Set(brains.filter((b) => b.client_id != null).map((b) => b.client_id));
  const brands = [];
  for (const brain of brains) {
    if (brain.client_id == null && named.has(clientId)) continue;
    const id = brain.client_id ?? clientId;
    if (brands.some((b) => b.client_id === id)) continue;
    brands.push({ client_id: id, name: brandName(brain, brain.client_id == null || brain.client_id === clientId ? client : null), brain });
  }
  return brands;
}

async function loadBrands() {
  const [brains, client] = await Promise.all([loadBrains(), workspaceClient()]);
  return { brains, client, brands: brandsOf(brains, client) };
}

/** "Are you asking about A or B?" from the brand names. */
function brandQuestion(brands) {
  const names = brands.map((b) => b.name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0];
  return `Are you asking about ${list}?`;
}

const matching = (brands, field, textValue) => (textValue
  ? brands.filter((b) => (b.brain.profile?.[field] || []).length && mentions(textValue, b.brain.profile[field]))
  : []);

/**
 * The routing decision for one message (no reads, no writes).
 * Returns { mode: 'single', brand } for a workspace that is not routed, or
 * { mode: 'routed', brand, reason, persist } / { mode: 'routed', question, reason }.
 */
function decide(brands, { fixedBrandId = null, message = '', earlierInbound = [], adText = '' } = {}) {
  if (brands.length <= 1) return { mode: 'single', brand: brands[0] || null, reason: 'one brain' };
  const fixed = fixedBrandId != null ? brands.find((b) => b.client_id === Number(fixedBrandId)) : null;
  if (fixed) return { mode: 'routed', brand: fixed, reason: 'conversation', persist: false };

  const byAd = matching(brands, 'route_ad_keywords', adText);
  if (byAd.length === 1) return { mode: 'routed', brand: byAd[0], reason: 'ad', persist: true };

  for (const textValue of [message, [...earlierInbound].reverse().join('\n')]) {
    const byWords = matching(brands, 'route_keywords', textValue);
    if (byWords.length === 1) return { mode: 'routed', brand: byWords[0], reason: 'keywords', persist: true };
    if (byWords.length > 1) break;
  }

  const on = brands.filter((b) => b.brain.ai_enabled);
  if (on.length >= 2) return { mode: 'routed', question: brandQuestion(brands), reason: 'unclear' };
  if (on.length === 1) return { mode: 'routed', brand: on[0], reason: 'only brand on', persist: false, fallback: true };
  return { mode: 'routed', brand: null, reason: 'no brand on' };
}

const REASONS = {
  'one brain': 'This workspace has one brain',
  conversation: 'This chat is already with this brand',
  ad: 'The ad the customer came from',
  keywords: 'Words in the customer\'s messages',
  unclear: 'Not clear which brand: the customer is asked',
  'only brand on': 'Not clear which brand; only this brand has AI on',
  'no brand on': 'Not clear which brand and no brand has AI on',
};

/** Routes one message of a lead. `earlierInbound` is newest first. */
async function routeLead({ lead, message, earlierInbound = [] }) {
  const { brands } = await loadBrands();
  return decide(brands, {
    fixedBrandId: lead?.brand_client_id ?? null,
    message,
    earlierInbound,
    adText: [lead?.campaign_name, lead?.ad_name].filter(Boolean).join(' '),
  });
}

/** Keeps later messages of this chat on the brand. */
const fixBrand = (leadId, clientId) => Leads.updateOne({ id: leadId }, { $set: { brand_client_id: clientId } });

module.exports = { MAX_BRANDS, REASONS, loadBrains, loadBrands, workspaceClient, brandsOf, brandQuestion, decide, routeLead, fixBrand };
