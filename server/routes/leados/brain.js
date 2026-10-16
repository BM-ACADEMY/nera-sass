/**
 * LeadOS routes: AI Brain documents.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
module.exports = function registerBrainRoutes(app, ctx) {
const {
  BrainDocs,
  NO_ID,
  auth,
  upsertOne,
} = ctx;
// ══════════════════════════════════════════════════════════
// AI BRAIN (brain_docs table)
// ══════════════════════════════════════════════════════════
app.get('/api/brain', auth, async (req, res) => {
  try {
    const { client_id } = req.query;
    const rows = client_id
      ? await BrainDocs.find({ client_id }, NO_ID).sort({ doc_type: 1 }).lean()
      : await BrainDocs.find({}, NO_ID).sort({ client_id: 1, doc_type: 1 }).lean();
    res.json({ docs: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/brain', auth, async (req, res) => {
  try {
    const { client_id, doc_type, content } = req.body;
    const doc = await upsertOne(
      BrainDocs,
      { client_id, doc_type },
      { $set: { content, updated_at: new Date() } },
      { client_id, doc_type, content, updated_at: new Date() }
    );
    res.json({ doc });
  } catch (err) {
    console.error('Brain Doc Save Error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});
};
