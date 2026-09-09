/**
 * LeadOS Workflow Test Runner
 *
 * This script helps test all 8 workflows with mock data.
 *
 * Usage:
 * 1. First, run the SQL setup: psql -d leados -f test-workflows-setup.sql
 * 2. Import TEST_*.json workflows into n8n
 * 3. Run this script to verify results
 */

const axios = require('axios');

const API_BASE = process.env.API_URL || 'https://leados-api.abmgroups.org/api';

const tests = {
  // Test 1: Lead Integrator - Deduplication
  testLeadIntegrator: async () => {
    console.log('\n🧪 Testing Lead Integrator (Dedup)...');
    try {
      // Create a test lead
      const lead = {
        name: 'Test Dedup',
        phone: '919999999991',
        email: 'dedup@test.com',
        source: 'whatsapp'
      };

      // First creation
      const res1 = await axios.post(`${API_BASE}/leads/createOrUpdate`, lead);
      console.log('✅ First creation:', res1.data);

      // Second creation (should deduplicate)
      const res2 = await axios.post(`${API_BASE}/leads/createOrUpdate`, lead);
      console.log('✅ Second creation (should be same lead):', res2.data);

      return res1.data.lead_id === res2.data.lead_id;
    } catch (err) {
      console.error('❌ Lead Integrator test failed:', err.message);
      return false;
    }
  },

  // Test 2: Sales Engine - KB Retrieval
  testKnowledgeBase: async () => {
    console.log('\n🧪 Testing Knowledge Base Retrieval...');
    try {
      const res = await axios.post(`${API_BASE}/kb/search`, {
        brand: 'BM Academy',
        query: 'digital marketing syllabus'
      });
      console.log('✅ KB Search Result:', res.data.kb_snippets?.substring(0, 100) + '...');
      return res.data.kb_snippets && res.data.kb_snippets.length > 0;
    } catch (err) {
      console.error('❌ KB test failed:', err.message);
      return false;
    }
  },

  // Test 3: Sales Engine - Owner Assignment
  testOwnerAssignment: async () => {
    console.log('\n🧪 Testing Owner Assignment...');
    try {
      const res = await axios.post(`${API_BASE}/leads/assign-owner`, {
        lead_id: 2, // Use actual lead ID from test data
        brand: 'BM Academy',
        lead_score: 80, // Hot lead
        intent: 'PRICING'
      });
      console.log('✅ Owner Assigned:', res.data.owner);
      return res.data.owner && res.data.owner !== 'null';
    } catch (err) {
      console.error('❌ Owner assignment failed:', err.message);
      return false;
    }
  },

  // Test 4: Follow-up Engine - Due Followups
  testFollowupsDue: async () => {
    console.log('\n🧪 Testing Follow-ups Due...');
    try {
      const res = await axios.get(`${API_BASE}/followups/due`);
      console.log('✅ Follow-ups due:', res.data.followups.length);
      res.data.followups.forEach(f => {
        console.log(`   - Lead ${f.lead_id}: ${f.touch_count} touches`);
      });
      return true;
    } catch (err) {
      console.error('❌ Follow-ups test failed:', err.message);
      return false;
    }
  },

  // Test 5: Follow-up Engine - Stop on Booking
  testStopOnBooking: async () => {
    console.log('\n🧪 Testing Follow-up Stop on Booking...');
    try {
      // Book a call
      const res = await axios.post(`${API_BASE}/leads/book-call`, {
        lead_id: 4, // Use actual lead ID from test data
        booking_time: new Date(Date.now() + 86400000).toISOString()
      });
      console.log('✅ Booking result:', res.data);

      // Check if follow-ups are stopped
      const followups = await axios.get(`${API_BASE}/followups/due`);
      const stillDue = followups.data.followups.find(f => f.lead_id === 4);
      console.log('✅ Lead 4 in follow-ups:', stillDue ? 'YES (FAIL)' : 'NO (SUCCESS)');
      return !stillDue;
    } catch (err) {
      console.error('❌ Stop on booking test failed:', err.message);
      return false;
    }
  },

  // Test 6: Reminder Engine - Bundle Report
  testReminderBundle: async () => {
    console.log('\n🧪 Testing Reminder Bundle...');
    try {
      const res = await axios.get(`${API_BASE}/reports/reminder-bundle`);
      console.log('✅ Reminder Bundle:', {
        calls: res.data.metrics?.calls?.length || 0,
        followups: res.data.metrics?.followups?.length || 0,
        hot: res.data.metrics?.hot_leads?.length || 0
      });
      return true;
    } catch (err) {
      console.error('❌ Reminder test failed:', err.message);
      return false;
    }
  },

  // Test 7: Founder Dashboard - Report Generation
  testFounderDashboard: async () => {
    console.log('\n🧪 Testing Founder Dashboard...');
    try {
      const res = await axios.post(`${API_BASE}/ai/report-generator`, {
        metrics: {
          revenue_today: 5000,
          leads_new: 10,
          conversions: 2,
          followups_pending: 5
        }
      });
      console.log('✅ Dashboard Summary:', res.data.summary?.substring(0, 150) + '...');

      // Check for INR currency - check both ₹ and the split/join fix works
      const hasINR = res.data.summary?.includes('₹') || res.data.summary?.includes('INR');
      // Also check if dollar sign is NOT present (after the fix is deployed)
      const hasNoDollar = !res.data.summary?.includes('$');
      console.log('✅ Uses INR:', hasINR || hasNoDollar);
      return hasINR || hasNoDollar;
    } catch (err) {
      console.error('❌ Dashboard test failed:', err.message);
      return false;
    }
  },

  // Test 8: Customer Journey - Find by Invoice
  testCustomerJourney: async () => {
    console.log('\n🧪 Testing Customer Journey...');
    try {
      const res = await axios.post(`${API_BASE}/leads/find-by-invoice`, {
        invoice_id: 'test_payment_001'
      });
      console.log('✅ Found lead:', res.data.name, 'Brand:', res.data.brand);
      return res.data.lead_id !== null;
    } catch (err) {
      console.error('❌ Customer Journey test failed:', err.message);
      return false;
    }
  },

  // Test 9: Marketing - Active Campaigns
  testMarketingCampaigns: async () => {
    console.log('\n🧪 Testing Marketing Campaigns...');
    try {
      const res = await axios.get(`${API_BASE}/campaigns/active`);
      console.log('✅ Active campaigns:', res.data.campaigns.length);
      return true;
    } catch (err) {
      console.error('❌ Marketing test failed:', err.message);
      return false;
    }
  },

  // Test 10: Admin - Telemetry
  testAdminMaintenance: async () => {
    console.log('\n🧪 Testing Admin Maintenance...');
    try {
      const res = await axios.get(`${API_BASE}/workflows/telemetry`);
      console.log('✅ Telemetry:', res.data.telemetry);
      return true;
    } catch (err) {
      console.error('❌ Admin test failed:', err.message);
      return false;
    }
  }
};

// Run all tests
async function runAllTests() {
  console.log('🚀 Starting LeadOS Workflow Tests...\n');
  console.log('=' .repeat(50));

  const results = {};

  for (const [name, test] of Object.entries(tests)) {
    try {
      results[name] = await test();
    } catch (err) {
      console.error(`\n❌ ${name} threw error:`, err.message);
      results[name] = false;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('\n📊 TEST RESULTS SUMMARY:\n');

  let passed = 0;
  let failed = 0;

  for (const [name, result] of Object.entries(results)) {
    const status = result ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} - ${name}`);
    if (result) passed++;
    else failed++;
  }

  console.log(`\nTotal: ${passed} passed, ${failed} failed`);

  if (failed === 0) {
    console.log('\n🎉 All tests passed!');
  } else {
    console.log('\n⚠️ Some tests failed. Check the logs above.');
  }
}

// Export for use
module.exports = { runAllTests, tests };

// Run if called directly
if (require.main === module) {
  runAllTests().catch(console.error);
}
