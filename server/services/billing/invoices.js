/**
 * GST tax invoices for plan payments (wallet top-ups are not a sale and carry
 * no GST, so they get no invoice).
 *
 *   ensureForOrder  issues the invoice of a paid plan order, once (idempotent)
 *   billingProfile / saveBillingProfile  the legal details a workspace wants printed
 *   renderHtml      a printable page: open it and "Save as PDF"
 *
 * Tax split: a buyer in the seller's state (Puducherry, code 34) pays CGST + SGST
 * (half each); a buyer elsewhere pays IGST. A buyer with no state on file is
 * treated as in the seller's state, as the rules do for a B2C supply.
 */
const { Invoices, BillingOrders, Tenants } = require('../../models');
const { runAsSystem, runAsTenant, requireTenantId } = require('../tenantContext');
const { withLock } = require('../../db/mongo');
const { financialYear, nextSequence, gstinChecksumOk } = require('./invoiceNumber');

const env = (name, fallback) => (process.env[name] && String(process.env[name]).trim()) || fallback;
const SAC = () => env('INVOICE_SAC', '998314');

function seller() {
  return {
    legal_name: env('SELLER_LEGAL_NAME', 'AFRA VENTURES PRIVATE LIMITED'),
    gstin: env('SELLER_GSTIN', '34ABGCA7083D1ZS'),
    pan: env('SELLER_PAN', 'ABGCA7083D'),
    cin: env('SELLER_CIN', 'U62011PY2026PTC009819'),
    address: env('SELLER_ADDRESS', '78, Lenin Street, Kosapalayam, Puducherry - 605013, India'),
    state_code: env('SELLER_STATE_CODE', '34'),
    state_name: env('SELLER_STATE_NAME', 'Puducherry'),
    invoice_prefix: env('INVOICE_PREFIX', 'AV'),
  };
}

class InvoiceError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const STATE_CODES = new Set([...Array.from({ length: 38 }, (_, i) => String(i + 1).padStart(2, '0')), '97', '99']);

/** Validates what a workspace types for its invoice details. Returns the clean profile. */
function cleanProfile(input = {}) {
  const legalName = String(input.legal_name || '').trim();
  const address = String(input.address || '').trim();
  const gstin = String(input.gstin || '').trim().toUpperCase();
  let stateCode = String(input.state_code || '').trim();
  if (legalName.length < 2 || legalName.length > 120) throw new InvoiceError(400, 'Enter the business name for your invoices (2 to 120 characters)');
  if (address.length > 300) throw new InvoiceError(400, 'The address is too long (300 characters at most)');
  if (gstin) {
    if (!GSTIN_RE.test(gstin) || !gstinChecksumOk(gstin)) throw new InvoiceError(400, 'That GSTIN does not look right. It has 15 characters, for example 34ABGCA7083D1ZS.');
    stateCode = gstin.slice(0, 2); // a GSTIN fixes the state
  }
  if (stateCode && !STATE_CODES.has(stateCode)) throw new InvoiceError(400, 'State code must be a two-digit GST state code, for example 34 for Puducherry');
  return { legal_name: legalName, gstin: gstin || null, address, state_code: stateCode || null };
}

async function billingProfile() {
  const tenantId = requireTenantId();
  const tenant = await runAsSystem(() => Tenants.findOne({ id: tenantId }, { _id: 0, billing_profile: 1, name: 1 }).lean(), 'billing:invoice');
  return { profile: tenant?.billing_profile || null, workspace_name: tenant?.name || '' };
}

async function saveBillingProfile(input) {
  const tenantId = requireTenantId();
  const profile = cleanProfile(input);
  await runAsSystem(() => Tenants.updateOne({ id: tenantId }, { $set: { billing_profile: profile, updated_at: new Date() } }), 'billing:invoice');
  return profile;
}

function taxSplit({ gstPaise, buyerStateCode, sellerStateCode }) {
  if (!buyerStateCode || buyerStateCode === sellerStateCode) {
    const cgst = Math.floor(gstPaise / 2);
    return { cgst_paise: cgst, sgst_paise: gstPaise - cgst, igst_paise: 0 };
  }
  return { cgst_paise: 0, sgst_paise: 0, igst_paise: gstPaise };
}

/**
 * Issues the invoice for a fulfilled plan order. Tenant context. Returns the
 * existing one when it was issued already, or null for an order that is not a
 * taxed plan payment.
 */
