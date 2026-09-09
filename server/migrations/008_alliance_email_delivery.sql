ALTER TABLE alliance_touches ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(255);
ALTER TABLE alliance_touches ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS alliance_email_events (
  id BIGSERIAL PRIMARY KEY,
  touch_id BIGINT REFERENCES alliance_touches(id) ON DELETE CASCADE,
  campaign_id BIGINT REFERENCES alliance_campaigns(id) ON DELETE CASCADE,
  prospect_id BIGINT REFERENCES alliance_prospects(id) ON DELETE CASCADE,
  provider_message_id VARCHAR(255),
  event_type VARCHAR(40) NOT NULL,
  event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS alliance_email_events_campaign_idx ON alliance_email_events(campaign_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS alliance_email_events_provider_idx ON alliance_email_events(provider_message_id);
