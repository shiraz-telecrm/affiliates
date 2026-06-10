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

    if (mode === 'allwon') {
      // Fetch all Won + Payment Pending leads (no assignee filter), paginated.
      const statuses = ['Won', 'Payment Pending'];
      let all = [];
      for (const status of statuses) {
        const first = await searchLeads(MASTER_TOKEN, MASTER_ID, { status }, 0, 100);
        const total = first.body?.total_count || 0;
        let data = first.body?.data || [];
        if (total > 100) {
          const more = await searchLeads(MASTER_TOKEN, MASTER_ID, { status }, 100, 100);
          data = data.concat(more.body?.data || []);
        }
        all = all.concat(data.map(l => ({ id: l._id || l.id, fields: l.fields, status })));
      }

      const summary = {
        total: all.length,
        with_employeeid: all.filter(l => l.fields?.employeeid).length,
        with_leadMetaData: all.filter(l => l.fields?.leadMetaData?.statusChangeTimestamp).length,
        with_total_amount: all.filter(l => l.fields?.total_amount != null).length,
        with_number_of_license: all.filter(l => l.fields?.number_of_license != null).length,
      };

      // Month distribution by leadMetaData.statusChangeTimestamp (fallback modified_on)
      const months = {};
      all.forEach(l => {
        const ts = l.fields?.leadMetaData?.statusChangeTimestamp || l.fields?.modified_on;
        if (!ts) return;
        const month = new Date(ts).toISOString().slice(0, 7);
        months[month] = (months[month] || 0) + 1;
      });

      // Sample of May leads with employeeid
      const mayLeads = all.filter(l => {
        const ts = l.fields?.leadMetaData?.statusChangeTimestamp || l.fields?.modified_on;
        return ts && new Date(ts).toISOString().slice(0, 7) === '2026-05';
      }).map(l => ({
        id: l.id,
        name: l.fields?.name,
        employeeid: l.fields?.employeeid,
        total_amount: l.fields?.total_amount,
        number_of_license: l.fields?.number_of_license,
        status: l.status,
        statusChangeTimestamp: l.fields?.leadMetaData?.statusChangeTimestamp,
        modified_on: l.fields?.modified_on,
      }));

      return res.status(200).json({ summary, months, mayLeads });
    }

    return res.status(400).json({ error: 'unknown mode' });
  } catch (err) {
    console.error('[debug-admin] error:', err);
    res.status(500).json({ error: 'Internal server error', message: String(err) });
  }
};
