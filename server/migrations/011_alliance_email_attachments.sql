CREATE TABLE IF NOT EXISTS alliance_email_attachments (
  id BIGSERIAL PRIMARY KEY,
  inbound_id BIGINT NOT NULL REFERENCES alliance_email_inbound(id) ON DELETE CASCADE,
  attachment_index INTEGER NOT NULL,
  filename VARCHAR(500) NOT NULL,
  content_type VARCHAR(255),
  content_id VARCHAR(500),
  size_bytes BIGINT NOT NULL DEFAULT 0,
  content BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (inbound_id, attachment_index)
);
CREATE INDEX IF NOT EXISTS alliance_email_attachments_inbound_idx ON alliance_email_attachments(inbound_id);

