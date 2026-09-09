CREATE TABLE IF NOT EXISTS lead_tags (
  lead_id INT REFERENCES leads(id) ON DELETE CASCADE,
  tag_id INT REFERENCES alliance_inbox_tags(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (lead_id, tag_id)
);
