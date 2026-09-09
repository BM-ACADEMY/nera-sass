ALTER TABLE alliance_audiences ADD COLUMN IF NOT EXISTS template_samples JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE alliance_audience_fields ADD COLUMN IF NOT EXISTS sample_value TEXT;

UPDATE alliance_audiences SET template_samples = CASE code
  WHEN 'college' THEN '[{"name":"The Principal","business_name":"Example Engineering College","email":"principal@example.edu","phone":"919876543210","audience":"college","industry":"Education","location":"Chennai","source":"manual_research","channel_pref":"email","consent":"false","consent_source":""}]'::jsonb
  WHEN 'hr' THEN '[{"name":"HR Manager","business_name":"Example Software Company","email":"hr@example.com","phone":"919876543211","audience":"hr","industry":"IT Services","location":"Chennai","source":"company_directory","channel_pref":"email","consent":"false","consent_source":""}]'::jsonb
  WHEN 'smb' THEN '[{"name":"Dr. Meena","business_name":"Example Dental Clinic","email":"meena@example.com","phone":"919876543212","audience":"smb","industry":"Healthcare","location":"Pondicherry","source":"manual_research","channel_pref":"email","consent":"false","consent_source":""}]'::jsonb
  WHEN 'iv' THEN '[{"name":"IV Coordinator","business_name":"Example Arts and Science College","email":"iv@example.edu","phone":"919876543213","audience":"iv","industry":"Education","location":"Tiruvannamalai","source":"college_directory","channel_pref":"email","consent":"false","consent_source":""}]'::jsonb
  ELSE template_samples END
WHERE jsonb_array_length(template_samples) = 0;
