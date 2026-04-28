// GET /api/admin/dashboard — single authenticated endpoint that returns
// every dataset the admin dashboard renders (vendors, users, leads, images,
// notifications, memberships). Uses service_role internally. Browser never
// touches the anon key for these tables again.
const { applyCors } = require('../../lib/security');
const { readAdminSession } = require('../../lib/session');
const log = require('../../lib/log');

module.exports = async (req, res) => {
  if (applyCors(req, res, 'GET, OPTIONS')) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const sess = await readAdminSession(req);
  if (!sess) return res.status(401).json({ error: 'Unauthorized' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };

  async function q(path) {
    try {
      const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, { headers: H });
      if (!r.ok) return [];
      return await r.json();
    } catch (e) { log.warn('admin dashboard q failed', e.message); return []; }
  }

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
};
