ALTER TABLE alliance_prospects
  DROP CONSTRAINT IF EXISTS alliance_prospects_channel_pref_check;

ALTER TABLE alliance_prospects
  DROP CONSTRAINT IF EXISTS alliance_prospects_channel_check;

ALTER TABLE alliance_prospects
  ADD CONSTRAINT alliance_prospects_channel_pref_check
  CHECK (channel_pref IS NULL OR channel_pref IN ('email', 'whatsapp', 'both'));

ALTER TABLE alliance_prospects
  ADD CONSTRAINT alliance_prospects_channel_check
  CHECK (channel IN ('email', 'whatsapp', 'both'));

-- Existing opted-in prospects with both contact methods become eligible on both channels.
UPDATE alliance_prospects
SET channel = 'both', channel_pref = 'both', updated_at = NOW()
WHERE email IS NOT NULL
  AND phone IS NOT NULL
  AND consent = TRUE
  AND NULLIF(BTRIM(consent_source), '') IS NOT NULL
  AND channel <> 'both';
