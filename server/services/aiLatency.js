/**
 * Timing of one AI reply, logged so a slow step can be found:
 *   customer message → hand-off to n8n → n8n reads /internal/context → reply sent.
 * In memory only; entries older than ten minutes are dropped.
 */
const MAX_AGE_MS = 10 * 60 * 1000;
const runs = new Map(); // lead_id -> { received, triggered, context }

const seconds = (from, to) => ((to - from) / 1000).toFixed(1);

function prune(now) {
  for (const [leadId, run] of runs) {
    if (now - run.received > MAX_AGE_MS) runs.delete(leadId);
  }
}

function received(leadId) {
  const now = Date.now();
  prune(now);
  runs.set(Number(leadId), { received: now });
}

function triggered(leadId) {
  const run = runs.get(Number(leadId));
  if (run) run.triggered = Date.now();
}

function contextFetched(leadId) {
  const run = runs.get(Number(leadId));
  if (run && run.triggered && !run.context) run.context = Date.now();
}

function replied(leadId) {
  const id = Number(leadId);
  const run = runs.get(id);
  if (!run) return;
  runs.delete(id);
  const now = Date.now();
  const parts = [`total ${seconds(run.received, now)}s`];
  if (run.triggered) {
    parts.push(`wait ${seconds(run.received, run.triggered)}s`);
    if (run.context) {
      parts.push(`n8n start ${seconds(run.triggered, run.context)}s`, `AI + send ${seconds(run.context, now)}s`);
    } else {
      parts.push(`n8n ${seconds(run.triggered, now)}s`);
    }
  }
  console.log(`[AI timing] lead ${id}: ${parts.join(', ')}`);
}

module.exports = { received, triggered, contextFetched, replied };
