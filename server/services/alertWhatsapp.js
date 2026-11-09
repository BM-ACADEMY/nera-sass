/**
 * WhatsApp copies of customer notices (plan N4).
 *
 * Rules, all enforced here:
 *   - only to a number the customer opted in for alerts at signup
 *     (tenants.alerts_whatsapp.opted_in);
 *   - only with a Meta-approved UTILITY template for that kind of notice,
 *     looked up in the platform's own WhatsApp Business Account, never a free
 *     text message and never a tenant's template or token;
 *   - sent from the platform's number, with its own credentials.
 *
 *   NERA_ALERT_PHONE_NUMBER_ID   platform number that sends alerts
 *   NERA_ALERT_ACCESS_TOKEN      token allowed to send from it
 *   NERA_ALERT_WABA_ID           the WhatsApp Business Account that owns the templates
 *   NERA_ALERT_TEMPLATE_<TYPE>   template name per notice type, TYPE in
 *                                TEMPLATE_REJECTED, WALLET_LOW, NUMBER_QUALITY,
 *                                SETUP_UNFINISHED, PAYMENT_FAILED
 *   NERA_ALERT_TEMPLATE_LANG     template language (default en)
 *
 * The template takes two body variables: {{1}} workspace name, {{2}} a one-line
 * summary. Nothing is sent when anything is missing; the notice records why.
 * Never throws.
 */
const axios = require('axios');
const { MetaWhatsappTemplates } = require('../models');
const { runAsSystem } = require('./tenantContext');

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';
const read = (name) => String(process.env[name] || '').trim() || null;
const digitsOf = (value) => String(value || '').replace(/\D/g, '');

// Meta rejects newlines, tabs and runs of spaces inside a template variable.
const param = (value, max = 200) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max) || '-';

const templateEnv = (type) => `NERA_ALERT_TEMPLATE_${String(type).toUpperCase()}`;

/** The approved utility template for a notice type in the platform WABA, or null. */
async function approvedTemplate(type) {
  const name = read(templateEnv(type));
  const waba = read('NERA_ALERT_WABA_ID');
  if (!name || !waba) return null;
  const language = read('NERA_ALERT_TEMPLATE_LANG') || 'en';
  const row = await runAsSystem(() => MetaWhatsappTemplates.findOne({ waba_id: waba, name, language }, { _id: 0, status: 1, category: 1 }).lean(), 'alert-whatsapp-template');
  if (!row || String(row.status).toUpperCase() !== 'APPROVED' || String(row.category).toUpperCase() !== 'UTILITY') return null;
  return { name, language };
}

/**
 * Sends one alert. `tenant` is the tenants row. Resolves to
 * { status: 'sent' | 'not_opted_in' | 'not_configured' | 'no_template' | 'failed', wa_msg_id? }.
 */
async function sendAlert({ tenant, type, summary }) {
  const prefs = tenant?.alerts_whatsapp;
  if (!prefs?.opted_in || digitsOf(prefs.number).length < 10) return { status: 'not_opted_in' };
  const phoneNumberId = read('NERA_ALERT_PHONE_NUMBER_ID');
  const token = read('NERA_ALERT_ACCESS_TOKEN');
  if (!phoneNumberId || !token) return { status: 'not_configured' };
  try {
    const template = await approvedTemplate(type);
    if (!template) return { status: 'no_template' };
    const response = await axios.post(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp', recipient_type: 'individual', to: digitsOf(prefs.number), type: 'template',
        template: {
          name: template.name, language: { code: template.language },
          components: [{ type: 'body', parameters: [{ type: 'text', text: param(tenant.name, 60) }, { type: 'text', text: param(summary) }] }],
        },
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 15000 },
    );
    return { status: 'sent', wa_msg_id: response.data?.messages?.[0]?.id || null };
  } catch (error) {
    console.error(`[alertWhatsapp] ${type} not sent: ${error.response?.data?.error?.code || error.message}`);
    return { status: 'failed' };
  }
}

module.exports = { templateEnv, approvedTemplate, sendAlert, param };
