CREATE TABLE IF NOT EXISTS alliance_prompt_rules (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  job VARCHAR(40) NOT NULL CHECK (job IN ('all','campaign_message','followup','reply_suggestion','classify')),
  channel VARCHAR(20) NOT NULL DEFAULT 'all' CHECK (channel IN ('all','email','whatsapp')),
  audience VARCHAR(50) REFERENCES alliance_audiences(code) ON DELETE CASCADE,
  condition_text TEXT,
  instruction_text TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS alliance_prompt_rules_match_idx
  ON alliance_prompt_rules (active, job, channel, audience, priority);
