INSERT INTO alliance_templates (
  audience, channel, touch_no, template_name, subject, body, provider_status, active
)
SELECT
  s.audience,
  'email',
  s.touch_no,
  'Touch ' || s.touch_no,
  CASE
    WHEN s.touch_no = 1 THEN 'Introduction for {{org}}'
    ELSE 'Follow-up ' || s.touch_no || ' for {{org}}'
  END,
  CASE
    WHEN s.touch_no = 1 THEN
      'Hi {{name}},' || E'\n\n' ||
      'Add your introduction for {{org}} here.' || E'\n\n' ||
      'To stop receiving these, reply "unsubscribe".'
    ELSE
      'Hi {{name}},' || E'\n\n' ||
      'Add your follow-up message for {{org}} here.' || E'\n\n' ||
      'To stop receiving these, reply "unsubscribe".'
  END,
  'draft',
  TRUE
FROM alliance_sequences AS s
WHERE s.channel = 'email'
  AND s.active = TRUE
ON CONFLICT (audience, channel, touch_no) DO NOTHING;
