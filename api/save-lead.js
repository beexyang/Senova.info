// /api/save-lead — accepts a single lead form submission.
// SECURITY: tight CORS, length caps on every field, generic error messages.
const { applyCors, requireCsrfHeader, isEmail, isCcn, bounded } = require('../lib/security');
const { rateLimit } = require('../lib/ratelimit');

module.exports = async function handler(req, res) {
  if (applyCors(req, res, 'POST, OPTIONS')) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }
  if (requireCsrfHeader(req, res)) return;
  // 10 requests per IP per 60s — enough for legitimate retries, blocks flooding.
  if (rateLimit(req, 'save-lead', 10, 60_000)) {
    return res.status(429).json({ success: false, message: 'Too many requests. Please try again in a minute.' });
  }

  try {
    const body = req.body || {};
    const full_name = bounded(body.full_name, 100);
    const email = bounded(body.email, 254);
    const phone = body.phone ? bounded(body.phone, 30) : '';
    const zip_code = body.zip_code ? bounded(body.zip_code, 10) : '';
    const provider_ccn = body.provider_ccn ? bounded(body.provider_ccn, 20) : '';
    const provider_name = body.provider_name ? bounded(body.provider_name, 200) : '';

    if (!full_name) {
      return res.status(400).json({ success: false, message: 'Full name is required' });
    }
    if (!email || !isEmail(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }
    if (body.provider_ccn && !isCcn(body.provider_ccn)) {
      return res.status(400).json({ success: false, message: 'Invalid provider CCN' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase env vars');
      return res.status(500).json({ success: false, message: 'Server configuration error' });
    }

    const leadData = {
      full_name: full_name,
      email: email.toLowerCase(),
      phone: phone || '',
      zip_code: zip_code || '',
      provider_ccn: provider_ccn || '',
      provider_name: provider_name || '',
      created_at: new Date().toISOString(),
      source: 'auth-new-form'
    };

    const supabaseRestUrl = supabaseUrl + '/rest/v1/user_leads';
    const supabaseResponse = await fetch(supabaseRestUrl, {
      method: 'POST',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': 'Bearer ' + supabaseServiceKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(leadData)
    });

    if (!supabaseResponse.ok) {
      const errorData = await supabaseResponse.text();
      console.error('save-lead Supabase error:', supabaseResponse.status, errorData);
      return res.status(502).json({
        success: false,
        message: 'Failed to save lead information. Please try again.'
      });
    }

    const savedLead = await supabaseResponse.json();
    return res.status(200).json({
      success: true,
      message: 'Lead information saved successfully',
      leadId: Array.isArray(savedLead) && savedLead.length > 0 ? savedLead[0].id : null
    });
  } catch (error) {
    console.error('Error in save-lead function:', error);
    return res.status(500).json({
      success: false,
      message: 'An unexpected error occurred. Please try again later.'
    });
  }
};
