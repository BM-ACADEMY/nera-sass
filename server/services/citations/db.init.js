const { CitationScans, CitationResults, ApiUsageLogs, ClientDirectoryCache } = require('../../models');

async function ensureTables() {
  try {
    await Promise.all([CitationScans, CitationResults, ApiUsageLogs, ClientDirectoryCache].map((model) => model.createIndexes()));
    console.log('✅ Mafiya Citation & Usage collections checked/created successfully.');
  } catch (err) {
    console.error('❌ Failed to ensure Mafiya citation collections:', err);
  }
}

module.exports = { ensureTables };
