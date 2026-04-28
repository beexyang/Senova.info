// lib/session.js — httpOnly cookie session for the admin panel.
// The browser never sees the Supabase access_token; it only carries an
// opaque session id. The server looks the id up in public.admin_sessions
// and uses the stored access_token to verify against Supabase auth.
const crypto = require('crypto');
const SESSION_COOKIE = 'senova_admin_session';
const SESSION_TTL_HOURS = 12;

function genId() { return crypto.randomBytes(32).toString('base64url'); }

function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function setSessionCookie(res, sessionId) {
  const expires = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; ` +
    `HttpOnly; Secure; SameSite=Strict; Path=/; Expires=${expires.toUTCString()}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
}

async function readAdminSession(req) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  const cookies = parseCookies(req);
  const sid = cookies[SESSION_COOKIE];
  if (!sid) return null;

  const r = await fetch(
    SUPABASE_URL + '/rest/v1/admin_sessions?session_id=eq.' + encodeURIComponent(sid)
      + '&select=admin_email,supabase_access_token,expires_at',
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY } }
  );
  if (!r.ok) return null;
  const rows = await r.json();
  const row = Array.isArray(rows) && rows[0];
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;

  // Verify the stored Supabase token still works (admin could have signed out / rotated).
  const ur = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + row.supabase_access_token }
  });
  if (!ur.ok) return null;
  const u = await ur.json();
  if (!u || String(u.email).toLowerCase() !== row.admin_email) return null;

  // Still in admin_users allowlist?
  const adminCheck = await fetch(
    SUPABASE_URL + '/rest/v1/admin_users?email=eq.' + encodeURIComponent(row.admin_email) + '&select=email',
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY } }
  );
  const allow = adminCheck.ok ? await adminCheck.json() : [];
  if (!Array.isArray(allow) || allow.length === 0) return null;

  return { email: row.admin_email, supabase_access_token: row.supabase_access_token };
}

async function createAdminSession(supabaseUrl, serviceKey, email, accessToken, ip, ua) {
  const sid = genId();
  const expires = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
  await fetch(supabaseUrl + '/rest/v1/admin_sessions', {
    method: 'POST',
    headers: {
      apikey: serviceKey, Authorization: 'Bearer ' + serviceKey,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      session_id: sid, admin_email: email, supabase_access_token: accessToken,
      ip, user_agent: ua, expires_at: expires.toISOString()
    })
  });
  return sid;
}

async function destroyAdminSession(supabaseUrl, serviceKey, sessionId) {
  await fetch(
    supabaseUrl + '/rest/v1/admin_sessions?session_id=eq.' + encodeURIComponent(sessionId),
    { method: 'DELETE', headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey } }
  );
}

module.exports = {
  SESSION_COOKIE, SESSION_TTL_HOURS,
  genId, parseCookies, setSessionCookie, clearSessionCookie,
  readAdminSession, createAdminSession, destroyAdminSession
};
