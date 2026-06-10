// Shared TeleCRM Sync API helpers — used by metrics.js, leads.js,
// lead-detail.js, and commission.js.
//
// NOTE: files/folders prefixed with `_` under /api are NOT deployed as
// Vercel Functions, so this module is safe to require() from handlers.

const MASTER_ID     = process.env.TELECRM_ENTERPRISE_ID;
const MASTER_TOKEN  = process.env.TELECRM_SYNC_TOKEN;
const PARTNER_ID    = process.env.TELECRM_PARTNERSHIP_ENTERPRISE_ID;
const PARTNER_TOKEN = process.env.TELECRM_PARTNERSHIP_SYNC_TOKEN;
const BASE          = 'https://next.telecrm.in/autoupdate/v2';

const CLOSED_STATUSES = ['Won', 'Lost', 'Closed', 'Payment Done', 'Payment Pending'];

// Statuses whose lead history may carry commission/payment actions.
const COMMISSION_STATUSES = ['Won', 'Payment Done', 'Payment Pending'];

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

async function searchLeads(token, enterpriseId, fields, skip = 0, limit = 50) {
  return tcrm(token, `/enterprise/${enterpriseId}/lead/search?skip=${skip}&limit=${limit}`, 'POST', { fields });
}

async function countLeads(token, enterpriseId, assigneeEmail, status = null) {
  const fields = { assignee: assigneeEmail };
  if (status) fields.status = status;
  const r = await searchLeads(token, enterpriseId, fields, 0, 1);
  if (r.status !== 200) return null;
  return r.body?.total_count ?? null;
}

async function getLeadDetail(token, enterpriseId, id, { includeActions = false, limit = 100 } = {}) {
  const qs = includeActions ? `?includeActions=true&limit=${limit}` : '';
  return tcrm(token, `/enterprise/${enterpriseId}/lead/${id}${qs}`);
}

// Fetch every team member in the master workspace ({name, email}), paginated
// 10 at a time, cached in-memory for the lifetime of the warm serverless
// instance. Used by the admin monthly report to map a lead's `employeeid`
// (the affiliate's master-workspace login email) to a display name.
let _teamMembersCache = null;
async function getAllTeamMembers() {
  if (_teamMembersCache) return _teamMembersCache;

  const first = await tcrm(MASTER_TOKEN, `/enterprise/${MASTER_ID}/team-members?limit=10&skip=0`);
  if (first.status !== 200) return [];

  const totalCount = first.body?.total_count || 0;
  const allPages   = [first.body?.data || []];

  const remaining = Math.ceil((totalCount - 10) / 10);
  if (remaining > 0) {
    const skips = Array.from({ length: remaining }, (_, i) => (i + 1) * 10);
    for (let i = 0; i < skips.length; i += 10) {
      const batch = await Promise.all(
        skips.slice(i, i + 10).map(skip =>
          tcrm(MASTER_TOKEN, `/enterprise/${MASTER_ID}/team-members?limit=10&skip=${skip}`)
        )
      );
      allPages.push(...batch.map(r => r.body?.data || []));
    }
  }

  _teamMembersCache = allPages.flat().map(m => ({
    name:  m.name || null,
    email: (m.email || '').toLowerCase(),
  }));
  return _teamMembersCache;
}

// Find a team member's login email in the master workspace by matching their name.
// Fetches first page to get total_count, then searches all pages in parallel batches.
async function findMasterEmail(name) {
  if (!name) return null;
  const nameLower = name.toLowerCase().trim();

  const first = await tcrm(MASTER_TOKEN, `/enterprise/${MASTER_ID}/team-members?limit=10&skip=0`);
  if (first.status !== 200) return null;

  const totalCount = first.body?.total_count || 0;
  const allPages   = [first.body?.data || []];

  const remaining = Math.ceil((totalCount - 10) / 10);
  if (remaining > 0) {
    const skips = Array.from({ length: remaining }, (_, i) => (i + 1) * 10);
    for (let i = 0; i < skips.length; i += 10) {
      const batch = await Promise.all(
        skips.slice(i, i + 10).map(skip =>
          tcrm(MASTER_TOKEN, `/enterprise/${MASTER_ID}/team-members?limit=10&skip=${skip}`)
        )
      );
      allPages.push(...batch.map(r => r.body?.data || []));
    }
  }

  const allMembers = allPages.flat();
  const match = allMembers.find(m => {
    const mName = (m.name || '').toLowerCase();
    return mName === nameLower || mName.includes(nameLower) || nameLower.includes(mName);
  });
  return match?.email || null;
}

