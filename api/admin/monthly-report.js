// GET /api/admin/monthly-report?month=2026-05&admin=shiraz@telecrm.in
//
// Cross-affiliate monthly performance report, sourced from the master
// affiliate workspace. For the given calendar month (YYYY-MM), aggregates
// — per affiliate — the number of leads won, total revenue, total
// commission paid out, and total licenses sold, plus a combined total row.
//
// Reuses extractPayments() (api/_lib/telecrm.js), the same de-duped
// order/commission action parser that powers /api/commission and the
// per-lead drill-down on metrics.html — so a "payment event" here is the
// same unique unit counted there.
//
// v1 / prototype notes:
// - Scans every Won / Payment Done / Payment Pending lead in the master
//   workspace (~190 as of June 2026) and fetches each one's action history,
//   so this can take 10-20s. See ROADMAP for caching plans.
// - A lead is attributed to the affiliate via fields.employeeid (the
//   affiliate's master-workspace login email — same field `assignee`
//   search filters match against). Leads with no employeeid (direct /
//   non-affiliate leads) are excluded from the report.
// - "Won" here means "had a payment/commission event in this month",
//   regardless of the lead's current status (Won vs Payment Pending).

const {
  MASTER_ID, MASTER_TOKEN, COMMISSION_STATUSES,
  searchLeads, getLeadDetail, extractPayments, getAllTeamMembers,
} = require('../_lib/telecrm');

// TODO: move to an env var / replace with real auth once Phase 3
// (ROADMAP #5, Google login) lands. For now this is a lightweight gate.
const ADMIN_EMAILS = ['shiraz@telecrm.in'];

const PAGE_SIZE  = 100;
const BATCH_SIZE = 20;

const round2 = n => Math.round(n * 100) / 100;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });

  const admin = (req.query.admin || '').toLowerCase().trim();
  if (!ADMIN_EMAILS.includes(admin)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const month = (req.query.month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month parameter required, format YYYY-MM' });
  }

  if (!MASTER_ID || !MASTER_TOKEN) return res.status(500).json({ error: 'Server not configured' });

  try {
    // 1. Collect every Won / Payment Done / Payment Pending lead id
    const leadIds = [];
    for (const status of COMMISSION_STATUSES) {
      let skip = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const r = await searchLeads(MASTER_TOKEN, MASTER_ID, { status }, skip, PAGE_SIZE);
        if (r.status !== 200) break;
        const data = r.body?.data || [];
        data.forEach(l => { const id = l._id || l.id; if (id) leadIds.push(id); });
        const total = r.body?.total_count || 0;
        skip += PAGE_SIZE;
        if (skip >= total || !data.length) break;
      }
    }

    // 2. Fetch each lead's detail + action history, in concurrency-limited batches
    const details = [];
    for (let i = 0; i < leadIds.length; i += BATCH_SIZE) {
      const batch = leadIds.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(id => getLeadDetail(MASTER_TOKEN, MASTER_ID, id, { includeActions: true, limit: 100 }))
      );
      details.push(...results);
    }

    // 3. Affiliate display-name lookup (master workspace team members)
    const teamMembers = await getAllTeamMembers();
    const nameByEmail = new Map(teamMembers.map(m => [m.email, m.name]));

    // 4. Aggregate by affiliate, keeping only payment events in the target month
    const byAffiliate = new Map();

    details.forEach(d => {
      if (d.status !== 200) return;
      const f = d.body?.fields || {};
      const employeeid = (f.employeeid || '').trim();
      if (!employeeid) return; // not an affiliate-referred lead

      const monthPayments = extractPayments(d.body?.actions || [])
        .filter(p => (p.date || '').slice(0, 7) === month);
      if (!monthPayments.length) return;

      let entry = byAffiliate.get(employeeid);
      if (!entry) {
        entry = {
          affiliate_email: employeeid,
          affiliate_name:  nameByEmail.get(employeeid.toLowerCase()) || employeeid,
          leadIds: new Set(),
          revenue: 0, commission: 0, licenses: 0,
          leads: [],
        };
        byAffiliate.set(employeeid, entry);
      }

      const leadId = d.body.id || f.name;
      entry.leadIds.add(leadId);
      entry.leads.push({ id: leadId, name: f.name || null, payments: monthPayments });
      monthPayments.forEach(p => {
        if (p.amount            != null) entry.revenue    += p.amount;
        if (p.commission_amount != null) entry.commission += p.commission_amount;
        if (p.licenses          != null) entry.licenses   += p.licenses;
      });
    });

    const affiliates = [...byAffiliate.values()]
      .map(a => ({
        affiliate_email: a.affiliate_email,
        affiliate_name:  a.affiliate_name,
        leads_won:       a.leadIds.size,
        revenue:         round2(a.revenue),
        commission:      round2(a.commission),
        licenses:        a.licenses,
        leads:           a.leads,
      }))
      .sort((x, y) => y.revenue - x.revenue);

    const totals = affiliates.reduce((t, a) => ({
      leads_won:  t.leads_won  + a.leads_won,
      revenue:    round2(t.revenue    + a.revenue),
      commission: round2(t.commission + a.commission),
      licenses:   t.licenses   + a.licenses,
    }), { leads_won: 0, revenue: 0, commission: 0, licenses: 0 });

    res.status(200).json({ month, affiliates, totals, leads_scanned: leadIds.length });

  } catch (err) {
    console.error('[admin/monthly-report] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
