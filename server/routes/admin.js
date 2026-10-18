/**
 * Platform admin API (/api/admin), platform staff only (plans A8, O1, U6, U12,
 * A1/A3/A6 for staff, T10 viewer). Mounted with staffAuth(), so every request
 * runs in the system context; tenant data is always read through
 * runAsTenant(tenantId) for the one tenant being managed.
 */
const express = require('express');
const { Tenants, Users, Clients, Invitations, Subscriptions, Plans, AuditEvents, WorkflowLogs, AiDecisions, Leads } = require('../models');
const { runAsSystem, runAsTenant } = require('../services/tenantContext');
const { can, describeUser } = require('../services/permissions');
const { computeLifecycle, activeSubscription } = require('../services/lifecycle');
const { seatUsage, limitValue, LimitError } = require('../services/entitlements');
const { sanitizeClient } = require('../services/clientSecrets');
const { escapeRegex } = require('../db/mongo');
const provisioning = require('../services/provisioning');
const invitations = require('../services/invitations');
const userAdmin = require('../services/userAdmin');
const tenantData = require('../services/tenantData');
const audit = require('../services/audit');
const authController = require('../controllers/authController');

function fail(res, error) {
  if (error.status && error.status < 500) return res.status(error.status).json({ error: error.message, details: error.details });
  // Deliberate "temporarily unavailable" answers from our services (for
  // example the plan catalogue not being loaded) keep their message.
  if (error.status === 503 && error instanceof provisioning.ProvisioningError) {
    return res.status(503).json({ error: error.message });
  }
  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern || {})[0] || 'field';
    return res.status(409).json({ error: `A record with this ${field} already exists` });
  }
  console.error('[admin]', error.message);
  return res.status(500).json({ error: 'Server error' });
}

const permit = (permission) => (req, res, next) => (can(req.identity, permission)
  ? next()
  : res.status(403).json({ error: 'You do not have permission to do this', permission }));

const staffActor = (req) => ({ id: req.user.id, kind: 'staff', role: req.identity.staffRole });
const tenantIdParam = (req) => Number(req.params.id);

async function loadTenant(id) {
  return runAsSystem(() => Tenants.findOne({ id: Number(id) }, { _id: 0 }).lean(), 'admin');
}

async function tenantSummary(tenant) {
  const [subscription, seats, owner, brand] = await Promise.all([
    activeSubscription(tenant.id),
    seatUsage(tenant.id),
    tenant.owner_user_id ? runAsSystem(() => Users.findOne({ id: tenant.owner_user_id }, { _id: 0, id: 1, name: 1, email: 1 }).lean(), 'admin') : null,
    runAsTenant(tenant.id, () => Clients.findOne({}, { _id: 0, id: 1, name: 1, whatsapp_status: 1, whatsapp_number: 1, phone_number_id: 1, wa_token_last4: 1, wa_access_token_enc: 1 }).lean()),
  ]);
  const lifecycle = computeLifecycle(tenant, subscription);
  const max = limitValue(subscription?.limits, 'max_users');
  return {
    id: tenant.id,
    name: tenant.name,
    status: tenant.status,
    lifecycle_state: lifecycle.state,
    access: lifecycle.access,
    owner: owner || null,
    users: { active: seats.activeUsers, pending_invitations: seats.pendingInvitations, max_users: max === Infinity ? -1 : max },
    plan: subscription ? { code: subscription.plan_code, name: subscription.plan_name, period_end: subscription.current_period_end, term_months: subscription.term_months } : null,
    brand: brand ? sanitizeClient(brand) : null,
    is_founding_client: Boolean(tenant.is_founding_client),
    created_at: tenant.created_at,
  };
}

