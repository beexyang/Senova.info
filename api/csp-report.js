// POST /api/csp-report — receives browser CSP violation reports.
// No CORS allowlist — browsers send these as text/plain or
// application/csp-report from any page.
const log = require('../lib/log');

function clientIp(req) {
  const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(204).end(); return; }
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  let body = req.body;
  try { if (typeof body === 'string') body = JSON.parse(body); } catch (_) {}
  const r = body && body['csp-report'] ? body['csp-report'] : (body || {});
  try {
    if (SUPABASE_URL && KEY) {
      await fetch(SUPABASE_URL + '/rest/v1/csp_violations', {
        method: 'POST',
        headers: {
          apikey: KEY, Authorization: 'Bearer ' + KEY,
          'Content-Type': 'application/json', 'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          effective_directive: r['effective-directive'] || r['violated-directive'] || null,
          blocked_uri: r['blocked-uri'] || null,
          source_file: r['source-file'] || null,
          document_uri: r['document-uri'] || null,
          line_number: r['line-number'] || null,
          column_number: r['column-number'] || null,
          user_agent: (req.headers['user-agent'] || '').slice(0, 500),
          ip: clientIp(req),
          raw: r
        })
      });
    }
  } catch (e) { log.warn('csp-report write failed', e.message); }
  res.status(204).end();
};
