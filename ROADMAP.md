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

---

### 2. Closed status list is hardcoded
**Priority:** High · **Effort:** Low

`CLOSED_STATUSES = ['Won', 'Lost', 'Closed', 'Payment Done', 'Payment Pending']`
is hardcoded in `api/metrics.js` and `api/leads.js`.

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

TeleCRM's `includeActions=true` response doesn't return timestamps on action items.
All dates show `null` in the timeline.

**Fix:** Use `POST /lead/{id}/action/search` instead of `includeActions=true`.
The action search endpoint returns richer data including `performed_at`.

---

### 10. Commission breakdown by lead
**Priority:** Medium · **Effort:** Medium

Show which specific leads generated commission, not just the aggregate total.

**Plan:**
- Fetch `Won` leads for the assignee
- For each lead, show deal value × commission percentage
- Add a "Commission breakdown" tab in `metrics.html`

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

## ✅ Done

- [x] Phase 1 — Static frontend + Vercel backend scaffold
- [x] Phase 2 — Connect TeleCRM Sync API (partnership + master workspaces)
- [x] Dual-workspace metrics endpoint (`/api/metrics`)
- [x] Lead list drawer with status filter (`/api/leads`)
- [x] Bank details in metrics response
- [x] Name-based team member email fallback (Harika fix)
- [x] Remove sensitive fields (IFSC, bank account) from public response — **reversed: added back at owner's request for payout display**
