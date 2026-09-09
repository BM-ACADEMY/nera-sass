const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const openRouter = require('../services/openrouter');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'leados_db',
  user: process.env.DB_USER || 'leados_user',
  password: process.env.DB_PASS || 'LeadOS_DB@2026',
});

// Ensure the table exists
const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        schema_type VARCHAR(100) NOT NULL,
        schema_data JSONB NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Schema Library DB initialized.');
  } catch (err) {
    console.error('Failed to init schema_templates table:', err);
  }
};
initDB();

// GET all schemas
router.get('/', async (req, res) => {
  const isDemoMode = req.headers['x-data-mode'] === 'demo';
  if (isDemoMode) {
    return res.json({
      items: [
        {
          id: 901,
          name: 'Demo Local Business Schema',
          schema_type: 'LocalBusiness',
          description: 'Demo schema for local business location',
          created_at: new Date().toISOString(),
          schema_data: {
            "@context": "https://schema.org",
            "@type": "LocalBusiness",
            "name": "Demo Digital Agency",
            "image": "https://example.com/logo.png",
            "url": "https://example.com",
            "telephone": "+1-555-123-4567",
            "address": {
              "@type": "PostalAddress",
              "streetAddress": "123 Demo Street",
              "addressLocality": "Demo City",
              "postalCode": "12345",
              "addressCountry": "US"
            }
          }
        },
        {
          id: 902,
          name: 'Demo Organization Schema',
          schema_type: 'Organization',
          description: 'Corporate organization markup for demo',
          created_at: new Date().toISOString(),
          schema_data: {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "Demo Inc.",
            "url": "https://example.com",
            "logo": "https://example.com/logo.png"
          }
        }
      ]
    });
  }

  try {
    const { rows } = await pool.query('SELECT * FROM schema_templates ORDER BY created_at DESC');
    res.json({ items: rows });
  } catch (err) {
    console.error('Fetch schema error:', err);
    res.status(500).json({ error: 'Failed to fetch schema templates' });
  }
});

// POST new schema
router.post('/', async (req, res) => {
  try {
    const { name, schema_type, schema_data, description } = req.body;
    if (!name || !schema_type || !schema_data) {
      return res.status(400).json({ error: 'Name, schema_type, and schema_data are required.' });
    }

    const { rows } = await pool.query(`
      INSERT INTO schema_templates (name, schema_type, schema_data, description, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      RETURNING *
    `, [name, schema_type, JSON.stringify(schema_data), description]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create schema error:', err);
    res.status(500).json({ error: 'Failed to create schema template' });
  }
});


// POST generate schema via AI
router.post('/generate', async (req, res) => {
  try {
    const { businessName, businessType, website, description } = req.body;
    
    if (!openRouter.isConfigured) {
      return res.status(500).json({ error: 'OPENROUTER_API_KEY is not configured.' });
    }
    
    const prompt = `You are an expert SEO schema generator.
Generate a perfect JSON-LD schema array for the following business:
Name: ${businessName || 'Unknown'}
Type: ${businessType || 'LocalBusiness'}
Website: ${website || ''}
Description: ${description || ''}

Include both an 'Organization' schema and a '${businessType || 'LocalBusiness'}' schema if applicable.
Return ONLY valid JSON. Do not include markdown formatting like \`\`\`json. Just the raw JSON object or array.`;

    const response = await openRouter.models.generateContent({
      model: openRouter.DEFAULT_MODEL,
      contents: prompt,
    });
    
    let result = response.text;
    result = result.replace(/```json/g, '').replace(/```/g, '').trim();
    
    const parsed = JSON.parse(result);
    res.json({ schema_data: parsed });
  } catch (err) {
    console.error('AI Generate Error:', err);
    res.status(500).json({ error: 'Failed to generate schema via AI' });
  }
});

// POST validate schema via AI
router.post('/validate', async (req, res) => {
  try {
    const { schema_data } = req.body;
    
    if (!openRouter.isConfigured) {
      return res.status(500).json({ error: 'OPENROUTER_API_KEY is not configured.' });
    }
    
    const prompt = `You are a Google Search Central Schema Validator.
Analyze the following JSON-LD schema and tell me if it is valid for Google Rich Results.
Identify any missing required properties, warnings, or format errors.

Schema:
${JSON.stringify(schema_data, null, 2)}

Return ONLY a JSON object with this exact structure (no markdown):
{
  "isValid": boolean,
  "errors": ["list of strings"],
  "warnings": ["list of strings"]
}`;

    const response = await openRouter.models.generateContent({
      model: openRouter.DEFAULT_MODEL,
      contents: prompt,
    });
    
    let result = response.text;
    result = result.replace(/```json/g, '').replace(/```/g, '').trim();
    
    const parsed = JSON.parse(result);
    res.json(parsed);
  } catch (err) {
    console.error('AI Validate Error:', err);
    res.status(500).json({ error: 'Failed to validate schema' });
  }
});

// --- DYNAMIC ENTITY & DEPLOYMENT ROUTES ---

// GET all entity links
router.get('/entities', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, type, url FROM schema_entity_links ORDER BY id ASC');
    res.json({ entities: rows });
  } catch (err) {
    console.error('Fetch entities error:', err);
    res.status(500).json({ error: 'Failed to fetch entity links' });
  }
});

