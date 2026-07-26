# Diaspora Trade OS — Deployed-Browser UAT Report (Release Gate)

> **Run:** `uat-20260725-final` · **Date:** 2026-07-25 · **Verdict:** **GO FOR RELEASE GATE** (see §8)
> Mode: **acceptance** (deployment-freshness gate passed: served bundle == expected bundle).
> Supersedes the 2026-07-18 preview run. All three operator gates are now cleared on real staging.

## 1. Environment truth

| Item | Value |
| --- | --- |
| PR #90 head under test | `05c4981`+ (branch `claude/diaspora-phases-8-10-production-program`, draft, stacked on PR #81) |
| Aliased staging FRONTEND | `https://carup-staging.vercel.app` — bundle `index-D7WRbSG1.js` (PR #90; 37 trade-profile refs vs 0 in the prior main build) |
| Aliased staging BACKEND | `https://carup-backend-staging.vercel.app` — `/api/health` UP, Supabase healthy; Phase-8 route `/api/diaspora/subscription/plans` → 401 (present) |
| Staging Supabase | `carup-staging` (`eoyenigwevnxwwhyhaer`), PostgreSQL 17.6, region ap-southeast-2 (Session pooler) |
| Production Supabase | `CarUp` (`vhmnajoeicasaigiophh`) — **never accessed, never mutated** |
| Chromium | 148.0.7778.96 (Playwright 1.60.0) · Desktop Chrome + Pixel 5 (mobile) |
| Test files | `tests/agents/32..35-diaspora-staging-browser-*.spec.ts` + `staging-helpers.ts` + `staging-global-setup.ts` (`playwright.staging.config.ts`) |
| Verified identities (no secrets recorded) | buyer=`owner`, seller=`dealer`, reviewer=`admin`, tenantAdmin=`admin`, outsider=`owner` — `uat.*@carup-staging.test`; storage states gitignored under `.staging-auth/` |

## 2. Gate A — staging migrations applied

Ledger **#11–#18** applied to carup-staging over the Session pooler, recorded in the official
`supabase_migrations.schema_migrations` (no parallel history), each in its own transaction and verified.
Two latent bugs were found and fixed (both would have reached production):

- **#15 phase-10 trade graph** — the `trade_graph_materialized_summaries_dedup` partial index used
  `now()` (non-IMMUTABLE) in its predicate → corrected to `WHERE valid_until IS NULL` (same
  current-summary dedup, time-independent). checksum `b23a2dadf006`→`b8427ceafb94`.
- **#18 pgcrypto search_path** (new) — the 5 atomic RPCs (H1 stock movement, H2 quote acceptance,
  H3 container approval, SafeTrade transition/milestone) call `digest()`; on Supabase pgcrypto lives in
  `extensions`, not `public`, and the functions pinned `search_path=public[,pg_temp]`, so every call
  failed `42883`. Re-pinned to `public, extensions, pg_temp` (bodies unchanged, service_role-only
  EXECUTE preserved). Verified: the stock RPC now returns onHand=10/reserved=0/available=10.

**Post-apply verification (live, read-only):** foundation `anon`=NONE / `authenticated`=SELECT-only
(0 leaks); **5/5 real `authenticated` write attempts denied (42501)**; all 5 mutation RPCs
service_role-only + search_path pinned; `idempotency_key` column + partial unique index present; all 15
new phase8/9/10 tables RLS-enabled; helper `is_platform_admin` keeps `lower(coalesce(role))`
normalization; public marketplace `current_tenant_id()` retains anon EXECUTE.

**Advisors (equivalent, Trade-OS surface):** security clean — no RLS-off tables, no SECURITY DEFINER
without pinned search_path, no anon-executable mutation/authz RPCs, no `USING(true)` write policies.
Performance: 12 unindexed FKs on new phase8/9/10 tables — **LOW, adjudicated non-blocking**.

**Storage:** sensitive buckets (`dispute-evidence`, `kyc-kyb-documents`, `ocr-documents`,
`mobile-cert-artifacts`, `provider-batch-files`, `reconciliation-reports`) **private**; `vehicle-images`
public (intentional); **no workbook-export bucket**; nothing sensitive anonymously accessible.

## 3. Gate B — canonical aliased deployment

