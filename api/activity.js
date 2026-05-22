const ENTERPRISE_ID = process.env.TELECRM_ENTERPRISE_ID;
const SYNC_TOKEN    = process.env.TELECRM_SYNC_TOKEN;
const BASE         = 'https://next.telecrm.in/autoupdate/v2';

// ── TeleCRM fetch helper ────────────────────────────────────────────────────
async function tcrm(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${SYNC_TOKEN}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(`${BASE}${path}`, opts);
  const json = await res.json();
  return { status: res.status, body: json };
}

// ── Map TeleCRM action type → frontend icon type ────────────────────────────
function mapType(raw) {
  if (!raw) return 'note';
  const t = String(raw).toUpperCase();
  if (t.includes('CALL'))                        return 'call';
  if (t === 'PAYMENT')                           return 'payment';
  if (t.includes('EMAIL'))                       return 'email';
  if (t === 'AUTO_UPDATE_LEAD_ACTION')           return 'lead_created';
  if (t.includes('DEAL'))                        return 'deal_created';
  return 'note';
}

// ── Human-readable description ──────────────────────────────────────────────
const TYPE_LABELS = {
  OUTGOING_CALL:           'Outbound call',
  INCOMING_CALL:           'Inbound call',
  PAYMENT:                 'Payment received',
  SYSTEM_NOTE:             'System note added',
  CUSTOM_API:              'Updated via API',
  AUTO_UPDATE_LEAD_ACTION: 'Lead created',
};

function describe(a) {
  if (a.fields?.note)        return a.fields.note;
  if (a.fields?.description) return a.fields.description;
  if (a.fields?.text)        return a.fields.text;
  if (TYPE_LABELS[a.type])   return TYPE_LABELS[a.type];
  // Custom action codes like ACTION_1003
  if (/^ACTION_\d+$/.test(a.type || '')) return 'Custom action logged';
  return a.type || 'Activity logged';
}

// ── Extract date from action ─────────────────────────────────────────────────
function getDate(a) {
  return a.performed_at
    || a.created_at
    || a.createdAt
    || a.timestamp
    || a.date
    || null;
}

// ── Main handler ────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });

  const email = (req.query.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'email query parameter is required' });

  if (!ENTERPRISE_ID || !SYNC_TOKEN) {
    return res.status(500).json({ error: 'Server not configured — env vars missing' });
  }

  try {
    // Step 1: find lead by email
    const search = await tcrm(
      `/enterprise/${ENTERPRISE_ID}/lead/search`,
      'POST',
      { fields: { email } }
    );

    if (search.status !== 200 || !search.body?.data?.length) {
      return res.status(404).json({ error: 'No lead found for this email' });
    }

    const leadRaw = search.body.data[0];
    const leadId  = leadRaw._id || leadRaw.id;
    const fields  = leadRaw.fields || {};

    if (!leadId) {
      return res.status(500).json({ error: 'Lead ID missing from TeleCRM response' });
    }

    // Step 2: get lead with up to 50 most recent actions
    const detail = await tcrm(
      `/enterprise/${ENTERPRISE_ID}/lead/${leadId}?includeActions=true&limit=50`
    );

    if (detail.status !== 200) {
      return res.status(500).json({ error: 'Failed to fetch lead detail from TeleCRM' });
    }

    const detailFields = detail.body.fields  || fields;
    const rawActions   = detail.body.actions || [];

    // Step 3: build timeline — skip purely internal system actions
    const SKIP_TYPES = new Set(['CUSTOM_API']);
    const activities = rawActions
      .filter(a => !SKIP_TYPES.has(a.type))
      .map((a, i) => ({
        id:          i + 1,
        type:        mapType(a.type),
        rawType:     a.type,
        date:        getDate(a),
        description: describe(a),
        agent:       a.performed_by || a.assignee || detailFields.assignee || 'TeleCRM',
      }));

    // Step 4: commission from PAYMENT actions
    const payments          = rawActions.filter(a => a.type === 'PAYMENT');
    const earnedCommission  = payments
      .filter(p => p.status === 'COMPLETED')
      .reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const pendingCommission = payments
      .filter(p => p.status !== 'COMPLETED')
      .reduce((s, p) => s + (Number(p.amount) || 0), 0);

    res.status(200).json({
      name:       detailFields.name   || email,
      email:      detailFields.email  || email,
      phone:      detailFields.phone  || null,
      status:     detailFields.status || null,
      activities,
      deal: {
        title: detailFields.status || 'Active Lead',
        stage: detailFields.status || '—',
        value: detailFields.deal_value || null,
      },
      commission: {
        earned:   earnedCommission,
        pending:  pendingCommission,
        currency: 'INR',
      },
    });

  } catch (err) {
    console.error('[activity] TeleCRM error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
