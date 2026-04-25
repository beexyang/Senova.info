// api/cms-proxy.js — Serverless proxy for CMS.gov API (avoids CORS).
// SECURITY: tight CORS + strict allow-list of forwarded query params.
const { applyCors } = require('../lib/security');

const DATASETS = {
  home_health: '6jpm-sxkc',
  hospice: 'yc9t-dgbk'
};

const ALLOWED_PARAMS = new Set(['limit', 'offset', 'conditions', 'q', 'sort']);
const MAX_VALUE_LENGTH = 200;

module.exports = async function handler(req, res) {
  if (applyCors(req, res, 'GET, OPTIONS')) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { dataset, ...queryParams } = req.query;
  const datasetId = DATASETS[dataset];
  if (!datasetId) {
    return res.status(400).json({ error: 'Invalid dataset. Use home_health or hospice.' });
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(queryParams)) {
    if (!ALLOWED_PARAMS.has(key)) continue;
    if (typeof value !== 'string') continue;
    if (value.length > MAX_VALUE_LENGTH) continue;
    params.append(key, value);
  }

  const cmsUrl = 'https://data.cms.gov/provider-data/api/1/datastore/query/'
    + datasetId + '/0?' + params.toString();

  try {
    const cmsResp = await fetch(cmsUrl, { headers: { 'Accept': 'application/json' } });
    if (!cmsResp.ok) {
      console.error('cms-proxy upstream error:', cmsResp.status);
      return res.status(502).json({ error: 'CMS API returned ' + cmsResp.status });
    }
    const data = await cmsResp.json();
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(data);
  } catch (err) {
    console.error('cms-proxy fetch failed:', err);
    return res.status(502).json({ error: 'Failed to reach CMS API' });
  }
};
