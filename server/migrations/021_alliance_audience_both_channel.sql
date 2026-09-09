ALTER TABLE alliance_audiences
  DROP CONSTRAINT IF EXISTS alliance_audiences_default_channel_check;

ALTER TABLE alliance_audiences
  ADD CONSTRAINT alliance_audiences_default_channel_check
  CHECK (default_channel IN ('email', 'whatsapp', 'both'));
