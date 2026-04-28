// api/contact.js — Receives Contact Us form submissions and stores them in
// public.contact_messages. Lightweight: validates input, rate-limits by IP,
// inserts a row. Admin can read via Supabase dashboard or build a UI later.

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

function applyCors(req, res) {
  const origin = req.headers.origin || '';
  const allowed = ['https://senova.info','https://www.senova.info'];
  if (allowed.includes(origin) || /\.vercel\.app$/.test(new URL(origin || 'https://x.local').hostname)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

function bounded(v, max) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.length > max) return null;
  return t;
}

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return res.status(500).json({ error: 'Server misconfigured' });

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch (_) {}
  const name    = bounded(body.name, 120);
  const email   = bounded(body.email, 254);
  const subject = bounded(body.subject, 200) || '';
  const message = bounded(body.message, 4000);
  const role    = ['family','provider','press','other','partner'].includes(body.role) ? body.role : null;
  if (!name || !email || !message) return res.status(400).json({ error: 'Name, email, and message are required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email.' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;
  const ua = (req.headers['user-agent'] || '').slice(0, 500);

  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/contact_messages', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ name, email, role, subject, message, user_agent: ua, ip_address: ip })
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('contact insert failed:', r.status, t);
      return res.status(502).json({ error: 'Could not save your message right now.' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('contact handler error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
