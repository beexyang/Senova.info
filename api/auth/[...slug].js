// Catch-all dispatcher for /api/auth/*. Single Vercel function.
//   POST /api/auth/forgot-password
//   POST /api/auth/reset-password
//   POST /api/auth/user-signup
//   POST /api/auth/vendor-signup
const { applyCors } = require('../../lib/security');
const log = require('../../lib/log');

const ROUTES = {
  'probe-email':    async (req, res) => {
    if (req.method !== 'GET') { res.status(405).json({error:'Method not allowed'}); return; }
    const key = process.env.RESEND_API_KEY || '';
    const set = !!key;
    const prefix = key ? (key.slice(0,4) + '...' + key.slice(-3)) : null;
    let send_ok = null, send_err = null;
    if (set && req.query.send === '1' && req.query.to) {
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method:'POST',
          headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+key },
          body: JSON.stringify({ from:'Senova <hello@senova.info>', to:[req.query.to], subject:'Senova: Resend test', html:'<p>If you got this, Resend is wired up.</p>' })
        });
        send_ok = r.ok; if (!r.ok) send_err = (await r.text()).slice(0,300);
      } catch (e) { send_err = e.message; }
    }
    res.status(200).json({ resend_key_set: set, key_prefix: prefix, send_ok, send_err });
  },
  'forgot-password': require('../../lib/auth/forgot-password'),
  'reset-password':  require('../../lib/auth/reset-password'),
  'user-signup':     require('../../lib/auth/user-signup'),
  'vendor-signup':   require('../../lib/auth/vendor-signup'),
};

module.exports = async (req, res) => {
  if (applyCors(req, res, 'POST, OPTIONS')) return;
  // Vercel can expose the catch-all under different key names depending on
  // its parser version (req.query.slug vs req.query['[...slug]']). Try both.
  const slugArr = req.query.slug || req.query['...slug'] || req.query['[...slug]'] || [];
  const slug = Array.isArray(slugArr) ? slugArr.join('/') : String(slugArr);
  const handler = ROUTES[slug];
  if (!handler) return res.status(404).json({ error: 'Not found' });
  try { return await handler(req, res); }
  catch (e) { log.error('auth dispatcher err', e.message); return res.status(500).json({ error: 'Server error' }); }
};