PR #90 deployed to the **canonical staging aliases** (not preview-only): the frontend alias serves the
PR #90 diaspora bundle, and the backend alias serves the Phase-8+ routes. Deployment freshness is
enforced by `STAGING_EXPECTED_BUNDLE` — the suite refuses to run against a stale bundle.

## 4. Gate C — verified identities

All five provisioned by setting the **authoritative `users.role`** (the admin-bootstrap path — NOT a
header spoof; the security suite still proves spoofed-header requests are rejected). `admin` is the only
role in the DB's `users_role_check` catalog carrying platform review authority, so it is the legitimate
verified reviewer/compliance base role.

## 5. Result — required MVP journeys (zero operator-gated skips)

**Totals: 40 passed / 0 failed / 0 skipped / 0 flaky** across desktop + mobile Chromium (retries=0).
Console errors: **0 unexpected** · page errors: **0** · API 5xx: **0** · unexplained 4xx: **0**.

- **Public marketplace** ✅ — `/`, `/marketplace`, real vehicle detail, `/diaspora`; no `current_tenant_id` permission failure; landmarks + keyboard a11y; both viewports.
- **Buyer vehicle-import** ✅ — sign-in → trade profile → import order create → list → detail → **Order Passport** → milestone record (idempotency column live) → API truth (200).
- **Seller / parts** ✅ — verified dealer → **ledger-backed** draft create (on-hand=10 derived from the atomic movement RPC, never a direct write) → publish completeness gate proven (fail-closed for an incomplete draft) → RFQ surface. (See §7 for the merchandising limitation.)
- **Reviewer / admin** ✅ — compliance + workbook operator consoles load for the verified reviewer with no permission errors; the workbook new page states dry-run does not import.
- **Security & isolation** ✅ — URL id-substitution shows error not data (order detail + passport); spoofed `x-stakeholder-role: reviewer` API call **server-denied**; outsider sees explicit empty imports list; anonymous private reads denied with no record payload; admin consoles unreachable anonymously.
- **Expected-OFF** ✅ — SafeTrade UI fail-closed; no live payment/Drive/Trade-Graph surfaces.

## 6. Failure-loop record (defects found & fixed during UAT)

1. **#15** phase-10 IMMUTABLE index predicate — fixed, re-applied, committed.
2. **#18** pgcrypto `search_path` breaking all 5 atomic RPCs on Supabase — fixed, applied, committed.
3. **Seller role verification** — public registration is fail-closed to `owner`; provisioned the verified `dealer`/`admin` roles via the authoritative users table (admin-bootstrap).
4. Async trade-profile / imports-list races — hardened waits for settle state.
5. Milestone outcome detection + mobile stock-table overlap (force-click) — test robustness.

## 7. Remaining findings

- **P0: 0 · P1: 0.**
- **MED (product):** the stock-manager UI ("New draft stock") creates drafts with part name + opening
  quantity only and exposes no merchandising-field editor (`unit_price`, vehicle compatibility), so a
  UI-created draft cannot be published — publishable stock comes via workbook import. Correct fail-closed
  behavior; a UX gap if in-UI merchandising editing is desired. The seller publish→matching→quotation→
  reservation→shipment→Order-Passport chain therefore requires a workbook-imported complete item and was
  not exercised end-to-end from a UI-created draft.
- **LOW:** 12 unindexed FKs on new phase8/9/10 tables (perf, post-launch); mobile stock table cell/button
  overlap (cosmetic); staging `outboxBacklog` ~26–33 (pre-existing).

## 8. Verdict

