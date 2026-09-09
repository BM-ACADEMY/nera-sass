const openRouter = require('../services/openrouter');

async function test() {
  if (!openRouter.isConfigured) throw new Error('OPENROUTER_API_KEY is not configured.');

  const completion = await openRouter.generateContent({
    contents: 'Reply with exactly: OK',
    config: { temperature: 0, maxOutputTokens: 8 },
  });
  const embedding = await openRouter.createEmbedding('LeadOS embedding health check', 768);

  console.log(JSON.stringify({
    model: openRouter.DEFAULT_MODEL,
    chatWorked: completion.text.trim().toUpperCase().includes('OK'),
    embeddingWorked: Array.isArray(embedding),
    embeddingDimensions: embedding.length,
  }, null, 2));
}

test().catch((error) => {
  console.error('OpenRouter health check failed:', error.status || '', error.message);
  process.exitCode = 1;
});
