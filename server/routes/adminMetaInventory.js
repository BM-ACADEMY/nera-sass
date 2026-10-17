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
 *   platform.meta        founder, ops   view, sync, link/unlink reconciliation
 *   platform.meta.admin  founder        phone registration, cache clearing
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

const NO_ID = { _id: 0 };

function createMetaInventoryRouter({ permit, fail, syncMetaWhatsAppInventory, graphPageData, metaGraphVersion }) {
  const router = express.Router();

  router.get('/inventory', permit('platform.meta'), async (req, res) => {
    try {
      const [accounts, phoneRows, templates, lastRun] = await Promise.all([
        MetaWhatsappAccounts.find({}, NO_ID).sort({ name: 1 }).lean(),
        MetaWhatsappPhoneNumbers.find({}, { ...NO_ID, raw_data: 0 }).lean(),
        MetaWhatsappTemplates.find({}, { _id: 0, waba_id: 1, status: 1 }).lean(),
        MetaWhatsappSyncRuns.findOne({}, NO_ID).sort({ id: -1 }).lean(),
      ]);
      // Only the brands an inventory row is linked to, with their workspace.
      const linkedIds = [...new Set(phoneRows.map((p) => p.client_id).filter((id) => id != null))];
      const brands = linkedIds.length
        ? await Clients.find({ id: { $in: linkedIds } }, { _id: 0, id: 1, name: 1, tenant_id: 1, phone_number_id: 1, wa_business_id: 1 }).lean()
        : [];
      const tenantIds = [...new Set(brands.map((b) => b.tenant_id).filter((id) => id != null))];
      const tenants = tenantIds.length ? await Tenants.find({ id: { $in: tenantIds } }, { _id: 0, id: 1, name: 1 }).lean() : [];
      const brandById = new Map(brands.map((b) => [b.id, b]));
      const tenantName = new Map(tenants.map((t) => [t.id, t.name]));
      const accountNames = new Map(accounts.map((a) => [a.waba_id, a.name]));

      const phones = phoneRows.map((p) => {
        const brand = brandById.get(p.client_id) || null;
        return {
          ...p,
          waba_name: accountNames.get(p.waba_id) ?? null,
          linked_brand: brand ? {
            id: brand.id, name: brand.name, tenant_id: brand.tenant_id, tenant_name: tenantName.get(brand.tenant_id) ?? null,
            // The link is only meaningful while the brand still uses this number.
            identity_matches: brand.phone_number_id === p.phone_number_id && brand.wa_business_id === p.waba_id,
          } : null,
        };
      });
      const summary = new Map();
      for (const t of templates) {
        const s = summary.get(t.waba_id) || { waba_id: t.waba_id, total: 0, approved: 0, other: 0 };
        s.total++;
        if (t.status === 'APPROVED') s.approved++; else if (t.status != null) s.other++;
        summary.set(t.waba_id, s);
      }
      const wabas = accounts.map((a) => ({ ...a, raw_data: undefined, phone_count: phoneRows.filter((p) => p.waba_id === a.waba_id).length }));
      return res.json({
        wabas, phone_numbers: phones, template_summary: [...summary.values()], last_sync: lastRun || null,
        credential_configured: Boolean(inventoryAccessToken()),
        registration_enabled: phoneRegistrationEnabled(),
        can_administer: can(req.identity, 'platform.meta.admin'),
      });
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
