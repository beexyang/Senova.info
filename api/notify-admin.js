// POST /api/notify-admin
// Creates an admin notification row and optionally sends an email.
//
// SECURITY: Previously this endpoint was completely unauthenticated, so
// anyone on the internet could spam the admin inbox / DB. We now require
// either a valid admin session OR a logged-in vendor user. For vendor
// callers we ignore client-supplied title/message and look up the vendor
// record server-side so callers can't impersonate other vendors or inject
// arbitrary HTML into the admin email.
const {
  applyCors, requireCsrfHeader,
  verifyAuthenticated, verifyAdmin, isUuid, escapeHtml, bounded
} = require('../lib/security');
const { rateLimit } = require('../lib/ratelimit');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';

module.exports = async (req, res) => {
  if (applyCors(req, res, 'POST, OPTIONS')) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (requireCsrfHeader(req, res)) return;

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }
  if (!ADMIN_EMAIL) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const admin = await verifyAdmin(req);
  const authedUser = admin ? null : await verifyAuthenticated(req);
  if (!admin && !authedUser) return res.status(401).json({ error: 'Unauthorized' });
  // Rate-limit non-admin callers so a single vendor can't spam admin inbox.
  if (!admin && rateLimit(req, 'notify-admin:' + authedUser.id, 5, 60_000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const sbHeaders = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
    'Prefer': 'return=minimal'
  };
  const sbReadHeaders = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY
  };

  try {
    const body = req.body || {};

    if (!admin) {
      // ----- vendor caller: only the image_upload notification path -----
      const type = body.type;
      const vendor_id = body.vendor_id;
      const image_url = body.image_url;

      if (type !== 'image_upload') return res.status(403).json({ error: 'Not allowed' });
      if (!isUuid(vendor_id)) return res.status(400).json({ error: 'vendor_id must be a UUID' });

      const vaUrl = SUPABASE_URL + '/rest/v1/vendor_auth?auth_user_id=eq.'
        + encodeURIComponent(authedUser.id) + '&vendor_id=eq.'
        + encodeURIComponent(vendor_id) + '&select=vendor_id';
      const vaRes = await fetch(vaUrl, { headers: sbReadHeaders });
      const va = vaRes.ok ? await vaRes.json() : [];
      if (!va.length) return res.status(403).json({ error: 'Not allowed' });

      const vUrl = SUPABASE_URL + '/rest/v1/vendors?id=eq.'
        + encodeURIComponent(vendor_id) + '&select=business_name';
      const vRes = await fetch(vUrl, { headers: sbReadHeaders });
      const v = vRes.ok ? (await vRes.json())[0] : null;
      const vendorName = v ? v.business_name : 'A vendor';

      let safeImage = null;
      if (typeof image_url === 'string') {
        const expectedPrefix = SUPABASE_URL + '/storage/v1/object/public/';
        if (image_url.startsWith(expectedPrefix) && image_url.length < 1024) {
          safeImage = image_url;
        }
      }

      const title = 'Photo Upload: ' + vendorName;
      const message = vendorName + ' uploaded a new facility photo. Please review and approve/deny.';

      await fetch(SUPABASE_URL + '/rest/v1/admin_notifications', {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify({
          type: 'image_upload',
          title: title,
          message: message,
          reference_id: vendor_id,
          reference_type: 'vendor',
          email_sent: !!RESEND_API_KEY
        })
      });

      if (RESEND_API_KEY) {
        const html = '<h2>New Photo Uploaded - Review Required</h2>'
          + '<p><strong>' + escapeHtml(vendorName) + '</strong> uploaded a new facility photo.</p>'
          + (safeImage
            ? '<p><img src="' + escapeHtml(safeImage)
              + '" style="max-width:400px;border-radius:8px" alt="Uploaded photo"/></p>'
            : '')
          + '<p><a href="https://senova.info/admin">Review in Dashboard</a></p>';
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + RESEND_API_KEY
            },
            body: JSON.stringify({
              from: 'Senova <notifications@senova.info>',
              to: [ADMIN_EMAIL],
              subject: 'Photo Upload: ' + vendorName + ' - Review Required',
              html: html
            })
          });
        } catch (e) { /* best effort */ }
      }

      return res.status(200).json({ success: true });
    }

    // ----- admin caller -----
    const type = bounded(body.type, 50) || 'general';
    const title = bounded(body.title, 200) || 'Notification';
    const message = bounded(body.message, 2000) || '';
    const reference_id = body.reference_id && isUuid(body.reference_id) ? body.reference_id : null;
    const reference_type = bounded(body.reference_type, 50) || null;

    await fetch(SUPABASE_URL + '/rest/v1/admin_notifications', {
      method: 'POST',
      headers: sbHeaders,
      body: JSON.stringify({
        type: type,
        title: title,
        message: message,
        reference_id: reference_id,
        reference_type: reference_type,
        email_sent: !!RESEND_API_KEY
      })
    });

    if (RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + RESEND_API_KEY
          },
          body: JSON.stringify({
            from: 'Senova <notifications@senova.info>',
            to: [ADMIN_EMAIL],
            subject: title,
            html: '<h2>' + escapeHtml(title) + '</h2><p>' + escapeHtml(message)
              + '</p><p><a href="https://senova.info/admin">View in Admin Dashboard</a></p>'
          })
        });
      } catch (e) { /* best effort */ }
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('notify-admin error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
};
