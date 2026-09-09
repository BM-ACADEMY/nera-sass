CREATE TABLE IF NOT EXISTS alliance_audiences (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  label VARCHAR(150) NOT NULL,
  brand VARCHAR(100),
  default_channel VARCHAR(20) NOT NULL DEFAULT 'email' CHECK (default_channel IN ('email','whatsapp')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alliance_audience_fields (
  id BIGSERIAL PRIMARY KEY,
  audience_id BIGINT NOT NULL REFERENCES alliance_audiences(id) ON DELETE CASCADE,
  field_key VARCHAR(60) NOT NULL CHECK (field_key ~ '^[a-z][a-z0-9_]*$'),
  label VARCHAR(150) NOT NULL,
  data_type VARCHAR(20) NOT NULL DEFAULT 'text' CHECK (data_type IN ('text','integer','number','boolean','date')),
  required BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (audience_id, field_key)
);

ALTER TABLE alliance_prospects ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE alliance_prospects DROP CONSTRAINT IF EXISTS alliance_prospects_audience_check;
ALTER TABLE alliance_campaigns DROP CONSTRAINT IF EXISTS alliance_campaigns_audience_check;
ALTER TABLE alliance_sequences DROP CONSTRAINT IF EXISTS alliance_sequences_audience_check;
ALTER TABLE alliance_templates DROP CONSTRAINT IF EXISTS alliance_templates_audience_check;
ALTER TABLE alliance_kb DROP CONSTRAINT IF EXISTS alliance_kb_audience_check;
ALTER TABLE alliance_objections DROP CONSTRAINT IF EXISTS alliance_objections_audience_check;

INSERT INTO alliance_audiences (code, label, brand, default_channel) VALUES
  ('college', 'College principals / TPOs', 'BM Academy', 'email'),
  ('hr', 'Company HR / corporates', 'CoreTalents', 'email'),
  ('smb', 'Local clinics / shops / SMBs', 'BM TechX', 'email'),
  ('iv', 'IV trip coordinators', 'TravellersNeed', 'email')
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  brand = EXCLUDED.brand;

CREATE INDEX IF NOT EXISTS alliance_prospects_custom_fields_idx
  ON alliance_prospects USING GIN (custom_fields);
