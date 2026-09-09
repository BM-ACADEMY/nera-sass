const axios = require('axios');
const db = require('../db/connection');
const ensureAllianceSchema = require('../db/alliance-schema');

let interval;
let followupInterval;
let processing = false;
let followupProcessing = false;

const APPROVED_CONSENT_SOURCES = new Set(['website_form', 'click_to_whatsapp_ad', 'qr_code_optin', 'inbound_whatsapp_optin', 'event_registration', 'customer_request', 'written_consent']);
const APPROVED_CONSENT_SCOPES = new Set(['marketing', 'service', 'both']);
const NON_CONSENT_SOURCE_PATTERN = /(scrap|purchas|directory|research)/i;

const tokenFor = (settings) => process.env[settings?.access_token_env || 'ALLIANCE_WA_ACCESS_TOKEN'];
const valueFor = (field, prospect) => {
  const customFields = typeof prospect.custom_fields === 'string'
    ? JSON.parse(prospect.custom_fields || '{}')
    : (prospect.custom_fields || {});
  const resolved = prospect[field] ?? customFields[field] ?? (field === 'name' ? prospect.business_name : null);
  return resolved === null || resolved === undefined || resolved === '' ? 'there' : String(resolved);
};

const phoneValidationReason = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(digits)) return 'invalid_e164_phone_format';
  if (digits.startsWith('91') && !/^91[6-9]\d{9}$/.test(digits)) {
    return 'invalid_india_mobile_format_expected_91_plus_10_digits_starting_6_to_9';
  }
  return null;
};

