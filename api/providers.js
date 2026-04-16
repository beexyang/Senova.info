// api/providers.js — Fast provider search from Supabase (replaces slow CMS calls)
// Returns results in ~50-200ms instead of 30-60 seconds

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Database not configured' });
  }

  const { state, zip, type, page = 1, limit = 10 } = req.query;

  if (!state && !zip) {
    return res.status(400).json({ error: 'Provide state or zip parameter' });
  }

  try {
    const pageNum = parseInt(page) || 1;
    const limitNum = Math.min(parseInt(limit) || 10, 50);
    const offset = (pageNum - 1) * limitNum;

    // Build Supabase filter query
    let filters = [];
    let queryState = state;

    // If ZIP provided, derive state from it (or use provided state)
    if (zip && zip.length === 5) {
      // Filter by ZIP prefix (first 3 digits) for nearby results
      const prefix = zip.substring(0, 3);
      filters.push('zip_code=like.' + prefix + '*');
    }

    if (queryState) {
      filters.push('state=eq.' + queryState);
    }

    if (type && type !== 'all') {
      filters.push('provider_type=eq.' + type);
    }

    // Build the Supabase REST URL
    let url = SUPABASE_URL + '/rest/v1/providers?select=*';

    // Add filters
    for (const f of filters) {
      url += '&' + f;
    }

    // Add ordering: exact ZIP match first, then by ZIP proximity
    if (zip) {
      url += '&order=zip_code.asc';
    } else {
      url += '&order=provider_name.asc';
    }

    // First: get total count
    const countResp = await fetch(url, {
      method: 'HEAD',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Prefer': 'count=exact'
      }
    });

    const totalCount = parseInt(countResp.headers.get('content-range')?.split('/')[1]) || 0;

    // Then: get paginated results
    const dataUrl = url + '&offset=' + offset + '&limit=' + limitNum;

    const dataResp = await fetch(dataUrl, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Prefer': 'count=exact'
      }
    });

    if (!dataResp.ok) {
      const errText = await dataResp.text();
      return res.status(500).json({ error: 'Database query failed: ' + errText });
    }

    const providers = await dataResp.json();

    // Sort: exact ZIP match first, then same prefix, then by distance
    if (zip) {
      const prefix = zip.substring(0, 3);
      providers.sort((a, b) => {
        const aZip = a.zip_code || '';
        const bZip = b.zip_code || '';
        if (aZip === zip && bZip !== zip) return -1;
        if (bZip === zip && aZip !== zip) return 1;
        const aP = aZip.substring(0, 3) === prefix;
        const bP = bZip.substring(0, 3) === prefix;
        if (aP && !bP) return -1;
        if (bP && !aP) return 1;
        return Math.abs(parseInt(aZip) - parseInt(zip)) - Math.abs(parseInt(bZip) - parseInt(zip));
      });
    }

    // Map to frontend-expected format
    const mapped = providers.map(p => ({
      provider_name: p.provider_name,
      facility_name: p.provider_name,
      address: p.address,
      address_line_1: p.address,
      citytown: p.city,
      city_town: p.city,
      state: p.state,
      zip_code: p.zip_code,
      telephone_number: p.telephone,
      type_of_ownership: p.ownership_type,
      ownership_type: p.ownership_type,
      quality_of_patient_care_star_rating: p.quality_rating,
      certification_date: p.certification_date,
      cms_certification_number_ccn: p.ccn,
      provider_type: p.provider_type,
      offers_nursing_care_services: p.offers_nursing ? 'Yes' : 'No',
      offers_physical_therapy_services: p.offers_pt ? 'Yes' : 'No',
      offers_occupational_therapy_services: p.offers_ot ? 'Yes' : 'No',
      offers_speech_pathology_services: p.offers_speech ? 'Yes' : 'No',
      offers_medical_social_services: p.offers_medical_social ? 'Yes' : 'No',
      offers_home_health_aide_services: p.offers_aide ? 'Yes' : 'No',
      _type: p.provider_type
    }));

    // Cache for 5 minutes
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

    return res.status(200).json({
      providers: mapped,
      total: totalCount,
      page: pageNum,
      limit: limitNum,
      cached: true,
      source: 'supabase'
    });

  } catch (err) {
    console.error('Provider query error:', err);
    return res.status(500).json({ error: err.message });
  }
}
