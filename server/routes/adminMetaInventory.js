/**
 * Platform Meta WhatsApp inventory (/api/admin/meta/whatsapp), staff only.
 *
 * The inventory is the platform's view of the WhatsApp accounts its Meta
 * business can see. It is never a source of a customer's sending number:
 * each customer connects and owns their own WhatsApp Business account, and a
 * brand's number, WABA and token are written only by that customer's own
 * connection (or the audited admin credential update). Nothing here writes to
 * a brand.
 *
 *   platform.meta        founder, ops   view, sync, link/unlink reconciliation,
 *                                       assign/unassign a number to a workspace
 *   platform.meta.admin  founder        phone registration, cache clearing
 *
 * Assign is the one place an inventory number reaches a brand: an explicit,
 * audited admin action (like the admin credential update) for numbers the
 * platform holds in its own portfolio for a workspace. It never copies a token,
 * and a number already used by another brand is refused.
 *
 * Every route checks its permission before reading the database or calling
 * Meta. Live Meta calls use META_INVENTORY_ACCESS_TOKEN only.
 */
const express = require('express');
const axios = require('axios');
const {
  Clients, Tenants, MetaWhatsappAccounts, MetaWhatsappPhoneNumbers, MetaWhatsappTemplates, MetaWhatsappSyncRuns,
} = require('../models');
const { deleteCascade } = require('../db/cascade');
const { can } = require('../services/permissions');
const audit = require('../services/audit');
const { inventoryAccessToken, phoneRegistrationEnabled, requireInventoryAccessToken } = require('../services/metaInventoryCredentials');
const { runAsTenant } = require('../services/tenantContext');
const { assertPhoneNumberAvailable } = require('../services/whatsappIdentity');

const NO_ID = { _id: 0 };

