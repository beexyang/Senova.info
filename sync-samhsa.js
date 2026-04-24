// POST /api/sync-samhsa
// Fetches addiction-treatment facility data from SAMHSA's
// Behavioral Health Treatment Services Locator and upserts it into
// the providers table with provider_type = 'drug_rehab'.
//
// Auth: requires Bearer token equal to process.env.SYNC_SECRET.
// Trigger: manually (curl) or via Vercel cron — see vercel.json cron entry.
//
// Env vars required:
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
//   SYNC_SECRET              (a random string — shared between this route and whatever calls it)
//   SAMHSA_API_URL           (optional; defaults to the public per-state locator endpoint)
//
// SAMHSA's Locator exposes state-filtered JSON; we iterate all 50 states.
// If their URL changes, set SAMHSA_API_URL to a JSON endpoint that returns
// { rows: [...] } or a plain array. The transform function is tolerant of
// both shapes and missing fields.

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
  'DC'
];

// Base URL template. {state} gets replaced with a 2-letter code.
// The default points at SAMHSA's public locator JSON export, which
// returns substance-abuse treatment facilities (sType=SA) by state.
const DEFAULT_SAMHSA_URL =
  'https://findtreatment.gov/locator/exportsAsJson?sType=SA&sAddr={state}';

// Map SAMHSA service codes / labels into a normalized rehab_services array.
function extractRehabServices(f) {
  const out = new Set();
  const svcs = Array.isArray(f.services) ? f.services.map(String) : [];
  const flat = svcs.join(',').toLowerCase();
  const raw  = JSON.stringify(f).toLowerCase();

  if (/\bdetox|withdrawal management\b/.test(raw))                            out.add('detox');
  if (/inpatient|residential|short[- ]term/.test(raw))                        out.add('inpatient');
  if (/outpatient|iop|php|partial hospitalization/.test(raw))                 out.add('outpatient');
  if (/methadone|buprenorphine|naltrexone|medication[- ]assisted|mat\b/.test(raw)) out.add('mat');
  if (/telehealth|virtual/.test(raw))                                         out.add('telehealth');
  if (/12.?step|aa\/na/.test(raw))                                            out.add('12_step');
  if (/mental health|co.?occurring|dual diagnosis/.test(raw))                 out.add('mental_health');
  return Array.from(out);
}

function extractPayments(f) {
  const out = new Set();
  const raw = JSON.stringify(f).toLowerCase();
  if (/medicaid/.test(raw))                         out.add('medicaid');
  if (/medicare/.test(raw))                         out.add('medicare');
  if (/private (health )?insurance/.test(raw))      out.add('private_insurance');
  if (/self.?pay|cash|private pay/.test(raw))       out.add('private_pay');
  if (/sliding.?fee|sliding scale/.test(raw))       out.add('sliding_fee');
  if (/no (charge|fee|cost)|free/.test(raw))        out.add('no_fee');
  if (/iht|military|tricare|va\b/.test(raw))        out.add('military');
  return Array.from(out);
}

function extractPopulations(f) {
  const out = new Set();
  const raw = JSON.stringify(f).toLowerCase();
  if (/adolescent|teen|youth|under 18/.test(raw))   out.add('adolescents');
  if (/seniors|older adult/.test(raw))              out.add('seniors');
  if (/women only|female/.test(raw))                out.add('women');
  if (/men only|male only/.test(raw))               out.add('men');
  if (/lgbt|gay|lesbian|transgender/.test(raw))     out.add('lgbtq');
  if (/veteran|military/.test(raw))                 out.add('veterans');
  if (/criminal justice|court.?ordered/.test(raw))  out.add('criminal_justice');
  if (/pregnant|postpartum/.test(raw))              out.add('pregnant_women');
  if (/hearing impair|deaf/.test(raw))              out.add('deaf_hoh');
  return Array.from(out);
}

