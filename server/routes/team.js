/**
 * Customer workspace administration. Every route here requires a customer
 * login (`auth`): it re-reads the user and tenant and runs the request in that
 * tenant's context. Platform staff use /api/admin instead.
 *   /api/tenant        workspace summary and tenant-level settings
 *   /api/team/...      users, invitations, roles, deactivation (plans A1, A3, A6, B10)
 * The tenant always comes from the signed-in user, never from the request.
 */
const express = require('express');
const { Tenants, Invitations } = require('../models');
const { runAsSystem } = require('../services/tenantContext');
const { requirePermission, can } = require('../services/permissions');
const { auth } = require('../middleware/authMiddleware');
const { getEntitlements, seatUsage, limitValue, LimitError } = require('../services/entitlements');
const invitations = require('../services/invitations');
const userAdmin = require('../services/userAdmin');
const audit = require('../services/audit');

const router = express.Router();

// This router is mounted on /api, so authentication is limited to its own
// prefixes (/tenant, /tenant/*, /team/*) and leaves every other /api route alone.
router.use(['/tenant', '/team'], auth);

function fail(res, error) {
  if (error.status && error.status < 500) return res.status(error.status).json({ error: error.message, details: error.details });
  console.error('[team]', error.message);
  return res.status(500).json({ error: 'Server error' });
}

const actorOf = (req) => ({ id: req.user.id, kind: 'tenant', role: req.identity.role });

// Workspace summary for any signed-in member.
router.get('/tenant', async (req, res) => {
  try {
    const tenantId = req.identity.tenantId;
    const [tenant, entitlements, seats] = await Promise.all([
      runAsSystem(() => Tenants.findOne({ id: tenantId }, { _id: 0, id: 1, name: 1, status: 1, language: 1, currency: 1, tax_treatment: 1, timezone: 1, owner_user_id: 1, created_at: 1 }).lean(), 'team'),
      getEntitlements(tenantId),
      seatUsage(tenantId),
    ]);
    const sub = entitlements.subscription;
    return res.json({
      tenant,
      lifecycle: { state: req.lifecycle.state, access: req.lifecycle.access, period_end: req.lifecycle.periodEnd || null },
      subscription: sub && can(req.identity, 'billing.view') ? {
        plan_code: sub.plan_code, plan_name: sub.plan_name, term_months: sub.term_months,
        current_period_start: sub.current_period_start, current_period_end: sub.current_period_end,
      } : (sub ? { plan_name: sub.plan_name } : null),
      limits: entitlements.limits,
      features: entitlements.features,
      usage: { users: seats.activeUsers, pending_invitations: seats.pendingInvitations, max_users: limitValue(entitlements.limits, 'max_users') === Infinity ? -1 : limitValue(entitlements.limits, 'max_users') },
      permissions: { manage_team: can(req.identity, 'team.manage'), manage_settings: can(req.identity, 'tenant.settings'), manage_whatsapp: can(req.identity, 'whatsapp.manage') },
    });
  } catch (error) {
    return fail(res, error);
  }
});

// Tenant-level settings (Full Scope standing rule 6).
const SETTING_FIELDS = ['language', 'currency', 'tax_treatment', 'timezone'];
router.patch('/tenant/settings', requirePermission('tenant.settings'), async (req, res) => {
  try {
    const changes = {};
    for (const field of SETTING_FIELDS) {
      if (req.body?.[field] === undefined) continue;
      const value = String(req.body[field]).trim();
      if (!value || value.length > 40) return res.status(400).json({ error: `Invalid ${field}` });
      changes[field] = value;
    }
    if (!Object.keys(changes).length) return res.status(400).json({ error: 'Nothing to update' });
    const tenantId = req.identity.tenantId;
    const tenant = await runAsSystem(() => Tenants.findOneAndUpdate({ id: tenantId }, { $set: { ...changes, updated_at: new Date() } }, { new: true, projection: { _id: 0 } }).lean(), 'team');
    await audit.record(audit.EVENTS.TENANT_UPDATED, { tenantId, req, targetType: 'tenant', targetId: tenantId, meta: { changes } });
    return res.json({ tenant });
  } catch (error) {
    return fail(res, error);
  }
});

