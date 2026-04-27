// POST /api/create-checkout — creates a Stripe Checkout session for a vendor.
//
// SECURITY:
//   * Requires the caller to present a valid Supabase session token.
//   * Verifies that token's user is linked (via vendor_auth) to the
//     vendor_id they're paying for. Without this an attacker could open
//     subscriptions billed against someone else's vendor account.
//   * plan_name validated against an explicit whitelist.
const { applyCors, verifyAuthenticated, isUuid } = require('../lib/security');

const ALLOWED_PLANS = new Set(['starter', 'growth', 'premium']);

module.exports = async (req, res) => {
  if (applyCors(req, res, 'POST, OPTIONS')) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const BASE_URL = process.env.BASE_URL || 'https://senova.info';

  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe not configured' });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const authedUser = await verifyAuthenticated(req);
  if (!authedUser) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const body = req.body || {};
    const vendor_id = body.vendor_id;
    const plan_name = body.plan_name;

    if (!isUuid(vendor_id)) return res.status(400).json({ error: 'vendor_id must be a UUID' });
    if (!ALLOWED_PLANS.has(plan_name)) return res.status(400).json({ error: 'Invalid plan_name' });

    const linkUrl = SUPABASE_URL + '/rest/v1/vendor_auth?auth_user_id=eq.'
      + encodeURIComponent(authedUser.id) + '&vendor_id=eq.'
      + encodeURIComponent(vendor_id) + '&select=vendor_id';
    const linkRes = await fetch(linkUrl, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY
      }
    });
    const link = linkRes.ok ? await linkRes.json() : [];
    if (!link.length) return res.status(403).json({ error: 'Not allowed for this vendor' });

    const PRICE_MAP = {
      starter: process.env.STRIPE_STARTER_PRICE_ID,
      growth: process.env.STRIPE_GROWTH_PRICE_ID,
      premium: process.env.STRIPE_PREMIUM_PRICE_ID
    };
    const price_id = PRICE_MAP[plan_name];
    if (!price_id) return res.status(400).json({ error: 'Plan not configured' });

    let vendorEmail = '';
    const vRes = await fetch(
      SUPABASE_URL + '/rest/v1/vendors?id=eq.' + encodeURIComponent(vendor_id)
        + '&select=email,business_name',
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY
        }
      }
    );
    const vendors = vRes.ok ? await vRes.json() : [];
    if (vendors[0]) vendorEmail = vendors[0].email || '';

    const stripe = require('stripe')(STRIPE_SECRET_KEY);
    const sessionParams = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: price_id, quantity: 1 }],
      success_url: BASE_URL + '/vendor_portal.html?checkout=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: BASE_URL + '/lead_plans.html?checkout=cancelled',
      metadata: { vendor_id: vendor_id, plan_name: plan_name },
      subscription_data: { metadata: { vendor_id: vendor_id, plan_name: plan_name } }
    };
    if (vendorEmail) sessionParams.customer_email = vendorEmail;

    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.status(200).json({ url: session.url, session_id: session.id });
  } catch (error) {
    console.error('create-checkout error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
};
