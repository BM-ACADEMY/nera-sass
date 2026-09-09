ALTER TABLE alliance_email_sync_state
  ADD COLUMN IF NOT EXISTS last_uid BIGINT;

