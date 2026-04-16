/**
 * Vercel Serverless Function: Save Lead
 * Endpoint: /api/save-lead
 *
 * Accepts POST requests with user lead information and saves to Supabase
 */

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    // Extract data from request body
    const { full_name, email, phone, zip_code, provider_ccn, provider_name } = req.body;

    // Validate required fields
    if (!full_name || !full_name.trim()) {
      return res.status(400).json({ success: false, message: 'Full name is required' });
    }

    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }

    // Get Supabase credentials from environment variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase environment variables');
      return res.status(500).json({
        success: false,
        message: 'Server configuration error'
      });
    }

    // Prepare the data for Supabase
    const leadData = {
      full_name: full_name.trim(),
      email: email.trim().toLowerCase(),
      phone: (phone || '').trim(),
      zip_code: (zip_code || '').trim(),
      provider_ccn: (provider_ccn || '').trim(),
      provider_name: (provider_name || '').trim(),
      created_at: new Date().toISOString(),
      source: 'auth-new-form'
    };

    // Insert into Supabase using REST API
    const supabaseRestUrl = `${supabaseUrl}/rest/v1/user_leads`;

    const supabaseResponse = await fetch(supabaseRestUrl, {
      method: 'POST',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(leadData)
    });

    // Check if Supabase request was successful
    if (!supabaseResponse.ok) {
      const errorData = await supabaseResponse.text();
      console.error('Supabase error:', supabaseResponse.status, errorData);

      // Handle specific Supabase errors
      if (supabaseResponse.status === 401 || supabaseResponse.status === 403) {
        return res.status(500).json({
          success: false,
          message: 'Authentication error with database'
        });
      }

      if (supabaseResponse.status === 400) {
        return res.status(400).json({
          success: false,
          message: 'Invalid data format'
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Failed to save lead information'
      });
    }

    // Parse the response
    const savedLead = await supabaseResponse.json();

    // Return success response
    return res.status(200).json({
      success: true,
      message: 'Lead information saved successfully',
      leadId: Array.isArray(savedLead) && savedLead.length > 0 ? savedLead[0].id : null
    });

  } catch (error) {
    console.error('Error in save-lead function:', error);

    // Return generic error (don't expose internal details)
    return res.status(500).json({
      success: false,
      message: 'An unexpected error occurred. Please try again later.'
    });
  }
}