router.get('/team/users', requirePermission('team.view'), async (req, res) => {
  try {
    const tenantId = req.identity.tenantId;
    const [users, pending, entitlements, seats] = await Promise.all([
      userAdmin.listTenantUsers(tenantId),
      Invitations.find({ accepted_at: null, revoked_at: null }, { _id: 0 }).sort({ created_at: -1 }).lean(),
      getEntitlements(tenantId),
      seatUsage(tenantId),
    ]);
    const max = limitValue(entitlements.limits, 'max_users');
    return res.json({
      users,
      invitations: pending.map(invitations.publicInvitation),
      seats: { max_users: max === Infinity ? -1 : max, used: seats.used, active_users: seats.activeUsers, pending_invitations: seats.pendingInvitations },
    });
  } catch (error) {
    return fail(res, error);
  }
});

router.post('/team/invitations', requirePermission('team.manage'), async (req, res) => {
  try {
    const role = String(req.body?.role || 'agent').toLowerCase();
    if (role === 'owner' && req.identity.role !== 'owner') return res.status(403).json({ error: 'Only an Owner can invite another Owner' });
    const result = await invitations.createInvitation({
      tenantId: req.identity.tenantId,
      email: req.body?.email,
      name: req.body?.name,
      role,
      invitedBy: { id: req.user.id, name: req.user.name },
      req,
    });
    return res.status(201).json({ invitation: result.invitation, delivery: result.delivery }); // never the raw token
  } catch (error) {
    if (error instanceof LimitError) return res.status(409).json({ error: error.message, details: error.details, code: 'USER_LIMIT_REACHED' });
    return fail(res, error);
  }
});

router.post('/team/invitations/:id/resend', requirePermission('team.manage'), async (req, res) => {
  try {
    return res.json(await invitations.resendInvitation({ invitationId: req.params.id, tenantId: req.identity.tenantId, invitedBy: { id: req.user.id, name: req.user.name }, req }));
  } catch (error) {
    return fail(res, error);
  }
});

router.delete('/team/invitations/:id', requirePermission('team.manage'), async (req, res) => {
  try {
    return res.json({ invitation: await invitations.revokeInvitation({ invitationId: req.params.id, tenantId: req.identity.tenantId, revokedBy: req.user.id, req }) });
  } catch (error) {
    return fail(res, error);
  }
});

router.patch('/team/users/:id/role', requirePermission('team.manage'), async (req, res) => {
  try {
    return res.json({ user: await userAdmin.changeRole({ tenantId: req.identity.tenantId, userId: req.params.id, newRole: req.body?.role, actor: actorOf(req), req }) });
  } catch (error) {
    return fail(res, error);
  }
});

router.post('/team/users/:id/deactivate', requirePermission('team.manage'), async (req, res) => {
  try {
    return res.json({ user: await userAdmin.setActive({ tenantId: req.identity.tenantId, userId: req.params.id, active: false, actor: actorOf(req), req }) });
  } catch (error) {
    return fail(res, error);
  }
});

router.post('/team/users/:id/reactivate', requirePermission('team.manage'), async (req, res) => {
  try {
    return res.json({ user: await userAdmin.setActive({ tenantId: req.identity.tenantId, userId: req.params.id, active: true, actor: actorOf(req), req }) });
  } catch (error) {
    if (error instanceof LimitError) return res.status(409).json({ error: error.message, details: error.details, code: 'USER_LIMIT_REACHED' });
    return fail(res, error);
  }
});

router.post('/team/users/:id/revoke-sessions', requirePermission('team.manage'), async (req, res) => {
  try {
    return res.json(await userAdmin.revokeSessions({ tenantId: req.identity.tenantId, userId: req.params.id, actor: actorOf(req), req }));
  } catch (error) {
    return fail(res, error);
  }
});

module.exports = router;
