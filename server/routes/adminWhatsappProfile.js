/**
 * A workspace's WhatsApp Business profile, edited by staff
 * (/api/admin/tenants/:id/whatsapp-profile).
 *
 * The profile customers see in WhatsApp lives at Meta. The workspace's number
 * is in the platform's own Meta portfolio, so Meta calls use the platform
 * inventory credential (META_INVENTORY_ACCESS_TOKEN) and never a stored brand
 * token. Every save also updates the brand row and the inventory cache, and
 * is audited. Display name, username, the blue tick and social accounts are
 * not available through the API; staff change them in WhatsApp Manager.
 */
const express = require('express');
const axios = require('axios');
const multer = require('multer');
const Jimp = require('jimp');
const { Clients, MetaWhatsappPhoneNumbers, MetaWhatsappAccounts } = require('../models');
const { runAsTenant } = require('../services/tenantContext');
const { inventoryAccessToken } = require('../services/metaInventoryCredentials');
const audit = require('../services/audit');

const PROFILE_FIELDS = 'about,address,description,email,profile_picture_url,websites,vertical';

// Meta business categories: [code Meta uses, label shown and stored on the brand].
const CATEGORIES = [
  ['OTHER', 'Other'],
  ['AUTO', 'Automotive'],
  ['BEAUTY', 'Beauty, spa and salon'],
  ['APPAREL', 'Clothing and apparel'],
  ['EDU', 'Education'],
  ['ENTERTAIN', 'Entertainment'],
  ['EVENT_PLAN', 'Event planning and service'],
  ['FINANCE', 'Finance and banking'],
  ['GROCERY', 'Food and groceries'],
  ['GOVT', 'Public service'],
  ['HOTEL', 'Hotel and lodging'],
  ['HEALTH', 'Medical and health'],
  ['NONPROFIT', 'Non-profit'],
  ['PROF_SERVICES', 'Professional services'],
  ['RETAIL', 'Shopping and retail'],
  ['TRAVEL', 'Travel and transportation'],
  ['RESTAURANT', 'Restaurant'],
];
const CODES = new Set(CATEGORIES.map(([code]) => code));
// Older brand rows store a label (or 'OTHER'); map them to a Meta code.
const LEGACY_CODES = {
  'Matrimonial service': 'OTHER', 'Alcoholic drinks': 'OTHER', 'Over-the-counter medicine': 'HEALTH',
  Government: 'GOVT', Charity: 'NONPROFIT', OTHER: 'OTHER',
};
const toCode = (value) => {
  if (CODES.has(value)) return value;
  const byLabel = CATEGORIES.find(([, text]) => text.toLowerCase() === String(value || '').toLowerCase());
  return byLabel ? byLabel[0] : (LEGACY_CODES[value] || 'OTHER');
};
const labelOf = (code) => CATEGORIES.find(([c]) => c === code)?.[1] || 'Other';

const LIMITS = { description: 512, address: 256, email: 128, about: 139, website: 256 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

const metaMessage = (error, fallback) => error.response?.data?.error?.error_user_msg
  || error.response?.data?.error?.message || error.message || fallback;

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png'].includes(file.mimetype)),
});

