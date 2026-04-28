// POST /api/admin/lead-activity — append an activity entry to a lead.
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
  const lead_id = body.lead_id;
  const action = bounded(body.action, 80);
  const description = bounded(body.description, 2000);
  if (!isUuid(lead_id) || !action || !description) {
    return res.status(400).json({ error: 'lead_id (uuid), action, and description are required' });
  }

  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/lead_activity', {
      method: 'POST',
      headers: {
        apikey: KEY, Authorization: 'Bearer ' + KEY,
        'Content-Type': 'application/json', 'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ lead_id, action, description, performed_by: sess.email })
    });
    if (!r.ok) return res.status(502).json({ error: 'Upstream error' });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Server error' });
  }
};
