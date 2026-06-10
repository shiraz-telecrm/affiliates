const {
  MASTER_ID, MASTER_TOKEN, PARTNER_ID, PARTNER_TOKEN,
  CLOSED_STATUSES, tcrm, countLeads, findMasterEmail,
} = require('./_lib/telecrm');

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

    // ── Step 2: fetch full lead details from partnership workspace ───────────
    const partnerDetail = await tcrm(PARTNER_TOKEN,
      `/enterprise/${PARTNER_ID}/lead/${leadId}`
    );

    const f = partnerDetail.body?.fields || partnerLead.fields || {};

    // Convert Unix-ms timestamps to ISO strings
    const toISO = (ts) => ts ? new Date(Number(ts)).toISOString() : null;

    // ── Step 3: resolve assignee email for master workspace ──────────────────
    // Some affiliates log in to the master workspace with a different email.
    // Try their partnership email first; if 0 results, look up by name across
    // all team members and retry with the found email.
    let assigneeEmail = email;
    let cachedTotal   = await countLeads(MASTER_TOKEN, MASTER_ID, email);

    if (!cachedTotal) {
      const foundEmail = await findMasterEmail(f.name);
      if (foundEmail && foundEmail.toLowerCase() !== email) {
        assigneeEmail = foundEmail;
        cachedTotal   = null; // force re-query with correct email
      }
    }

    // ── Step 4: lead counts from master affiliate workspace ──────────────────
    const [totalCount, ...closedCounts] = await Promise.all([
      cachedTotal !== null ? Promise.resolve(cachedTotal)
                           : countLeads(MASTER_TOKEN, MASTER_ID, assigneeEmail),
      ...CLOSED_STATUSES.map(s => countLeads(MASTER_TOKEN, MASTER_ID, assigneeEmail, s)),
    ]);

    const closedCount = closedCounts.every(c => c === null)
      ? null
      : closedCounts.reduce((sum, c) => (sum ?? 0) + (c ?? 0), 0);

    const openCount = (totalCount !== null && closedCount !== null)
      ? totalCount - closedCount
      : null;

    const breakdown = CLOSED_STATUSES.reduce((acc, s, i) => {
      if (closedCounts[i] > 0) acc[s] = closedCounts[i];
      return acc;
    }, {});

    // ── Clean response — no sensitive banking/personal data ──────────────────
    res.status(200).json({
      // Identity
      name:         f.name  || email,
      email:        f.email || email,
      phone:        f.phone || null,
      status:       f.status || null,
      kyc_status:   f.kyc_status || null,
      affiliate_type: f.affiliate_type || null,

      // Tenure
      member_since:    toISO(f.created_on),
      last_updated:    toISO(f.modified_on),

      // Commission (from partnership workspace custom fields)
      commission: {
        percentage: f.percentage        ?? null,
        earned:     f.earnings          ?? null,
        pending:    f.pending_commission ?? null,
        currency:   'INR',
      },

      // Bank details (for payout + future self-update form)
      bank: {
        payment_details: f.payment_details || null,   // free-text blob
        ifsc_code:       f.ifsc_code_1     || null,   // structured IFSC field
      },

      // Live lead counts (from master affiliate workspace)
      leads: {
        total:     totalCount,
        closed:    closedCount,
        open:      openCount,
        breakdown,
      },
    });

  } catch (err) {
    console.error('[metrics] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
