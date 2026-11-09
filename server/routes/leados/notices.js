/**
 * Customer panel: the Notices box (plan N4).
 *
 * Open notices of the signed-in workspace: template rejected, wallet low,
 * number quality drop, setup unfinished, payment failed. Every notice is also
 * emailed; WhatsApp copies go only to a number opted in at signup, which can be
 * switched off here but not on again (that needs a new consent at signup).
 */
const alerts = require('../../services/alerts');
const { Tenants } = require('../../models');
const { can } = require('../../services/permissions');
const { currentTenantId, runAsSystem } = require('../../services/tenantContext');

const maskNumber = (digits) => (digits ? `${'•'.repeat(Math.max(0, String(digits).length - 4))}${String(digits).slice(-4)}` : null);

module.exports = function registerNoticeRoutes(app, ctx) {
  const { auth } = ctx;
  const fail = (res, error) => {
    console.error('[notices]', error.message);
    return res.status(500).json({ error: 'Server error' });
  };

  app.get('/api/notices', auth, async (req, res) => {
    try {
      return res.json(await alerts.listNotices({ includeResolved: req.query.all === '1', limit: req.query.limit }));
    } catch (error) {
      return fail(res, error);
    }
  });

  app.post('/api/notices/read-all', auth, async (req, res) => {
    try {
      await alerts.markAllRead();
      return res.json({ success: true });
    } catch (error) {
      return fail(res, error);
    }
  });

  app.post('/api/notices/:id/read', auth, async (req, res) => {
    try {
      await alerts.markRead(req.params.id);
      return res.json({ success: true });
    } catch (error) {
      return fail(res, error);
    }
  });

  app.get('/api/notices/preferences', auth, async (req, res) => {
    try {
      const tenantId = currentTenantId(); // read before entering the system context
      const tenant = await runAsSystem(() => Tenants.findOne({ id: tenantId }, { _id: 0, alerts_whatsapp: 1 }).lean(), 'notice-preferences');
      const prefs = tenant?.alerts_whatsapp;
      return res.json({
        email: true,
        whatsapp: { opted_in: Boolean(prefs?.opted_in), number: prefs?.opted_in ? maskNumber(prefs.number) : null, opted_in_at: prefs?.opted_in_at || null },
        can_manage: can(req.identity, 'tenant.settings'),
      });
    } catch (error) {
      return fail(res, error);
    }
  });

  // Only switching WhatsApp alerts off is possible here. Email notices cannot be switched off.
  app.put('/api/notices/preferences', auth, async (req, res) => {
    try {
      if (!can(req.identity, 'tenant.settings')) return res.status(403).json({ error: 'You do not have permission to change this' });
      if (req.body?.whatsapp_opt_in === true) return res.status(400).json({ error: 'WhatsApp alerts can only be turned on when the workspace is created.', code: 'OPT_IN_AT_SIGNUP' });
      if (req.body?.whatsapp_opt_out === true) {
        const tenantId = currentTenantId();
        await runAsSystem(() => Tenants.updateOne({ id: tenantId, 'alerts_whatsapp.opted_in': true }, { $set: { 'alerts_whatsapp.opted_in': false, 'alerts_whatsapp.opted_out_at': new Date() } }), 'notice-preferences');
      }
      return res.json({ success: true });
    } catch (error) {
      return fail(res, error);
    }
  });
};
