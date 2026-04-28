// POST /api/admin/mark-notifs — mark all admin notifications as read.
const { applyCors, requireCsrfHeader } = require('../../lib/security');
const { readAdminSession } = require('../../lib/session');

module.exports = async (req, res) => {
  if (applyCors(req, res, 'POST, OPTIONS')) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (requireCsrfHeader(req, res)) return;
  const sess = await readAdminSession(req);
  if (!sess) return res.status(401).json({ error: 'Unauthorized' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !KEY) return res.status(500).json({ error: 'Server misconfigured' });

  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/admin_notifications?is_read=eq.false', {
      method: 'PATCH',
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ is_read: true, read_at: new Date().toISOString() })
    });
    if (!r.ok) return res.status(502).json({ error: 'Upstream error' });
    return res.status(200).json({ ok: true });
  } catch (e) { return res.status(500).json({ error: 'Server error' }); }
};
