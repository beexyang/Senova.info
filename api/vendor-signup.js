// POST /api/vendor-signup
// Creates a vendor account: Supabase auth user + vendors row + vendor_auth link + admin notification
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  try {
    const {
      email, password, business_name, contact_name, phone,
      address, city, state, zip_code, care_types,
      description, license_number, website_url
    } = req.body;

    if (!email || !password || !business_name) {
      return res.status(400).json({ error: 'Email, password, and business name are required' });
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
      const err = await authRes.json();
      return res.status(400).json({ error: err.msg || 'Failed to create auth account' });
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
        status: 'active'
      })
    });

    const vendor = (await vendorRes.json())[0];

    // 3. Link auth user to vendor
    await fetch(`${SUPABASE_URL}/rest/v1/vendor_auth`, {
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

    // 4. Create default membership (inactive â no plan)
    await fetch(`${SUPABASE_URL}/rest/v1/vendor_memberships`, {
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

    // 5. Create admin notification
    await fetch(`${SUPABASE_URL}/rest/v1/admin_notifications`, {
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

    // 6. Send admin email via Resend
    if (RESEND_API_KEY) {
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
            subject: `New Vendor Signup: ${business_name}`,
            html: `<h2>New Vendor Profile Created</h2>
              <p><strong>${business_name}</strong> just signed up on Senova.</p>
              <p>Contact: ${contact_name || 'N/A'}<br>
              Email: ${email}<br>
              Phone: ${phone || 'N/A'}<br>
              Location: ${city || ''}, ${state || ''}</p>
              <p><strong>Action:</strong> Follow up to upsell to a lead membership plan.</p>
              <p><a href="https://senova.info/admin">View in Admin Dashboard</a></p>`
          })
        });
      } catch (emailErr) { /* best effort */ }
    }

    res.status(200).json({ success: true, vendor_id: vendor.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
