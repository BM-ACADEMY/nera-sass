const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const fs = require('fs');
const db = require('../db/connection');
const { getKBContext } = require('../services/openai');
const router = express.Router();
const upload = multer({ dest: 'uploads/kb/' });

// POST /api/knowledge/upload
router.post('/upload', upload.single('file'), async (req, res) => {
  const { title, category, brand } = req.body;
  try {
    let text = '';
    if (req.file.mimetype === 'application/pdf') {
      const buffer = fs.readFileSync(req.file.path);
      const data = await pdfParse(buffer);
      text = data.text
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 10000);
    } else {
      text = fs.readFileSync(req.file.path, 'utf8').slice(0, 10000);
    }
    fs.unlinkSync(req.file.path);
    
    if (!text || text.length < 50) {
      return res.status(400).json({
        success: false,
        message: 'Could not extract text from file. Check PDF is not scanned image.'
      });
    }
    
    const { rows } = await db.query(`
      INSERT INTO knowledge_base
      (title, category, brand, content, file_name, char_count)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id
    `, [title, category, brand, text, req.file.originalname, text.length]);
    
    res.json({
      success: true,
      id: rows[0].id,
      chars_extracted: text.length,
      message: `Knowledge base updated: ${title}`
    });
  } catch (err) {
    console.error('KB upload error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/knowledge
router.get('/', async (req, res) => {
  const { rows } = await db.query(`
    SELECT id, title, category, brand,
           char_count, created_at,
           LEFT(content, 200) AS preview
    FROM knowledge_base
    ORDER BY created_at DESC
  `);
  res.json({ success: true, documents: rows });
});

// DELETE /api/knowledge/:id
router.delete('/:id', async (req, res) => {
  await db.query('DELETE FROM knowledge_base WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// GET /api/knowledge/context?type=college
router.get('/context', async (req, res) => {
  const { type } = req.query;
  const context = await getKBContext(type);
  res.json({ success: true, context, length: context.length });
});

module.exports = router;
