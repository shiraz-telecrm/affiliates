// Temporary debug endpoint — remove after diagnosis
// GET /api/debug-lead?id=<leadId>  (master workspace)
const MASTER_ID    = process.env.TELECRM_ENTERPRISE_ID;
const MASTER_TOKEN = process.env.TELECRM_SYNC_TOKEN;
const BASE         = 'https://next.telecrm.in/autoupdate/v2';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'id required' });

  const r = await fetch(`${BASE}/enterprise/${MASTER_ID}/lead/${id}?includeActions=true&limit=100`, {
    headers: { Authorization: `Bearer ${MASTER_TOKEN}`, 'Content-Type': 'application/json' },
  });
  const body = await r.json().catch(() => ({}));
  res.status(200).json({ status: r.status, body });
};
