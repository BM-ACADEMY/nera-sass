ALTER TABLE alliance_campaigns
  ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMPTZ;

ALTER TABLE alliance_campaigns
  DROP CONSTRAINT IF EXISTS alliance_campaigns_status_check;

ALTER TABLE alliance_campaigns
  ADD CONSTRAINT alliance_campaigns_status_check
  CHECK (status IN ('draft','ready','scheduled','running','paused','completed','cancelled'));