async function claimRecipient() {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `WITH policy AS (SELECT custom_limit FROM alliance_bulk_send_limits WHERE channel='whatsapp' AND limit_mode='custom'),
       sent AS (SELECT campaign_id,COUNT(*)::int AS total FROM alliance_whatsapp_campaign_recipients WHERE status IN ('sent','delivered','read') GROUP BY campaign_id),
       ranked AS (SELECT r.id,r.campaign_id,ROW_NUMBER() OVER (PARTITION BY r.campaign_id ORDER BY r.scheduled_at,r.id) AS position
                  FROM alliance_whatsapp_campaign_recipients r WHERE r.status='queued'),
       limits AS (SELECT q.id,q.position,p.custom_limit,COALESCE(s.total,0) AS sent_total
                  FROM ranked q CROSS JOIN policy p LEFT JOIN sent s ON s.campaign_id=q.campaign_id)
       UPDATE alliance_whatsapp_campaign_recipients r SET status='cancelled',error_message='bulk_send_limit_reached'
       FROM limits allowed WHERE r.id=allowed.id AND allowed.position>GREATEST(allowed.custom_limit-allowed.sent_total,0)`
    );
    const result = await client.query(
      `SELECT r.id,r.campaign_id,r.prospect_id,c.template_name,c.template_language,c.template_body,c.parameter_mapping,t.buttons AS template_buttons,
              c.phone_number_id,c.name AS campaign_name,c.created_at AS campaign_created_at,c.followup_template_id,c.followup_delay_days,c.followup_delay_minutes,p.name,p.business_name,p.location,p.phone,p.status AS prospect_status,
              p.email,p.audience,p.industry,p.source,p.channel,p.channel_pref,p.ai_score,p.created_at,p.custom_fields,p.status,p.consent,p.consent_source,p.consent_at,p.consent_evidence,p.consent_scope,p.suppressed,s.access_token_env,s.active AS sender_active,
              cv.last_inbound_at
       FROM alliance_whatsapp_campaign_recipients r
       JOIN alliance_whatsapp_campaigns c ON c.id=r.campaign_id
       LEFT JOIN templates t ON t.id=c.template_id
       JOIN alliance_prospects p ON p.id=r.prospect_id
       LEFT JOIN alliance_inbox_settings s ON s.phone_number_id=c.phone_number_id
       LEFT JOIN alliance_inbox_contacts ic ON ic.prospect_id=p.id
       LEFT JOIN alliance_inbox_conversations cv ON cv.contact_id=ic.id
       WHERE r.status='queued' AND r.scheduled_at<=NOW() AND c.status IN ('scheduled','running')
       ORDER BY r.scheduled_at,r.id FOR UPDATE OF r SKIP LOCKED LIMIT 1`
    );
    if (!result.rowCount) { await client.query('COMMIT'); return null; }
    const row = result.rows[0];
    const reason = !row.phone ? 'missing_phone' : phoneValidationReason(row.phone) || (!row.consent ? 'whatsapp_consent_missing'
      : !APPROVED_CONSENT_SOURCES.has(String(row.consent_source || '').toLowerCase()) ? 'whatsapp_consent_source_not_approved'
        : !row.consent_at ? 'whatsapp_consent_timestamp_missing'
          : !String(row.consent_evidence || '').trim() ? 'whatsapp_consent_evidence_missing'
            : !APPROVED_CONSENT_SCOPES.has(String(row.consent_scope || '').toLowerCase()) ? 'whatsapp_consent_scope_invalid'
              : NON_CONSENT_SOURCE_PATTERN.test(String(row.source || '')) ? 'whatsapp_consent_disallowed_for_scraped_purchased_directory_or_researched_source'
      : row.suppressed ? 'suppressed' : ['converted','closed','complete','completed','not_interested','unsubscribed'].includes(row.prospect_status) ? `prospect_${row.prospect_status}`
        : row.last_inbound_at && new Date(row.last_inbound_at) >= new Date(row.campaign_created_at) ? 'recipient_replied'
          : row.sender_active === false ? 'sender_inactive' : null);
    if (reason) {
      await client.query(`UPDATE alliance_whatsapp_campaign_recipients SET status='skipped',error_message=$1 WHERE id=$2`, [reason,row.id]);
      await client.query('COMMIT'); return { skipped:true };
    }
    await client.query(`UPDATE alliance_whatsapp_campaign_recipients SET status='sending',error_message=NULL WHERE id=$1`, [row.id]);
    await client.query(`UPDATE alliance_whatsapp_campaigns SET status='running',started_at=COALESCE(started_at,NOW()),updated_at=NOW() WHERE id=$1`, [row.campaign_id]);
    await client.query('COMMIT'); return row;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function storeInboxMessageUnsafe(job, waMessageId, rendered) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    let contact = await client.query(
      `SELECT id FROM alliance_inbox_contacts
       WHERE prospect_id=$1
       ORDER BY id LIMIT 1 FOR UPDATE`,
      [job.prospect_id]
    );
    if (!contact.rowCount) {
      contact = await client.query(
        `SELECT id FROM alliance_inbox_contacts
         WHERE wa_id=$1 OR phone=$1
         ORDER BY id LIMIT 1 FOR UPDATE`,
        [job.phone]
      );
    }
    if (contact.rowCount) {
      contact = await client.query(
        `UPDATE alliance_inbox_contacts c
         SET name=COALESCE($2,c.name),
             prospect_id=COALESCE(c.prospect_id,$3),
             phone=CASE WHEN NOT EXISTS (
               SELECT 1 FROM alliance_inbox_contacts other WHERE other.id<>c.id AND other.phone=$1
             ) THEN $1 ELSE c.phone END,
             wa_id=CASE WHEN NOT EXISTS (
               SELECT 1 FROM alliance_inbox_contacts other WHERE other.id<>c.id AND other.wa_id=$1
             ) THEN $1 ELSE c.wa_id END,
             source='alliance_bulk',
             custom_fields=COALESCE(c.custom_fields,'{}'::jsonb) || jsonb_build_object('business_name',$4::text),
             updated_at=NOW()
         WHERE c.id=$5 RETURNING id`,
        [job.phone,job.name || job.business_name,job.prospect_id,job.business_name,contact.rows[0].id]
      );
    } else {
      contact = await client.query(
        `INSERT INTO alliance_inbox_contacts (wa_id,phone,name,source,prospect_id,custom_fields)
         VALUES ($1,$1,$2,'alliance_bulk',$3,jsonb_build_object('business_name',$4::text))
         RETURNING id`,
        [job.phone,job.name || job.business_name,job.prospect_id,job.business_name]
      );
    }
    const conversation = await client.query(
      `INSERT INTO alliance_inbox_conversations (contact_id,phone_number_id,last_message,last_message_at)
       VALUES ($1,$2,$3,NOW()) ON CONFLICT (contact_id) DO UPDATE SET last_message=EXCLUDED.last_message,last_message_at=NOW(),updated_at=NOW() RETURNING id`,
      [contact.rows[0].id,job.phone_number_id,rendered]
    );
    const message = await client.query(
      `INSERT INTO alliance_inbox_messages (conversation_id,contact_id,wa_msg_id,direction,msg_type,content,status,raw_payload,sent_at)
       VALUES ($1,$2,$3,'outbound','template',$4,'sent',$5::jsonb,NOW())
       ON CONFLICT (wa_msg_id) DO UPDATE SET status=EXCLUDED.status
       RETURNING *,raw_payload->'buttons' AS template_buttons`,
      [conversation.rows[0].id,contact.rows[0].id,waMessageId,rendered,JSON.stringify({ purpose:job.followup_no ? 'automated_followup' : 'bulk_campaign',campaign_id:job.campaign_id,template_name:job.template_name,buttons:Array.isArray(job.template_buttons)?job.template_buttons:[],sender_type:'automation' })]
    );
    await client.query('COMMIT');
    return { contactId: contact.rows[0].id, message: message.rows[0] || null };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function storeInboxMessageSafely(job, waMessageId, rendered) {
  try {
    return await storeInboxMessageUnsafe(job, waMessageId, rendered);
  } catch (error) {
    // Meta already accepted the message. Inbox mirroring is secondary and
    // must not mark a real send failed or cause a duplicate retry.
    console.error('[Alliance WhatsApp inbox mirror]', {
      campaign_id: job.campaign_id,
      prospect_id: job.prospect_id,
      followup_no: job.followup_no || null,
      wa_msg_id: waMessageId,
      error: error.message,
    });
    return { contactId: null, message: null };
  }
}

