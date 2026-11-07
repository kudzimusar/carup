# CARUP-DEALER-ONB-001-LR01-R6 — integration readiness package (PREPARED, NOT ACTIVATED)

**Status:** engineering package for independent acceptance. Nothing in this document has been executed against a shared, staging or production system. No merge, deployment, preview alias, shared-database migration, real dealer publication or payment has been performed. Draft PR #258 stays open and unmerged. Each step below needs the separate, explicit Owner authority named in its row.

The exact frozen code SHA, run IDs and register outcome are named in the R6 return comment on PR #258 and in `R4_67_CASE_EVIDENCE_REGISTER.md` (generated from the run JSON). This document supersedes §1–§5 and §7 of `R5_STAGING_ACTIVATION_PACKAGE_AND_OWNER_DECISIONS.md` where they differ; that file keeps the Owner decision register (§6).

## 1. What R6 delivered (work packages A–F)

| Package | Delivered | Evidence |
|---|---|---|
| **A — C02 workbook activation** | Migration `20261103144000`: in the SAME transaction as the governed activation, every valid branch of the frozen approved application (address, declared GPS pair, visitor hours) is carried into canonical `dealer_branches`; dealer-level policy tabs become version 1 of the existing private declaration sections. Nothing is verified, public or approved. Duplicate/markup/invalid-GPS/over-long values are refused; branch-level policy conflicts are not merged; every submitted field gets one append-only provenance row (SHA-256 only). Input bounded by the intake contract (DBA review 2 #8). Owner read `GET /api/dealer/activation-carryover` + dashboard panel that also states what was retained without an operating field. | SQL `DEALER_R6_C02_CARRYOVER` (PGlite + native PG17); `dealer-activation-carryover.test.js`; browser: prelegal workbook declares a 2nd branch + terms once, legal phase asserts they arrive without retyping (BUYER_ASSURANCE v1 carried, v2 owner edit); golden custody verifier asserts crosswalk + provenance |
| **B — canonical refusals** | `dealerCanonicalWriteRefusal.js`: an EXACT dealership guard refusal (SQLSTATE P0001 + known code) on `POST /api/vehicles/:vin/publish` (and other vehicle writes), `POST /api/marketplace/inquiries` and the seller-claim write is a documented 4xx — authority not current → **409**, not the approved owner / independent reviewer → **403**, missing declared listing facts → **422**. Everything else (incl. the READ COMMITTED misconfiguration codes) stays a genuine 5xx. No new route; the canonical gate is unchanged. | `dealer-canonical-write-refusal.test.js` (+ mutation); phase 7: 409 + code on suspended publish, suspended enquiry, revoked republish, replayed republish and revoked enquiry |
| **C — security** | Migrations `20261103145000` + `20261103146000`: reviewer conflict-of-interest guards on every decision ledger (incl. duplicate redirects both seeds, grouping, buyer complaints); legacy compliance decisions refused on activated dealers; dual-control CLOSE_INVESTIGATION; takedown laundering closed (different reviewer from every takedown since the last public prelisting); real-publication gate fail-closed on insert AND at read time (O12); per-reviewer step-up lockout (5 / 15 min, reserved before the password check) on every reviewer path incl. the legacy decision route; bounded anonymous media (metadata list ≤12, one hash-checked image ≤4 MiB per request, re-authorised each request, 60/min/IP); bounded ticket issuance (24 items/48 tickets per call, ≤96 outstanding, ≤480/10 min per reviewer); ticket RPCs on DB clock with pinned `search_path`; per-account owner write limits; least privilege under Supabase default grants (service_role keeps only what the backend uses). | Harness blocks `DEALER_R6_*`, `DEALER_R6R2_*`; `dealer-r6-security-hardening.test.js` (18), `dealer-r6-review-hardening.test.js`; 21/21 + 14/14 mutants killed (agent-reported, harness-reproducible) |
| **D — DBA** | One lock order `tenants → dealer_profiles → all the tenant's VINs ascending by (tenant_id, vin) → dealer_approved_seed_links`; bounded 40P01/40001 retry on whole-transaction listing/lifecycle RPCs; non-stalling lapse sweep (per-tenant subtransaction, 2 s lock wait, skip recorded, `statement_timeout` in the cron command); READ COMMITTED guards incl. enquiries; `WHEN` clauses on withdrawal triggers; custody-refusing Downs for 120000–123000 and 132000; 125000 Down keeps the self-grant barrier; `SET LOCAL lock_timeout = '3s'` in every Up and Down; one-transaction-per-migration runner. | `R6_DBA_OPERATIONS_AND_LOCK_ORDER.md`; harness `DEALER_R6_LOCK_ORDER`, `DEALER_R6_LOCK_TIMEOUT`, `DEALER_R6_DOWN_LOCK_TIMEOUT`, `DEALER_R6_ROLLBACK_*`; `applyDealerMigrations.mjs` (+6 tests) |
| **E — functional integration** | C12 workbench: own activated-dealer queue, RENEW targets chosen from recorded newer legal reviews, suspension reason shown to the next reviewer, dual-control physically proven; activated dealer SEES suspension/withdrawal/expiry/investigation and the governed way back; legal reviewer picks evidence (full ids, class, size, date) and sees the dealer per case; legacy `/dealer/*` bookmarks redirect an activated owner to the canonical workspace while legacy role="dealer" accounts keep main's original `/dealer` overview and routes; blank intake template linked from the claim page; guest claim sign-in returns to the claim; unreachable membership-summary route retired. | Phase 7 first test (workbench suspend → refused self-reinstate by code → owner sees status → different reviewer reinstates with reason visible → deliberate republish); legal phase (pickers, legacy redirects, billing); prelegal (template, closed-browser resume, guest return-to) |
| **F — verification** | Full backend/web/source suites, 23 migrations on PGlite + native PG17, exact-head CI and the 7-phase browser proof; register regenerated from the run JSON; three independent agent reviews per round (advisory). | Return comment; register |

## 2. Migration sequence (23 additive, filename order) and rehearsal

`20261103120000` → `20261103146000`. Rehearsal on a **staging clone only** (Owner authority O1):

1. Record the clone's PITR marker.
2. Apply with `node backend/scripts/dealership/applyDealerMigrations.mjs --url=<clone direct session URL> --allow-non-loopback --confirm-target=<host>:<port>/<database>`: one transaction per migration, stop and roll back on the first error; transaction-mode poolers (port 6543) are refused; the target never comes from `DATABASE_URL`.
3. Run the harness semantics against the clone, EXPLAIN the guard lookups on clone-sized data, and confirm `deadlock_timeout` < 2 s on the target.
4. Rollback rehearsal: every Down refuses while its custody rows exist (`CANNOT_ROLLBACK_WITH_*`) — the correct back-out is the kill switch, not a destructive Down.
5. Only then (separate authority) staging, then (separate authority) production.

## 3. Kill switches (no data destroyed)

| Level | Action | Effect |
|---|---|---|
| K1 UI | Remove the dealership routes / nav and redeploy web | dealers and reviewers lose the UI |
| K2 API | Unmount `dealerRouter` / the dealership research router | dealership API off; canonical Marketplace unaffected |
| K3 canonical triggers | `DROP TRIGGER` the guards on `vehicles`, `vehicle_evidence`, `vehicle_seller_authority`, `marketplace_inquiries`, `tenants`, `tenant_users`, `dealer_profiles` (list in `R4_INTEGRATION_ROLLBACK_AND_RELEASE_GATES.md` / `R6_DBA_OPERATIONS_AND_LOCK_ORDER.md`) | canonical writes no longer consult dealership authority |
| K3b carry-over | `DROP TRIGGER dealer_activation_workbook_carryover ON dealer_approved_seed_links` | activation still works (first branch + names only) |
| K4 schedule | `SELECT cron.unschedule('carup-dealer-listing-lapse-sweep')` | lapse sweep stops |
| K5 emergency containment | `R6_DBA_OPERATIONS_AND_LOCK_ORDER.md` recipe (locks VINs in `(tenant_id, vin)` order) | withdraw a tenant's public stock immediately |

## 4. Environment and runtime

- No new secrets. `DEALER_MEDIA_REVIEW_TICKET_SECRET` (≥32 chars, shared across instances) remains mandatory; `CARUP_DEALER_OCR_LOCAL_ENABLED` stays unset on staging.
- Rate limits (per-IP and the new per-account owner/reviewer budgets) use the existing pluggable store: **in-memory per process unless `REDIS_URL` is set**. With several backend instances, budgets are per instance until Redis is configured — an operations decision before multi-instance staging.
- The public media cache is in-process (LRU ≤32 MiB per instance).
- Never on staging/production: `DEALER_SEED_DATABASE_URL`, `CARUP_DEALER_RESEARCH_XLSX`, `DEALER_ISOLATED_POSTGRES_URL`, `DEALER_BROWSER_*`, `DEALER_MIGRATION_DATABASE_URL` (rehearsal runner only, clone target).
- PostgREST must expose the view `dealer_research_public_profiles_current` (SELECT for service_role is granted by 146000).

## 5. Smoke / negative checks after any authorised apply

`/api/health`; exact SHA on both preview hosts; `/api/dealership/research` returns only fictional or policy-approved reviewed prelistings (**0 real dealers public**); anonymous media list ≤12 items without bytes; dealer routes without a session → 401; another tenant's VIN/inquiry → 403/404; suspended dealer → publish/enquiry 409; no payment/Paynow/subscription call reachable from dealer routes; Marketplace Reference Regression green on the registered pair.

## 6. Marketplace Reference Regression requirement (BLOCKED_ENVIRONMENT_AUTHORITY)

The workflow resolves an exact-head **governed preview pair** for this branch from `web/preview-backend-pairing.json` + `web/preview-frontend-pairing.json` and fails closed when none exists. Prerequisite: Owner authorisation (O1) of an exact-SHA preview deployment of this branch's backend and frontend (cached Vercel CLI from a clean worktree; web built with `VITE_API_URL` pinned to the immutable backend deployment host), then ONE commit registering the two stable aliases. The guard is not weakened and no other programme's pair is borrowed. It covers VehicleDetail, so it also exercises the site-wide T32 colour change (O13).

## 7. Independent review status

All reviews are **agent reviews: advisory, not named certifiers (O2)**. R6 ran two remediation rounds after fresh, unanchored reviews of the merged candidate; their findings, dispositions and reproductions are summarised in the R6 return comment. No self-certification: 0/67 cases are independently certified.

## 8. O13 — site-wide T32 colour change: options for the Owner

Measured WCAG contrast ratios (sRGB relative luminance):

| Pair | Ratio | AA normal text (4.5) |
|---|---|---|
| orange-500 `#f97316` on white | 2.80 | fails (as on main) |
| orange-600 `#ea580c` on white | 3.56 | fails (large text only) |
| **orange-700 `#c2410c` on white — implemented** | **5.18** | passes |
| orange-800 `#9a3412` on white | 7.31 | passes (AAA) |
| slate-900 on orange-500 fill | 6.37 | passes |
| orange-500 on the dark hero `#08111f` | 6.75 | passes |
| gray-400 / slate-400 on white → gray-600 / slate-600 | 2.54 / 2.56 → 7.56 / 7.58 | fails → passes |

- **Option A (implemented):** orange-700 text and white-on-orange-700 buttons on light surfaces.
- **Option B (brand-preserving):** keep the orange-500 brand fill for CTAs but use dark slate-900 text on it (6.37:1); keep orange-500 for the logo "Up" and accents on dark surfaces (6.75:1); use orange-700 only for small orange text on white.
- Either option keeps 0 critical/serious axe findings; the Owner (or design) chooses. Marketplace Reference Regression must re-run on the chosen palette.

## 9. Remaining engineering gaps (not hidden; candidates for an R7 or an Owner scope decision O9/O10)

| Gap | Register | Note |
|---|---|---|
| OCR-vs-workbook mismatch flags implemented but wired to no reviewer surface | T15 NOT_RUN | real issuer-document semantics remain external |
| Multi-record parent organisation (one organisation per research record today) | S14 NOT_RUN | |
| Unseeded / non-ZW new-business onboarding path | S24 NOT_RUN | foreign rules also unapproved (O9) |
| Bulk import of existing stock (C03/C17), vehicle photos on dealer listings (C17/C19) | — | per-VIN manual entry; registration document only |
| Licences, brand/OEM relationships, digital media, several policy fields have no canonical/operating field | — | retained privately, never claimed as carried |
| Staff can edit assigned branches only (no inventory/inquiry rights) | — | C16 |
| axe scope: VIN-listing phase surfaces + full pages only | T32 note | directory, claim workspace, dashboard, reviewer workbenches not axe-scanned |
| Investigation / RENEW / WITHDRAW not driven in a browser (SQL-proven) | — | C12 |
| Renewal applications are not re-carried (carry-over fires on activation only) | — | |
