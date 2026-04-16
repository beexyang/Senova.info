// api/cms-proxy.js — Vercel serverless proxy for CMS.gov API (avoids CORS)
export default async function handler(req, res) {
  // Allow CORS from our own domain
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { dataset, ...queryParams } = req.query;

  // Map dataset names to CMS dataset IDs
  const DATASETS = {
    home_health: '6jpm-sxkc',
    hospice: 'yc9t-dgbk'
  };

  const datasetId = DATASETS[dataset];
  if (!datasetId) {
    return res.status(400).json({ error: 'Invalid dataset. Use home_health or hospice.' });
  }

  // Rebuild query string (forward all params except 'dataset')
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(queryParams)) {
    params.append(key, value);
  }

  const cmsUrl = `https://data.cms.gov/provider-data/api/1/datastore/query/${datasetId}/0?${params.toString()}`;

  try {
    const cmsResp = await fetch(cmsUrl, {
      headers: { 'Accept': 'application/json' }
    });

    if (!cmsResp.ok) {
      return res.status(cmsResp.status).json({
        error: 'CMS API returned ' + cmsResp.status,
        url: cmsUrl
      });
    }

    const data = await cmsResp.json();
    // Cache for 5 minutes
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({ error: 'Failed to reach CMS API: ' + err.message });
  }
}