async function ensureForOrder(order, { now = new Date() } = {}) {
  if (!order || order.purpose !== 'subscription' || order.status !== 'fulfilled') return null;
  return withLock(`invoice:${order.id}`, async () => {
    const existing = await Invoices.findOne({ billing_order_id: order.id }, { _id: 0 }).lean();
    if (existing) return existing;
    const sellerInfo = seller();
    const { profile, workspace_name: workspaceName } = await billingProfile();
    const buyerState = profile?.state_code || null;
    // Dated when it is issued, so numbers and dates run in the same order even
    // when a retry issues it later than the payment.
    const issuedAt = now;
    const fy = financialYear(issuedAt);
    const gst = Number(order.gst_paise || 0);
    const split = taxSplit({ gstPaise: gst, buyerStateCode: buyerState, sellerStateCode: sellerInfo.state_code });
    const upgrade = Boolean(order.meta?.upgrade);
    const row = {
      financial_year: fy,
      billing_order_id: order.id,
      razorpay_order_id: order.razorpay_order_id,
      razorpay_payment_id: order.razorpay_payment_id || null,
      issued_at: issuedAt,
      seller: sellerInfo,
      buyer: {
        legal_name: profile?.legal_name || workspaceName || 'Customer',
        gstin: profile?.gstin || null,
        address: profile?.address || '',
        state_code: buyerState || sellerInfo.state_code,
      },
      place_of_supply_code: buyerState || sellerInfo.state_code,
      lines: [{
        description: `${upgrade ? 'Upgrade to ' : ''}${order.plan_code ? order.plan_code.charAt(0).toUpperCase() + order.plan_code.slice(1) : 'Plan'} plan: WhatsApp CRM subscription${upgrade ? ' (pro rata for the rest of the paid period)' : ' (one month)'}`,
        sac: SAC(),
        base_paise: Number(order.base_paise ?? order.amount_paise),
      }],
      base_paise: Number(order.base_paise ?? order.amount_paise),
      ...split,
      gst_rate_percent: Number(order.gst_rate_percent || 0),
      total_paise: Number(order.amount_paise),
      currency: order.currency || 'INR',
      created_at: now,
    };
    // One series for the whole company, across workspaces: take the next number
    // and save in the same locked step. If the save fails, nothing was used up.
    const invoice = await withLock(`invoice_series:${sellerInfo.invoice_prefix}:${fy}`, async () => {
      const numbers = (await runAsSystem(() => Invoices.find({ financial_year: fy }, { _id: 0, invoice_number: 1 }).lean(), 'billing:invoice-series')).map((r) => r.invoice_number);
      const seq = nextSequence(numbers, sellerInfo.invoice_prefix, fy);
      return Invoices.create({ ...row, invoice_number: `${sellerInfo.invoice_prefix}/${fy}/${String(seq).padStart(4, '0')}` });
    }, { ttlMs: 20000, waitMs: 15000 });
    return invoice.toObject();
  }, { ttlMs: 20000, waitMs: 15000 });
}

/**
 * Issues every invoice a paid plan order is still missing, oldest payment first,
 * across all workspaces. Run by a timer: a failed issue (database blip) is
 * retried within minutes, not when the customer happens to open the page.
 */
async function issueMissing({ limit = 100, now = new Date() } = {}) {
  const orders = await runAsSystem(() => BillingOrders.find({ purpose: 'subscription', status: 'fulfilled' }, { _id: 0 }).sort({ fulfilled_at: 1, id: 1 }).limit(1000).lean(), 'billing:invoice-sweep');
  if (!orders.length) return { issued: 0, failed: 0 };
  const have = new Set((await runAsSystem(() => Invoices.find({}, { _id: 0, billing_order_id: 1, tenant_id: 1 }).lean(), 'billing:invoice-sweep')).map((r) => `${r.tenant_id}:${r.billing_order_id}`));
  let issued = 0;
  let failed = 0;
  for (const order of orders) {
    if (issued + failed >= limit) break;
    if (have.has(`${order.tenant_id}:${order.id}`)) continue;
    try {
      await runAsTenant(order.tenant_id, () => ensureForOrder(order, { now }));
      issued += 1;
    } catch (error) {
      failed += 1;
      console.error('[billing/invoices] Sweep could not issue invoice for order', order.id, error.message);
    }
  }
  return { issued, failed };
}

