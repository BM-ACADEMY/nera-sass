CREATE TABLE IF NOT EXISTS alliance_lead_ai_memory (
  prospect_id BIGINT PRIMARY KEY REFERENCES alliance_prospects(id) ON DELETE CASCADE,
  lead_key VARCHAR(80) NOT NULL UNIQUE,
  summary TEXT NOT NULL DEFAULT '',
  memory JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_channel VARCHAR(20),
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS alliance_lead_ai_memory_updated_idx
  ON alliance_lead_ai_memory (updated_at DESC);