module.exports = function registerWhatsappProfileRoutes(router, { permit, fail, metaGraphVersion = 'v19.0' }) {
  const base = `https://graph.facebook.com/${metaGraphVersion}`;

  // The brand, its inventory number and whether Meta can be reached for it.
  async function load(tenantId) {
    const brand = await runAsTenant(tenantId, () => Clients.findOne({}, { _id: 0 }).lean());
    if (!brand) throw Object.assign(new Error('Brand profile not found'), { status: 404 });
    const phone = brand.phone_number_id
      ? await MetaWhatsappPhoneNumbers.findOne({ phone_number_id: brand.phone_number_id }, { _id: 0 }).lean()
      : null;
    const account = phone ? await MetaWhatsappAccounts.findOne({ waba_id: phone.waba_id }, { _id: 0, business_id: 1, name: 1 }).lean() : null;
    const token = inventoryAccessToken();
    let blocked = null;
    if (!brand.phone_number_id) blocked = 'This workspace has no WhatsApp number yet. Assign one first.';
    else if (!phone) blocked = 'This number is not in the platform Meta inventory, so its profile cannot be edited here.';
    else if (!token) blocked = 'The Meta credential (META_INVENTORY_ACCESS_TOKEN) is not set on the server.';
    return { brand, phone, account, token, blocked };
  }

  const managerUrl = (phone, account) => {
    if (!phone || !account?.business_id) return 'https://business.facebook.com/wa/manage/phone-numbers/';
    const url = new URL('https://business.facebook.com/wa/manage/phone-numbers/');
    url.searchParams.set('business_id', account.business_id);
    url.searchParams.set('waba_id', phone.waba_id);
    url.searchParams.set('phone_number_id', phone.phone_number_id);
    return url.toString();
  };

  // Saves Meta's current profile into the inventory cache.
  async function cacheProfile(phoneNumberId, profile) {
    await MetaWhatsappPhoneNumbers.updateOne({ phone_number_id: phoneNumberId }, { $set: {
      profile_picture_url: profile.profile_picture_url || null, profile_about: profile.about || null,
      profile_address: profile.address || null, profile_description: profile.description || null,
      profile_email: profile.email || null, profile_websites: profile.websites || [], profile_vertical: profile.vertical || null,
      'raw_data.business_profile': profile, last_synced_at: new Date(),
    } });
  }

  async function fetchProfile(phoneNumberId, token) {
    const res = await axios.get(`${base}/${phoneNumberId}/whatsapp_business_profile`, {
      params: { fields: PROFILE_FIELDS }, headers: { Authorization: `Bearer ${token}` }, timeout: 15000,
    });
    const row = res.data?.data?.[0] || {};
    return row.business_profile || row;
  }

  router.get('/tenants/:id/whatsapp-profile', permit('platform.tenants.view'), async (req, res) => {
    try {
      const { brand, phone, account, token, blocked } = await load(Number(req.params.id));
      let profile = null;
      let source = 'database';
      let metaError = null;
      if (!blocked) {
        try {
          profile = await fetchProfile(phone.phone_number_id, token);
          source = 'meta';
          await cacheProfile(phone.phone_number_id, profile);
        } catch (error) {
          metaError = metaMessage(error, 'Meta did not return the profile');
        }
      }
      if (!profile) {
        // Last known values: the inventory cache, then the brand row.
        profile = {
          about: phone?.profile_about || '',
          description: phone?.profile_description ?? brand.wa_description ?? '',
          address: phone?.profile_address ?? brand.wa_address ?? '',
          email: phone?.profile_email ?? brand.wa_email ?? '',
          websites: phone?.profile_websites?.length ? phone.profile_websites : [brand.wa_website, brand.wa_website_2].filter(Boolean),
          vertical: phone?.profile_vertical || toCode(brand.wa_category),
          profile_picture_url: phone?.profile_picture_url || null,
        };
      }
      const nameStatus = String(phone?.raw_data?.new_name_status && phone.raw_data.new_name_status !== 'NONE'
        ? phone.raw_data.new_name_status : phone?.raw_data?.name_status || '').toUpperCase() || null;
      return res.json({
        profile: {
          about: profile.about || '',
          description: profile.description || '',
          address: profile.address || '',
          email: profile.email || '',
          websites: [...(profile.websites || []), '', ''].slice(0, 2),
          vertical: CODES.has(profile.vertical) ? profile.vertical : toCode(profile.vertical),
          profile_picture_url: profile.profile_picture_url || null,
        },
        source,
        meta_error: metaError,
        can_sync: !blocked,
        blocked_reason: blocked,
        number: phone ? {
          display_phone_number: phone.display_phone_number, verified_name: phone.verified_name,
          name_status: nameStatus, connection_status: phone.connection_status || null, waba_id: phone.waba_id,
        } : null,
        manager_url: managerUrl(phone, account),
        categories: CATEGORIES.map(([code, text]) => ({ code, label: text })),
        limits: LIMITS,
      });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.put('/tenants/:id/whatsapp-profile', permit('platform.tenants.manage'), express.json(), async (req, res) => {
    try {
      const tenantId = Number(req.params.id);
      const body = req.body || {};
      const clean = (v) => String(v ?? '').trim();
      const input = {
        vertical: clean(body.vertical) || 'OTHER',
        about: clean(body.about),
        description: clean(body.description),
        address: clean(body.address),
        email: clean(body.email),
        websites: (Array.isArray(body.websites) ? body.websites : []).map(clean).filter(Boolean).slice(0, 2),
      };
      if (!CODES.has(input.vertical)) return res.status(400).json({ error: 'Choose a category from the list' });
      for (const key of ['about', 'description', 'address', 'email']) {
        if (input[key].length > LIMITS[key]) return res.status(400).json({ error: `${key[0].toUpperCase()}${key.slice(1)} can be at most ${LIMITS[key]} characters` });
      }
      if (input.email && !EMAIL_RE.test(input.email)) return res.status(400).json({ error: 'Enter a valid email address' });
      for (const site of input.websites) {
        if (!URL_RE.test(site) || site.length > LIMITS.website) return res.status(400).json({ error: `Website "${site}" must start with http:// or https://` });
      }

      const { brand, phone, token, blocked } = await load(tenantId);
      // Without a reachable Meta number the profile is still saved on the
      // brand; it goes to Meta on the next save once a number is connected.
      const toMeta = !blocked;

      const payload = {
        messaging_product: 'whatsapp',
        vertical: input.vertical,
        description: input.description,
        address: input.address,
        email: input.email,
        websites: input.websites,
      };
      if (input.about) payload.about = input.about;
      let profile = null;
      if (toMeta) {
        try {
          await axios.post(`${base}/${phone.phone_number_id}/whatsapp_business_profile`, payload, {
            headers: { Authorization: `Bearer ${token}` }, timeout: 20000,
          });
        } catch (error) {
          return res.status(400).json({ error: `Meta refused the update: ${metaMessage(error, 'unknown error')}` });
        }
        profile = await fetchProfile(phone.phone_number_id, token).catch(() => null);
        if (profile) await cacheProfile(phone.phone_number_id, profile);
      }
      await runAsTenant(tenantId, () => Clients.updateOne({ id: brand.id }, { $set: {
        wa_category: labelOf(input.vertical),
        wa_description: input.description || null,
        wa_address: input.address || null,
        wa_email: input.email || null,
        wa_website: input.websites[0] || null,
        wa_website_2: input.websites[1] || null,
        updated_at: new Date(),
      } }));
      await audit.record(audit.EVENTS.BRAND_UPDATED, {
        tenantId, req, targetType: 'client', targetId: brand.id,
        meta: { whatsapp_profile: true, saved_to_meta: toMeta, fields: Object.keys(payload).filter((k) => k !== 'messaging_product') },
      });
      return res.json({ success: true, saved_to_meta: toMeta, pending_reason: toMeta ? null : blocked, profile });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.post('/tenants/:id/whatsapp-profile/photo', permit('platform.tenants.manage'), (req, res, next) => photoUpload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The image must be 5 MB or smaller' : err.message });
    return next();
  }), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Choose a JPEG or PNG image' });
      const appId = process.env.META_APP_ID;
      if (!appId) return res.status(503).json({ error: 'META_APP_ID is not set on the server' });
      const tenantId = Number(req.params.id);
      const { brand, phone, token, blocked } = await load(tenantId);
      if (blocked) return res.status(409).json({ error: blocked, code: 'PROFILE_NOT_EDITABLE' });

      // Meta wants a square image; 640x640 JPEG fits every client.
      const image = await Jimp.read(req.file.buffer);
      if (image.bitmap.width < 192 || image.bitmap.height < 192) return res.status(400).json({ error: 'The image must be at least 192 x 192 pixels' });
      const buffer = await image.cover(640, 640).quality(90).getBufferAsync(Jimp.MIME_JPEG);

      let handle;
      try {
        const session = await axios.post(`${base}/${appId}/uploads`, null, {
          params: { file_name: `brand-${brand.id}.jpg`, file_length: buffer.length, file_type: 'image/jpeg' },
          headers: { Authorization: `Bearer ${token}` }, timeout: 20000,
        });
        if (!session.data?.id) throw new Error('Meta did not return an upload session');
        const upload = await axios.post(`${base}/${session.data.id}`, buffer, {
          headers: { Authorization: `OAuth ${token}`, file_offset: '0', 'Content-Type': 'image/jpeg' },
          maxBodyLength: 6 * 1024 * 1024, timeout: 30000,
        });
        handle = upload.data?.h;
        if (!handle) throw new Error('Meta did not return an image handle');
        await axios.post(`${base}/${phone.phone_number_id}/whatsapp_business_profile`, {
          messaging_product: 'whatsapp', profile_picture_handle: handle,
        }, { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 });
      } catch (error) {
        return res.status(400).json({ error: `Meta refused the picture: ${metaMessage(error, 'unknown error')}` });
      }

      const profile = await fetchProfile(phone.phone_number_id, token).catch(() => null);
      if (profile) await cacheProfile(phone.phone_number_id, profile);
      await audit.record(audit.EVENTS.BRAND_UPDATED, {
        tenantId, req, targetType: 'client', targetId: brand.id, meta: { whatsapp_profile: true, fields: ['profile_picture'] },
      });
      return res.json({ success: true, profile_picture_url: profile?.profile_picture_url || null });
    } catch (error) {
      return fail(res, error);
    }
  });
};
