const express = require('express');
const axios = require('axios');
const openRouter = require('../services/openrouter');
const { ChatbotKnowledgebase, ChatbotUserprogresses, ChatbotFlowsteps, Leads, Clients, Messages } = require('../models');
const router = express.Router();

// Helper: Get OpenRouter Embedding
async function getEmbedding(text) {
  try {
    return await openRouter.createEmbedding(text, 768);
  } catch (error) {
    console.error('Error getting embedding:', error.response?.data || error.message);
    return null;
  }
}

// Helper: Cosine Similarity
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// CREATE knowledge base entry
router.post('/knowledgebase', async (req, res) => {
  const { flow_id, title, content, tags } = req.body;
  if (!flow_id || !title || !content) return res.status(400).json({ error: 'Missing required fields' });
  
  const embedding = await getEmbedding(content);
  if (!embedding) return res.status(500).json({ error: 'Failed to generate embedding' });

  try {
    const entry = await ChatbotKnowledgebase.create({ flow_id, title, content, tags: tags || [], embedding });
    res.json(entry.toObject());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET knowledge base entries
router.get('/knowledgebase/:flow_id', async (req, res) => {
  try {
    const entries = await ChatbotKnowledgebase.find(
      { flow_id: req.params.flow_id },
      { _id: 0, id: 1, flow_id: 1, title: 1, content: 1, tags: 1, is_active: 1 }
    ).lean();
    res.json(entries);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Chat Endpoint for Message Handling Logic (called by n8n or direct webhook)
router.post('/chat', async (req, res) => {
  const { lead_id, flow_id, message } = req.body;
  
  try {
    // 1. Look up user progress
    let progress = await ChatbotUserprogresses.findOne({ lead_id, flow_id }).lean();

    if (!progress) {
      // Create initial progress if it doesn't exist
      progress = (await ChatbotUserprogresses.create({ lead_id, flow_id, current_step: 'welcome' })).toObject();
    }

    const currentStepId = progress.current_step;

    // 2. Look up the matching chatbot_flowsteps document
    const currentStep = await ChatbotFlowsteps.findOne({ flow_id, step_id: currentStepId }).lean();

    let nextAction = null;
    let fallbackToAI = true;

    // 3. Check if message matches any option (case-insensitive fuzzy match)
    if (currentStep && currentStep.options) {
      const options = typeof currentStep.options === 'string' ? JSON.parse(currentStep.options) : currentStep.options;
      const msgLower = message.toLowerCase().trim();
      
      for (const opt of options) {
        if (msgLower.includes(opt.toLowerCase()) || opt.toLowerCase().includes(msgLower)) {
          // Match found! Advance flow
          fallbackToAI = false;
          // In a full implementation, you'd find the matching option's next_step
          // For now, let's just return a generic success indicator so n8n knows to advance
          nextAction = { type: 'ADVANCE_FLOW', matched_option: opt };
          break;
        }
      }
    }

    // 4. Fallback to AI
    if (fallbackToAI) {
      const queryEmbedding = await getEmbedding(message);
      let aiResponse = "I don't have that detail right now — please try again later or I'll connect you with our team 🙏";
      
      if (queryEmbedding) {
        // Fetch all active KB entries for this flow
        const kbRows = await ChatbotKnowledgebase.find({ flow_id, is_active: true }, { _id: 0, content: 1, embedding: 1 }).lean();
        
        let bestMatch = null;
        let highestScore = -1;
        let contextChunks = [];

        for (const entry of kbRows) {
          const score = cosineSimilarity(queryEmbedding, typeof entry.embedding === 'string' ? JSON.parse(entry.embedding) : entry.embedding);
          if (score > highestScore) {
            highestScore = score;
            bestMatch = entry;
          }
          if (score > 0.70) { // Keep top chunks > 0.70
             contextChunks.push({ score, content: entry.content });
          }
        }
        
        if (highestScore >= 0.75) {
          // Sort context chunks by score
          contextChunks.sort((a,b) => b.score - a.score);
          const retrieved_chunks_joined = contextChunks.slice(0, 3).map(c => c.content).join('\n---\n');
          
          const prompt = `You are the assistant. Answer ONLY using the CONTEXT below. Do not use outside knowledge or make anything up. If the answer isn't in the CONTEXT, reply exactly: "I don't have that detail right now — please try again later or I'll connect you with our team 🙏"\n\nCONTEXT:\n${retrieved_chunks_joined}\n\nUSER QUESTION:\n${message}\n\nReply in 3-4 lines max, warm conversational tone, end with exactly one question.`;
          
          const aiCall = await openRouter.generateContent({ contents: prompt });
          if (aiCall.text) aiResponse = aiCall.text;
        }
      }
      
      // Append original question to guide user back
      const originalQuestion = currentStep ? `\n\n${currentStep.question}` : '';
      
      nextAction = { 
         type: 'AI_FALLBACK', 
         text: aiResponse.trim() + originalQuestion 
      };
      
      // Look up lead's phone number and token
      const lead = await Leads.findOne({ id: lead_id }, { _id: 0, id: 1, phone: 1, client_id: 1 }).lean();
      const leadClient = lead ? await Clients.findOne({ id: lead.client_id }).lean() : null;
      const leadInfo = lead && leadClient
        ? { phone: lead.phone, wa_phone_number_id: leadClient.wa_phone_number_id, wa_access_token: leadClient.wa_access_token }
        : null;
      
      if (leadInfo && leadInfo.wa_phone_number_id && leadInfo.wa_access_token) {
        // Log to messages
        await Messages.create({
          client_id: lead.client_id, lead_id: lead.id, direction: 'outbound', type: 'text',
          content: nextAction.text, status: 'sent', timestamp: new Date(),
        });
        
        // Send via Meta API
        try {
          await axios.post(
            `https://graph.facebook.com/v19.0/${leadInfo.wa_phone_number_id}/messages`,
            {
              messaging_product: 'whatsapp',
              to: leadInfo.phone,
              type: 'text',
              text: { body: nextAction.text }
            },
            {
              headers: {
                'Authorization': `Bearer ${leadInfo.wa_access_token}`,
                'Content-Type': 'application/json'
              }
            }
          );
        } catch(err) {
          console.error("Meta send error:", err.response?.data || err.message);
        }
      }
    }
    
    res.json(nextAction);
    
  } catch (error) {
    console.error('Chatbot logic error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
