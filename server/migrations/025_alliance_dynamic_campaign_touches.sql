ALTER TABLE alliance_campaign_templates
  DROP CONSTRAINT IF EXISTS alliance_campaign_templates_touch_no_check;
ALTER TABLE alliance_campaign_templates
  ADD CONSTRAINT alliance_campaign_templates_touch_no_check
  CHECK (touch_no BETWEEN 1 AND 10);

ALTER TABLE alliance_touches
  DROP CONSTRAINT IF EXISTS alliance_touches_touch_no_check;
ALTER TABLE alliance_touches
  ADD CONSTRAINT alliance_touches_touch_no_check
  CHECK (touch_no BETWEEN 1 AND 10);
