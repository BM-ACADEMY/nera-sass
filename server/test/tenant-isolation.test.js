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

test('Task T11: Cross-Tenant Isolation Suite', async (t) => {
  const { Leads, Clients, Tenants, Users } = require('../models');
  const { runAsTenant, runAsSystem, TenantContextError } = require('../services/tenantContext');

  await t.test('1. Fail-Closed: Querying without context throws TenantContextError', async () => {
    await assert.rejects(async () => {
      await Leads.find({});
    }, (err) => {
      return err.name === 'TenantContextError' && err.message.includes('No tenant context');
    });
  });

  await t.test('2. Read Isolation: Tenant 1 cannot see Tenant 2 leads or clients', async () => {
    // Seed Tenant 1
    const lead1 = await runAsTenant(1, () => Leads.create({ name: 'Lead for Tenant 1', phone: '1111111111' }));
    const client1 = await runAsTenant(1, () => Clients.create({ name: 'Brand 1', whatsapp_number: '+911111111111' }));

    // Seed Tenant 2
    const lead2 = await runAsTenant(2, () => Leads.create({ name: 'Lead for Tenant 2', phone: '2222222222' }));
    const client2 = await runAsTenant(2, () => Clients.create({ name: 'Brand 2', whatsapp_number: '+912222222222' }));

    // Verify Tenant 1 view
    const tenant1Leads = await runAsTenant(1, () => Leads.find({}).lean());
    assert.strictEqual(tenant1Leads.length, 1);
    assert.strictEqual(tenant1Leads[0].name, 'Lead for Tenant 1');
    assert.strictEqual(tenant1Leads[0].tenant_id, 1);

    const tenant1Clients = await runAsTenant(1, () => Clients.find({}).lean());
    assert.strictEqual(tenant1Clients.length, 1);
    assert.strictEqual(tenant1Clients[0].name, 'Brand 1');

    // Verify Tenant 2 view
    const tenant2Leads = await runAsTenant(2, () => Leads.find({}).lean());
    assert.strictEqual(tenant2Leads.length, 1);
    assert.strictEqual(tenant2Leads[0].name, 'Lead for Tenant 2');
    assert.strictEqual(tenant2Leads[0].tenant_id, 2);

    const tenant2Clients = await runAsTenant(2, () => Clients.find({}).lean());
    assert.strictEqual(tenant2Clients.length, 1);
    assert.strictEqual(tenant2Clients[0].name, 'Brand 2');
  });

  await t.test('3. Write Isolation: Tenant 1 cannot update or delete Tenant 2 records', async () => {
    const lead2 = await runAsTenant(2, () => Leads.create({ name: 'Untouchable Lead', status: 'new' }));

    // Tenant 1 tries to update Tenant 2's lead by ID
    const updateRes = await runAsTenant(1, () => Leads.updateOne({ id: lead2.id }, { $set: { status: 'hijacked' } }));
    assert.strictEqual(updateRes.matchedCount, 0);
    assert.strictEqual(updateRes.modifiedCount, 0);

    // Tenant 2 confirms lead is unchanged
    const leadCheck = await runAsTenant(2, () => Leads.findOne({ id: lead2.id }).lean());
    assert.strictEqual(leadCheck.status, 'new');

    // Tenant 1 tries to delete Tenant 2's lead by ID
    const deleteRes = await runAsTenant(1, () => Leads.deleteOne({ id: lead2.id }));
    assert.strictEqual(deleteRes.deletedCount, 0);

    // Tenant 2 confirms lead still exists
    const stillExists = await runAsTenant(2, () => Leads.exists({ id: lead2.id }));
    assert.ok(stillExists);
  });

  await t.test('4. Tampering Protection: Updates cannot modify tenant_id', async () => {
    const lead1 = await runAsTenant(1, () => Leads.create({ name: 'Tamper Test Lead' }));

    await assert.rejects(async () => {
      await runAsTenant(1, () => Leads.updateOne({ id: lead1.id }, { $set: { tenant_id: 999 } }));
    }, (err) => {
      return err.name === 'TenantContextError' && err.message.includes('Updates may not change tenant_id');
    });
  });

  await t.test('5. Platform Staff Context: Staff can see across tenants with system context', async () => {
    await runAsTenant(1, () => Leads.create({ name: 'Lead Alpha' }));
    await runAsTenant(2, () => Leads.create({ name: 'Lead Beta' }));

    const allLeads = await runAsSystem(() => Leads.find({}).lean(), 'staff-test');
    assert.strictEqual(allLeads.length, 2);
  });
});
