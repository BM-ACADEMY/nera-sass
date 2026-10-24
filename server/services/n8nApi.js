/**
 * Read-only view of the n8n instance through its public REST API, for the
 * admin panel: which Getnera workflows are published and how their runs went.
 * This comes from n8n itself, so a run that fails before reaching our API
 * still shows up (workflow_logs only has what a workflow chose to report).
 *
 *   N8N_API_URL         https://<n8n>          (no trailing /api/v1)
 *   N8N_API_KEY         n8n > Settings > n8n API > Create an API key
 *   N8N_WORKFLOW_PREFIX workflows shown in the admin panel (default "Nera WF")
 */
const axios = require('axios');

class N8nApiError extends Error {
  constructor(message, status = 502, code = 'N8N_UNAVAILABLE') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function config() {
  const base = String(process.env.N8N_API_URL || '').replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  const key = process.env.N8N_API_KEY;
  if (!base || !key) throw new N8nApiError('n8n API is not configured (N8N_API_URL, N8N_API_KEY)', 503, 'N8N_NOT_CONFIGURED');
  return { base, key, prefix: process.env.N8N_WORKFLOW_PREFIX || 'Nera WF' };
}

async function n8nGet(path, params) {
  const { base, key } = config();
  try {
    const { data } = await axios.get(`${base}/api/v1${path}`, { params, timeout: 10000, headers: { 'X-N8N-API-KEY': key } });
    return data;
  } catch (err) {
    const status = err.response?.status;
    if (status === 401 || status === 403) throw new N8nApiError('n8n rejected the API key', 502, 'N8N_AUTH');
    if (status === 404) throw new N8nApiError('Not found in n8n', 404, 'N8N_NOT_FOUND');
    throw new N8nApiError(`n8n did not answer${status ? ` (HTTP ${status})` : ''}`);
  }
}

// A node set to "continue (using error output)" does not fail the run; its
// error travels as an item's json.error instead. Count that as a failure too.
function nodeError(run) {
  if (run.error) return readableError(run.error.message);
  for (const output of run.data?.main || []) {
    const failed = (output || []).find((item) => item?.json?.error?.message);
    if (failed) return readableError(failed.json.error.message);
  }
  return null;
}

// HTTP Request errors look like `402 - "{\"error\":{\"message\":\"...\"}}"`;
// keep the status and the API's own message.
function readableError(message) {
  const match = /^(\d{3}) - (.*)$/s.exec(String(message || ''));
  if (!match) return message;
  try {
    let body = JSON.parse(match[2]);
    if (typeof body === 'string') body = JSON.parse(body);
    const inner = body?.error?.message || body?.message || body?.error;
    return typeof inner === 'string' ? `${match[1]} - ${inner}` : message;
  } catch {
    return message;
  }
}

// Workspace and lead come from the trigger's payload (the webhook body our
// server sent); a scheduled run (WF3) covers many leads and has neither.
function triggerPayload(runData) {
  const first = Object.values(runData).find((runs) => !runs[0]?.source?.length);
  const json = first?.[0]?.data?.main?.[0]?.[0]?.json || {};
  return json.body && typeof json.body === 'object' ? json.body : json;
}

// Without data (includeData off) only the n8n state is known.
function summarizeExecution(e) {
  const run = {
    id: String(e.id),
    workflow_id: e.workflowId,
    status: e.status || (e.finished ? 'success' : 'unknown'),
    mode: e.mode,
    started_at: e.startedAt,
    stopped_at: e.stoppedAt,
    duration_ms: e.startedAt && e.stoppedAt ? new Date(e.stoppedAt) - new Date(e.startedAt) : null,
  };
  const result = e.data?.resultData;
  if (!result) return run;
  const runData = result.runData || {};
  const nodes = Object.entries(runData).map(([name, runs]) => {
    const error = runs.map(nodeError).find(Boolean) ?? null;
    return { name, status: error ? 'error' : 'success', error };
  });
  const handled = nodes.find((n) => n.error);
  const payload = triggerPayload(runData);
  return {
    ...run,
    // n8n says "success" when an error branch caught the failure; we do not.
    status: run.status === 'success' && handled ? 'error' : run.status,
    tenant_id: payload.tenant_id == null ? null : Number(payload.tenant_id),
    lead_id: payload.lead_id == null ? null : String(payload.lead_id),
    last_node: result.lastNodeExecuted ?? null,
    error: result.error
      ? { message: readableError(result.error.message), node: result.error.node?.name ?? result.lastNodeExecuted ?? null }
      : handled ? { message: handled.error, node: handled.name, handled: true } : null,
    nodes,
  };
}

// The Getnera workflows with published state and their latest run.
async function listWorkflows() {
  const { prefix } = config();
  const { data = [] } = await n8nGet('/workflows', { limit: 250 });
  const ours = data.filter((w) => !w.isArchived && w.name.startsWith(prefix)).sort((a, b) => a.name.localeCompare(b.name));
  return Promise.all(ours.map(async (w) => {
    const runs = await n8nGet('/executions', { workflowId: w.id, limit: 1 }).catch(() => ({ data: [] }));
    const trigger = (w.nodes || []).find((n) => /trigger|webhook/i.test(n.type));
    return {
      id: w.id,
      name: w.name,
      active: Boolean(w.active),
      trigger: trigger ? trigger.parameters?.path || trigger.type.split('.').pop() : null,
      updated_at: w.updatedAt,
      last_execution: runs.data?.[0] ? summarizeExecution(runs.data[0]) : null,
    };
  }));
}

// Recent runs; restricted to the Getnera workflows unless one is named.
// With the run data, so each row can say which workspace/lead and what failed;
// the node data itself is dropped here and never sent to the browser.
async function listExecutions({ workflowId, status, limit = 50 } = {}) {
  const max = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const workflows = await listWorkflows();
  const wanted = workflowId ? workflows.filter((w) => w.id === workflowId) : workflows;
  // Per workflow, so a busy unrelated workflow cannot crowd ours out of the page.
  const pages = await Promise.all(wanted.map((w) => n8nGet('/executions', { workflowId: w.id, limit: max, includeData: true, ...(status && { status }) })
    .then(({ data = [] }) => data.map((e) => {
      const { nodes, ...row } = summarizeExecution(e);
      return { ...row, workflow_name: w.name };
    }))));
  return pages.flat().sort((a, b) => new Date(b.started_at) - new Date(a.started_at)).slice(0, max);
}

// One run with every node it passed through and the error, if any.
async function getExecution(id) {
  return summarizeExecution(await n8nGet(`/executions/${encodeURIComponent(id)}`, { includeData: true }));
}

module.exports = { N8nApiError, listWorkflows, listExecutions, getExecution };
