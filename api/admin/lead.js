// /api/admin/lead — admin proxy for lead reads + updates.
//   GET  /api/admin/lead?id=<uuid>         -> lead + linked user/vendor + activity
//   PATCH /api/admin/lead?id=<uuid>        -> update case_notes / follow_up_* / status
const { applyCors, requireCsrfHeader, isUuid, bounded } = require('../../lib/security');
const { readAdminSession } = require('../../lib/session');
const log = require('../../lib/log');

module.exports = async (req, res) => {
  if (applyCors(req, res, 'GET, PATCH, OPTIONS')) return;
  if (req.method !== 'GET' && req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  if (req.method !== 'GET' && requireCsrfHeader(req, res)) return;
  const sess = await readAdminSession(req);
  if (!sess) return res.status(401).json({ error: 'Unauthorized' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !KEY) return res.status(500).json({ error: 'Server misconfigured' });
  const id = req.query.id;
  if (!isUuid(id)) return res.status(400).json({ error: 'id must be a UUID' });
  const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };

  if (req.method === 'GET') {
    try {
      const [leadR, actR] = await Promise.all([
        fetch(SUPABASE_URL + '/rest/v1/leads?id=eq.' + encodeURIComponent(id)
          + '&select=*,users(id,email,first_name,last_name,phone,city,state,zip_code,service_zip,care_for,care_types,created_at),vendors(id,business_name,email,phone,city,state)',
          { headers: H }),
        fetch(SUPABASE_URL + '/rest/v1/lead_activity?lead_id=eq.' + encodeURIComponent(id)
          + '&select=*&order=created_at.desc', { headers: H })
      ]);
      const lead = leadR.ok ? (await leadR.json())[0] : null;
      const activity = actR.ok ? await actR.json() : [];
      if (!lead) return res.status(404).json({ error: 'Lead not found' });
      res.setHeader('Cache-Control','private, no-store');
      return res.status(200).json({ lead, activity });
    } catch (e) {
      log.error('admin lead get', e.message);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  // PATCH: only allow specific safe fields
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
  if (Object.keys(patch).length <= 1) return res.status(400).json({ error: 'No allowed fields in body' });

  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/leads?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { ...H, 'Content-Type':'application/json', 'Prefer':'return=minimal' },
      body: JSON.stringify(patch)
    });
    if (!r.ok) {
      log.error('admin lead patch fail', r.status);
      return res.status(502).json({ error: 'Upstream error' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    log.error('admin lead patch', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
