CREATE TABLE IF NOT EXISTS alliance_prospect_score_events (
  id BIGSERIAL PRIMARY KEY,
  prospect_id BIGINT NOT NULL REFERENCES alliance_prospects(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL,
  event_key TEXT NOT NULL,
  intent VARCHAR(40),
  score_delta INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(channel, event_key)
);

UPDATE alliance_prospects SET ai_score = 10 WHERE ai_score IS NULL;

