/**
 * Customer onboarding API (/api/onboarding), N5. Every route needs a customer
 * login (`auth`) and runs in that user's tenant context, so a workspace only
 * ever sees and changes its own setup. Platform staff use /api/admin.
 *
 *   GET    /                              checklist, notices, live state
 *   POST   /whatsapp/request              ask our team to connect WhatsApp
 *   POST   /whatsapp/embedded-signup      Meta Embedded Signup (feature flag)
 *   GET    /services                      the services the AI may talk about
 *   POST   /services, PUT|PATCH|DELETE /services/:id
 *   POST   /test-message                  template to the customer's own phone
 *   POST   /go-live                       turn on AI replies and campaigns
 *
 * Business details are saved through the existing PATCH /api/clients/:id.
 * Customers never see a raw error: known problems keep their own plain
 * message, everything else becomes a generic answer and is logged.
 */
const express = require('express');
const { auth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../services/permissions');
const { SendBlocked } = require('../services/sendPolicy');
const { SenderError } = require('../services/tenantSender');
const onboarding = require('../services/onboarding');

const { catalog, whatsapp } = onboarding;
const KNOWN = [catalog.CatalogError, whatsapp.OnboardingError, onboarding.GoLiveError, SenderError, SendBlocked];

function fail(res, error, where) {
  if (KNOWN.some((type) => error instanceof type) && error.status) {
    const body = { error: error.message };
    if (error.code) body.code = error.code;
    if (error.blocked_by) body.blocked_by = error.blocked_by;
    if (error.retryAt) body.retry_at = error.retryAt;
    return res.status(error.status).json(body);
  }
  console.error(`[onboarding] ${where}:`, error?.message || error);
  return res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
}

module.exports = function createOnboardingRouter({ verifyClientWhatsApp } = {}) {
  const router = express.Router();
  router.use(auth);
  const handler = (where, fn) => async (req, res) => {
    try {
      return await fn(req, res);
    } catch (error) {
      return fail(res, error, where);
    }
  };
  const manageWhatsapp = requirePermission('whatsapp.manage');
  const manageServices = requirePermission('ai_brain.manage');
  const manageWorkspace = requirePermission('tenant.settings');

  router.get('/', handler('overview', async (req, res) => {
    res.json(await onboarding.overview({ tenant: req.tenant, user: req.user }));
  }));

  router.post('/whatsapp/request', manageWhatsapp, handler('request', async (req, res) => {
    res.json(await whatsapp.requestStaffConnect({ userId: req.user.id, req }));
  }));

  router.post('/whatsapp/embedded-signup', manageWhatsapp, handler('embedded-signup', async (req, res) => {
    res.json(await whatsapp.completeEmbeddedSignup(req.body || {}, { userId: req.user.id, verifyClientWhatsApp, req }));
  }));

  router.get('/services', handler('services', async (req, res) => {
    res.json({ services: await catalog.list() });
  }));
  router.post('/services', manageServices, handler('services', async (req, res) => {
    res.status(201).json({ service: await catalog.create(req.body || {}) });
  }));
  router.put('/services/:id', manageServices, handler('services', async (req, res) => {
    res.json({ service: await catalog.update(req.params.id, req.body || {}) });
  }));
  router.patch('/services/:id', manageServices, handler('services', async (req, res) => {
    res.json({ service: await catalog.setActive(req.params.id, req.body?.is_active !== false) });
  }));
  router.delete('/services/:id', manageServices, handler('services', async (req, res) => {
    await catalog.remove(req.params.id);
    res.json({ success: true });
  }));

  router.post('/test-message', manageWhatsapp, handler('test-message', async (req, res) => {
    const body = req.body || {};
    res.json(await whatsapp.sendTestMessage({
      userId: req.user.id, templateId: body.template_id ?? null, phone: body.phone ?? null, confirmOwnPhone: body.confirm_own_phone === true, req,
    }));
  }));

  router.post('/go-live', manageWorkspace, handler('go-live', async (req, res) => {
    res.json(await onboarding.goLive({ tenant: req.tenant, userId: req.user.id, req }));
  }));

  return router;
};
