/**
 * LeadOS routes: Razorpay webhook.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
module.exports = function registerWebhookRazorpayRoutes(app, ctx) {
const {
  Clients,
  Leads,
  Payments,
  axios,
  crypto,
} = ctx;
// ── RAZORPAY WEBHOOK ──────────────────────────────────────
app.post('/webhook/razorpay', async (req, res) => {
  res.sendStatus(200);
  try {
    if (process.env.RAZORPAY_WEBHOOK_SECRET) {
      const signature = req.headers['x-razorpay-signature'];
      const expected = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(req.rawBody).digest('hex');
      if (!signature || signature !== expected) {
        console.warn('[Razorpay webhook] Signature mismatch - rejecting');
        return;
      }
    }

    const event = req.body;
    if (event.event === 'payment.captured') {
      const { amount, notes } = event.payload.payment.entity;
      const leadId = notes?.lead_id;
      const paymentId = event.payload.payment.entity.id;
      if (leadId) {
        await Payments.create({ lead_id: leadId, amount: amount / 100, status: 'captured', razorpay_payment_id: paymentId, created_at: new Date() });
        await Leads.updateOne({ id: leadId }, { $set: { status: 'converted', score: 100 } });

        // Hand off to n8n's WF04 (Customer Journey) - same forwarding pattern as the WhatsApp webhook.
        try {
          // Fetch lead data to pass full context to WF04
          const leadData = await Leads.findOne({ id: leadId }, { _id: 0, id: 1, tenant_id: 1, name: 1, phone: 1, client_id: 1 }).lean() || {};
          const clientData = leadData.client_id
            ? await Clients.findOne({ id: leadData.client_id }, { _id: 0, id: 1, name: 1 }).lean() || {}
            : {};

          await axios.post(process.env.N8N_PAYMENT_SUCCESS_WEBHOOK_URL, {
            invoice_id:  paymentId,
            lead_id:     leadId,
            tenant_id:   leadData.tenant_id ?? null,
            name:        leadData.name   || null,
            phone:       leadData.phone  || null,
            brand_id:    clientData.id   || null,
            brand:       clientData.name || null,
            amount:      amount / 100,
          });
          console.log(`✅ Forwarded payment ${paymentId} to n8n WF04 (lead_id=${leadId})`);
        } catch (n8nErr) {
          console.error('⚠️ Failed to forward payment to n8n WF04:', n8nErr.message);
        }
      }
    }
  } catch (err) {
    console.error('Razorpay webhook error:', err.message);
  }
});
};
