-- =====================================================
-- LeadOS Workflows Test Data Setup
-- Run this to set up all test data for workflow testing
-- =====================================================

-- 1. Create test users for owner assignment
INSERT INTO users (name, email, role, status)
VALUES
  ('Test Sales Agent', 'test@abmgroups.org', 'sales', 'active'),
  ('Test Admin', 'admin@abmgroups.org', 'admin', 'active')
ON CONFLICT DO NOTHING;

-- Get the user ID for testing
DO $$
DECLARE
  test_user_id INTEGER;
BEGIN
  SELECT id INTO test_user_id FROM users WHERE email = 'test@abmgroups.org' LIMIT 1;
  RAISE NOTICE 'Test user ID: %', test_user_id;
END $$;

-- 2. Create test clients/brands if not exist
INSERT INTO clients (name, phone_number_id, wa_access_token)
VALUES
  ('BM Academy', 'test_phone_id_1', 'test_token_1'),
  ('BM TechX', 'test_phone_id_2', 'test_token_2')
ON CONFLICT DO NOTHING;

-- 3. Create test leads for different scenarios
-- Lead 1: New lead for Lead Integrator (dedup test)
INSERT INTO leads (name, phone, email, source, client_id, status, score, next_followup_due)
VALUES ('Test Lead Dedup', '919999999991', 'dedup@test.com', 'whatsapp',
  (SELECT id FROM clients WHERE name = 'BM Academy' LIMIT 1), 'new', 10, NOW() + INTERVAL '1 hour')
ON CONFLICT DO NOTHING;

-- Lead 2: Hot lead for Sales Engine (owner test)
INSERT INTO leads (name, phone, email, source, client_id, status, score, next_followup_due)
VALUES ('Test Hot Lead', '919999999992', 'hot@test.com', 'whatsapp',
  (SELECT id FROM clients WHERE name = 'BM Academy' LIMIT 1), 'hot', 80, NOW() + INTERVAL '1 hour')
ON CONFLICT DO NOTHING;

-- Lead 3: Lead due for follow-up (Follow-up Engine test)
INSERT INTO leads (name, phone, email, source, client_id, status, score, next_followup_due, touch_count)
VALUES ('Test Followup Lead', '919999999993', 'followup@test.com', 'whatsapp',
  (SELECT id FROM clients WHERE name = 'BM Academy' LIMIT 1), 'new', 30, NOW() - INTERVAL '1 hour', 1)
ON CONFLICT DO NOTHING;

