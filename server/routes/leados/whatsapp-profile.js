/**
 * Customer panel: the workspace owner/admin edits the WhatsApp Business
 * profile customers see (About, Description, Address, Email, profile photo).
 *
 *   PUT  /api/whatsapp/profile        { about, description, address, email }
 *   POST /api/whatsapp/profile/photo  multipart "photo" (JPEG/PNG, up to 5 MB)
 *
 * The number lives in the platform's own Meta inventory, so Meta is called
 * with the inventory credential on the server; no token reaches the browser.
 * The workspace always comes from the session. Website and category stay
 * with the Getnera team (admin panel).
 */
const multer = require('multer');
const { MetaWhatsappPhoneNumbers } = require('../../models');
const { requirePermission } = require('../../services/permissions');
const { runAsSystem } = require('../../services/tenantContext');
const { inventoryAccessToken } = require('../../services/metaInventoryCredentials');
const profileMeta = require('../../services/whatsappBusinessProfile');
const audit = require('../../services/audit');

const { LIMITS, EMAIL_RE } = profileMeta;
const EDITABLE = ['about', 'description', 'address', 'email'];
const LOCKED = ['websites', 'website', 'vertical', 'category'];
const LABELS = { about: 'About', description: 'Description', address: 'Address', email: 'Email' };

const NOT_EDITABLE = 'Your WhatsApp profile cannot be changed from here yet. Please ask the Getnera team to update it.';
const NO_NUMBER = 'Connect a WhatsApp number first. Your profile can be edited once a number is connected.';

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png'].includes(file.mimetype)),
});

/** Checks the customer's input; returns { input } or { error }. */
function validate(body = {}) {
  if (LOCKED.some((key) => body[key] !== undefined)) {
    return { error: 'The website and category can only be changed by the Getnera team.' };
  }
  const input = {};
  for (const key of EDITABLE) {
    if (body[key] === undefined) continue;
    if (body[key] !== null && typeof body[key] !== 'string') return { error: `${LABELS[key]} must be text.` };
    input[key] = String(body[key] ?? '').trim();
    if (input[key].length > LIMITS[key]) return { error: `${LABELS[key]} can be at most ${LIMITS[key]} characters (you entered ${input[key].length}).` };
  }
  if (!Object.keys(input).length) return { error: 'Nothing to save. Change at least one field.' };
  if (input.email && !EMAIL_RE.test(input.email)) return { error: 'Enter a valid email address, for example hello@yourbusiness.com.' };
  // Meta does not allow an empty About; leaving it blank keeps the current one.
  if (input.about === '') delete input.about;
  return { input };
}

const publicProfile = (profile) => ({
  picture_url: profile?.profile_picture_url || null,
  about: profile?.about || null,
  description: profile?.description || null,
  address: profile?.address || null,
  email: profile?.email || null,
  websites: profile?.websites || [],
  vertical: profile?.vertical || null,
});

