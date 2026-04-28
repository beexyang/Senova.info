// POST /api/auth/vendor-signup
// Creates a vendor account: Supabase auth user + vendors row + vendor_auth link + admin notification.
// SECURITY: input length caps, password minimum length, CORS restricted,
// admin email moved to env var, generic error responses, escape user input
// before interpolating into admin notification HTML.
const { applyCors, requireCsrfHeader, isEmail, bounded, isStrongPassword } = require('../security');
const { rateLimit } = require('../ratelimit');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';

const escHtml = (v) => v == null ? '' : String(v).replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

module.exports = async (req, res) => {
  if (applyCors(req, res, 'POST, OPTIONS')) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (requireCsrfHeader(req, res)) return;
  // 3 vendor signups per IP per 10 minutes.
  if (rateLimit(req, 'vendor-signup', 3, 600_000)) {
    return res.status(429).json({ error: 'Too many signup attempts. Please try again later.' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  try {
    const body = req.body || {};
    const email = bounded(body.email, 254);
    const password = typeof body.password === 'string' ? body.password : '';
    const business_name = bounded(body.business_name, 200);
    const contact_name = bounded(body.contact_name, 120);
    const phone = bounded(body.phone, 30);
    const address = bounded(body.address, 200);
    const city = bounded(body.city, 100);
    const state = bounded(body.state, 80);
    const zip_code = bounded(body.zip_code, 10);
    const care_types = Array.isArray(body.care_types) ? body.care_types.slice(0, 20) : [];
    const description = bounded(body.description, 2000);
    const license_number = bounded(body.license_number, 60);
    const website_url = bounded(body.website_url, 300);
    const {
      accepts_medicaid, accepts_medicare, accepts_private_insurance,
      accepts_private_pay, hcbs_waiver, languages, meal_options
    } = body;

    if (!email || !isEmail(email)) {
      return res.status(400).json({ error: 'A valid email is required' });
    }
    if (!isStrongPassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 12 characters and not a common password.' });
    }
    if (!business_name) {
      return res.status(400).json({ error: 'Business name is required' });
    }
    if (website_url && !/^https?:\/\//i.test(website_url)) {
      return res.status(400).json({ error: 'website_url must start with http:// or https://' });
    }

    // 1. Create Supabase auth user
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { role: 'vendor', business_name }
      })
    });

    if (!authRes.ok) {
      console.error('vendor-signup auth fail:', authRes.status);
      return res.status(400).json({ error: 'Could not create vendor account. Please try again.' });
    }

    const authUser = await authRes.json();

    // 2. Create vendor record
    const vendorRes = await fetch(`${SUPABASE_URL}/rest/v1/vendors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        business_name,
        contact_name: contact_name || null,
        email,
        phone: phone || null,
        address: address || null,
        city: city || '',
        state: state || '',
        zip_code: zip_code || null,
        care_types: care_types || [],
        description: description || null,
        license_number: license_number || null,
        website_url: website_url || null,
        // payment methods (defaults match previous behaviour)
        accepts_medicaid:          accepts_medicaid !== undefined ? !!accepts_medicaid : true,
        accepts_title19:           accepts_medicaid !== undefined ? !!accepts_medicaid : true,
        accepts_medicare:          !!accepts_medicare,
        accepts_private_insurance: !!accepts_private_insurance,
        accepts_private_pay:       !!accepts_private_pay,
        hcbs_waiver:               !!hcbs_waiver,
        // profile-enriching fields
        languages:                 Array.isArray(languages)    && languages.length    ? languages    : ['English'],
        meal_options:              Array.isArray(meal_options) && meal_options.length ? meal_options : [],
        status: 'active'
      })
    });

    if (!vendorRes.ok) {
      const vendorErr = await vendorRes.text();
      console.error('Vendor insert failed:', vendorErr);
      return res.status(500).json({ error: 'Failed to create vendor profile. Database tables may not be set up yet.' });
    }

    const vendorBody = await vendorRes.json();
    const vendor = vendorBody[0];

    if (!vendor || !vendor.id) {
      console.error('Vendor insert returned empty:', JSON.stringify(vendorBody));
      return res.status(500).json({ error: 'Vendor profile was not created. Check database schema.' });
    }

    // 3. Link auth user to vendor (best effort — don't block signup if this fails)
    try {
      const linkRes = await fetch(`${SUPABASE_URL}/rest/v1/vendor_auth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          auth_user_id: authUser.id,
          vendor_id: vendor.id,
          email
        })
      });
      if (!linkRes.ok) console.error('vendor_auth insert failed:', await linkRes.text());
    } catch (linkErr) { console.error('vendor_auth error:', linkErr.message); }

    // 4. Create default membership (best effort)
    try {
      const memRes = await fetch(`${SUPABASE_URL}/rest/v1/vendor_memberships`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          vendor_id: vendor.id,
          plan_name: 'none',
          plan_status: 'inactive',
          leads_per_month: 0,
          price_monthly: 0
        })
      });
      if (!memRes.ok) console.error('vendor_memberships insert failed:', await memRes.text());
    } catch (memErr) { console.error('membership error:', memErr.message); }

    // 5. Create admin notification (best effort)
    try {
      const notifRes = await fetch(`${SUPABASE_URL}/rest/v1/admin_notifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          type: 'new_vendor',
          title: `New Vendor: ${business_name}`,
          message: `${contact_name || 'Unknown'} from ${city || ''}, ${state || ''} just created a vendor profile. Upsell to lead plan.`,
          reference_id: vendor.id,
          reference_type: 'vendor'
        })
      });
      if (!notifRes.ok) console.error('admin_notifications insert failed:', await notifRes.text());
    } catch (notifErr) { console.error('notification error:', notifErr.message); }

    // 6. Send admin email via Resend (best effort). User input is HTML escaped.
    if (RESEND_API_KEY && ADMIN_EMAIL) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${RESEND_API_KEY}`
          },
          body: JSON.stringify({
            from: 'Senova <notifications@senova.info>',
            to: [ADMIN_EMAIL],
            subject: `New Vendor Signup: ${business_name}`,
            html: `<h2>New Vendor Profile Created</h2>
              <p><strong>${escHtml(business_name)}</strong> just signed up on Senova.</p>
              <p>Contact: ${escHtml(contact_name) || 'N/A'}<br>
              Email: ${escHtml(email)}<br>
              Phone: ${escHtml(phone) || 'N/A'}<br>
              Location: ${escHtml(city) || ''}, ${escHtml(state) || ''}</p>
              <p><strong>Action:</strong> Follow up to upsell to a lead membership plan.</p>
              <p><a href="https://senova.info/admin">View in Admin Dashboard</a></p>`
          })
        });
      } catch (emailErr) { /* best effort */ }
    }

    res.status(200).json({ success: true, vendor_id: vendor.id });
  } catch (error) {
    console.error('vendor-signup error:', error);
    res.status(500).json({ error: error.message });
  }
};
