// TEMPORARY debug endpoint — explore master workspace data shape for the
// admin monthly report. Will be removed once the real endpoint is built.

const { MASTER_ID, MASTER_TOKEN, tcrm, searchLeads, getLeadDetail } = require('./_lib/telecrm');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!MASTER_ID || !MASTER_TOKEN) return res.status(500).json({ error: 'Server not configured' });

  const mode = req.query.mode || 'counts';

  try {
    if (mode === 'counts') {
      const statuses = ['Won', 'Payment Done', 'Payment Pending'];
      const out = {};
      for (const status of statuses) {
        const r = await searchLeads(MASTER_TOKEN, MASTER_ID, { status }, 0, 1);
        out[status] = { status: r.status, total_count: r.body?.total_count ?? null };
      }
      return res.status(200).json(out);
    }

    if (mode === 'sample') {
      // Fetch a handful of Won leads (no assignee filter) and dump raw fields
      const r = await searchLeads(MASTER_TOKEN, MASTER_ID, { status: 'Won' }, 0, 5);
      const leads = (r.body?.data || []).map(l => ({
        id: l._id || l.id,
        fields: l.fields,
      }));
      return res.status(200).json({ status: r.status, total_count: r.body?.total_count, leads });
    }

    if (mode === 'detail') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      const d = await getLeadDetail(MASTER_TOKEN, MASTER_ID, id, { includeActions: true, limit: 100 });
      return res.status(200).json(d.body);
    }

    if (mode === 'teamlimit') {
      const r = await tcrm(MASTER_TOKEN, `/enterprise/${MASTER_ID}/team-members?limit=100&skip=0`);
      return res.status(200).json({ status: r.status, total_count: r.body?.total_count, returned: (r.body?.data || []).length });
    }

    return res.status(400).json({ error: 'unknown mode' });
  } catch (err) {
    console.error('[debug-admin] error:', err);
    res.status(500).json({ error: 'Internal server error', message: String(err) });
  }
};