const publicInvoice = (inv) => inv && ({
  id: inv.id, invoice_number: inv.invoice_number, issued_at: inv.issued_at,
  base_paise: inv.base_paise, gst_paise: inv.cgst_paise + inv.sgst_paise + inv.igst_paise, total_paise: inv.total_paise,
  description: inv.lines?.[0]?.description || '',
});

/** The workspace's invoices, newest first; issues any that a paid order is still missing. */
async function listInvoices(limit = 50) {
  requireTenantId();
  const paid = await BillingOrders.find({ purpose: 'subscription', status: 'fulfilled' }, { _id: 0 }).lean();
  if (paid.length) {
    const have = new Set((await Invoices.find({}, { _id: 0, billing_order_id: 1 }).lean()).map((row) => row.billing_order_id));
    for (const order of paid) if (!have.has(order.id)) await ensureForOrder(order).catch((error) => console.error('[billing/invoices] Could not issue invoice:', error.message));
  }
  const rows = await Invoices.find({}, { _id: 0 }).sort({ id: -1 }).limit(Math.min(Number(limit) || 50, 200)).lean();
  return rows.map(publicInvoice);
}

async function getInvoice(id) {
  requireTenantId();
  const invoice = await Invoices.findOne({ id: Number(id) }, { _id: 0 }).lean();
  if (!invoice) throw new InvoiceError(404, 'Invoice not found');
  return invoice;
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (paise) => `₹${(Number(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A self-contained printable tax invoice page. */
function renderHtml(inv) {
  const s = inv.seller || {};
  const b = inv.buyer || {};
  const intra = inv.igst_paise === 0;
  const date = new Date(new Date(inv.issued_at).getTime() + 330 * 60000).toISOString().slice(0, 10).split('-').reverse().join('-');
  const taxRows = intra
    ? `<tr><td>CGST @ ${inv.gst_rate_percent / 2}%</td><td class="r">${inr(inv.cgst_paise)}</td></tr><tr><td>SGST @ ${inv.gst_rate_percent / 2}%</td><td class="r">${inr(inv.sgst_paise)}</td></tr>`
    : `<tr><td>IGST @ ${inv.gst_rate_percent}%</td><td class="r">${inr(inv.igst_paise)}</td></tr>`;
  const lines = (inv.lines || []).map((l) => `<tr><td>${esc(l.description)}</td><td>${esc(l.sac)}</td><td class="r">${inr(l.base_paise)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Tax Invoice ${esc(inv.invoice_number)}</title>
<style>body{font:14px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#111;max-width:760px;margin:24px auto;padding:0 16px}h1{font-size:22px;margin:0}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}.r{text-align:right}.muted{color:#555;font-size:12px}.two{display:flex;gap:24px;justify-content:space-between}.total td{font-weight:700;border-top:2px solid #111}@media print{body{margin:0}}</style></head><body>
<div class="two"><div><h1>TAX INVOICE</h1><div class="muted">Original for recipient</div></div><div class="r"><b>${esc(inv.invoice_number)}</b><br>Date: ${esc(date)}</div></div>
<div class="two" style="margin-top:16px"><div><b>${esc(s.legal_name)}</b><br>${esc(s.address)}<br>GSTIN: ${esc(s.gstin)}<br>PAN: ${esc(s.pan)} · CIN: ${esc(s.cin)}<br>State: ${esc(s.state_name)} (${esc(s.state_code)})</div>
<div><b>Billed to</b><br>${esc(b.legal_name)}<br>${esc(b.address)}${b.gstin ? `<br>GSTIN: ${esc(b.gstin)}` : ''}<br>Place of supply: ${esc(inv.place_of_supply_code)}</div></div>
<table><thead><tr><th>Description</th><th>SAC</th><th class="r">Amount</th></tr></thead><tbody>${lines}</tbody></table>
<table style="width:60%;margin-left:auto"><tbody><tr><td>Taxable value</td><td class="r">${inr(inv.base_paise)}</td></tr>${taxRows}<tr class="total"><td>Total</td><td class="r">${inr(inv.total_paise)}</td></tr></tbody></table>
<p class="muted">Paid online through Razorpay (payment ${esc(inv.razorpay_payment_id || '')}). This is a computer-generated invoice.</p></body></html>`;
}

module.exports = { InvoiceError, financialYear, cleanProfile, billingProfile, saveBillingProfile, ensureForOrder, issueMissing, nextSequence, listInvoices, getInvoice, renderHtml, publicInvoice, seller };
