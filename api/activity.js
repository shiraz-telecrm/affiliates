const DUMMY = {
  'test@example.com': {
    name: 'Test User',
    email: 'test@example.com',
    activities: [
      { id: 1, type: 'call',         date: '2026-05-20T10:30:00Z', description: 'Outbound call — discussed pricing',          agent: 'Sales Team' },
      { id: 2, type: 'note',         date: '2026-05-19T14:00:00Z', description: 'Customer interested in enterprise plan',      agent: 'Sales Team' },
      { id: 3, type: 'email',        date: '2026-05-18T09:00:00Z', description: 'Welcome email sent',                         agent: 'System'     },
      { id: 4, type: 'deal_created', date: '2026-05-17T08:00:00Z', description: 'Deal created — ₹45,000 pipeline value',      agent: 'System'     },
      { id: 5, type: 'lead_created', date: '2026-05-16T07:30:00Z', description: 'Lead created from website form',             agent: 'System'     },
    ],
    deal: { title: 'Enterprise Plan', value: 45000, stage: 'Negotiation' },
    commission: { earned: 4500, pending: 2250, currency: 'INR' },
  },
  'demo@telecrm.in': {
    name: 'Demo Affiliate',
    email: 'demo@telecrm.in',
    activities: [
      { id: 1, type: 'call',         date: '2026-05-21T11:00:00Z', description: 'Follow-up call — sent proposal',             agent: 'Sales Team' },
      { id: 2, type: 'deal_created', date: '2026-05-20T09:00:00Z', description: 'Deal created — ₹18,000 pipeline value',      agent: 'System'     },
      { id: 3, type: 'lead_created', date: '2026-05-19T08:00:00Z', description: 'Lead created via affiliate referral link',   agent: 'System'     },
    ],
    deal: { title: 'Starter Plan', value: 18000, stage: 'Proposal Sent' },
    commission: { earned: 1800, pending: 900, currency: 'INR' },
  },
};

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const email = (req.query.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'email query parameter is required' });

  const data = DUMMY[email];
  if (!data) return res.status(404).json({ error: 'No record found for this email' });

  res.status(200).json(data);
};
