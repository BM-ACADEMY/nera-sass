CREATE TABLE IF NOT EXISTS alliance_inbox_settings (
  id BIGSERIAL PRIMARY KEY,
  phone_number_id VARCHAR(100) NOT NULL UNIQUE,
  waba_id VARCHAR(100),
  display_phone_number VARCHAR(30),
  verified_name VARCHAR(150),
  access_token_env VARCHAR(100) NOT NULL DEFAULT 'ALLIANCE_WA_ACCESS_TOKEN',
  webhook_verify_token_env VARCHAR(100) NOT NULL DEFAULT 'ALLIANCE_WA_VERIFY_TOKEN',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alliance_inbox_contacts (
  id BIGSERIAL PRIMARY KEY,
  wa_id VARCHAR(30) NOT NULL UNIQUE,
  phone VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(255),
  profile_name VARCHAR(255),
  status VARCHAR(30) NOT NULL DEFAULT 'new',
  interest VARCHAR(30),
  assigned_to BIGINT,
  source VARCHAR(100) NOT NULL DEFAULT 'whatsapp',
  custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alliance_inbox_conversations (
  id BIGSERIAL PRIMARY KEY,
  contact_id BIGINT NOT NULL UNIQUE REFERENCES alliance_inbox_contacts(id) ON DELETE CASCADE,
  phone_number_id VARCHAR(100) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  mode VARCHAR(20) NOT NULL DEFAULT 'manual',
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_message TEXT,
  last_message_at TIMESTAMPTZ,
  last_inbound_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS alliance_inbox_conversations_last_idx ON alliance_inbox_conversations(last_message_at DESC);

CREATE TABLE IF NOT EXISTS alliance_inbox_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES alliance_inbox_conversations(id) ON DELETE CASCADE,
  contact_id BIGINT NOT NULL REFERENCES alliance_inbox_contacts(id) ON DELETE CASCADE,
  wa_msg_id VARCHAR(255) UNIQUE,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound','outbound')),
  msg_type VARCHAR(20) NOT NULL DEFAULT 'text',
  content TEXT,
  media_id VARCHAR(255),
  media_url TEXT,
  mime_type VARCHAR(150),
  filename VARCHAR(255),
  status VARCHAR(30) NOT NULL DEFAULT 'received',
  reply_to_wa_msg_id VARCHAR(255),
  reactions JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_starred BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  pinned_until TIMESTAMPTZ,
  error_message TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS alliance_inbox_messages_conversation_idx ON alliance_inbox_messages(conversation_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS alliance_inbox_media (
  id BIGSERIAL PRIMARY KEY,
  message_id BIGINT REFERENCES alliance_inbox_messages(id) ON DELETE SET NULL,
  media_id VARCHAR(255),
  storage_path TEXT,
  public_url TEXT,
  mime_type VARCHAR(150),
  filename VARCHAR(255),
  file_size BIGINT,
  direction VARCHAR(10) CHECK (direction IN ('inbound','outbound')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
