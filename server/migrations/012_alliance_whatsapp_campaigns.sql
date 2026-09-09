CREATE TABLE IF NOT EXISTS alliance_whatsapp_campaigns (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  audience VARCHAR(100),
  template_id BIGINT NOT NULL,
  template_name VARCHAR(255) NOT NULL,
  template_language VARCHAR(20) NOT NULL DEFAULT 'en',
  template_body TEXT NOT NULL,
  parameter_mapping JSONB NOT NULL DEFAULT '[]'::jsonb,
  phone_number_id VARCHAR(100) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('draft','scheduled','running','paused','completed','stopped','failed')),
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alliance_whatsapp_campaign_recipients (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES alliance_whatsapp_campaigns(id) ON DELETE CASCADE,
  prospect_id BIGINT NOT NULL REFERENCES alliance_prospects(id) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','delivered','read','failed','skipped','cancelled')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  wa_msg_id VARCHAR(255),
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id,prospect_id)
);
CREATE INDEX IF NOT EXISTS alliance_wa_recipients_due_idx ON alliance_whatsapp_campaign_recipients(status,scheduled_at);
CREATE INDEX IF NOT EXISTS alliance_wa_recipients_message_idx ON alliance_whatsapp_campaign_recipients(wa_msg_id) WHERE wa_msg_id IS NOT NULL;

