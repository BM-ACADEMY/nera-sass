ALTER TABLE alliance_prospects ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE alliance_campaigns ADD COLUMN IF NOT EXISTS objective TEXT;
ALTER TABLE alliance_campaigns ADD COLUMN IF NOT EXISTS sender_domain_id BIGINT REFERENCES alliance_domains(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS alliance_campaign_prospects (
  campaign_id BIGINT NOT NULL REFERENCES alliance_campaigns(id) ON DELETE CASCADE,
  prospect_id BIGINT NOT NULL REFERENCES alliance_prospects(id) ON DELETE CASCADE,
  enrollment_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  current_touch SMALLINT NOT NULL DEFAULT 0,
  next_touch_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  stop_reason VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, prospect_id)
);
CREATE INDEX IF NOT EXISTS alliance_campaign_prospects_prospect_idx ON alliance_campaign_prospects(prospect_id);

INSERT INTO alliance_campaign_prospects (campaign_id, prospect_id)
SELECT campaign_id, id FROM alliance_prospects WHERE campaign_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS alliance_campaign_templates (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES alliance_campaigns(id) ON DELETE CASCADE,
  touch_no SMALLINT NOT NULL CHECK (touch_no BETWEEN 1 AND 4),
  delay_days SMALLINT NOT NULL CHECK (delay_days BETWEEN 0 AND 30),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, touch_no)
);

ALTER TABLE alliance_touches DROP CONSTRAINT IF EXISTS alliance_touches_prospect_id_touch_no_key;
CREATE UNIQUE INDEX IF NOT EXISTS alliance_touches_campaign_prospect_touch_unique
  ON alliance_touches(campaign_id, prospect_id, touch_no);

INSERT INTO alliance_templates (audience, channel, touch_no, subject, body, provider_status, active) VALUES
('college','email',1,'Placement-focused digital skills for {{org}} students','Dear {{name}},\n\nI am Kamar from BM Academy, Pondicherry. We run job-focused digital skills programs with real placement support — 1400+ students trained, 150+ placed, and a 4.8 star rating.\n\nCould we explore a training and placement partnership with {{org}}?\n\n— Kamar, ABM Groups, Pondicherry\nTo stop receiving these, reply "unsubscribe".','approved',TRUE),
('college','email',2,'Re: Placement partnership for {{org}}','Hi {{name}},\n\nJust following up about a placement-focused skills partnership for {{org}}. Shall I send the one-page overview?\n\n— Kamar, ABM Groups, Pondicherry\nTo stop receiving these, reply "unsubscribe".','approved',TRUE),
('college','email',3,'How other TN colleges use this','Hi {{name}},\n\nWe run training on campus, provide genuine placement support, and help colleges achieve measurable placement outcomes. Would a 15-minute discussion be useful for {{org}}?\n\n— Kamar, ABM Groups, Pondicherry\nTo stop receiving these, reply "unsubscribe".','approved',TRUE),
('college','email',4,'Should I close this for now?','Hi {{name}},\n\nIf a student placement partnership is not a priority this term, I will leave it here. If it is, reply and I will send the MoU overview.\n\n— Kamar, ABM Groups, Pondicherry\nTo stop receiving these, reply "unsubscribe".','approved',TRUE),
('hr','email',1,'Trained candidates for {{org}} hiring','Dear {{name}},\n\nI am Kamar from CoreTalents. We place trained, screened digital and tech candidates on a pay-on-join basis. If {{org}} is hiring, may I share a few matching profiles?\n\n— Kamar, ABM Groups, Pondicherry\nTo stop receiving these, reply "unsubscribe".','approved',TRUE),
('hr','email',2,'Re: Candidates for {{org}}','Hi {{name}},\n\nHappy to share two or three relevant profiles with no obligation. Which roles is {{org}} currently hiring for?\n\n— Kamar, ABM Groups, Pondicherry\nTo stop receiving these, reply "unsubscribe".','approved',TRUE),
('hr','email',3,'Pay only when they join','Hi {{name}},\n\nWe source and screen, you interview, and you pay only after a successful join. Would you like matching profiles for {{org}}?\n\n— Kamar, ABM Groups, Pondicherry\nTo stop receiving these, reply "unsubscribe".','approved',TRUE),
('hr','email',4,'Closing the loop','Hi {{name}},\n\nIf hiring is not active now, I will stop here. Reply "later" for a future check-in, or reply now if you would like candidate profiles.\n\n— Kamar, ABM Groups, Pondicherry\nTo stop receiving these, reply "unsubscribe".','approved',TRUE),
('smb','email',1,'More local customers for {{org}}?','Hi {{name}},\n\nI am Kamar from BM TechX. We help local businesses get more customers through reels and local ads, starting at ₹8,999/month. Can I send two sample reels for {{org}}?\n\n— Kamar, ABM Groups, Pondicherry\nTo stop receiving these, reply "unsubscribe".','approved',TRUE),
('smb','email',2,'Re: reels for {{org}}','Hi {{name}},\n\nFollowing up — would you like two sample reels created for businesses like {{org}}?\n\n— Kamar, ABM Groups, Pondicherry\nTo stop receiving these, reply "unsubscribe".','approved',TRUE),
('smb','email',3,'What ₹8,999 gets you','Hi {{name}},\n\nThe package includes monthly reels, a local advertising campaign, and a simple lead system. Is it worth a quick look for {{org}}?\n\n— Kamar, ABM Groups, Pondicherry\nTo stop receiving these, reply "unsubscribe".','approved',TRUE),
('smb','email',4,'Last note','Hi {{name}},\n\nI will leave it here for now. If getting more local customers is a priority for {{org}}, reply and I will share the samples.\n\n— Kamar, ABM Groups, Pondicherry\nTo stop receiving these, reply "unsubscribe".','approved',TRUE),
('iv','email',1,'Industrial visit trips for {{org}} students','Dear {{name}},\n\nI am Kamar from TravellersNeed. We organise safe, end-to-end industrial visits for colleges. If {{org}} is planning an IV, may I share a custom plan?\n\n— Kamar, ABM Groups, Pondicherry\nTo stop receiving these, reply "unsubscribe".','approved',TRUE),
('iv','email',2,'Re: IV trip for {{org}}','Hi {{name}},\n\nI can send a sample itinerary and budget for your batch size. Approximately how many students are travelling from {{org}}?\n\n— Kamar, ABM Groups, Pondicherry\nTo stop receiving these, reply "unsubscribe".','approved',TRUE),
('iv','email',3,'Everything handled, one point of contact','Hi {{name}},\n\nWe provide one coordinator, safe transport, vetted stays, and a plan built around your dates and budget. Would you like a quote for {{org}}?\n\n— Kamar, ABM Groups, Pondicherry\nTo stop receiving these, reply "unsubscribe".','approved',TRUE),
('iv','email',4,'Shall I close this?','Hi {{name}},\n\nIf there is no IV planned now, I will step back. Reply "later" for a future check-in, or send the batch size if you would like a plan.\n\n— Kamar, ABM Groups, Pondicherry\nTo stop receiving these, reply "unsubscribe".','approved',TRUE)
ON CONFLICT (audience, channel, touch_no) DO NOTHING;
