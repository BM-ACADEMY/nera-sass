/**
 * Fix test data to ensure follow-ups are due
 */

const { Pool } = require('pg');

const pool = new Pool({
  host: 'leados-api.abmgroups.org',
  port: 5432,
  database: 'leados_db',
  user: 'leados_user',
  password: 'LeadOS_DB@2026',
});

async function fixTestData() {
  const client = await pool.connect();

  console.log('🔄 Updating test leads for follow-up testing...\n');

  // Lead 673 - Hot lead, should have owner assigned
  await client.query(`
    UPDATE leads SET next_followup_due = NOW() + INTERVAL '1 hour', status = 'hot', score = 80 WHERE phone = '919999999992'
  `);
  console.log('✅ Updated: Test Hot Lead (ID 673) - status=hot, score=80');

  // Lead 674 - Due for follow-up (past timestamp)
  await client.query(`
    UPDATE leads SET next_followup_due = NOW() - INTERVAL '30 minutes', status = 'new', score = 30, touch_count = 1 WHERE phone = '919999999993'
  `);
  console.log('✅ Updated: Test Followup Lead (ID 674) - due NOW, touch_count=1');

  // Lead 675 - Booked (should NOT appear in follow-ups)
  await client.query(`
    UPDATE leads SET next_followup_due = NOW() + INTERVAL '1 hour', status = 'new', call_booked_at = NOW() + INTERVAL '1 day' WHERE phone = '919999999994'
  `);
  console.log('✅ Updated: Test Booked Lead (ID 675) - call_booked_at set');

  // Lead 676 - Max touch count (should NOT appear - 5 touches)
  await client.query(`
    UPDATE leads SET next_followup_due = NOW() - INTERVAL '30 minutes', status = 'new', touch_count = 5 WHERE phone = '919999999995'
  `);
  console.log('✅ Updated: Test Max Touch Lead (ID 676) - touch_count=5 (max)');

  // Lead 677 - Opt-out (should NOT appear)
  await client.query(`
    UPDATE leads SET next_followup_due = NOW() - INTERVAL '30 minutes', status = 'opt-out' WHERE phone = '919999999996'
  `);
  console.log('✅ Updated: Test Optout Lead (ID 677) - status=opt-out');

  // Lead 672 - New lead for dedup test
  await client.query(`
    UPDATE leads SET next_followup_due = NOW() + INTERVAL '1 hour', status = 'new', score = 10 WHERE phone = '919999999991'
  `);
  console.log('✅ Updated: Test Lead Dedup (ID 672) - status=new');

  // Verify
  const leads = await client.query(`
    SELECT id, phone, name, status, score, touch_count, next_followup_due, call_booked_at,
           CASE WHEN next_followup_due <= NOW() THEN 'DUE' ELSE 'NOT DUE' END as due_status
    FROM leads WHERE phone LIKE '91999999%' ORDER BY phone
  `);

  console.log('\n📋 Updated Test Leads:');
  console.log('ID   Phone          Name                  Status    Score Touch Due');
  console.log('---- -------------- --------------------- --------- ----- ----- ----');
  leads.rows.forEach(l => {
    console.log(`${String(l.id).padEnd(4)} ${l.phone} ${String(l.name).padEnd(20)} ${String(l.status).padEnd(9)} ${String(l.score).padEnd(5)} ${String(l.touch_count || 0).padEnd(4)} ${l.due_status}`);
  });

  client.release();
  await pool.end();
  console.log('\n✅ Test data fixed!');
}

fixTestData().catch(console.error);
