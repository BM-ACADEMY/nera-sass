/**
 * Staff-only side of onboarding (N5, Mode B): the queue of customers waiting
 * for their WhatsApp to be connected, and the write-only form where our team
 * enters the customer's WhatsApp Business account details.
 *
 * Mounted inside the admin router, so platform staff authentication has run
 * and the request is in the system context; the customer's data is touched
 * only through runAsTenant(<tenant being managed>).
 *
 * The access token is encrypted by the clients model and is never returned by
 * any route here, not even its last characters.
 */
const { Tenants } = require('../models');
const { runAsSystem, runAsTenant } = require('../services/tenantContext');
const { computeLifecycle } = require('../services/lifecycle');
const { whatsapp } = require('../services/onboarding');

const MAX_QUEUE = 500;

module.exports = function registerAdminOnboarding(router, { permit, fail, verifyClientWhatsApp }) {
  const connect = permit('platform.whatsapp.connect');
  const tenantId = (req) => Number(req.params.id);
  const failure = (res, error) => (error instanceof whatsapp.OnboardingError
    ? res.status(error.status).json({ error: error.message, code: error.code })
    : fail(res, error));

  async function loadTenant(id) {
    const tenant = await runAsSystem(() => Tenants.findOne({ id: Number(id) }, { _id: 0, id: 1, name: 1, status: 1, deleted_at: 1 }).lean(), 'admin-onboarding');
    return tenant && computeLifecycle(tenant).state !== 'deleted' ? tenant : null;
  }

  // Customers whose WhatsApp is not verified yet; those who asked come first.
  router.get('/onboarding/whatsapp-queue', connect, async (req, res) => {
    try {
      const tenants = await runAsSystem(() => Tenants.find({ status: { $ne: 'deleted' }, deleted_at: null }, { _id: 0, id: 1, name: 1, created_at: 1 }).sort({ id: 1 }).limit(MAX_QUEUE).lean(), 'admin-onboarding');
      const rows = [];
      for (const tenant of tenants) {
        const connection = await runAsTenant(tenant.id, () => whatsapp.staffConnection()).catch(() => null);
        if (!connection || connection.status === 'verified') continue;
        rows.push({ tenant_id: tenant.id, tenant_name: tenant.name, ...connection });
      }
      rows.sort((a, b) => (b.requested_at ? 1 : 0) - (a.requested_at ? 1 : 0) || new Date(a.requested_at || 0) - new Date(b.requested_at || 0));
      return res.json({ queue: rows, total: rows.length });
    } catch (error) {
      return failure(res, error);
    }
  });

  router.get('/tenants/:id/onboarding/whatsapp', connect, async (req, res) => {
    try {
      const tenant = await loadTenant(tenantId(req));
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
      return res.json({ tenant_id: tenant.id, tenant_name: tenant.name, ...(await runAsTenant(tenant.id, () => whatsapp.staffConnection())) });
    } catch (error) {
      return failure(res, error);
    }
  });

  router.put('/tenants/:id/onboarding/whatsapp', connect, async (req, res) => {
    try {
      const tenant = await loadTenant(tenantId(req));
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
      const result = await runAsTenant(tenant.id, () => whatsapp.staffSaveConnection(req.body || {}, { staffId: req.user.id, verifyClientWhatsApp, req }));
      return res.json({ tenant_id: tenant.id, tenant_name: tenant.name, ...result });
    } catch (error) {
      return failure(res, error);
    }
  });
};
