// GET /api/leads?email=x&name=Harika&status=Won&skip=0&limit=50
// Returns leads assigned to this affiliate in the master workspace.

const { MASTER_ID, MASTER_TOKEN, tcrm, findMasterEmail } = require('./_lib/telecrm');

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
  const check = await tcrm(MASTER_TOKEN,
    `/enterprise/${MASTER_ID}/lead/search?limit=1`, 'POST',
    { fields: { assignee: email } }
  );

  if (check.status === 200 && !check.body?.total_count && name) {
    const found = await findMasterEmail(name);
    if (found && found.toLowerCase() !== email) assigneeEmail = found;
  }

  const fields = { assignee: assigneeEmail };
  // Note: status=__open__ ("Open" funnel row) can't be expressed as a single
  // TeleCRM filter — there's no "not in" operator. Pass through as no status
  // filter for now (returns all leads); see ROADMAP for a proper fix.
  if (status && status !== '__open__') fields.status = status;

  const result = await tcrm(MASTER_TOKEN,
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
