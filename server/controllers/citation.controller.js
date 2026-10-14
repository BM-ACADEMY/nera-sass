const { MafiyaCitationsScansLog, CitationScans, CitationResults } = require('../models');
const { runCheckForBusiness } = require('../services/citations/citation.service');

async function runCheck(req, res) {
  const { businessId, forceRefresh = false } = req.body;
  if (!businessId) {
    return res.status(400).json({ error: 'businessId is required' });
  }

  const { checkLimit } = require('../utils/limit-checker');

  try {
    const limitCheck = await checkLimit(businessId, 'mafiya_citations_scans', async () => {
      return MafiyaCitationsScansLog.countDocuments({
        client_id: businessId,
        scanned_at: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      });
    });

    if (!limitCheck.allowed) {
      return res.status(403).json({ 
        error: 'Limit reached', 
        message: `Plan limit reached. Up to ${limitCheck.limit} Citations Audits/month. Please upgrade.`,
        limit: limitCheck.limit,
        current: limitCheck.current
      });
    }

    // Log the manual check
    await MafiyaCitationsScansLog.create({ client_id: businessId });

    const io = req.app ? req.app.get('io') : null;
    const result = await runCheckForBusiness(businessId, forceRefresh, io);
    res.json(result);
  } catch (err) {
    console.error('[Citation Controller] runCheck error:', err);
    res.status(500).json({ error: err.message || 'Failed to run citation check' });
  }
}

async function getScan(req, res) {
  const { businessId } = req.params;
  if (!businessId) {
    return res.status(400).json({ error: 'businessId is required' });
  }

  try {
    // 1. Get latest scan
    const scan = await CitationScans.findOne({ businessId }, { _id: 0 }).sort({ id: -1 }).lean();

    if (!scan) {
      return res.json({ scan: null, results: [] });
    }

    // 2. Get results for that scan
    const results = await CitationResults.find({ scanId: scan.id }, { _id: 0 }).sort({ directory: 1 }).lean();

    res.json({
      scan,
      results,
      debugData: scan.debugData || null
    });
  } catch (err) {
    console.error('[Citation Controller] getScan error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function markFixed(req, res) {
  const { resultId } = req.body;
  if (!resultId) {
    return res.status(400).json({ error: 'resultId is required' });
  }

  try {
    // 1. Find the result to get the scanId
    const resultRow = await CitationResults.findOne({ id: resultId }, { scanId: 1 }).lean();
    if (!resultRow) {
      return res.status(404).json({ error: 'Citation result not found' });
    }

    const scanId = resultRow.scanId;

    // 2. Update the status of this result to 'Match'
    await CitationResults.updateOne({ id: resultId }, { $set: { status: 'Match' } });

    // 3. Recalculate the scan summary counts and score
    const statuses = await CitationResults.find({ scanId }, { _id: 0, status: 1 }).lean();
    const matched = statuses.filter((r) => r.status === 'Match').length;
    const mismatched = statuses.filter((r) => r.status === 'Mismatch').length;
    const missing = statuses.filter((r) => r.status === 'Missing').length;
    const total = statuses.length;

    const score = total > 0 ? Math.round((matched / total) * 100) : 0;

    // 4. Update the scan record
    const updatedScan = await CitationScans.findOneAndUpdate(
      { id: scanId },
      { $set: { score, matched, mismatched, missing } },
      { new: true, projection: { _id: 0 } }
    ).lean();

    res.json({
      success: true,
      scan: updatedScan
    });
  } catch (err) {
    console.error('[Citation Controller] markFixed error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  runCheck,
  getScan,
  markFixed
};
