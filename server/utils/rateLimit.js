/**
 * Small in-memory rate limiter for authentication endpoints (plan S9).
 * Per-process only; a multi-instance deployment needs a shared store.
 */
function rateLimit({ windowMs, max, key = (req) => req.ip, message = 'Too many attempts, try again later' }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, entry] of hits) if (entry.reset <= now) hits.delete(k);
  }, windowMs);
  timer.unref?.();

  const middleware = (req, res, next) => {
    if (process.env.AUTH_RATE_LIMIT === 'off') return next();
    const k = key(req);
    const now = Date.now();
    const entry = hits.get(k);
    if (!entry || entry.reset <= now) {
      hits.set(k, { count: 1, reset: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    return next();
  };
  middleware.reset = () => hits.clear();
  return middleware;
}

module.exports = { rateLimit };
