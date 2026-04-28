// POST /api/auth/reset-password — completes the OTP-based recovery flow.
// Body: { email, otp, password }
// 1. Calls /auth/v1/verify with type=recovery to exchange OTP for access_token.
// 2. Uses that access_token to PUT the new password.
const { applyCors, requireCsrfHeader, isEmail, bounded, isStrongPassword } = require('../security');
const { rateLimit } = require('../ratelimit');
const log = require('../log');

module.exports = async (req, res) => {
  if (applyCors(req, res, 'POST, OPTIONS')) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (requireCsrfHeader(req, res)) return;
  if (await rateLimit(req, 'reset-password', 8, 600_000)) {
    return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes.' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return res.status(500).json({ error: 'Server misconfigured' });

  const body = req.body || {};
  const email = bounded(body.email, 254);
  const otp = bounded(body.otp, 32);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !isEmail(email)) return res.status(400).json({ error: 'Valid email required.' });
  if (!otp) return res.status(400).json({ error: 'Verification code missing or expired. Request a new reset email.' });
  if (!isStrongPassword(password)) {
    return res.status(400).json({ error: 'Password must be at least 12 characters and not a common password.' });
  }

  try {
    // Step 1: verify OTP -> access_token
    const v = await fetch(SUPABASE_URL + '/auth/v1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ type: 'recovery', email: email.toLowerCase(), token: otp })
    });
    if (!v.ok) {
      log.info('reset-password: verify non-ok', v.status);
      return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one from the sign-in page.' });
    }
    const session = await v.json();
    const access = session.access_token;
    if (!access) return res.status(500).json({ error: 'Recovery session missing token.' });

    // Step 2: update password using the recovery session
    const u = await fetch(SUPABASE_URL + '/auth/v1/user', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + access
      },
      body: JSON.stringify({ password: password })
    });
    if (!u.ok) {
      let msg = 'Could not update password.';
      try { const j = await u.json(); msg = j.msg || j.error_description || msg; } catch (_) {}
      return res.status(400).json({ error: msg });
    }

    // Step 3: invalidate the recovery session so the OTP can't be reused
    try {
      await fetch(SUPABASE_URL + '/auth/v1/logout', {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + access }
      });
    } catch (_) {}

    return res.status(200).json({ ok: true });
  } catch (e) {
    log.error('reset-password error', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
