// GET /api/admin/vendor?id=<uuid> — admin-only vendor detail proxy.
//   Returns: vendor + memberships + leads + prospect_emails
const { applyCors, isUuid } = require('../../lib/security');
const { readAdminSession } = require('../../lib/session');
const log = require('../../lib/log');

module.exports = async (req, res) => {
  if (applyCors(req, res, 'GET, OPTIONS')) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const sess = await readAdminSession(req);
  if (!sess) return res.status(401).json({ error: 'Unauthorized' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !KEY) return res.status(500).json({ error: 'Server misconfigured' });
  const id = req.query.id;
  if (!isUuid(id)) return res.status(400).json({ error: 'id must be a UUID' });
  const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };

  try {
    const [vR, mR, lR, peR] = await Promise.all([
      fetch(SUPABASE_URL + '/rest/v1/vendors?id=eq.' + encodeURIComponent(id) + '&select=*', { headers: H }),
      fetch(SUPABASE_URL + '/rest/v1/vendor_memberships?vendor_id=eq.' + encodeURIComponent(id) + '&select=*', { headers: H }),
      fetch(SUPABASE_URL + '/rest/v1/leads?vendor_id=eq.' + encodeURIComponent(id) + '&select=*&order=received_at.desc', { headers: H }),
      fetch(SUPABASE_URL + '/rest/v1/vendor_prospect_emails?vendor_id=eq.' + encodeURIComponent(id) + '&select=*&order=sent_at.desc', { headers: H })
    ]);
    const vendor = vR.ok ? (await vR.json())[0] : null;
    const memberships = mR.ok ? await mR.json() : [];
    const leads = lR.ok ? await lR.json() : [];
    const prospect_emails = peR.ok ? await peR.json() : [];
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    res.setHeader('Cache-Control','private, no-store');
    return res.status(200).json({ vendor, memberships, leads, prospect_emails });
  } catch (e) {
    log.error('admin vendor get', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
