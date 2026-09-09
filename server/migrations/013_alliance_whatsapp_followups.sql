ALTER TABLE alliance_whatsapp_campaigns ADD COLUMN IF NOT EXISTS followup_template_id BIGINT;
ALTER TABLE alliance_whatsapp_campaigns ADD COLUMN IF NOT EXISTS followup_template_name VARCHAR(255);
ALTER TABLE alliance_whatsapp_campaigns ADD COLUMN IF NOT EXISTS followup_template_language VARCHAR(20);
ALTER TABLE alliance_whatsapp_campaigns ADD COLUMN IF NOT EXISTS followup_template_body TEXT;
ALTER TABLE alliance_whatsapp_campaigns ADD COLUMN IF NOT EXISTS followup_parameter_mapping JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE alliance_whatsapp_campaigns ADD COLUMN IF NOT EXISTS followup_delay_days INTEGER NOT NULL DEFAULT 4;
ALTER TABLE alliance_whatsapp_campaigns ADD COLUMN IF NOT EXISTS followup_repeat_days INTEGER NOT NULL DEFAULT 4;
ALTER TABLE alliance_whatsapp_campaigns ADD COLUMN IF NOT EXISTS max_followups INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS alliance_whatsapp_followup_jobs (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES alliance_whatsapp_campaigns(id) ON DELETE CASCADE,
  prospect_id BIGINT NOT NULL REFERENCES alliance_prospects(id) ON DELETE CASCADE,
  followup_no INTEGER NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','sending','sent','failed','skipped','cancelled')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ,
  claim_id VARCHAR(255),
  wa_msg_id VARCHAR(255),
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(campaign_id,prospect_id,followup_no)
);
CREATE INDEX IF NOT EXISTS alliance_wa_followups_due_idx ON alliance_whatsapp_followup_jobs(status,scheduled_at);

