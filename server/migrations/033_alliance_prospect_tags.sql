CREATE TABLE IF NOT EXISTS alliance_prospect_tags (
  prospect_id BIGINT NOT NULL REFERENCES alliance_prospects(id) ON DELETE CASCADE,
  tag_id BIGINT NOT NULL REFERENCES alliance_inbox_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(prospect_id, tag_id)
);

CREATE INDEX IF NOT EXISTS alliance_prospect_tags_prospect_idx ON alliance_prospect_tags(prospect_id);
CREATE INDEX IF NOT EXISTS alliance_prospect_tags_tag_idx ON alliance_prospect_tags(tag_id);
