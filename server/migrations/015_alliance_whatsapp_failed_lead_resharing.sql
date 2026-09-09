-- Keeps client re-sharing workflow separate from the original WhatsApp delivery result.
ALTER TABLE alliance_whatsapp_campaign_recipients
  ADD COLUMN IF NOT EXISTS reshare_status VARCHAR(30) NOT NULL DEFAULT 'not_started'
    CHECK (reshare_status IN ('not_started','excluded','awaiting_confirmation','confirmed','reshared')),
  ADD COLUMN IF NOT EXISTS reshare_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reshare_updated_by BIGINT;

CREATE INDEX IF NOT EXISTS alliance_wa_recipients_reshare_idx
  ON alliance_whatsapp_campaign_recipients(campaign_id, reshare_status)
  WHERE status = 'failed';
