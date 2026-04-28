// POST /api/admin-delete
// Deletes a user or vendor: removes from custom tables + Supabase auth.
//
// SECURITY: Requires the caller to present an Authorization: Bearer <token>
// header containing a valid Supabase session token whose user email matches
// the ADMIN_EMAIL env var. Without this check, ANY internet caller could
// delete any user or vendor by ID (this was the prior behavior).
const { applyCors, requireCsrfHeader, verifyAdmin, isUuid } = require('../lib/security');

module.exports = async (req, res) => {
  if (applyCors(req, res, 'POST, OPTIONS')) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (requireCsrfHeader(req, res)) return;

  const admin = await verifyAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY
  };

  try {
    const body = req.body || {};
    const type = body.type;
    const id = body.id;
    const auth_user_id = body.auth_user_id;

    if (type !== 'user' && type !== 'vendor') {
      return res.status(400).json({ error: 'type must be user or vendor' });
    }
    if (!isUuid(id)) {
      return res.status(400).json({ error: 'id must be a UUID' });
    }
    if (auth_user_id != null && !isUuid(auth_user_id)) {
      return res.status(400).json({ error: 'auth_user_id must be a UUID' });
    }

    const enc = encodeURIComponent(id);

    if (type === 'user') {
      await fetch(SUPABASE_URL + '/rest/v1/user_auth?user_id=eq.' + enc, { method: 'DELETE', headers });
      await fetch(SUPABASE_URL + '/rest/v1/user_surveys?user_id=eq.' + enc, { method: 'DELETE', headers });
      await fetch(SUPABASE_URL + '/rest/v1/users?id=eq.' + enc, { method: 'DELETE', headers });
    } else {
      await fetch(SUPABASE_URL + '/rest/v1/vendor_images?vendor_id=eq.' + enc, { method: 'DELETE', headers });
      await fetch(SUPABASE_URL + '/rest/v1/vendor_memberships?vendor_id=eq.' + enc, { method: 'DELETE', headers });
      await fetch(SUPABASE_URL + '/rest/v1/vendor_auth?vendor_id=eq.' + enc, { method: 'DELETE', headers });
      await fetch(SUPABASE_URL + '/rest/v1/leads?vendor_id=eq.' + enc, { method: 'DELETE', headers });
      await fetch(SUPABASE_URL + '/rest/v1/vendors?id=eq.' + enc, { method: 'DELETE', headers });
    }

    if (auth_user_id) {
      const encAuth = encodeURIComponent(auth_user_id);
      const r = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + encAuth, { method: 'DELETE', headers });
      if (!r.ok) console.error('Auth delete failed:', r.status);
    }

    return res.status(200).json({ success: true, message: type + ' deleted successfully' });
  } catch (err) {
    console.error('admin-delete error:', err);
    return res.status(500).json({ error: 'Server error during deletion' });
  }
};
