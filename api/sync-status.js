// ============================================
// SENOVA API: /api/sync-status
// Returns when data was last synced (for "Data as of" display)
// ============================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, s-maxage=3600'
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      res.writeHead(500, CORS_HEADERS);
      res.end(JSON.stringify({ error: 'Server configuration error' }));
      return;
    }

    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/sync_log?status=eq.completed&order=completed_at.desc&limit=5`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );

    if (!resp.ok) {
      res.writeHead(200, CORS_HEADERS);
      res.end(JSON.stringify({ syncs: [], message: 'No sync data available yet' }));
      return;
    }

    const data = await resp.json();
    res.writeHead(200, CORS_HEADERS);
    res.end(JSON.stringify({ syncs: data }));

  } catch (err) {
    res.writeHead(500, CORS_HEADERS);
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