const storeInboxMessage = storeInboxMessageSafely;

async function sendRecipient(job, io) {
  let waMessageId = null;
  try {
    const token = tokenFor(job);
    if (!token || !job.phone_number_id) throw new Error('Alliance WhatsApp credentials are not configured.');
    const mapping = Array.isArray(job.parameter_mapping) ? job.parameter_mapping : [];
    const parameters = mapping.map((field) => valueFor(field,job));
    const payload = { messaging_product:'whatsapp',recipient_type:'individual',to:job.phone,type:'template',template:{ name:job.template_name,language:{code:job.template_language || 'en'},...(parameters.length?{components:[{type:'body',parameters:parameters.map((text)=>({type:'text',text}))}]}:{}) } };
    const response = await axios.post(`https://graph.facebook.com/v19.0/${job.phone_number_id}/messages`,payload,{headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},timeout:20000});
    waMessageId = response.data?.messages?.[0]?.id || null;
    await db.query(`UPDATE alliance_whatsapp_campaign_recipients SET status='sent',wa_msg_id=$1,sent_at=NOW() WHERE id=$2`,[waMessageId,job.id]);
    if(job.followup_template_id){
      await db.query(`INSERT INTO alliance_whatsapp_followup_jobs(campaign_id,prospect_id,followup_no,scheduled_at,activity_cutoff_at,trigger_source) VALUES($1,$2,1,NOW()+($3*INTERVAL '1 minute'),NOW(),'initial_campaign') ON CONFLICT DO NOTHING`,[job.campaign_id,job.prospect_id,Number(job.followup_delay_minutes)||(Number(job.followup_delay_days)||4)*1440]);
    }
    const rendered = mapping.reduce((body,field,index)=>body.replaceAll(`{{${index+1}}}`,valueFor(field,job)),job.template_body);
    const inbox = await storeInboxMessageSafely(job,waMessageId,rendered);
    io?.emit('alliance_campaign_updated',{campaign_id:job.campaign_id,prospect_id:job.prospect_id,channel:'whatsapp',status:'sent'});
    if(inbox.contactId) io?.emit('alliance_contacts_changed',{contact_id:String(inbox.contactId)});
    if(inbox.message) io?.emit('alliance_outgoing_message',{lead_id:String(inbox.contactId),message:{...inbox.message,type:inbox.message.msg_type,timestamp:inbox.message.sent_at,sender_type:'automation'}});
  } catch (error) {
    const reason=error.response?.data?.error?.message||error.message||'WhatsApp send failed.';
    await db.query(
      `UPDATE alliance_whatsapp_campaign_recipients
       SET status=$1,error_message=$2 WHERE id=$3`,
      [waMessageId ? 'sent' : 'failed', String(waMessageId ? `Meta accepted the message, but Inbox logging failed: ${reason}` : reason).slice(0,2000), job.id]
    );
  }
  await db.query(
    `UPDATE alliance_whatsapp_campaigns c SET status='completed',completed_at=NOW(),updated_at=NOW()
     WHERE c.id=$1
       AND NOT EXISTS (SELECT 1 FROM alliance_whatsapp_campaign_recipients r WHERE r.campaign_id=c.id AND r.status IN ('queued','sending'))
       AND NOT EXISTS (SELECT 1 FROM alliance_whatsapp_followup_jobs j WHERE j.campaign_id=c.id AND j.status IN ('pending','claimed','sending'))`,
    [job.campaign_id]
  );
}

