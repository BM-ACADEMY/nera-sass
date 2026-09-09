const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/integrationsController');

// Leads Webhook UI Endpoints (Decoupled from Content OS)
router.post("/meta/link-account", ctrl.linkMetaAccount);
router.delete("/meta/account/:id", ctrl.deleteMetaAccount);

// Meta Webhook Endpoints
router.get("/meta/webhook", ctrl.verifyMetaWebhook);
router.post("/meta/webhook", ctrl.handleMetaWebhook);

// Manual Sync
router.post("/meta/sync-leads", ctrl.syncHistoricalLeads);
router.post("/meta/sync-all-leads", ctrl.syncAllHistoricalLeads);

module.exports = router;
