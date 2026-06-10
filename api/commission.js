// GET /api/commission?email=<email>&name=<name>
// Aggregates commission earned per month for an affiliate, by scanning their
// Won / Payment Done / Payment Pending leads in the master workspace and
// extracting unique payment/commission records from each lead's action history.

const {
  MASTER_ID, MASTER_TOKEN, COMMISSION_STATUSES,
  searchLeads, getLeadDetail, findMasterEmail, extractPayments,
} = require('./_lib/telecrm');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });

  const email = (req.query.email || '').toLowerCase().trim();
  const name  =  req.query.name  || '';

  if (!email) return res.status(400).json({ error: 'email parameter required' });
  if (!MASTER_ID || !MASTER_TOKEN) return res.status(500).json({ error: 'Server not configured' });

  try {
    // Resolve assignee email in master workspace (same fallback as metrics/leads)
    let assigneeEmail = email;
    const check = await searchLeads(MASTER_TOKEN, MASTER_ID, { assignee: email }, 0, 1);
    if (check.status === 200 && !check.body?.total_count && name) {
      const found = await findMasterEmail(name);
      if (found && found.toLowerCase() !== email) assigneeEmail = found;
    }

    // Gather leads across all statuses that may carry commission history
    const searches = await Promise.all(
      COMMISSION_STATUSES.map(status =>
        searchLeads(MASTER_TOKEN, MASTER_ID, { assignee: assigneeEmail, status }, 0, 100)
      )
    );

    const leadsToCheck = [];
    searches.forEach(r => {
      if (r.status !== 200) return;
      (r.body?.data || []).forEach(l => {
        const id = l._id || l.id;
        if (id) leadsToCheck.push({ id, name: l.fields?.name || null });
      });
    });

    // Fetch action history for each lead in parallel and extract payments
    const details = await Promise.all(
      leadsToCheck.map(l => getLeadDetail(MASTER_TOKEN, MASTER_ID, l.id, { includeActions: true, limit: 100 }))
    );

    const leads   = [];
    const monthly = {};
    let totalCommission = 0;

    details.forEach((d, i) => {
      if (d.status !== 200) return;
      const payments = extractPayments(d.body?.actions || []);
      if (!payments.length) return;

      leads.push({ id: leadsToCheck[i].id, name: leadsToCheck[i].name, payments });

      payments.forEach(p => {
        if (p.commission_amount == null) return;
        const month = (p.date || '').slice(0, 7); // "YYYY-MM"
        if (!month) return;
        monthly[month] = (monthly[month] || 0) + p.commission_amount;
        totalCommission += p.commission_amount;
      });
    });

    const monthlyArr = Object.entries(monthly)
      .map(([month, total]) => ({ month, total_commission: Math.round(total * 100) / 100 }))
      .sort((a, b) => b.month.localeCompare(a.month));

    res.status(200).json({
      assignee_resolved: assigneeEmail,
      total_commission:  Math.round(totalCommission * 100) / 100,
      monthly:           monthlyArr,
      leads,
    });

  } catch (err) {
    console.error('[commission] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
