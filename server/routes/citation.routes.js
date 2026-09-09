const express = require('express');
const router = express.Router();
const { runCheck, getScan, markFixed } = require('../controllers/citation.controller');
const { ensureTables } = require('../services/citations/db.init');

// Run table setup on routes registration
ensureTables();

router.post('/run-check', runCheck);
router.get('/:businessId', getScan);
router.post('/mark-fixed', markFixed);

module.exports = router;