function createMetaInventoryRouter({ permit, fail, syncMetaWhatsAppInventory, graphPageData, metaGraphVersion }) {
  const router = express.Router();

  // The database is remote, so every round trip costs time: all reads run in
  // one parallel batch, and templates are only counted here (the list of one
  // account's templates is loaded on demand by GET /templates).
  router.get('/inventory', permit('platform.meta'), async (req, res) => {
    try {
      const [accounts, phoneRows, templateCounts, lastRun, allBrands, allTenants] = await Promise.all([
        MetaWhatsappAccounts.find({}, { ...NO_ID, raw_data: 0 }).sort({ name: 1 }).lean(),
        MetaWhatsappPhoneNumbers.find({}, { ...NO_ID, raw_data: 0 }).lean(),
        MetaWhatsappTemplates.aggregate([
          { $group: { _id: { waba_id: '$waba_id', status: '$status' }, n: { $sum: 1 } } },
        ]),
        MetaWhatsappSyncRuns.findOne({}, NO_ID).sort({ id: -1 }).lean(),
        Clients.find({}, { _id: 0, id: 1, name: 1, tenant_id: 1, phone_number_id: 1, wa_business_id: 1, whatsapp_number: 1 }).lean(),
        Tenants.find({ status: { $ne: 'deleted' } }, { _id: 0, id: 1, name: 1, status: 1 }).lean(),
      ]);
      const brandById = new Map(allBrands.map((b) => [b.id, b]));
      const tenantById = new Map(allTenants.map((t) => [t.id, t]));
      const accountNames = new Map(accounts.map((a) => [a.waba_id, a.name]));

      const phones = phoneRows.map((p) => {
        const brand = brandById.get(p.client_id) || null;
        return {
          ...p,
          waba_name: accountNames.get(p.waba_id) ?? null,
          linked_brand: brand ? {
            id: brand.id, name: brand.name, tenant_id: brand.tenant_id, tenant_name: tenantById.get(brand.tenant_id)?.name ?? null,
            // The link is only meaningful while the brand still uses this number.
            identity_matches: brand.phone_number_id === p.phone_number_id && brand.wa_business_id === p.waba_id,
          } : null,
        };
      });
      const summary = new Map();
      for (const { _id: { waba_id: wabaId, status }, n } of templateCounts) {
        const s = summary.get(wabaId) || { waba_id: wabaId, total: 0, approved: 0, other: 0 };
        s.total += n;
        if (status === 'APPROVED') s.approved += n; else if (status != null) s.other += n;
        summary.set(wabaId, s);
      }
      const wabas = accounts.map((a) => ({ ...a, phone_count: phoneRows.filter((p) => p.waba_id === a.waba_id).length }));
      // Every workspace brand, for the "Assign to workspace" picker.
      const workspaces = allBrands
        .filter((b) => tenantById.has(b.tenant_id))
        .map((b) => ({
          client_id: b.id, brand_name: b.name, tenant_id: b.tenant_id, tenant_name: tenantById.get(b.tenant_id).name, status: tenantById.get(b.tenant_id).status,
          // A workspace uses one WhatsApp number; one that has it is not offered again.
          has_number: Boolean(b.phone_number_id),
          phone_number_id: b.phone_number_id || null,
          whatsapp_number: b.whatsapp_number || null,
        }))
        .sort((a, b) => String(a.tenant_name).localeCompare(String(b.tenant_name)));
      return res.json({
        wabas, phone_numbers: phones, template_summary: [...summary.values()], last_sync: lastRun || null,
        workspaces,
        sync_enabled: process.env.META_INVENTORY_SYNC !== 'off' && Boolean(inventoryAccessToken()),
        credential_configured: Boolean(inventoryAccessToken()),
        registration_enabled: phoneRegistrationEnabled(),
        can_administer: can(req.identity, 'platform.meta.admin'),
      });
    } catch (error) {
      return fail(res, error);
    }
  });

  // The templates of one WhatsApp Business Account (Templates tab).
  router.get('/templates', permit('platform.meta'), async (req, res) => {
    try {
      const wabaId = String(req.query.waba_id || '').trim();
      if (!wabaId) return res.status(400).json({ error: 'waba_id is required' });
      const templates = await MetaWhatsappTemplates.find(
        { waba_id: wabaId },
        { _id: 0, template_id: 1, waba_id: 1, name: 1, language: 1, category: 1, status: 1, last_synced_at: 1 },
      ).sort({ name: 1, language: 1 }).lean();
      return res.json({ templates });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.post('/sync', permit('platform.meta'), async (req, res) => {
    try {
      requireInventoryAccessToken();
      const result = await syncMetaWhatsAppInventory();
      await audit.record(audit.EVENTS.META_INVENTORY_SYNCED, { req, targetType: 'meta_inventory', meta: result });
      return res.json({ success: true, ...result });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message, code: error.code });
      return res.status(400).json({ error: error.message || 'Meta inventory sync failed' });
    }
  });

  // Reconciliation only: records that an inventory number is the one a brand
  // already uses through its own connection. It never changes the brand.
  router.post('/phone-numbers/:phoneId/link', permit('platform.meta'), async (req, res) => {
    try {
      const clientId = Number(req.body?.client_id);
      if (!Number.isInteger(clientId) || clientId <= 0) return res.status(400).json({ error: 'client_id is required' });
      const phone = await MetaWhatsappPhoneNumbers.findOne({ phone_number_id: String(req.params.phoneId) }, NO_ID).lean();
      if (!phone) return res.status(404).json({ error: 'Meta phone number not found in inventory' });
      const brand = await Clients.findOne({ id: clientId }, { _id: 0, id: 1, tenant_id: 1, phone_number_id: 1, wa_business_id: 1 }).lean();
      if (!brand) return res.status(404).json({ error: 'Brand not found' });
      if (brand.phone_number_id !== phone.phone_number_id || brand.wa_business_id !== phone.waba_id) {
        return res.status(409).json({
          error: 'This brand does not use this number. A brand\'s WhatsApp number can only be connected by the customer from their own WhatsApp Business account.',
          code: 'IDENTITY_MISMATCH',
        });
      }
      await MetaWhatsappPhoneNumbers.updateOne({ phone_number_id: phone.phone_number_id }, { $set: { client_id: clientId } });
      await audit.record(audit.EVENTS.META_PHONE_LINKED, {
        tenantId: brand.tenant_id, req, targetType: 'meta_phone_number', targetId: phone.phone_number_id,
        meta: { client_id: clientId, waba_id: phone.waba_id, previous_client_id: phone.client_id ?? null },
      });
      return res.json({ success: true });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.post('/phone-numbers/:phoneId/unlink', permit('platform.meta'), async (req, res) => {
    try {
      const phone = await MetaWhatsappPhoneNumbers.findOne({ phone_number_id: String(req.params.phoneId) }, NO_ID).lean();
      if (!phone) return res.status(404).json({ error: 'Meta phone number not found in inventory' });
      await MetaWhatsappPhoneNumbers.updateOne({ phone_number_id: phone.phone_number_id }, { $set: { client_id: null } });
      await audit.record(audit.EVENTS.META_PHONE_UNLINKED, {
        req, targetType: 'meta_phone_number', targetId: phone.phone_number_id,
        meta: { previous_client_id: phone.client_id ?? null, waba_id: phone.waba_id },
      });
      return res.json({ success: true });
    } catch (error) {
      return fail(res, error);
    }
  });

  // Assigns a platform number to one workspace's brand: writes the brand's
  // number, WABA and display number (never a token) and links the inventory row.
  router.post('/phone-numbers/:phoneId/assign', permit('platform.meta'), async (req, res) => {
    try {
      const clientId = Number(req.body?.client_id);
      if (!Number.isInteger(clientId) || clientId <= 0) return res.status(400).json({ error: 'Choose the workspace to assign this number to' });
      const phone = await MetaWhatsappPhoneNumbers.findOne({ phone_number_id: String(req.params.phoneId) }, NO_ID).lean();
      if (!phone) return res.status(404).json({ error: 'Meta phone number not found in inventory' });
      const brand = await Clients.findOne({ id: clientId }, { _id: 0, id: 1, tenant_id: 1, phone_number_id: 1, wa_business_id: 1 }).lean();
      if (!brand) return res.status(404).json({ error: 'Workspace brand not found' });
      if (phone.client_id != null && phone.client_id !== brand.id) {
        return res.status(409).json({ error: 'This number is assigned to another workspace. Unassign it first.', code: 'PHONE_ASSIGNED' });
      }
      if (brand.phone_number_id && brand.phone_number_id !== phone.phone_number_id) {
        return res.status(409).json({ error: 'This workspace already uses another WhatsApp number. Unassign that number first.', code: 'BRAND_HAS_NUMBER' });
      }
      await assertPhoneNumberAvailable(phone.phone_number_id, { exceptClientId: brand.id });

      const verified = String(phone.connection_status || '').toUpperCase() === 'CONNECTED'
        || String(phone.verification_status || '').toUpperCase() === 'VERIFIED';
      await runAsTenant(brand.tenant_id, () => Clients.updateOne({ id: brand.id }, { $set: {
        phone_number_id: phone.phone_number_id,
        wa_business_id: phone.waba_id,
        whatsapp_number: String(phone.display_phone_number || '').replace(/\D/g, '') || null,
        whatsapp_status: verified ? 'verified' : 'verification_pending',
        whatsapp_verified_at: verified ? new Date() : null,
        whatsapp_verification_error: null,
        updated_at: new Date(),
      } }));
      await MetaWhatsappPhoneNumbers.updateOne({ phone_number_id: phone.phone_number_id }, { $set: { client_id: brand.id } });
      await audit.record(audit.EVENTS.META_PHONE_LINKED, {
        tenantId: brand.tenant_id, req, targetType: 'meta_phone_number', targetId: phone.phone_number_id,
        meta: { client_id: brand.id, waba_id: phone.waba_id, assigned: true, previous_client_id: phone.client_id ?? null },
      });
      return res.json({ success: true });
    } catch (error) {
      return fail(res, error);
    }
  });

  // Unassigns a number: the brand stops using it (its number and WABA are
  // cleared when they point at this number) and the inventory link is removed.
  router.post('/phone-numbers/:phoneId/unassign', permit('platform.meta'), async (req, res) => {
    try {
      const phone = await MetaWhatsappPhoneNumbers.findOne({ phone_number_id: String(req.params.phoneId) }, NO_ID).lean();
      if (!phone) return res.status(404).json({ error: 'Meta phone number not found in inventory' });
      const brand = phone.client_id != null
        ? await Clients.findOne({ id: phone.client_id }, { _id: 0, id: 1, tenant_id: 1, phone_number_id: 1 }).lean()
        : null;
      if (brand && brand.phone_number_id === phone.phone_number_id) {
        await runAsTenant(brand.tenant_id, () => Clients.updateOne({ id: brand.id }, { $set: {
          phone_number_id: null, wa_business_id: null, whatsapp_number: null,
          whatsapp_status: 'not_configured', whatsapp_verified_at: null, whatsapp_verification_error: null, updated_at: new Date(),
        } }));
      }
      await MetaWhatsappPhoneNumbers.updateOne({ phone_number_id: phone.phone_number_id }, { $set: { client_id: null } });
      await audit.record(audit.EVENTS.META_PHONE_UNLINKED, {
        tenantId: brand?.tenant_id ?? null, req, targetType: 'meta_phone_number', targetId: phone.phone_number_id,
        meta: { previous_client_id: phone.client_id ?? null, waba_id: phone.waba_id, unassigned: true },
      });
      return res.json({ success: true });
    } catch (error) {
      return fail(res, error);
    }
  });

  // Removes the cached inventory of one WABA (its phones and templates).
  // Brands are untouched; a WABA with a linked phone must be unlinked first.
  router.delete('/cache/wabas/:wabaId', permit('platform.meta.admin'), async (req, res) => {
    try {
      const wabaId = String(req.params.wabaId);
      const account = await MetaWhatsappAccounts.findOne({ waba_id: wabaId }, { _id: 0, waba_id: 1, name: 1 }).lean();
      if (!account) return res.status(404).json({ error: 'Cached WABA not found' });
      if (await MetaWhatsappPhoneNumbers.exists({ waba_id: wabaId, client_id: { $ne: null } })) {
        return res.status(409).json({ error: 'A phone number in this WABA is linked to a brand. Unlink it first.', code: 'WABA_HAS_LINKED_PHONE' });
      }
      await deleteCascade('meta_whatsapp_templates', { waba_id: wabaId });
      await deleteCascade('meta_whatsapp_accounts', { waba_id: wabaId });
      await audit.record(audit.EVENTS.META_CACHE_CLEARED, { req, targetType: 'meta_waba', targetId: wabaId, meta: { name: account.name } });
      return res.json({ success: true, waba_id: account.waba_id, name: account.name });
    } catch (error) {
      return fail(res, error);
    }
  });

  // Registers an inventory number with the Cloud API. Off unless
  // META_PHONE_REGISTRATION_ENABLED=true and META_INVENTORY_ACCESS_TOKEN is set;
  // both are checked before anything is read or sent.
  router.post('/phone-numbers/:phoneId/register', permit('platform.meta.admin'), async (req, res) => {
    if (!phoneRegistrationEnabled()) {
      return res.status(403).json({ error: 'Phone registration is disabled on this platform', code: 'REGISTRATION_DISABLED' });
    }
    let token;
    try {
      token = requireInventoryAccessToken();
    } catch (error) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    const pin = String(req.body?.pin || '').trim();
    if (!/^\d{6}$/.test(pin)) return res.status(400).json({ error: 'Enter a valid 6-digit two-step verification PIN' });
    let phone;
    try {
      phone = await MetaWhatsappPhoneNumbers.findOne({ phone_number_id: String(req.params.phoneId) }, { _id: 0, phone_number_id: 1, waba_id: 1 }).lean();
      if (!phone) return res.status(404).json({ error: 'Meta phone number not found in inventory' });
      const base = `https://graph.facebook.com/${metaGraphVersion}`;
      const currentPhones = await graphPageData(`${base}/${phone.waba_id}/phone_numbers`, token, { fields: 'id' });
      if (!currentPhones.some((item) => String(item.id) === String(phone.phone_number_id))) {
        return res.status(409).json({ error: `Phone Number ID does not belong to WABA ${phone.waba_id}` });
      }
      await axios.post(`${base}/${phone.phone_number_id}/register`, { messaging_product: 'whatsapp', pin }, { headers: { Authorization: `Bearer ${token}` } });
      await axios.post(`${base}/${phone.waba_id}/subscribed_apps`, null, { headers: { Authorization: `Bearer ${token}` } });
      await audit.record(audit.EVENTS.META_PHONE_REGISTERED, {
        req, targetType: 'meta_phone_number', targetId: phone.phone_number_id, meta: { waba_id: phone.waba_id, outcome: 'registered' },
      });
      phone.registered = true;
      let syncResult;
      try {
        syncResult = await syncMetaWhatsAppInventory();
      } catch (syncError) {
        syncResult = { sync_error: syncError.message };
      }
      return res.json({ success: true, phone_number_id: phone.phone_number_id, waba_id: phone.waba_id, ...syncResult });
    } catch (error) {
      const message = error.response?.data?.error?.message || error.message || 'Meta phone registration failed';
      if (phone && !phone.registered) {
        await audit.record(audit.EVENTS.META_PHONE_REGISTERED, {
          req, targetType: 'meta_phone_number', targetId: phone.phone_number_id, meta: { waba_id: phone.waba_id, outcome: 'failed', error: message },
        });
      }
      console.error('[Meta Phone Registration]', message);
      return res.status(400).json({ error: message });
    }
  });

  return router;
}

module.exports = createMetaInventoryRouter;
