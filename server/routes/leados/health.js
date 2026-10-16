/**
 * LeadOS routes: Health check.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
module.exports = function registerHealthRoutes(app, ctx) {
const {

} = ctx;
// ══════════════════════════════════════════════════════════
// HEALTH
// ══════════════════════════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ABM LeadOS API', ts: new Date().toISOString() });
});
};
