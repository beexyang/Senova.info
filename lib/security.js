// lib/security.js
// Shared security helpers used by /api/* endpoints.
// IMPORTANT: do NOT place this file inside /api or Vercel will expose it as a public route.

const ALLOWED_ORIGINS = [
  'https://senova.info',
  'https://www.senova.info'
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.hostname.endsWith('.vercel.app')) return true;
  } catch (_) { /* ignore */ }
  return false;
}

function applyCors(req, res, methods) {
  if (!methods) methods = 'GET, POST, OPTIONS';
  const origin = req.headers.origin || '';
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

async function verifyAdmin(req) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !ADMIN_EMAIL) return null;
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
    if (!u || !u.email) return null;
    if (String(u.email).toLowerCase() !== ADMIN_EMAIL) return null;
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
    return u && u.id ? u : null;
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
const PROVIDER_TYPE_WHITELIST = new Set(['home_health', 'hospice', 'all']);
function isProviderType(v) { return typeof v === 'string' && PROVIDER_TYPE_WHITELIST.has(v); }

function bounded(v, maxLen) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length === 0 || s.length > maxLen) return null;
  return s;
}

function escapeHtml(v) {
  if (v == null) return '';
  return String(v).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let m = 0;
  for (let i = 0; i < a.length; i++) m |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return m === 0;
}

module.exports = {
  applyCors, isAllowedOrigin,
  verifyAdmin, verifyAuthenticated,
  isUuid, isUsState, isZip, isEmail, isCcn, isProviderType,
  bounded, escapeHtml, safeEqual
};
