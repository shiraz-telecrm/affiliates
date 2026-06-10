# TeleCRM Affiliates Portal — Project Handoff

> Last updated: 2026-06-10 (after commit `f6f29f7`)
> Purpose: a dashboard where TeleCRM affiliates/partners log in (eventually via
> Google) and see their own live performance data — commission, KYC, lead
> funnel, bank details — pulled from two separate TeleCRM workspaces.

---

## 1. High-level architecture

```
Browser
  │
  ├─ index.html      (login / email entry)
  ├─ metrics.html     (main dashboard — funnel, commission, bank, drawer)
  └─ activity.html    (per-lead activity timeline — OLD dark theme, not redesigned)
        │
        ▼  fetch (CORS, same-origin on Vercel)
Vercel serverless functions (/api/*.js, Node.js, CommonJS)
  ├─ /api/health         → liveness check
  ├─ /api/metrics         → combined affiliate profile (dual workspace)
  ├─ /api/leads            → lead list + status, for the funnel drawer
  ├─ /api/activity         → lead activity timeline (master workspace only)
  └─ /api/debug-team       → TEMP debug endpoint, should be removed
        │
        ▼  Bearer token auth
TeleCRM Sync API (https://next.telecrm.in/autoupdate/v2)
  ├─ Partnership workspace  (enterprise 641ec6ef0768bd0005a8a825)
  │     affiliates exist as LEADS with custom fields:
  │     percentage, earnings, pending_commission, kyc_status,
  │     affiliate_type, payment_details, ifsc_code_1, created_on, etc.
  │
  └─ Master Affiliate workspace (enterprise 685a4a7c11a1e1525fad6d06)
        same people exist as TEAM MEMBERS / ASSIGNEES
        customer leads are assigned to them, counted by status
        (Won / Lost / Payment Pending / Payment Done / Closed / Open)
```

**Why two workspaces?** The partnership workspace is where affiliate
admin/commission data lives. The master affiliate workspace is the sales
pipeline where the affiliate's referred leads actually get worked — the
portal stitches both together per affiliate.

---

## 2. Repo & deployment

- **Local path:** `/Users/shiraz/Documents/Telecrm/affiliates`
- **GitHub remote:** `git@github-telecrm:shiraz-telecrm/affiliates.git`
  (uses SSH alias `github-telecrm` → `~/.ssh/id_ed25519_telecrm`)
- **Local git identity for this repo:** `Shiraz <shiraz@telecrm.in>`
- **Vercel project:** auto-deploys on push to `main`
  - Production URL: `https://affiliates-lac.vercel.app`
  - Preview URLs follow the `affiliates-<hash>-shiraz-telecrm-s-projects.vercel.app` pattern
- **Vercel CLI is NOT installed locally.** All deploys so far have happened
  via git push → Vercel's GitHub integration. (`npm i -g vercel` would unlock
  `vercel env pull` / `vercel logs` / `vercel deploy` if needed.)

### Required Vercel environment variables (Production)

| Variable | Workspace | Used by |
|---|---|---|
| `TELECRM_ENTERPRISE_ID` | Master Affiliate (`685a4a7c11a1e1525fad6d06`) | metrics.js, leads.js, activity.js, health.js (debug), debug-team.js |
| `TELECRM_SYNC_TOKEN` | Master Affiliate | same as above |
| `TELECRM_PARTNERSHIP_ENTERPRISE_ID` | Partnership (`641ec6ef0768bd0005a8a825`) | metrics.js |
| `TELECRM_PARTNERSHIP_SYNC_TOKEN` | Partnership | metrics.js |

⚠️ **Gotcha already hit once:** Vercel's "Add env var" dialog has separate
**Value** and **Note** fields — values were once accidentally pasted into
**Note**, leaving Value empty, which made `/api/metrics` return
`"Server not configured — env vars missing"` even though the vars "existed".
If this error reappears, check the Value field first.

---

## 3. File map

