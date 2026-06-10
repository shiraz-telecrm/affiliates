# Affiliates Portal — Roadmap

> Living document. Add items as they surface during development.
> Format: **Priority** · **Effort** · Description

---

## 🔴 Critical / Data Integrity

### 1. Store `telecrm_master_email` in partnership workspace
**Priority:** High · **Effort:** Low (manual TeleCRM config)

Each affiliate's lead record in the **partnership workspace** should have a custom field
`telecrm_master_email` containing their login email in the **master affiliate workspace**.

**Why:** Currently, when a partner's Gmail (e.g. `harika.govathati123@gmail.com`) doesn't
match their TeleCRM team member login email, we fall back to a fuzzy name-based team member
lookup. This is fragile — two people with the same first name will break it.

**Fix:**
- Add custom field `telecrm_master_email` in partnership workspace
- Populate it for all existing affiliates
- `api/metrics.js` to read `f.telecrm_master_email` before falling back to name lookup

**Status:** Still open. `f6f29f7` expanded `findMasterEmail()` to search all 217
team members and fixed a re-query bug, but
`https://affiliates-lac.vercel.app/metrics.html?email=harika.govathati123@gmail.com`
still returns `leads.total: 0` — the name-match fallback isn't finding her
master-workspace assignee record. `api/debug-team.js` (temp endpoint) is kept
around until this is debugged further; see HANDOFF.md §6.

---

### 2. Closed status list is hardcoded
**Priority:** High · **Effort:** Low

`CLOSED_STATUSES = ['Won', 'Lost', 'Closed', 'Payment Done', 'Payment Pending']`
is hardcoded — now centralized in `api/_lib/telecrm.js` (shared by metrics.js,
leads.js, commission.js) instead of duplicated, but still a hardcoded list.

**Fix:** Fetch lead stage pipeline from TeleCRM Enterprise Metadata API
(`GET /enterprise/{id}/metadata`) and derive closed statuses dynamically,
or expose a `CLOSED_STATUSES` env var so it can be configured without a redeploy.

---

### 3. `earnings` and `pending_commission` are manually maintained
**Priority:** High · **Effort:** Medium

Fields like `earnings` and `pending_commission` in the partnership workspace are
custom fields updated manually. They can go stale.

**Fix:** Calculate commission automatically:
- Count `Won` leads × deal value × `percentage` from master affiliate workspace
- Store computed value or reconcile with manual field

---

## 🟡 Features / UX

### 4. Bank detail self-update form
**Priority:** High · **Effort:** Medium

The "Update Details" button in `metrics.html` is currently disabled.

**Plan:**
- Add `PUT /api/bank` endpoint that calls TeleCRM Async API to update
  `payment_details`, `ifsc_code_1` fields on the partnership workspace lead
- Add inline edit form in `metrics.html` with validation (IFSC format, account number)
- Require OTP or re-auth before saving (Phase 3)

---

### 5. Phase 3 — Google Login auth
**Priority:** High · **Effort:** High

Currently any URL with `?email=X` exposes any affiliate's data.

**Plan:**
- Add Google OAuth via a backend `/api/auth/google` endpoint
- Issue a short-lived JWT signed on the Vercel backend
- Backend reads email from JWT — never from query params
- Frontend stores JWT in `sessionStorage`, sends as `Authorization: Bearer`

---

### 6. Phase 3b — OTP login (fallback for non-Google users)
**Priority:** Medium · **Effort:** High

For affiliates without Google accounts.

**Plan:**
- `POST /api/otp/send` — send OTP to registered mobile/email
- `POST /api/otp/verify` — verify and issue JWT
- Needs SMS/email OTP provider (Twilio, MSG91, etc.)
- Rate limiting + abuse protection required

---

### 7. Pagination in lead drawer
**Priority:** Medium · **Effort:** Low

Lead drawer currently loads 50 at a time with a "Load more" button.

**Fix:** Add infinite scroll or a proper paginator so the UX feels native.

---

