/**
 * GST tax invoices for plan payments (wallet top-ups are not a sale and carry
 * no GST, so they get no invoice).
 *
 *   ensureForOrder  issues the invoice of a paid plan order, once (idempotent);
 *                   fulfil() calls it when the payment is applied
 *   issueMissing    retry job: issues any invoice a fulfilled payment still lacks
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
const { gstinChecksumOk } = require('./gstin');

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

/** 12 Sep 2026 -> '26-27'; 5 Feb 2027 -> '26-27'. India's financial year runs April to March (IST). */
function financialYear(date) {
  const ist = new Date(new Date(date).getTime() + 330 * 60000);
  const year = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? year : year - 1;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
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
 * taxed plan payment. fulfil() calls it in the same flow that activates the
 * plan; issueMissing() calls it for any payment where that flow did not finish.
 *
 * Two steps, so the number series has no gaps (GST needs a consecutive series
 * per financial year):
 *   1. claim: one row per order (unique billing_order_id) with every detail but
 *      no number. Safe to repeat: a second caller finds the row.
 *   2. number: under one lock per series, the next number is the highest number
 *      already on an invoice of that series plus one, written onto the row in a
 *      single update. Nothing is taken ahead of that write (no counter), so a
 *      failed or interrupted step uses up no number. The unique (series, seq)
 *      index refuses a duplicate if a lock ever expired mid-way, and the step
 *      runs again. Invoices are never deleted, so a used number never frees up.
 * The invoice date and financial year come from `now` (the moment of issue,
 * passed in by the caller), so dates follow numbers.
 */
async function ensureForOrder(order, { now = new Date() } = {}) {
  if (!order || order.purpose !== 'subscription' || order.status !== 'fulfilled') return null;
  return withLock(`invoice:${order.id}`, async () => {
    const existing = await Invoices.findOne({ billing_order_id: order.id }, { _id: 0 }).lean();
    if (existing?.invoice_number) return existing;
    if (!existing) await claim(order, now);
    return assignNumber(order.id, now);
  }, { ttlMs: 20000, waitMs: 15000 });
}

/** Step 1: the invoice row of an order, without a number yet. */
async function claim(order, now) {
  const sellerInfo = seller();
  const { profile, workspace_name: workspaceName } = await billingProfile();
  const buyerState = profile?.state_code || null;
  const gst = Number(order.gst_paise || 0);
  const split = taxSplit({ gstPaise: gst, buyerStateCode: buyerState, sellerStateCode: sellerInfo.state_code });
  const upgrade = Boolean(order.meta?.upgrade);
  try {
    await Invoices.create({
      invoice_number: null,
      billing_order_id: order.id,
      razorpay_order_id: order.razorpay_order_id,
      razorpay_payment_id: order.razorpay_payment_id || null,
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
    });
  } catch (error) {
    if (error.code !== 11000) throw error; // another caller claimed it first
  }
}

/** Step 2: gives the claimed row the next number of its series. */
async function assignNumber(orderId, now) {
  const issuedAt = now;
  const fy = financialYear(issuedAt);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = await Invoices.findOne({ billing_order_id: orderId }, { _id: 0, invoice_number: 1, seller: 1 }).lean();
    if (!row) throw new InvoiceError(500, `The invoice row of order ${orderId} is missing`);
    if (row.invoice_number) break;
    const prefix = row.seller?.invoice_prefix || seller().invoice_prefix;
    const series = `${prefix}/${fy}`;
    const done = await withLock(`invoice-series:${series}`, async () => {
      const last = await runAsSystem(() => Invoices.findOne({ series, seq: { $type: 'number' } }, { _id: 0, seq: 1 }).sort({ seq: -1 }).lean(), 'billing:invoice');
      const seq = (Number(last?.seq) || 0) + 1;
      try {
        await Invoices.updateOne({ billing_order_id: orderId, invoice_number: null }, {
          $set: { invoice_number: `${series}/${String(seq).padStart(4, '0')}`, series, seq, financial_year: fy, issued_at: issuedAt },
        });
      } catch (error) {
        if (error.code === 11000) return false; // taken by a caller whose lock expired: try the next
        throw error;
      }
      return true;
    }, { ttlMs: 20000, waitMs: 15000 });
    if (done) break;
  }
  const invoice = await Invoices.findOne({ billing_order_id: orderId }, { _id: 0 }).lean();
  if (!invoice?.invoice_number) throw new InvoiceError(500, `Could not number the invoice of order ${orderId}`);
  return invoice;
}

/**
 * Retry job (system context): every fulfilled plan payment ends up with exactly
 * one numbered invoice. Issues what a crash or an error between fulfilment and
 * invoicing left behind. Safe to run twice at once and alongside fulfil().
 */
async function issueMissing({ now = new Date() } = {}) {
  // Reads every fulfilled plan order and every numbered invoice on each run.
  // Fine at today's volume; as orders grow, add a date filter (e.g. fulfilled
  // in the last few days) so the scan stays small.
  const [paid, numbered] = await runAsSystem(() => Promise.all([
    BillingOrders.find({ purpose: 'subscription', status: 'fulfilled' }, { _id: 0 }).lean(),
    Invoices.find({ invoice_number: { $type: 'string' } }, { _id: 0, billing_order_id: 1 }).lean(),
  ]), 'billing:invoice');
  const have = new Set(numbered.map((row) => row.billing_order_id));
  let issued = 0;
  let failed = 0;
  for (const order of paid) {
    if (have.has(order.id)) continue;
    try {
      await runAsTenant(order.tenant_id, () => ensureForOrder(order, { now }));
      issued += 1;
    } catch (error) {
      failed += 1;
      console.error(`[billing/invoices] Invoice for order ${order.id} not issued:`, error.message);
    }
  }
  return { issued, failed };
}

const publicInvoice = (inv) => inv && ({
  id: inv.id, invoice_number: inv.invoice_number, issued_at: inv.issued_at,
  base_paise: inv.base_paise, gst_paise: inv.cgst_paise + inv.sgst_paise + inv.igst_paise, total_paise: inv.total_paise,
  description: inv.lines?.[0]?.description || '',
});

/** The workspace's issued invoices, newest first (a row still waiting for its number is not shown). */
async function listInvoices(limit = 50) {
  requireTenantId();
  const rows = await Invoices.find({ invoice_number: { $type: 'string' } }, { _id: 0 }).sort({ id: -1 }).limit(Math.min(Number(limit) || 50, 200)).lean();
  return rows.map(publicInvoice);
}

async function getInvoice(id) {
  requireTenantId();
  const invoice = await Invoices.findOne({ id: Number(id), invoice_number: { $type: 'string' } }, { _id: 0 }).lean();
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

module.exports = { InvoiceError, financialYear, cleanProfile, billingProfile, saveBillingProfile, ensureForOrder, issueMissing, listInvoices, getInvoice, renderHtml, publicInvoice, seller };
