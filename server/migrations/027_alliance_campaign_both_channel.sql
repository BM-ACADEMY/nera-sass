ALTER TABLE alliance_campaigns
  DROP CONSTRAINT IF EXISTS alliance_campaigns_channel_check;

ALTER TABLE alliance_campaigns
  ADD CONSTRAINT alliance_campaigns_channel_check
  CHECK (channel IN ('auto', 'email', 'whatsapp', 'both'));
