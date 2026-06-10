// GET /api/lead-detail?id=<leadId>
// Returns unique payment/commission records for a single lead, extracted
// from its action history in the master workspace. Used by the funnel
// drawer's per-lead expand (chevron) panel.

const { MASTER_ID, MASTER_TOKEN, getLeadDetail, extractPayments } = require('./_lib/telecrm');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });

  const id = (req.query.id || '').trim();
  if (!id) return res.status(400).json({ error: 'id parameter required' });
  if (!MASTER_ID || !MASTER_TOKEN) return res.status(500).json({ error: 'Server not configured' });

  const detail = await getLeadDetail(MASTER_TOKEN, MASTER_ID, id, { includeActions: true, limit: 100 });
  if (detail.status !== 200) {
    return res.status(detail.status).json({ error: 'TeleCRM lookup failed', detail: detail.body });
  }

  const f = detail.body?.fields || {};

  res.status(200).json({
    id,
    name:     f.name   || null,
    status:   f.status || null,
    payments: extractPayments(detail.body?.actions || []),
  });
};
