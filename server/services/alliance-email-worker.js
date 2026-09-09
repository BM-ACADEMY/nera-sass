const db = require('../db/connection');
const ensureAllianceSchema = require('../db/alliance-schema');
const { createAllianceEmailTransport, getAllianceEmailConfig, isAllianceSenderAllowed, allowedAllianceFromAddresses } = require('./alliance-email');

let interval;
let processing = false;

async function reconcileEmailFollowups() {
  await db.query(
    `UPDATE alliance_touches touch
     SET status='scheduled',processing_started_at=NULL,error_message=NULL
     FROM alliance_prospects prospect, alliance_campaigns campaign
     WHERE prospect.id=touch.prospect_id AND campaign.id=touch.campaign_id
       AND touch.status='cancelled' AND touch.sent_at IS NULL
       AND touch.error_message='Recipient replied; follow-ups stopped.'
       AND campaign.status<>'stopped' AND prospect.suppressed=FALSE
       AND prospect.status NOT IN ('converted','closed','not_interested','unsubscribed','complete','completed')`
  );
  await db.query(
    `UPDATE alliance_campaign_prospects enrollment
     SET enrollment_status='in_sequence',stopped_at=NULL,stop_reason=NULL
     FROM alliance_prospects prospect, alliance_campaigns campaign
     WHERE prospect.id=enrollment.prospect_id AND campaign.id=enrollment.campaign_id
       AND enrollment.stop_reason='recipient_replied' AND campaign.status<>'stopped'
       AND prospect.suppressed=FALSE
       AND prospect.status NOT IN ('converted','closed','not_interested','unsubscribed','complete','completed')`
  );
}

async function recoverMissingEmailFollowups() {
  await db.query(
    `INSERT INTO alliance_touches
      (prospect_id,campaign_id,touch_no,channel,domain_id,subject,message_body,status,scheduled_at)
     SELECT first_touch.prospect_id,first_touch.campaign_id,template.touch_no,'email',campaign.sender_domain_id,
            template.subject,template.body,'scheduled',
            COALESCE(campaign.started_at,first_touch.sent_at,NOW())+(template.delay_days*INTERVAL '1 day')
     FROM alliance_touches first_touch
     JOIN alliance_campaigns campaign ON campaign.id=first_touch.campaign_id
     JOIN alliance_campaign_prospects enrollment ON enrollment.campaign_id=first_touch.campaign_id AND enrollment.prospect_id=first_touch.prospect_id
     JOIN alliance_prospects prospect ON prospect.id=first_touch.prospect_id
     JOIN alliance_campaign_templates template ON template.campaign_id=first_touch.campaign_id AND template.touch_no>1
     WHERE first_touch.touch_no=1 AND first_touch.status='sent' AND first_touch.sent_at IS NOT NULL
       AND campaign.status IN ('running','completed') AND enrollment.enrollment_status='in_sequence'
       AND prospect.suppressed=FALSE AND prospect.status NOT IN ('converted','closed','not_interested','unsubscribed','complete','completed')
     ON CONFLICT (campaign_id,prospect_id,touch_no) DO NOTHING`
  );
  await db.query(
    `UPDATE alliance_campaigns campaign SET status='running',completed_at=NULL
     WHERE campaign.status='completed' AND EXISTS (
       SELECT 1 FROM alliance_touches touch
       WHERE touch.campaign_id=campaign.id AND touch.status='scheduled'
     )`
  );
  await db.query(
    `UPDATE alliance_campaign_prospects enrollment SET next_touch_at=due.next_touch_at
     FROM (SELECT campaign_id,prospect_id,MIN(scheduled_at) AS next_touch_at
           FROM alliance_touches WHERE status='scheduled' GROUP BY campaign_id,prospect_id) due
     WHERE enrollment.campaign_id=due.campaign_id AND enrollment.prospect_id=due.prospect_id`
  );
}

