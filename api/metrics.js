// Env vars needed:
//   TELECRM_ENTERPRISE_ID            — master affiliate workspace
//   TELECRM_SYNC_TOKEN               — master affiliate sync token
//   TELECRM_PARTNERSHIP_ENTERPRISE_ID — partnership workspace
//   TELECRM_PARTNERSHIP_SYNC_TOKEN    — partnership sync token

const MASTER_ID       = process.env.TELECRM_ENTERPRISE_ID;
const MASTER_TOKEN    = process.env.TELECRM_SYNC_TOKEN;
const PARTNER_ID      = process.env.TELECRM_PARTNERSHIP_ENTERPRISE_ID;
const PARTNER_TOKEN   = process.env.TELECRM_PARTNERSHIP_SYNC_TOKEN;
const BASE            = 'https://next.telecrm.in/autoupdate/v2';

// Statuses considered "closed" in master affiliate workspace
const CLOSED_STATUSES = ['Won', 'Lost', 'Closed', 'Payment Done', 'Payment Pending'];

async function tcrm(token, path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
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

  const email = (req.query.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'email query parameter is required' });

  if (!MASTER_ID || !MASTER_TOKEN || !PARTNER_ID || !PARTNER_TOKEN) {
    return res.status(500).json({ error: 'Server not configured — env vars missing' });
  }

  try {
    // ── Run all queries in parallel ──────────────────────────────────────────
    const [partnerSearch, totalLeads, closedLeads] = await Promise.all([

      // 1. Find affiliate as a lead in PARTNERSHIP workspace
      tcrm(PARTNER_TOKEN,
        `/enterprise/${PARTNER_ID}/lead/search`,
        'POST',
        { fields: { email } }
      ),

      // 2. Count ALL leads assigned to this person in MASTER AFFILIATE workspace
      tcrm(MASTER_TOKEN,
        `/enterprise/${MASTER_ID}/lead/search?limit=1`,
        'POST',
        { fields: { assignee: email } }
      ),

      // 3. Count CLOSED leads assigned to this person in MASTER AFFILIATE workspace
      tcrm(MASTER_TOKEN,
        `/enterprise/${MASTER_ID}/lead/search?limit=1`,
        'POST',
        { fields: { assignee: email, status: CLOSED_STATUSES } }
      ),
    ]);

    // ── Partnership profile ──────────────────────────────────────────────────
    if (partnerSearch.status !== 200 || !partnerSearch.body?.data?.length) {
      return res.status(404).json({ error: 'Affiliate not found in partnership workspace' });
    }

    const partnerLead   = partnerSearch.body.data[0];
    const partnerFields = partnerLead.fields || {};
    const sinceDate     = partnerLead.created_at
                       || partnerLead.createdAt
                       || partnerLead.created
                       || null;

    // ── Lead counts ──────────────────────────────────────────────────────────
    const totalCount  = totalLeads.body?.total_count  ?? null;
    const closedCount = closedLeads.body?.total_count ?? null;
    const openCount   = (totalCount !== null && closedCount !== null)
                        ? totalCount - closedCount
                        : null;

    res.status(200).json({
      // Who they are
      name:   partnerFields.name  || email,
      email:  partnerFields.email || email,
      phone:  partnerFields.phone || null,
      status: partnerFields.status || null,

      // Since when
      member_since: sinceDate,

      // Lead stats in master affiliate workspace
      leads: {
        total:  totalCount,
        closed: closedCount,
        open:   openCount,
        closed_statuses: CLOSED_STATUSES,
      },

      // Raw for debugging — remove later
      _debug: {
        partner_lead_id:       partnerLead._id || partnerLead.id || null,
        partner_lead_raw_keys: Object.keys(partnerLead),
      },
    });

  } catch (err) {
    console.error('[metrics] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
