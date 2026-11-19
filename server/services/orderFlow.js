/**
 * The order conversation: what the customer wants, their name, a confirmation
 * showing the exact items and total, then the order row and how to pay.
 *
 * The model only *proposes* what the customer said (`order` in its JSON: items
 * [{product, quantity}], name, confirm, cancel). This module matches the words
 * to the saved price list, computes every amount itself, and writes the reply
 * from the real outcome. The model never supplies a price, and an order is only
 * placed after the customer said yes to the exact items and total that were
 * shown. Payment is the business's own (UPI / payment link saved by the owner);
 * Getnera never touches the customer's money.
 *
 * Storage is passed in as `store`, so the flow is the same in production
 * (services/shopOrders.js) and in tests (an in-memory store).
 */
const { matchService: matchName } = require('./appointmentRules');
const { say } = require('./orderText');

const DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ITEMS = 10;
const MAX_QTY = 100;
const MAX_TOTAL_PAISE = 100000 * 100; // ₹1,00,000 an order in chat; larger goes to a person

/** Cleans the model's `order` field; null when the customer is not ordering. */
function cleanProposal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const text = (v, max) => (typeof v === 'string' ? v.replace(/[<>\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');
  const items = (Array.isArray(value.items) ? value.items : []).slice(0, MAX_ITEMS).map((i) => ({
    product: text(i?.product, 80),
    quantity: Number.isInteger(Number(i?.quantity)) && Number(i.quantity) >= 1 ? Math.min(Number(i.quantity), MAX_QTY) : 1,
  })).filter((i) => i.product);
  return { items, name: text(value.name, 80) || null, confirm: value.confirm === true, cancel: value.cancel === true };
}

function freshDraft(draft, now) {
  if (!draft || typeof draft !== 'object') return {};
  const at = new Date(draft.updated_at || 0).getTime();
  if (!at || now.getTime() - at > DRAFT_TTL_MS) return {};
  return { name: draft.name || null, items: Array.isArray(draft.items) ? draft.items : [], awaiting_confirm: draft.awaiting_confirm === true };
}

// Includes the unit price, so a price changed after the customer was shown the total asks again.
const signature = (name, items) => `${name}|${items.map((i) => `${i.product_id}x${i.quantity}@${i.unit_paise}`).sort().join(',')}`;

/**
 * One customer message in the order flow.
 * Returns { reply, draft, placed, cancelled, handoffReason }.
 *   draft  what to save on the lead (null clears it)
 */
async function advance({ lead, proposal, lang, products, payment, store, now = new Date() }) {
  const t = (key, vars) => say(key, lang, vars);
  const saved = freshDraft(lead?.order_draft, now);
  const keep = (draft) => ({ ...draft, updated_at: now });

  if (proposal.cancel) {
    const cancelled = await store.cancelPending(lead.id, now);
    if (!cancelled) return { reply: t('nothingToCancel'), draft: null };
    return { reply: t('cancelled', { orderNo: cancelled.order_no }), draft: null, cancelled, handoffReason: `Order #${cancelled.order_no} cancelled by the customer` };
  }

  const name = proposal.name || saved.name || null;
  let items = saved.items || [];
  if (proposal.items.length) {
    const matched = [];
    for (const wanted of proposal.items) {
      const product = matchName(wanted.product, products.map((p) => p.name));
      const row = product && products.find((p) => p.name === product);
      if (!row) return { reply: t('unknownItem', { said: wanted.product, products }), draft: keep({ name, items, awaiting_confirm: false }) };
      const have = matched.find((m) => m.product_id === row.id);
      if (have) have.quantity = Math.min(MAX_QTY, have.quantity + wanted.quantity);
      else matched.push({ product_id: row.id, name: row.name, unit_paise: row.price_paise, quantity: wanted.quantity });
    }
    items = matched;
  }
  // Prices come from the saved list at this moment, never from the draft or the model.
  items = items.map((i) => {
    const row = products.find((p) => p.id === i.product_id);
    return row ? { ...i, name: row.name, unit_paise: row.price_paise } : null;
  }).filter(Boolean);

  const draft = { name, items, awaiting_confirm: false };
  if (!items.length) return { reply: t('askItems', { products }), draft: keep(draft) };
  if (!name) return { reply: t('askName'), draft: keep(draft) };

  const total = items.reduce((sum, i) => sum + i.unit_paise * i.quantity, 0);
  if (total > MAX_TOTAL_PAISE) return { reply: t('tooLarge'), draft: null, handoffReason: `Large order request (over ₹1,00,000) from ${name}: please contact the customer` };

  const shownBefore = saved.awaiting_confirm && signature(saved.name, saved.items) === signature(name, items);
  if (!(proposal.confirm && shownBefore)) {
    return { reply: t('confirmAsk', { name, items, total }), draft: keep({ ...draft, awaiting_confirm: true }) };
  }

  const placed = await store.place({ lead, name, items, total, language: lang, now });
  const reply = payment
    ? t('placedWithPayment', { orderNo: placed.order_no, total, payment })
    : t('placedNoPayment', { orderNo: placed.order_no, total });
  return {
    reply,
    draft: null,
    placed,
    handoffReason: `New order #${placed.order_no} from ${name}: ${items.map((i) => `${i.quantity} x ${i.name}`).join(', ')}, total ${require('./orderText').rupees(total)}. ${payment ? 'Payment details were shared; mark it paid when you receive it.' : 'No payment details are saved, so please share them.'}`,
  };
}

module.exports = { DRAFT_TTL_MS, MAX_TOTAL_PAISE, cleanProposal, freshDraft, advance };
