ALTER TABLE alliance_inbox_conversations
  ADD COLUMN IF NOT EXISTS last_ai_nudge_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS ai_nudge_count INTEGER NOT NULL DEFAULT 0;
