const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

test.before(async () => {
  await startTestDb();
});

test.after(async () => {
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearCollections();
});

test('User Management & Security Lifecycle Suite', async (t) => {
  const { Users, Invitations, Tenants, Subscriptions } = require('../models');
  const { runAsTenant, runAsSystem } = require('../services/tenantContext');
  const userAdmin = require('../services/userAdmin');
  const invitations = require('../services/invitations');
  const { resolveIdentity } = require('../middleware/authMiddleware');
  const { canAssignRole, mfaRequired, describeUser } = require('../services/permissions');

  await t.test('1. Role assignment permissions: Admin cannot assign Owner', async () => {
    // Admin trying to promote agent to owner
    assert.strictEqual(canAssignRole('admin', 'agent', 'owner'), false);
    // Owner CAN promote agent to admin or owner
    assert.strictEqual(canAssignRole('owner', 'agent', 'admin'), true);
    assert.strictEqual(canAssignRole('owner', 'agent', 'owner'), true);
    // Agent cannot assign any role
    assert.strictEqual(canAssignRole('agent', 'agent', 'admin'), false);
  });

  await t.test('2. Last active Owner protection: Cannot remove sole owner', async () => {
    const tenantId = 10;
    const owner = await runAsTenant(tenantId, () => Users.create({
      name: 'Sole Owner',
      email: 'sole.owner@company.com',
      role: 'owner',
      is_active: true,
    }));

    // Attempting to change sole owner role to agent must fail
    await assert.rejects(async () => {
      await userAdmin.changeRole({
        tenantId,
        userId: owner.id,
        newRole: 'agent',
        actor: { id: 999, kind: 'staff', role: 'superadmin' },
      });
    }, (err) => {
      return err.message.includes('must keep at least one active Owner');
    });

    // Attempting to deactivate sole owner must fail
    await assert.rejects(async () => {
      await userAdmin.setActive({
        tenantId,
        userId: owner.id,
        active: false,
        actor: { id: 999, kind: 'staff', role: 'superadmin' },
      });
    }, (err) => {
      return err.message.includes('must keep at least one active Owner');
    });
  });

  await t.test('3. One-time expiring invitations & one login per workspace', async () => {
    const tenantId = 20;

    // Create active tenant with no users yet
    await runAsSystem(() => Tenants.create({ id: tenantId, name: 'Tenant 20 Corp', status: 'active' }));
    await runAsTenant(tenantId, () => Subscriptions.create({
      plan_code: 'WA-STARTER',
      limits: { max_users: 2 },
      status: 'active',
      term_months: 12,
    }));

    // The workspace's one login is invited
    const inv1 = await invitations.createInvitation({
      tenantId,
      email: 'invitee1@corp.com',
      role: 'owner',
      invitedBy: 1,
    });
    assert.ok(inv1.token);
    assert.strictEqual(inv1.invitation.email, 'invitee1@corp.com');

    // A second person is refused while that invitation is pending
    await assert.rejects(async () => {
      await invitations.createInvitation({
        tenantId,
        email: 'invitee2@corp.com',
        role: 'agent',
        invitedBy: 1,
      });
    }, (err) => err.status === 409);

    // Accept 1st invitation
    const accepted = await invitations.acceptInvitation({
      token: inv1.token,
      name: 'Second User',
      password: 'StrongPassword123!',
    });
    assert.strictEqual(accepted.email, 'invitee1@corp.com');
    assert.strictEqual(accepted.tenant_id, tenantId);

    // Reusing the same invitation must fail (one-time use)
    await assert.rejects(async () => {
      await invitations.acceptInvitation({
        token: inv1.token,
        name: 'Imposter User',
        password: 'StrongPassword123!',
      });
    }, (err) => {
      return err.message.includes('already been used') || err.status === 410;
    });

    // ...and once that login exists, no further invitation is accepted either
    await assert.rejects(
      () => invitations.createInvitation({ tenantId, email: 'invitee3@corp.com', role: 'agent', invitedBy: 1 }),
      (err) => err.status === 409,
    );
  });

  await t.test('4. Session Revocation: token_version increment revokes active tokens', async () => {
    const tenantId = 30;
    await runAsSystem(() => Tenants.create({ id: tenantId, name: 'Tenant 30 Corp', status: 'active' }));

    const user = await runAsTenant(tenantId, () => Users.create({
      name: 'Token User',
      email: 'token.user@corp.com',
      role: 'agent',
      is_active: true,
      token_version: 0,
    }));

    // Generate token with token_version = 0
    const tokenV0 = makeToken(user);

    // Valid token resolves cleanly
    const resolved = await resolveIdentity(tokenV0);
    assert.strictEqual(resolved.user.id, user.id);

    // Revoke sessions (token_version + 1)
    await userAdmin.revokeSessions({
      tenantId,
      userId: user.id,
      actor: { id: 999, kind: 'staff', role: 'superadmin' },
    });

    // Old token must now be rejected with SESSION_REVOKED
    await assert.rejects(async () => {
      await resolveIdentity(tokenV0);
    }, (err) => {
      return err.code === 'SESSION_REVOKED' || err.message.includes('revoked');
    });
  });

  await t.test('5. Deactivation: Deactivated account immediately returns 401', async () => {
    const tenantId = 40;
    await runAsSystem(() => Tenants.create({ id: tenantId, name: 'Tenant 40 Corp', status: 'active' }));

    // Need at least 2 owners so we can deactivate one
    await runAsTenant(tenantId, () => Users.create({
      name: 'Primary Owner',
      email: 'primary@corp.com',
      role: 'owner',
      is_active: true,
    }));

    const agent = await runAsTenant(tenantId, () => Users.create({
      name: 'Agent User',
      email: 'agent@corp.com',
      role: 'agent',
      is_active: true,
      token_version: 0,
    }));

    const agentToken = makeToken(agent);
    assert.ok(await resolveIdentity(agentToken));

    // Deactivate agent
    await userAdmin.setActive({
      tenantId,
      userId: agent.id,
      active: false,
      actor: { id: 999, kind: 'staff', role: 'superadmin' },
    });

    // Attempting to use token fails with ACCOUNT_DEACTIVATED
    await assert.rejects(async () => {
      await resolveIdentity(agentToken);
    }, (err) => {
      return err.code === 'ACCOUNT_DEACTIVATED' || err.message.includes('deactivated');
    });
  });

  await t.test('6. MFA Requirement: Mandatory for Owner and Admin', async () => {
    assert.strictEqual(mfaRequired(describeUser({ role: 'owner', tenant_id: 1 })), true);
    assert.strictEqual(mfaRequired(describeUser({ role: 'admin', tenant_id: 1 })), true);
    assert.strictEqual(mfaRequired(describeUser({ role: 'manager', tenant_id: 1 })), false);
    assert.strictEqual(mfaRequired(describeUser({ role: 'agent', tenant_id: 1 })), false);
    assert.strictEqual(mfaRequired(describeUser({ is_platform_staff: true, staff_role: 'superadmin' })), true);
  });
});
