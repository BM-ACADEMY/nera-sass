// backend/services/openai.js
const Groq = require('groq-sdk');
const axios = require('axios');
const { KnowledgeBase, PromptTemplates, AiAnalysis, Organisations } = require('../models');
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
    
  const categoryRank = { profile: 1, mou: 2, faq: 3 };
  const rows = (await KnowledgeBase.find({ brand: { $in: brandFilter } }, { _id: 0, title: 1, brand: 1, category: 1, content: 1, created_at: 1 }).lean())
    .sort((a, b) => (categoryRank[a.category] || 4) - (categoryRank[b.category] || 4)
      || new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, 5)
    .map((r) => ({ ...r, content: r.content == null ? r.content : String(r.content).slice(0, 2000) }));
  
  if (rows.length === 0) {
    return 'Knowledge base is empty. Upload ABM Groups profile PDFs first.';
  }
  
  return rows.map(r =>
    `=== ${r.brand.toUpperCase()} — ${r.title} ===\n${r.content}`
  ).join('\n\n---\n\n');
}

// PROMPT BUILDER
async function buildPrompt(org, websiteText, kbContext) {
  const template = await PromptTemplates.findOne({ name: `${org.type}_analyzer`, active: true }, { prompt_text: 1 }).lean();
  let prompt = template?.prompt_text || getHardcodedPrompt(org.type);
  
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
  await AiAnalysis.create({
    org_id: org.id,
    score: result.score || 50,
    offer_recommended: result.offer_recommended || '',
    reason: result.reason || '',
    bm_course_match: result.bm_course_match || result.skills_match || '',
    core_talents_offer: result.core_talents_offer || '',
    personalisation_hook: result.personalisation_hook || '',
    hiring_potential: result.hiring_potential || 'medium',
    training_potential: result.training_potential || 'medium',
    raw_json: result,
  }).catch((error) => { if (error.code !== 11000) throw error; }); // ON CONFLICT DO NOTHING
  
  // Update org status
  await Organisations.updateOne({ id: org.id }, { $set: { status: 'analysed', updated_at: new Date() } });
  
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
    const org = await Organisations.findOne({ id }).lean();
    if (org) {
      const result = await analyzeOrganisation(org);
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
