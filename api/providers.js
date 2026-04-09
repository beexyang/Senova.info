// ============================================
// SENOVA API: /api/providers
// Secure serverless endpoint — queries cached Supabase data
// NO API KEYS IN FRONTEND — all keys from env vars
// ============================================

// CORS headers for browser requests
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600'
};

// Input sanitization — prevent SQL injection and XSS
function sanitize(str) {
  if (!str) return null;
  return str
    .replace(/[<>\"\';\-\-\/\*\\]/g, '') // Strip dangerous chars
    .replace(/\s+/g, ' ')                 // Normalize whitespace
    .trim()
    .substring(0, 100);                   // Max length
}

function isValidState(s) {
  if (!s) return false;
  return /^[A-Z]{2}$/.test(s.toUpperCase());
}

function isValidZip(z) {
  if (!z) return false;
  return /^\d{5}$/.test(z);
}

function isValidType(t) {
  return ['home_health', 'hospice', 'nursing_home', 'all'].includes(t);
}

module.exports = async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // Only allow GET
  if (req.method !== 'GET') {
    res.writeHead(405, CORS_HEADERS);
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // Rate limit check (basic — Vercel handles most of this)
  // In production, use Vercel's built-in rate limiting or Upstash Redis

  try {
    // Get credentials from environment variables (NEVER hardcoded)
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      res.writeHead(500, CORS_HEADERS);
      res.end(JSON.stringify({ error: 'Server configuration error' }));
      return;
    }

    // Parse and sanitize query parameters
    const url = new URL(req.url, `http://${req.headers.host}`);
    const state = sanitize(url.searchParams.get('state'))?.toUpperCase();
    const city = sanitize(url.searchParams.get('city'));
    const zip = sanitize(url.searchParams.get('zip'));
    const type = sanitize(url.searchParams.get('type')) || 'all';
    const page = Math.max(1, Math.min(100, parseInt(url.searchParams.get('page')) || 1));
    const limit = Math.max(1, Math.min(50, parseInt(url.searchParams.get('limit')) || 20));
    const offset = (page - 1) * limit;

    // Validate inputs
    if (state && !isValidState(state)) {
      res.writeHead(400, CORS_HEADERS);
      res.end(JSON.stringify({ error: 'Invalid state code' }));
      return;
    }
    if (zip && !isValidZip(zip)) {
      res.writeHead(400, CORS_HEADERS);
      res.end(JSON.stringify({ error: 'Invalid ZIP code' }));
      return;
    }
    if (!isValidType(type)) {
      res.writeHead(400, CORS_HEADERS);
      res.end(JSON.stringify({ error: 'Invalid provider type' }));
      return;
    }

    // Must have at least one search parameter
    if (!state && !city && !zip) {
      res.writeHead(400, CORS_HEADERS);
      res.end(JSON.stringify({ error: 'Please provide state, city, or zip' }));
      return;
    }

    // Call the Supabase RPC function for optimized search
    const rpcBody = {
      p_state: state || null,
      p_city: city || null,
      p_zip: zip || null,
      p_type: type === 'all' ? null : type,
      p_limit: limit,
      p_offset: offset
    };

    const supaResp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_providers`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(rpcBody)
    });

    if (!supaResp.ok) {
      // Fallback: direct table query if RPC not yet set up
      const zip3 = zip ? zip.substring(0, 3) : null;
      let queryParts = [];
      if (state) queryParts.push(`state=eq.${state}`);
      if (city) queryParts.push(`city=ilike.${encodeURIComponent(city)}`);
      if (zip) queryParts.push(`or=(zip_code.eq.${zip},zip3.eq.${zip3})`);
      if (type !== 'all') queryParts.push(`provider_type=eq.${type}`);

      const queryString = queryParts.join('&');
      const fallbackUrl = `${SUPABASE_URL}/rest/v1/providers?${queryString}&order=star_rating.desc.nullslast,provider_name&limit=${limit}&offset=${offset}`;

      const fallbackResp = await fetch(fallbackUrl, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Prefer': 'count=exact'
        }
      });

      if (!fallbackResp.ok) {
        const errText = await fallbackResp.text();
        res.writeHead(502, CORS_HEADERS);
        res.end(JSON.stringify({ error: 'Database query failed', detail: errText.substring(0, 200) }));
        return;
      }

      const data = await fallbackResp.json();
      const totalCount = parseInt(fallbackResp.headers.get('content-range')?.split('/')[1] || '0');

      res.writeHead(200, CORS_HEADERS);
      res.end(JSON.stringify({
        providers: data,
        total: totalCount,
        page,
        limit,
        source: 'cms_gov',
        cached: true
      }));
      return;
    }

    const data = await supaResp.json();
    const totalCount = data.length > 0 ? data[0].total_count : 0;

    // Strip the total_count from individual records
    const providers = data.map(({ total_count, ...rest }) => rest);

    res.writeHead(200, CORS_HEADERS);
    res.end(JSON.stringify({
      providers,
      total: parseInt(totalCount),
      page,
      limit,
      source: 'cms_gov',
      cached: true
    }));

  } catch (err) {
    res.writeHead(500, CORS_HEADERS);
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
