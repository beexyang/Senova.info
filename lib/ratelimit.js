// lib/ratelimit.js
// DB-backed rate limiter that survives Vercel cold starts and is shared
// across all serverless instances. Uses public.rate_limit_buckets +
// public.rl_check_and_increment() in Supabase.
const log = require('./log');

function clientKey(req, name) {
  const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = fwd || req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown';
  return name + ':' + ip;
}

// Returns true if the request should be REJECTED (over the limit).
async function rateLimit(req, name, maxRequests, windowMs) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return false; // fail-open if unconfigured
  const key = clientKey(req, name);
  const windowSec = Math.max(1, Math.round(windowMs / 1000));
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/rl_check_and_increment', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_key: key, p_window_seconds: windowSec, p_max: maxRequests })
    });
    if (!r.ok) return false;
    const rows = await r.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    return !(row && row.allowed); // reject when not allowed
  } catch (e) {
    log.warn('rateLimit failed-open:', e.message);
    return false;
  }
}

module.exports = { rateLimit };