| File | Status | Notes |
|---|---|---|
| `index.html` | ✅ Redesigned (light theme) | Email entry → redirects to `metrics.html?email=X` |
| `metrics.html` | ✅ Redesigned (light theme), ~605 lines | Main dashboard — see §5 |
| `activity.html` | ⚠️ NOT redesigned, ~300 lines | Still old dark theme (`#0f172a`/`#1e293b`). Per-lead timeline, fed by `/api/activity` |
| `api/health.js` | ✅ Stable | `{status:'ok', timestamp}` |
| `api/metrics.js` | ✅ Working, last fixed in f6f29f7 | Dual-workspace aggregation — see §4 |
| `api/leads.js` | ✅ Working | Lead list for drawer — see §4 |
| `api/activity.js` | ⚠️ Working but timestamps are `null` | See ROADMAP #9 |
| `api/debug-team.js` | 🗑️ TEMPORARY | Should be deleted once Harika fix confirmed (see §6) |
| `vercel.json` | ✅ Stable | CORS headers only, no `functions` block (auto-detected Node runtime) |
| `ROADMAP.md` | ✅ Living doc | 14 tracked items, see §7 |

---

## 4. API contracts

### `GET /api/health`
Returns `{ status: 'ok', timestamp }`.

### `GET /api/metrics?email=<email>`
Combined affiliate profile. Steps:
1. Search partnership workspace lead by `email` → 404 if not found.
2. Fetch full lead detail (`/lead/{id}`) for custom fields.
3. Resolve the affiliate's **assignee email in the master workspace**:
   - First try `countLeads(MASTER, email)`.
   - If 0/null, call `findMasterEmail(name)` which paginates through **all
     217 team members** (10/page, parallel batches of 10 pages) and
     fuzzy-matches by name (`includes`/`===`, case-insensitive).
   - If a different email is found, re-query counts with that email
     (this re-query bug — using `cachedTotal=0` instead of re-querying —
     was the f6f29f7 fix).
4. Count total + per-status leads in master workspace
   (`CLOSED_STATUSES = ['Won','Lost','Closed','Payment Done','Payment Pending']`,
   queried individually in parallel because TeleCRM 500s on combined
   `assignee` + `status[]` searches).

Response shape:
```jsonc
{
  "name": "...", "email": "...", "phone": "...",
  "status": "...", "kyc_status": "...", "affiliate_type": "...",
  "member_since": "ISO date or null",   // from fields.created_on (Unix ms)
  "last_updated": "ISO date or null",   // from fields.modified_on
  "commission": { "percentage": 10, "earned": 1234, "pending": 0, "currency": "INR" },
  "bank": { "payment_details": "free text blob or null", "ifsc_code": "..." },
  "leads": {
    "total": 8, "closed": 3, "open": 5,
    "breakdown": { "Won": 2, "Payment Pending": 1 }
  }
}
```

### `GET /api/leads?email=<email>&name=<name>&status=<status|__open__>&skip=&limit=`
Returns the actual lead list for the funnel drawer. Has its **own copy** of
`findMasterEmail()` (duplicated from metrics.js — candidate for shared
util). Returns `assignee_resolved` so the frontend/debugger can see which
email was actually used for the search.

⚠️ `status=__open__` is currently a **no-op** — TeleCRM has no "not in"
filter, so "Open" can't be queried directly server-side yet (see ROADMAP #7/#8
overlap — not formally tracked as its own item, worth adding).

```jsonc
{
  "leads": [ { "id": "...", "name": "...", "email": "...", "phone": "...", "status": "Won" } ],
  "total_count": 8, "skip": 0, "limit": 50,
  "assignee_resolved": "harika@..."
}
```

### `GET /api/activity?email=<email>`
Lead timeline from the **master workspace only**. Maps TeleCRM action types
→ `{call, payment, email, lead_created, deal_created, note}` for icons.
**Known bug:** all `date` fields are `null` because `includeActions=true`
doesn't return timestamps (ROADMAP #9 — fix is to switch to
`POST /lead/{id}/action/search`).

### `GET /api/debug-team`
Returns raw page-1 response of `/enterprise/{MASTER_ID}/team-members?limit=10&skip=0`.
Confirmed: `{ data: [...], total_count: 217, skip, limit }`, each member has
`name`, `email`, `status`. **Temporary — delete once confirmed unneeded.**

---

## 5. `metrics.html` structure (light theme)

- Sticky dark topbar (`#0f172a`) — brand only, no nav yet.
- Profile header: avatar initial, name, email, status/affiliate-type badges.
- Commission stat cards: Total Earned, Pending Payout, Commission Rate.
- **Lead funnel** — clickable rows (Total Assigned / Won / Payment Pending /
  Lost / Open), each with a horizontal bar. Click → `openDrawer(label,
  status, barColor, textColor)`.
- Tenure card (member since / last updated, from `member_since`/`last_updated`).
- Bank details grid (`payment_details`, `ifsc_code`) + a disabled
  **"Update Details"** button (`title="Coming soon — Phase 3"`).
