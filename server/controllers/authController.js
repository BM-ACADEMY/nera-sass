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

exports.createUserAndTenant = async (req, res) => {
  // Only super-admins should be able to create new tenants
  // But for the sake of simplicity, we just enforce admin role
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { name, email, password, phone, tenantName } = req.body;

  try {
    // 1. Create Tenant
    const tName = tenantName || `${name}'s Workspace`;
    const tSlug = tName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '') + '-' + Date.now().toString().slice(-4);
    
    const tenantResult = await db.query(
      'INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id',
      [tName, tSlug]
    );
    const newTenantId = tenantResult.rows[0].id;

    // 2. Hash Password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 3. Create User
    const userResult = await db.query(
      'INSERT INTO users (tenant_id, name, email, phone, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email, role',
      [newTenantId, name, email, phone, passwordHash, 'tenant_admin']
    );

    // Give every workspace a matching brand/client row so it can configure
    // its own WhatsApp number through the existing client WhatsApp flow
    // instead of sharing the platform-wide .env credentials.
    const clientResult = await db.query(
      `INSERT INTO clients (name, tenant_id, status, whatsapp_status, created_at)
       VALUES ($1, $2, 'active', 'not_configured', NOW()) RETURNING id`,
      [tName, newTenantId]
    );

    res.status(201).json({
      message: 'User and Tenant created successfully',
      user: userResult.rows[0],
      client_id: clientResult.rows[0].id
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
      JOIN tenants t ON u.tenant_id = t.id
      ORDER BY u.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
