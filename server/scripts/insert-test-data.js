/**
 * Insert Test Data into LeadOS Database
 * Run: node server/scripts/insert-test-data.js
 */

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host: process.env.DB_HOST || 'leados-api.abmgroups.org',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'leados_db',
  user: process.env.DB_USER || 'leados_user',
  password: process.env.DB_PASS || 'LeadOS_DB@2026',
});

async function insertTestData() {
  console.log('🔄 Connecting to database...');

  try {
    const client = await pool.connect();
    console.log('✅ Connected to database');

    // Get BM Academy client
    const bmAcademy = await client.query(`SELECT id FROM clients WHERE name = 'BM Academy' LIMIT 1`);
    const bmAcademyId = bmAcademy.rows[0]?.id;

    if (!bmAcademyId) {
      console.log('❌ BM Academy not found. Please run setup-db.js first.');
      process.exit(1);
    }
    console.log('📍 BM Academy ID:', bmAcademyId);

    // 1. Create test user
    console.log('\n📝 Creating test user...');
    const hash = await bcrypt.hash('test123', 10);
    try {
      await client.query(`
        INSERT INTO users (name, email, password_hash, role, is_active)
        VALUES ('Test Sales Agent', 'test@abmgroups.org', $1, 'agent', true)
      `, [hash]);
      console.log('✅ Test user created');
    } catch (e) {
      console.log('⏭️  Test user already exists');
    }

    // 2. Delete existing test leads with these phone numbers (to avoid unique constraint)
    console.log('\n📝 Cleaning up existing test leads...');
    await client.query(`DELETE FROM leads WHERE phone LIKE '91999999%'`);
    console.log('✅ Cleanup done');

    // 3. Create test leads
    console.log('\n📝 Creating test leads...');

    const testLeads = [
      { name: 'Test Lead Dedup', phone: '919999999991', email: 'dedup@test.com', status: 'new', score: 10, nextHours: 1 },
      { name: 'Test Hot Lead', phone: '919999999992', email: 'hot@test.com', status: 'hot', score: 80, nextHours: 1 },
      { name: 'Test Followup Lead', phone: '919999999993', email: 'followup@test.com', status: 'new', score: 30, touch: 1, nextHours: -1 },
      { name: 'Test Booked Lead', phone: '919999999994', email: 'booked@test.com', status: 'new', score: 50, booked: true, nextHours: 1 },
      { name: 'Test Max Touch Lead', phone: '919999999995', email: 'maxtouch@test.com', status: 'new', score: 20, touch: 5, nextHours: -1 },
      { name: 'Test Optout Lead', phone: '919999999996', email: 'optout@test.com', status: 'new', score: 15, nextHours: -1 },
      { name: 'Test Converted Lead', phone: '919999999997', email: 'converted@test.com', status: 'converted', score: 100, nextHours: 1 },
      { name: 'Test Booking FAQ', phone: '919999999998', email: 'booking@test.com', status: 'warm', score: 60, nextHours: 1 },
      { name: 'Test Reminder Lead', phone: '919999999999', email: 'reminder@test.com', status: 'hot', score: 75, nextHours: 1 },
    ];

    for (const lead of testLeads) {
      let nextDue = lead.nextHours > 0
        ? new Date(Date.now() + lead.nextHours * 3600000)
        : new Date(Date.now() - 3600000);

      await client.query(`
        INSERT INTO leads (name, phone, email, source, client_id, status, score, next_followup_due, touch_count, call_booked_at)
        VALUES ($1, $2, $3, 'whatsapp', $4, $5, $6, $7, $8, $9)
      `, [
        lead.name, lead.phone, lead.email, bmAcademyId,
        lead.status, lead.score, nextDue,
        lead.touch || null,
        lead.booked ? new Date(Date.now() + 86400000) : null
      ]);
      console.log(`   ✅ ${lead.name} (${lead.phone})`);
    }

    // 4. Get lead IDs
    const leads = await client.query(`SELECT id, phone, name, status, score FROM leads WHERE phone LIKE '91999999%' ORDER BY phone`);
    console.log('\n📋 Created test leads:');
    leads.rows.forEach(l => console.log(`   ${l.phone} - ${l.name} (ID: ${l.id})`));

    // 5. Create payment for converted lead
    const convertedLead = leads.rows.find(l => l.phone === '919999999997');
    if (convertedLead) {
      await client.query(`
        INSERT INTO payments (lead_id, amount, currency, status, razorpay_payment_id)
        VALUES ($1, 14999, 'INR', 'captured', 'test_payment_001')
      `, [convertedLead.id]);
      console.log('\n✅ Test payment created');
    }

    // 6. Create test campaigns
    try {
      await client.query(`
        INSERT INTO campaigns (name, client_id, status, scheduled_at)
        VALUES ('Test Campaign 1', $1, 'scheduled', NOW())
      `, [bmAcademyId]);
      console.log('✅ Test campaigns created');
    } catch (e) {
      console.log('⏭️  Campaign already exists');
    }

    // 7. Create brain docs
    try {
      await client.query(`
        INSERT INTO brain_docs (client_id, doc_type, content)
        VALUES
          ($1, 'prompt', 'BM Academy - Digital Marketing courses: DM Pro ₹14999, DM Starter ₹7999. Duration 3-5 months.'),
          ($1, 'training', 'Always greet with first name. Never ask for info already provided.'),
          ($1, 'product', 'Digital Marketing Pro: 3-5 months, hybrid mode, includes Meta & Google Ads, SEO, AI tools.'),
          ($1, 'pricing', 'Tier 1: ₹14999, Tier 2: ₹19999 (with placement). EMI available.')
      `, [bmAcademyId]);
      console.log('✅ Brain docs created');
    } catch (e) {
      console.log('⏭️  Brain docs already exist');
    }

    // 8. Verify
    console.log('\n📊 Verification:');
    const countLeads = await client.query(`SELECT COUNT(*) as c FROM leads WHERE phone LIKE '9199%'`);
    console.log(`   Test leads: ${countLeads.rows[0].c}`);

    const countCampaigns = await client.query(`SELECT COUNT(*) as c FROM campaigns WHERE name = 'Test Campaign 1'`);
    console.log(`   Campaigns: ${countLeads.rows[0].c > 0 ? 'Yes' : 'No'}`);

    console.log('\n🎉 Test data insertion complete!');
    console.log('\n📝 Next: Import TEST_WF*.json into n8n and activate');

    client.release();
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

insertTestData();