### 8. Lead detail drill-down
**Priority:** Medium · **Effort:** Medium

Clicking a lead name in the drawer should open its full activity timeline
(the `activity.html` page already exists — just needs to link through).

---

### 9. `activity.html` — fix action timestamps
**Priority:** Medium · **Effort:** Medium

~~TeleCRM's `includeActions=true` response doesn't return timestamps on action items.~~

**Resolved (root cause):** the timestamp field is `creationTimestamp` (Unix ms),
not `performed_at`/`created_at`/etc. `api/activity.js`'s `getDate()` now reads
`creationTimestamp` and converts to ISO. **Remaining:** `activity.html` itself
still has the old dark theme and was not part of the light-theme redesign —
that part of this item is still open.

---

### 10. Commission breakdown by lead — ✅ Done (v1)
**Priority:** Medium · **Effort:** Medium

Implemented via:
- `api/_lib/telecrm.js#extractPayments()` — parses a lead's action history for
  custom "order" actions (`sop_amount`, `number_of_license`, `discount_given`)
  and "commission" actions (`commission_amount`, `total_amount_paid`, `notes`
  as the commission %), matched by **field shape** (not action `type` code,
  which varies — e.g. `ACTION_1001`/`ACTION_1004`/`ACTION_1005`), and
  de-duplicated by keeping the latest action per distinct amount (TeleCRM
  automations sometimes log a corrected "v2" a few seconds after the original).
- `GET /api/lead-detail?id=<leadId>` — returns `{id, name, status, payments}`
  for a single lead. Powers the chevron expand row in the funnel drawer
  (`metrics.html`), lazily fetched on first expand and cached client-side.
- `GET /api/commission?email=&name=` — scans all `Won` / `Payment Done` /
  `Payment Pending` leads for the resolved assignee, extracts payments from
  each, and aggregates `commission_amount` by month. Powers the new
  "Monthly Commission" card on `metrics.html`.