function createAdminRouter({ verifyClientWhatsApp, leados } = {}) {
  const router = express.Router();

  router.get('/me', (req, res) => res.json({ user: req.user, permissions: Object.fromEntries(
    ['platform.tenants.view', 'platform.tenants.manage', 'platform.tenants.export', 'platform.tenants.delete', 'platform.billing.grant', 'platform.users.manage', 'platform.staff.manage', 'platform.audit.view']
      .map((p) => [p, can(req.identity, p)]),
  ) }));

  router.get('/plans', permit('platform.tenants.view'), async (req, res) => {
    try {
      const plans = await Plans.find({ active: true }, { _id: 0 }).sort({ product_line: 1, tier: 1 }).lean();
      return res.json({ plans });
    } catch (error) {
      return fail(res, error);
    }
  });

  // ── Tenants ───────────────────────────────────────────────
  router.get('/tenants', permit('platform.tenants.view'), async (req, res) => {
    try {
      const filter = { status: { $ne: 'deleted' } };
      if (req.query.include_deleted === 'true') delete filter.status;
      if (req.query.search) filter.name = { $regex: escapeRegex(String(req.query.search)), $options: 'i' };
      const tenants = await Tenants.find(filter, { _id: 0 }).sort({ created_at: -1 }).limit(500).lean();
      let rows = await Promise.all(tenants.map(tenantSummary));
      if (req.query.state) rows = rows.filter((row) => row.lifecycle_state === req.query.state);
      return res.json({ tenants: rows, total: rows.length });
    } catch (error) {
      return fail(res, error);
    }
  });

  // Creating a workspace is a manual grant: founder only.
  router.post('/tenants', permit('platform.billing.grant'), async (req, res) => {
    try {
      const body = req.body || {};
      // Staff set the owner's password here and hand it over themselves; the
      // admin panel never sends an invitation email.
      if (typeof body.owner_password !== 'string' || !body.owner_password) {
        return res.status(400).json({ error: 'Owner password is required' });
      }
      if (body.payment_method !== undefined && body.payment_method !== 'manual_grant') {
        return res.status(400).json({ error: 'Staff can only record manual grants; verified payments are recorded by the payment system.' });
      }
      const result = await provisioning.provisionTenant({
        business_name: body.business_name,
        owner_email: body.owner_email,
        owner_name: body.owner_name,
        owner_password: body.owner_password,
        plan_code: body.plan_code,
        term_months: body.term_months,
        payment: { method: 'manual_grant', reference: body.payment_reference, reason: body.grant_reason },
        settings: body.settings || {},
        brand: body.brand || {},
        is_founding_client: body.is_founding_client,
      }, { req, actorUserId: req.user.id, actorName: req.user.name });
      return res.status(201).json(result);
    } catch (error) {
      return fail(res, error);
    }
  });

  router.get('/tenants/:id', permit('platform.tenants.view'), async (req, res) => {
    try {
      const tenant = await loadTenant(tenantIdParam(req));
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
      const [summary, users, pending, subscriptions, events] = await Promise.all([
        tenantSummary(tenant),
        userAdmin.listTenantUsers(tenant.id),
        runAsTenant(tenant.id, () => Invitations.find({ accepted_at: null, revoked_at: null }, { _id: 0 }).sort({ created_at: -1 }).lean()),
        runAsTenant(tenant.id, () => Subscriptions.find({}, { _id: 0 }).sort({ created_at: -1 }).limit(20).lean()),
        AuditEvents.find({ tenant_id: tenant.id }, { _id: 0 }).sort({ created_at: -1 }).limit(50).lean(),
      ]);
      const brand = await runAsTenant(tenant.id, () => Clients.findOne({}, { _id: 0 }).lean());
      return res.json({
        tenant: { ...tenant },
        summary,
        brand: brand ? sanitizeClient(brand) : null,
        users,
        invitations: pending.map(invitations.publicInvitation),
        subscriptions,
        audit: events,
      });
    } catch (error) {
      return fail(res, error);
    }
  });

  const TENANT_FIELDS = ['name', 'language', 'currency', 'tax_treatment', 'timezone', 'is_founding_client'];
  router.patch('/tenants/:id', permit('platform.tenants.manage'), async (req, res) => {
    try {
      const changes = {};
      for (const field of TENANT_FIELDS) {
        if (req.body?.[field] === undefined) continue;
        changes[field] = field === 'is_founding_client' ? Boolean(req.body[field]) : String(req.body[field]).trim();
        if (field !== 'is_founding_client' && !changes[field]) return res.status(400).json({ error: `Invalid ${field}` });
      }
      if (!Object.keys(changes).length) return res.status(400).json({ error: 'Nothing to update' });
      const tenant = await Tenants.findOneAndUpdate({ id: tenantIdParam(req), status: { $ne: 'deleted' } }, { $set: { ...changes, updated_at: new Date() } }, { new: true, projection: { _id: 0 } }).lean();
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
      await audit.record(audit.EVENTS.TENANT_UPDATED, { tenantId: tenant.id, req, targetType: 'tenant', targetId: tenant.id, meta: { changes } });
      return res.json({ tenant });
    } catch (error) {
      return fail(res, error);
    }
  });

  // Brand profile (never tokens; those go through PUT /whatsapp).
  const BRAND_FIELDS = ['name', 'industry', 'city', 'phone', 'contact_person', 'wa_category', 'wa_description', 'wa_address', 'wa_email', 'wa_website', 'brand_voice', 'target_audience'];
  router.patch('/tenants/:id/brand', permit('platform.tenants.manage'), async (req, res) => {
    try {
      const changes = Object.fromEntries(BRAND_FIELDS.filter((f) => req.body?.[f] !== undefined).map((f) => [f, req.body[f] === '' ? null : req.body[f]]));
      if (!Object.keys(changes).length) return res.status(400).json({ error: 'Nothing to update' });
      if (changes.name !== undefined && !String(changes.name || '').trim()) return res.status(400).json({ error: 'Brand name is required' });
      const brand = await runAsTenant(tenantIdParam(req), () => Clients.findOneAndUpdate({}, { $set: { ...changes, updated_at: new Date() } }, { new: true, projection: { _id: 0 } }).lean());
      if (!brand) return res.status(404).json({ error: 'Brand profile not found' });
      await audit.record(audit.EVENTS.BRAND_UPDATED, { tenantId: tenantIdParam(req), req, targetType: 'client', targetId: brand.id, meta: { fields: Object.keys(changes) } });
      return res.json({ brand: sanitizeClient(brand) });
    } catch (error) {
      return fail(res, error);
    }
  });

  // WhatsApp credentials for the tenant's own WhatsApp Business account.
  // The token is encrypted by the clients model and never returned.
  router.put('/tenants/:id/whatsapp', permit('platform.tenants.manage'), async (req, res) => {
    try {
      const body = req.body || {};
      const changes = {};
      for (const field of ['whatsapp_number', 'phone_number_id', 'wa_business_id']) {
        if (body[field] !== undefined) changes[field] = String(body[field] || '').trim() || null;
      }
      if (body.wa_access_token) changes.wa_access_token = String(body.wa_access_token).trim();
      if (!Object.keys(changes).length) return res.status(400).json({ error: 'Nothing to update' });
      const tenantId = tenantIdParam(req);
      if (changes.phone_number_id) {
        const taken = await runAsSystem(() => Clients.exists({ phone_number_id: changes.phone_number_id, tenant_id: { $ne: tenantId } }), 'admin');
        if (taken) return res.status(409).json({ error: 'This Meta Phone Number ID is already connected to another workspace' });
      }
      const brand = await runAsTenant(tenantId, () => Clients.findOneAndUpdate(
        {},
        { $set: { ...changes, whatsapp_status: 'not_configured', whatsapp_verified_at: null, whatsapp_verification_error: null, updated_at: new Date() } },
        { new: true, projection: { _id: 0 } },
      ).lean());
      if (!brand) return res.status(404).json({ error: 'Brand profile not found' });
      await audit.record(changes.wa_access_token ? audit.EVENTS.TOKEN_UPDATED : audit.EVENTS.BRAND_UPDATED, {
        tenantId, req, targetType: 'client', targetId: brand.id, meta: { fields: Object.keys(changes).filter((f) => f !== 'wa_access_token'), token_updated: Boolean(changes.wa_access_token) },
      });
      return res.json({ brand: sanitizeClient(brand) });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.post('/tenants/:id/whatsapp/verify', permit('platform.tenants.manage'), async (req, res) => {
    if (!verifyClientWhatsApp) return res.status(501).json({ error: 'WhatsApp verification is not available' });
    try {
      const brand = await runAsTenant(tenantIdParam(req), async () => {
        const client = await Clients.findOne({}, { _id: 0 }).lean();
        if (!client) throw Object.assign(new Error('Brand profile not found'), { status: 404 });
        return verifyClientWhatsApp(client);
      });
      return res.json({ success: true, brand: sanitizeClient(brand) });
    } catch (error) {
      if (error.status) return fail(res, error);
      return res.status(400).json({ error: error.response?.data?.error?.message || error.message || 'WhatsApp verification failed' });
    }
  });

  // ── Lifecycle ─────────────────────────────────────────────
  router.post('/tenants/:id/suspend', permit('platform.tenants.manage'), async (req, res) => {
    try {
      const reason = String(req.body?.reason || '').trim();
      if (!reason) return res.status(400).json({ error: 'A reason is required' });
      const tenant = await Tenants.findOneAndUpdate(
        { id: tenantIdParam(req), status: 'active' },
        { $set: { status: 'suspended', suspended_at: new Date(), suspended_reason: reason, suspended_by: req.user.id, updated_at: new Date() } },
        { new: true, projection: { _id: 0 } },
      ).lean();
      if (!tenant) return res.status(409).json({ error: 'Tenant is not active' });
      await audit.record(audit.EVENTS.TENANT_SUSPENDED, { tenantId: tenant.id, req, targetType: 'tenant', targetId: tenant.id, meta: { reason } });
      return res.json({ tenant });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.post('/tenants/:id/reinstate', permit('platform.tenants.manage'), async (req, res) => {
    try {
      const tenant = await Tenants.findOneAndUpdate(
        { id: tenantIdParam(req), status: 'suspended' },
        { $set: { status: 'active', updated_at: new Date() }, $unset: { suspended_at: '', suspended_reason: '', suspended_by: '' } },
        { new: true, projection: { _id: 0 } },
      ).lean();
      if (!tenant) return res.status(409).json({ error: 'Tenant is not suspended' });
      await audit.record(audit.EVENTS.TENANT_REINSTATED, { tenantId: tenant.id, req, targetType: 'tenant', targetId: tenant.id });
      return res.json({ tenant });
    } catch (error) {
      return fail(res, error);
    }
  });

  // Renewing or changing a plan is a manual grant: founder only.
  router.post('/tenants/:id/subscriptions', permit('platform.billing.grant'), async (req, res) => {
    try {
      const tenant = await loadTenant(tenantIdParam(req));
      if (!tenant || tenant.status === 'deleted') return res.status(404).json({ error: 'Tenant not found' });
      const body = req.body || {};
      if (body.payment_method !== undefined && body.payment_method !== 'manual_grant') {
        return res.status(400).json({ error: 'Staff can only record manual grants; verified payments are recorded by the payment system.' });
      }
      const subscription = await provisioning.grantSubscription(tenant.id, {
        plan_code: body.plan_code,
        term_months: body.term_months,
        payment: { method: 'manual_grant', reference: body.payment_reference, reason: body.grant_reason },
      }, { req, actorUserId: req.user.id });
      return res.status(201).json({ subscription });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.post('/lifecycle/run', permit('platform.tenants.manage'), async (req, res) => {
    try {
      return res.json({ changes: await tenantData.runLifecycleSweep() });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.get('/tenants/:id/export', permit('platform.tenants.export'), async (req, res) => {
    try {
      const data = await tenantData.exportTenant(tenantIdParam(req));
      if (!data) return res.status(404).json({ error: 'Tenant not found' });
      await audit.record(audit.EVENTS.TENANT_EXPORTED, { tenantId: tenantIdParam(req), req, targetType: 'tenant', targetId: tenantIdParam(req), meta: { collections: Object.keys(data.collections) } });
      res.setHeader('Content-Disposition', `attachment; filename="tenant-${tenantIdParam(req)}-export.json"`);
      return res.json(data);
    } catch (error) {
      return fail(res, error);
    }
  });

  router.post('/tenants/:id/delete-data', permit('platform.tenants.delete'), async (req, res) => {
    try {
      const result = await tenantData.deleteTenantData(tenantIdParam(req), {
        writtenRequestReference: req.body?.written_request_reference,
        confirmName: req.body?.confirm_name,
        req,
      });
      return res.json({ success: true, ...result });
    } catch (error) {
      return fail(res, error);
    }
  });

  // ── Users of a tenant ─────────────────────────────────────
  router.post('/tenants/:id/invitations', permit('platform.users.manage'), async (req, res) => {
    try {
      const tenant = await loadTenant(tenantIdParam(req));
      if (!tenant || tenant.status === 'deleted') return res.status(404).json({ error: 'Tenant not found' });
      const result = await invitations.createInvitation({
        tenantId: tenant.id, email: req.body?.email, name: req.body?.name, role: String(req.body?.role || 'agent').toLowerCase(),
        invitedBy: { id: req.user.id, name: req.user.name }, req,
      });
      return res.status(201).json({ invitation: result.invitation, delivery: result.delivery }); // never the raw token
    } catch (error) {
      if (error instanceof LimitError) return res.status(409).json({ error: error.message, details: error.details, code: 'USER_LIMIT_REACHED' });
      return fail(res, error);
    }
  });

  router.post('/tenants/:id/invitations/:invitationId/resend', permit('platform.users.manage'), async (req, res) => {
    try {
      return res.json(await invitations.resendInvitation({ invitationId: req.params.invitationId, tenantId: tenantIdParam(req), invitedBy: { id: req.user.id, name: req.user.name }, req }));
    } catch (error) {
      return fail(res, error);
    }
  });

  router.delete('/tenants/:id/invitations/:invitationId', permit('platform.users.manage'), async (req, res) => {
    try {
      return res.json({ invitation: await invitations.revokeInvitation({ invitationId: req.params.invitationId, tenantId: tenantIdParam(req), revokedBy: req.user.id, req }) });
    } catch (error) {
      return fail(res, error);
    }
  });

  // ── All users (search) and per-user actions ───────────────
  router.get('/users', permit('platform.tenants.view'), async (req, res) => {
    try {
      const filter = {};
      if (req.query.tenant_id) filter.tenant_id = Number(req.query.tenant_id);
      if (req.query.search) {
        const re = { $regex: escapeRegex(String(req.query.search)), $options: 'i' };
        filter.$or = [{ name: re }, { email: re }];
      }
      const users = await Users.find(filter, userAdmin.PUBLIC_FIELDS).sort({ created_at: -1 }).limit(500).lean();
      const tenantIds = [...new Set(users.map((u) => u.tenant_id).filter((id) => id != null))];
      const names = new Map((await Tenants.find({ id: { $in: tenantIds } }, { _id: 0, id: 1, name: 1 }).lean()).map((t) => [t.id, t.name]));
      return res.json({ users: users.map((u) => ({ ...userAdmin.presentUser(u), tenant_name: names.get(u.tenant_id) || null })) });
    } catch (error) {
      return fail(res, error);
    }
  });

  // Adds a user to an existing workspace by invitation (plan A3). The person
  // sets their own password from the emailed one-time link; staff never choose
  // or see it. A workspace must be named: there is no default workspace.
  router.post('/users', permit('platform.users.manage'), async (req, res) => {
    try {
      const body = req.body || {};
      if (body.password !== undefined) {
        return res.status(400).json({ error: 'Passwords cannot be set by staff. The invited user sets their own password from the invitation email.' });
      }
      const tenantId = Number(body.tenant_id);
      if (!Number.isInteger(tenantId) || tenantId <= 0) {
        return res.status(400).json({ error: 'tenant_id is required: choose the workspace this user belongs to' });
      }
      const tenant = await loadTenant(tenantId);
      if (!tenant || tenant.status === 'deleted') return res.status(404).json({ error: 'Workspace not found' });
      const result = await invitations.createInvitation({
        tenantId: tenant.id,
        email: body.email,
        name: body.name,
        role: String(body.role || 'agent').toLowerCase(),
        invitedBy: { id: req.user.id, name: req.user.name },
        req,
      });
      return res.status(201).json({ invitation: result.invitation, delivery: result.delivery }); // never the raw token
    } catch (error) {
      if (error instanceof LimitError) return res.status(409).json({ error: error.message, details: error.details, code: 'USER_LIMIT_REACHED' });
      return fail(res, error);
    }
  });

  async function tenantOfUser(userId) {
    const user = await Users.findOne({ id: Number(userId) }, { _id: 0, id: 1, tenant_id: 1, is_platform_staff: 1, role: 1 }).lean();
    if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
    if (describeUser(user)?.kind !== 'tenant') throw Object.assign(new Error('Use the staff endpoints for platform staff accounts'), { status: 400 });
    return user.tenant_id;
  }

  router.patch('/users/:userId/role', permit('platform.users.manage'), async (req, res) => {
    try {
      const tenantId = await tenantOfUser(req.params.userId);
      return res.json({ user: await userAdmin.changeRole({ tenantId, userId: req.params.userId, newRole: req.body?.role, actor: staffActor(req), req }) });
    } catch (error) {
      return fail(res, error);
    }
  });

  for (const [action, active] of [['deactivate', false], ['reactivate', true]]) {
    router.post(`/users/:userId/${action}`, permit('platform.users.manage'), async (req, res) => {
      try {
        const tenantId = await tenantOfUser(req.params.userId);
        return res.json({ user: await userAdmin.setActive({ tenantId, userId: req.params.userId, active, actor: staffActor(req), req }) });
      } catch (error) {
        if (error instanceof LimitError) return res.status(409).json({ error: error.message, details: error.details, code: 'USER_LIMIT_REACHED' });
        return fail(res, error);
      }
    });
  }

  router.post('/users/:userId/revoke-sessions', permit('platform.users.manage'), async (req, res) => {
    try {
      const tenantId = await tenantOfUser(req.params.userId);
      return res.json(await userAdmin.revokeSessions({ tenantId, userId: req.params.userId, actor: staffActor(req), req }));
    } catch (error) {
      return fail(res, error);
    }
  });

  router.post('/users/:userId/reset-mfa', permit('platform.users.manage'), async (req, res) => {
    try {
      return res.json(await userAdmin.resetMfa({ userId: req.params.userId, req }));
    } catch (error) {
      return fail(res, error);
    }
  });

  // ── Platform staff ────────────────────────────────────────
  router.get('/staff', permit('platform.tenants.view'), async (req, res) => {
    try {
      const staff = await Users.find({ tenant_id: null }, userAdmin.PUBLIC_FIELDS).sort({ created_at: 1 }).lean();
      const pending = await Invitations.find({ tenant_id: null, accepted_at: null, revoked_at: null }, { _id: 0 }).sort({ created_at: -1 }).lean();
      return res.json({
        staff: staff.filter((u) => describeUser(u)?.kind === 'staff').map(userAdmin.presentUser),
        invitations: pending.map(invitations.publicInvitation),
      });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.post('/staff/invitations', permit('platform.staff.manage'), async (req, res) => {
    try {
      const result = await invitations.createInvitation({
        tenantId: null, email: req.body?.email, name: req.body?.name, staffRole: String(req.body?.staff_role || 'support').toLowerCase(),
        invitedBy: { id: req.user.id, name: req.user.name }, req,
      });
      return res.status(201).json({ invitation: result.invitation, delivery: result.delivery }); // never the raw token
    } catch (error) {
      return fail(res, error);
    }
  });

  router.delete('/staff/invitations/:invitationId', permit('platform.staff.manage'), async (req, res) => {
    try {
      return res.json({ invitation: await invitations.revokeInvitation({ invitationId: req.params.invitationId, tenantId: null, revokedBy: req.user.id, req }) });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.patch('/staff/:userId', permit('platform.staff.manage'), async (req, res) => {
    try {
      return res.json({ user: await userAdmin.setStaffRole({ userId: req.params.userId, staffRole: String(req.body?.staff_role || '').toLowerCase(), actor: staffActor(req), req }) });
    } catch (error) {
      return fail(res, error);
    }
  });

  for (const [action, active] of [['deactivate', false], ['reactivate', true]]) {
    router.post(`/staff/:userId/${action}`, permit('platform.staff.manage'), async (req, res) => {
      try {
        return res.json({ user: await userAdmin.setStaffActive({ userId: req.params.userId, active, actor: staffActor(req), req }) });
      } catch (error) {
        return fail(res, error);
      }
    });
  }

  // ── Audit viewer (read-only) ──────────────────────────────
  router.get('/audit', permit('platform.audit.view'), async (req, res) => {
    try {
      const filter = {};
      if (req.query.tenant_id) filter.tenant_id = Number(req.query.tenant_id);
      if (req.query.event) filter.event = String(req.query.event);
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const events = await AuditEvents.find(filter, { _id: 0 }).sort({ created_at: -1 }).limit(limit).lean();
      return res.json({ events });
    } catch (error) {
      return fail(res, error);
    }
  });

  // ── Clients Management & platform Meta inventory ──────────
  require('./admin-clients')(router, { permit, fail, leados });

  // ── Workflows Management ──────────────────────────────────
  router.get('/workflows/logs', permit('platform.tenants.view'), async (req, res) => {
    try {
      const filter = {};
      if (req.query.workflow && req.query.workflow !== 'ALL') filter.workflow = { $regex: escapeRegex(String(req.query.workflow)), $options: 'i' };
      if (req.query.status && req.query.status !== 'ALL') filter.status = String(req.query.status).toLowerCase();
      const logs = await WorkflowLogs.find(filter, { _id: 0 }).sort({ created_at: -1 }).limit(500).lean();
      return res.json({ logs });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.get('/workflows/telemetry', permit('platform.tenants.view'), async (req, res) => {
    try {
      const totalExecutions = await WorkflowLogs.countDocuments();
      const successCount = await WorkflowLogs.countDocuments({ status: 'success' });
      const failedCount = await WorkflowLogs.countDocuments({ status: 'failed' });
      const successRate = totalExecutions > 0 ? Math.round((successCount / totalExecutions) * 100) : 100;
      const aiInterventions = await AiDecisions.countDocuments();
      return res.json({
        telemetry: {
          totalExecutions,
          successCount,
          failedCount,
          successRate,
          aiInterventions,
          activeWorkflows: 8,
        },
      });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.delete('/workflows/logs/:id', permit('platform.tenants.manage'), async (req, res) => {
    try {
      const result = await WorkflowLogs.deleteOne({ id: Number(req.params.id) });
      return res.json({ success: true, deleted: result.deletedCount });
    } catch (error) {
      return fail(res, error);
    }
  });

  // ── Founder Reports ───────────────────────────────────────
  router.get('/reports/founder-dashboard', permit('platform.tenants.view'), async (req, res) => {
    try {
      const [totalWorkspaces, totalUsers, totalLeads, activeSubs, wf06Logs] = await Promise.all([
        Tenants.countDocuments({ status: { $ne: 'deleted' } }),
        Users.countDocuments({ is_active: { $ne: false } }),
        Leads.countDocuments(),
        Subscriptions.find({ status: 'active' }, { _id: 0, monthly_price: 1, contract_value: 1 }).lean(),
        WorkflowLogs.find({ workflow: 'WF06' }, { _id: 0 }).sort({ created_at: -1 }).limit(50).lean(),
      ]);

      const mrr = activeSubs.reduce((sum, s) => sum + (Number(s.monthly_price) || 0), 0);
      const totalContractValue = activeSubs.reduce((sum, s) => sum + (Number(s.contract_value) || 0), 0);

      return res.json({
        snapshot: {
          totalWorkspaces,
          totalUsers,
          totalLeads,
          activeSubscriptions: activeSubs.length,
          mrr,
          totalContractValue,
        },
        reports: wf06Logs,
      });
    } catch (error) {
      return fail(res, error);
    }
  });

  // ── Platform Settings ─────────────────────────────────────
  router.get('/settings', permit('platform.staff.manage'), async (req, res) => {
    try {
      return res.json({
        system: {
          nodeVersion: process.version,
          environment: process.env.NODE_ENV || 'development',
          mfaEnforced: process.env.MFA_ENFORCED === 'true',
          emailDelivery: process.env.EMAIL_DELIVERY || 'outbox',
          port: process.env.PORT || 3600,
          uptimeSeconds: Math.round(process.uptime()),
        },
      });
    } catch (error) {
      return fail(res, error);
    }
  });

  // Changes the signed-in staff member's own password. Uses the shared
  // change-password handler: password rules, every other session revoked
  // (token_version + 1), audit event, and a fresh token for this session.
  router.post('/settings/password', (req, res) => {
    req.body = { current: req.body?.currentPassword ?? req.body?.current, newPassword: req.body?.newPassword };
    return authController.changePassword(req, res);
  });

  return router;
}

module.exports = createAdminRouter;
