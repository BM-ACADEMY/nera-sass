/**
 * N8: the AI order flow. Pure: an in-memory store, no database, no network.
 * Covers matching, totals computed by the server, confirmation before placing,
 * payment text from the owner's own instructions, and cancelling.
 */
const test = require('node:test');
const assert = require('node:assert');
const flow = require('../services/orderFlow');
const { say, rupees } = require('../services/orderText');

const PRODUCTS = [
  { id: 1, name: 'Chicken Biryani', price_paise: 18000 },
  { id: 2, name: 'Mutton Biryani', price_paise: 25050 },
  { id: 3, name: 'Raita', price_paise: 3000 },
];
const NOW = new Date('2026-11-19T10:00:00Z');

function memoryStore() {
  const orders = [];
  return {
    orders,
    async place({ lead, name, items, total, language }) {
      const row = { id: orders.length + 1, order_no: orders.length + 1, lead_id: lead.id, customer_name: name, items, total_paise: total, status: 'pending_payment', language };
      orders.push(row);
      return row;
    },
    async cancelPending(leadId) {
      const open = orders.filter((o) => o.lead_id === leadId && o.status === 'pending_payment').pop();
      if (open) open.status = 'cancelled';
      return open || null;
    },
  };
}

// One customer message through the flow, carrying the saved draft like the engine does.
async function turn(ctx, proposal, { lang = 'en', payment = 'UPI: shop@upi', products = PRODUCTS } = {}) {
  const out = await flow.advance({ lead: ctx.lead, proposal: flow.cleanProposal(proposal), lang, products, payment, store: ctx.store, now: ctx.now || NOW });
  if (out.draft === null) delete ctx.lead.order_draft; else if (out.draft) ctx.lead.order_draft = out.draft;
  return out;
}
const fresh = () => ({ lead: { id: 7, phone: '919876543210' }, store: memoryStore() });

test('cleanProposal keeps only usable input', () => {
  assert.strictEqual(flow.cleanProposal(null), null);
  assert.strictEqual(flow.cleanProposal([]), null);
  const p = flow.cleanProposal({ items: [{ product: ' biryani <b>', quantity: '2' }, { product: '', quantity: 1 }, { product: 'raita', quantity: -3 }, { product: 'x', quantity: 9999 }], name: 'Ravi', confirm: 'yes' });
  assert.deepStrictEqual(p.items.map((i) => [i.product, i.quantity]), [['biryani  b', 2], ['raita', 1], ['x', 100]]);
  assert.strictEqual(p.confirm, false, 'only a real true confirms');
});

