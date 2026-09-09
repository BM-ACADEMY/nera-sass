ALTER TABLE alliance_audiences
  ADD COLUMN IF NOT EXISTS column_config JSONB NOT NULL DEFAULT '[]'::jsonb;
