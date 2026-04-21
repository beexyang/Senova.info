// POST /api/create-checkout
// Creates a Stripe Checkout session for a vendor to subscribe to a lead plan
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const BASE_URL = process.env.BASE_URL || 'https://senova.info';

  if (!STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  try {
    const { vendor_id, price_id, plan_name } = req.body;

    if (!vendor_id || !price_id || !plan_name) {
      return res.status(400).json({ error: 'vendor_id, price_id, and plan_name are required' });
    }

    // Look up vendor info for Stripe metadata
    let vendorEmail = '';
    let vendorName = '';
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      const vRes = await fetch(
        `${SUPABASE_URL}/rest/v1/vendors?id=eq.${vendor_id}&select=email,business_name`,
        {
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
          }
        }
      );
      const vendors = await vRes.json();
      if (vendors && vendors[0]) {
        vendorEmail = vendors[0].email || '';
        vendorName = vendors[0].business_name || '';
      }
    }

    // Create Stripe Checkout Session
    const stripe = require('stripe')(STRIPE_SECRET_KEY);

    const sessionParams = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: price_id, quantity: 1 }],
      success_url: `${BASE_URL}/vendor_portal.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/lead_plans.html?checkout=cancelled`,
      metadata: {
        vendor_id,
        plan_name
      },
      subscription_data: {
        metadata: {
          vendor_id,
          plan_name
        }
      }
    };

    // Pre-fill email if we have it
    if (vendorEmail) {
      sessionParams.customer_email = vendorEmail;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    res.status(200).json({ url: session.url, session_id: session.id });
  } catch (error) {
    console.error('create-checkout error:', error);
    res.status(500).json({ error: error.message });
  }
};
