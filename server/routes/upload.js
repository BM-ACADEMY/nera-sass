const express = require('express');
const multer = require('multer');
const csvParser = require('csv-parser');
const fs = require('fs');
const db = require('../db/connection');
const router = express.Router();
const upload = multer({ dest: 'uploads/csv/' });

// POST /api/upload/csv
router.post('/csv', upload.single('file'), async (req, res) => {
  const { type, source } = req.body; // 'college' or 'company'
  
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  }

  const results = [];
  try {
    await new Promise((resolve, reject) => {
      fs.createReadStream(req.file.path)
        .pipe(csvParser())
        .on('data', (data) => results.push(data))
        .on('end', resolve)
        .on('error', reject);
    });

    fs.unlinkSync(req.file.path);
    
    let inserted = 0;
    
    for (const row of results) {
      const name = row['Organisation Name'] || row['Name'];
      if (!name) continue; // Skip invalid rows
      
      const email = row['Email'];
      const phone = row['Phone'];
      const website = row['Website'];
      const location = row['Location'];
      const district = row['District'];
      const contact_name = row['Contact Name'] || row['Principal Name'];
      
      const { rowCount } = await db.query(`
        INSERT INTO organisations
        (name, type, website, email, phone, location, district, contact_name, lead_source)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT DO NOTHING
        RETURNING id
      `, [name, type, website, email, phone, location, district, contact_name, source || 'CSV Upload']);
      
      if (rowCount > 0) inserted++;
    }
    
    res.json({
      success: true,
      message: `Successfully inserted ${inserted} ${type} records out of ${results.length} total rows.`,
      inserted
    });
    
  } catch (err) {
    console.error('CSV error:', err);
    res.status(500).json({ success: false, message: 'Failed to process CSV file.' });
  }
});

module.exports = router;
