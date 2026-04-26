// POST /api/user-signup
// Creates a user, creates a lead for them, auto-assigns the lead to a
// paid vendor based on service_zip (radius match + plan tier priority),
// and if no paid vendor matches, emails top-rated unpaid vendors
// inviting them to sign up on Senova.
//
// All required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY

// ---------- helpers ----------

// Geocode a US ZIP code to { lat, lng } via zippopotam.us (free, no key).
// Returns null on any failure.
async function geocodeZip(zip) {
  if (!zip) return null;
  try {
    const r = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (!r.ok) return null;
    const d = await r.json();
    const place = d && d.places && d.places[0];
    if (!place) return null;
    return {
      lat: parseFloat(place.latitude),
      lng: parseFloat(place.longitude)
    };
  } catch (_) {
    return null;
  }
}

// Haversine distance in miles between two lat/lng points.
function distanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8; // Earth radius in miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Plan priority: premium first, growth next, starter last.
const PLAN_RANK = { premium: 3, growth: 2, starter: 1 };

// Supabase REST helper
function sbHeaders(SUPABASE_SERVICE_KEY, extra = {}) {
  return {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    ...extra
  };
}

// Append an event to the lead_activity table. Best-effort; logs and swallows errors.
async function logActivity(SUPABASE_URL, SUPABASE_SERVICE_KEY, leadId, action, description, performedBy = 'system') {
  if (!leadId) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/lead_activity`, {
      method: 'POST',
      headers: sbHeaders(SUPABASE_SERVICE_KEY, {
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      }),
      body: JSON.stringify({ lead_id: leadId, action, description, performed_by: performedBy })
    });
  } catch (e) {
    console.error('logActivity error:', e.message);
  }
}

// Find the paid vendor that should get this lead, or null if none.
// Side-effect: will geocode and persist lat/lng for any vendor that
// doesn't have them yet (self-healing).
async function pickPaidVendor(SUPABASE_URL, SUPABASE_SERVICE_KEY, leadLat, leadLng, careType) {
  // 1. Get all active paid memberships joined with vendor details.
  const memRes = await fetch(
    `${SUPABASE_URL}/rest/v1/vendor_memberships?plan_status=eq.active&select=vendor_id,plan_name,leads_per_month,vendors(id,business_name,email,city,state,zip_code,latitude,longitude,service_radius_miles,rating,care_types,status)`,
    { headers: sbHeaders(SUPABASE_SERVICE_KEY) }
  );
  if (!memRes.ok) return { vendor: null, reason: 'membership query failed' };
  const memberships = await memRes.json();

  // 2. Prepare candidate list.
  const candidates = [];
  for (const m of memberships) {
    const v = m.vendors;
    if (!v) continue;
    if (v.status && v.status !== 'active') continue;

    // If care type matters, skip vendors that don't offer it.
    if (careType && Array.isArray(v.care_types) && v.care_types.length > 0) {
      if (!v.care_types.includes(careType)) continue;
    }

    // Ensure vendor has lat/lng; geocode on-demand if not.
    let lat = v.latitude ? parseFloat(v.latitude) : null;
    let lng = v.longitude ? parseFloat(v.longitude) : null;
    if ((!lat || !lng) && v.zip_code) {
      const geo = await geocodeZip(v.zip_code);
      if (geo) {
        lat = geo.lat; lng = geo.lng;
        // Persist so we don't have to geocode again next time.
        await fetch(`${SUPABASE_URL}/rest/v1/vendors?id=eq.${v.id}`, {
          method: 'PATCH',
          headers: sbHeaders(SUPABASE_SERVICE_KEY, {
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          }),
          body: JSON.stringify({ latitude: lat, longitude: lng })
        }).catch(() => {});
      }
    }
    if (!lat || !lng) continue;

    const radius = v.service_radius_miles || 25;
    const dist = distanceMiles(leadLat, leadLng, lat, lng);
    if (dist > radius) continue;

    candidates.push({
      vendor_id: v.id,
      business_name: v.business_name,
      plan_name: m.plan_name,
      plan_rank: PLAN_RANK[m.plan_name] || 0,
      distance: dist,
      rating: v.rating || 0
    });
  }

  if (candidates.length === 0) {
    return { vendor: null, reason: 'no paid vendor within radius' };
  }

  // 3. Sort by plan rank DESC (premium first), then by leads assigned this
  //    month ASC (round-robin within tier), then rating DESC as tiebreak.
  // Count leads this month per candidate vendor.
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartISO = monthStart.toISOString();

  const vendorIds = candidates.map(c => c.vendor_id);
  const countRes = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?vendor_id=in.(${vendorIds.join(',')})&received_at=gte.${monthStartISO}&select=vendor_id`,
    { headers: sbHeaders(SUPABASE_SERVICE_KEY) }
  );
  const monthLeads = countRes.ok ? await countRes.json() : [];
  const leadCountByVendor = {};
  for (const row of monthLeads) {
    leadCountByVendor[row.vendor_id] = (leadCountByVendor[row.vendor_id] || 0) + 1;
  }

  candidates.sort((a, b) => {
    if (a.plan_rank !== b.plan_rank) return b.plan_rank - a.plan_rank;
    const ac = leadCountByVendor[a.vendor_id] || 0;
    const bc = leadCountByVendor[b.vendor_id] || 0;
    if (ac !== bc) return ac - bc;
    return b.rating - a.rating;
  });

  const winner = candidates[0];
  return {
    vendor: winner,
    reason: `auto-assigned: ${winner.plan_name} plan, ${winner.distance.toFixed(1)}mi away, ` +
            `${leadCountByVendor[winner.vendor_id] || 0} leads this month`
  };
}

