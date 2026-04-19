// POST /api/notify-admin
// Creates an admin notification and optionally sends email
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  try {
    const { type, vendor_name, vendor_id, image_url, title, message } = req.body;

    // Create notification in database
    const notifTitle = title || getDefaultTitle(type, vendor_name);
    const notifMessage = message || getDefaultMessage(type, vendor_name, image_url);

    await fetch(`${SUPABASE_URL}/rest/v1/admin_notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        type: type || 'general',
        title: notifTitle,
        message: notifMessage,
        reference_id: vendor_id || null,
        reference_type: type === 'image_upload' ? 'image' : 'vendor',
        email_sent: !!RESEND_API_KEY
      })
    });

    // Send email notification
    if (RESEND_API_KEY) {
      const emailSubject = type === 'image_upload'
        ? `Photo Upload: ${vendor_name} â Review Required`
        : notifTitle;

      const emailHtml = type === 'image_upload'
        ? `<h2>New Photo Uploaded â Review Required</h2>
           <p><strong>${vendor_name}</strong> uploaded a new facility photo.</p>
           ${image_url ? `<p><img src="${image_url}" style="max-width:400px;border-radius:8px" alt="Uploaded photo"/></p>` : ''}
           <p><a href="https://senova.info/admin" style="background:#0D9488;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Review in Dashboard</a></p>`
        : `<h2>${notifTitle}</h2><p>${notifMessage}</p>
           <p><a href="https://senova.info/admin">View in Admin Dashboard</a></p>`;

      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${RESEND_API_KEY}`
          },
          body: JSON.stringify({
            from: 'Senova <notifications@senova.info>',
            to: ['[ADMIN_EMAIL_REDACTED]'],
            subject: emailSubject,
            html: emailHtml
          })
        });
      } catch (emailErr) { /* best effort */ }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

function getDefaultTitle(type, vendorName) {
  switch (type) {
    case 'image_upload': return `Photo Upload: ${vendorName || 'Vendor'}`;
    case 'new_vendor': return `New Vendor: ${vendorName || 'Unknown'}`;
    case 'new_user': return 'New User Signup';
    case 'lead_closed': return 'Lead Closed';
    default: return 'New Notification';
  }
}

function getDefaultMessage(type, vendorName, imageUrl) {
  switch (type) {
    case 'image_upload': return `${vendorName || 'A vendor'} uploaded a new facility photo. Please review and approve/deny.`;
    case 'new_vendor': return `${vendorName || 'A new vendor'} just created a profile. Follow up to upsell to lead plan.`;
    default: return '';
  }
}
