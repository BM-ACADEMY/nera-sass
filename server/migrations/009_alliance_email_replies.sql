CREATE TABLE IF NOT EXISTS alliance_email_inbound (
  id BIGSERIAL PRIMARY KEY,
  message_id VARCHAR(500) NOT NULL UNIQUE,
  in_reply_to VARCHAR(500),
  message_references TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  from_email VARCHAR(255) NOT NULL,
  from_name VARCHAR(255),
  to_email VARCHAR(255),
  subject TEXT,
  text_body TEXT,
  html_body TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  prospect_id BIGINT REFERENCES alliance_prospects(id) ON DELETE SET NULL,
  campaign_id BIGINT REFERENCES alliance_campaigns(id) ON DELETE SET NULL,
  touch_id BIGINT REFERENCES alliance_touches(id) ON DELETE SET NULL,
  processing_status VARCHAR(30) NOT NULL DEFAULT 'received',
  processing_error TEXT,
  raw_headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS alliance_email_inbound_from_idx ON alliance_email_inbound(LOWER(from_email), received_at DESC);

ALTER TABLE alliance_replies ADD COLUMN IF NOT EXISTS email_inbound_id BIGINT REFERENCES alliance_email_inbound(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS alliance_replies_email_inbound_unique
  ON alliance_replies(email_inbound_id) WHERE email_inbound_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS alliance_email_sync_state (
  mailbox VARCHAR(255) PRIMARY KEY,
  last_checked_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
