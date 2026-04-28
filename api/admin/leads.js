// GET /api/admin/leads — list view used by lead_crm.html
const { applyCors } = require('../../lib/security');
const { readAdminSession } = require('../../lib/session');

module.exports = async (req, res) => {
  if (applyCors(req, res, 'GET, OPTIONS')) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const sess = await readAdminSession(req);
  if (!sess) return res.status(401).json({ error: 'Unauthorized' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !KEY) return res.status(500).json({ error: 'Server misconfigured' });
  const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };

  try {
    const r = await fetch(SUPABASE_URL +
      '/rest/v1/leads?select=id,lead_number,first_name,last_name,phone,email,city,state,zip_code,service_zip,care_for,care_type,status,received_at,sent_to_vendor_at,vendor_id,auto_assigned,vendors(business_name)' +
      '&order=received_at.desc',
      { headers: H });
    if (!r.ok) return res.status(502).json({ error: 'Upstream error' });
    res.setHeader('Cache-Control','private, no-store');
    return res.status(200).json({ leads: await r.json() });
  } catch (e) {
    return res.status(500).json({ error: 'Server error' });
  }
};
