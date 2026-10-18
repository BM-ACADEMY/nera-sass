/**
 * Platform admin API (/api/admin), platform staff only (plans A8, O1, U6, U12,
 * A1/A3/A6 for staff, T10 viewer). Mounted with staffAuth(), so every request
 * runs in the system context; tenant data is always read through
 * runAsTenant(tenantId) for the one tenant being managed.
 */
const express = require('express');
const { Tenants, Users, Clients, Invitations, AuditEvents, WorkflowLogs, AiDecisions, Leads } = require('../models');
const { runAsSystem, runAsTenant } = require('../services/tenantContext');
const { can, describeUser } = require('../services/permissions');
const { computeLifecycle } = require('../services/lifecycle');
const { seatUsage } = require('../services/entitlements');
const { sanitizeClient } = require('../services/clientSecrets');
const { escapeRegex } = require('../db/mongo');
const provisioning = require('../services/provisioning');
const invitations = require('../services/invitations');
const userAdmin = require('../services/userAdmin');
const tenantData = require('../services/tenantData');
const audit = require('../services/audit');
const authController = require('../controllers/authController');
const { assertPhoneNumberAvailable } = require('../services/whatsappIdentity');
const createMetaInventoryRouter = require('./adminMetaInventory');
const { logScope } = require('../services/workflowLog');

function fail(res, error) {
  if (error.status && error.status < 500) return res.status(error.status).json({ error: error.message, details: error.details, code: error.code });
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
  const [seats, owner, brand] = await Promise.all([
    seatUsage(tenant.id),
    tenant.owner_user_id ? runAsSystem(() => Users.findOne({ id: tenant.owner_user_id }, { _id: 0, id: 1, name: 1, email: 1 }).lean(), 'admin') : null,
    runAsTenant(tenant.id, () => Clients.findOne({}, { _id: 0, id: 1, name: 1, whatsapp_status: 1, whatsapp_number: 1, phone_number_id: 1, wa_token_last4: 1, wa_access_token_enc: 1 }).lean()),
  ]);
  const lifecycle = computeLifecycle(tenant);
  return {
    id: tenant.id,
    name: tenant.name,
    status: tenant.status,
    lifecycle_state: lifecycle.state,
    access: lifecycle.access,
    owner: owner || null,
    users: { active: seats.activeUsers, pending_invitations: seats.pendingInvitations },
    brand: brand ? sanitizeClient(brand) : null,
    is_founding_client: Boolean(tenant.is_founding_client),
    created_at: tenant.created_at,
  };
}

