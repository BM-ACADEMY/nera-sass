const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dataFile = path.join(dataDir, 'keywords.json');

// Initialize data file if it doesn't exist
if (!fs.existsSync(dataFile)) {
  fs.writeFileSync(dataFile, JSON.stringify([]));
}

const getKeywords = () => {
  try {
    const data = fs.readFileSync(dataFile, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
};

const saveKeywords = (data) => {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
};

// GET all tracked keywords
router.get('/', (req, res) => {
  const keywords = getKeywords();
  res.json({ items: keywords });
});

// POST new keyword
router.post('/', (req, res) => {
  const { keyword, targetUrl } = req.body;
  if (!keyword || !targetUrl) {
    return res.status(400).json({ error: 'Keyword and targetUrl are required.' });
  }

  const keywords = getKeywords();
  
  const newItem = {
    id: crypto.randomUUID(),
    keyword,
    targetUrl,
    currentRank: null,
    previousRank: null,
    lastChecked: null
  };

  keywords.push(newItem);
  saveKeywords(keywords);

  res.json(newItem);
});

// POST refresh keyword rank
router.post('/refresh/:id', async (req, res) => {
  const { id } = req.params;
  const keywords = getKeywords();
  
  const itemIndex = keywords.findIndex(k => k.id === id);
  if (itemIndex === -1) {
    return res.status(404).json({ error: 'Keyword not found.' });
  }

  const item = keywords[itemIndex];
  
  try {
    const apiKey = process.env.VALUESERP_API_KEY || process.env.SERPER_API_KEY || process.env.SERP_API_KEY;
    const isDemo = req.headers['x-data-mode'] === 'demo' || !apiKey;

    if (isDemo) {
      // Simulate rank search
      const rank = Math.random() > 0.15 ? Math.floor(Math.random() * 20) + 1 : null;
      item.previousRank = item.currentRank;
      item.currentRank = rank;
      item.lastChecked = new Date().toISOString();
      keywords[itemIndex] = item;
      saveKeywords(keywords);
      return res.json(item);
    }

    const response = await axios.get('https://api.valueserp.com/search', {
      params: {
        q: item.keyword,
        gl: "in",
        hl: "en",
        api_key: apiKey,
        num: 100
      }
    });

    let rank = null;
    const organicResults = response.data.organic_results || [];
    
    // Scan organic array to find targetUrl domain
    try {
      const targetDomain = new URL(item.targetUrl).hostname.replace('www.', '');
      for (const result of organicResults) {
        if (result.link && result.link.includes(targetDomain)) {
          rank = result.position;
          break;
        }
      }
    } catch (e) {
      console.error('Error parsing targetUrl', e);
    }

    item.previousRank = item.currentRank;
    item.currentRank = rank;
    item.lastChecked = new Date().toISOString();
    
    keywords[itemIndex] = item;
    saveKeywords(keywords);
    
    res.json(item);
  } catch (error) {
    console.error('Serper API error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch rank from Serper.dev API.' });
  }
});

// DELETE keyword
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  let keywords = getKeywords();
  
  keywords = keywords.filter(k => k.id !== id);
  saveKeywords(keywords);
  
  res.json({ success: true });
});

module.exports = router;
