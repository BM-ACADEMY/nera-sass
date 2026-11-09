/**
 * Tax invoices (N7): one numbered record per Razorpay payment, written when
 * the order is fulfilled (services/billing/orders.js, inside the order lock,
 * so a payment id gets one invoice however often the webhook replays).
 * Numbers are sequential across the platform (GN-<year>-<six digits>) from
 * the counters collection. The customer lists and downloads them as PDF from
 * Settings > Billing; everything here runs in the tenant context.
 */
const { BillingInvoices, Tenants, Users } = require('../../models');
const { runAsSystem, requireTenantId } = require('../tenantContext');
const { nextId } = require('../../db/mongo');
const audit = require('../audit');
const pdf = require('./pdf');

const COUNTER = 'billing_invoice_numbers';
const PAGE_RIGHT = pdf.PAGE.width - 56;
const sellerName = () => process.env.BILLING_SELLER_NAME || process.env.NERA_PRODUCT_NAME || 'Getnera';
const sellerGstin = () => String(process.env.BILLING_SELLER_GSTIN || '').trim();
const sellerAddress = () => String(process.env.BILLING_SELLER_ADDRESS || '').trim();

function invoiceNumber(seq, at = new Date()) {
  return `GN-${at.getUTCFullYear()}-${String(seq).padStart(6, '0')}`;
}

const publicInvoice = (row) => row && ({
  id: row.id,
  invoice_number: row.invoice_number,
  issued_at: row.issued_at,
  purpose: row.purpose,
  customer_business_name: row.customer_business_name,
  plan_code: row.plan_code,
  plan_name: row.plan_name,
  period_months: row.period_months,
  description: row.description,
  currency: row.currency || 'INR',
  price_paise: row.price_paise,
  gst_rate_percent: row.gst_rate_percent,
  gst_paise: row.gst_paise,
  total_paise: row.total_paise,
  razorpay_payment_id: row.razorpay_payment_id,
  status: row.status,
});

/**
 * issue({ order, paymentId, plan, now }) — tenant context. Returns the row,
 * or the existing row when this payment id already has one.
 */
async function issue({ order, paymentId, plan = null, now = new Date() }) {
  const tenantId = requireTenantId();
  const existing = await BillingInvoices.findOne({ razorpay_payment_id: String(paymentId) }, { _id: 0 }).lean();
  if (existing) return { invoice: existing, duplicate: true };
  const [tenant, owner] = await Promise.all([
    runAsSystem(() => Tenants.findOne({ id: tenantId }, { _id: 0, name: 1, owner_user_id: 1 }).lean(), 'billing:invoice'),
    runAsSystem(() => Users.findOne({ tenant_id: tenantId, role: 'owner', is_active: { $ne: false } }, { _id: 0, email: 1 }).lean(), 'billing:invoice'),
  ]);
  const seq = await nextId(COUNTER);
  const price = Number(order.price_paise ?? order.amount_paise);
  const gstPaise = Number(order.gst_paise || 0);
  const total = Number(order.total_paise ?? order.amount_paise);
  const months = order.period_months || null;
  const description = order.purpose === 'subscription'
    ? `${plan?.name || order.plan_code} plan, ${months || 1} month${months === 1 || !months ? '' : 's'}`
    : 'Wallet top-up (prepaid balance)';
  const row = await BillingInvoices.create({
    invoice_number: invoiceNumber(seq, now),
    issued_at: now,
    order_id: order.id,
    razorpay_order_id: order.razorpay_order_id,
    razorpay_payment_id: String(paymentId),
    purpose: order.purpose,
    customer_business_name: tenant?.name || '',
    customer_email: owner?.email || '',
    plan_code: order.plan_code || null,
    plan_name: plan?.name || null,
    period_months: months,
    description,
    currency: order.currency || 'INR',
    price_paise: price,
    gst_rate_percent: Number(order.gst_rate_percent || 0),
    gst_paise: gstPaise,
    total_paise: total,
    status: 'paid',
    created_at: now,
  });
  const invoice = row.toObject();
  await audit.record(audit.EVENTS.INVOICE_ISSUED, {
    tenantId, targetType: 'billing_invoice', targetId: invoice.id,
    actor: { actor_type: 'system', actor_user_id: null },
    meta: { invoice_number: invoice.invoice_number, payment_id: String(paymentId), total_paise: total, gst_paise: gstPaise },
  });
  return { invoice, duplicate: false };
}

async function list(limit = 20) {
  requireTenantId();
  const rows = await BillingInvoices.find({}, { _id: 0 }).sort({ id: -1 }).limit(Math.min(Number(limit) || 20, 100)).lean();
  return rows.map(publicInvoice);
}

async function byId(id) {
  requireTenantId();
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  return BillingInvoices.findOne({ id: n }, { _id: 0 }).lean();
}

const rupees = (paise) => `Rs. ${(Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateText = (value) => new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

/** The invoice as a PDF buffer. */
function toPdf(invoice) {
  const left = 56;
  const right = PAGE_RIGHT;
  const ops = [];
  const text = (t, x, y, size = 10, bold = false) => ops.push({ text: t, x, y, size, bold });
  const rightText = (t, y, size = 10, bold = false) => ops.push({ text: t, x: right - pdf.textWidth(t, size), y, size, bold });
  const rule = (y, width = 0.6) => ops.push({ line: [left, y, right, y], width });

  text(sellerName(), left, 64, 18, true);
  text('TAX INVOICE', left, 84, 11, true);
  if (sellerAddress()) text(sellerAddress(), left, 100, 9);
  if (sellerGstin()) text(`GSTIN: ${sellerGstin()}`, left, 113, 9);
  rightText(`Invoice no. ${invoice.invoice_number}`, 64, 11, true);
  rightText(`Date: ${dateText(invoice.issued_at)}`, 80, 10);
  rightText(`Payment: ${invoice.razorpay_payment_id}`, 96, 9);
  rule(126);

  text('Billed to', left, 148, 9, true);
  text(invoice.customer_business_name || 'Customer', left, 164, 11);
  if (invoice.customer_email) text(invoice.customer_email, left, 179, 9);

  let y = 220;
  text('Description', left, y, 9, true);
  rightText('Amount', y, 9, true);
  rule(y + 6);
  y += 24;
  text(invoice.description || '', left, y, 10);
  rightText(rupees(invoice.price_paise), y, 10);
  y += 18;
  text(`GST @ ${Number(invoice.gst_rate_percent || 0)}%`, left, y, 10);
  rightText(rupees(invoice.gst_paise), y, 10);
  y += 10;
  rule(y + 4);
  y += 22;
  text('Total paid', left, y, 11, true);
  rightText(rupees(invoice.total_paise), y, 11, true);
  y += 30;
  text(`Status: ${String(invoice.status || 'paid').toUpperCase()} (${invoice.currency || 'INR'})`, left, y, 9);
  if (invoice.period_months) text(`Billing period: ${invoice.period_months} month${invoice.period_months === 1 ? '' : 's'}`, left, y + 14, 9);
  text('WhatsApp conversation charges are billed by Meta directly and are not part of this invoice.', left, 760, 8);
  text('This is a computer-generated invoice.', left, 774, 8);
  return pdf.render(ops);
}

module.exports = { COUNTER, invoiceNumber, publicInvoice, issue, list, byId, toPdf };
