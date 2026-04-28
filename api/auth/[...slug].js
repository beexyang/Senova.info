// Catch-all dispatcher for /api/auth/*. Single Vercel function.
//   POST /api/auth/forgot-password
//   POST /api/auth/reset-password
//   POST /api/auth/user-signup
//   POST /api/auth/vendor-signup
const { applyCors } = require('../../lib/security');
const log = require('../../lib/log');

const ROUTES = {
  'list-domains':   async (req, res) => {
    const key = process.env.RESEND_API_KEY || '';
    if (!key) { res.status(200).json({ error:'no key' }); return; }
    const r = await fetch('https://api.resend.com/domains', {
      headers: { 'Authorization': 'Bearer ' + key }
    });
    res.status(200).json({ status: r.status, body: await r.json().catch(()=>({})) });
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