// When no paid vendor matches, email top-rated unpaid vendors in the same
// ZIP (by exact match first, then city/state) and record in vendor_prospect_emails.
async function emailProspectVendors(SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, lead, service_zip, careType) {
  if (!RESEND_API_KEY) return 0;

  // Gather vendors in the same ZIP who are NOT already paid members.
  // First, look up paid vendor IDs so we exclude them.
  const paidRes = await fetch(
    `${SUPABASE_URL}/rest/v1/vendor_memberships?plan_status=eq.active&select=vendor_id`,
    { headers: sbHeaders(SUPABASE_SERVICE_KEY) }
  );
  const paidIds = paidRes.ok ? (await paidRes.json()).map(r => r.vendor_id) : [];

  // Query vendors by ZIP first, then by city/state if needed.
  const zipFilter = service_zip ? `zip_code=eq.${service_zip}` : '';
  const byZip = await fetch(
    `${SUPABASE_URL}/rest/v1/vendors?${zipFilter}&select=id,business_name,email,rating,care_types,status&order=rating.desc&limit=10`,
    { headers: sbHeaders(SUPABASE_SERVICE_KEY) }
  );
  let pool = byZip.ok ? await byZip.json() : [];

  // Filter: active, has email, not already paid, matches care type if possible.
  pool = pool.filter(v => {
    if (v.status && v.status !== 'active') return false;
    if (!v.email) return false;
    if (paidIds.includes(v.id)) return false;
    if (careType && Array.isArray(v.care_types) && v.care_types.length > 0 && !v.care_types.includes(careType)) return false;
    return true;
  }).slice(0, 3); // top 3 by rating

  if (pool.length === 0) return 0;

  const careHuman = (careType || 'senior living care').replace(/_/g, ' ');
  let sentCount = 0;

  for (const v of pool) {
    const subject = `You have a new lead waiting — a family near ZIP ${service_zip} is looking for ${careHuman}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#0D9488;padding:28px;text-align:center;border-radius:12px 12px 0 0">
          <h1 style="color:#fff;margin:0;font-size:24px">A lead is waiting for ${v.business_name}</h1>
        </div>
        <div style="padding:28px;background:#fff;border:1px solid #E5E7EB;border-top:none;border-radius:0 0 12px 12px">
          <p>Hi ${v.business_name},</p>
          <p>We just received a new inquiry from a family near <strong>ZIP ${service_zip}</strong>
             who is looking for <strong>${careHuman}</strong>. Your agency matches what they need.</p>
          <p>Families who find care through Senova are pre-qualified and actively looking — this isn't cold outreach.</p>
          <p style="background:#F0FDF4;padding:16px;border-left:4px solid #16A34A;border-radius:4px">
            <strong>Want to receive this lead (and others like it)?</strong><br>
            Sign up as a provider on Senova and we'll send it to you right away.
          </p>
          <p style="text-align:center;margin:28px 0">
            <a href="https://senova.info/signup"
               style="background:#0D9488;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600">
              Sign up on Senova.info
            </a>
          </p>
          <p style="color:#6B7280;font-size:13px">
            This is a one-time invitation. Reply to this email if you'd like us to stop sending these.
          </p>
        </div>
      </div>`;

    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_API_KEY}`
        },
        body: JSON.stringify({
          from: 'Senova <leads@senova.info>',
          to: [v.email],
          subject,
          html
        })
      });
      if (r.ok) {
        sentCount += 1;
        // Log so we don't double-email this vendor for this same lead.
        await fetch(`${SUPABASE_URL}/rest/v1/vendor_prospect_emails`, {
          method: 'POST',
          headers: sbHeaders(SUPABASE_SERVICE_KEY, {
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          }),
          body: JSON.stringify({
            vendor_id: v.id,
            lead_id: lead.id,
            email: v.email,
            service_zip,
            care_type: careType
          })
        }).catch(() => {});
      }
    } catch (_) { /* best effort */ }
  }

  return sentCount;
}

// ---------- main handler ----------

const { applyCors, isEmail, isZip, bounded } = require('../lib/security');
const { rateLimit } = require('../lib/ratelimit');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';

module.exports = async (req, res) => {
  if (applyCors(req, res, 'POST, OPTIONS')) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  // 5 signups per IP per 10 minutes - prevents account-creation flooding.
  if (rateLimit(req, 'user-signup', 5, 600_000)) {
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
    const first_name = bounded(body.first_name, 80);
    const last_name = bounded(body.last_name, 80);
    const phone = bounded(body.phone, 30);
    const street_address = bounded(body.street_address, 200);
    const city = bounded(body.city, 100);
    const state = bounded(body.state, 80);
    const zip_code = bounded(body.zip_code, 10);
    const service_zip = bounded(body.service_zip, 10);
    const care_for = bounded(body.care_for, 80);
    const care_types = Array.isArray(body.care_types) ? body.care_types.slice(0, 20) : [];

    if (!email || !isEmail(email)) {
      return res.status(400).json({ error: 'A valid email is required' });
    }
    if (!password || password.length < 8 || password.length > 200) {
      return res.status(400).json({ error: 'Password must be 8-200 characters' });
    }
    if (!first_name || !last_name) {
      return res.status(400).json({ error: 'First and last name are required' });
    }
    if (zip_code && !isZip(zip_code)) {
      return res.status(400).json({ error: 'Invalid zip code' });
    }
    if (service_zip && !isZip(service_zip)) {
      return res.status(400).json({ error: 'Invalid service zip' });
    }

    // Primary care type for matching. If none given, fall back to first entry in array.
    const primaryCareType = (Array.isArray(care_types) && care_types[0]) || null;

    // Use the provided service ZIP or fall back to the user's own ZIP.
    const effectiveServiceZip = (service_zip || zip_code || '').trim();

    // 1. Create Supabase auth user.
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: sbHeaders(SUPABASE_SERVICE_KEY, { 'Content-Type': 'application/json' }),
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

    // 2. Create user record.
    const userRes = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
      method: 'POST',
      headers: sbHeaders(SUPABASE_SERVICE_KEY, {
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      }),
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
        service_zip: effectiveServiceZip || null,
        care_for: care_for || 'other',
        care_types: care_types || []
      })
    });
    if (!userRes.ok) {
      const errTxt = await userRes.text();
      console.error('User insert failed:', errTxt);
      return res.status(500).json({ error: 'Failed to create user profile. Database tables may not be set up yet.' });
    }
    const userBody = await userRes.json();
    const user = userBody[0];

    // 3. Link auth (best effort).
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/user_auth`, {
        method: 'POST',
        headers: sbHeaders(SUPABASE_SERVICE_KEY, {
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        }),
        body: JSON.stringify({ auth_user_id: authUser.id, user_id: user.id, email })
      });
    } catch (_) { /* best effort */ }

    // 4. Create a lead for this user.
    // We geocode the service ZIP first so the lead record has lat/lng for audit.
    const leadGeo = effectiveServiceZip ? await geocodeZip(effectiveServiceZip) : null;

    const leadRes = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
      method: 'POST',
      headers: sbHeaders(SUPABASE_SERVICE_KEY, {
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      }),
      body: JSON.stringify({
        user_id: user.id,
        first_name, last_name, email,
        phone: phone || '',
        mailing_address: street_address || null,
        city: city || null,
        state: state || null,
        zip_code: zip_code || null,
        service_zip: effectiveServiceZip || null,
        service_latitude: leadGeo ? leadGeo.lat : null,
        service_longitude: leadGeo ? leadGeo.lng : null,
        care_for: care_for || null,
        care_type: primaryCareType,
        status: 'new'
      })
    });
    const leadBody = leadRes.ok ? await leadRes.json() : [];
    const lead = leadBody[0] || null;

    // Log: lead was received.
    if (lead) {
      await logActivity(
        SUPABASE_URL, SUPABASE_SERVICE_KEY, lead.id,
        'lead_received',
        `Lead created from user signup. Care for: ${care_for || 'N/A'}. Care type: ${primaryCareType || 'N/A'}. Service ZIP: ${effectiveServiceZip || 'N/A'}.`,
        'system'
      );
    }

    // 5. Auto-assign the lead to a paid vendor (if possible).
    let assigned = null;
    let assignmentReason = 'no service_zip provided';
    let prospectEmails = 0;

    if (lead && leadGeo) {
      const pick = await pickPaidVendor(
        SUPABASE_URL, SUPABASE_SERVICE_KEY,
        leadGeo.lat, leadGeo.lng, primaryCareType
      );

      if (pick.vendor) {
        assigned = pick.vendor;
        assignmentReason = pick.reason;
        // Patch the lead with the assignment.
        await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${lead.id}`, {
          method: 'PATCH',
          headers: sbHeaders(SUPABASE_SERVICE_KEY, {
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          }),
          body: JSON.stringify({
            vendor_id: pick.vendor.vendor_id,
            vendor_assigned: pick.vendor.business_name,
            sent_to_vendor_at: new Date().toISOString(),
            auto_assigned: true,
            assignment_reason: pick.reason,
            status: 'assigned'
          })
        });
        await logActivity(
          SUPABASE_URL, SUPABASE_SERVICE_KEY, lead.id,
          'auto_assigned',
          `Auto-assigned to ${pick.vendor.business_name} (${pick.vendor.plan_name} plan, ${pick.vendor.distance.toFixed(1)}mi away).`,
          'system'
        );
      } else {
        assignmentReason = pick.reason || 'no paid vendor in radius';
        // No paid match — try to invite prospect vendors.
        prospectEmails = await emailProspectVendors(
          SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY,
          lead, effectiveServiceZip, primaryCareType
        );
        // Mark the lead so admin can see the system tried.
        await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${lead.id}`, {
          method: 'PATCH',
          headers: sbHeaders(SUPABASE_SERVICE_KEY, {
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          }),
          body: JSON.stringify({
            auto_assigned: false,
            assignment_reason: `${pick.reason}; ${prospectEmails} prospect email(s) sent`,
            status: 'awaiting_vendor'
          })
        });
        await logActivity(
          SUPABASE_URL, SUPABASE_SERVICE_KEY, lead.id,
          'no_match',
          `No paid vendor within radius. ${prospectEmails} prospect vendor(s) emailed with an invitation to sign up.`,
          'system'
        );
      }
    }

    // 6. Admin notification.
    try {
      const notifTitle = assigned
        ? `Lead auto-assigned to ${assigned.business_name}`
        : `Unassigned lead: ${first_name} ${last_name}`;
      const notifMsg = assigned
        ? `${first_name} from ${city || ''}, ${state || ''} — ZIP ${effectiveServiceZip}. ` +
          `Auto-assigned to ${assigned.business_name} (${assignmentReason}).`
        : `${first_name} from ${city || ''}, ${state || ''} — ZIP ${effectiveServiceZip}. ` +
          `No paid vendor matched. ${prospectEmails} prospect vendor(s) emailed. Reason: ${assignmentReason}.`;
      await fetch(`${SUPABASE_URL}/rest/v1/admin_notifications`, {
        method: 'POST',
        headers: sbHeaders(SUPABASE_SERVICE_KEY, {
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        }),
        body: JSON.stringify({
          type: 'new_user',
          title: notifTitle,
          message: notifMsg,
          reference_id: lead ? lead.id : user.id,
          reference_type: lead ? 'lead' : 'user'
        })
      });
    } catch (_) { /* best effort */ }

    // 7. Schedule 3-month survey.
    try {
      const surveyDate = new Date();
      surveyDate.setMonth(surveyDate.getMonth() + 3);
      await fetch(`${SUPABASE_URL}/rest/v1/user_surveys`, {
        method: 'POST',
        headers: sbHeaders(SUPABASE_SERVICE_KEY, {
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        }),
        body: JSON.stringify({
          user_id: user.id,
          lead_id: lead ? lead.id : null,
          vendor_id: assigned ? assigned.vendor_id : null,
          survey_type: '3_month',
          status: 'pending',
          scheduled_for: surveyDate.toISOString()
        })
      });
    } catch (_) { /* best effort */ }

    // 8. Welcome email to user.
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
                <p>Thank you for signing up. ${assigned
                  ? `We've matched you with <strong>${assigned.business_name}</strong>, a trusted provider in your area. They'll reach out to you shortly.`
                  : `We're reaching out to local providers in your area to connect you with the right fit. You'll hear back soon.`
                }</p>
                <p>While you wait, you can explore other providers:</p>
                <p style="text-align:center;margin:32px 0">
                  <a href="https://senova.info/search" style="background:#0D9488;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600">Browse Providers</a>
                </p>
                <p>— The Senova Team</p>
              </div>
            </div>`
          })
        });
      } catch (_) { /* best effort */ }

      // Admin alert email. Inputs are HTML-escaped before interpolation.
      const esc = (v) => v == null ? '' : String(v).replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
      }[c]));
      if (ADMIN_EMAIL) {
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
              subject: assigned
                ? `Lead auto-assigned: ${first_name} ${last_name} → ${assigned.business_name}`
                : `Unassigned lead: ${first_name} ${last_name}`,
              html: `<h2>${assigned ? 'Lead auto-assigned' : 'Lead awaiting vendor'}</h2>
                <p><strong>${esc(first_name)} ${esc(last_name)}</strong></p>
                <p>Email: ${esc(email)}<br>Phone: ${esc(phone) || 'N/A'}<br>
                Service ZIP: ${esc(effectiveServiceZip)}<br>
                Care type: ${esc(primaryCareType) || 'N/A'}</p>
                <p><strong>Routing:</strong> ${esc(assignmentReason)}</p>
                ${!assigned && prospectEmails > 0 ? `<p>Sent invitation emails to ${prospectEmails} prospect vendor(s) in this ZIP.</p>` : ''}
                <p><a href="https://senova.info/admin">View in Admin Dashboard</a></p>`
            })
          });
        } catch (_) { /* best effort */ }
      }
    }

    res.status(200).json({
      success: true,
      user_id: user.id,
      lead_id: lead ? lead.id : null,
      auto_assigned_to: assigned ? assigned.business_name : null,
      assignment_reason: assignmentReason,
      prospect_emails_sent: prospectEmails
    });
  } catch (error) {
    console.error('user-signup error:', error);
    res.status(500).json({ error: error.message });
  }
};
