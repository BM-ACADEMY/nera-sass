CREATE TABLE IF NOT EXISTS alliance_inbox_tags (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  color VARCHAR(20) NOT NULL DEFAULT '#000000',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS alliance_contact_tags (
  contact_id BIGINT NOT NULL REFERENCES alliance_inbox_contacts(id) ON DELETE CASCADE,
  tag_id BIGINT NOT NULL REFERENCES alliance_inbox_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (contact_id, tag_id)
);
