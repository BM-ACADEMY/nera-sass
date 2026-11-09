/**
 * LeadOS routes: Razorpay payment webhook.
 *
 *  - Fails closed: with RAZORPAY_WEBHOOK_SECRET unset every request is refused
 *    (503) and a warning is logged once at startup. Nothing is processed.
 *  - The X-Razorpay-Signature header is checked (HMAC-SHA256 of the raw body)
 *    with a constant-time compare BEFORE the body is parsed or acted on.
 *  - Idempotent: the Razorpay event id (X-Razorpay-Event-Id) is claimed in a
 *    unique-indexed collection first, so a redelivery changes nothing.
 *  - Tenant context: the payment note's lead decides the workspace; all reads
 *    and writes then run inside that tenant. A payment whose tenant note
 *    disagrees with the lead's tenant is ignored.
 * Raw payloads and customer details are never logged.
 */
const { postToN8n } = require('../../services/n8n');
const billingOrders = require('../../services/billing/orders');
const { runAsSystem, runAsTenant } = require('../../services/tenantContext');
const { ProcessedWebhookEvents } = require('../../models');
const crypto = require('crypto');

const SECRET_ENV = 'RAZORPAY_WEBHOOK_SECRET';
const SIGNATURE_FORMAT = /^[0-9a-f]{64}$/i;
const EVENT_ID_FORMAT = /^[A-Za-z0-9_.:-]{1,120}$/;

const webhookSecret = () => String(process.env[SECRET_ENV] || '').trim() || null;

// True only for a valid HMAC-SHA256 hex signature of the exact raw body.
function isValidRazorpaySignature(rawBody, header, secret) {
  if (!secret || !Buffer.isBuffer(rawBody)) return false;
  const received = String(header || '').trim();
  if (!SIGNATURE_FORMAT.test(received)) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(received, 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

module.exports = function registerWebhookRazorpayRoutes(app, ctx) {
const { Clients, Leads, Payments } = ctx;

if (!webhookSecret()) {
  console.warn(`[Razorpay webhook] ${SECRET_ENV} is not set: every /webhook/razorpay request will be refused until it is configured`);
}

app.post('/webhook/razorpay', async (req, res) => {
  const secret = webhookSecret();
  if (!secret) {
    // 503: Razorpay retries later, so no event is lost once the secret is set.
    return res.status(503).json({ error: 'Webhook verification is not configured', code: 'WEBHOOK_SECRET_NOT_CONFIGURED' });
  }
  if (!isValidRazorpaySignature(req.rawBody, req.get('x-razorpay-signature'), secret)) {
    console.warn('[Razorpay webhook] Refused: missing or invalid signature');
    return res.status(401).json({ error: 'Invalid webhook signature', code: 'WEBHOOK_SIGNATURE_INVALID' });
  }

  let claimed = null; // { tenantId, eventId } once this delivery owns the event id
  try {
    // Plan payments and wallet top-ups (orders created by /api/billing). The
    // signature has already been verified above; the billing handler credits a
    // payment id once. Anything that is not a billing order falls through to
    // the lead payments below.
    try {
      const billing = await billingOrders.handleWebhook({ rawBody: req.rawBody, signature: req.get('x-razorpay-signature'), event: req.body });
      if (billing.handled) return res.status(200).json({ status: 'billing' });
    } catch (billingErr) {
      console.error('[Razorpay webhook] Billing handler error:', billingErr.message);
    }

    const event = req.body;
    if (event?.event !== 'payment.captured') return res.sendStatus(200);
    const entity = event.payload?.payment?.entity;
    const paymentId = String(entity?.id || '');
    const leadId = Number(entity?.notes?.lead_id);
    if (!paymentId || !Number.isInteger(leadId) || leadId <= 0) return res.sendStatus(200);

    // Razorpay sends a unique id per event; fall back to event + payment id.
    const headerId = String(req.get('x-razorpay-event-id') || '').trim();
    const eventId = EVENT_ID_FORMAT.test(headerId) ? headerId : `${event.event}:${paymentId}`;

    // Which workspace owns the lead (lead ids are global). Read-only lookup;
    // everything after this runs inside that tenant.
    const owner = await runAsSystem(() => Leads.findOne({ id: leadId }, { _id: 0, tenant_id: 1 }).lean(), 'razorpay-webhook-tenant-lookup');
    if (!owner?.tenant_id) {
      console.warn('[Razorpay webhook] Ignored: payment is not linked to a known lead');
      return res.sendStatus(200);
    }
    const noteTenant = entity?.notes?.tenant_id;
    if (noteTenant != null && String(noteTenant) !== String(owner.tenant_id)) {
      console.warn('[Razorpay webhook] Ignored: tenant note does not match the lead');
      return res.sendStatus(200);
    }
    const tenantId = owner.tenant_id;

    const outcome = await runAsTenant(tenantId, async () => {
      try {
        await ProcessedWebhookEvents.create({ provider: 'razorpay', event_id: eventId });
      } catch (err) {
        if (err?.code === 11000) return 'duplicate';
        throw err;
      }
      claimed = { tenantId, eventId };

      const amount = Number(entity.amount) / 100;
      if (!(await Payments.exists({ razorpay_payment_id: paymentId }))) {
        await Payments.create({ lead_id: leadId, amount, status: 'captured', razorpay_payment_id: paymentId, created_at: new Date() });
      }
      await Leads.updateOne({ id: leadId }, { $set: { status: 'converted', score: 100 } });

      // Hand off to n8n's WF04 (Customer Journey). Best effort: a failure here
      // must not make Razorpay redeliver an already-recorded payment.
      try {
        const leadData = await Leads.findOne({ id: leadId }, { _id: 0, id: 1, tenant_id: 1, name: 1, phone: 1, client_id: 1 }).lean() || {};
        const clientData = leadData.client_id
          ? await Clients.findOne({ id: leadData.client_id }, { _id: 0, id: 1, name: 1 }).lean() || {}
          : {};
        await postToN8n(process.env.N8N_PAYMENT_SUCCESS_WEBHOOK_URL, {
          invoice_id: paymentId,
          lead_id: leadId,
          tenant_id: tenantId,
          name: leadData.name || null,
          phone: leadData.phone || null,
          brand_id: clientData.id || null,
          brand: clientData.name || null,
          amount,
        });
      } catch (n8nErr) {
        console.error('[Razorpay webhook] Hand-off to n8n failed:', n8nErr.message);
      }
      return 'processed';
    });
    return res.status(200).json({ status: outcome });
  } catch (err) {
    console.error('[Razorpay webhook] Processing failed:', err.message);
    // Release the claim so Razorpay's retry is processed, not skipped as a duplicate.
    if (claimed) {
      await runAsTenant(claimed.tenantId, () => ProcessedWebhookEvents.deleteOne({ provider: 'razorpay', event_id: claimed.eventId })).catch(() => {});
    }
    return res.status(500).json({ error: 'Webhook could not be processed' });
  }
});
};

module.exports.isValidRazorpaySignature = isValidRazorpaySignature;
