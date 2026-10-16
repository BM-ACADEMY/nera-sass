/**
 * LeadOS routes: Login and password.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
module.exports = function registerAuthRoutes(app, ctx) {
const {
  NO_ID,
  Users,
  auth,
  bcrypt,
  jwt,
} = ctx;
// ══════════════════════════════════════════════════════════
// AUTH ROUTES
// ══════════════════════════════════════════════════════════

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await Users.findOne({ email: email.toLowerCase(), is_active: true }, NO_ID).lean();
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    await Users.updateOne({ id: user.id }, { $set: { last_login: new Date() } });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/change-password
app.post('/api/auth/change-password', auth, async (req, res) => {
  try {
    const { current, newPassword } = req.body;
    const currentUser = await Users.findOne({ id: req.user.id }, { password_hash: 1 }).lean();
    const valid = await bcrypt.compare(current, currentUser.password_hash);
    if (!valid) return res.status(400).json({ error: 'Current password incorrect' });
    const hash = await bcrypt.hash(newPassword, 12);
    await Users.updateOne({ id: req.user.id }, { $set: { password_hash: hash } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});
};
