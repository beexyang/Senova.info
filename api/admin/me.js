// GET /api/admin/me — confirm cookie session is valid; used by admin pages on load.
const { applyCors } = require('../../lib/security');
const { readAdminSession } = require('../../lib/session');

module.exports = async (req, res) => {
  if (applyCors(req, res, 'GET, OPTIONS')) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const sess = await readAdminSession(req);
  if (!sess) return res.status(401).json({ error: 'Unauthorized' });
  return res.status(200).json({ email: sess.email });
};