async function processAllianceWhatsAppCampaigns(io) {
  if (processing) return; processing=true;
  try { for(let count=0;count<20;count+=1){const job=await claimRecipient();if(!job)break;if(job.skipped)continue;await sendRecipient(job,io);} }
  finally { processing=false; }
}

// Safety net for WhatsApp campaign follow-up reminders. The n8n workflow
// (AllianceOS_WhatsApp_Followups_n8n.json) normally claims and sends these
// every minute, but this local runner guarantees reminders still go out if
// that workflow is inactive or n8n is unavailable. claimAllianceWhatsAppFollowups
// uses FOR UPDATE SKIP LOCKED with a claimed-by marker, so it's safe to run
// alongside n8n without double-sending.
async function processAllianceWhatsAppFollowups(io) {
  if (followupProcessing) return; followupProcessing = true;
  try {
    const jobs = await claimAllianceWhatsAppFollowups(20, 'internal-fallback');
    for (const job of jobs) {
      try { await sendAllianceWhatsAppFollowup(job.id, io); }
      catch (error) { console.error('[Alliance WhatsApp followup fallback]', error.response?.data || error.message); }
    }
  } finally { followupProcessing = false; }
}

async function startAllianceWhatsAppCampaignWorker(io){
  await ensureAllianceSchema();
  if(!interval){setTimeout(()=>processAllianceWhatsAppCampaigns(io).catch(console.error),5000);interval=setInterval(()=>processAllianceWhatsAppCampaigns(io).catch(console.error),30000);interval.unref?.();}
  if(!followupInterval){setTimeout(()=>processAllianceWhatsAppFollowups(io).catch(console.error),8000);followupInterval=setInterval(()=>processAllianceWhatsAppFollowups(io).catch(console.error),60000);followupInterval.unref?.();}
}