- **Drawer** (slides in from right): lead list with status pills
  (`pill-won` green / `pill-lost` red / `pill-pending` amber / `pill-open`
  gray), "Load more" pagination via `fetchLeads()`.
- `API_BASE`: `''` (same-origin) when on Vercel; falls back to
  `https://affiliates-lac.vercel.app` for `localhost`/`file://` testing.

**Light theme tokens** (reuse for `activity.html` redesign):
- Page bg `#f1f5f9`, cards `#ffffff`, borders `#e2e8f0`
- Topbar/dark text `#0f172a`, muted text `#64748b` / `#94a3b8`
- Accent blue `#2563eb`
- Status pills: Won `#dcfce7`/`#15803d`, Lost `#fee2e2`/`#dc2626`,
  Pending `#fef3c7`/`#b45309`, Open/neutral `#f1f5f9`/`#475569`

---

## 6. ⚠️ Unverified — first thing to check next session

Commit `f6f29f7` ("Fix team member lookup: search all 217 members, fix email
re-query bug") was pushed but **never live-tested**. The original bug report:

> `https://affiliates-lac.vercel.app/metrics.html?email=harika.govathati123@gmail.com`
> returned `leads.total: 0`, even though Harika has multiple leads assigned
> to her (as "Harika") in the master workspace's sales pipeline.

**Next step:** hit that URL again (Vercel should have redeployed
automatically from the push). Check:
- Is `leads.total` now > 0?
- If still 0, call `/api/leads?email=harika.govathati123@gmail.com&name=Harika&status=`
  and inspect the `assignee_resolved` field — does it match Harika's actual
  master-workspace login email/name?
- Cross-check against `/api/debug-team` (paginate manually with `?skip=`) to
  find Harika's exact `name`/`email` entry in the 217 team members.

If it works: delete `api/debug-team.js` and remove its route.
If it doesn't: the fuzzy name match in `findMasterEmail()` may need
loosening (e.g. first-name-only match), or this becomes the forcing function
for ROADMAP #1 (`telecrm_master_email` custom field — the proper fix).

---

## 7. Known issues / outstanding work (ROADMAP.md has full detail)

🔴 Critical:
1. No `telecrm_master_email` field — relying on fragile name-matching fallback
2. `CLOSED_STATUSES` hardcoded in two files
3. `earnings`/`pending_commission` are manually maintained, can go stale

🟡 Features:
4. Bank details self-update form (button stubbed, disabled)
5. Phase 3 — Google Login (currently `?email=X` exposes anyone's data — no auth at all)
6. Phase 3b — OTP login fallback
7. Drawer pagination is "Load more" only, not infinite scroll
8. Lead drill-down from drawer → activity.html not yet linked
9. `activity.html` action timestamps are all `null`
10. No per-lead commission breakdown

🟢 Infra:
11. Split frontend to GitHub Pages, keep API on Vercel
12. Cache TeleCRM responses (rate limit 3,600/hr, ~6-7 calls per page load)
13. Vercel CLI auth for CI/CD
14. `.DS_Store` tracked in git — should be removed

Plus two items not yet in ROADMAP.md:
- `api/debug-team.js` should be removed once §6 is resolved
- `api/leads.js` duplicates `findMasterEmail()` from `api/metrics.js` — extract
  to a shared module (e.g. `api/_lib/teleCrm.js`)
- `activity.html` redesign to light theme (parallel to metrics.html/index.html)

---

## 8. Useful test data

- Working example (full data, both workspaces resolve cleanly):
  `saurabh@growmedico.com`
- Edge case (different login email per workspace, name-match fallback path):
  `harika.govathati123@gmail.com` (master workspace name: "Harika")
- 404 case (partnership workspace lookup fails — expected):
  `divya@mentormyboard.com`

---

## 9. Suggested order of work for next session

1. Verify Harika fix live (§6) — fix or escalate to ROADMAP #1 if still broken.
2. Remove `api/debug-team.js` once confirmed unnecessary.
3. Redesign `activity.html` to match the light theme (§5 token list).
4. Tackle ROADMAP #1 (`telecrm_master_email` field) to remove fuzzy matching
   entirely — biggest data-integrity win for least effort.
5. Extract shared `findMasterEmail`/`tcrm`/`countLeads` helpers into
   `api/_lib/` to remove duplication between `metrics.js` and `leads.js`.
6. Start Phase 3 (Google Login) once core data is reliable — currently zero
   auth on `/api/metrics` and `/api/leads`.
