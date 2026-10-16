/**
 * The current tenant's brand profile (Full Scope decision 2: one brand per
 * tenant). Replaces the old single-company lock that forced every lead onto
 * one hard-coded brand. Must be called inside a tenant context.
 */
const { Clients } = require('../models');
const { requireTenantId } = require('./tenantContext');

async function getTenantBrand() {
  const tenantId = requireTenantId();
  const brand = await Clients.findOne({}, { _id: 0, id: 1, name: 1, status: 1 }).lean();
  if (!brand) throw new Error(`Workspace ${tenantId} has no brand profile`);
  return { id: brand.id, name: brand.name };
}

// Older call sites use this name.
const getLeadOSBrand = getTenantBrand;

module.exports = { getTenantBrand, getLeadOSBrand };