module.exports = function registerWhatsappProfileRoutes(app, ctx) {
  const { Clients, auth, META_GRAPH_VERSION } = ctx;

  // The workspace's brand and its inventory number, or a plain-language reason it cannot be edited.
  async function target() {
    const brand = await Clients.findOne({}, { _id: 0, id: 1, phone_number_id: 1 }).lean();
    if (!brand?.phone_number_id) return { status: 409, error: NO_NUMBER, code: 'WHATSAPP_NOT_CONNECTED' };
    const phone = await runAsSystem(() => MetaWhatsappPhoneNumbers.findOne({ phone_number_id: brand.phone_number_id }, { _id: 0, phone_number_id: 1 }).lean(), 'whatsapp-profile');
    const token = inventoryAccessToken();
    if (!phone || !token) return { status: 409, error: NOT_EDITABLE, code: 'PROFILE_NOT_EDITABLE' };
    return { brand, phoneNumberId: phone.phone_number_id, token };
  }

  app.put('/api/whatsapp/profile', auth, requirePermission('whatsapp.manage'), async (req, res) => {
    try {
      const { input, error } = validate(req.body || {});
      if (error) return res.status(400).json({ error, code: 'INVALID_PROFILE' });
      const found = await target();
      if (found.error) return res.status(found.status).json({ error: found.error, code: found.code });
      const { brand, phoneNumberId, token } = found;
      const version = META_GRAPH_VERSION;

      try {
        await profileMeta.updateProfile({ version, phoneNumberId, token, fields: input });
      } catch (metaError) {
        console.error('[whatsapp/profile] Meta refused the update:', profileMeta.metaMessage(metaError, 'unknown error'));
        const detail = metaError.response?.data?.error?.error_user_msg;
        return res.status(400).json({ error: `WhatsApp did not accept this change.${detail ? ` ${detail}` : ' Please check the details and try again.'}`, code: 'META_REFUSED' });
      }
      const profile = await profileMeta.fetchProfile({ version, phoneNumberId, token }).catch(() => null);
      if (profile) await profileMeta.cacheProfile(phoneNumberId, profile);

      const brandChanges = {};
      if (input.description !== undefined) brandChanges.wa_description = input.description || null;
      if (input.address !== undefined) brandChanges.wa_address = input.address || null;
      if (input.email !== undefined) brandChanges.wa_email = input.email || null;
      if (Object.keys(brandChanges).length) await Clients.updateOne({ id: brand.id }, { $set: { ...brandChanges, updated_at: new Date() } });

      await audit.record(audit.EVENTS.BRAND_UPDATED, {
        tenantId: req.identity.tenantId, req, targetType: 'client', targetId: brand.id,
        meta: { whatsapp_profile: true, by_customer: true, fields: Object.keys(input) },
      });
      return res.json({ success: true, profile: profile ? publicProfile(profile) : null });
    } catch (error) {
      console.error('[whatsapp/profile]', error.message);
      return res.status(500).json({ error: 'Could not save your WhatsApp profile. Please try again in a moment.' });
    }
  });

  app.post('/api/whatsapp/profile/photo', auth, requirePermission('whatsapp.manage'), (req, res, next) => photoUpload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The photo must be 5 MB or smaller.' : 'Could not read the photo. Choose a JPEG or PNG image.' });
    return next();
  }), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Choose a JPEG or PNG image.' });
      const appId = process.env.META_APP_ID;
      if (!appId) return res.status(409).json({ error: NOT_EDITABLE, code: 'PROFILE_NOT_EDITABLE' });
      const found = await target();
      if (found.error) return res.status(found.status).json({ error: found.error, code: found.code });
      const { brand, phoneNumberId, token } = found;
      const version = META_GRAPH_VERSION;

      let buffer;
      try {
        buffer = await profileMeta.preparePicture(req.file.buffer);
      } catch (imageError) {
        return res.status(400).json({ error: imageError.status === 400 ? imageError.message : 'Could not read the photo. Choose a JPEG or PNG image.' });
      }
      try {
        await profileMeta.setPicture({ version, appId, phoneNumberId, token, buffer, fileName: `brand-${brand.id}.jpg` });
      } catch (metaError) {
        console.error('[whatsapp/profile/photo] Meta refused the picture:', profileMeta.metaMessage(metaError, 'unknown error'));
        return res.status(400).json({ error: 'WhatsApp did not accept this photo. Try a different square image.', code: 'META_REFUSED' });
      }
      const profile = await profileMeta.fetchProfile({ version, phoneNumberId, token }).catch(() => null);
      if (profile) await profileMeta.cacheProfile(phoneNumberId, profile);
      await audit.record(audit.EVENTS.BRAND_UPDATED, {
        tenantId: req.identity.tenantId, req, targetType: 'client', targetId: brand.id,
        meta: { whatsapp_profile: true, by_customer: true, fields: ['profile_picture'] },
      });
      return res.json({ success: true, picture_url: profile?.profile_picture_url || null });
    } catch (error) {
      console.error('[whatsapp/profile/photo]', error.message);
      return res.status(500).json({ error: 'Could not change your profile photo. Please try again in a moment.' });
    }
  });
};

module.exports.validate = validate;
