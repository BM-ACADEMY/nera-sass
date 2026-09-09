CREATE TABLE IF NOT EXISTS alliance_numbers (
  id BIGSERIAL PRIMARY KEY,
  label VARCHAR(100) NOT NULL,
  phone_number VARCHAR(30) NOT NULL UNIQUE,
  phone_number_id VARCHAR(100),
  waba_id VARCHAR(100),
  credential_ref VARCHAR(255),
  quality_rating VARCHAR(10) NOT NULL DEFAULT 'green' CHECK (quality_rating IN ('green','yellow','red')),
  warmup_stage INTEGER NOT NULL DEFAULT 1 CHECK (warmup_stage BETWEEN 1 AND 4),
  daily_cap INTEGER NOT NULL DEFAULT 10 CHECK (daily_cap BETWEEN 0 AND 80),
  sent_today INTEGER NOT NULL DEFAULT 0 CHECK (sent_today >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'inactive' CHECK (status IN ('active','inactive','paused')),
  paused_until TIMESTAMPTZ,
  last_reset TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alliance_domains (
  id BIGSERIAL PRIMARY KEY,
  inbox_email VARCHAR(255) NOT NULL UNIQUE,
  provider VARCHAR(50),
  credential_ref VARCHAR(255),
  warmup_stage INTEGER NOT NULL DEFAULT 1 CHECK (warmup_stage BETWEEN 1 AND 4),
  daily_cap INTEGER NOT NULL DEFAULT 20 CHECK (daily_cap BETWEEN 0 AND 50),
  sent_today INTEGER NOT NULL DEFAULT 0 CHECK (sent_today >= 0),
  reputation VARCHAR(20) NOT NULL DEFAULT 'unknown',
  status VARCHAR(20) NOT NULL DEFAULT 'inactive' CHECK (status IN ('active','inactive','paused')),
  last_reset TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alliance_campaigns (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  audience VARCHAR(20) NOT NULL CHECK (audience IN ('college','hr','smb','iv')),
  channel VARCHAR(20) NOT NULL DEFAULT 'auto' CHECK (channel IN ('auto','email','whatsapp')),
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','running','paused','completed','cancelled')),
  created_by BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS alliance_prospects (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT REFERENCES alliance_campaigns(id) ON DELETE SET NULL,
  audience VARCHAR(20) NOT NULL CHECK (audience IN ('college','hr','smb','iv')),
  name VARCHAR(255),
  business_name VARCHAR(255) NOT NULL,
  phone VARCHAR(30),
  email VARCHAR(255),
  industry VARCHAR(150),
  location VARCHAR(255),
  channel_pref VARCHAR(20) CHECK (channel_pref IN ('email','whatsapp')),
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('email','whatsapp')),
  consent BOOLEAN NOT NULL DEFAULT FALSE,
  consent_source VARCHAR(100),
  consent_at TIMESTAMPTZ,
  source VARCHAR(100) DEFAULT 'file_upload',
  status VARCHAR(30) NOT NULL DEFAULT 'new',
  ai_score INTEGER CHECK (ai_score BETWEEN 0 AND 100),
  suppressed BOOLEAN NOT NULL DEFAULT FALSE,
  current_touch SMALLINT NOT NULL DEFAULT 0 CHECK (current_touch BETWEEN 0 AND 4),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL),
  CHECK (channel <> 'whatsapp' OR consent = TRUE)
);

CREATE UNIQUE INDEX IF NOT EXISTS alliance_prospects_email_unique
  ON alliance_prospects (LOWER(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS alliance_prospects_phone_unique
  ON alliance_prospects (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS alliance_prospects_campaign_idx ON alliance_prospects(campaign_id);
CREATE INDEX IF NOT EXISTS alliance_prospects_status_idx ON alliance_prospects(status);

CREATE TABLE IF NOT EXISTS alliance_sequences (
  id BIGSERIAL PRIMARY KEY,
  audience VARCHAR(20) NOT NULL CHECK (audience IN ('college','hr','smb','iv')),
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('email','whatsapp')),
  touch_no SMALLINT NOT NULL CHECK (touch_no BETWEEN 1 AND 4),
  delay_days SMALLINT NOT NULL CHECK (delay_days BETWEEN 0 AND 30),
  purpose VARCHAR(255),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (audience, channel, touch_no)
);

CREATE TABLE IF NOT EXISTS alliance_touches (
  id BIGSERIAL PRIMARY KEY,
  prospect_id BIGINT NOT NULL REFERENCES alliance_prospects(id) ON DELETE CASCADE,
  campaign_id BIGINT REFERENCES alliance_campaigns(id) ON DELETE SET NULL,
  touch_no SMALLINT NOT NULL CHECK (touch_no BETWEEN 1 AND 4),
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('email','whatsapp')),
  number_id BIGINT REFERENCES alliance_numbers(id) ON DELETE SET NULL,
  domain_id BIGINT REFERENCES alliance_domains(id) ON DELETE SET NULL,
  message_body TEXT,
  subject TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'scheduled',
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  error_message TEXT,
  UNIQUE (prospect_id, touch_no)
);

CREATE TABLE IF NOT EXISTS alliance_replies (
  id BIGSERIAL PRIMARY KEY,
  prospect_id BIGINT NOT NULL REFERENCES alliance_prospects(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('email','whatsapp')),
  body TEXT NOT NULL,
  ai_intent VARCHAR(30),
  ai_draft TEXT,
  ai_score INTEGER CHECK (ai_score BETWEEN 0 AND 100),
  status VARCHAR(20) NOT NULL DEFAULT 'new',
  routed_to BIGINT,
  approved_by BIGINT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alliance_suppression (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255),
  phone VARCHAR(30),
  reason VARCHAR(255) NOT NULL DEFAULT 'manual',
  source VARCHAR(100) DEFAULT 'manual',
  created_by BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS alliance_suppression_email_unique
  ON alliance_suppression (LOWER(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS alliance_suppression_phone_unique
  ON alliance_suppression (phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS alliance_templates (
  id BIGSERIAL PRIMARY KEY,
  audience VARCHAR(20) NOT NULL CHECK (audience IN ('college','hr','smb','iv')),
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('email','whatsapp')),
  touch_no SMALLINT NOT NULL CHECK (touch_no BETWEEN 1 AND 4),
  template_name VARCHAR(255),
  subject TEXT,
  body TEXT NOT NULL,
  provider_status VARCHAR(30),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (audience, channel, touch_no)
);

CREATE TABLE IF NOT EXISTS alliance_kb (
  id BIGSERIAL PRIMARY KEY,
  audience VARCHAR(20) CHECK (audience IN ('college','hr','smb','iv')),
  brand VARCHAR(100) NOT NULL,
  fact_key VARCHAR(150) NOT NULL,
  fact_value TEXT NOT NULL,
  source_id VARCHAR(255),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  synced_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (brand, fact_key)
);

CREATE TABLE IF NOT EXISTS alliance_objections (
  id BIGSERIAL PRIMARY KEY,
  audience VARCHAR(20) CHECK (audience IN ('college','hr','smb','iv')),
  objection TEXT NOT NULL,
  approved_answer TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  approved_by BIGINT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alliance_prompts (
  id BIGSERIAL PRIMARY KEY,
  job VARCHAR(30) NOT NULL CHECK (job IN ('personalise','classify','draft','score')),
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('email','whatsapp','all')),
  prompt_text TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (job, channel, version)
);

INSERT INTO alliance_sequences (audience, channel, touch_no, delay_days, purpose)
SELECT audience, 'email', touch_no, delay_days, purpose
FROM (VALUES
  ('college'), ('hr'), ('smb'), ('iv')
) audiences(audience)
CROSS JOIN (VALUES
  (1, 0, 'Introduction and one clear ask'),
  (2, 2, 'Short friendly reminder'),
  (3, 5, 'New angle and proof'),
  (4, 9, 'Polite break-up message')
) touches(touch_no, delay_days, purpose)
ON CONFLICT (audience, channel, touch_no) DO NOTHING;

INSERT INTO alliance_sequences (audience, channel, touch_no, delay_days, purpose)
SELECT audience, 'whatsapp', touch_no, delay_days, purpose
FROM (VALUES
  ('college'), ('hr'), ('smb'), ('iv')
) audiences(audience)
CROSS JOIN (VALUES
  (1, 0, 'Approved introduction template'),
  (2, 4, 'One gentle follow-up')
) touches(touch_no, delay_days, purpose)
ON CONFLICT (audience, channel, touch_no) DO NOTHING;
