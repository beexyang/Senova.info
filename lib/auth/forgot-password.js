// POST /api/auth/forgot-password — bypasses Supabase's built-in mailer (whose
// link points at the project's Site URL — which can only be changed in
// the Supabase dashboard) by:
//   1. Calling supabase auth admin generate_link with type=recovery to
//      mint a 6-digit email_otp + hashed_token bound to that email.
//   2. Emailing the user via Resend with our own template + a senova.info
//      URL that carries email + otp as query params.
//   3. The /reset-password page collects a new password and submits to
//      /api/auth/reset-password which exchanges the OTP for an access_token and
//      updates the password.
//
// This means the Site URL setting in Supabase can stay anything — our
// recovery flow never relies on it.
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
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const BASE_URL = process.env.BASE_URL || 'https://senova.info';
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const body = req.body || {};
  const email = bounded(body.email, 254);
  if (!email || !isEmail(email)) {
    // Always answer 200 so we don't leak which emails exist.
    return res.status(200).json({ ok: true });
  }

  try {
    // Mint a recovery link (we only use the OTP and ignore the action_link).
    const r = await fetch(SUPABASE_URL + '/auth/v1/admin/generate_link', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ type: 'recovery', email: email.toLowerCase() })
    });

    // If the user doesn't exist Supabase 422s. We still 200 to the caller.
    if (!r.ok) {
      log.info('forgot-password: generate_link non-ok', r.status);
      return res.status(200).json({ ok: true });
    }
    const data = await r.json();
    const otp = data.email_otp || data.properties?.email_otp;
    if (!otp) {
      log.warn('forgot-password: no email_otp in response');
      return res.status(200).json({ ok: true });
    }

    if (RESEND_API_KEY) {
      const url = BASE_URL + '/reset-password?e=' + encodeURIComponent(email.toLowerCase()) + '&otp=' + encodeURIComponent(otp);
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
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + RESEND_API_KEY },
          body: JSON.stringify({
            from: 'Senova <hello@senova.info>',
            to: [email],
            subject: 'Reset your Senova password',
            html: html
          })
        });
      } catch (e) { log.warn('forgot-password: resend send failed', e.message); }
    } else {
      log.warn('forgot-password: RESEND_API_KEY missing — email not sent');
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    log.error('forgot-password error', e.message);
    return res.status(200).json({ ok: true }); // never leak
  }
};
