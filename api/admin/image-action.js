// POST /api/admin/image-action — admin approves or denies a vendor image.
const { applyCors, requireCsrfHeader, isUuid, bounded } = require('../../lib/security');
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

  const body = req.body || {};
  const id = body.image_id;
  const action = body.action;
  if (!isUuid(id)) return res.status(400).json({ error: 'image_id must be a UUID' });
  if (action !== 'approve' && action !== 'deny') return res.status(400).json({ error: 'action must be approve|deny' });
  const reason = action === 'deny' ? bounded(body.reason || '', 500) : null;

  const patch = {
    status: action === 'approve' ? 'approved' : 'denied',
    reviewed_by: sess.email,
    reviewed_at: new Date().toISOString(),
    deny_reason: reason
  };
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/vendor_images?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify(patch)
    });
    if (!r.ok) return res.status(502).json({ error: 'Upstream error' });
    return res.status(200).json({ ok: true });
  } catch (e) { return res.status(500).json({ error: 'Server error' }); }
};
