/**
 * Meta calls for a WhatsApp Business profile on a number in the platform's
 * own Meta inventory. Always uses the inventory credential
 * (META_INVENTORY_ACCESS_TOKEN), which never leaves the server.
 */
const axios = require('axios');
const Jimp = require('jimp');
const { MetaWhatsappPhoneNumbers } = require('../models');
const { runAsSystem } = require('./tenantContext');

const PROFILE_FIELDS = 'about,address,description,email,profile_picture_url,websites,vertical';

// Meta's own limits for the profile fields customers may edit.
const LIMITS = { about: 139, description: 512, address: 256, email: 128 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const graphBase = (version) => `https://graph.facebook.com/${version || 'v19.0'}`;

// Meta's own user-facing message when it gives one.
const metaMessage = (error, fallback) => error.response?.data?.error?.error_user_msg
  || error.response?.data?.error?.message || error.message || fallback;

async function fetchProfile({ version, phoneNumberId, token }) {
  const res = await axios.get(`${graphBase(version)}/${phoneNumberId}/whatsapp_business_profile`, {
    params: { fields: PROFILE_FIELDS }, headers: { Authorization: `Bearer ${token}` }, timeout: 15000,
  });
  const row = res.data?.data?.[0] || {};
  return row.business_profile || row;
}

// Saves Meta's current profile into the inventory cache (platform data).
async function cacheProfile(phoneNumberId, profile) {
  await runAsSystem(() => MetaWhatsappPhoneNumbers.updateOne({ phone_number_id: phoneNumberId }, { $set: {
    profile_picture_url: profile.profile_picture_url || null, profile_about: profile.about || null,
    profile_address: profile.address || null, profile_description: profile.description || null,
    profile_email: profile.email || null, profile_websites: profile.websites || [], profile_vertical: profile.vertical || null,
    'raw_data.business_profile': profile, last_synced_at: new Date(),
  } }), 'whatsapp-profile');
}

async function updateProfile({ version, phoneNumberId, token, fields }) {
  await axios.post(`${graphBase(version)}/${phoneNumberId}/whatsapp_business_profile`, { messaging_product: 'whatsapp', ...fields }, {
    headers: { Authorization: `Bearer ${token}` }, timeout: 20000,
  });
}

/** Square 640x640 JPEG, as Meta wants. Throws a 400 for a too-small image. */
async function preparePicture(fileBuffer) {
  const image = await Jimp.read(fileBuffer);
  if (image.bitmap.width < 192 || image.bitmap.height < 192) {
    throw Object.assign(new Error('The photo must be at least 192 x 192 pixels.'), { status: 400 });
  }
  return image.cover(640, 640).quality(90).getBufferAsync(Jimp.MIME_JPEG);
}

/** Uploads a JPEG through Meta's resumable upload and sets it as the profile picture. */
async function setPicture({ version, appId, phoneNumberId, token, buffer, fileName }) {
  const base = graphBase(version);
  const session = await axios.post(`${base}/${appId}/uploads`, null, {
    params: { file_name: fileName, file_length: buffer.length, file_type: 'image/jpeg' },
    headers: { Authorization: `Bearer ${token}` }, timeout: 20000,
  });
  if (!session.data?.id) throw new Error('Meta did not return an upload session');
  const upload = await axios.post(`${base}/${session.data.id}`, buffer, {
    headers: { Authorization: `OAuth ${token}`, file_offset: '0', 'Content-Type': 'image/jpeg' },
    maxBodyLength: 6 * 1024 * 1024, timeout: 30000,
  });
  const handle = upload.data?.h;
  if (!handle) throw new Error('Meta did not return an image handle');
  await updateProfile({ version, phoneNumberId, token, fields: { profile_picture_handle: handle } });
}

module.exports = { LIMITS, EMAIL_RE, metaMessage, fetchProfile, cacheProfile, updateProfile, preparePicture, setPicture };
