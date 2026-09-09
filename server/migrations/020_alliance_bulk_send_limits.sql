CREATE TABLE IF NOT EXISTS alliance_bulk_send_limits (
  channel VARCHAR(20) PRIMARY KEY CHECK (channel IN ('email','whatsapp')),
  limit_mode VARCHAR(20) NOT NULL DEFAULT 'unlimited' CHECK (limit_mode IN ('unlimited','custom')),
  custom_limit INTEGER CHECK (custom_limit IS NULL OR custom_limit BETWEEN 1 AND 100000),
  updated_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO alliance_bulk_send_limits (channel, limit_mode, custom_limit)
VALUES ('email','unlimited',NULL), ('whatsapp','unlimited',NULL)
ON CONFLICT (channel) DO NOTHING;