// PUT update all entity links
router.put('/entities', async (req, res) => {
  const client = await pool.connect();
  try {
    const { entities } = req.body;
    if (!Array.isArray(entities)) return res.status(400).json({ error: 'Expected an array of entities' });

    await client.query('BEGIN');
    await client.query('DELETE FROM schema_entity_links');
    
    for (const entity of entities) {
      if (entity.type && entity.url) {
        await client.query('INSERT INTO schema_entity_links (type, url) VALUES ($1, $2)', [entity.type, entity.url]);
      }
    }
    
    await client.query('COMMIT');
    res.json({ success: true, message: 'Entities updated successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update entities error:', err);
    res.status(500).json({ error: 'Failed to update entity links' });
  } finally {
    client.release();
  }
});

// GET all deployments
router.get('/deployments', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT d.*, t.name as template_name 
      FROM schema_deployments d
      LEFT JOIN schema_templates t ON d.template_id = t.id
      ORDER BY d.deployed_at DESC
    `);
    res.json({ deployments: rows });
  } catch (err) {
    console.error('Fetch deployments error:', err);
    res.status(500).json({ error: 'Failed to fetch deployments' });
  }
});

// POST new deployment
router.post('/deployments', async (req, res) => {
  try {
    const { templateId, clientUrl } = req.body;
    if (!templateId || !clientUrl) return res.status(400).json({ error: 'Template ID and Client URL are required' });

    const { rows } = await pool.query(`
      INSERT INTO schema_deployments (template_id, client_url, deployed_at)
      VALUES ($1, $2, NOW())
      RETURNING *
    `, [templateId, clientUrl]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create deployment error:', err);
    res.status(500).json({ error: 'Failed to save deployment' });
  }
});

// PUT update schema
router.put('/:id', async (req, res) => {
  try {
    const { name, schema_type, schema_data, description } = req.body;
    const { id } = req.params;

    const { rows } = await pool.query(`
      UPDATE schema_templates 
      SET name = $1, schema_type = $2, schema_data = $3, description = $4, updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `, [name, schema_type, JSON.stringify(schema_data), description, id]);

    if (!rows.length) return res.status(404).json({ error: 'Template not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Update schema error:', err);
    res.status(500).json({ error: 'Failed to update schema template' });
  }
});

// DELETE schema
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM schema_templates WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Template not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete schema error:', err);
    res.status(500).json({ error: 'Failed to delete schema template' });
  }
});

module.exports = router;
