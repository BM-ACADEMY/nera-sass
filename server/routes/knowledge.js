const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const fs = require('fs');
const { KnowledgeBase } = require('../models');
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
    
    const doc = await KnowledgeBase.create({
      title, category, brand, content: text, file_name: req.file.originalname, char_count: text.length,
    });

    res.json({
      success: true,
      id: doc.id,
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
  const docs = await KnowledgeBase.find({}, { _id: 0, id: 1, title: 1, category: 1, brand: 1, char_count: 1, created_at: 1, content: 1 })
    .sort({ created_at: -1 }).lean();
  const rows = docs.map(({ content, ...doc }) => ({ ...doc, preview: content == null ? null : String(content).slice(0, 200) }));
  res.json({ success: true, documents: rows });
});

// DELETE /api/knowledge/:id
router.delete('/:id', async (req, res) => {
  await KnowledgeBase.deleteOne({ id: req.params.id });
  res.json({ success: true });
});

// GET /api/knowledge/context?type=college
router.get('/context', async (req, res) => {
  const { type } = req.query;
  const context = await getKBContext(type);
  res.json({ success: true, context, length: context.length });
});

module.exports = router;