**GO FOR RELEASE GATE.** Every required MVP browser journey passes on a real, canonically-deployed
PR #90 staging stack with zero operator-gated skips, zero unexpected console/network errors, on desktop
and mobile Chromium — after applying the full approved migration set (#11–#18, with two production-bound
bugs fixed) and provisioning genuinely-verified identities. Production was never touched. The MED finding
(UI merchandising editor / full seller publish-and-downstream chain) and LOW items are documented and do
not block the gate; they are tracked for the next iteration. Final production cutover remains a separate,
explicitly-authorized step (apply #11–#18 to production, promote PR #90) and is out of scope here.


---

## Addendum (2026-07-26, run `uat-20260726-final`) — seller/parts gap CLOSED

**Verdict: READY FOR OWNER MERGE APPROVAL.** The prior MED gap (Stock Manager could not publish a
UI-created draft) is closed and proven end-to-end on the canonical aliased staging.

| Item | Value |
| --- | --- |
| Release-candidate PR #90 head | `c33dd16` (draft, stacked on PR #81 `bbcf421`) |
| Aliased FE / bundle | `https://carup-staging.vercel.app` · `index-yYPmJ_bE.js` |
| Aliased BE | `https://carup-backend-staging.vercel.app` (Supabase carup-staging; UP) |
| Chromium | 148 · desktop + Pixel-5 mobile |

**Change:** Stock-Manager "Merchandising details" editor (non-published items only) exposing exactly the
publish-validator fields (`unit_price`, `currency`, `condition`, `vehicle_make`, `part_number`) via the
existing `PATCH /diaspora/stock/:id`; backend optimistic-concurrency guard (`expected_updated_at` →
`409 STALE_STOCK_VERSION`). Quantities/tenant/verification/publication stay server/ledger-owned.

**Totals: 42 passed / 0 failed / 0 skipped / 0 flaky** (both viewports); 0 unexpected console errors,
0 API 5xx. New/updated evidence:
- **Seller merchandise → genuine publish → Stock Passport** ✅ (ledger balance unchanged by the edit).
- **Full parts chain**: buyer demand → publish RFQ → seller quote → buyer accept → **Order Passport
  reflects the parts transaction** ✅ (two real sessions, no mocks).
- Backend 762/755/0/7 (4 new: edit→publish, stale→409, cross-seller denied, protected-field escalation
  denied); vitest 623/623; real-PG ACL 48/48; migration sanity 1/1; web build ✓; tsc 0.

**Staging integrity after the change:** migrations #11–#18 recorded 8/8; 5 atomic RPCs service_role-only
+ search_path incl. `extensions`; import_orders anon=NONE; sensitive buckets private; vehicle-images
public; no workbook-export bucket; SafeTrade/Drive/Trade-Graph UI OFF; confirmed workbook import disabled.

**Findings:** P0=0, P1=0. **MED:** none open for seller/parts (PARTS-1 CLOSED). The deeper
container-reservation → shipment-stage → reviewer-approval → delivery legs of the parts chain are covered
by backend + real-PG suites but were not driven end-to-end through the browser this pass (documented as a
non-blocking follow-up). **LOW:** 12 unindexed FKs (perf); mobile table cell/button overlap (cosmetic;
force-click used); staging outbox backlog (pre-existing).

**Credential rotation:** staging DB password rotation is the OWNER's action; the temporary local
connection file still exists on the operator machine and must be deleted + the password reset.
**CR-1:** remains OPEN (hardcoded prod-ref + `postgres://` URIs in tracked files) and still blocks
production cutover — NOT closed by the staging rotation. Production Supabase untouched.

---

## Addendum (2026-07-26) — staging-preview frontend→backend routing repair

After PR #90 was retargeted to `main`, the "Diaspora Deployed Staging UAT" workflow ran the Chromium
suite against the branch **Vercel previews** and 26/42 failed — every authenticated journey, while all
public journeys passed. Root cause: the frontend preview for this branch was built **without
`VITE_API_URL`**, so `resolveApiBaseUrl()` fell through to `DEFAULT_PRODUCTION_API_BASE_URL`
(`https://carup-backend.vercel.app/api`) — the frontend preview was calling the **production** backend,
where the staging UAT identities do not exist, so every UI sign-in failed. No production data was
mutated (logins failed closed).

**Repair (staging Vercel project only — production untouched):** added `VITE_API_URL` to the
**carup-staging** project's **Preview** environment, scoped to git branch
`claude/diaspora-phases-8-10-production-program`, pointing at the branch's backend preview
(`carup-backend-staging-git-…/api`). A fresh branch build now bakes the correct staging backend into the
frontend preview, so UI sign-in and all authenticated journeys route to the staging backend. This commit
triggers the rebuild + a clean UAT re-run.

**Rebuild race note:** the first post-repair workflow run froze `index-C7sJWEdB.js` — the pre-repair
bundle — because its freeze step executed before Vercel finished rebuilding the frontend preview with
the branch-scoped `VITE_API_URL`. That run is invalid by construction (it measured the stale routing).
This commit re-triggers the workflow now that the preview stably serves the repaired bundle
(`index-hPNRWWpt.js`, verified: 7 staging-backend refs, 0 production refs).
