// SENOVA API: /api/sync-status — last sync timestamp display.
// SECURITY: tight CORS, no error-detail leakage.
const { applyCors } = require('../lib/security');

module.exports = async function handler(req, res) {
  if (applyCors(req, res, 'GET, OPTIONS')) return;
  res.setHeader('Cache-Control', 'public, s-maxage=3600');
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') return res.status(405).end(JSON.stringify({ error: 'Method not allowed' }));

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return res.status(500).end(JSON.stringify({ error: 'Server misconfigured' }));
    }

    const resp = await fetch(
      SUPABASE_URL + '/rest/v1/sync_log?status=eq.completed&order=completed_at.desc&limit=5',
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
        }
      }
    );
    if (!resp.ok) {
      console.error('sync-status upstream error:', resp.status);
      return res.status(200).end(JSON.stringify({ syncs: [], message: 'No sync data available yet' }));
    }
    const data = await resp.json();
    return res.status(200).end(JSON.stringify({ syncs: data }));
  } catch (err) {
    console.error('sync-status error:', err);
    return res.status(500).end(JSON.stringify({ error: 'Server error' }));
  }
};
