# Marketplace v1 MVP — Closeout Record

**Status:** ✅ MARKETPLACE V1 MVP — COMPLETE
**Date of closeout:** 2026-06-21
**Repository:** `kudzimusar/carup`
**main commit at closeout:** `3c30e2c7aae712728a2aab73ac698bdeeab5394c`

This is the permanent repository record for the Marketplace v1 MVP workstream. It is documentation only; it makes no code or database change.

---

## 1. Completion status

The governed Marketplace v1 MVP is delivered, merged to `main`, and live in production. The end-to-end buyer / seller / admin / mobile loop is functional, and production and staging deployments are green.

This MVP intentionally delivers a focused, governed core. Items listed under "Deferred backlog" are out of scope for v1 by design.

---

## 2. Scope delivered

### Buyer
- Public Marketplace browse with category chips and search (make, model, location, VIN, plate, chassis).
- Listing detail / VIN Passport view with trust and verification summaries.
- Saved cars (server-backed) and cross-listing comparison.
- Buyer inquiries to sellers.
- Private-seller details are not exposed on public cards.

### Seller
- Create and manage listings.
- "My listings" with accurate status handling (including sold status).
- Seller inquiry cards with per-seller isolation.

### Admin
- Marketplace moderation / governance workflow.
- Admin authorization enforced on moderation actions.

### Mobile
- Marketplace detail flow and status refresh.
- Mobile/back-end API convergence with the web surface.

---

## 3. Merged PRs and commit SHAs

| Workstream | PR | Squash merge commit |
|---|---|---|
| Marketplace v1 integration (backend, web, mobile) | [#73](https://github.com/kudzimusar/carup/pull/73) | `4435a4a18679c74a7182ecd328d4031802500c83` |
| Database access-control containment tranche | [#83](https://github.com/kudzimusar/carup/pull/83) | `3c30e2c7aae712728a2aab73ac698bdeeab5394c` |

Both squash commits are present on `main`.

---

## 4. Production URLs and smoke-test results

- Production Marketplace: <https://carup.vercel.app/marketplace>
- Production home: <https://carup.vercel.app/>

Smoke tests at closeout (read-only):

| Check | Result |
|---|---|
| `GET /marketplace` (production frontend) | 200 |
| `GET /` (production frontend) | 200 |
| Production Marketplace listings API (read-only) | 200, valid JSON (`listings`, `total`, `limit`) |

Vercel deployments on `main` HEAD — combined status **success**:

- `carup` (production frontend): success
- `carup-backend` (production backend): success
- `carup-staging` (staging frontend): success
- `carup-backend-staging` (staging backend): success

---

## 5. Final automated test totals (on merged `main`)

| Suite | Result |
|---|---|
| Backend marketplace suite (`marketplace-*.test.js`) | 147/147 passed |
| Backend auth register-privilege contract | 8/8 passed |
| Backend user-sessions auth contract | 9/9 passed (1 opt-in live-staging check intentionally skipped) |
| Issue #77 containment follow-up static SQL review | 11/11 passed |
| Web unit (vitest) | 128/128 passed |
| Web TypeScript / Mobile TypeScript | passed |
| Web production build | succeeded |

---

## 6. Database / migration status

- **Marketplace inquiry production schema:** applied and verified.
- **Containment migrations** (delivered as code in PR #83; idempotent, non-destructive):
  - `database/migrations/20260619201406_production_access_containment.sql` — SHA-256 `9e85e828bb3c5f4f1e7ee70bcc55a8490c0d13137b1afeda7c7f62eb15717fbe`
  - `database/migrations/20260620232827_issue77_access_containment_followup.sql` — SHA-256 `0cf27ad5399d793c1b2fe9878a2c36ee8dbc3bcbb9aaff2327eea438f1788b6e`
- **Staging:** both migrations applied and verified on staging only (ledger versions `20260619201629` and `20260621001212`).
- **Production:** the containment migrations are **not** applied to the production database. Production application is a separately approved operation (see §7) and remains outstanding.

---

## 7. Security containment status

- Containment code is merged to `main` (PR #83).
- High-level categories: RLS enabled and direct anon/authenticated access removed from server-owned record domains (`service_role` preserved); least-privilege `EXECUTE` on a privileged admin helper; pinned `search_path` on security-relevant Row Level Security authorization helpers (kept `SECURITY INVOKER`).
- On staging: the two targeted "function search path mutable" advisor warnings are resolved and no new security ERROR was introduced.
- Production database security containment remains a **separately approved operation** and has not been applied.
- This closeout does **not** claim that all database security debt is eliminated; remaining findings are pre-existing and tracked under Issue #77.

---

## 8. Intentionally deferred backlog (post-MVP)

- SafePay settlement
- Dealer onboarding / billing
- Logistics tracking
- Advanced AI negotiation
- Rich analytics
- Mandatory photo workflows
- Vehicle Profile and Owner Dashboard truthfulness

---

## 9. Issue #77 — open public-launch security gate

[Issue #77](https://github.com/kudzimusar/carup/issues/77) remains **OPEN** and is a separate public-launch gate, independent of this Marketplace MVP closeout.

Remaining scope under Issue #77:
- Production application of the reviewed containment migrations (separately approved operation).
- Review and disposition of remaining pre-existing advisor findings (classified privately; staging-verified).
- Final public-launch security sign-off.

Issue #77 must not be closed by this closeout.

---

## 10. Superseded documentation PRs

The following planning documents were superseded by completed execution (Marketplace PR #73 and security PR #83 merged) and were closed. Historical branches were retained; closing them made no code or database change.

| PR | Title | Final state |
|---|---|---|
| [#80](https://github.com/kudzimusar/carup/pull/80) | docs: add Marketplace v1 completion goal-loop plan | CLOSED (superseded) |
| [#82](https://github.com/kudzimusar/carup/pull/82) | docs: add Issue 77 containment goal-loop plan | CLOSED (superseded) |

---

## 11. Rollback and operational notes

- Both containment migrations are **idempotent** (guarded by `to_regclass` / `to_regprocedure`) and **non-destructive** (no `DROP`/`DELETE`/`TRUNCATE`, no schema redesign, no blanket RLS).
- **Follow-up rollback:** restores the previous function definitions and their prior grants.
- **Original rollback:** restores the prior direct-role table grants and the prior RLS state where applicable.
- There is no destructive change to reverse.
- Pushing to `main` triggers normal Vercel CD (production/staging app redeploy). Merging code does not apply database migrations; the production database is unchanged by this workstream.
- Production database changes require the separately approved containment operation under Issue #77.

---

## 12. Out-of-scope / untouched

The following were intentionally not modified by this closeout and belong to separate workstreams requiring their own review: Issue #77, and PRs #81, #79, #76, #72, #66, #58, #11.

---

_This record contains no secrets, credentials, private database identifiers, internal hosts, or sensitive security findings._
