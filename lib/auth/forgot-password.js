// POST /api/auth/forgot-password — works whether or not Resend is fully set up.
//
// Strategy:
//   1. Mint an OTP via /auth/v1/admin/generate_link (returns email_otp +
//      hashed_token; does NOT send email).
//   2. Try to send via Resend with our branded link. If Resend rejects (e.g.
//      unverified senova.info domain → 403 / 422), record the reason and...
//   3. ...fall back to Supabase's built-in mailer by calling /auth/v1/recover
//      with redirect_to=https://senova.info/reset-password. Supabase only
//      honors redirect_to URLs that are in the project's Redirect URLs
//      allowlist; if it isn't, Supabase falls back to the project Site URL.
//      Either way, an email gets sent.
//
// reset_password.html handles BOTH URL formats:
//   - Our format:      /reset-password?e=<email>&otp=<otp>
//   - Supabase format: /reset-password#access_token=...&type=recovery
//
// This means password reset works regardless of:
//   - whether RESEND_API_KEY is set
//   - whether the senova.info domain is verified on Resend
//   - whether Supabase's Site URL is correct (the legacy hash flow still works)

function _resendFrom() { return process.env.RESEND_FROM || 'Senova <onboarding@resend.dev>'; }

const { applyCors, requireCsrfHeader, isEmail, bounded } = require('../security');
const { rateLimit } = require('../ratelimit');
const log = require('../log');

module.exports = async (req, res) => {
  if (applyCors(req, res, 'POST, OPTIONS')) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (requireCsrfHeader(req, res)) return;
  if (await rateLimit(req, 'forgot-password', 5, 600_000)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again.' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const BASE_URL = process.env.BASE_URL || 'https://senova.info';
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const body = req.body || {};
  const email = bounded(body.email, 254);
  if (!email || !isEmail(email)) return res.status(200).json({ ok: true });
  const lowerEmail = email.toLowerCase();

  // Step 1: mint OTP via admin/generate_link (does not send email).
  let otp = null;
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/admin/generate_link', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ type: 'recovery', email: lowerEmail })
    });
    if (r.ok) {
      const data = await r.json();
      otp = data.email_otp || (data.properties && data.properties.email_otp) || null;
    }
  } catch (e) { log.warn('forgot-password: generate_link failed', e.message); }

  // Step 2: try Resend with our branded link.
  let resendOk = false;
  if (RESEND_API_KEY && otp) {
    const url = BASE_URL + '/reset-password?e=' + encodeURIComponent(lowerEmail) + '&otp=' + encodeURIComponent(otp);
    const html =
      '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">' +
        '<div style="background:#0D9488;padding:28px;text-align:center;border-radius:12px 12px 0 0">' +
          '<h1 style="color:#fff;margin:0;font-size:22px">Reset your Senova password</h1>' +
        '</div>' +
        '<div style="padding:28px;background:#fff;border:1px solid #E5E7EB;border-top:none;border-radius:0 0 12px 12px">' +
          '<p>We received a request to reset the password on your Senova account.</p>' +
          '<p style="text-align:center;margin:28px 0">' +
            '<a href="' + url + '" style="background:#0D9488;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600">Reset my password</a>' +
          '</p>' +
          '<p style="color:#6B7280;font-size:13px">' +
            'Or copy this link into your browser:<br>' +
            '<a href="' + url + '" style="color:#0D9488;word-break:break-all">' + url + '</a>' +
          '</p>' +
          '<p style="color:#6B7280;font-size:13px;margin-top:28px">' +
            'This link expires in 1 hour. If you did not request a reset, you can safely ignore this email.' +
          '</p>' +
        '</div>' +
      '</div>';
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + RESEND_API_KEY },
        body: JSON.stringify({
          from: _resendFrom(),
          to: [email],
          subject: 'Reset your Senova password',
          html: html
        })
      });
      resendOk = r.ok;
      if (!r.ok) {
        const errText = (await r.text()).slice(0, 300);
        log.info('forgot-password: Resend send failed; falling back to Supabase mailer', { status: r.status, errText });
      }
    } catch (e) { log.warn('forgot-password: Resend exception; falling back', e.message); }
  }

  // Step 3: if Resend didn't succeed, fall back to Supabase's built-in mailer.
  if (!resendOk) {
    try {
      const redirect = BASE_URL + '/reset-password';
      const r = await fetch(SUPABASE_URL + '/auth/v1/recover?redirect_to=' + encodeURIComponent(redirect), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
        body: JSON.stringify({ email: lowerEmail })
      });
      if (!r.ok) {
        log.info('forgot-password: Supabase fallback non-ok', r.status);
      }
    } catch (e) { log.warn('forgot-password: Supabase fallback exception', e.message); }
  }

  // Always 200 — never leak which recipients are valid or which channel succeeded.
  return res.status(200).json({ ok: true });
};
