ALTER TABLE alliance_whatsapp_followup_jobs
  ADD COLUMN IF NOT EXISTS activity_cutoff_at TIMESTAMPTZ;

ALTER TABLE alliance_whatsapp_followup_jobs
  ADD COLUMN IF NOT EXISTS trigger_source VARCHAR(30) NOT NULL DEFAULT 'initial_campaign';

UPDATE alliance_whatsapp_followup_jobs
SET activity_cutoff_at = COALESCE(activity_cutoff_at, created_at)
WHERE activity_cutoff_at IS NULL;

CREATE INDEX IF NOT EXISTS alliance_wa_followups_activity_idx
  ON alliance_whatsapp_followup_jobs(prospect_id, activity_cutoff_at DESC);