-- Lead 4: Lead with booked call (stop follow-up test)
INSERT INTO leads (name, phone, email, source, client_id, status, score, next_followup_due, call_booked_at)
VALUES ('Test Booked Lead', '919999999994', 'booked@test.com', 'whatsapp',
  (SELECT id FROM clients WHERE name = 'BM Academy' LIMIT 1), 'new', 50, NOW() + INTERVAL '1 hour', NOW() + INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- Lead 5: Lead with max touch count (stop after 5 attempts)
INSERT INTO leads (name, phone, email, source, client_id, status, score, next_followup_due, touch_count)
VALUES ('Test Max Touch Lead', '919999999995', 'maxtouch@test.com', 'whatsapp',
  (SELECT id FROM clients WHERE name = 'BM Academy' LIMIT 1), 'new', 20, NOW() - INTERVAL '1 hour', 5)
ON CONFLICT DO NOTHING;

-- Lead 6: Cold lead for opt-out test
INSERT INTO leads (name, phone, email, source, client_id, status, score, next_followup_due)
VALUES ('Test Optout Lead', '919999999996', 'optout@test.com', 'whatsapp',
  (SELECT id FROM clients WHERE name = 'BM Academy' LIMIT 1), 'new', 15, NOW() - INTERVAL '1 hour')
ON CONFLICT DO NOTHING;

-- Lead 7: Converted lead (Customer Journey test)
INSERT INTO leads (name, phone, email, source, client_id, status, score, next_followup_due)
VALUES ('Test Converted Lead', '919999999997', 'converted@test.com', 'website',
  (SELECT id FROM clients WHERE name = 'BM Academy' LIMIT 1), 'converted', 100, NOW() + INTERVAL '1 hour')
ON CONFLICT DO NOTHING;

-- Lead 8: Lead for AI response test (mid-booking FAQ)
INSERT INTO leads (name, phone, email, source, client_id, status, score, next_followup_due)
VALUES ('Test Booking FAQ', '919999999998', 'booking@test.com', 'whatsapp',
  (SELECT id FROM clients WHERE name = 'BM Academy' LIMIT 1), 'warm', 60, NOW() + INTERVAL '1 hour')
ON CONFLICT DO NOTHING;

-- Lead 9: Morning reminder test
INSERT INTO leads (name, phone, email, source, client_id, status, score, next_followup_due)
VALUES ('Test Reminder Lead', '919999999999', 'reminder@test.com', 'whatsapp',
  (SELECT id FROM clients WHERE name = 'BM Academy' LIMIT 1), 'hot', 75, NOW() + INTERVAL '1 hour')
ON CONFLICT DO NOTHING;

-- 4. Create test payments for Customer Journey
INSERT INTO payments (lead_id, amount, currency, status, razorpay_payment_id)
SELECT id, 14999, 'INR', 'captured', 'test_payment_001'
FROM leads WHERE phone = '919999999997'
ON CONFLICT DO NOTHING;

-- 5. Create test campaigns for Marketing Automation
INSERT INTO campaigns (name, client_id, status, scheduled_at, audience_filter)
VALUES
  ('Test Campaign 1', (SELECT id FROM clients WHERE name = 'BM Academy' LIMIT 1), 'scheduled', NOW(), 'all'),
  ('Test Campaign 2', (SELECT id FROM clients WHERE name = 'BM TechX' LIMIT 1), 'scheduled', NOW(), 'new')
ON CONFLICT DO NOTHING;

-- 6. Create test conversations for message tests
INSERT INTO conversations (lead_id, tenant_id, phone, status, last_message, last_message_at)
SELECT l.id, 1, l.phone, 'open', 'Test message', NOW()
FROM leads l WHERE l.phone IN ('919999999991', '919999999992', '919999999993')
ON CONFLICT DO NOTHING;

-- 7. Create test messages for AI performance
INSERT INTO messages (conversation_id, direction, msg_type, content, status, is_ai, sent_at)
SELECT c.id, 'inbound', 'text', 'Hi I want to know about courses', 'delivered', false, NOW() - INTERVAL '1 hour'
FROM conversations c
JOIN leads l ON c.lead_id = l.id
WHERE l.phone = '919999999992'
ON CONFLICT DO NOTHING;

-- 8. Create test workflow logs
INSERT INTO workflow_logs (workflow, lead_id, status, message, created_at)
VALUES
  ('WF00', (SELECT id FROM leads WHERE phone = '919999999991'), 'success', 'Lead created', NOW() - INTERVAL '2 hours'),
  ('WF01', (SELECT id FROM leads WHERE phone = '919999999992'), 'success', 'AI response sent', NOW() - INTERVAL '1 hour'),
  ('WF02', (SELECT id FROM leads WHERE phone = '919999999993'), 'success', 'Follow-up sent', NOW() - INTERVAL '30 minutes')
ON CONFLICT DO NOTHING;

-- 9. Create brain docs for KB testing
INSERT INTO brain_docs (client_id, doc_type, content)
SELECT c.id, 'prompt', 'BM Academy - Digital Marketing courses: DM Pro ₹14999, DM Starter ₹7999. Duration 3-5 months. Placement assistance available.'
FROM clients c WHERE c.name = 'BM Academy'
ON CONFLICT DO NOTHING;

INSERT INTO brain_docs (client_id, doc_type, content)
SELECT c.id, 'training', 'Always greet with first name. Never ask for info already provided.'
FROM clients c WHERE c.name = 'BM Academy'
ON CONFLICT DO NOTHING;

INSERT INTO brain_docs (client_id, doc_type, content)
SELECT c.id, 'product', 'Digital Marketing Pro: 3-5 months, hybrid mode, includes Meta & Google Ads, SEO, AI tools.'
FROM clients c WHERE c.name = 'BM Academy'
ON CONFLICT DO NOTHING;

INSERT INTO brain_docs (client_id, doc_type, content)
SELECT c.id, 'pricing', 'Tier 1: ₹14999, Tier 2: ₹19999 (with placement). EMI available.'
FROM clients c WHERE c.name = 'BM Academy'
ON CONFLICT DO NOTHING;

-- 10. Create test sales tasks
INSERT INTO sales_tasks (lead_id, type, status, created_at)
SELECT l.id, 'followup', 'pending', NOW() - INTERVAL '2 hours'
FROM leads l WHERE l.phone IN ('919999999993', '919999999999')
ON CONFLICT DO NOTHING;

-- Verify test data
SELECT 'Leads created:' AS info, COUNT(*) AS count FROM leads WHERE phone LIKE '9199%';
SELECT 'Clients created:' AS info, COUNT(*) AS count FROM clients;
SELECT 'Campaigns created:' AS info, COUNT(*) AS count FROM campaigns;
