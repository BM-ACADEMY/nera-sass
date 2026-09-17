const db = require('../db/connection');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key';

exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const userResult = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = userResult.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, tenant_id: user.tenant_id, role: user.role },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenant_id: user.tenant_id,
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.createUser = async (req, res) => {
  // Only admins can create users
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { name, email, password, phone } = req.body;

  try {
    // Hash Password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create User (no tenant, 'user' role)
    const userResult = await db.query(
      'INSERT INTO users (name, email, phone, password_hash, role, tenant_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email, role',
      [name, email, phone, passwordHash, 'user', null]
    );

    res.status(201).json({
      message: 'User created successfully',
      user: userResult.rows[0]
    });
  } catch (error) {
    console.error('Create User Error:', error);
    if (error.code === '23505') { // unique violation in pg
       return res.status(400).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.me = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT u.id, u.name, u.email, u.phone, u.role, u.tenant_id, t.name as tenant_name
      FROM users u
      JOIN tenants t ON u.tenant_id = t.id
      WHERE u.id = $1
    `, [req.user.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getUsers = async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  try {
    const result = await db.query(`
      SELECT u.id, u.name, u.email, u.phone, u.role, u.tenant_id, t.name as tenant_name
      FROM users u
      LEFT JOIN tenants t ON u.tenant_id = t.id
      ORDER BY u.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
