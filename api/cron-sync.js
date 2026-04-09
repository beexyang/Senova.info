// ============================================
// SENOVA CRON: /api/cron-sync
// Automated monthly data sync from CMS.gov
// Triggered by Vercel Cron (1st of each month at 3am UTC)
// ============================================

const CMS_DATASETS = {
  home_health: {
    url: 'https://data.cms.gov/provider-data/api/1/datastore/query/6jpm-sxkc/0',
    label: 'Home Health'
  },
  hospice: {
    url: 'https://data.cms.gov/provider-data/api/1/datastore/query/yc9t-dgbk/0',
    label: 'Hospice'
  }
};

const BATCH_SIZE = 500;
const UPSERT_BATCH = 100;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseCMSDate(d) {
  if (!d || d === '-') return null;
  const p = d.split('/');
  return p.length === 3 ? `${p[2]}-${p[0].padStart(2,'0')}-${p[1].padStart(2,'0')}` : null;
}

function formatPhone(ph) {
  if (!ph) return '';
  const d = ph.replace(/\D/g, '');
  return d.length === 10 ? `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}` : ph;
}

function transformHH(r) {
  const rating = parseFloat(r.quality_of_patient_care_star_rating);
  return {
    ccn: r.cms_certification_number_ccn,
    provider_type: 'home_health', data_source: 'cms',
    provider_name: r.provider_name || 'Unknown',
    address: r.address || '', city: (r.citytown||'').toUpperCase(),
    state: (r.state||'').toUpperCase(), zip_code: r.zip_code||'',
    zip3: (r.zip_code||'').substring(0,3),
    telephone: formatPhone(r.telephone_number),
    ownership_type: r.type_of_ownership||'',
    certification_date: parseCMSDate(r.certification_date),
    star_rating: isNaN(rating) ? null : rating,
    offers_nursing: r.offers_nursing_care_services==='Yes',
    offers_physical_therapy: r.offers_physical_therapy_services==='Yes',
    offers_occupational_therapy: r.offers_occupational_therapy_services==='Yes',
    offers_speech_pathology: r.offers_speech_pathology_services==='Yes',
    offers_medical_social: r.offers_medical_social_services==='Yes',
    offers_home_health_aide: r.offers_home_health_aide_services==='Yes',
    accepts_medicare: true, accepts_medicaid: false,
    raw_data: r, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString()
  };
}

function transformHospice(r) {
  return {
    ccn: r.cms_certification_number_ccn,
    provider_type: 'hospice', data_source: 'cms',
    provider_name: r.facility_name || 'Unknown',
    address: r.address_line_1 || '', city: (r.citytown||'').toUpperCase(),
    state: (r.state||'').toUpperCase(), zip_code: r.zip_code||'',
    zip3: (r.zip_code||'').substring(0,3), county: r.countyparish||'',
    telephone: r.telephone_number||'',
    ownership_type: r.ownership_type||'',
    certification_date: parseCMSDate(r.certification_date),
    cms_region: r.cms_region||'', star_rating: null,
    offers_nursing: true, offers_physical_therapy: false,
    offers_occupational_therapy: false, offers_speech_pathology: false,
    offers_medical_social: true, offers_home_health_aide: true,
    accepts_medicare: true, accepts_medicaid: false,
    raw_data: r, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString()
  };
}

module.exports = async function handler(req, res) {
  // Verify this is a legitimate cron call (Vercel sets this header)
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing config' }));
    return;
  }

  const results = {};

  for (const [key, dataset] of Object.entries(CMS_DATASETS)) {
    try {
      // Log start
      await fetch(`${SUPABASE_URL}/rest/v1/sync_log`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ source: `cms_${key}`, status: 'running', records_fetched: 0, records_upserted: 0 })
      });

      // Fetch all from CMS
      const allRecords = [];
      let offset = 0, total = null;
      while (true) {
        const resp = await fetch(`${dataset.url}?limit=${BATCH_SIZE}&offset=${offset}`);
        if (!resp.ok) throw new Error(`CMS ${resp.status}`);
        const data = await resp.json();
        if (total === null) total = data.count || 0;
        if (!data.results || data.results.length === 0) break;
        allRecords.push(...data.results);
        offset += data.results.length;
        if (offset >= total) break;
        await sleep(200);
      }

      // Transform
      const transformFn = key === 'home_health' ? transformHH : transformHospice;
      const transformed = allRecords.map(transformFn).filter(r => r.ccn && r.state);

      // Upsert in batches
      let upserted = 0;
      for (let i = 0; i < transformed.length; i += UPSERT_BATCH) {
        const batch = transformed.slice(i, i + UPSERT_BATCH);
        await fetch(`${SUPABASE_URL}/rest/v1/providers`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
          },
          body: JSON.stringify(batch)
        });
        upserted += batch.length;
        await sleep(50);
      }

      // Log success
      await fetch(`${SUPABASE_URL}/rest/v1/sync_log`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          source: `cms_${key}`, status: 'completed',
          records_fetched: allRecords.length, records_upserted: upserted,
          completed_at: new Date().toISOString()
        })
      });

      results[key] = { fetched: allRecords.length, upserted };
    } catch (err) {
      results[key] = { error: err.message };
    }
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'completed', results }));
};