async function claimAllianceWhatsAppFollowups(limit=20,claimId='n8n'){
  const client=await db.connect();try{await client.query('BEGIN');await client.query(`UPDATE alliance_whatsapp_followup_jobs SET status='pending',claimed_at=NULL,claim_id=NULL WHERE status='claimed' AND claimed_at<NOW()-INTERVAL '15 minutes'`);
  await client.query(`UPDATE alliance_whatsapp_followup_jobs job
    SET status='cancelled',error_message=LEFT('Initial WhatsApp delivery failed: ' || COALESCE(recipient.error_message,'Meta reported failure.'),2000)
    FROM alliance_whatsapp_campaign_recipients recipient
    WHERE recipient.campaign_id=job.campaign_id AND recipient.prospect_id=job.prospect_id
      AND recipient.status='failed' AND job.status IN ('pending','claimed')`);
  // Repair reminders skipped by the former SQL column collision where the
  // prospect status (`in_process`) overwrote the actual reminder job status.
  await client.query(`UPDATE alliance_whatsapp_followup_jobs
    SET status='pending',claimed_at=NULL,claim_id=NULL,error_message=NULL
    WHERE status='skipped' AND error_message='job_in_process'`);
  // Recover an initial reminder if Meta accepted the campaign message but the
  // process stopped before the original reminder job could be persisted.
  await client.query(`INSERT INTO alliance_whatsapp_followup_jobs
    (campaign_id,prospect_id,followup_no,scheduled_at,activity_cutoff_at,trigger_source)
    SELECT c.id,r.prospect_id,1,
      r.sent_at+(COALESCE(NULLIF(c.followup_delay_minutes,0),GREATEST(COALESCE(c.followup_delay_days,4),1)*1440)*INTERVAL '1 minute'),
      r.sent_at,'initial_recovery'
    FROM alliance_whatsapp_campaign_recipients r
    JOIN alliance_whatsapp_campaigns c ON c.id=r.campaign_id
    JOIN alliance_prospects p ON p.id=r.prospect_id
    WHERE r.status IN ('sent','delivered','read') AND r.sent_at IS NOT NULL
      AND c.followup_template_id IS NOT NULL AND c.status<>'stopped'
      AND p.suppressed=FALSE AND p.status NOT IN ('converted','closed','complete','completed','not_interested','unsubscribed')
      AND NOT EXISTS (SELECT 1 FROM alliance_whatsapp_followup_jobs existing
        WHERE existing.campaign_id=c.id AND existing.prospect_id=r.prospect_id)
    ON CONFLICT DO NOTHING`);
  await client.query(`UPDATE alliance_whatsapp_campaigns c
    SET status='running',completed_at=NULL,updated_at=NOW()
    WHERE c.status='completed' AND EXISTS (
      SELECT 1 FROM alliance_whatsapp_followup_jobs j
      WHERE j.campaign_id=c.id AND j.status IN ('pending','claimed','sending')
    )`);
  // Recover campaigns created under the former one-reminder rule. For each
  // latest sent reminder with no future job, create the next inactivity check.
  await client.query(`INSERT INTO alliance_whatsapp_followup_jobs(campaign_id,prospect_id,followup_no,scheduled_at,activity_cutoff_at,trigger_source)
    SELECT j.campaign_id,j.prospect_id,j.followup_no+1,j.sent_at+(GREATEST(COALESCE(c.followup_repeat_days,4),1)*INTERVAL '1 day'),j.sent_at,'recurring_inactivity'
    FROM alliance_whatsapp_followup_jobs j
    JOIN alliance_whatsapp_campaigns c ON c.id=j.campaign_id
    JOIN alliance_prospects p ON p.id=j.prospect_id
    WHERE j.status='sent' AND j.sent_at IS NOT NULL AND c.followup_template_id IS NOT NULL AND c.status<>'stopped'
      AND p.suppressed=FALSE AND p.status NOT IN ('converted','closed','complete','completed','not_interested','unsubscribed')
      AND NOT EXISTS (SELECT 1 FROM alliance_whatsapp_followup_jobs newer WHERE newer.campaign_id=j.campaign_id AND newer.prospect_id=j.prospect_id AND newer.followup_no>j.followup_no)
    ON CONFLICT DO NOTHING`);
  const claimed=await client.query(`WITH due AS(SELECT id FROM alliance_whatsapp_followup_jobs WHERE status='pending' AND scheduled_at<=NOW() ORDER BY scheduled_at,id FOR UPDATE SKIP LOCKED LIMIT $1) UPDATE alliance_whatsapp_followup_jobs j SET status='claimed',claimed_at=NOW(),claim_id=$2 FROM due WHERE j.id=due.id RETURNING j.id`,[Math.min(Math.max(Number(limit)||20,1),100),String(claimId).slice(0,255)]);let rows=[];if(claimed.rowCount){rows=(await client.query(`SELECT j.id,j.followup_no,j.scheduled_at,p.id AS prospect_id,p.name,p.business_name,p.phone,p.email,p.audience,p.industry,p.location,p.status,p.consent_source,c.id AS campaign_id,c.name AS campaign_name,c.followup_template_name AS template_name,c.followup_template_language AS language,c.followup_template_body AS template_body,c.followup_parameter_mapping AS parameter_mapping FROM alliance_whatsapp_followup_jobs j JOIN alliance_whatsapp_campaigns c ON c.id=j.campaign_id JOIN alliance_prospects p ON p.id=j.prospect_id WHERE j.id=ANY($1::bigint[]) ORDER BY j.scheduled_at`,[claimed.rows.map(row=>row.id)])).rows;}await client.query('COMMIT');return rows;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

async function scheduleAllianceInactivityReminder(prospectId, activityAt = new Date()) {
  if (!prospectId) return null;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const configuration = await client.query(
      `SELECT c.id AS campaign_id,
              COALESCE(c.followup_delay_minutes,c.followup_delay_days*1440,5760)::int AS delay_minutes,
              p.status AS prospect_status
       FROM alliance_whatsapp_campaign_recipients r
       JOIN alliance_whatsapp_campaigns c ON c.id=r.campaign_id
       JOIN alliance_prospects p ON p.id=r.prospect_id
       WHERE r.prospect_id=$1 AND c.followup_template_id IS NOT NULL
         AND c.status<>'stopped'
       ORDER BY COALESCE(r.sent_at,c.started_at,c.created_at) DESC LIMIT 1
       FOR UPDATE OF p`,
      [prospectId]
    );
    if (!configuration.rowCount || ['converted','closed','complete','completed','not_interested','unsubscribed'].includes(configuration.rows[0].prospect_status)) {
      await client.query('COMMIT');
      return null;
    }
    await client.query(
      `UPDATE alliance_whatsapp_followup_jobs SET status='cancelled',error_message='Replaced by a newer admin activity timer.'
       WHERE prospect_id=$1 AND status IN ('pending','claimed')`,
      [prospectId]
    );
    const next = await client.query(
      `SELECT COALESCE(MAX(followup_no),0)+1 AS followup_no
       FROM alliance_whatsapp_followup_jobs WHERE campaign_id=$1 AND prospect_id=$2`,
      [configuration.rows[0].campaign_id, prospectId]
    );
    const job = await client.query(
      `INSERT INTO alliance_whatsapp_followup_jobs
        (campaign_id,prospect_id,followup_no,scheduled_at,activity_cutoff_at,trigger_source)
       VALUES($1,$2,$3,$4::timestamptz+($5*INTERVAL '1 minute'),$4::timestamptz,'admin_outbound')
       RETURNING id,scheduled_at,followup_no`,
      [configuration.rows[0].campaign_id, prospectId, next.rows[0].followup_no, activityAt, configuration.rows[0].delay_minutes]
    );
    await client.query('COMMIT');
    return job.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function sendAllianceWhatsAppFollowup(jobId,io){
  const result=await db.query(`SELECT j.*,j.status AS job_status,c.status AS campaign_status,c.name AS campaign_name,c.phone_number_id,c.followup_template_name AS template_name,c.followup_template_language AS template_language,c.followup_template_body AS template_body,c.followup_parameter_mapping AS parameter_mapping,t.buttons AS template_buttons,c.followup_repeat_days,c.max_followups,c.created_at AS campaign_created_at,p.name,p.business_name,p.location,p.phone,p.email,p.audience,p.industry,p.source,p.channel,p.channel_pref,p.ai_score,p.created_at,p.custom_fields,p.status AS prospect_status,p.consent,p.consent_source,p.consent_at,p.consent_evidence,p.consent_scope,p.suppressed,s.access_token_env,cv.last_inbound_at FROM alliance_whatsapp_followup_jobs j JOIN alliance_whatsapp_campaigns c ON c.id=j.campaign_id LEFT JOIN templates t ON t.id=c.followup_template_id JOIN alliance_prospects p ON p.id=j.prospect_id LEFT JOIN alliance_inbox_settings s ON s.phone_number_id=c.phone_number_id LEFT JOIN alliance_inbox_contacts ic ON ic.prospect_id=p.id LEFT JOIN alliance_inbox_conversations cv ON cv.contact_id=ic.id WHERE j.id=$1`,[jobId]);if(!result.rowCount)throw Object.assign(new Error('Follow-up job not found.'),{status:404});const job=result.rows[0];
  const consentAuditValid=job.consent&&APPROVED_CONSENT_SOURCES.has(String(job.consent_source||'').toLowerCase())&&job.consent_at&&String(job.consent_evidence||'').trim()&&APPROVED_CONSENT_SCOPES.has(String(job.consent_scope||'').toLowerCase())&&!NON_CONSENT_SOURCE_PATTERN.test(String(job.source||''));
  const reason=!['claimed','pending'].includes(job.job_status)?`job_${job.job_status}`:job.campaign_status==='stopped'?'campaign_stopped':!consentAuditValid?'whatsapp_consent_audit_invalid':job.suppressed?'suppressed':['converted','closed','complete','completed','not_interested','unsubscribed'].includes(job.prospect_status)?`prospect_${job.prospect_status}`:job.last_inbound_at&&new Date(job.last_inbound_at)>new Date(job.activity_cutoff_at||job.campaign_created_at)?'recipient_replied_after_latest_activity':null;
  if(reason){await db.query(`UPDATE alliance_whatsapp_followup_jobs SET status='skipped',error_message=$1 WHERE id=$2`,[reason,job.id]);return{sent:false,skipped:true,reason};}
  await db.query(`UPDATE alliance_whatsapp_followup_jobs SET status='sending',error_message=NULL WHERE id=$1`,[job.id]);try{const token=tokenFor(job);if(!token)throw new Error('Alliance WhatsApp access token is missing.');const mapping=Array.isArray(job.parameter_mapping)?job.parameter_mapping:[];const parameters=mapping.map(field=>valueFor(field,job));const payload={messaging_product:'whatsapp',to:job.phone,type:'template',template:{name:job.template_name,language:{code:job.template_language||'en'},...(parameters.length?{components:[{type:'body',parameters:parameters.map(text=>({type:'text',text}))}]}:{})}};const response=await axios.post(`https://graph.facebook.com/v19.0/${job.phone_number_id}/messages`,payload,{headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},timeout:20000});const waMessageId=response.data?.messages?.[0]?.id||null;await db.query(`UPDATE alliance_whatsapp_followup_jobs SET status='sent',wa_msg_id=$1,sent_at=NOW() WHERE id=$2`,[waMessageId,job.id]);const rendered=mapping.reduce((body,field,index)=>body.replaceAll(`{{${index+1}}}`,valueFor(field,job)),job.template_body);const inbox=await storeInboxMessage(job,waMessageId,rendered);
  const repeatDays=Math.min(Math.max(Number(job.followup_repeat_days)||4,1),30);const nextNo=Number(job.followup_no)+1;const withinLimit=Number(job.max_followups)===0||nextNo<=Number(job.max_followups);if(withinLimit){await db.query(`INSERT INTO alliance_whatsapp_followup_jobs(campaign_id,prospect_id,followup_no,scheduled_at,activity_cutoff_at,trigger_source) VALUES($1,$2,$3,NOW()+($4*INTERVAL '1 day'),NOW(),'recurring_inactivity') ON CONFLICT DO NOTHING`,[job.campaign_id,job.prospect_id,nextNo,repeatDays]);}
  io?.emit('alliance_campaign_updated',{campaign_id:job.campaign_id,prospect_id:job.prospect_id,channel:'whatsapp_followup',status:'sent'});if(inbox.contactId)io?.emit('alliance_contacts_changed',{contact_id:String(inbox.contactId)});if(inbox.message)io?.emit('alliance_outgoing_message',{lead_id:String(inbox.contactId),message:{...inbox.message,type:inbox.message.msg_type,timestamp:inbox.message.sent_at,sender_type:'automation'}});return{sent:true,wa_msg_id:waMessageId,next_followup_scheduled:withinLimit};}catch(error){const reason=error.response?.data?.error?.message||error.message;await db.query(`UPDATE alliance_whatsapp_followup_jobs SET status='failed',error_message=$1 WHERE id=$2`,[String(reason).slice(0,2000),job.id]);throw error;}
}
module.exports={startAllianceWhatsAppCampaignWorker,processAllianceWhatsAppCampaigns,processAllianceWhatsAppFollowups,claimAllianceWhatsAppFollowups,sendAllianceWhatsAppFollowup,scheduleAllianceInactivityReminder};
