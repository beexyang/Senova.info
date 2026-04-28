// lib/security.js
// Shared security helpers used by /api/* endpoints.
// IMPORTANT: do NOT place this file inside /api or Vercel will expose it as a public route.

// Hard allowlist — no wildcard *.vercel.app any more (was an SSRF/CORS hole).
// Add specific Vercel preview hosts only when needed.
const ALLOWED_ORIGINS = new Set([
  'https://senova.info',
  'https://www.senova.info'
]);

function isAllowedOrigin(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.has(origin);
}

function applyCors(req, res, methods) {
  if (!methods) methods = 'GET, POST, OPTIONS';
  const origin = req.headers.origin || '';
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

// CSRF defense: every state-changing custom call from the browser MUST send
// X-Requested-With: senova. Browsers refuse to set custom headers on
// cross-origin requests without a CORS preflight, and our preflight only
// succeeds for ALLOWED_ORIGINS — so a victim's browser at attacker.com
// cannot fire a state-changing call against us.
function requireCsrfHeader(req, res) {
  if (req.method === 'OPTIONS' || req.method === 'GET') return false;
  const x = req.headers['x-requested-with'] || '';
  if (x !== 'senova') {
    res.status(403).json({ error: 'Forbidden' });
    return true;
  }
  return false;
}

async function verifyAdmin(req) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) return null;
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }
    });
    if (!r.ok) return null;
    const u = await r.json();
    if (!u || !u.id || !u.email) return null;
    // Reject service-role / anon JWTs that somehow carry an email field.
    if (u.role && u.role !== 'authenticated') return null;
    if (u.aud && u.aud !== 'authenticated') return null;

    // Allowlist check from admin_users table (replaces hardcoded ADMIN_EMAIL env var).
    const email = String(u.email).toLowerCase();
    const adminRes = await fetch(
      SUPABASE_URL + '/rest/v1/admin_users?email=eq.' + encodeURIComponent(email) + '&select=email',
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY } }
    );
    if (!adminRes.ok) return null;
    const adminRows = await adminRes.json();
    if (!Array.isArray(adminRows) || adminRows.length === 0) return null;
    return u;
  } catch (_) { return null; }
}

async function verifyAuthenticated(req) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }
    });
    if (!r.ok) return null;
    const u = await r.json();
    if (!u || !u.id) return null;
    if (u.role && u.role !== 'authenticated') return null;
    if (u.aud && u.aud !== 'authenticated') return null;
    return u;
  } catch (_) { return null; }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }
const STATE_RE = /^[A-Za-z]{2}$/;
function isUsState(v) { return typeof v === 'string' && STATE_RE.test(v); }
const ZIP_RE = /^[0-9]{5}$/;
function isZip(v) { return typeof v === 'string' && ZIP_RE.test(v); }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isEmail(v) { return typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v); }
const CCN_RE = /^[A-Za-z0-9]{1,20}$/;
function isCcn(v) { return typeof v === 'string' && CCN_RE.test(v); }
const PROVIDER_TYPE_WHITELIST = new Set(['home_health', 'hospice', 'drug_rehab', 'mental_health', 'all']);
function isProviderType(v) { return typeof v === 'string' && PROVIDER_TYPE_WHITELIST.has(v); }

function bounded(v, maxLen) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length === 0 || s.length > maxLen) return null;
  return s;
}

function escapeHtml(v) {
  if (v == null) return '';
  return String(v).replace(/[&<>"'\u2028\u2029]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    '\u2028': '\\u2028', '\u2029': '\\u2029'
  }[c]));
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let m = 0;
  for (let i = 0; i < a.length; i++) m |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return m === 0;
}

// Password strength: length >= 12 and not in the dumb-password blocklist.
const COMMON_BAD = new Set([
  'password','password1','password123','passw0rd','letmein','qwerty12345',
  'iloveyou1','admin12345','welcome1234','monkey12345','football12','baseball12',
  'sunshine123','princess123','dragon12345','test12345678','12345678','123456789',
  '1234567890','abc12345','qwertyuiop','111111111111','000000000000','passwordpassword'
]);
function isStrongPassword(p) {
  if (typeof p !== 'string') return false;
  if (p.length < 12 || p.length > 200) return false;
  if (COMMON_BAD.has(p.toLowerCase())) return false;
  return true;
}

module.exports = {
  applyCors, isAllowedOrigin, requireCsrfHeader,
  verifyAdmin, verifyAuthenticated,
  isUuid, isUsState, isZip, isEmail, isCcn, isProviderType,
  bounded, escapeHtml, safeEqual, isStrongPassword
};
