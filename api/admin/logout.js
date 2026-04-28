// POST /api/admin/logout — destroy server-side session and clear the cookie.
const { applyCors, requireCsrfHeader } = require('../../lib/security');
const { parseCookies, clearSessionCookie, destroyAdminSession, SESSION_COOKIE } = require('../../lib/session');

module.exports = async (req, res) => {
  if (applyCors(req, res, 'POST, OPTIONS')) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (requireCsrfHeader(req, res)) return;

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (sid && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    await destroyAdminSession(SUPABASE_URL, SUPABASE_SERVICE_KEY, sid);
  }
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
};
