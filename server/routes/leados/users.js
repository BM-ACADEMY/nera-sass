/**
 * LeadOS routes: Users / team.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
module.exports = function registerUsersRoutes(app, ctx) {
const {
  Users,
  auth,
} = ctx;
// ══════════════════════════════════════════════════════════
// USERS / TEAM
// ══════════════════════════════════════════════════════════
app.get('/api/users', auth, async (req, res) => {
  try {
    const rows = await Users.find({}, { _id: 0, id: 1, name: 1, email: 1, role: 1, is_active: 1, last_login: 1, created_at: 1 }).sort({ created_at: 1 }).lean();
    res.json({ users: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Each workspace has one login, created with the workspace by platform staff,
// so customers cannot add users here.
app.post('/api/users', auth, (req, res) => {
  res.status(409).json({ error: 'This workspace already has its login. Each workspace has one login.' });
});
};
