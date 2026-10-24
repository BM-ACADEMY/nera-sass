/**
 * Customer panel "WhatsApp Number" page: the workspace's connected number as
 * Meta reports it (status, quality, display name, business profile) and its
 * template counts. Read-only; no credential or full Meta ID is returned.
 */
const { MetaWhatsappPhoneNumbers, MetaWhatsappTemplates } = require('../../models');
const { can } = require('../../services/permissions');
const { runAsSystem } = require('../../services/tenantContext');

const maskId = (value) => (value ? `•••• ${String(value).slice(-4)}` : null);

module.exports = function registerWhatsappOverviewRoutes(app, ctx) {
  const { Clients, auth } = ctx;

  app.get('/api/whatsapp/overview', auth, async (req, res) => {
    try {
      const brand = await Clients.findOne({}, {
        _id: 0, id: 1, name: 1, phone_number_id: 1, wa_business_id: 1, whatsapp_number: 1, whatsapp_status: 1,
        whatsapp_verified_at: 1, whatsapp_verification_error: 1, wa_token_last4: 1,
      }).lean();
      const base = { can_manage: can(req.identity, 'whatsapp.manage'), brand_name: brand?.name || null };
      if (!brand?.phone_number_id) return res.json({ ...base, connected: false });

      // The inventory is platform data; read only this brand's own number and WABA.
      const [phone, counts] = await runAsSystem(() => Promise.all([
        MetaWhatsappPhoneNumbers.findOne({ phone_number_id: brand.phone_number_id }, { _id: 0, raw_data: 0 }).lean(),
        brand.wa_business_id
          ? MetaWhatsappTemplates.aggregate([{ $match: { waba_id: brand.wa_business_id } }, { $group: { _id: '$status', n: { $sum: 1 } } }])
          : [],
      ]), 'whatsapp-overview');
      const byStatus = Object.fromEntries(counts.map((c) => [c._id, c.n]));
      return res.json({
        ...base,
        connected: true,
        status: brand.whatsapp_status || 'verification_pending',
        verified_at: brand.whatsapp_verified_at || null,
        error: brand.whatsapp_verification_error || null,
        can_send: Boolean(brand.wa_token_last4),
        managed_by_platform: Boolean(phone),
        number: {
          display_phone_number: phone?.display_phone_number || (brand.whatsapp_number ? `+${String(brand.whatsapp_number).replace(/^\+/, '')}` : null),
          verified_name: phone?.verified_name || null,
          connection_status: phone?.connection_status || null,
          quality_rating: phone?.quality_rating || null,
          verification_status: phone?.verification_status || null,
          phone_number_id: maskId(brand.phone_number_id),
          waba_id: maskId(brand.wa_business_id),
          last_synced_at: phone?.last_synced_at || null,
        },
        profile: phone ? {
          picture_url: phone.profile_picture_url || null,
          about: phone.profile_about || null,
          description: phone.profile_description || null,
          address: phone.profile_address || null,
          email: phone.profile_email || null,
          websites: phone.profile_websites || [],
          vertical: phone.profile_vertical || null,
        } : null,
        templates: {
          total: counts.reduce((sum, c) => sum + c.n, 0),
          approved: byStatus.APPROVED || 0,
          pending: (byStatus.PENDING || 0) + (byStatus.IN_APPEAL || 0),
          rejected: byStatus.REJECTED || 0,
        },
      });
    } catch (error) {
      console.error('[whatsapp/overview]', error.message);
      return res.status(500).json({ error: 'Could not load WhatsApp details' });
    }
  });
};
