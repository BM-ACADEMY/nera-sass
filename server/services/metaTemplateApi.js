/**
 * Meta message templates for one WhatsApp Business Account: list from the
 * cache, refresh from Meta, create, edit, delete, check templates in review,
 * and upload header samples. Shared by admin Template Management (the
 * platform WABA, inventory credential) and the customer panel (the workspace's
 * own WABA, its brand credential). Callers pass { wabaId, token }; the token
 * is only sent to Meta, never returned.
 *
 * Callers run inside a system context for the meta_whatsapp_* cache.
 */
const axios = require('axios');
const multer = require('multer');
const { MetaWhatsappTemplates } = require('../models');
const { buildTemplate, TemplateError } = require('./templateBuilder');

const MEDIA_TYPES = {
  IMAGE: { mime: ['image/jpeg', 'image/png'], max: 5 * 1024 * 1024 },
  VIDEO: { mime: ['video/mp4', 'video/3gpp'], max: 16 * 1024 * 1024 },
  DOCUMENT: { mime: ['application/pdf'], max: 100 * 1024 * 1024 },
};
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const REVIEW_FIELDS = { submitted_at: 1, submitted_at_estimated: 1, reviewed_at: 1 };
const LIST_FIELDS = { _id: 0, template_id: 1, waba_id: 1, name: 1, language: 1, category: 1, status: 1, last_synced_at: 1, ...REVIEW_FIELDS };
const PUBLIC_FIELDS = { _id: 0, template_id: 1, waba_id: 1, name: 1, language: 1, category: 1, status: 1, components: 1, last_synced_at: 1, ...REVIEW_FIELDS, 'raw_data.rejected_reason': 1, 'raw_data.quality_score': 1, 'raw_data.parameter_format': 1 };
const TEMPLATE_FIELDS = 'id,name,language,status,category,components,rejected_reason,quality_score,parameter_format';

class MetaCallError extends Error {
  constructor(error) {
    const meta = error.response?.data?.error;
    super(meta?.error_user_msg || meta?.message || error.message || 'Meta request failed');
    this.status = 502;
    this.code = 'META_ERROR';
    this.meta_title = meta?.error_user_title || null;
  }
}

