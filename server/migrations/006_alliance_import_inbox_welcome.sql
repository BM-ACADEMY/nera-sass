ALTER TABLE alliance_inbox_contacts ADD COLUMN IF NOT EXISTS prospect_id BIGINT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'alliance_inbox_contacts_prospect_id_fkey'
  ) THEN
    ALTER TABLE alliance_inbox_contacts
      ADD CONSTRAINT alliance_inbox_contacts_prospect_id_fkey
      FOREIGN KEY (prospect_id) REFERENCES alliance_prospects(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS alliance_inbox_contacts_prospect_unique
  ON alliance_inbox_contacts(prospect_id) WHERE prospect_id IS NOT NULL;

ALTER TABLE alliance_inbox_contacts ALTER COLUMN wa_id DROP NOT NULL;
ALTER TABLE alliance_inbox_contacts ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE alliance_templates ADD COLUMN IF NOT EXISTS language VARCHAR(20) NOT NULL DEFAULT 'en';

ALTER TABLE alliance_inbox_conversations ADD COLUMN IF NOT EXISTS welcome_status VARCHAR(30) NOT NULL DEFAULT 'not_eligible';
ALTER TABLE alliance_inbox_conversations ADD COLUMN IF NOT EXISTS welcome_template_name VARCHAR(255);
ALTER TABLE alliance_inbox_conversations ADD COLUMN IF NOT EXISTS welcome_wa_msg_id VARCHAR(255);
ALTER TABLE alliance_inbox_conversations ADD COLUMN IF NOT EXISTS welcome_sent_at TIMESTAMPTZ;
ALTER TABLE alliance_inbox_conversations ADD COLUMN IF NOT EXISTS welcome_error TEXT;

CREATE INDEX IF NOT EXISTS alliance_inbox_messages_welcome_queue_idx
  ON alliance_inbox_messages(status, created_at)
  WHERE direction = 'outbound' AND msg_type = 'template';

-- Link legacy inbox contacts first, then create contacts/conversations for
-- prospects imported before the Alliance Inbox integration was introduced.
UPDATE alliance_inbox_contacts c
SET prospect_id = p.id,
    name = COALESCE(c.name, p.name, p.business_name),
    source = COALESCE(c.source, p.source, 'file_upload'),
    custom_fields = c.custom_fields || jsonb_build_object(
      'business_name', p.business_name,
      'audience', p.audience,
      'email', p.email
    ),
    updated_at = NOW()
FROM alliance_prospects p
WHERE c.prospect_id IS NULL
  AND c.phone IS NOT NULL
  AND p.phone = c.phone
  AND NOT EXISTS (
    SELECT 1 FROM alliance_inbox_contacts linked WHERE linked.prospect_id = p.id
  );

INSERT INTO alliance_inbox_contacts
  (prospect_id, wa_id, phone, name, profile_name, source, custom_fields)
SELECT p.id, p.phone, p.phone, COALESCE(p.name, p.business_name),
       COALESCE(p.name, p.business_name), COALESCE(p.source, 'file_upload'),
       jsonb_build_object('business_name', p.business_name, 'audience', p.audience, 'email', p.email)
FROM alliance_prospects p
WHERE NOT EXISTS (
  SELECT 1 FROM alliance_inbox_contacts c WHERE c.prospect_id = p.id
)
AND NOT EXISTS (
  SELECT 1 FROM alliance_inbox_contacts c WHERE p.phone IS NOT NULL AND c.phone = p.phone
);

INSERT INTO alliance_inbox_conversations
  (contact_id, phone_number_id, welcome_status)
SELECT c.id,
       COALESCE((SELECT s.phone_number_id FROM alliance_inbox_settings s WHERE s.active = TRUE ORDER BY s.id LIMIT 1), 'unconfigured'),
       CASE WHEN p.phone IS NOT NULL AND p.consent = TRUE THEN 'not_queued' ELSE 'not_eligible' END
FROM alliance_inbox_contacts c
LEFT JOIN alliance_prospects p ON p.id = c.prospect_id
WHERE NOT EXISTS (
  SELECT 1 FROM alliance_inbox_conversations cv WHERE cv.contact_id = c.id
);