// Extract unique payment/commission records from a lead's action history.
//
// TeleCRM automation flows record two kinds of custom actions on a "Won" lead:
//   - an "order" action      with fields { sop_amount, number_of_license, discount_given? }
//   - a  "commission" action with fields { notes (commission %), commission_amount, total_amount_paid }
//
// The action `type` codes for these (e.g. ACTION_1001, ACTION_1004, ACTION_1005)
// vary between leads, and a commission calc is sometimes re-run a few seconds
// later producing a near-duplicate action with a slightly corrected amount.
// So we match on field shape (not type code), and de-duplicate by keeping only
// the most recent action per distinct amount — i.e. unique payment events.
function extractPayments(actions = []) {
  const commissionEvents = [];
  const orderEvents      = [];

  for (const a of actions) {
    const f = a.fields;
    if (!f) continue;
    const ts = a.creationTimestamp || a.modificationTimestamp || 0;

    if (f.commission_amount !== undefined) {
      commissionEvents.push({
        ts,
        total_amount_paid: f.total_amount_paid ?? null,
        commission_pct:    f.notes ?? null,
        commission_amount: f.commission_amount,
      });
    }
    if (f.sop_amount !== undefined || f.number_of_license !== undefined) {
      orderEvents.push({
        ts,
        amount:   f.sop_amount ?? null,
        licenses: f.number_of_license ?? null,
        discount: f.discount_given ?? null,
      });
    }
  }

  // Keep only the latest event per distinct amount value.
  const dedupe = (events, key) => {
    const byKey = new Map();
    for (const e of events) {
      const k = e[key] ?? '__none__';
      const existing = byKey.get(k);
      if (!existing || e.ts > existing.ts) byKey.set(k, e);
    }
    return [...byKey.values()];
  };

  const commissions = dedupe(commissionEvents, 'total_amount_paid');
  const orders      = dedupe(orderEvents, 'amount');

  // Merge a commission record with an order record that shares the same amount.
  const merged     = [];
  const usedOrders = new Set();

  for (const c of commissions) {
    let order = null;
    for (let i = 0; i < orders.length; i++) {
      if (!usedOrders.has(i) && orders[i].amount === c.total_amount_paid) {
        order = orders[i];
        usedOrders.add(i);
        break;
      }
    }
    merged.push({
      date:              new Date(Math.max(c.ts, order?.ts || 0)).toISOString(),
      amount:            c.total_amount_paid ?? order?.amount ?? null,
      licenses:          order?.licenses ?? null,
      discount:          order?.discount ?? null,
      commission_pct:    c.commission_pct,
      commission_amount: c.commission_amount,
    });
  }

  // Order records with no matching commission record yet (license sold,
  // commission not logged) — still surface them with commission_amount: null.
  orders.forEach((o, i) => {
    if (usedOrders.has(i)) return;
    merged.push({
      date:              new Date(o.ts).toISOString(),
      amount:            o.amount,
      licenses:          o.licenses,
      discount:          o.discount,
      commission_pct:    null,
      commission_amount: null,
    });
  });

  return merged.sort((a, b) => new Date(b.date) - new Date(a.date));
}

module.exports = {
  MASTER_ID, MASTER_TOKEN, PARTNER_ID, PARTNER_TOKEN, BASE,
  CLOSED_STATUSES, COMMISSION_STATUSES,
  tcrm, searchLeads, countLeads, getLeadDetail, findMasterEmail, extractPayments,
  getAllTeamMembers,
};