**Follow-ups:**
- `extractPayments()` field-name heuristics were validated against 2 leads
  (`info@digibrat.in`'s "NS sheshegowda" and "Amruith"). Watch for other
  custom action shapes as more affiliates/leads are checked.
- `/api/commission` does an N+1 lead-detail fetch (one per Won/Payment
  lead) — fine for small affiliates, but combine with ROADMAP #12
  (caching) once affiliates with many closed leads are tested.
- No ownership check yet on `/api/lead-detail` or `/api/commission` — any
  lead `id` can be queried by anyone. Tie down once Phase 3 auth (#5) lands.

---

## 🟢 Infrastructure / DevOps

### 11. Move frontend to GitHub Pages, keep only API on Vercel
**Priority:** Low · **Effort:** Low

Currently everything (static HTML + API) lives on Vercel.
Long term, static pages can be on GitHub Pages (free, faster CDN)
with API calls crossing to Vercel.

**Note:** Requires updating `API_BASE` and CORS origins in `vercel.json`.

---

### 12. Cache TeleCRM responses
**Priority:** Low · **Effort:** Medium

Every page load fires 6–7 TeleCRM API calls. With rate limit of 3,600/hour,
this becomes a problem at scale.

**Fix:**
- Use Vercel KV (Redis) to cache metrics per email for 5–15 minutes
- Add `Cache-Control` headers on `/api/metrics` and `/api/leads`
- Add a `?refresh=1` param to bust cache on demand

---

### 13. Vercel CLI auth for CI/CD
**Priority:** Low · **Effort:** Low

`npx vercel` prompts for auth interactively, blocking automated workflows.

**Fix:** Store `VERCEL_TOKEN` as a GitHub secret and use
`npx vercel --token $VERCEL_TOKEN` in GitHub Actions.

---

### 14. Remove `.DS_Store` from git history
**Priority:** Low · **Effort:** Low

`.DS_Store` was committed early and is tracked by git.

**Fix:** Add to `.gitignore`, run `git rm --cached .DS_Store`, commit.

---

### 15. Admin monthly affiliate report — ✅ Done (v1)
**Priority:** High · **Effort:** Medium

`GET /api/admin/monthly-report?admin=shiraz@telecrm.in&month=YYYY-MM` and
`admin.html` give a cross-affiliate, month-by-month breakdown sourced from
the master workspace: per affiliate — leads won, total revenue, total
commission paid, and total licenses sold — plus a combined totals row.

Implementation:
- Scans every `Won` / `Payment Done` / `Payment Pending` lead in the master
  workspace (~191 as of June 2026), fetches each one's action history in
  concurrency-limited batches of 20, and reuses `extractPayments()` (same
  de-duped payment events as `/api/commission`), filtering to records whose
  `date` falls in the requested month.
- A lead is attributed to an affiliate via `fields.employeeid` (the
  affiliate's master-workspace login email — same value the `assignee`
  search filter matches against). Leads with no `employeeid` (direct /
  non-affiliate leads) are excluded.
- Affiliate display names come from `getAllTeamMembers()` (new helper in
  `_lib/telecrm.js`, paginates all master-workspace team members, cached
  per warm instance).
- "Leads won" = distinct leads with **any** payment event in the month,
  regardless of current status (so a `Payment Pending` lead with a May
  commission record still counts toward May).
- `vercel.json` sets `maxDuration: 60` for this function; live response
  for May 2026 (191 leads scanned, 19 affiliates) takes ~8s.
- Validated against May 2026: ₹8,36,101 total revenue, ₹86,092.38 total
  commission, 70 licenses, 37 leads across 19 affiliates.

**Follow-ups:**
- Admin gate is a hardcoded allowlist (`ADMIN_EMAILS = ['shiraz@telecrm.in']`
  in `api/admin/monthly-report.js`) — replace with real auth once Phase 3
  (#5) lands.
- April 2026 shows commission/licenses = 0 for every affiliate while
  revenue is non-zero — looks like the commission/order action automation
  wasn't fully in place that early; not a bug in this report, just sparser
  source data for older months.
- Some May affiliates show `commission: 0` despite revenue > 0 (e.g. Sahil
  Aggarwal, Vibhor Bhimsariya) — their leads have an order/amount action but
  no matching commission action logged yet in TeleCRM.
- `extractPayments()` date is a UTC ISO string sliced to `YYYY-MM` — late
  night IST events near month boundaries could be attributed to the
  adjacent UTC month. Low impact, not yet handled.
- Combine with #12 (caching) if this report is checked often — currently
  re-scans all ~191 leads on every request.

---

## ✅ Done

- [x] Phase 1 — Static frontend + Vercel backend scaffold
- [x] Phase 2 — Connect TeleCRM Sync API (partnership + master workspaces)
- [x] Dual-workspace metrics endpoint (`/api/metrics`)
- [x] Lead list drawer with status filter (`/api/leads`)
- [x] Bank details in metrics response
- [x] Name-based team member email fallback (Harika fix) — **partially: still
      returns 0 leads for Harika specifically, see item #1**
- [x] Remove sensitive fields (IFSC, bank account) from public response — **reversed: added back at owner's request for payout display**
- [x] Shared TeleCRM helpers extracted to `api/_lib/telecrm.js`
      (`tcrm`, `searchLeads`, `countLeads`, `getLeadDetail`, `findMasterEmail`,
      `extractPayments`, `CLOSED_STATUSES`) — removes duplication across
      metrics.js / leads.js / lead-detail.js / commission.js
- [x] Per-lead payment detail (chevron expand in funnel drawer) — `/api/lead-detail`
- [x] Monthly commission aggregation card on `metrics.html` — `/api/commission`
- [x] `activity.html` action timestamps fixed at the API level (`creationTimestamp`)
- [x] Robust bank-details parsing across differing `payment_details` formats
      (`Account Holder:` vs `Account holder name -` vs `Name:`, etc.) +
      surface Branch / Account Type fields on `metrics.html`
- [x] Admin monthly affiliate report (`admin.html`, `/api/admin/monthly-report`) — see #15
