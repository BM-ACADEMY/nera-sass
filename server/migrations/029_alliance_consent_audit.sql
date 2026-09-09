ALTER TABLE alliance_prospects
  ADD COLUMN IF NOT EXISTS consent_evidence TEXT,
  ADD COLUMN IF NOT EXISTS consent_scope VARCHAR(20);

ALTER TABLE alliance_prospects
  DROP CONSTRAINT IF EXISTS alliance_prospects_consent_scope_check;

ALTER TABLE alliance_prospects
  ADD CONSTRAINT alliance_prospects_consent_scope_check
  CHECK (consent_scope IS NULL OR consent_scope IN ('marketing', 'service', 'both'));
