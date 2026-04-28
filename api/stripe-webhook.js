// POST /api/stripe-webhook
// Handles Stripe webhook events to activate/deactivate vendor memberships
// Stripe sends: checkout.session.completed, invoice.paid, invoice.payment_failed,
//               customer.subscription.updated, customer.subscription.deleted

const getRawBody = require('raw-body');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    return res.status(500).json({ error: 'Stripe webhook not configured' });
  }
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

  const stripe = require('stripe')(STRIPE_SECRET_KEY);

  let event;
  try {
    // Cap body size to prevent memory abuse via spoofed proxies.
    const rawBody = await getRawBody(req, { limit: '256kb', length: req.headers['content-length'] });
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Webhook Error' });
  }

  // Idempotency: every Stripe event has a unique id; persist and short-circuit on replay.
  try {
    const seenRes = await fetch(
      `${SUPABASE_URL}/rest/v1/stripe_events?id=eq.${encodeURIComponent(event.id)}&select=id`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    if (seenRes.ok) {
      const seen = await seenRes.json();
      if (Array.isArray(seen) && seen.length > 0) {
        return res.status(200).json({ received: true, duplicate: true });
      }
    }
    await fetch(`${SUPABASE_URL}/rest/v1/stripe_events`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ id: event.id, type: event.type })
    });
  } catch (e) {
    console.error('stripe_events idempotency check failed:', e.message);
  }

  console.log('Stripe webhook received:', event.type);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const vendorId = session.metadata?.vendor_id;
        const planName = session.metadata?.plan_name;
        const subscriptionId = session.subscription;
        const customerId = session.customer;

        if (!vendorId) {
          console.error('No vendor_id in session metadata');
          break;
        }

        // Get subscription details for pricing info
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const priceAmount = sub.items.data[0]?.price?.unit_amount || 0;
        const priceMonthly = priceAmount / 100;

        // Determine leads per month based on plan
        let leadsPerMonth = 0;
        if (planName === 'starter') leadsPerMonth = 10;
        else if (planName === 'growth') leadsPerMonth = 30;
        else if (planName === 'premium') leadsPerMonth = -1; // unlimited

        // Update or insert vendor_memberships
        // First check if membership exists
        const existRes = await fetch(
          `${SUPABASE_URL}/rest/v1/vendor_memberships?vendor_id=eq.${vendorId}&select=id`,
          {
            headers: {
              'apikey': SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
            }
          }
        );
        const existing = await existRes.json();

        const membershipData = {
          vendor_id: vendorId,
          plan_name: planName,
          plan_status: 'active',
          leads_per_month: leadsPerMonth,
          price_monthly: priceMonthly,
          stripe_subscription_id: subscriptionId,
          stripe_customer_id: customerId,
          started_at: new Date().toISOString()
        };

        if (existing && existing.length > 0) {
          // Update existing
          await fetch(
            `${SUPABASE_URL}/rest/v1/vendor_memberships?vendor_id=eq.${vendorId}`,
            {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify(membershipData)
            }
          );
        } else {
          // Insert new
          await fetch(
            `${SUPABASE_URL}/rest/v1/vendor_memberships`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify(membershipData)
            }
          );
        }

        // Send admin notification
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/admin_notifications`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
              type: 'new_subscription',
              title: `New Subscription: ${planName} plan`,
              message: `Vendor ${vendorId} subscribed to the ${planName} plan at $${priceMonthly}/mo.`,
              reference_id: vendorId,
              reference_type: 'vendor'
            })
          });
        } catch (e) { console.error('notification error:', e.message); }

        // Send admin email
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
                to: [process.env.ADMIN_EMAIL].filter(Boolean),
                subject: `New Subscription: ${planName} plan - $${priceMonthly}/mo`,
                html: `<h2>New Vendor Subscription</h2>
                  <p>A vendor just subscribed to the <strong>${planName}</strong> plan.</p>
                  <p>Monthly: <strong>$${priceMonthly}</strong></p>
                  <p>Vendor ID: ${vendorId}</p>
                  <p><a href="https://senova.info/admin">View in Admin Dashboard</a></p>`
              })
            });
          } catch (e) { /* best effort */ }
        }

        console.log(`Vendor ${vendorId} subscribed to ${planName} plan`);
        break;
      }

      case 'invoice.paid': {
        // Recurring payment succeeded â keep membership active
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;

        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          const vendorId = sub.metadata?.vendor_id;

          if (vendorId) {
            await fetch(
              `${SUPABASE_URL}/rest/v1/vendor_memberships?vendor_id=eq.${vendorId}`,
              {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': SUPABASE_SERVICE_KEY,
                  'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                  'Prefer': 'return=minimal'
                },
                body: JSON.stringify({ plan_status: 'active' })
              }
            );
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        // Payment failed â mark membership as past_due
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;

        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          const vendorId = sub.metadata?.vendor_id;

          if (vendorId) {
            await fetch(
              `${SUPABASE_URL}/rest/v1/vendor_memberships?vendor_id=eq.${vendorId}`,
              {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': SUPABASE_SERVICE_KEY,
                  'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                  'Prefer': 'return=minimal'
                },
                body: JSON.stringify({ plan_status: 'past_due' })
              }
            );

            // Notify admin
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
                    to: [process.env.ADMIN_EMAIL].filter(Boolean),
                    subject: `Payment Failed: Vendor ${vendorId}`,
                    html: `<h2>Payment Failed</h2><p>Vendor ${vendorId} payment failed. Membership marked as past_due.</p>`
                  })
                });
              } catch (e) { /* best effort */ }
            }
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        // Subscription cancelled â deactivate membership
        const sub = event.data.object;
        const vendorId = sub.metadata?.vendor_id;

        if (vendorId) {
          await fetch(
            `${SUPABASE_URL}/rest/v1/vendor_memberships?vendor_id=eq.${vendorId}`,
            {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify({
                plan_status: 'inactive',
                plan_name: 'none',
                leads_per_month: 0
              })
            }
          );

          console.log(`Vendor ${vendorId} subscription cancelled`);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Vercel config: disable body parsing so we can verify the webhook signature
module.exports.config = {
  api: {
    bodyParser: false
  }
};
