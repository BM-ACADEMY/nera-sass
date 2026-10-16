const test = require('node:test');
const assert = require('node:assert');
const { startTestDb, stopTestDb, clearCollections, seedTestPlans } = require('./setup');

test.before(async () => {
  await startTestDb();
});

test.after(async () => {
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearCollections();
  await seedTestPlans();
});

test('Client Management & Tenant Lifecycle Suite', async (t) => {
  const { Tenants, Clients, Subscriptions, Plans, Users, Invitations } = require('../models');
  const { runAsTenant, runAsSystem } = require('../services/tenantContext');
  const provisioning = require('../services/provisioning');
  const { sanitizeClient } = require('../services/clientSecrets');
  const { computeLifecycle, tenantLifecycle } = require('../services/lifecycle');

  await t.test('1. Atomic Provisioning: Creates tenant, 1-to-1 brand, subscription, and owner invitation', async () => {
    // Manual grants must be authorized by an active founder account.
    const founder = await runAsSystem(() => Users.create({ name: 'Founder', email: 'founder@nera.test', tenant_id: null, is_platform_staff: true, staff_role: 'founder', is_active: true }));
    const result = await provisioning.provisionTenant({
      business_name: 'Apex Global Logistics',
      owner_name: 'Vikram Mehta',
      owner_email: 'vikram@apexlogistics.com',
      plan_code: 'WA-STARTER',
      term_months: 12,
      payment: { method: 'manual_grant', reference: 'PILOT-REF-001', reason: 'Pilot client approved by the founder' },
      is_founding_client: true,
      settings: { language: 'en', currency: 'INR', timezone: 'Asia/Kolkata', tax_treatment: 'gst' },
      brand: { city: 'Mumbai', phone: '+919876543210' },
    }, { actorUserId: founder.id }); // manual grants record the authorizing founder

    assert.ok(result.tenant?.id);
    assert.strictEqual(result.tenant.name, 'Apex Global Logistics');
    assert.strictEqual(result.tenant.is_founding_client, true);

    // Verify 1-to-1 Brand (Client)
    assert.ok(result.client?.id);
    assert.strictEqual(result.client.name, 'Apex Global Logistics');
    assert.strictEqual(result.client.city, 'Mumbai');

    // Brand must be scoped to this tenant
    const savedBrand = await runAsTenant(result.tenant.id, () => Clients.findOne({ id: result.client.id }).lean());
    assert.strictEqual(savedBrand.tenant_id, result.tenant.id);

    // Verify subscription created with correct term and limits
    assert.ok(result.subscription);
    assert.strictEqual(result.subscription.plan_code, 'WA-STARTER');
    assert.strictEqual(result.subscription.limits.max_users, 3);
    assert.strictEqual(result.subscription.term_months, 12);

    // Verify owner invitation created
    assert.ok(result.invitation);
    assert.strictEqual(result.invitation.email, 'vikram@apexlogistics.com');
  });

  await t.test('2. One Brand per Tenant Enforced: Attempting duplicate brand in same tenant fails', async () => {
    const tenantId = 55;
    await runAsSystem(() => Tenants.create({ id: tenantId, name: 'Single Brand Tenant', status: 'active' }));

    // Create 1st brand
    await runAsTenant(tenantId, () => Clients.create({ name: 'First Brand', phone_number_id: '123' }));

    // Creating 2nd brand in same tenant must fail due to unique constraint on tenant_id
    await assert.rejects(async () => {
      await runAsTenant(tenantId, () => Clients.create({ name: 'Second Brand' }));
    }, (err) => {
      return err.code === 11000 || err.message.includes('duplicate');
    });
  });

  await t.test('3. WhatsApp Token Encryption at Rest & Sanitization in API', async () => {
    const tenantId = 66;
    const rawSecretToken = 'EAAGSecretSystemUserToken1234567890';

    await runAsSystem(() => Tenants.create({ id: tenantId, name: 'WA Security Tenant', status: 'active' }));
    const brand = await runAsTenant(tenantId, () => Clients.create({
      name: 'WA Security Brand',
      whatsapp_number: '+919876543210',
      phone_number_id: '998877665544',
      wa_access_token: rawSecretToken,
    }));

    // Verify database document: plain token must NOT be in wa_access_token, encrypted in wa_access_token_enc
    const rawDoc = await runAsSystem(() => Clients.collection.findOne({ id: brand.id }));
    assert.strictEqual(rawDoc.wa_access_token, undefined);
    assert.ok(rawDoc.wa_access_token_enc);
    assert.notStrictEqual(rawDoc.wa_access_token_enc, rawSecretToken);
    assert.strictEqual(rawDoc.wa_token_last4, '7890');

    // Verify sanitizeClient masks the token for API responses
    const sanitized = sanitizeClient(brand);
    assert.strictEqual(sanitized.wa_access_token, undefined);
    assert.strictEqual(sanitized.wa_access_token_enc, undefined);
    assert.strictEqual(sanitized.wa_token_configured, true);
    assert.strictEqual(sanitized.wa_token_last4, '7890');
  });

  await t.test('4. Tenant Lifecycle States: Grace, Restricted, Suspended enforcement', async () => {
    const tenant = { id: 77, status: 'active' };

    // Case 1: Subscription active (current)
    const activeSub = { status: 'active', current_period_end: new Date(Date.now() + 10 * 86400 * 1000) };
    const stateActive = computeLifecycle(tenant, activeSub);
    assert.strictEqual(stateActive.state, 'active');
    assert.strictEqual(stateActive.access, 'full');

    // Case 2: Grace period (Days 1–7 after period end)
    const graceSub = { status: 'active', current_period_end: new Date(Date.now() - 3 * 86400 * 1000) };
    const stateGrace = computeLifecycle(tenant, graceSub);
    assert.strictEqual(stateGrace.state, 'grace');
    assert.strictEqual(stateGrace.access, 'full');

    // Case 3: Restricted period (Days 8–21 after period end: read/export only, no sends)
    const restrictedSub = { status: 'active', current_period_end: new Date(Date.now() - 14 * 86400 * 1000) };
    const stateRestricted = computeLifecycle(tenant, restrictedSub);
    assert.strictEqual(stateRestricted.state, 'restricted');
    assert.strictEqual(stateRestricted.access, 'read_export');

    // Case 4: Suspended (Day 22+ overdue)
    const suspendedSub = { status: 'active', current_period_end: new Date(Date.now() - 25 * 86400 * 1000) };
    const stateSuspended = computeLifecycle(tenant, suspendedSub);
    assert.strictEqual(stateSuspended.state, 'suspended');
    assert.strictEqual(stateSuspended.access, 'none');

    // Case 5: Staff manual suspension
    const staffSuspendedTenant = { id: 78, status: 'suspended', suspended_reason: 'Non-payment' };
    const stateStaffSuspended = computeLifecycle(staffSuspendedTenant, activeSub);
    assert.strictEqual(stateStaffSuspended.state, 'suspended');
    assert.strictEqual(stateStaffSuspended.access, 'none');
  });
});
