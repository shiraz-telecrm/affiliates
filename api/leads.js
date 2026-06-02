// GET /api/leads?email=x&name=Harika&status=Won&skip=0&limit=50
// Returns leads assigned to this affiliate in the master workspace.

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

// Fetch ALL team members and find by name match (searches full list in parallel batches)
async function findMasterEmail(name) {
  if (!name) return null;
  const nameLower = name.toLowerCase().trim();

  const first = await tcrm(`/enterprise/${MASTER_ID}/team-members?limit=10&skip=0`);
  if (first.status !== 200) return null;

  const totalCount = first.body?.total_count || 0;
  const allPages   = [first.body?.data || []];

  const remaining = Math.ceil((totalCount - 10) / 10);
  if (remaining > 0) {
    const skips = Array.from({ length: remaining }, (_, i) => (i + 1) * 10);
    for (let i = 0; i < skips.length; i += 10) {
      const batch = await Promise.all(
        skips.slice(i, i + 10).map(skip =>
          tcrm(`/enterprise/${MASTER_ID}/team-members?limit=10&skip=${skip}`)
        )
      );
      allPages.push(...batch.map(r => r.body?.data || []));
    }
  }

  const match = allPages.flat().find(m => {
    const mName = (m.name || '').toLowerCase();
    return mName === nameLower || mName.includes(nameLower) || nameLower.includes(mName);
  });
  return match?.email || null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });

  const email  = (req.query.email  || '').toLowerCase().trim();
  const name   =  req.query.name   || '';
  const status =  req.query.status || null;
  const skip   = parseInt(req.query.skip,  10) || 0;
  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 100);

  if (!email)  return res.status(400).json({ error: 'email parameter required' });
  if (!MASTER_ID || !MASTER_TOKEN) return res.status(500).json({ error: 'Server not configured' });

  // Resolve correct assignee email in master workspace
  let assigneeEmail = email;
  const check = await tcrm(
    `/enterprise/${MASTER_ID}/lead/search?limit=1`, 'POST',
    { fields: { assignee: email } }
  );

  if (check.status === 200 && !check.body?.total_count && name) {
    const found = await findMasterEmail(name);
    if (found && found.toLowerCase() !== email) assigneeEmail = found;
  }

  const fields = { assignee: assigneeEmail };
  if (status && status !== '__open__') fields.status = status;

  // For "open" filter: exclude all closed statuses
  const CLOSED = ['Won', 'Lost', 'Closed', 'Payment Done', 'Payment Pending'];
  // Note: TeleCRM doesn't support "not in" filters, so open = total minus closed
  // We fetch all and let the UI handle "open" display; status=null means all

  const result = await tcrm(
    `/enterprise/${MASTER_ID}/lead/search?skip=${skip}&limit=${limit}`,
    'POST', { fields }
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
      status: f.status || lead.status || null,
    };
  });

  res.status(200).json({
    leads,
    total_count: result.body.total_count ?? leads.length,
    skip:        result.body.skip        ?? skip,
    limit:       result.body.limit       ?? limit,
    assignee_resolved: assigneeEmail,
  });
};
