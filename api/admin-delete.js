// POST /api/admin-delete
// Deletes a user or vendor: removes from custom tables + Supabase auth
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY
  };

  try {
    const { type, id, auth_user_id } = req.body;
    if (!type || !id) return res.status(400).json({ error: 'type and id are required' });

    if (type === 'user') {
      await fetch(SUPABASE_URL + '/rest/v1/user_auth?user_id=eq.' + id, { method: 'DELETE', headers });
      await fetch(SUPABASE_URL + '/rest/v1/user_surveys?user_id=eq.' + id, { method: 'DELETE', headers });
      await fetch(SUPABASE_URL + '/rest/v1/users?id=eq.' + id, { method: 'DELETE', headers });
    } else if (type === 'vendor') {
      await fetch(SUPABASE_URL + '/rest/v1/vendor_images?vendor_id=eq.' + id, { method: 'DELETE', headers });
      await fetch(SUPABASE_URL + '/rest/v1/vendor_memberships?vendor_id=eq.' + id, { method: 'DELETE', headers });
      await fetch(SUPABASE_URL + '/rest/v1/vendor_auth?vendor_id=eq.' + id, { method: 'DELETE', headers });
      await fetch(SUPABASE_URL + '/rest/v1/leads?vendor_id=eq.' + id, { method: 'DELETE', headers });
      await fetch(SUPABASE_URL + '/rest/v1/vendors?id=eq.' + id, { method: 'DELETE', headers });
    } else {
      return res.status(400).json({ error: 'type must be user or vendor' });
    }

    if (auth_user_id) {
      var authRes = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + auth_user_id, { method: 'DELETE', headers });
      if (!authRes.ok) console.error('Auth delete failed:', await authRes.text());
    }

    return res.status(200).json({ success: true, message: type + ' deleted successfully' });
  } catch (err) {
    console.error('Delete error:', err);
    return res.status(500).json({ error: 'Server error during deletion' });
  }
};
