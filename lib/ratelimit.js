// lib/ratelimit.js
// Simple in-memory rate limiter for Vercel serverless functions.
//
// Each warm invocation of a function shares one Map; cold starts reset state.
// This is good enough to stop a single attacker from flooding signups —
// it's NOT a substitute for a proper rate-limiter like Upstash if you want
// guarantees across regions/instances.
//
// Usage:
//   const { rateLimit } = require('../lib/ratelimit');
//   if (rateLimit(req, 'save-lead', 5, 60_000)) {
//     return res.status(429).json({ error: 'Too many requests' });
//   }

const buckets = new Map();

function clientKey(req, name) {
  const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = fwd || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
  return name + ':' + ip;
}

function rateLimit(req, name, maxRequests, windowMs) {
  const key = clientKey(req, name);
  const now = Date.now();
  let entry = buckets.get(key);
  if (!entry || now - entry.start > windowMs) {
    entry = { start: now, count: 0 };
    buckets.set(key, entry);
  }
  entry.count += 1;
  // Light-weight cleanup so the map doesn't grow unbounded.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets.entries()) {
      if (now - v.start > windowMs) buckets.delete(k);
    }
  }
  return entry.count > maxRequests;
}

module.exports = { rateLimit };
