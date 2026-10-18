const test = require('node:test');
const assert = require('node:assert');
const { startTestDb, stopTestDb, clearCollections } = require('./setup');

test.before(async () => {
  await startTestDb();
});

test.after(async () => {
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearCollections();
});

test('Client Management & Tenant Lifecycle Suite', async (t) => {
  const { Tenants, Clients, Users, Invitations } = require('../models');
  const { runAsTenant, runAsSystem } = require('../services/tenantContext');
  const provisioning = require('../services/provisioning');
  const { sanitizeClient } = require('../services/clientSecrets');
  const { computeLifecycle, tenantLifecycle } = require('../services/lifecycle');

  await t.test('1. Atomic Provisioning: Creates tenant, 1-to-1 brand and owner invitation; no plan or subscription', async () => {
    // Only an active founder account may create a workspace.
    const founder = await runAsSystem(() => Users.create({ name: 'Founder', email: 'founder@nera.test', tenant_id: null, is_platform_staff: true, staff_role: 'founder', is_active: true }));
    const result = await provisioning.provisionTenant({
      business_name: 'Apex Global Logistics',
      owner_name: 'Vikram Mehta',
      owner_email: 'vikram@apexlogistics.com',
      is_founding_client: true,
      settings: { language: 'en', currency: 'INR', timezone: 'Asia/Kolkata', tax_treatment: 'gst' },
      brand: { city: 'Mumbai', phone: '+919876543210' },
    }, { actorUserId: founder.id });

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

    // No plans: nothing about a subscription is created, and the workspace has full access
    assert.strictEqual(result.subscription, undefined);
    const lifecycle = await tenantLifecycle(result.tenant.id);
    assert.strictEqual(lifecycle.state, 'active');
    assert.strictEqual(lifecycle.access, 'full');

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

  await t.test('4. Tenant lifecycle without plans: active with full access; only staff suspension or deletion blocks', async () => {
    const active = computeLifecycle({ id: 77, status: 'active' });
    assert.strictEqual(active.state, 'active');
    assert.strictEqual(active.access, 'full');

    // A long-ago creation date never expires a workspace.
    const old = computeLifecycle({ id: 79, status: 'active', created_at: new Date(Date.now() - 400 * 86400 * 1000) });
    assert.strictEqual(old.access, 'full');

    const staffSuspended = computeLifecycle({ id: 78, status: 'suspended', suspended_reason: 'Terms violation' });
    assert.strictEqual(staffSuspended.state, 'suspended');
    assert.strictEqual(staffSuspended.access, 'none');

    const deleted = computeLifecycle({ id: 80, status: 'deleted' });
    assert.strictEqual(deleted.access, 'none');
  });
});
