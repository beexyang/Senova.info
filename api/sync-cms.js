// api/sync-cms.js — Pulls ALL provider data from CMS.gov into Supabase
// Triggered manually or via monthly cron
// Usage: GET /api/sync-cms?secret=YOUR_SECRET

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const CMS_DATASETS = {
  home_health: 'https://data.cms.gov/provider-data/api/1/datastore/query/6jpm-sxkc/0',
  hospice: 'https://data.cms.gov/provider-data/api/1/datastore/query/yc9t-dgbk/0'
};

const BATCH_SIZE = 500; // CMS API max per request
const UPSERT_BATCH = 200; // Supabase upsert batch size

async function supabaseRequest(path, options = {}) {
  const url = SUPABASE_URL + '/rest/v1' + path;
  const resp = await fetch(url, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=minimal',
      ...options.headers
    }
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error('Supabase error ' + resp.status + ': ' + text);
  }
  return resp;
}

function mapHomeHealth(r) {
  return {
    ccn: r.cms_certification_number_ccn || '',
    provider_name: r.provider_name || '',
    provider_type: 'home_health',
    address: r.address || r.address_line_1 || '',
    city: r.citytown || '',
    state: r.state || '',
    zip_code: r.zip_code || '',
    telephone: r.telephone_number || '',
    ownership_type: r.type_of_ownership || '',
    quality_rating: parseFloat(r.quality_of_patient_care_star_rating) || null,
    certification_date: r.certification_date || '',
    offers_nursing: r.offers_nursing_care_services === 'Yes',
    offers_pt: r.offers_physical_therapy_services === 'Yes',
    offers_ot: r.offers_occupational_therapy_services === 'Yes',
    offers_speech: r.offers_speech_pathology_services === 'Yes',
    offers_medical_social: r.offers_medical_social_services === 'Yes',
    offers_aide: r.offers_home_health_aide_services === 'Yes',
    raw_data: r,
    synced_at: new Date().toISOString()
  };
}

function mapHospice(r) {
  return {
    ccn: r.cms_certification_number_ccn || r.ccn || '',
    provider_name: r.facility_name || r.provider_name || '',
    provider_type: 'hospice',
    address: r.address_line_1 || r.address || '',
    city: r.city_town || r.citytown || '',
    state: r.state || '',
    zip_code: r.zip_code || '',
    telephone: r.telephone_number || r.phone_number || '',
    ownership_type: r.ownership_type || r.type_of_ownership || '',
    quality_rating: null,
    certification_date: r.certification_date || '',
    offers_nursing: false,
    offers_pt: false,
    offers_ot: false,
    offers_speech: false,
    offers_medical_social: false,
    offers_aide: false,
    raw_data: r,
    synced_at: new Date().toISOString()
  };
}

async function fetchAllFromCMS(datasetUrl, datasetType) {
  const allRecords = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const url = datasetUrl + '?limit=' + BATCH_SIZE + '&offset=' + offset;
    console.log('Fetching ' + datasetType + ' offset=' + offset);

    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (!resp.ok) {
      throw new Error('CMS API returned ' + resp.status + ' for ' + datasetType + ' at offset ' + offset);
    }

    const data = await resp.json();
    const results = data.results || [];
    const mapper = datasetType === 'home_health' ? mapHomeHealth : mapHospice;

    for (const r of results) {
      const mapped = mapper(r);
      if (mapped.ccn && mapped.state) {
        allRecords.push(mapped);
      }
    }

    offset += results.length;
    hasMore = results.length === BATCH_SIZE;

    // Safety: don't exceed 50k records per dataset
    if (offset >= 50000) break;
  }

  return allRecords;
}

async function upsertToSupabase(records) {
  let upserted = 0;

  for (let i = 0; i < records.length; i += UPSERT_BATCH) {
    const batch = records.slice(i, i + UPSERT_BATCH);

    await supabaseRequest('/providers', {
      method: 'POST',
      body: JSON.stringify(batch),
      prefer: 'resolution=merge-duplicates,return=minimal',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' }
    });

    upserted += batch.length;
    console.log('Upserted ' + upserted + '/' + records.length);
  }

  return upserted;
}

async function logSync(dataset, status, count, error) {
  try {
    await supabaseRequest('/sync_log', {
      method: 'POST',
      body: JSON.stringify({
        dataset: dataset,
        records_synced: count || 0,
        status: status,
        error_message: error || null,
        completed_at: status !== 'running' ? new Date().toISOString() : null
      })
    });
  } catch (e) {
    console.error('Failed to log sync:', e.message);
  }
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let m = 0;
  for (let i = 0; i < a.length; i++) m |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return m === 0;
}

export default async function handler(req, res) {
  // SECURITY: SYNC_SECRET MUST be set in the environment. The previous
  // hardcoded fallback ('senova-sync-2024') let anyone with that string
  // trigger a full database upsert.
  const expectedSecret = process.env.SYNC_SECRET;
  if (!expectedSecret) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }
  const secret = req.query.secret || req.headers['x-sync-secret'] || '';
  if (!safeEqual(String(secret), expectedSecret)) {
    return res.status(401).json({ error: 'Invalid secret' });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase environment variables not set' });
  }

  const dataset = req.query.dataset || 'all'; // 'home_health', 'hospice', or 'all'

  try {
    const results = {};

    if (dataset === 'all' || dataset === 'home_health') {
      await logSync('home_health', 'running', 0);
      console.log('Starting home_health sync...');
      const hhRecords = await fetchAllFromCMS(CMS_DATASETS.home_health, 'home_health');
      console.log('Fetched ' + hhRecords.length + ' home_health records from CMS');
      const hhUpserted = await upsertToSupabase(hhRecords);
      await logSync('home_health', 'completed', hhUpserted);
      results.home_health = { fetched: hhRecords.length, upserted: hhUpserted };
    }

    if (dataset === 'all' || dataset === 'hospice') {
      await logSync('hospice', 'running', 0);
      console.log('Starting hospice sync...');
      const hRecords = await fetchAllFromCMS(CMS_DATASETS.hospice, 'hospice');
      console.log('Fetched ' + hRecords.length + ' hospice records from CMS');
      const hUpserted = await upsertToSupabase(hRecords);
      await logSync('hospice', 'completed', hUpserted);
      results.hospice = { fetched: hRecords.length, upserted: hUpserted };
    }

    return res.status(200).json({
      success: true,
      message: 'Sync completed',
      results: results
    });

  } catch (err) {
    console.error('Sync error:', err);
    await logSync(dataset, 'error', 0, err.message);
    return res.status(500).json({ error: err.message });
  }
}
