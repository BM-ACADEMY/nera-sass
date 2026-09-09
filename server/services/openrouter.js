const OpenAI = require('openai');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash-lite';
const AUDIO_MODEL = process.env.OPENROUTER_AUDIO_MODEL || DEFAULT_MODEL;
const EMBEDDING_MODEL = process.env.OPENROUTER_EMBEDDING_MODEL || 'openai/text-embedding-3-small';

const client = process.env.OPENROUTER_API_KEY
  ? new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY,
      defaultHeaders: {
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://leados-app.abmgroups.org',
        'X-OpenRouter-Title': process.env.OPENROUTER_APP_NAME || 'LeadOS',
      },
    })
  : null;

const getAudioFormat = (mimeType = '') => {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
  if (normalized.includes('mp4') || normalized.includes('m4a')) return 'm4a';
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('aac')) return 'aac';
  if (normalized.includes('flac')) return 'flac';
  return 'ogg';
};

const convertContents = (contents) => {
  if (typeof contents === 'string') return contents;
  if (!Array.isArray(contents)) return String(contents || '');

  return contents.map((part) => {
    if (part?.text !== undefined) return { type: 'text', text: String(part.text) };
    if (part?.inlineData?.data) {
      const mime = part.inlineData.mimeType || '';
      if (mime.startsWith('image/')) {
        return {
          type: 'image_url',
          image_url: {
            url: `data:${mime};base64,${part.inlineData.data}`
          }
        };
      } else {
        return {
          type: 'input_audio',
          input_audio: {
            data: part.inlineData.data,
            format: getAudioFormat(mime),
          },
        };
      }
    }
    return { type: 'text', text: String(part || '') };
  });
};

async function generateContent({ model = DEFAULT_MODEL, contents, config = {} }) {
  if (!client) throw new Error('OPENROUTER_API_KEY is not configured on the API server.');

  const completion = await client.chat.completions.create({
    model: model.includes('/') ? model : DEFAULT_MODEL,
    messages: [{ role: 'user', content: convertContents(contents) }],
    ...(config.temperature !== undefined && { temperature: config.temperature }),
    ...(config.maxOutputTokens && { max_tokens: config.maxOutputTokens }),
    ...(config.responseMimeType === 'application/json' && { response_format: { type: 'json_object' } }),
  });

  return { text: completion.choices?.[0]?.message?.content || '' };
}

async function createEmbedding(input, dimensions = 768) {
  if (!client) throw new Error('OPENROUTER_API_KEY is not configured on the API server.');
  const response = await client.embeddings.create({ model: EMBEDDING_MODEL, input, dimensions });
  return response.data[0].embedding;
}

module.exports = {
  client,
  isConfigured: Boolean(client),
  models: { generateContent },
  generateContent,
  createEmbedding,
  DEFAULT_MODEL,
  AUDIO_MODEL,
  EMBEDDING_MODEL,
};