async function finalizeEmailCampaigns() {
  await db.query(
    `UPDATE alliance_campaign_prospects enrollment
     SET enrollment_status='completed',next_touch_at=NULL
     WHERE enrollment.enrollment_status='in_sequence'
       AND EXISTS (SELECT 1 FROM alliance_touches sent WHERE sent.campaign_id=enrollment.campaign_id AND sent.prospect_id=enrollment.prospect_id AND sent.status='sent')
       AND NOT EXISTS (
         SELECT 1 FROM alliance_campaign_templates template
         WHERE template.campaign_id=enrollment.campaign_id
           AND NOT EXISTS (SELECT 1 FROM alliance_touches expected WHERE expected.campaign_id=enrollment.campaign_id AND expected.prospect_id=enrollment.prospect_id AND expected.touch_no=template.touch_no)
       )
       AND NOT EXISTS (SELECT 1 FROM alliance_touches active WHERE active.campaign_id=enrollment.campaign_id AND active.prospect_id=enrollment.prospect_id AND active.status IN ('scheduled','processing','paused','failed'))`
  );
  await db.query(
    `UPDATE alliance_campaigns campaign SET status='completed',completed_at=NOW()
     WHERE campaign.status='running'
       AND NOT EXISTS (
         SELECT 1 FROM alliance_campaign_prospects enrollment
         JOIN alliance_prospects prospect ON prospect.id=enrollment.prospect_id
         WHERE enrollment.campaign_id=campaign.id
           AND prospect.status NOT IN ('converted','closed','not_interested','unsubscribed','complete','completed')
       )
       AND NOT EXISTS (SELECT 1 FROM alliance_touches active WHERE active.campaign_id=campaign.id AND active.status IN ('scheduled','processing','paused','failed'))`
  );
  await db.query(
    `UPDATE alliance_campaigns campaign SET status='running',completed_at=NULL
     WHERE campaign.status='completed'
       AND EXISTS (
         SELECT 1 FROM alliance_campaign_prospects enrollment
         JOIN alliance_prospects prospect ON prospect.id=enrollment.prospect_id
         WHERE enrollment.campaign_id=campaign.id
           AND prospect.status NOT IN ('converted','closed','not_interested','unsubscribed','complete','completed')
       )`
  );
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function renderTemplate(value, prospect) {
  const customFields = typeof prospect.custom_fields === 'string'
    ? JSON.parse(prospect.custom_fields || '{}')
    : (prospect.custom_fields || {});
  const aliases = { org: 'business_name', status: 'prospect_status' };
  return String(value || '')
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/\{\{([a-z][a-z0-9_]*)\}\}/gi, (token, key) => {
      const resolved = prospect[aliases[key] || key] ?? customFields[key];
      if (resolved === undefined || resolved === null || resolved === '') {
        if (key === 'name') return prospect.business_name || 'there';
        if (key === 'org') return prospect.business_name || 'your organisation';
        return token;
      }
      return String(resolved);
    });
}

function textToHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

