ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS template_parameters JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS parameter_definitions JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS template_scope VARCHAR(20) NOT NULL DEFAULT 'shared';

ALTER TABLE campaign_message_queue
  ADD COLUMN IF NOT EXISTS template_language VARCHAR(20) DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS template_header TEXT,
  ADD COLUMN IF NOT EXISTS template_parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS recipient_parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS recipient_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS campaign_name TEXT,
  ADD COLUMN IF NOT EXISTS brand_name TEXT;

DO $$
BEGIN
  IF to_regclass('public.campaign_import_recipients') IS NOT NULL THEN
    ALTER TABLE campaign_import_recipients
      ADD COLUMN IF NOT EXISTS template_parameters JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;
