/**
 * Workflow engine logs (workflow_logs).
 *
 *   WF00–WF05  tenant workflows   one workspace's leads/campaigns; stored with
 *                                 that workspace's tenant_id (tenant context)
 *   WF06–WF07  platform workflows founder reporting and maintenance across the
 *                                 platform; stored with tenant_id = null
 *
 * The scope comes from the workflow code, never from the caller: a tenant can
 * not write a platform event and a platform event never carries a tenant.
 * No schema change is needed: tenant_id = null already marks platform rows in
 * this optionally-scoped collection.
 */
const { WorkflowLogs } = require('../models');
const { runAsSystem } = require('./tenantContext');

const TENANT_WORKFLOWS = ['WF00', 'WF01', 'WF02', 'WF03', 'WF04', 'WF05'];
const PLATFORM_WORKFLOWS = ['WF06', 'WF07'];
const MAX_MESSAGE = 4000;

class WorkflowLogError extends Error {
  constructor(message, code) {
    super(message);
    this.status = 400;
    this.code = code;
  }
}

// "WF01", "wf01" or "WF01: Conversational Sales" → "WF01"; anything else → null.
function workflowCode(value) {
  const match = /^\s*(WF0[0-7])\b/i.exec(String(value ?? ''));
  return match ? match[1].toUpperCase() : null;
}

const scopeOf = (code) => (PLATFORM_WORKFLOWS.includes(code) ? 'platform' : TENANT_WORKFLOWS.includes(code) ? 'tenant' : null);

function validEntry({ workflow, status, lead_id: leadId, message }, expectedScope) {
  const code = workflowCode(workflow);
  if (!code) throw new WorkflowLogError('workflow must be one of WF00–WF07', 'INVALID_WORKFLOW');
  if (scopeOf(code) !== expectedScope) {
    throw expectedScope === 'tenant'
      ? new WorkflowLogError(`${code} is a platform workflow; log it through the platform endpoint`, 'PLATFORM_WORKFLOW')
      : new WorkflowLogError(`${code} is a workspace workflow; log it with that workspace's x-tenant-id`, 'TENANT_WORKFLOW');
  }
  const normalizedStatus = String(status ?? '').trim().toLowerCase();
  if (!normalizedStatus || normalizedStatus.length > 32) throw new WorkflowLogError('status is required', 'INVALID_STATUS');
  return {
    workflow: code,
    status: normalizedStatus,
    lead_id: leadId == null || leadId === '' ? null : String(leadId),
    message: message == null ? null : String(message).slice(0, MAX_MESSAGE),
  };
}

// Caller must be in that workspace's tenant context (the row is stamped with it).
async function recordTenantWorkflowLog(entry) {
  return (await WorkflowLogs.create(validEntry(entry, 'tenant'))).toObject();
}

// Platform events are written outside any tenant, with tenant_id = null.
async function recordPlatformWorkflowLog(entry) {
  const row = { ...validEntry(entry, 'platform'), lead_id: null, tenant_id: null };
  return runAsSystem(async () => (await WorkflowLogs.create(row)).toObject(), 'platform-workflow-log');
}

// Read-side label for admin views.
const logScope = (row) => (row.tenant_id == null ? 'platform' : 'tenant');

module.exports = {
  TENANT_WORKFLOWS, PLATFORM_WORKFLOWS, WorkflowLogError, workflowCode, scopeOf,
  recordTenantWorkflowLog, recordPlatformWorkflowLog, logScope,
};
