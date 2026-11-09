/**
 * Token usage and cost of one AI reply, so cost per reply can be measured
 * (plan N2). Prices come from the environment, per million tokens, in USD:
 *
 *   AI_PRICE_INPUT_USD_PER_MTOK    default 0.15  (gpt-4o-mini input)
 *   AI_PRICE_OUTPUT_USD_PER_MTOK   default 0.60  (gpt-4o-mini output)
 *
 * Set them to the prices of the model in AI_BRAIN_MODEL. The result is an
 * estimate from the provider's own token counts; a reply whose provider sent
 * no usage is logged with null tokens and a null cost, never a made-up zero.
 */
const price = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const count = (value) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Math.max(0, Math.round(Number(value))) : null);

/** Accepts the OpenAI shape and the Gemini shape. */
function normaliseUsage(usage) {
  if (!usage || typeof usage !== 'object') return { prompt_tokens: null, completion_tokens: null };
  return {
    prompt_tokens: count(usage.prompt_tokens ?? usage.promptTokenCount ?? usage.input_tokens),
    completion_tokens: count(usage.completion_tokens ?? usage.candidatesTokenCount ?? usage.output_tokens),
  };
}

/** { prompt_tokens, completion_tokens, total_tokens, cost_usd, cost_basis } */
function costOf(usage) {
  const { prompt_tokens: input, completion_tokens: output } = normaliseUsage(usage);
  if (input === null && output === null) {
    return { prompt_tokens: null, completion_tokens: null, total_tokens: null, cost_usd: null, cost_basis: 'unknown' };
  }
  const inTokens = input ?? 0;
  const outTokens = output ?? 0;
  const usd = (inTokens * price('AI_PRICE_INPUT_USD_PER_MTOK', 0.15) + outTokens * price('AI_PRICE_OUTPUT_USD_PER_MTOK', 0.6)) / 1e6;
  return {
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: inTokens + outTokens,
    cost_usd: Number(usd.toFixed(8)),
    cost_basis: 'estimated',
  };
}

module.exports = { normaliseUsage, costOf };
