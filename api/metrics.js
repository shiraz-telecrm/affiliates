const MASTER_ID     = process.env.TELECRM_ENTERPRISE_ID;
const MASTER_TOKEN  = process.env.TELECRM_SYNC_TOKEN;
const PARTNER_ID    = process.env.TELECRM_PARTNERSHIP_ENTERPRISE_ID;
const PARTNER_TOKEN = process.env.TELECRM_PARTNERSHIP_SYNC_TOKEN;
const BASE          = 'https://next.telecrm.in/autoupdate/v2';

// Statuses that count as "closed" in master affiliate workspace
const CLOSED_STATUSES = ['Won', 'Lost', 'Closed', 'Payment Done', 'Payment Pending'];

async function tcrm(token, path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(`${BASE}${path}`, opts);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

// Search leads by assignee + optional single status, return total_count only
async function countLeads(token, enterpriseId, assigneeEmail, status = null) {
  const fields = { assignee: assigneeEmail };
  if (status) fields.status = status;
  const r = await tcrm(token,
    `/enterprise/${enterpriseId}/lead/search?limit=1`,
    'POST',
    { fields }
  );
  if (r.status !== 200) return null;
  return r.body?.total_count ?? null;
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
    // ── Step 1: find affiliate as lead in partnership workspace ──────────────
    const partnerSearch = await tcrm(PARTNER_TOKEN,
      `/enterprise/${PARTNER_ID}/lead/search`,
      'POST',
      { fields: { email } }
    );

    if (partnerSearch.status !== 200 || !partnerSearch.body?.data?.length) {
      return res.status(404).json({ error: 'Affiliate not found in partnership workspace' });
    }

    const partnerLead = partnerSearch.body.data[0];
    const leadId      = partnerLead._id || partnerLead.id;

    // ── Step 2: fetch full lead detail from partnership workspace ────────────
    // (search result has limited fields — full detail has more)
    const partnerDetail = await tcrm(PARTNER_TOKEN,
      `/enterprise/${PARTNER_ID}/lead/${leadId}?includeActions=true&limit=5`
    );

    const pFields = partnerDetail.body?.fields || partnerLead.fields || {};
    const pMeta   = partnerLead.leadMetaData || {};

    // Extract "since when" — check every known date field
    const sinceRaw = pFields.created_on
                  || pFields.createdAt
                  || pFields.created_at
                  || pFields.onboarding_date
                  || partnerDetail.body?.created_at
                  || partnerDetail.body?.createdAt
                  || (pMeta.statusChangeTimestamp
                      ? new Date(pMeta.statusChangeTimestamp).toISOString()
                      : null);

    // ── Step 3: lead counts in master affiliate workspace (run in parallel) ──
    // Run total + each closed status in parallel; avoid array filter (causes 500)
    const [totalCount, ...closedCounts] = await Promise.all([
      countLeads(MASTER_TOKEN, MASTER_ID, email),
      ...CLOSED_STATUSES.map(s => countLeads(MASTER_TOKEN, MASTER_ID, email, s)),
    ]);

    const closedCount = closedCounts.every(c => c === null)
      ? null
      : closedCounts.reduce((sum, c) => (sum ?? 0) + (c ?? 0), 0);

    const openCount = (totalCount !== null && closedCount !== null)
      ? totalCount - closedCount
      : null;

    res.status(200).json({
      name:         pFields.name  || email,
      email:        pFields.email || email,
      phone:        pFields.phone || null,
      status:       pFields.status || partnerLead.status || null,
      member_since: sinceRaw,

      leads: {
        total:  totalCount,
        closed: closedCount,
        open:   openCount,
        breakdown: CLOSED_STATUSES.reduce((acc, s, i) => {
          acc[s] = closedCounts[i];
          return acc;
        }, {}),
      },

      // Debug — remove after confirming fields
      _debug: {
        partner_full_fields:      pFields,
        partner_detail_top_keys:  Object.keys(partnerDetail.body || {}),
        meta:                     pMeta,
      },
    });

  } catch (err) {
    console.error('[metrics] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
