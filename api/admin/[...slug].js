// Catch-all dispatcher for /api/admin/* — runs as a single Vercel function
// to stay under the hobby plan's 12-function limit.
//
// Routes handled:
//   POST   /api/admin/login           — set httpOnly cookie session
//   POST   /api/admin/logout
//   GET    /api/admin/me
//   GET    /api/admin/dashboard
//   GET    /api/admin/leads
//   GET    /api/admin/lead?id=...
//   PATCH  /api/admin/lead?id=...
//   POST   /api/admin/lead-activity
//   GET    /api/admin/vendor?id=...
//   POST   /api/admin/image-action
//   POST   /api/admin/mark-notifs

const crypto = require('crypto');
const {
  applyCors, requireCsrfHeader, isEmail, isUuid, bounded, safeEqual
} = require('../../lib/security');
const log = require('../../lib/log');

const SESSION_COOKIE = 'senova_admin_session';
const SESSION_TTL_HOURS = 12;
const LOCKOUT_MAX = 5;
const LOCKOUT_WINDOW_MIN = 15;

function clientIp(req) {
  const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown';
}
function genId() { return crypto.randomBytes(32).toString('base64url'); }
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setSessionCookie(res, sid) {
  const expires = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(sid)}; HttpOnly; Secure; SameSite=Strict; Path=/; Expires=${expires.toUTCString()}`);
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
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (!sid) return null;
  const r = await fetch(SUPABASE_URL + '/rest/v1/admin_sessions?session_id=eq.' + encodeURIComponent(sid)
    + '&select=admin_email,supabase_access_token,expires_at',
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY } });
  if (!r.ok) return null;
  const rows = await r.json();
  const row = Array.isArray(rows) && rows[0];
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  // Verify token still valid
  const ur = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + row.supabase_access_token }
  });
  if (!ur.ok) return null;
  const u = await ur.json();
  if (!u || String(u.email).toLowerCase() !== row.admin_email) return null;
  // Allowlist
  const ar = await fetch(SUPABASE_URL + '/rest/v1/admin_users?email=eq.' + encodeURIComponent(row.admin_email) + '&select=email',
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY } });
  const allow = ar.ok ? await ar.json() : [];
  if (!Array.isArray(allow) || !allow.length) return null;
  return { email: row.admin_email, supabase_access_token: row.supabase_access_token };
}

// =========================================================================
// Route handlers
// =========================================================================

async function handleLogin(req, res) {
  if (requireCsrfHeader(req, res)) return;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const ANON = process.env.SUPABASE_ANON_KEY;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !ANON || !KEY) return res.status(500).json({ error: 'Server misconfigured' });

  const ip = clientIp(req);
  const ua = (req.headers['user-agent'] || '').slice(0, 500);
  const body = req.body || {};
  const email = bounded(body.email, 254);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !isEmail(email) || !password) return res.status(400).json({ error: 'Invalid credentials' });

  // Lockout check
  const since = new Date(Date.now() - LOCKOUT_WINDOW_MIN * 60_000).toISOString();
  const lr = await fetch(SUPABASE_URL + '/rest/v1/login_attempts?succeeded=eq.false'
    + '&ip=eq.' + encodeURIComponent(ip)
    + '&created_at=gte.' + encodeURIComponent(since)
    + '&select=id', {
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY,
                 'Range-Unit': 'items', Range: '0-0', Prefer: 'count=exact' }
    });
  const failed = lr.ok ? parseInt((lr.headers.get('content-range') || '').split('/')[1], 10) || 0 : 0;
  if (failed >= LOCKOUT_MAX) return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });

  // Verify password
  let auth;
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON },
      body: JSON.stringify({ email: email.toLowerCase(), password })
    });
    if (!r.ok) {
      await fetch(SUPABASE_URL + '/rest/v1/login_attempts', {
        method: 'POST',
        headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ ip, email, succeeded: false })
      }).catch(() => {});
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    auth = await r.json();
  } catch (e) { log.error('login fetch err', e.message); return res.status(500).json({ error: 'Server error' }); }

  // Allowlist
  const ar = await fetch(SUPABASE_URL + '/rest/v1/admin_users?email=eq.' + encodeURIComponent(email.toLowerCase()) + '&select=email',
    { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
  const allow = ar.ok ? await ar.json() : [];
  if (!Array.isArray(allow) || !allow.length) {
    await fetch(SUPABASE_URL + '/rest/v1/login_attempts', {
      method: 'POST',
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ ip, email, succeeded: false })
    }).catch(() => {});
    return res.status(403).json({ error: 'Not authorized' });
  }
  await fetch(SUPABASE_URL + '/rest/v1/login_attempts', {
    method: 'POST',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ ip, email, succeeded: true })
  }).catch(() => {});

  const sid = genId();
  const expires = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
  await fetch(SUPABASE_URL + '/rest/v1/admin_sessions', {
    method: 'POST',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      session_id: sid, admin_email: email.toLowerCase(),
      supabase_access_token: auth.access_token, ip, user_agent: ua,
      expires_at: expires.toISOString()
    })
  });
  setSessionCookie(res, sid);
  return res.status(200).json({ ok: true, email: email.toLowerCase() });
}

async function handleLogout(req, res) {
  if (requireCsrfHeader(req, res)) return;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (sid && SUPABASE_URL && KEY) {
    await fetch(SUPABASE_URL + '/rest/v1/admin_sessions?session_id=eq.' + encodeURIComponent(sid),
      { method: 'DELETE', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } }).catch(() => {});
  }
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
}

async function handleMe(req, res) {
  const sess = await readAdminSession(req);
  if (!sess) return res.status(401).json({ error: 'Unauthorized' });
  return res.status(200).json({ email: sess.email });
}

async function handleDashboard(req, res) {
  const sess = await readAdminSession(req);
  if (!sess) return res.status(401).json({ error: 'Unauthorized' });
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
  const q = (p) => fetch(SUPABASE_URL + '/rest/v1/' + p, { headers: H }).then(r => r.ok ? r.json() : []).catch(() => []);
  const [vendors, users, leads, images, notifs, memberships] = await Promise.all([
    q('vendors?select=*,vendor_auth(auth_user_id)&order=created_at.desc'),
    q('users?select=*,user_auth(auth_user_id)&order=created_at.desc'),
    q('leads?select=*,vendors(business_name)&order=received_at.desc'),
    q('vendor_images?status=eq.pending&select=*,vendors(business_name)&order=uploaded_at.desc'),
    q('admin_notifications?select=*&order=created_at.desc&limit=50'),
    q('vendor_memberships?plan_status=eq.active&select=*'),
  ]);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json({ vendors, users, leads, images, notifs, memberships });
}

async function handleLeadsList(req, res) {
  const sess = await readAdminSession(req);
  if (!sess) return res.status(401).json({ error: 'Unauthorized' });
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const r = await fetch(SUPABASE_URL +
    '/rest/v1/leads?select=id,lead_number,first_name,last_name,phone,email,city,state,zip_code,service_zip,care_for,care_type,status,received_at,sent_to_vendor_at,vendor_id,auto_assigned,vendors(business_name)&order=received_at.desc',
    { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
  if (!r.ok) return res.status(502).json({ error: 'Upstream error' });
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json({ leads: await r.json() });
}

async function handleLead(req, res) {
  const sess = await readAdminSession(req);
  if (!sess) return res.status(401).json({ error: 'Unauthorized' });
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const id = req.query.id;
  if (!isUuid(id)) return res.status(400).json({ error: 'id must be a UUID' });
  const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };

  if (req.method === 'GET') {
    const [leadR, actR] = await Promise.all([
      fetch(SUPABASE_URL + '/rest/v1/leads?id=eq.' + encodeURIComponent(id) +
        '&select=*,users(id,email,first_name,last_name,phone,city,state,zip_code,service_zip,care_for,care_types,created_at),vendors(id,business_name,email,phone,city,state)',
        { headers: H }),
      fetch(SUPABASE_URL + '/rest/v1/lead_activity?lead_id=eq.' + encodeURIComponent(id) +
        '&select=*&order=created_at.desc', { headers: H })
    ]);
    const lead = leadR.ok ? (await leadR.json())[0] : null;
    const activity = actR.ok ? await actR.json() : [];
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({ lead, activity });
  }

  if (req.method === 'PATCH') {
    if (requireCsrfHeader(req, res)) return;
    const body = req.body || {};
    const patch = {};
    if (typeof body.case_notes === 'string') patch.case_notes = bounded(body.case_notes, 8000);
    if (typeof body.status === 'string')     patch.status     = bounded(body.status, 60);
    if ('follow_up_due_at'      in body) patch.follow_up_due_at      = body.follow_up_due_at || null;
    if ('follow_up_completed'   in body) patch.follow_up_completed   = !!body.follow_up_completed;
    if ('follow_up_completed_at'in body) patch.follow_up_completed_at= body.follow_up_completed_at || null;
    if ('vendor_id' in body && (body.vendor_id === null || isUuid(body.vendor_id))) patch.vendor_id = body.vendor_id;
    if ('vendor_assigned' in body && typeof body.vendor_assigned === 'string') patch.vendor_assigned = bounded(body.vendor_assigned, 200);
    if ('sent_to_vendor_at' in body) patch.sent_to_vendor_at = body.sent_to_vendor_at || null;
    patch.updated_at = new Date().toISOString();
    if (Object.keys(patch).length <= 1) return res.status(400).json({ error: 'No allowed fields' });
    const r = await fetch(SUPABASE_URL + '/rest/v1/leads?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(patch)
    });
    if (!r.ok) return res.status(502).json({ error: 'Upstream error' });
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleLeadActivity(req, res) {
  if (requireCsrfHeader(req, res)) return;
  const sess = await readAdminSession(req);
  if (!sess) return res.status(401).json({ error: 'Unauthorized' });
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const body = req.body || {};
  const lead_id = body.lead_id;
  const action = bounded(body.action, 80);
  const description = bounded(body.description, 2000);
  if (!isUuid(lead_id) || !action || !description) return res.status(400).json({ error: 'lead_id, action, description required' });
  const r = await fetch(SUPABASE_URL + '/rest/v1/lead_activity', {
    method: 'POST',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ lead_id, action, description, performed_by: sess.email })
  });
  if (!r.ok) return res.status(502).json({ error: 'Upstream error' });
  return res.status(200).json({ ok: true });
}

async function handleVendor(req, res) {
  const sess = await readAdminSession(req);
  if (!sess) return res.status(401).json({ error: 'Unauthorized' });
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const id = req.query.id;
  if (!isUuid(id)) return res.status(400).json({ error: 'id must be a UUID' });
  const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
  const [vR, mR, lR, peR] = await Promise.all([
    fetch(SUPABASE_URL + '/rest/v1/vendors?id=eq.' + encodeURIComponent(id) + '&select=*', { headers: H }),
    fetch(SUPABASE_URL + '/rest/v1/vendor_memberships?vendor_id=eq.' + encodeURIComponent(id) + '&select=*', { headers: H }),
    fetch(SUPABASE_URL + '/rest/v1/leads?vendor_id=eq.' + encodeURIComponent(id) + '&select=*&order=received_at.desc', { headers: H }),
    fetch(SUPABASE_URL + '/rest/v1/vendor_prospect_emails?vendor_id=eq.' + encodeURIComponent(id) + '&select=*&order=sent_at.desc', { headers: H })
  ]);
  const vendor = vR.ok ? (await vR.json())[0] : null;
  if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json({
    vendor,
    memberships: mR.ok ? await mR.json() : [],
    leads: lR.ok ? await lR.json() : [],
    prospect_emails: peR.ok ? await peR.json() : []
  });
}

async function handleImageAction(req, res) {
  if (requireCsrfHeader(req, res)) return;
  const sess = await readAdminSession(req);
  if (!sess) return res.status(401).json({ error: 'Unauthorized' });
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const body = req.body || {};
  if (!isUuid(body.image_id)) return res.status(400).json({ error: 'image_id must be a UUID' });
  if (body.action !== 'approve' && body.action !== 'deny') return res.status(400).json({ error: 'action must be approve|deny' });
  const reason = body.action === 'deny' ? bounded(body.reason || '', 500) : null;
  const patch = {
    status: body.action === 'approve' ? 'approved' : 'denied',
    reviewed_by: sess.email, reviewed_at: new Date().toISOString(), deny_reason: reason
  };
  const r = await fetch(SUPABASE_URL + '/rest/v1/vendor_images?id=eq.' + encodeURIComponent(body.image_id), {
    method: 'PATCH',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(patch)
  });
  if (!r.ok) return res.status(502).json({ error: 'Upstream error' });
  return res.status(200).json({ ok: true });
}

async function handleMarkNotifs(req, res) {
  if (requireCsrfHeader(req, res)) return;
  const sess = await readAdminSession(req);
  if (!sess) return res.status(401).json({ error: 'Unauthorized' });
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const r = await fetch(SUPABASE_URL + '/rest/v1/admin_notifications?is_read=eq.false', {
    method: 'PATCH',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ is_read: true, read_at: new Date().toISOString() })
  });
  if (!r.ok) return res.status(502).json({ error: 'Upstream error' });
  return res.status(200).json({ ok: true });
}

// =========================================================================
// Dispatcher
// =========================================================================
const ROUTES = {
  'login':         { POST: handleLogin },
  'logout':        { POST: handleLogout },
  'me':            { GET: handleMe },
  'dashboard':     { GET: handleDashboard },
  'leads':         { GET: handleLeadsList },
  'lead':          { GET: handleLead, PATCH: handleLead },
  'lead-activity': { POST: handleLeadActivity },
  'vendor':        { GET: handleVendor },
  'image-action':  { POST: handleImageAction },
  'mark-notifs':   { POST: handleMarkNotifs },
};

module.exports = async (req, res) => {
  if (applyCors(req, res, 'GET, POST, PATCH, OPTIONS')) return;
  // Vercel can expose the catch-all under different key names depending on
  // its parser version (req.query.slug vs req.query['[...slug]']). Try both.
  const slugArr = req.query.slug || req.query['...slug'] || req.query['[...slug]'] || [];
  const slug = Array.isArray(slugArr) ? slugArr.join('/') : String(slugArr);
  // Temporary debug aid: surface what we got
  const route = ROUTES[slug];
  if (!route) return res.status(404).json({ error: 'Not found' });
  const handler = route[req.method];
  if (!handler) return res.status(405).json({ error: 'Method not allowed' });
  try { return await handler(req, res); }
  catch (e) { log.error('admin dispatcher err', e.message); return res.status(500).json({ error: 'Server error' }); }
};
