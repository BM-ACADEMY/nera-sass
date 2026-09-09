ALTER TABLE alliance_audience_fields
  DROP CONSTRAINT IF EXISTS alliance_audience_fields_data_type_check;

ALTER TABLE alliance_audience_fields
  ADD CONSTRAINT alliance_audience_fields_data_type_check
  CHECK (data_type IN ('auto','text','integer','number','boolean','date'));
