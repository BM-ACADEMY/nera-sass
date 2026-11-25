/**
 * Facebook Lead Ads per workspace (services/facebookLeads.js).
 *
 *   Customer panel, Settings > Integrations (owner/admin change, anyone views):
 *     GET    /api/facebook-leads/status
 *     POST   /api/facebook-leads/connect          -> { url } Facebook Login dialog
 *     GET    /api/facebook-leads/callback         Facebook redirects here (signed state)
 *     POST   /api/facebook-leads/pages            { page_ids } connect chosen Pages
 *     DELETE /api/facebook-leads/pages/:pageId    unsubscribe + delete token
 *     DELETE /api/facebook-leads/pending          close the Page picker
 *     DELETE /api/facebook-leads                  disconnect everything
 *   Meta:
 *     GET    /api/webhooks/facebook-leads         verification (hub.challenge)
 *     POST   /api/webhooks/facebook-leads         leadgen events, X-Hub-Signature-256
 *
 * Every route answers 404 unless FACEBOOK_LEADS_ENABLED=true.
 */
const { requirePermission, can } = require('../services/permissions');
const { runAsTenant } = require('../services/tenantContext');
const { isValidMetaSignature } = require('../services/metaWebhookSignature');
const facebookLeads = require('../services/facebookLeads');

const SIGNATURE_HEADER = 'x-hub-signature-256';

module.exports = function registerFacebookLeadsRoutes(app, { auth, metaGraphVersion }) {
  facebookLeads.setGraphVersion(metaGraphVersion);
  const manage = requirePermission('integrations.manage');
  const featureOn = (req, res, next) => (facebookLeads.enabled() ? next() : res.status(404).json({ error: 'Not found' }));
  const fail = (res, error) => {
    if (error instanceof facebookLeads.FacebookLeadsError) {
      return res.status(error.status || 400).json({ error: error.message, code: error.code });
    }
    console.error('[facebook-leads]', error.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  };

  // ── Webhook (Meta) ──────────────────────────────────────
  app.get('/api/webhooks/facebook-leads', featureOn, (req, res) => {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    if (mode === 'subscribe' && facebookLeads.isValidVerifyToken(token)) return res.type('text/plain').send(String(challenge ?? ''));
    return res.sendStatus(403);
  });

  // Signed by Meta with the app secret over the exact raw body. Answers 200 as
  // soon as the signature checks out; leads are fetched and saved afterwards.
  app.post('/api/webhooks/facebook-leads', featureOn, (req, res) => {
    const secret = facebookLeads.appSecret();
    if (!secret) {
      console.error('[Facebook Leads] Refused webhook: FACEBOOK_APP_SECRET is not configured');
      return res.status(503).json({ error: 'Webhook verification is not configured', code: 'WEBHOOK_SECRET_NOT_CONFIGURED' });
    }
    if (!isValidMetaSignature(req.rawBody, req.get(SIGNATURE_HEADER), secret)) {
      return res.status(401).json({ error: 'Invalid webhook signature', code: 'WEBHOOK_SIGNATURE_INVALID' });
    }
    res.sendStatus(200);
    facebookLeads.handleWebhookBody(req.body);
    return undefined;
  });

  // ── Customer panel ──────────────────────────────────────
  app.get('/api/facebook-leads/status', featureOn, auth, async (req, res) => {
    try {
      res.json({ ...(await facebookLeads.getStatus()), can_manage: can(req.identity, 'integrations.manage') });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post('/api/facebook-leads/connect', featureOn, auth, manage, (req, res) => {
    try {
      res.json({ url: facebookLeads.getAuthorizationUrl({ userId: req.user?.id }) });
    } catch (error) {
      fail(res, error);
    }
  });

  // Facebook redirects the browser here without a login; the signed state
  // names the workspace. Back to Settings > Integrations either way.
  app.get('/api/facebook-leads/callback', featureOn, async (req, res) => {
    const back = (params) => res.redirect(`${facebookLeads.appUrl()}/settings/integrations?${new URLSearchParams(params)}`);
    if (req.query.error) {
      return back({ facebook: 'error', message: 'Facebook sign-in was cancelled. Nothing was connected.' });
    }
    let state;
    try {
      state = facebookLeads.verifyState(req.query.state);
      if (!req.query.code) throw new facebookLeads.FacebookLeadsError('Facebook did not send a sign-in code. Please try again.', 'NO_CODE');
    } catch (error) {
      return back({ facebook: 'error', message: error.message });
    }
    try {
      const count = await runAsTenant(state.tenantId, () => facebookLeads.handleOAuthCode(String(req.query.code), { userId: state.userId }));
      return back({ facebook: 'choose', pages: String(count) });
    } catch (error) {
      console.error('[facebook-leads] Facebook sign-in failed:', error.message);
      const message = error instanceof facebookLeads.FacebookLeadsError ? error.message : 'Could not connect Facebook. Please try again.';
      return back({ facebook: 'error', message });
    }
  });

  app.post('/api/facebook-leads/pages', featureOn, auth, manage, async (req, res) => {
    try {
      const result = await facebookLeads.connectPages(req.body?.page_ids, { userId: req.user?.id ?? null, req });
      const status = await facebookLeads.getStatus();
      res.status(result.connected.length ? 200 : 400).json({
        ...result,
        ...(result.connected.length ? {} : { error: result.errors[0]?.error || 'No Page was connected.' }),
        status: { ...status, can_manage: true },
      });
    } catch (error) {
      fail(res, error);
    }
  });

  app.delete('/api/facebook-leads/pages/:pageId', featureOn, auth, manage, async (req, res) => {
    try {
      res.json({ success: true, ...(await facebookLeads.disconnectPage(req.params.pageId, { req })) });
    } catch (error) {
      fail(res, error);
    }
  });

  // Closes the Page picker without connecting anything (drops the sign-in).
  app.delete('/api/facebook-leads/pending', featureOn, auth, manage, async (req, res) => {
    try {
      await facebookLeads.cancelPending();
      res.json({ success: true });
    } catch (error) {
      fail(res, error);
    }
  });

  app.delete('/api/facebook-leads', featureOn, auth, manage, async (req, res) => {
    try {
      res.json({ success: true, ...(await facebookLeads.disconnectAll({ req })) });
    } catch (error) {
      fail(res, error);
    }
  });
};
