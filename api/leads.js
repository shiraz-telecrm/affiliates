// GET /api/leads?email=x&status=Won&skip=0&limit=50
// Returns leads assigned to this affiliate in the master workspace,
// optionally filtered by status.

const MASTER_ID    = process.env.TELECRM_ENTERPRISE_ID;
const MASTER_TOKEN = process.env.TELECRM_SYNC_TOKEN;
const BASE         = 'https://next.telecrm.in/autoupdate/v2';

async function tcrm(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${MASTER_TOKEN}`, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(`${BASE}${path}`, opts);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });

  const email  = (req.query.email  || '').toLowerCase().trim();
  const status =  req.query.status || null;   // optional filter
  const skip   = parseInt(req.query.skip,  10) || 0;
  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 100);

  if (!email) return res.status(400).json({ error: 'email parameter required' });
  if (!MASTER_ID || !MASTER_TOKEN) return res.status(500).json({ error: 'Server not configured' });

  const fields = { assignee: email };
  if (status) fields.status = status;

  const result = await tcrm(
    `/enterprise/${MASTER_ID}/lead/search?skip=${skip}&limit=${limit}`,
    'POST',
    { fields }
  );

  if (result.status !== 200) {
    return res.status(result.status).json({ error: 'TeleCRM search failed', detail: result.body });
  }

  const leads = (result.body.data || []).map(lead => {
    const f = lead.fields || {};
    return {
      id:     lead._id || lead.id || null,
      name:   f.name   || '(No name)',
      email:  f.email  || null,
      phone:  f.phone  || null,
      status: f.status || null,
    };
  });

  res.status(200).json({
    leads,
    total_count: result.body.total_count ?? leads.length,
    skip:        result.body.skip        ?? skip,
    limit:       result.body.limit       ?? limit,
  });
};