function createAdminRouter({ verifyClientWhatsApp, metaInventory } = {}) {
  const router = express.Router();

  router.get('/me', (req, res) => res.json({ user: req.user, permissions: Object.fromEntries(
    ['platform.tenants.view', 'platform.tenants.manage', 'platform.tenants.export', 'platform.tenants.delete', 'platform.tenants.create', 'platform.users.manage', 'platform.staff.manage', 'platform.audit.view', 'platform.meta', 'platform.meta.admin']
      .map((p) => [p, can(req.identity, p)]),
  ) }));

  // Platform Meta WhatsApp inventory (founder/ops; registration and cache
  // clearing founder only). Never writes a brand's number or credentials.
  if (metaInventory) router.use('/meta/whatsapp', createMetaInventoryRouter({ ...metaInventory, permit, fail }));

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

  // Creating a workspace: Admin (Owner) only. There are no plans; the
  // workspace has full access with no expiry and no limits.
  router.post('/tenants', permit('platform.tenants.create'), async (req, res) => {
    try {
      const body = req.body || {};
      // Staff set the owner's password here and hand it over themselves; the
      // admin panel never sends an invitation email.
      if (typeof body.owner_password !== 'string' || !body.owner_password) {
        return res.status(400).json({ error: 'Owner password is required' });
      }
      const result = await provisioning.provisionTenant({
        business_name: body.business_name,
        owner_email: body.owner_email,
        owner_name: body.owner_name,
        owner_password: body.owner_password,
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
      const [summary, users, pending, events] = await Promise.all([
        tenantSummary(tenant),
        userAdmin.listTenantUsers(tenant.id),
        runAsTenant(tenant.id, () => Invitations.find({ accepted_at: null, revoked_at: null }, { _id: 0 }).sort({ created_at: -1 }).lean()),
        AuditEvents.find({ tenant_id: tenant.id }, { _id: 0 }).sort({ created_at: -1 }).limit(50).lean(),
      ]);
      const brand = await runAsTenant(tenant.id, () => Clients.findOne({}, { _id: 0 }).lean());
      return res.json({
        tenant: { ...tenant },
        summary,
        brand: brand ? sanitizeClient(brand) : null,
        users,
        invitations: pending.map(invitations.publicInvitation),
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
        const current = await runAsTenant(tenantId, () => Clients.findOne({}, { _id: 0, id: 1 }).lean());
        await assertPhoneNumberAvailable(changes.phone_number_id, { exceptClientId: current?.id ?? null });
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
      const inviterNames = new Map(staff.map((u) => [u.id, u.name || u.email]));
      return res.json({
        staff: staff.filter((u) => describeUser(u)?.kind === 'staff').map(userAdmin.presentUser),
        invitations: pending.map((inv) => ({ ...invitations.publicInvitation(inv), invited_by_name: inviterNames.get(inv.invited_by) || null })),
      });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.post('/staff/invitations', permit('platform.staff.manage'), async (req, res) => {
    try {
      const result = await invitations.createInvitation({
        tenantId: null, email: req.body?.email, name: req.body?.name, staffRole: String(req.body?.staff_role || 'ops').toLowerCase(), password: req.body?.password,
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

  router.post('/staff/invitations/:invitationId/resend', permit('platform.staff.manage'), async (req, res) => {
    try {
      return res.json(await invitations.resendInvitation({ invitationId: req.params.invitationId, tenantId: null, invitedBy: { id: req.user.id, name: req.user.name }, req }));
    } catch (error) {
      return fail(res, error);
    }
  });

  router.post('/staff/:userId/revoke-sessions', permit('platform.staff.manage'), async (req, res) => {
    try {
      return res.json(await userAdmin.revokeStaffSessions({ userId: req.params.userId, req }));
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

  // ── Clients Management ────────────────────────────────────
  router.get('/clients', permit('platform.tenants.view'), async (req, res) => {
    try {
      const filter = {};
      if (req.query.tenant_id) filter.tenant_id = Number(req.query.tenant_id);
      if (req.query.search) {
        const re = { $regex: escapeRegex(String(req.query.search)), $options: 'i' };
        filter.$or = [{ name: re }, { city: re }, { whatsapp_number: re }];
      }
      const clients = await Clients.find(filter, { _id: 0 }).sort({ created_at: -1 }).limit(200).lean();
      const tenantIds = [...new Set(clients.map((c) => c.tenant_id).filter((id) => id != null))];
      const tenantMap = new Map((await Tenants.find({ id: { $in: tenantIds } }, { _id: 0, id: 1, name: 1, status: 1 }).lean()).map((t) => [t.id, t]));
      return res.json({
        clients: clients.map((c) => ({
          ...sanitizeClient(c),
          tenant_name: tenantMap.get(c.tenant_id)?.name || 'Unknown',
          tenant_status: tenantMap.get(c.tenant_id)?.status || 'active',
        })),
      });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.patch('/clients/:id', permit('platform.tenants.manage'), async (req, res) => {
    try {
      const clientId = Number(req.params.id);
      const client = await Clients.findOne({ id: clientId }).lean();
      if (!client) return res.status(404).json({ error: 'Client not found' });
      const allowed = ['name', 'city', 'phone', 'contact_person', 'whatsapp_number', 'phone_number_id', 'wa_business_id', 'status', 'industry', 'wa_category', 'wa_description', 'wa_address', 'wa_email', 'wa_website'];
      const update = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) update[key] = req.body[key];
      }
      if (update.phone_number_id != null && String(update.phone_number_id).trim()) {
        update.phone_number_id = String(update.phone_number_id).trim();
        await assertPhoneNumberAvailable(update.phone_number_id, { exceptClientId: clientId });
      }
      update.updated_at = new Date();
      const updated = await Clients.findOneAndUpdate({ id: clientId }, { $set: update }, { new: true, projection: { _id: 0 } }).lean();
      return res.json({ client: sanitizeClient(updated) });
    } catch (error) {
      return fail(res, error);
    }
  });

  // ── Workflows Management ──────────────────────────────────
  // Every row is labelled: scope "platform" (WF06/WF07, no workspace) or
  // "tenant" (WF00–WF05, with the workspace it belongs to).
  router.get('/workflows/logs', permit('platform.tenants.view'), async (req, res) => {
    try {
      const filter = {};
      if (req.query.workflow && req.query.workflow !== 'ALL') filter.workflow = { $regex: escapeRegex(String(req.query.workflow)), $options: 'i' };
      if (req.query.status && req.query.status !== 'ALL') filter.status = String(req.query.status).toLowerCase();
      if (req.query.scope === 'platform') filter.tenant_id = null;
      if (req.query.scope === 'tenant') filter.tenant_id = { $ne: null };
      if (req.query.tenant_id) filter.tenant_id = Number(req.query.tenant_id);
      const logs = await WorkflowLogs.find(filter, { _id: 0 }).sort({ created_at: -1 }).limit(500).lean();
      const tenantIds = [...new Set(logs.map((l) => l.tenant_id).filter((id) => id != null))];
      const names = new Map((await Tenants.find({ id: { $in: tenantIds } }, { _id: 0, id: 1, name: 1 }).lean()).map((t) => [t.id, t.name]));
      return res.json({
        logs: logs.map((l) => ({ ...l, scope: logScope(l), tenant_name: l.tenant_id == null ? null : (names.get(l.tenant_id) ?? null) })),
      });
    } catch (error) {
      return fail(res, error);
    }
  });

  // Computed from the stored logs only; nothing is assumed when there are none.
  router.get('/workflows/telemetry', permit('platform.tenants.view'), async (req, res) => {
    try {
      const weekAgo = new Date(Date.now() - 7 * 86400000);
      const [totalExecutions, successCount, failedCount, platformExecutions, aiInterventions, recentWorkflows] = await Promise.all([
        WorkflowLogs.countDocuments(),
        WorkflowLogs.countDocuments({ status: 'success' }),
        WorkflowLogs.countDocuments({ status: 'failed' }),
        WorkflowLogs.countDocuments({ tenant_id: null }),
        AiDecisions.countDocuments(),
        WorkflowLogs.distinct('workflow', { created_at: { $gte: weekAgo } }),
      ]);
      return res.json({
        telemetry: {
          totalExecutions,
          successCount,
          failedCount,
          // null when nothing has run: there is no rate to report yet.
          successRate: totalExecutions > 0 ? Math.round((successCount / totalExecutions) * 100) : null,
          aiInterventions,
          // Workflows that logged at least once in the last 7 days.
          activeWorkflows: recentWorkflows.length,
          platformExecutions,
          tenantExecutions: totalExecutions - platformExecutions,
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
      const [totalWorkspaces, totalUsers, totalLeads, wf06Logs] = await Promise.all([
        Tenants.countDocuments({ status: { $ne: 'deleted' } }),
        Users.countDocuments({ is_active: { $ne: false } }),
        Leads.countDocuments(),
        // Platform founder reports only; a workspace cannot appear here.
        WorkflowLogs.find({ workflow: 'WF06', tenant_id: null }, { _id: 0 }).sort({ created_at: -1 }).limit(50).lean(),
      ]);

      return res.json({
        snapshot: { totalWorkspaces, totalUsers, totalLeads },
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
