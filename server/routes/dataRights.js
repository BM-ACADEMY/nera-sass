/**
 * Customer data rights, for the signed-in workspace only (`auth` re-reads the
 * user and runs the request in that user's tenant context; the tenant never
 * comes from the request).
 *
 *   GET    /api/contacts/:id/export.csv     one contact's conversation (leads.export)
 *   GET    /api/data-export/workspace.csv   every message or contact (workspace.export)
 *   POST   /api/contacts/:id/erase          delete on request (leads.delete)
 *   GET    /api/reply-webhook               webhook settings, never the secret
 *   PUT    /api/reply-webhook               set the URL (first save returns the secret once)
 *   POST   /api/reply-webhook/rotate-secret new secret, returned once
 *   GET    /api/reply-webhook/deliveries    delivery log: ids, codes, no message text
 *
 * Every export and every deletion writes an audit event first (who, what, when,
 * row counts, never message text or phone numbers) and is refused if that
 * entry cannot be written. Customers only ever see short messages, never raw errors.
 */
const express = require('express');
const { auth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../services/permissions');
const audit = require('../services/audit');
const exporter = require('../services/dataExport');
const { startCsv, writeRows } = require('../services/csvExport');
const erasure = require('../services/erasure');
const replyWebhook = require('../services/replyWebhook');

const router = express.Router();
router.use(['/contacts', '/data-export', '/reply-webhook'], auth);

function fail(res, error) {
  if (error?.status && error.status < 500) {
    return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
  }
  console.error('[data-rights]', error?.name, error?.message);
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

async function streamCsv(res, { filename, columns, batches }) {
  startCsv(res, filename, columns);
  try {
    for await (const rows of batches) await writeRows(res, rows);
  } catch (error) {
    // Headers are already sent: end the file; the audit entry shows the intent.
    console.error('[data-rights] Export stream failed:', error?.message);
  }
  res.end();
}

const stamp = () => new Date().toISOString().slice(0, 10);

// ── exports ──────────────────────────────────────────────────────────────────
router.get('/contacts/:id/export.csv', requirePermission('leads.export'), async (req, res) => {
  try {
    const lead = await exporter.findContact(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Contact not found' });
    const { messages, notes, conversationIds } = await exporter.countContactRows(lead);
    await audit.record(audit.EVENTS.CONTACT_EXPORTED, {
      tenantId: req.identity.tenantId, req, targetType: 'lead', targetId: lead.id, meta: { format: 'csv', messages, notes }, strict: true,
    });
    return streamCsv(res, {
      filename: `contact-${lead.id}-conversation-${stamp()}.csv`,
      columns: exporter.MESSAGE_COLUMNS,
      batches: exporter.contactRows(lead, conversationIds),
    });
  } catch (error) {
    return fail(res, error);
  }
});

router.get('/data-export/workspace.csv', requirePermission('workspace.export'), async (req, res) => {
  try {
    const part = req.query.part === 'contacts' ? 'contacts' : 'messages';
    const rows = await exporter.countWorkspace(part);
    await audit.record(audit.EVENTS.WORKSPACE_EXPORTED, {
      tenantId: req.identity.tenantId, req, targetType: 'workspace', targetId: req.identity.tenantId, meta: { format: 'csv', part, rows }, strict: true,
    });
    return streamCsv(res, {
      filename: `workspace-${part}-${stamp()}.csv`,
      columns: part === 'contacts' ? exporter.CONTACT_COLUMNS : exporter.WORKSPACE_MESSAGE_COLUMNS,
      batches: part === 'contacts' ? exporter.workspaceContactRows() : exporter.workspaceMessageRows(),
    });
  } catch (error) {
    return fail(res, error);
  }
});

// ── delete on request ───────────────────────────────────────────────────────
router.post('/contacts/:id/erase', requirePermission('leads.delete'), async (req, res) => {
  try {
    if (req.body?.confirm !== 'DELETE') {
      return res.status(400).json({ error: 'Confirm the deletion by sending confirm: "DELETE".', code: 'CONFIRMATION_REQUIRED' });
    }
    // The audit entry comes first: no deletion without its record.
    await audit.record(audit.EVENTS.CONTACT_ERASED, {
      tenantId: req.identity.tenantId, req, targetType: 'lead', targetId: req.params.id, meta: { stage: 'requested' }, strict: true,
    });
    const result = await erasure.eraseContact(req.params.id, { userId: req.user.id });
    await audit.record(audit.EVENTS.CONTACT_ERASED, {
      tenantId: req.identity.tenantId, req, targetType: 'lead', targetId: req.params.id, meta: { stage: 'completed', counts: result.counts },
    });
    return res.json({ success: true, already_erased: result.already_erased, counts: result.counts });
  } catch (error) {
    if (error instanceof Error && !error.status && /media server|ECONN|fetch failed/i.test(error.message)) {
      return res.status(502).json({ error: 'Some files could not be removed yet. Sending is already stopped. Please try again in a few minutes.', code: 'ERASURE_INCOMPLETE' });
    }
    return fail(res, error);
  }
});

// ── reply webhook ───────────────────────────────────────────────────────────
const manage = requirePermission('tenant.settings');

router.get('/reply-webhook', manage, async (req, res) => {
  try {
    return res.json({ config: await replyWebhook.getConfig() });
  } catch (error) {
    return fail(res, error);
  }
});

router.put('/reply-webhook', manage, async (req, res) => {
  try {
    const { url, enabled } = req.body || {};
    const { config, secret, created } = await replyWebhook.saveConfig({ url, enabled: enabled !== false });
    await audit.record(audit.EVENTS.REPLY_WEBHOOK_UPDATED, {
      tenantId: req.identity.tenantId, req, targetType: 'reply_webhook', meta: { host: new URL(config.url).host, enabled: config.enabled, created },
    });
    return res.json({ config, ...(secret ? { secret, secret_notice: 'Copy this secret now. It is not shown again.' } : {}) });
  } catch (error) {
    return fail(res, error);
  }
});

router.post('/reply-webhook/rotate-secret', manage, async (req, res) => {
  try {
    const { config, secret } = await replyWebhook.rotateSecret();
    await audit.record(audit.EVENTS.REPLY_WEBHOOK_SECRET_ROTATED, { tenantId: req.identity.tenantId, req, targetType: 'reply_webhook' });
    return res.json({ config, secret, secret_notice: 'Copy this secret now. It is not shown again.' });
  } catch (error) {
    return fail(res, error);
  }
});

router.get('/reply-webhook/deliveries', manage, async (req, res) => {
  try {
    return res.json({ deliveries: await replyWebhook.listDeliveries(req.query.limit) });
  } catch (error) {
    return fail(res, error);
  }
});

module.exports = router;