test('O1. Items, then name, then a confirmation with the server total, then the order and payment text', async () => {
  const ctx = fresh();
  let out = await turn(ctx, { items: [] });
  assert.match(out.reply, /Chicken Biryani: ₹180/);
  out = await turn(ctx, { items: [{ product: 'chicken biryani', quantity: 2 }, { product: 'raita', quantity: 1 }] });
  assert.match(out.reply, /name/i);
  out = await turn(ctx, { name: 'Ravi' });
  assert.match(out.reply, /2 x Chicken Biryani = ₹360/);
  assert.match(out.reply, /Total: ₹390/);
  assert.strictEqual(ctx.store.orders.length, 0, 'nothing is placed before the customer says yes');
  out = await turn(ctx, { confirm: true });
  assert.strictEqual(ctx.store.orders.length, 1);
  const order = ctx.store.orders[0];
  assert.strictEqual(order.total_paise, 39000);
  assert.strictEqual(order.customer_name, 'Ravi');
  assert.match(out.reply, /order #1 is placed/);
  assert.match(out.reply, /UPI: shop@upi/);
  assert.match(out.handoffReason, /New order #1 from Ravi/);
  assert.strictEqual(out.draft, null);
});

test('O2. A yes without a shown confirmation, or after the items changed, does not place an order', async () => {
  const ctx = fresh();
  let out = await turn(ctx, { items: [{ product: 'raita', quantity: 1 }], name: 'Ravi', confirm: true });
  assert.strictEqual(ctx.store.orders.length, 0, 'confirm on the first message only asks');
  assert.match(out.reply, /confirm your order/i);
  await turn(ctx, { items: [{ product: 'raita', quantity: 5 }], confirm: true }); // changed: must ask again
  assert.strictEqual(ctx.store.orders.length, 0);
  await turn(ctx, { confirm: true });
  assert.strictEqual(ctx.store.orders.length, 1);
  assert.strictEqual(ctx.store.orders[0].total_paise, 15000, 'the shown 5 x ₹30');
});

test('O3. The model cannot set a price; only the saved list counts, and an old draft price is refreshed', async () => {
  const ctx = fresh();
  await turn(ctx, { items: [{ product: 'raita', quantity: 1, price: 1 }], name: 'Ravi' });
  const changed = PRODUCTS.map((p) => (p.id === 3 ? { ...p, price_paise: 4000 } : p));
  const out = await turn(ctx, { confirm: true }, { products: changed });
  assert.match(out.reply, /Total: ₹40/, 'the price list at this moment decides');
  assert.strictEqual(ctx.store.orders.length, 0, 'the total changed, so the customer is asked again');
});

test('O4. An unknown or ambiguous product is not guessed', async () => {
  const ctx = fresh();
  let out = await turn(ctx, { items: [{ product: 'pizza', quantity: 1 }] });
  assert.match(out.reply, /could not find "pizza"/);
  out = await turn(ctx, { items: [{ product: 'biryani', quantity: 1 }] });
  assert.match(out.reply, /could not find "biryani"/, 'two biryanis match, so it asks instead of picking');
  assert.strictEqual(ctx.store.orders.length, 0);
});

test('O5. Without saved payment instructions the team is asked to share them', async () => {
  const ctx = fresh();
  await turn(ctx, { items: [{ product: 'raita', quantity: 1 }], name: 'Ravi' }, { payment: '' });
  const out = await turn(ctx, { confirm: true }, { payment: '' });
  assert.match(out.reply, /team will share the payment details/);
  assert.match(out.handoffReason, /share them/);
});

test('O6. Cancel closes the open order; with none it says so; a very large order goes to a person', async () => {
  const ctx = fresh();
  await turn(ctx, { items: [{ product: 'raita', quantity: 1 }], name: 'Ravi' });
  await turn(ctx, { confirm: true });
  let out = await turn(ctx, { cancel: true });
  assert.match(out.reply, /order #1 has been cancelled/);
  assert.strictEqual(ctx.store.orders[0].status, 'cancelled');
  out = await turn(ctx, { cancel: true });
  assert.match(out.reply, /no open order/);
  const big = [{ id: 9, name: 'Gold bar', price_paise: 6000000 }];
  out = await turn(fresh(), { items: [{ product: 'gold bar', quantity: 5 }], name: 'Ravi' }, { products: big });
  assert.match(out.reply, /too large/);
  assert.match(out.handoffReason, /Large order/);
});

test('O7. Tamil replies are used when the customer writes Tamil, and rupees print cleanly', async () => {
  const ctx = fresh();
  const out = await turn(ctx, { items: [{ product: 'raita', quantity: 2 }], name: 'ரவி' }, { lang: 'ta' });
  assert.match(out.reply, /மொத்தம்: ₹60/);
  assert.strictEqual(rupees(25050), '₹250.50');
  assert.strictEqual(rupees(18000), '₹180');
  assert.strictEqual(say('askName', 'fr'), say('askName', 'en'), 'unknown language falls back to English');
});

test('O8. A stale draft is ignored', async () => {
  const ctx = fresh();
  await turn(ctx, { items: [{ product: 'raita', quantity: 1 }], name: 'Ravi' });
  ctx.now = new Date(NOW.getTime() + 3 * 3600 * 1000);
  const out = await turn(ctx, { confirm: true });
  assert.strictEqual(ctx.store.orders.length, 0);
  assert.match(out.reply, /What would you like/);
});
