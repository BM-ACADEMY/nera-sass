/**
 * Products and customer orders of a workspace (tenant context). The AI order
 * flow (services/orderFlow.js) uses `store`; the panel uses the rest.
 * Every query goes through the tenant-scope plugin, so one workspace can never
 * see or change another's price list or orders.
 */
const { Products, ShopOrders } = require('../models');
const { requireTenantId } = require('./tenantContext');
const { nextId } = require('../db/mongo');

class ShopError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

const NO_ID = { _id: 0 };
const MAX_PRODUCTS = 200;
const MAX_PRICE_INR = 100000;
const STATUSES = ['pending_payment', 'paid', 'fulfilled', 'cancelled'];
// What an owner may change an order to from where it is.
const NEXT = { pending_payment: ['paid', 'cancelled'], paid: ['fulfilled', 'cancelled'], fulfilled: [], cancelled: [] };

const nameKey = (name) => String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();

function cleanProduct(input = {}, { partial = false } = {}) {
  const out = {};
  if (!partial || input.name !== undefined) {
    const name = String(input.name || '').replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (name.length < 1 || name.length > 80) throw new ShopError(400, 'Product name must be 1 to 80 characters');
    out.name = name;
    out.name_key = nameKey(name);
  }
  if (!partial || input.price_inr !== undefined) {
    const inr = Number(input.price_inr);
    if (!Number.isFinite(inr) || inr <= 0 || inr > MAX_PRICE_INR || Math.round(inr * 100) !== inr * 100) {
      throw new ShopError(400, `Price must be more than ₹0 and at most ₹${MAX_PRICE_INR.toLocaleString('en-IN')}, with at most 2 decimals`);
    }
    out.price_paise = Math.round(inr * 100);
  }
  if (input.description !== undefined) out.description = String(input.description || '').replace(/[<>\u0000-\u001f]/g, ' ').trim().slice(0, 200);
  if (input.active !== undefined) out.active = input.active === true;
  return out;
}

const publicProduct = (p) => p && ({ id: p.id, name: p.name, description: p.description || '', price_paise: p.price_paise, price_inr: p.price_paise / 100, active: p.active !== false });

async function listProducts({ activeOnly = false } = {}) {
  requireTenantId();
  return Products.find(activeOnly ? { active: { $ne: false } } : {}, NO_ID).sort({ name_key: 1 }).limit(MAX_PRODUCTS).lean();
}

async function createProduct(input, userId = null) {
  requireTenantId();
  if ((await Products.countDocuments({})) >= MAX_PRODUCTS) throw new ShopError(409, `You can save up to ${MAX_PRODUCTS} products`);
  const data = cleanProduct(input);
  try {
    const created = await Products.create({ ...data, active: input.active !== false, created_by: userId });
    return created.toObject();
  } catch (err) {
    if (err.code === 11000) throw new ShopError(409, 'You already have a product with this name');
    throw err;
  }
}

async function updateProduct(id, input) {
  requireTenantId();
  const data = cleanProduct(input, { partial: true });
  try {
    const row = await Products.findOneAndUpdate({ id: Number(id) }, { $set: { ...data, updated_at: new Date() } }, { new: true, projection: { _id: 0 } }).lean();
    if (!row) throw new ShopError(404, 'Product not found');
    return row;
  } catch (err) {
    if (err.code === 11000) throw new ShopError(409, 'You already have a product with this name');
    throw err;
  }
}

/** A product is switched off, never deleted: old orders keep their own copy of the name and price. */
async function deactivateProduct(id) {
  requireTenantId();
  const row = await Products.findOneAndUpdate({ id: Number(id) }, { $set: { active: false, updated_at: new Date() } }, { new: true, projection: { _id: 0 } }).lean();
  if (!row) throw new ShopError(404, 'Product not found');
  return row;
}

const publicOrder = (o) => o && ({
  id: o.id, order_no: o.order_no, lead_id: o.lead_id, customer_name: o.customer_name, phone: o.phone,
  items: (o.items || []).map((i) => ({ name: i.name, unit_paise: i.unit_paise, quantity: i.quantity })),
  total_paise: o.total_paise, total_inr: o.total_paise / 100, status: o.status, paid_at: o.paid_at, created_at: o.created_at,
});

async function listOrders({ status = null, limit = 50 } = {}) {
  const tenantId = requireTenantId();
  void tenantId;
  const filter = STATUSES.includes(status) ? { status } : {};
  const rows = await ShopOrders.find(filter, NO_ID).sort({ id: -1 }).limit(Math.min(Number(limit) || 50, 200)).lean();
  return rows.map(publicOrder);
}

async function setOrderStatus(id, status, now = new Date()) {
  requireTenantId();
  if (!STATUSES.includes(status)) throw new ShopError(400, 'Status must be paid, fulfilled or cancelled');
  const order = await ShopOrders.findOne({ id: Number(id) }, NO_ID).lean();
  if (!order) throw new ShopError(404, 'Order not found');
  if (!NEXT[order.status]?.includes(status)) throw new ShopError(409, `An order that is ${order.status.replace('_', ' ')} cannot be changed to ${status}`);
  const set = { status, updated_at: now };
  if (status === 'paid') set.paid_at = now;
  // The status in the filter keeps two quick clicks from both winning.
  const row = await ShopOrders.findOneAndUpdate({ id: order.id, status: order.status }, { $set: set }, { new: true, projection: { _id: 0 } }).lean();
  if (!row) throw new ShopError(409, 'This order was just changed by someone else. Refresh and try again.');
  return row;
}

/** Storage for orderFlow.advance. */
const store = {
  async place({ lead, name, items, total, language, now = new Date() }) {
    const tenantId = requireTenantId();
    const orderNo = await nextId(`shop_order_${tenantId}`);
    const created = await ShopOrders.create({
      order_no: orderNo, lead_id: lead.id, customer_name: name, phone: lead.phone || null,
      items: items.map((i) => ({ product_id: i.product_id, name: i.name, unit_paise: i.unit_paise, quantity: i.quantity })),
      total_paise: total, status: 'pending_payment', language, created_at: now, updated_at: now,
    });
    return created.toObject();
  },
  async cancelPending(leadId, now = new Date()) {
    return ShopOrders.findOneAndUpdate(
      { lead_id: leadId, status: 'pending_payment' },
      { $set: { status: 'cancelled', updated_at: now } },
      { sort: { id: -1 }, new: true, projection: { _id: 0 } },
    ).lean();
  },
};

module.exports = { ShopError, STATUSES, cleanProduct, publicProduct, listProducts, createProduct, updateProduct, deactivateProduct, publicOrder, listOrders, setOrderStatus, store };
