// api/providers.js — Fast provider search from Supabase.
// SECURITY: anon key (read-only) + strict input validation + tight CORS.
const { applyCors, isUsState, isZip, isProviderType } = require('../lib/security');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

module.exports = async function handler(req, res) {
  if (applyCors(req, res, 'GET, OPTIONS')) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const { state, zip, type } = req.query;
  const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const offset = (pageNum - 1) * limitNum;

  if (!state && !zip) return res.status(400).json({ error: 'Provide state or zip' });
  if (state && !isUsState(state)) return res.status(400).json({ error: 'Invalid state' });
  if (zip && !isZip(zip)) return res.status(400).json({ error: 'Invalid zip' });
  if (type && type !== 'all' && !isProviderType(type)) {
    return res.status(400).json({ error: 'Invalid provider type' });
  }

  try {
    // Rehab & mental health live in the dedicated rehab_providers table
    // (loaded from SAMHSA's FindTreatment.gov national directory). Everything
    // else (home_health / hospice / 'all') still hits the legacy providers table.
    const isRehabType = type === 'drug_rehab' || type === 'mental_health';
    const tableName  = isRehabType ? 'rehab_providers' : 'providers';

    const filters = [];
    if (zip) {
      const prefix = zip.substring(0, 3);
      filters.push('zip_code=like.' + encodeURIComponent(prefix + '*'));
    }
    if (state) filters.push('state=eq.' + encodeURIComponent(state.toUpperCase()));

    if (isRehabType) {
      // rehab_providers uses `category` ∈ {substance_use, mental_health}
      const cat = type === 'mental_health' ? 'mental_health' : 'substance_use';
      filters.push('category=eq.' + encodeURIComponent(cat));
    } else if (type && type !== 'all') {
      filters.push('provider_type=eq.' + encodeURIComponent(type));
    }

    let url = SUPABASE_URL + '/rest/v1/' + tableName + '?select=*';
    for (const f of filters) url += '&' + f;
    if (isRehabType) {
      url += zip ? '&order=zip_code.asc' : '&order=facility_name.asc';
    } else {
      url += zip ? '&order=zip_code.asc' : '&order=provider_name.asc';
    }

    const headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Prefer': 'count=exact'
    };

    const countResp = await fetch(url, { method: 'HEAD', headers: headers });
    const range = countResp.headers.get('content-range') || '';
    const totalCount = parseInt(range.split('/')[1]) || 0;

    const dataResp = await fetch(url + '&offset=' + offset + '&limit=' + limitNum, { headers: headers });
    if (!dataResp.ok) {
      const errText = await dataResp.text();
      console.error('providers query failed:', dataResp.status, errText);
      return res.status(502).json({ error: 'Upstream database query failed' });
    }
    const providers = await dataResp.json();

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

    let mapped;
    if (isRehabType) {
      // Map rehab_providers rows into the same shape the frontend renders.
      mapped = providers.map(p => {
        const ptype = p.category === 'mental_health' ? 'mental_health' : 'drug_rehab';
        const street = [p.street1, p.street2].filter(Boolean).join(' ').trim();
        return {
          provider_name: p.facility_name,
          facility_name: p.facility_name,
          address: street,
          address_line_1: street,
          citytown: p.city,
          city_town: p.city,
          state: p.state,
          zip_code: p.zip_code,
          telephone_number: p.phone || p.intake_phone || '',
          type_of_ownership: