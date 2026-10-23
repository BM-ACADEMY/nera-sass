const { BrandSocialAccounts, Clients, Leads } = require('../models');
const cryptoHelper = require('../utils/crypto');
const axios = require('axios');
const { evaluateLeadBrandAndSchedule } = require('../services/aiBrain');
const { getLeadOSBrand } = require('../services/leadosBrand');

const META_NEW_LEAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const META_CAMPAIGN_FIELDS = ['lead_ad_form_id', 'campaign_id', 'campaign_name', 'ad_name', 'ad_id'];
const hasStatus = (status) => typeof status === 'string' && status.trim() !== '';

// INSERT INTO leads ... ON CONFLICT (leadgen_id) DO UPDATE: keeps a non-blank stored
// status and only overwrites the campaign fields with non-null incoming values.
async function upsertMetaLead(doc) {
  const existing = await Leads.findOne({ leadgen_id: doc.leadgen_id }).lean();
  if (!existing) return Leads.create(doc);
  const set = { status: hasStatus(existing.status) ? existing.status : doc.status };
  for (const field of META_CAMPAIGN_FIELDS) set[field] = doc[field] ?? existing[field] ?? null;
  return Leads.updateOne({ id: existing.id }, { $set: set });
}

// Page accounts joined with the client that shares their brand name (LEFT JOIN clients).
async function withClientIds(accounts) {
  const clients = await Clients.find({ name: { $in: accounts.map((a) => a.brand_name) } }, { id: 1, name: 1 }).lean();
  return accounts.map((account) => ({ ...account, client_id: clients.find((c) => c.name === account.brand_name)?.id ?? null }));
}

const getMetaLeadStatus = (createdTime) => {
  const createdAt = createdTime ? new Date(createdTime) : new Date();
  if (Number.isNaN(createdAt.getTime())) return 'new';
  return Date.now() - createdAt.getTime() <= META_NEW_LEAD_MAX_AGE_MS ? 'new' : 'cold';
};

async function linkMetaAccount(req, res) {
  const { brand_name, platform, account_name, account_id, facebook_page_id, instagram_business_id, access_token } = req.body;

  if (!brand_name || !platform || !access_token) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  try {
    const encryptedToken = cryptoHelper.encrypt(access_token);
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 60);

    // lead_ads_access_token is a dedicated column separate from access_token, which Content OS's
    // own Facebook connect flow (contentController.js) also writes to on this same table. Keeping
    // them separate means reconnecting a page in Content OS can never break Lead Ads sync, and vice versa.
    const existingAccount = await BrandSocialAccounts.findOne({ brand_name, platform, account_name }, { id: 1 }).lean();

    let result;
    if (existingAccount) {
      // Update existing
      result = await BrandSocialAccounts.findOneAndUpdate(
        { id: existingAccount.id },
        { $set: {
          account_id, facebook_page_id, instagram_business_id,
          lead_ads_access_token: encryptedToken, token_expires_at: expiry, is_active: true,
        } },
        { new: true, projection: { _id: 0 } }
      ).lean();
    } else {
      // Because there's a bad unique constraint on just (brand_name, platform), let's see if we hit it.
      // We will try an insert, and if it fails, we will fall back to updating based on just (brand_name, platform)
      try {
        result = (await BrandSocialAccounts.create({
          brand_name, platform, account_name, account_id, facebook_page_id, instagram_business_id,
          lead_ads_access_token: encryptedToken, token_expires_at: expiry, is_active: true,
        })).toObject();
      } catch (insertErr) {
        if (insertErr.code === 11000) {
          // Fallback update on the existing duplicate if the constraint is blocking us
          await BrandSocialAccounts.updateMany(
            { brand_name, platform },
            { $set: {
              account_name, account_id, facebook_page_id, instagram_business_id,
              lead_ads_access_token: encryptedToken, token_expires_at: expiry, is_active: true,
            } }
          );
          result = await BrandSocialAccounts.findOne({ brand_name, platform }, { _id: 0 }).lean();
        } else {
          throw insertErr;
        }
      }
    }

    // Auto-Subscribe to Meta Leads Webhook
    if (platform === 'facebook' && (facebook_page_id || account_id)) {
      const pageIdToSubscribe = facebook_page_id || account_id;
      try {
        const pageTokenRes = await axios.get(
          `https://graph.facebook.com/v18.0/${pageIdToSubscribe}`,
          { params: { fields: 'access_token', access_token: access_token } }
        );
        const pageAccessToken = pageTokenRes.data.access_token;
        if (pageAccessToken) {
          await axios.post(
            `https://graph.facebook.com/v18.0/${pageIdToSubscribe}/subscribed_apps`,
            { subscribed_fields: ['leadgen'] },
            { params: { access_token: pageAccessToken } }
          );
        }
      } catch (subErr) {
        console.error(`[Meta Webhook] Failed to auto-subscribe page ${pageIdToSubscribe}:`, subErr.response?.data || subErr.message);
      }
    }

    res.json({ success: true, account: result });
  } catch (err) {
    console.error('Link brand account error:', err);
    res.status(500).json({ success: false, error: 'Database saving failed: ' + err.message });
  }
}

