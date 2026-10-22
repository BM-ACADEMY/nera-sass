/**
 * LeadOS routes: Meta lead-ads webhook and page subscription.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
const { postToN8n } = require('../../services/n8n');
module.exports = function registerWebhookMetaLeadsRoutes(app, ctx) {
const {
  Clients,
  FailedWebhooks,
  Leads,
  NO_ID,
  auth,
  axios: ctxAxios,
  cryptoHelper: ctxCryptoHelper,
  getLeadOSBrand,
  models,
} = ctx;
const axios = ctxAxios || require('axios');
const cryptoHelper = ctxCryptoHelper || require('../../utils/crypto');
const { runAsSystem, runAsTenant } = require('../../services/tenantContext');
// ── META LEADS WEBHOOK ────────────────────────────────────

app.get('/webhook/meta-leads', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) return res.send(challenge);
  res.sendStatus(403);
});

app.post('/webhook/meta-leads', async (req, res) => {
  try {
    const { entry } = req.body || {};
    for (const e of entry || []) {
      for (const change of e.changes || []) {
        if (change.field !== 'leadgen') continue;
        const leadgenId = change.value?.leadgen_id;
        const pageId = String(change.value?.page_id || '');
        if (!pageId || !leadgenId) continue;

        // 1. Lookup dynamic access token and tenant mapping via trusted system context
        const account = await runAsSystem(() => models.BrandSocialAccounts.findOne(
          { $or: [{ facebook_page_id: pageId }, { account_id: pageId }] },
          { access_token: 1, brand_name: 1, tenant_id: 1 }
        ).lean(), 'webhook-meta-leads-account-lookup');

        if (!account || !account.access_token) {
          console.error(`[Meta Leads] No access token found for page_id: ${pageId}. Cannot fetch leadgen_id: ${leadgenId}`);
          await runAsSystem(() => FailedWebhooks.create({
            page_id: pageId, leadgen_id: leadgenId, payload: change.value,
            error_message: 'No access token found for this page in database.'
          }), 'webhook-meta-leads-failed');
          continue;
        }

        let tenantId = account.tenant_id;
        if (!tenantId && account.brand_name) {
          const client = await runAsSystem(() => Clients.findOne(
            { name: account.brand_name },
            { id: 1, tenant_id: 1 }
          ).lean(), 'webhook-meta-leads-client-lookup');
          tenantId = client?.tenant_id;
        }

        if (!tenantId) {
          console.error(`[Meta Leads] No tenant associated with page_id: ${pageId}`);
          await runAsSystem(() => FailedWebhooks.create({
            page_id: pageId, leadgen_id: leadgenId, payload: change.value,
            error_message: 'No tenant found for this page in database.'
          }), 'webhook-meta-leads-failed');
          continue;
        }

        let decryptedToken;
        try {
          decryptedToken = cryptoHelper.decrypt(account.access_token);
        } catch (e) {
          console.error(`[Meta Leads] Failed to decrypt token for page ${pageId}:`, e.message);
          continue;
        }

        // 2. Fetch full lead from Meta
        let metaLead;
        try {
          metaLead = await axios.get(
            `https://graph.facebook.com/v18.0/${leadgenId}`,
            { params: { access_token: decryptedToken } }
          );
        } catch (apiErr) {
          console.error(`[Meta Leads] Graph API Error for leadgen_id ${leadgenId}:`, apiErr.response?.data || apiErr.message);
          await runAsSystem(() => FailedWebhooks.create({
            page_id: pageId, leadgen_id: leadgenId, payload: change.value,
            error_message: apiErr.response?.data ? JSON.stringify(apiErr.response.data) : apiErr.message,
            tenant_id: tenantId,
          }), 'webhook-meta-leads-failed');
          continue;
        }

        const fields = {};
        for (const f of metaLead.data?.field_data || []) {
          fields[f.name] = f.values?.[0];
        }

        const name = fields.full_name || fields.name || 'Unknown';
        const phone = (fields.phone_number || fields.phone || '').replace(/\D/g, '');
        const email = fields.email || null;

        if (!phone) continue;

        // 3. Process lead under the resolved tenant context
        await runAsTenant(tenantId, async () => {
          // Deduplicate using leadgen_id within this tenant
          const existing = await Leads.exists({ leadgen_id: leadgenId });
          if (existing) {
            console.log(`[Meta Leads] Lead ${leadgenId} already exists in tenant ${tenantId}. Skipping.`);
            return;
          }

          const brand = account.brand_name
            ? await Clients.findOne({ name: account.brand_name }, { id: 1 }).lean()
            : await Clients.findOne({}, { id: 1 }).lean();
          const clientId = brand?.id || null;

          // Insert lead properly assigned to client and tenant
          let newLead;
          try {
            newLead = (await Leads.create({
              name, phone, email, source: 'Meta Ads', status: 'new', score: 20, client_id: clientId,
              leadgen_id: leadgenId, created_at: new Date(),
            })).toObject();
          } catch (insertErr) {
            console.error(`[Meta Leads] Error inserting lead: ${insertErr.message}. Attempting update on conflict.`);
            // Fallback if there is a conflict on (phone, client_id)
            newLead = await Leads.findOneAndUpdate(
              { phone, client_id: clientId },
              { $set: { leadgen_id: leadgenId, name, email, source: 'Meta Ads' } },
              { new: true, projection: NO_ID }
            ).lean();
            if (!newLead) return;
          }

          // Trigger n8n webhook for Meta leads to send welcome template
          if (process.env.N8N_NEW_LEAD_WEBHOOK_URL && newLead && process.env.NODE_ENV !== 'test') {
            postToN8n(process.env.N8N_NEW_LEAD_WEBHOOK_URL, {
              lead_id: newLead.id,
              name: newLead.name,
              phone: newLead.phone,
              client_id: newLead.client_id || null,
              tenant_id: tenantId,
            }).catch(e => console.error('[n8n Webhook Error - Meta Lead]', e.message));
          }
        });
      }
    }
    return res.sendStatus(200);
  } catch (err) {
    console.error('Meta leads webhook error:', err.message);
    return res.sendStatus(200);
  }
});

// ── META PAGE SUBSCRIPTION ──────────────────────────────────
app.post('/api/meta/pages/:page_id/subscribe', auth, async (req, res) => {
  try {
    const { page_id } = req.params;
    
    // 1. Lookup dynamic access token
    const accountRows = await models.BrandSocialAccounts.find(
      { $or: [{ facebook_page_id: page_id }, { account_id: page_id }], access_token: { $ne: null } },
      { _id: 0, access_token: 1 }
    ).limit(1).lean();

    if (!accountRows.length) {
      return res.status(404).json({ error: 'Page access token not found in database. Please reconnect the page.' });
    }

    const { access_token } = accountRows[0];
    
    let decryptedToken;
    try {
      decryptedToken = cryptoHelper.decrypt(access_token);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to decrypt access token' });
    }

    // 2. Exchange system user token for Page Access Token
    const pageTokenRes = await axios.get(
      `https://graph.facebook.com/v18.0/${page_id}`,
      { params: { fields: 'access_token', access_token: decryptedToken } }
    );
    
    if (!pageTokenRes.data.access_token) {
      throw new Error("Could not retrieve Page Access Token using the provided token.");
    }
    
    const pageAccessToken = pageTokenRes.data.access_token;

    // 3. Make subscription call to Meta using Page Access Token
    const metaRes = await axios.post(
      `https://graph.facebook.com/v18.0/${page_id}/subscribed_apps`,
      { subscribed_fields: ['leadgen'] },
      { params: { access_token: pageAccessToken } }
    );

    res.json({ success: true, message: 'Successfully subscribed to page webhooks.', meta_response: metaRes.data });
  } catch (err) {
    console.error('[Meta Webhook Subscription Error]:', err.response?.data || err.message);
    res.status(500).json({ 
      error: 'Failed to subscribe to page webhooks', 
      details: err.response?.data || err.message 
    });
  }
});
};
