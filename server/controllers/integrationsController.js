const db = require('../db/connection');
const cryptoHelper = require('../utils/crypto');
const axios = require('axios');
const { evaluateLeadBrandAndSchedule } = require('../services/aiBrain');
const { getLeadOSBrand } = require('../services/leadosBrand');

const META_NEW_LEAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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
    const checkQuery = `
      SELECT id FROM brand_social_accounts
      WHERE brand_name = $1 AND platform = $2 AND account_name = $3
    `;
    const checkRes = await db.query(checkQuery, [brand_name, platform, account_name]);

    let result;
    if (checkRes.rows.length > 0) {
      // Update existing
      const updateQuery = `
        UPDATE brand_social_accounts SET
          account_id = $1, facebook_page_id = $2, instagram_business_id = $3,
          lead_ads_access_token = $4, token_expires_at = $5, is_active = true
        WHERE id = $6
        RETURNING *;
      `;
      const updateRes = await db.query(updateQuery, [
        account_id, facebook_page_id, instagram_business_id, encryptedToken, expiry, checkRes.rows[0].id
      ]);
      result = updateRes.rows[0];
    } else {
      // Because there's a bad unique constraint on just (brand_name, platform), let's see if we hit it.
      // We will try an insert, and if it fails, we will fall back to updating based on just (brand_name, platform)
      try {
        const insertQuery = `
          INSERT INTO brand_social_accounts
            (brand_name, platform, account_name, account_id, facebook_page_id, instagram_business_id, lead_ads_access_token, token_expires_at, is_active)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
          RETURNING *;
        `;
        const insertRes = await db.query(insertQuery, [
          brand_name, platform, account_name, account_id, facebook_page_id, instagram_business_id, encryptedToken, expiry
        ]);
        result = insertRes.rows[0];
      } catch (insertErr) {
        if (insertErr.code === '23505') {
          // Fallback update on the existing duplicate if the constraint is blocking us
          const fallbackQuery = `
            UPDATE brand_social_accounts SET
              account_name = $1, account_id = $2, facebook_page_id = $3,
              instagram_business_id = $4, lead_ads_access_token = $5, token_expires_at = $6, is_active = true
            WHERE brand_name = $7 AND platform = $8
            RETURNING *;
          `;
          const fallbackRes = await db.query(fallbackQuery, [
            account_name, account_id, facebook_page_id, instagram_business_id, encryptedToken, expiry, brand_name, platform
          ]);
          result = fallbackRes.rows[0];
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
    await db.query('DELETE FROM brand_social_accounts WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || 'leados_secret_webhook_token';

async function verifyMetaWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
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
            const { rows } = await db.query(`
              SELECT lead_ads_access_token, brand_name, c.id as client_id
              FROM brand_social_accounts bsa
              LEFT JOIN clients c ON bsa.brand_name = c.name
              WHERE bsa.facebook_page_id = $1 AND bsa.is_active = true LIMIT 1
            `, [pageId]);

            if (rows.length === 0) continue;

            const masterTokenEncrypted = rows[0].lead_ads_access_token;
            const masterToken = cryptoHelper.decrypt(masterTokenEncrypted);
            const clientId = (await getLeadOSBrand(db)).id;
            
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
            const existingByPhone = phone ? await db.query('SELECT id FROM leads WHERE phone = $1', [phone]) : { rows: [] };
            if (existingByPhone.rows.length > 0) {
              await db.query(`
                UPDATE leads SET leadgen_id = $1, meta_lead_id = $1,
                  lead_ad_form_id = $2, campaign_id = $3, campaign_name = $4, ad_name = $5, ad_id = $6
                WHERE id = $7
              `, [leadgenId, formIdStr, campaignIdStr, campaignNameStr, adNameStr, adIdStr, existingByPhone.rows[0].id]);
              console.log(`Updated existing lead ${existingByPhone.rows[0].id} with latest Meta touch ${leadgenId}`);
            } else {
              await db.query(`
                INSERT INTO leads (name, phone, email, source, status, score, client_id, leadgen_id, meta_lead_id, lead_ad_form_id, campaign_id, campaign_name, ad_name, ad_id)
                VALUES ($1, $2, $3, 'facebook', 'new', 10, $4, $5, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (leadgen_id) DO UPDATE SET
                    status = COALESCE(NULLIF(TRIM(leads.status), ''), 'new'),
                    lead_ad_form_id = COALESCE(EXCLUDED.lead_ad_form_id, leads.lead_ad_form_id),
                    campaign_id = COALESCE(EXCLUDED.campaign_id, leads.campaign_id),
                    campaign_name = COALESCE(EXCLUDED.campaign_name, leads.campaign_name),
                    ad_name = COALESCE(EXCLUDED.ad_name, leads.ad_name),
                    ad_id = COALESCE(EXCLUDED.ad_id, leads.ad_id)
              `, [name || 'FB Lead', phone, email, clientId, leadgenId, formIdStr, campaignIdStr, campaignNameStr, adNameStr, adIdStr]);
            }

            const newLead = await db.query('SELECT id FROM leads WHERE leadgen_id = $1', [leadgenId]);
            if(newLead.rows.length) { evaluateLeadBrandAndSchedule(newLead.rows[0].id).catch(console.error); }
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
    const { rows } = await db.query(`
      SELECT bsa.*, c.id as client_id 
      FROM brand_social_accounts bsa
      LEFT JOIN clients c ON bsa.brand_name = c.name 
      WHERE bsa.id = $1
    `, [account_id]);
    
    if (rows.length === 0) return res.status(404).json({ error: 'Account not found' });
    
    const acc = rows[0];
    const pageId = acc.facebook_page_id;
    if (!pageId) return res.status(400).json({ error: 'Not a Facebook Page' });

    const masterToken = cryptoHelper.decrypt(acc.lead_ads_access_token);
    const clientId = (await getLeadOSBrand(db)).id;
    
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
        const checkRes = await db.query('SELECT id, campaign_id FROM leads WHERE leadgen_id = $1', [leadgenId]);
        const exists = checkRes.rows.length > 0;

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
           const pcRes = await db.query('SELECT id FROM leads WHERE phone = $1', [phone]);
           if (pcRes.rows.length > 0) {
              await db.query(
                `UPDATE leads SET leadgen_id = $1, meta_lead_id = $1,
                  status = COALESCE(NULLIF(TRIM(status), ''), $2),
                  lead_ad_form_id = $3,
                  campaign_id = $4,
                  campaign_name = $5,
                  ad_name = $6,
                  ad_id = $7
                WHERE id = $8`,
                [leadgenId, syncedStatus, formIdStr, campaignIdStr, campaignNameStr, adNameStr, adIdStr, pcRes.rows[0].id]
              );
              await db.query('UPDATE leads SET client_id=$1, updated_at=NOW() WHERE id=$2', [clientId, pcRes.rows[0].id]);
              totalSynced++;
              continue;
           }
        }

        try {
          await db.query(`
            INSERT INTO leads (name, phone, email, source, status, score, client_id, leadgen_id, meta_lead_id, created_at, lead_ad_form_id, campaign_id, campaign_name, ad_name, ad_id)
            VALUES ($1, $2, $3, 'facebook', $4, 10, $5, $6, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (leadgen_id) DO UPDATE SET 
                  status = COALESCE(NULLIF(TRIM(leads.status), ''), EXCLUDED.status),
                  lead_ad_form_id = COALESCE(EXCLUDED.lead_ad_form_id, leads.lead_ad_form_id),
                  campaign_id = COALESCE(EXCLUDED.campaign_id, leads.campaign_id),
                  campaign_name = COALESCE(EXCLUDED.campaign_name, leads.campaign_name),
                  ad_name = COALESCE(EXCLUDED.ad_name, leads.ad_name),
                  ad_id = COALESCE(EXCLUDED.ad_id, leads.ad_id)
          `, [name || 'FB Lead', phone, email, syncedStatus, clientId, leadgenId, new Date(leadData.created_time || Date.now()), formIdStr, campaignIdStr, campaignNameStr, adNameStr, adIdStr]);
          totalSynced++;
          if (!exists) {
            const newLead = await db.query('SELECT id FROM leads WHERE leadgen_id = $1', [leadgenId]); 
            if(newLead.rows.length) { evaluateLeadBrandAndSchedule(newLead.rows[0].id).catch(console.error); }
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
    const { rows } = await db.query(`
      SELECT bsa.*, c.id as client_id 
      FROM brand_social_accounts bsa
      LEFT JOIN clients c ON bsa.brand_name = c.name 
      WHERE bsa.platform = 'facebook' AND bsa.is_active = true AND bsa.facebook_page_id IS NOT NULL
    `);
    
    // Respond immediately to the frontend to prevent timeouts
    res.json({ success: true, message: 'Sync started in background. It may take a minute.' });
    
    // Run the syncing loop in the background
    (async () => {
      let totalSynced = 0;
      for (const acc of rows) {
        const pageId = acc.facebook_page_id;
        const masterToken = cryptoHelper.decrypt(acc.lead_ads_access_token);
        const clientId = (await getLeadOSBrand(db)).id;
        
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
              const checkRes = await db.query('SELECT id FROM leads WHERE leadgen_id = $1', [leadgenId]);
              const exists = checkRes.rows.length > 0;

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
                 const pcRes = await db.query('SELECT id FROM leads WHERE phone = $1', [phone]);
                 if (pcRes.rows.length > 0) {
                    await db.query(
                      `UPDATE leads SET leadgen_id = $1, meta_lead_id = $1,
                        status = COALESCE(NULLIF(TRIM(status), ''), $2),
                        lead_ad_form_id = $3,
                        campaign_id = $4,
                        campaign_name = $5,
                        ad_name = $6,
                        ad_id = $7
                      WHERE id = $8`,
                      [leadgenId, syncedStatus, formIdStr, campaignIdStr, campaignNameStr, adNameStr, adIdStr, pcRes.rows[0].id]
                    );
                    totalSynced++;
                    continue;
                 }
              }

              if (phone) {
                try {
                  await db.query(`
                    INSERT INTO leads (name, phone, email, source, status, score, client_id, leadgen_id, meta_lead_id, created_at, lead_ad_form_id, campaign_id, campaign_name, ad_name, ad_id)
                    VALUES ($1, $2, $3, 'facebook', $4, 10, $5, $6, $6, $7, $8, $9, $10, $11, $12)
                    ON CONFLICT (leadgen_id) DO UPDATE SET 
                      status = COALESCE(NULLIF(TRIM(leads.status), ''), EXCLUDED.status),
                      lead_ad_form_id = COALESCE(EXCLUDED.lead_ad_form_id, leads.lead_ad_form_id),
                      campaign_id = COALESCE(EXCLUDED.campaign_id, leads.campaign_id),
                      campaign_name = COALESCE(EXCLUDED.campaign_name, leads.campaign_name),
                      ad_name = COALESCE(EXCLUDED.ad_name, leads.ad_name),
                      ad_id = COALESCE(EXCLUDED.ad_id, leads.ad_id)
                  `, [name || 'FB Lead', phone, email, syncedStatus, clientId, leadgenId, new Date(leadData.created_time || Date.now()), formIdStr, campaignIdStr, campaignNameStr, adNameStr, adIdStr]);
                  totalSynced++;
                  if (!exists) {
                    const newLead = await db.query('SELECT id FROM leads WHERE leadgen_id = $1', [leadgenId]); 
                    if(newLead.rows.length) { evaluateLeadBrandAndSchedule(newLead.rows[0].id).catch(console.error); }
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
