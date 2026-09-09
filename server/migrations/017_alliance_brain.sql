-- AI Brain: real brand/offering/FAQ data that the AI reply-suggestion prompts
-- (email + WhatsApp) read from, replacing the previously hardcoded frontend mock.

CREATE TABLE IF NOT EXISTS alliance_brands (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  audience VARCHAR(50) REFERENCES alliance_audiences(code) ON DELETE SET NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  phone VARCHAR(30),
  whatsapp VARCHAR(30),
  email VARCHAR(150),
  website VARCHAR(255),
  address TEXT,
  business_hours VARCHAR(150),
  languages VARCHAR(255),
  target_customers TEXT,
  primary_contact VARCHAR(150),
  escalation_contact VARCHAR(150),
  escalation_phone VARCHAR(30),
  policies JSONB NOT NULL DEFAULT '{}'::jsonb,
  verified_by VARCHAR(150),
  last_verified_date DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alliance_offerings (
  id BIGSERIAL PRIMARY KEY,
  brand_id BIGINT NOT NULL REFERENCES alliance_brands(id) ON DELETE CASCADE,
  offering_code VARCHAR(50),
  offering_type VARCHAR(20) NOT NULL DEFAULT 'course' CHECK (offering_type IN ('course','service')),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  tier VARCHAR(50),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  short_description TEXT,
  fee VARCHAR(50),
  duration VARCHAR(100),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  verified_by VARCHAR(150),
  last_verified_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS alliance_offerings_brand_idx ON alliance_offerings(brand_id, status);

CREATE TABLE IF NOT EXISTS alliance_offering_faqs (
  id BIGSERIAL PRIMARY KEY,
  offering_id BIGINT NOT NULL REFERENCES alliance_offerings(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS alliance_offering_faqs_offering_idx ON alliance_offering_faqs(offering_id);
