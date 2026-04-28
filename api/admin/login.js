// POST /api/admin/login — verify Supabase password + admin allowlist,
// then issue an httpOnly cookie session. Browser never sees the JWT.
// Brute-force-protected by login_attempts row + 5/15min lockout.
const { applyCors, requireCsrfHeader, isEmail, bounded, safeEqual } = require('../../lib/security');
const { createAdminSession, setSessionCookie, parseCookies } = require('../../lib/session');
const log = require('../../lib/log');

const LOCKOUT_MAX = 5;          // failures
const LOCKOUT_WINDOW_MIN = 15;  // minutes

function clientIp(req) {
  const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown';
}

async function recentFailedCount(SUPABASE_URL, KEY, ip, email) {
  const since = new Date(Date.now() - LOCKOUT_WINDOW_MIN * 60 * 1000).toISOString();
  const url = SUPABASE_URL + '/rest/v1/login_attempts?succeeded=eq.false'
    + '&ip=eq.' + encodeURIComponent(ip)
    + '&created_at=gte.' + encodeURIComponent(since)
    + '&select=id';
  const r = await fetch(url, {
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' }
  });
  if (!r.ok) return 0;
  const cr = r.headers.get('content-range') || '';
  return parseInt(cr.split('/')[1], 10) || 0;
}

async function recordAttempt(SUPABASE_URL, KEY, ip, email, ok) {
  await fetch(SUPABASE_URL + '/rest/v1/login_attempts', {
    method: 'POST',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ ip, email, succeeded: ok })
  }).catch(() => {});
}

module.exports = async (req, res) => {
  if (applyCors(req, res, 'POST, OPTIONS')) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (requireCsrfHeader(req, res)) return;

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const ip = clientIp(req);
  const ua = (req.headers['user-agent'] || '').slice(0, 500);
  const body = req.body || {};
  const email = bounded(body.email, 254);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !isEmail(email) || !password) {
    return res.status(400).json({ error: 'Invalid credentials' });
  }

  // Lockout check
  const failed = await recentFailedCount(SUPABASE_URL, SUPABASE_SERVICE_KEY, ip, email);
  if (failed >= LOCKOUT_MAX) {
    log.warn('admin login locked out', { ip });
    return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
  }

  // Verify Supabase password
  let auth;
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ email: email.toLowerCase(), password })
    });
    if (!r.ok) {
      await recordAttempt(SUPABASE_URL, SUPABASE_SERVICE_KEY, ip, email, false);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    auth = await r.json();
  } catch (e) {
    log.error('admin login fetch err', e.message);
    return res.status(500).json({ error: 'Server error' });
  }

  // Verify admin allowlist
  const adminRes = await fetch(
    SUPABASE_URL + '/rest/v1/admin_users?email=eq.' + encodeURIComponent(email.toLowerCase()) + '&select=email',
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY } }
  );
  const allow = adminRes.ok ? await adminRes.json() : [];
  if (!Array.isArray(allow) || allow.length === 0) {
    await recordAttempt(SUPABASE_URL, SUPABASE_SERVICE_KEY, ip, email, false);
    return res.status(403).json({ error: 'Not authorized' });
  }

  await recordAttempt(SUPABASE_URL, SUPABASE_SERVICE_KEY, ip, email, true);

  const sid = await createAdminSession(
    SUPABASE_URL, SUPABASE_SERVICE_KEY, email.toLowerCase(), auth.access_token, ip, ua
  );
  setSessionCookie(res, sid);
  return res.status(200).json({ ok: true, email: email.toLowerCase() });
};
