/**
 * LeadOS routes: Users / team.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
module.exports = function registerUsersRoutes(app, ctx) {
const {
  Users,
  auth,
  bcrypt,
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

app.post('/api/users', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const { name, email, password, role } = req.body;
    const hash = await bcrypt.hash(password, 12);
    const created = await Users.create({ name, email: email.toLowerCase(), password_hash: hash, role: role || 'user', is_active: true, created_at: new Date() });
    res.status(201).json({ user: { id: created.id, name: created.name, email: created.email, role: created.role } });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Email already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});
};
