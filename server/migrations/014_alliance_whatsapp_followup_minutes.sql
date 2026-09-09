ALTER TABLE alliance_whatsapp_campaigns
  ADD COLUMN IF NOT EXISTS followup_delay_minutes INTEGER NOT NULL DEFAULT 5760;

UPDATE alliance_whatsapp_campaigns
SET followup_delay_minutes = GREATEST(COALESCE(followup_delay_days, 4), 1) * 1440
WHERE followup_delay_minutes IS NULL OR followup_delay_minutes <= 0;