// Transform one SAMHSA facility record into our providers-row shape.
function transformFacility(f, stateHint) {
  const idn =
    String(f.id || f.frid || f.facility_id || f._id || '').trim() ||
    `${(f.name1 || f.name || 'unknown').replace(/\s+/g,'-')}-${f.zip || f.zip_code || stateHint}`.toLowerCase().slice(0, 80);

  const name  = (f.name1 || f.name || f.facility_name || 'Unknown Facility').trim();
  const addr  = (f.street1 || f.street || f.address_line_1 || f.address || '').trim();
  const city  = (f.city || '').trim();
  const state = (f.state || stateHint || '').toUpperCase().trim();
  const zip   = String(f.zip || f.zip_code || '').slice(0, 5);
  const phone = String(f.phone || f.phone1 || f.telephone || '').replace(/\D/g, '').slice(0, 10);
  const zip3  = zip.length >= 3 ? zip.slice(0, 3) : null;

  return {
    provider_type:       'drug_rehab',
    provider_name:       name,
    address:             addr,
    city,
    state,
    zip_code:            zip,
    zip3,
    telephone:           phone,
    ownership_type:      f.type || null,
    data_source:         'samhsa',
    external_id:         idn,
    rehab_services:      extractRehabServices(f),
    payment_options:     extractPayments(f),
    special_populations: extractPopulations(f),
    raw_data:            f,
    synced_at:           new Date().toISOString()
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const CRON_SECRET          = process.env.CRON_SECRET;
  const SYNC_SECRET          = process.env.SYNC_SECRET;
  const SUPABASE_URL         = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const SAMHSA_URL           = process.env.SAMHSA_API_URL || DEFAULT_SAMHSA_URL;

  // Auth: accept either a manual Bearer ${SYNC_SECRET} or Vercel's
  // automatic Bearer ${CRON_SECRET} header (which Vercel includes when
  // invoking this endpoint from a cron job). At least one must be set.
  const auth   = req.headers.authorization || '';
  const accept = [SYNC_SECRET, CRON_SECRET].filter(Boolean).map(s => `Bearer ${s}`);
  if (accept.length === 0 || !accept.includes(auth)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase env vars missing' });
  }

  const logId = await startLog(SUPABASE_URL, SUPABASE_SERVICE_KEY, 'drug_rehab');
  const summary = { states: {}, totalSynced: 0, errors: [] };

  for (const st of US_STATES) {
    const url = SAMHSA_URL.replace('{state}', st);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'SenovaSync/1.0' } });
      if (!r.ok) { summary.errors.push(`${st}: HTTP ${r.status}`); continue; }
      const body = await r.json();
      const rows = Array.isArray(body) ? body : (body.rows || body.data || body.results || body.facilities || []);
      if (rows.length === 0) { summary.states[st] = 0; continue; }

      const transformed = rows.map(f => transformFacility(f, st)).filter(p => p.provider_name && p.state);
      if (transformed.length === 0) { summary.states[st] = 0; continue; }

      // Upsert in batches of 500 to keep payloads reasonable
      for (let i = 0; i < transformed.length; i += 500) {
        const batch = transformed.slice(i, i + 500);
        const upsertResp = await fetch(
          `${SUPABASE_URL}/rest/v1/providers?on_conflict=data_source,external_id`,
          {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates,return=minimal'
            },
            body: JSON.stringify(batch)
          }
        );
        if (!upsertResp.ok) {
          const t = (await upsertResp.text()).slice(0, 200);
          summary.errors.push(`${st} upsert: ${t}`);
        }
      }

      summary.states[st] = transformed.length;
      summary.totalSynced += transformed.length;
    } catch (e) {
      summary.errors.push(`${st}: ${e.message}`);
    }
  }

  await finishLog(SUPABASE_URL, SUPABASE_SERVICE_KEY, logId, summary.totalSynced, summary.errors);
  res.status(200).json(summary);
};

// ── small helpers for sync_log bookkeeping ─────────────────────────
async function startLog(SUPABASE_URL, key, dataset) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/sync_log`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ dataset, status: 'running', started_at: new Date().toISOString() })
    });
    if (!r.ok) return null;
    const body = await r.json();
    return body[0]?.id || null;
  } catch (_) { return null; }
}

async function finishLog(SUPABASE_URL, key, id, synced, errors) {
  if (!id) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/sync_log?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        status: errors.length > 0 && synced === 0 ? 'failed' : 'completed',
        records_synced: synced,
        completed_at: new Date().toISOString(),
        error_message: errors.length > 0 ? errors.slice(0, 5).join('; ') : null
      })
    });
  } catch (_) { /* best effort */ }
}