async function claimDueTouch() {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE alliance_domains SET sent_today=0,last_reset=NOW() WHERE last_reset::date<CURRENT_DATE`);
    await client.query(
      `UPDATE alliance_touches SET status = 'scheduled', processing_started_at = NULL,
              error_message = 'Recovered after interrupted email processing.'
       WHERE status = 'processing' AND processing_started_at < NOW() - INTERVAL '15 minutes'`
    );
    const result = await client.query(
      `SELECT t.id, t.campaign_id, t.prospect_id, t.touch_no, t.subject, t.message_body,
              p.name, p.business_name, p.email, p.phone, p.audience, p.industry, p.location,
              p.source, p.channel, p.channel_pref, p.consent, p.consent_source, p.ai_score, p.created_at,
              p.custom_fields, p.status AS prospect_status,
              p.suppressed, c.name AS campaign_name, c.status AS campaign_status, c.started_at, c.sender_domain_id,
              cp.enrollment_status, d.inbox_email, d.status AS sender_status,
              d.daily_cap, d.sent_today, policy.limit_mode AS bulk_limit_mode, policy.custom_limit AS bulk_custom_limit,
              sent_count.contacted_count
       FROM alliance_touches t
       JOIN alliance_campaigns c ON c.id = t.campaign_id
       JOIN alliance_campaign_prospects cp ON cp.campaign_id = t.campaign_id AND cp.prospect_id = t.prospect_id
       JOIN alliance_prospects p ON p.id = t.prospect_id
       JOIN alliance_domains d ON d.id = c.sender_domain_id
       LEFT JOIN alliance_bulk_send_limits policy ON policy.channel='email'
       LEFT JOIN LATERAL (
         SELECT COUNT(DISTINCT already.prospect_id)::int AS contacted_count
         FROM alliance_touches already WHERE already.campaign_id=t.campaign_id AND already.channel='email' AND already.status='sent'
       ) sent_count ON TRUE
       WHERE t.channel = 'email' AND t.status = 'scheduled' AND t.scheduled_at <= NOW()
       ORDER BY t.scheduled_at, t.id
       FOR UPDATE OF t SKIP LOCKED LIMIT 1`
    );
    if (!result.rowCount) {
      await client.query('COMMIT');
      return null;
    }
    const touch = result.rows[0];
    if (touch.campaign_status === 'scheduled') {
      await client.query(
        `UPDATE alliance_campaigns SET status = 'running', started_at = COALESCE(started_at, NOW())
         WHERE id = $1 AND status = 'scheduled'`,
        [touch.campaign_id]
      );
      touch.campaign_status = 'running';
    }
    const stopReason = touch.campaign_status !== 'running' ? 'campaign_not_running'
      : touch.suppressed ? 'suppressed'
        : ['converted', 'closed', 'not_interested', 'unsubscribed'].includes(touch.prospect_status) ? `prospect_${touch.prospect_status}`
          : ['stopped', 'completed'].includes(touch.enrollment_status) ? `enrollment_${touch.enrollment_status}`
            : touch.sender_status !== 'active' ? 'sender_not_active'
              : Number(touch.sent_today) >= Number(touch.daily_cap) ? 'sender_daily_cap_reached'
                : Number(touch.touch_no) === 1 && touch.bulk_limit_mode === 'custom' && Number(touch.contacted_count) >= Number(touch.bulk_custom_limit) ? 'bulk_send_limit_reached'
                  : !touch.email ? 'missing_email' : null;
    if (stopReason) {
      const retryable = ['campaign_not_running', 'sender_not_active', 'sender_daily_cap_reached'].includes(stopReason);
      await client.query(
        // $1 is cast explicitly both places it's used — otherwise Postgres infers a
        // different type for the same parameter at each site (varchar from the column
        // assignment, text from the bare literal comparison) and errors 42P08.
        `UPDATE alliance_touches SET status = $1::varchar, error_message = $2,
                scheduled_at = CASE WHEN $1::varchar = 'scheduled' THEN NOW() + INTERVAL '5 minutes' ELSE scheduled_at END
         WHERE id = $3`,
        [retryable ? 'scheduled' : 'cancelled', stopReason, touch.id]
      );
      if (!retryable) {
        await client.query(
          `UPDATE alliance_campaign_prospects SET enrollment_status = 'stopped', stopped_at = NOW(), stop_reason = $1
           WHERE campaign_id = $2 AND prospect_id = $3`,
          [stopReason, touch.campaign_id, touch.prospect_id]
        );
      }
      await client.query('COMMIT');
      return null;
    }
    await client.query(`UPDATE alliance_touches SET status = 'processing', processing_started_at = NOW(), error_message = NULL WHERE id = $1`, [touch.id]);
    await client.query('COMMIT');
    return touch;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function scheduleRemainingTouches(touch) {
  await db.query(
    `INSERT INTO alliance_touches
      (prospect_id, campaign_id, touch_no, channel, domain_id, subject, message_body, status, scheduled_at)
     SELECT $1, ct.campaign_id, ct.touch_no, 'email', $2, ct.subject, ct.body, 'scheduled',
            COALESCE(c.started_at,$4::timestamptz,NOW()) + (ct.delay_days * INTERVAL '1 day')
     FROM alliance_campaign_templates ct
     JOIN alliance_campaigns c ON c.id = ct.campaign_id
     WHERE ct.campaign_id = $3 AND ct.touch_no > 1
     ON CONFLICT (campaign_id, prospect_id, touch_no) DO NOTHING`,
    [touch.prospect_id, touch.sender_domain_id, touch.campaign_id, touch.sent_at || new Date().toISOString()]
  );
  await db.query(
    `UPDATE alliance_campaign_prospects cp SET next_touch_at = due.next_touch_at
     FROM (SELECT campaign_id, prospect_id, MIN(scheduled_at) AS next_touch_at
           FROM alliance_touches WHERE campaign_id=$1 AND prospect_id=$2 AND status='scheduled'
           GROUP BY campaign_id, prospect_id) due
     WHERE cp.campaign_id=due.campaign_id AND cp.prospect_id=due.prospect_id`,
    [touch.campaign_id, touch.prospect_id]
  );
}

async function finalEligibilityCheck(touch) {
  await db.query(`UPDATE alliance_domains SET sent_today=0,last_reset=NOW() WHERE last_reset::date<CURRENT_DATE`);
  const result = await db.query(
    `SELECT c.status AS campaign_status, p.status AS prospect_status, p.suppressed,
            cp.enrollment_status, d.status AS sender_status, d.sent_today, d.daily_cap
     FROM alliance_campaigns c
     JOIN alliance_campaign_prospects cp ON cp.campaign_id=c.id AND cp.prospect_id=$2
     JOIN alliance_prospects p ON p.id=cp.prospect_id
     JOIN alliance_domains d ON d.id=c.sender_domain_id
     WHERE c.id=$1`,
    [touch.campaign_id, touch.prospect_id]
  );
  if (!result.rowCount) return 'campaign_or_enrollment_missing';
  const state = result.rows[0];
  if (state.campaign_status !== 'running') return 'campaign_not_running';
  if (state.suppressed) return 'suppressed';
  if (['converted', 'closed', 'not_interested', 'unsubscribed'].includes(state.prospect_status)) return `prospect_${state.prospect_status}`;
  if (['stopped', 'completed'].includes(state.enrollment_status)) return `enrollment_${state.enrollment_status}`;
  if (state.sender_status !== 'active') return 'sender_not_active';
  if (Number(state.sent_today) >= Number(state.daily_cap)) return 'sender_daily_cap_reached';
  return null;
}

async function deliverTouch(touch, io) {
  const config = getAllianceEmailConfig();
  let deliveryRecorded = false;
  try {
    const stoppedBecause = await finalEligibilityCheck(touch);
    if (stoppedBecause) {
      const retryable = ['campaign_not_running', 'sender_not_active', 'sender_daily_cap_reached'].includes(stoppedBecause);
      await db.query(
        `UPDATE alliance_touches SET status=$1, processing_started_at=NULL, error_message=$2,
                scheduled_at=CASE WHEN $1='scheduled' THEN NOW()+INTERVAL '5 minutes' ELSE scheduled_at END
         WHERE id=$3 AND status='processing'`,
        [retryable ? 'scheduled' : 'cancelled', stoppedBecause, touch.id]
      );
      if (!retryable) await db.query(
        `UPDATE alliance_campaign_prospects SET enrollment_status='stopped', stopped_at=NOW(), stop_reason=$1, next_touch_at=NULL
         WHERE campaign_id=$2 AND prospect_id=$3`,
        [stoppedBecause, touch.campaign_id, touch.prospect_id]
      );
      return;
    }
    if (!isAllianceSenderAllowed(touch.inbox_email, config)) {
      throw new Error(`Selected sender ${touch.inbox_email} is not an allowed Zoho SMTP sender. Configured senders: ${[...allowedAllianceFromAddresses(config)].join(', ') || 'none'}.`);
    }
    const subject = renderTemplate(touch.subject, touch);
    const body = renderTemplate(touch.message_body, touch);
    const transporter = createAllianceEmailTransport();
    const result = await transporter.sendMail({
      from: { name: config.fromName, address: touch.inbox_email },
      to: touch.email,
      replyTo: config.replyTo,
      subject,
      text: body,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6">${textToHtml(body)}</div>`,
      headers: {
        'X-Alliance-Campaign-ID': String(touch.campaign_id),
        'X-Alliance-Prospect-ID': String(touch.prospect_id),
        'List-Unsubscribe': `<mailto:${config.replyTo}?subject=unsubscribe>`,
      },
    });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE alliance_touches SET status = 'sent', sent_at = NOW(), processing_started_at = NULL,
                provider_message_id = $1, subject = $2, message_body = $3 WHERE id = $4`,
        [result.messageId || null, subject, body, touch.id]
      );
      await client.query(`UPDATE alliance_domains SET sent_today = sent_today + 1 WHERE id = $1`, [touch.sender_domain_id]);
      await client.query(
        `UPDATE alliance_campaign_prospects SET enrollment_status = 'in_sequence', current_touch = GREATEST(current_touch, $1),
                next_touch_at = NULL
         WHERE campaign_id = $2 AND prospect_id = $3`,
        [touch.touch_no, touch.campaign_id, touch.prospect_id]
      );
      await client.query(
        `INSERT INTO alliance_email_events (touch_id, campaign_id, prospect_id, provider_message_id, event_type, event_payload)
         VALUES ($1,$2,$3,$4,'sent',$5::jsonb)`,
        [touch.id, touch.campaign_id, touch.prospect_id, result.messageId || null, JSON.stringify({ accepted: result.accepted, rejected: result.rejected, response: result.response })]
      );
      await client.query('COMMIT');
      deliveryRecorded = true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await scheduleRemainingTouches(touch);
    io?.emit('alliance_campaign_updated', { campaign_id: touch.campaign_id, prospect_id: touch.prospect_id, touch_id: touch.id, status: 'sent' });
  } catch (error) {
    const reason = error.response || error.message || 'Zoho email delivery failed.';
    if (deliveryRecorded) {
      await db.query(
        `INSERT INTO alliance_email_events (touch_id,campaign_id,prospect_id,event_type,event_payload)
         VALUES ($1,$2,$3,'followup_schedule_failed',$4::jsonb)`,
        [touch.id,touch.campaign_id,touch.prospect_id,JSON.stringify({ error:String(reason).slice(0,2000) })]
      );
      console.error('[Alliance email follow-up scheduling]', reason);
      return;
    }
    await db.query(
      `UPDATE alliance_touches SET status = 'failed', error_message = $1, processing_started_at = NULL WHERE id = $2`,
      [String(reason).slice(0, 2000), touch.id]
    );
    await db.query(
      `INSERT INTO alliance_email_events (touch_id, campaign_id, prospect_id, event_type, event_payload)
       VALUES ($1,$2,$3,'failed',$4::jsonb)`,
      [touch.id, touch.campaign_id, touch.prospect_id, JSON.stringify({ error: String(reason).slice(0, 2000) })]
    );
    io?.emit('alliance_campaign_updated', { campaign_id: touch.campaign_id, prospect_id: touch.prospect_id, touch_id: touch.id, status: 'failed', error: reason });
    console.error('[Alliance email delivery]', reason);
  }
}

async function processAllianceEmailQueue(io) {
  if (processing) return;
  processing = true;
  try {
    await reconcileEmailFollowups();
    await recoverMissingEmailFollowups();
    for (let count = 0; count < 20; count += 1) {
      const touch = await claimDueTouch();
      if (!touch) break;
      await deliverTouch(touch, io);
    }
    await finalizeEmailCampaigns();
  } finally {
    processing = false;
  }
}

async function startAllianceEmailWorker(io) {
  await ensureAllianceSchema();
  if (interval) return;
  setTimeout(() => processAllianceEmailQueue(io).catch((error) => console.error('[Alliance email worker]', error)), 2000);
  interval = setInterval(() => processAllianceEmailQueue(io).catch((error) => console.error('[Alliance email worker]', error)), 30000);
}

module.exports = { startAllianceEmailWorker, processAllianceEmailQueue };
