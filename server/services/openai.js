// backend/services/openai.js
const Groq = require('groq-sdk');
const axios = require('axios');
const db = require('../db/connection');
const groq = new Groq({ apiKey: process.env.OPENAI_API_KEY || 'dummy_key' });

// WEBSITE SCRAPER
async function scrapeWebsite(url) {
  try {
    if (!url || url.trim() === '') return 'No website available.';
    
    // Auto-fix URL if it's missing protocol
    if (!/^https?:\/\//i.test(url)) {
      url = 'http://' + url;
    }

    const res = await axios.get(url, { timeout: 8000 });
    const text = res.data
      .replace(/<script[^>]*>.*?<\/script>/gis, '')
      .replace(/<style[^>]*>.*?<\/style>/gis, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);
    return text || 'Website found but no readable content.';
  } catch (err) {
    return 'Website unavailable.';
  }
}

// KNOWLEDGE BASE CONTEXT RETRIEVAL
async function getKBContext(orgType) {
  const brandFilter = orgType === 'college'
    ? ['BM Academy','Core Talents','BM TechX','All']
    : ['Core Talents','BM Academy','All'];
    
  const { rows } = await db.query(`
    SELECT title, brand, category,
           LEFT(content, 2000) AS content
    FROM knowledge_base
    WHERE brand = ANY($1)
    ORDER BY
      CASE category
        WHEN 'profile' THEN 1
        WHEN 'mou' THEN 2
        WHEN 'faq' THEN 3
        ELSE 4
      END,
      created_at DESC
    LIMIT 5
  `, [brandFilter]);
  
  if (rows.length === 0) {
    return 'Knowledge base is empty. Upload ABM Groups profile PDFs first.';
  }
  
  return rows.map(r =>
    `=== ${r.brand.toUpperCase()} — ${r.title} ===\n${r.content}`
  ).join('\n\n---\n\n');
}

// PROMPT BUILDER
async function buildPrompt(org, websiteText, kbContext) {
  const { rows } = await db.query(
    `SELECT prompt_text FROM prompt_templates WHERE name = $1 AND active = TRUE`,
    [`${org.type}_analyzer`]
  );
  let prompt = rows[0]?.prompt_text || getHardcodedPrompt(org.type);
  
  prompt = prompt
    .replace('{{org_name}}', org.name || '')
    .replace('{{district}}', org.district || org.location || 'Tamil Nadu')
    .replace('{{industry}}', org.industry || 'Unknown')
    .replace('{{website_text}}', websiteText || '')
    .replace('{{kb_context}}', kbContext || '');
  return prompt;
}

// MAIN ANALYZER
async function analyzeOrganisation(org) {
  const [websiteText, kbContext] = await Promise.all([
    scrapeWebsite(org.website),
    getKBContext(org.type)
  ]);
  
  const prompt = await buildPrompt(org, websiteText, kbContext);
  let raw, result;
  
  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 600,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }]
    });
    
    raw = response.choices[0].message.content.trim();
    result = JSON.parse(raw);
  } catch (err) {
    console.error('Groq parse error:', err.message);
    result = {
      score: 50,
      offer_recommended: 'Standard MoU — manual review needed',
      reason: 'AI analysis failed. Review manually.',
      personalisation_hook: '',
      training_potential: 'medium',
      placement_potential: 'medium',
      hiring_potential: 'medium',
      bm_course_match: '',
      core_talents_offer: ''
    };
  }
  
  // Save analysis to database
  await db.query(`
    INSERT INTO ai_analysis
    (org_id, score, offer_recommended, reason,
     bm_course_match, core_talents_offer,
     personalisation_hook, hiring_potential,
     training_potential, raw_json)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT DO NOTHING
  `, [
    org.id,
    result.score || 50,
    result.offer_recommended || '',
    result.reason || '',
    result.bm_course_match || result.skills_match || '',
    result.core_talents_offer || '',
    result.personalisation_hook || '',
    result.hiring_potential || 'medium',
    result.training_potential || 'medium',
    result
  ]);
  
  // Update org status
  await db.query(
    `UPDATE organisations SET status='analysed', updated_at=NOW() WHERE id=$1`,
    [org.id]
  );
  
  // Telegram alert for HOT leads (score >= 85)
  if ((result.score || 0) >= 85) {
    const msg =
      `■ HOT LEAD\\n` +
      `Org: ${org.name}\\n` +
      `Score: ${result.score}/100\\n` +
      `Offer: ${result.offer_recommended}\\n` +
      `Hook: ${result.personalisation_hook}\\n` +
      `District: ${org.district}`;
    await sendTelegramAlert(msg);
  }
  
  return result;
}

// BATCH ANALYZER
async function analyzeBatch(orgIds) {
  const results = [];
  const DELAY_MS = 1500;
  for (const id of orgIds) {
    const { rows } = await db.query('SELECT * FROM organisations WHERE id=$1', [id]);
    if (rows.length > 0) {
      const result = await analyzeOrganisation(rows[0]);
      results.push({ id, score: result.score });
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }
  return results;
}

// TELEGRAM ALERT
async function sendTelegramAlert(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  
  await axios.post(
    `https://api.telegram.org/bot${token}/sendMessage`,
    { chat_id: chatId, text: message, parse_mode: 'HTML' }
  ).catch(err => console.error('Telegram error:', err.message));
}

function getHardcodedPrompt(type) {
  return type === 'college'
    ? `Analyze this Tamil Nadu college. Return JSON with:
score(0-100), offer_recommended, reason, bm_course_match,
core_talents_offer, training_potential(high/medium/low),
placement_potential(high/medium/low), personalisation_hook.
College: {{org_name}}. District: {{district}}.
Website: {{website_text}}. Context: {{kb_context}}`
    : `Analyze this company for talent hiring partnership.
Return JSON with: score(0-100), offer_recommended(Free/Growth/Partner),
reason, skills_match, hiring_potential(high/medium/low),
personalisation_hook.
Company: {{org_name}}. District: {{district}}.
Website: {{website_text}}. Context: {{kb_context}}`;
}

module.exports = { analyzeOrganisation, analyzeBatch, getKBContext };