class TemplateApiError extends Error {
  constructor(status, message, code, field) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

const present = (t) => ({
  template_id: t.template_id, waba_id: t.waba_id, name: t.name, language: t.language, category: t.category, status: t.status,
  components: t.components || [], last_synced_at: t.last_synced_at,
  submitted_at: t.submitted_at || null,
  submitted_at_estimated: Boolean(t.submitted_at_estimated),
  reviewed_at: t.reviewed_at || null,
  rejected_reason: t.raw_data?.rejected_reason && t.raw_data.rejected_reason !== 'NONE' ? t.raw_data.rejected_reason : null,
  quality: t.raw_data?.quality_score?.score || null,
  parameter_format: t.raw_data?.parameter_format || null,
});

/** JSON error for any failure of this module (falls back to `fail`). */
function replyError(res, error, fail) {
  if (error instanceof TemplateError) return res.status(400).json({ error: error.message, field: error.field });
  if (error instanceof MetaCallError) return res.status(502).json({ error: error.message, title: error.meta_title, code: error.code });
  if (error instanceof TemplateApiError || (error.status && error.code)) {
    return res.status(error.status).json({ error: error.message, code: error.code, ...(error.field ? { field: error.field } : {}) });
  }
  return fail(res, error);
}

const IN_REVIEW = ['PENDING', 'IN_APPEAL'];
const inReview = (status) => IN_REVIEW.includes(String(status || '').toUpperCase());

// Review timing for a status change. `submitted`: we just sent it to Meta
// (create or edit). A template first seen already decided has no timing.
function reviewTiming(previous, nextStatus, { submitted = false } = {}) {
  const now = new Date();
  if (submitted) return { $set: { submitted_at: now, submitted_at_estimated: false }, $unset: { reviewed_at: '' } };
  if (inReview(nextStatus)) {
    if (previous && inReview(previous.status) && previous.submitted_at) return null;
    return { $set: { submitted_at: now, submitted_at_estimated: true }, $unset: { reviewed_at: '' } };
  }
  if (previous && inReview(previous.status) && previous.submitted_at && !previous.reviewed_at) return { $set: { reviewed_at: now } };
  return null;
}

function createTemplateApi({ metaGraphVersion = 'v21.0' } = {}) {
  const graph = (path) => `https://graph.facebook.com/${metaGraphVersion}/${path}`;
  const call = async (fn) => {
    try {
      return await fn();
    } catch (error) {
      throw new MetaCallError(error);
    }
  };

  const cacheTemplate = async (wabaId, t, { submitted = false } = {}) => {
    const fields = {
      waba_id: wabaId, name: t.name ?? null, language: t.language ?? null, status: t.status ?? null,
      category: t.category ?? null, components: t.components || [], raw_data: t, last_synced_at: new Date(),
    };
    const previous = await MetaWhatsappTemplates.findOne({ template_id: String(t.id) }, { _id: 0, status: 1, ...REVIEW_FIELDS }).lean();
    const timing = reviewTiming(previous, t.status, { submitted });
    const update = { $set: { ...fields, ...(timing?.$set || {}) }, ...(timing?.$unset ? { $unset: timing.$unset } : {}) };
    return MetaWhatsappTemplates.updateOne({ template_id: String(t.id) }, update, { upsert: true });
  };

  const list = async (wabaId) => (await MetaWhatsappTemplates.find({ waba_id: wabaId }, PUBLIC_FIELDS).sort({ name: 1, language: 1 }).lean()).map(present);
  const findOwn = (wabaId, templateId, projection = { _id: 0 }) => MetaWhatsappTemplates.findOne({ template_id: String(templateId), waba_id: wabaId }, projection).lean();

  // Pulls every template of the WABA from Meta and drops cached rows Meta no longer returns.
  async function refresh({ wabaId, token }) {
    const seen = [];
    let url = graph(`${wabaId}/message_templates`);
    let params = { fields: TEMPLATE_FIELDS, limit: 100 };
    for (let page = 0; url && page < 20; page += 1) {
      const { data } = await call(() => axios.get(url, { params, headers: { Authorization: `Bearer ${token}` }, timeout: 20000 }));
      for (const t of data?.data || []) {
        await cacheTemplate(wabaId, t);
        seen.push(String(t.id));
      }
      url = data?.paging?.next || null;
      params = undefined;
    }
    await MetaWhatsappTemplates.deleteMany({ waba_id: wabaId, template_id: { $nin: seen } });
    return seen.length;
  }

  async function create({ wabaId, token }, form) {
    const payload = buildTemplate(form);
    if (await MetaWhatsappTemplates.exists({ waba_id: wabaId, name: payload.name, language: payload.language })) {
      throw new TemplateApiError(409, `A template named "${payload.name}" already exists in this language.`, 'TEMPLATE_EXISTS', 'name');
    }
    const { data: created } = await call(() => axios.post(graph(`${wabaId}/message_templates`), payload, { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 }));
    await cacheTemplate(wabaId, {
      id: created.id, name: payload.name, language: payload.language, category: created.category || payload.category,
      status: created.status || 'PENDING', components: payload.components, parameter_format: payload.parameter_format,
    }, { submitted: true });
    return present(await findOwn(wabaId, created.id, PUBLIC_FIELDS));
  }

  // Meta allows editing the content (not the name or language); the edit goes back to review.
  async function update({ wabaId, token }, templateId, form) {
    const current = await findOwn(wabaId, templateId);
    if (!current) throw new TemplateApiError(404, 'Template not found', 'TEMPLATE_NOT_FOUND');
    const payload = buildTemplate({ ...form, name: current.name, language: current.language });
    const body = { components: payload.components };
    if (payload.category !== current.category) body.category = payload.category;
    await call(() => axios.post(graph(String(current.template_id)), body, { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 }));
    await cacheTemplate(wabaId, { ...current.raw_data, id: current.template_id, name: current.name, language: current.language, category: payload.category, status: 'PENDING', components: payload.components }, { submitted: true });
    return { template: present(await findOwn(wabaId, current.template_id, PUBLIC_FIELDS)), name: current.name };
  }

  async function remove({ wabaId, token }, templateId) {
    const current = await findOwn(wabaId, templateId, { _id: 0, template_id: 1, name: 1 });
    if (!current) throw new TemplateApiError(404, 'Template not found', 'TEMPLATE_NOT_FOUND');
    await call(() => axios.delete(graph(`${wabaId}/message_templates`), { params: { name: current.name, hsm_id: current.template_id }, headers: { Authorization: `Bearer ${token}` }, timeout: 20000 }));
    await MetaWhatsappTemplates.deleteOne({ template_id: current.template_id });
    return current;
  }

  // Asks Meta for the current status of templates still in review.
  async function checkPending({ wabaId, token }) {
    const pending = await MetaWhatsappTemplates.find({ waba_id: wabaId, status: { $in: ['PENDING', 'IN_APPEAL'] } }, { _id: 0, template_id: 1, raw_data: 1 }).limit(20).lean();
    let changed = 0;
    for (const t of pending) {
      const { data } = await call(() => axios.get(graph(String(t.template_id)), { params: { fields: TEMPLATE_FIELDS }, headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }));
      if (data?.status && data.status !== 'PENDING') changed += 1;
      await cacheTemplate(wabaId, { ...t.raw_data, ...data, id: t.template_id });
    }
    return { checked: pending.length, changed, templates: await list(wabaId) };
  }

  // Header sample for IMAGE / VIDEO / DOCUMENT: Meta's resumable upload returns a handle.
  async function uploadMedia({ token }, file, formatInput) {
    const format = String(formatInput || '').toUpperCase();
    const rule = MEDIA_TYPES[format];
    if (!rule) throw new TemplateApiError(400, 'Choose an image, video or document header first', 'BAD_FORMAT');
    if (!file) throw new TemplateApiError(400, 'Choose a file to upload', 'NO_FILE');
    if (!rule.mime.includes(file.mimetype)) throw new TemplateApiError(400, `Use ${format === 'IMAGE' ? 'a JPG or PNG image' : format === 'VIDEO' ? 'an MP4 video' : 'a PDF file'}`, 'BAD_FILE');
    if (file.size > rule.max) throw new TemplateApiError(400, `The file is too large (max ${Math.round(rule.max / 1024 / 1024)} MB)`, 'FILE_TOO_LARGE');
    const appId = String(process.env.META_APP_ID || '').trim();
    if (!appId) throw new TemplateApiError(503, 'META_APP_ID is not configured', 'META_APP_ID_MISSING');
    const session = await call(() => axios.post(graph(`${appId}/uploads`), null, {
      params: { file_name: file.originalname.replace(/[^\w.-]/g, '_').slice(0, 100), file_length: file.size, file_type: file.mimetype },
      headers: { Authorization: `Bearer ${token}` }, timeout: 20000,
    }));
    const uploaded = await call(() => axios.post(graph(session.data.id), file.buffer, {
      headers: { Authorization: `OAuth ${token}`, file_offset: '0', 'Content-Type': 'application/octet-stream' },
      maxBodyLength: Infinity, timeout: 120000,
    }));
    const handle = uploaded.data?.h;
    if (!handle) throw new TemplateApiError(502, 'Meta did not return a media handle', 'NO_HANDLE');
    return { handle, file_name: file.originalname, size: file.size };
  }

  return { list, refresh, create, update, remove, checkPending, uploadMedia, findOwn, cacheTemplate };
}

module.exports = { createTemplateApi, replyError, present, upload, reviewTiming, LIST_FIELDS, PUBLIC_FIELDS, MetaCallError, TemplateApiError };
