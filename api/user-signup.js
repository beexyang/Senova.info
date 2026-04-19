// POST /api/user-signup
// Creates a user account: Supabase auth user + users row + user_auth link
// Sends welcome email + admin notification + schedules 3-month survey
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
      email, password, first_name, last_name, phone,
      street_address, city, state, zip_code,
      care_for, care_types
    } = req.body;

    if (!email || !password || !first_name || !last_name) {
      return res.status(400).json({ error: 'Email, password, first name, and last name are required' });
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
        user_metadata: { role: 'user', first_name, last_name }
      })
    });

    if (!authRes.ok) {
      const err = await authRes.json();
      return res.status(400).json({ error: err.msg || 'Failed to create account' });
    }

    const authUser = await authRes.json();

    // 2. Create user record
    const userRes = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        id: authUser.id,
        email,
        phone: phone || '',
        first_name,
        last_name,
        street_address: street_address || null,
        city: city || null,
        state: state || null,
        zip_code: zip_code || null,
        care_for: care_for || 'other',
        care_types: care_types || []
      })
    });

    const user = (await userRes.json())[0];

    // 3. Link auth to user
    await fetch(`${SUPABASE_URL}/rest/v1/user_auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        auth_user_id: authUser.id,
        user_id: user.id,
        email
      })
    });

    // 4. Admin notification
    await fetch(`${SUPABASE_URL}/rest/v1/admin_notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        type: 'new_user',
        title: `New User: ${first_name} ${last_name}`,
        message: `${first_name} from ${city || ''}, ${state || ''} signed up. Care for: ${care_for || 'N/A'}. Match with vendors and send lead.`,
        reference_id: user.id,
        reference_type: 'user'
      })
    });

    // 5. Schedule 3-month survey
    const surveyDate = new Date();
    surveyDate.setMonth(surveyDate.getMonth() + 3);

    await fetch(`${SUPABASE_URL}/rest/v1/user_surveys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        user_id: user.id,
        survey_type: '3_month',
        status: 'pending',
        scheduled_for: surveyDate.toISOString()
      })
    });

    // 6. Send welcome email to user
    if (RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${RESEND_API_KEY}`
          },
          body: JSON.stringify({
            from: 'Senova <hello@senova.info>',
            to: [email],
            subject: `Welcome to Senova, ${first_name}!`,
            html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
              <div style="background:#0D9488;padding:32px;text-align:center;border-radius:12px 12px 0 0">
                <h1 style="color:#fff;margin:0;font-size:28px">Welcome to Senova!</h1>
              </div>
              <div style="padding:32px;background:#fff;border:1px solid #E5E7EB;border-top:none;border-radius:0 0 12px 12px">
                <p>Hi ${first_name},</p>
                <p>Thank you for joining Senova! We're here to help you find the perfect care for your loved one.</p>
                <p>Here's what you can do:</p>
                <ul>
                  <li><strong>Search providers</strong> by city, ZIP, or care type</li>
                  <li><strong>Compare facilities</strong> with ratings, photos, and details</li>
                  <li><strong>Request callbacks</strong> directly from providers</li>
                </ul>
                <p>All of our services are <strong>100% free</strong> for families.</p>
                <p style="text-align:center;margin:32px 0">
                  <a href="https://senova.info/search" style="background:#0D9488;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600">Start Searching</a>
                </p>
                <p>If you have any questions, reply to this email â we're here to help.</p>
                <p>â The Senova Team</p>
              </div>
            </div>`
          })
        });
      } catch (emailErr) { /* best effort */ }

      // 7. Send admin alert
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
            subject: `New User Signup: ${first_name} ${last_name}`,
            html: `<h2>New User Signed Up</h2>
              <p><strong>${first_name} ${last_name}</strong></p>
              <p>Email: ${email}<br>Phone: ${phone || 'N/A'}<br>
              Location: ${city || ''}, ${state || ''} ${zip_code || ''}<br>
              Looking for: ${care_for || 'N/A'}<br>
              Care types: ${(care_types || []).join(', ') || 'N/A'}</p>
              <p><strong>Action:</strong> Match with a vendor and create a lead.</p>
              <p><a href="https://senova.info/admin">View in Admin Dashboard</a></p>`
          })
        });
      } catch (emailErr) { /* best effort */ }
    }

    res.status(200).json({ success: true, user_id: user.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
