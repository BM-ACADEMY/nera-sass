/**
 * LeadOS routes: retired legacy Meta webhook.
 *
 * /api/webhooks/meta ran without a tenant context, so every delivery failed
 * once tenant isolation was enforced. The signed, tenant-routed endpoint
 * /webhook/whatsapp already handles the same events (message statuses and
 * inbound replies) and more, so this route is retired instead of repaired:
 * it answers 410 Gone and logs one line (method and path only, never the body).
 */
module.exports = function registerWebhookMetaRoutes(app) {
  const gone = (req, res) => {
    console.warn(`[Legacy Meta webhook] ${req.method} /api/webhooks/meta refused with 410: use /webhook/whatsapp`);
    res.status(410).json({ error: 'This webhook address has been retired. Use /webhook/whatsapp.', code: 'WEBHOOK_RETIRED' });
  };
  app.get('/api/webhooks/meta', gone);
  app.post('/api/webhooks/meta', gone);
};