async function deleteMetaAccount(req, res) {
  try {
    const { id } = req.params;
    await BrandSocialAccounts.deleteOne({ id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function verifyMetaWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

  if (mode && token) {
    if (mode === 'subscribe' && verifyToken && token === verifyToken) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
}

async function handleMetaWebhook(req, res) {
  const body = req.body;
  if (body.object === 'page') {
    for (const entry of body.entry) {
      const pageId = entry.id;
      for (const change of entry.changes) {
        if (change.field === 'leadgen') {
          const leadgenId = change.value.leadgen_id;
          
          try {
            const pageAccount = await BrandSocialAccounts.findOne({ facebook_page_id: pageId, is_active: true }, { lead_ads_access_token: 1, brand_name: 1 }).lean();
            const rows = pageAccount ? await withClientIds([pageAccount]) : [];

            if (rows.length === 0) continue;

            const masterTokenEncrypted = rows[0].lead_ads_access_token;
            const masterToken = cryptoHelper.decrypt(masterTokenEncrypted);
            const clientId = (await getLeadOSBrand()).id;

            const pageTokenRes = await axios.get(
              `https://graph.facebook.com/v18.0/${pageId}?fields=access_token&access_token=${masterToken}`
            );
            const pageToken = pageTokenRes.data.access_token;

            const leadRes = await axios.get(
              `https://graph.facebook.com/v18.0/${leadgenId}?fields=created_time,id,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data`,
              { params: { access_token: pageToken } }
            );
            
            const leadData = leadRes.data;
            let email = '', phone = '', name = '';
            
            if (leadData.field_data) {
              for (const field of leadData.field_data) {
                if (field.name.includes('email')) email = field.values[0];
                if (field.name.includes('phone') || field.name === 'contact_number') phone = field.values[0];
                if (field.name.includes('name')) name = field.values[0];
              }
            }
            
            if (phone.startsWith('+')) phone = phone.substring(1);
            if (phone.startsWith('0')) phone = phone.substring(1);
            if (!phone.startsWith('91') && phone.length === 10) phone = '91' + phone;

            const formIdStr = leadData.form_id || null;
            const campaignIdStr = leadData.campaign_id || null;
            const campaignNameStr = leadData.campaign_name || null;
            const adNameStr = leadData.ad_name || null;
            const adIdStr = leadData.ad_id || null;

            // The leads table enforces one row per phone number per tenant (idx_leads_phone_tenant),
            // regardless of which brand/client the lead is attached to. A raw INSERT can collide with
            // an existing lead for that phone under a different client, so check by phone first and
            // update that row with the latest touch instead of letting the insert fail silently.
            const existingByPhone = phone ? await Leads.findOne({ phone }, { id: 1 }).lean() : null;
            if (existingByPhone) {
              await Leads.updateOne({ id: existingByPhone.id }, { $set: {
                leadgen_id: leadgenId, meta_lead_id: leadgenId,
                lead_ad_form_id: formIdStr, campaign_id: campaignIdStr, campaign_name: campaignNameStr, ad_name: adNameStr, ad_id: adIdStr,
              } });
              console.log(`Updated existing lead ${existingByPhone.id} with latest Meta touch ${leadgenId}`);
            } else {
              await upsertMetaLead({
                name: name || 'FB Lead', phone, email, source: 'facebook', status: 'new', score: 10, client_id: clientId,
                leadgen_id: leadgenId, meta_lead_id: leadgenId, lead_ad_form_id: formIdStr, campaign_id: campaignIdStr,
                campaign_name: campaignNameStr, ad_name: adNameStr, ad_id: adIdStr,
              });
            }

            const newLead = await Leads.findOne({ leadgen_id: leadgenId }, { id: 1 }).lean();
            if(newLead) { evaluateLeadBrandAndSchedule(newLead.id).catch(console.error); }
            console.log(`Successfully saved Meta lead ${leadgenId}`);
          } catch (err) {
            console.error('Error processing webhook lead:', err.response?.data || err.message);
          }
        }
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
}

async function syncHistoricalLeads(req, res) {
  const { account_id } = req.body; 
  try {
    const account = await BrandSocialAccounts.findOne({ id: account_id }, { _id: 0 }).lean();
    const rows = account ? await withClientIds([account]) : [];
    
    if (rows.length === 0) return res.status(404).json({ error: 'Account not found' });
    
    const acc = rows[0];
    const pageId = acc.facebook_page_id;
    if (!pageId) return res.status(400).json({ error: 'Not a Facebook Page' });

    const masterToken = cryptoHelper.decrypt(acc.lead_ads_access_token);
    const clientId = (await getLeadOSBrand()).id;
    
    const pageTokenRes = await axios.get(
      `https://graph.facebook.com/v18.0/${pageId}?fields=access_token&access_token=${masterToken}`
    );
    const pageToken = pageTokenRes.data.access_token;
    
    const formsRes = await axios.get(
      `https://graph.facebook.com/v18.0/${pageId}/leadgen_forms`,
      { params: { access_token: pageToken } }
    );
    
    let totalSynced = 0;
    
    for (const form of formsRes.data.data) {
      const formId = form.id;
      const leadsRes = await axios.get(
        `https://graph.facebook.com/v18.0/${formId}/leads`,
        { params: { access_token: pageToken, limit: 100, fields: 'created_time,id,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data' } }
      );
      
      const leads = leadsRes.data.data || [];
      for (const leadData of leads) {
        const leadgenId = leadData.id;
        
        // We still want to update existing leads with new campaign details if they are missing
        const exists = Boolean(await Leads.exists({ leadgen_id: leadgenId }));

        let email = '', phone = '', name = '';
        if (leadData.field_data) {
          for (const field of leadData.field_data) {
            if (field.name.includes('email')) email = field.values[0];
            if (field.name.includes('phone') || field.name === 'contact_number') phone = field.values[0];
            if (field.name.includes('name')) name = field.values[0];
          }
        }
        
        if (phone.startsWith('+')) phone = phone.substring(1);
        if (phone.startsWith('0')) phone = phone.substring(1);
        if (!phone.startsWith('91') && phone.length === 10) phone = '91' + phone;

        const formIdStr = leadData.form_id || formId;
        const campaignIdStr = leadData.campaign_id || null;
        const campaignNameStr = leadData.campaign_name || null;
        const adNameStr = leadData.ad_name || null;
        const adIdStr = leadData.ad_id || null;
        const syncedStatus = getMetaLeadStatus(leadData.created_time);

        // The leads table enforces one row per phone number per tenant (idx_leads_phone_tenant),
        // regardless of client_id, so match by phone alone and refresh with the latest touch —
        // otherwise leads for a phone already attached to a different client get silently dropped.
        if (phone) {
           const phoneLead = await Leads.findOne({ phone }, { id: 1, status: 1 }).lean();
           if (phoneLead) {
              await Leads.updateOne({ id: phoneLead.id }, { $set: {
                leadgen_id: leadgenId, meta_lead_id: leadgenId,
                status: hasStatus(phoneLead.status) ? phoneLead.status : syncedStatus,
                lead_ad_form_id: formIdStr, campaign_id: campaignIdStr, campaign_name: campaignNameStr, ad_name: adNameStr, ad_id: adIdStr,
              } });
              await Leads.updateOne({ id: phoneLead.id }, { $set: { client_id: clientId, updated_at: new Date() } });
              totalSynced++;
              continue;
           }
        }

        try {
          await upsertMetaLead({
            name: name || 'FB Lead', phone, email, source: 'facebook', status: syncedStatus, score: 10, client_id: clientId,
            leadgen_id: leadgenId, meta_lead_id: leadgenId, created_at: new Date(leadData.created_time || Date.now()),
            lead_ad_form_id: formIdStr, campaign_id: campaignIdStr, campaign_name: campaignNameStr, ad_name: adNameStr, ad_id: adIdStr,
          });
          totalSynced++;
          if (!exists) {
            const newLead = await Leads.findOne({ leadgen_id: leadgenId }, { id: 1 }).lean();
            if(newLead) { evaluateLeadBrandAndSchedule(newLead.id).catch(console.error); }
          }

        } catch(e) {
          console.error("Insert error for lead", leadgenId, e.message);
        }
      }
    }
    
    res.json({ success: true, synced: totalSynced });
  } catch (err) {
    console.error('Error syncing leads:', err.response?.data || err.message);
    res.status(500).json({ success: false, error: 'Failed to sync leads: ' + err.message });
  }
}

async function syncAllHistoricalLeads(req, res) {
  try {
    const rows = await withClientIds(await BrandSocialAccounts.find(
      { platform: 'facebook', is_active: true, facebook_page_id: { $ne: null } },
      { _id: 0 }
    ).lean());
    
    // Respond immediately to the frontend to prevent timeouts
    res.json({ success: true, message: 'Sync started in background. It may take a minute.' });
    
    // Run the syncing loop in the background
    (async () => {
      let totalSynced = 0;
      for (const acc of rows) {
        const pageId = acc.facebook_page_id;
        const masterToken = cryptoHelper.decrypt(acc.lead_ads_access_token);
        const clientId = (await getLeadOSBrand()).id;

        try {
          const pageTokenRes = await axios.get(
            `https://graph.facebook.com/v18.0/${pageId}?fields=access_token&access_token=${masterToken}`
          );
          const pageToken = pageTokenRes.data.access_token;
          
          const formsRes = await axios.get(
            `https://graph.facebook.com/v18.0/${pageId}/leadgen_forms`,
            { params: { access_token: pageToken } }
          );
          
          for (const form of formsRes.data.data) {
            const formId = form.id;
            const leadsRes = await axios.get(
              `https://graph.facebook.com/v18.0/${formId}/leads`,
              { params: { access_token: pageToken, limit: 100, fields: 'created_time,id,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data' } }
            );
            
            const leads = leadsRes.data.data || [];
            for (const leadData of leads) {
              const leadgenId = leadData.id;
              
              // Update if exists instead of skip
              const exists = Boolean(await Leads.exists({ leadgen_id: leadgenId }));

              let email = '', phone = '', name = '';
              if (leadData.field_data) {
                for (const field of leadData.field_data) {
                  if (field.name.includes('email')) email = field.values[0];
                  if (field.name.includes('phone') || field.name === 'contact_number') phone = field.values[0];
                  if (field.name.includes('name')) name = field.values[0];
                }
              }
              
              if (phone.startsWith('+')) phone = phone.substring(1);
              if (phone.startsWith('0')) phone = phone.substring(1);
              if (!phone.startsWith('91') && phone.length === 10) phone = '91' + phone;
              
              // Truncate to fit database constraints
              if (phone.length > 20) phone = phone.substring(0, 20);

              const formIdStr = leadData.form_id || formId;
              const campaignIdStr = leadData.campaign_id || null;
              const campaignNameStr = leadData.campaign_name || null;
              const adNameStr = leadData.ad_name || null;
              const adIdStr = leadData.ad_id || null;
              const syncedStatus = getMetaLeadStatus(leadData.created_time);

              if (phone) {
                 // idx_leads_phone_tenant is unique on (phone, tenant_id), not per-client, so match by
                 // phone alone and refresh with the latest touch instead of dropping the insert on conflict.
                 const phoneLead = await Leads.findOne({ phone }, { id: 1, status: 1 }).lean();
                 if (phoneLead) {
                    await Leads.updateOne({ id: phoneLead.id }, { $set: {
                      leadgen_id: leadgenId, meta_lead_id: leadgenId,
                      status: hasStatus(phoneLead.status) ? phoneLead.status : syncedStatus,
                      lead_ad_form_id: formIdStr, campaign_id: campaignIdStr, campaign_name: campaignNameStr, ad_name: adNameStr, ad_id: adIdStr,
                    } });
                    totalSynced++;
                    continue;
                 }
              }

              if (phone) {
                try {
                  await upsertMetaLead({
                    name: name || 'FB Lead', phone, email, source: 'facebook', status: syncedStatus, score: 10, client_id: clientId,
                    leadgen_id: leadgenId, meta_lead_id: leadgenId, created_at: new Date(leadData.created_time || Date.now()),
                    lead_ad_form_id: formIdStr, campaign_id: campaignIdStr, campaign_name: campaignNameStr, ad_name: adNameStr, ad_id: adIdStr,
                  });
                  totalSynced++;
                  if (!exists) {
                    const newLead = await Leads.findOne({ leadgen_id: leadgenId }, { id: 1 }).lean();
                    if(newLead) { evaluateLeadBrandAndSchedule(newLead.id).catch(console.error); }
                  }
                } catch(e) {
                  console.error("Insert error for lead", leadgenId, e.message);
                }
              }
            }
          }
        } catch (err) {
          console.error(`Error syncing page ${pageId}:`, err.response?.data || err.message);
        }
      }
      console.log('Background sync completed. Total synced:', totalSynced);
    })();
    
  } catch (err) {
    console.error('Error syncing all leads:', err.message);
    res.status(500).json({ success: false, error: 'Failed to initiate sync: ' + err.message });
  }
}

module.exports = {
  linkMetaAccount,
  deleteMetaAccount,
  verifyMetaWebhook,
  handleMetaWebhook,
  syncHistoricalLeads,
  syncAllHistoricalLeads
};
