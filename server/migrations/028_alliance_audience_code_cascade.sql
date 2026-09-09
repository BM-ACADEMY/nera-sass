ALTER TABLE alliance_brands
  DROP CONSTRAINT IF EXISTS alliance_brands_audience_fkey;
ALTER TABLE alliance_brands
  ADD CONSTRAINT alliance_brands_audience_fkey
  FOREIGN KEY (audience) REFERENCES alliance_audiences(code)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE alliance_prompt_rules
  DROP CONSTRAINT IF EXISTS alliance_prompt_rules_audience_fkey;
ALTER TABLE alliance_prompt_rules
  ADD CONSTRAINT alliance_prompt_rules_audience_fkey
  FOREIGN KEY (audience) REFERENCES alliance_audiences(code)
  ON UPDATE CASCADE ON DELETE CASCADE;
