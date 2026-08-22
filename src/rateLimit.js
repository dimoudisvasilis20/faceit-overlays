// Minimal in-memory rate limiter. Protects the shared FACEIT API key from
// being hammered by any single client — this app has no per-user auth, so
// everyone's overlay requests draw from the same server-side quota.
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30; // generous for a couple of overlays polling every 20-30s

const hits = new Map();

export function rateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const entry = hits.get(ip);

  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }

  entry.count += 1;
  if (entry.count > MAX_REQUESTS) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfterSec));
    return res.status(429).json({ error: 'Too many requests, slow down.' });
  }

  next();
}

// Periodically drop stale entries so the map doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of hits) {
    if (now > entry.resetAt) hits.delete(ip);
  }
}, WINDOW_MS).unref();
