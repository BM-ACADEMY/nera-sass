ALTER TABLE alliance_sequences DROP CONSTRAINT IF EXISTS alliance_sequences_touch_no_check;
ALTER TABLE alliance_sequences ADD CONSTRAINT alliance_sequences_touch_no_check CHECK (touch_no BETWEEN 1 AND 10);

ALTER TABLE alliance_templates DROP CONSTRAINT IF EXISTS alliance_templates_touch_no_check;
ALTER TABLE alliance_templates ADD CONSTRAINT alliance_templates_touch_no_check CHECK (touch_no BETWEEN 1 AND 10);
