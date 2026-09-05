# PR #194 → O2 Reconciliation Manifest (authored 2026-09-04, at the #194 acceptance closure)

**Audience:** the agent/engineer performing the O2 reconciliation AFTER the Product Owner
accepts/lands #194. This manifest is the authority for that work — it must not rely on any chat
transcript. Companion: the "EXACT-HEAD ACCEPTANCE CANDIDATE" section of
`docs/features/CARUP_OPERATIONS_SERENA_CLOSURE_RECEIPT.md`.

**Reference points:** historical O2/#194 merge-base `33720d79` · #194 product candidate
`f600d002` · #194 pre-acceptance head `52ebcd46` · O2 head at authoring `1312977e`
(`feat/operations-o2-people-compliance`).

## THE RULE — no blind cherry-pick

> **After #194 lands, O2 must NOT cherry-pick the seven post-`33720d79` commits.** Six of the
> nine closure files already exist on O2 (four byte-identical, two as strict O2 supersets);
> replaying them would duplicate P1-C logic, duplicate a migration, duplicate event emission and
> falsify history.

The reconciliation procedure is:

1. start from the LANDED #194/base (whatever SHA main carries after acceptance);
2. compute O2's NET patch against that base (`git diff <landed-base> <O2-head>`);
3. strike everything this manifest classifies as already-landed-equivalent;
4. replay ONLY the O2-exclusive changes (the X0–X6 net work);
5. manually reconcile the two genuine divergences listed below;
6. re-run P1-C and the FULL O2 certification (test list at the end) on the reconciled head.

## Seven-commit classification (`33720d79..52ebcd46`, oldest first)

| SHA | Purpose | Files | Domain | Origin | O2 equivalent? | O2 replay? | Conflict risk | Reconciliation instruction |
|---|---|---|---|---|---|---|---|---|
| `6bed5c5e` | Land the former-seller authority closure (P1-C) into the integration candidate | 9 (sellerAuthority, passportTransfer, vehiclesRoutes, server.js, vehicleOperationsReadModel, Serena workflow, 2 test suites, migration `20260903120000`) | Seller Authority / Passport / P1-C | **extracted from O2** | YES (O2 is the origin; see equivalence map) | **NO** | none→low | Strike from O2's net patch; keep O2's superset versions of the two services |
| `fbc059f9` | Serena workflow applies `20260828203000` to staging (it was never applied; first closure run failed on the missing table) | 1 (workflow apply-list) | staging DDL governance | #194-native | NO (O2 does not carry the apply-list edit) | NO | none | Nothing to replay; P7 parity planning MUST read this apply-list (staging DDL is ledger-invisible) |
| `f600d002` | Scope the new denial check to non-owners — restores the seller hot path (measured: Golden 3/3→timeout at `fbc059f9`, fixed here) | 1 (vehiclesRoutes) | Seller Authority perf | #194-native (fix to the extracted closure) | **PARTIAL — O2 lacks this** | **YES — adopt on O2** | low | Apply the same owner-short-circuit at O2's `loadScopedVehicle` site (semantics-preserving; P1-C.12 pin already proves owners are never denied) |
| `68a44b60` | Closure-landed certification record (supersedes the `dd94c56d` cert) | 1 (receipt) | docs | docs | n/a | NO | none | none |
| `e1d9ace7` | Golden Seller reliability diagnosis (root cause: per-vehicle analytics fan-out + 132-listing fixture debris) | 1 (receipt) | docs | docs | n/a | NO | none | none — but note the SellerIntelligence scalability debt is recorded post-merge work |
| `49951a43` | Per-run Golden Seller fixture (`golden.seller.<run-id>@carup-staging.test`); spec shape-guard | 2 (workflow, spec) | certification infra | #194-native | NO | NO | none | none; P7's fixture design should reuse the per-run-identity pattern |
| `52ebcd46` | Fixture-repair + controlled-certification record (matrix green at `49951a43`, Golden 3/3) | 1 (receipt) | docs | docs | n/a | NO | none | none |

## P1-C patch-equivalence map (verified by direct `git diff 52ebcd46 1312977e` per file)

| Artifact | Classification | Evidence / instruction |
|---|---|---|
| `backend/tests/o2-former-seller-authorization.test.js` | **IDENTICAL** | zero-line diff — strike from O2 replay |
| `backend/tests/o2-transfer-authority-supersession.test.js` | **IDENTICAL** | zero-line diff — strike |
| `database/migrations/20260903120000_ownership_transfer_retires_tenant_relationship.sql` | **IDENTICAL** | zero-line diff — strike; NEVER re-apply (already live on staging, unledgered — see Migrations) |
| `backend/services/operations/vehicleOperationsReadModel.js` | **IDENTICAL** | zero-line diff — strike |
| `backend/services/seller/sellerAuthorityService.js` (incl. `hasSupersedingOwnershipTransfer`, `isSellerAuthorityEffectivelyDenied`, ownership-aware state, claim refusal, reviewer-confirm refusal, P1 supersession) | **O2_NEWER (strict superset)** | zero #194-only lines; O2 adds the P2 responsibility projection + the X6 `seller.authority.superseded` lazy emit. Keep O2's version wholesale |
| `backend/services/passport/passportOwnershipTransferService.js` | **O2_NEWER (strict superset)** | zero #194-only lines; O2 adds the P2 transfer responsibility projection. Keep O2's version |
| `backend/server.js` (add/reuse denial region) | **O2_NEWER + O2-only additions** | the P1-C denial region is equivalent; #194-only lines are the pre-X1 legacy `/api/verification` mount + `runOcrParsing` unattributed call, which O2's X1/X2 RETIRED — O2's removal wins by certified direction. O2-only: X5/X5A mounts, X2 attribution. Reconcile as: take O2's file, confirm no other #194-side drift |
| `backend/routes/vehiclesRoutes.js` | **DIVERGED_REQUIRES_RECONCILIATION** | #194_NEWER hunk: `f600d002` owner-scoping of the denial call (ADOPT into O2). O2_NEWER hunks: X3 step-up on seller review (+ imports). Merge BOTH — they touch different lines of the same region |
| `.github/workflows/operations-serena-staging-uat.yml` | **#194_NEWER** | #194 added `20260828203000` + `20260903120000` to the governed apply-list; O2 never edited this file — take #194's version |

## Migrations classification (staging ledger vs LIVE schema — verified read-only 2026-09-04)

Staging's `supabase_migrations` ledger ends at `20260902183022`, but this branch's Serena
workflow applies a governed idempotent list OUTSIDE the ledger. Live-schema verification:
`vehicle_ownership_transfers` exists; `passport_transition_ownership_transfer_atomic` contains
the tenant retirement; seller disclosures + ZW registration columns exist; O2's X3/X4/X5 tables
do NOT.

| Migration | Classification |
|---|---|
| `20260903120000_ownership_transfer_retires_tenant_relationship` | **identical in #194 and O2; LIVE on staging (unledgered)** — never re-apply, never duplicate |
| `20260828203000_passport_ownership_transfer_authority` | **#194-lane; LIVE on staging (unledgered)** |
| `20260903200000` + `20260903201000` (X3), `20260903210000` + `20260903211000` (X4), `20260903220000` (X5), `20260904090000` (X5A) | **O2-only; NOT on staging** — the P7 DDL-parity plan's actual outstanding set |
| Ordering/conflict issues | none known: O2's six are additive and independent of the #194 apply-list; apply AFTER the #194 list order when P7 parity executes |
| Ledger note | any P7 parity plan must reconcile ledger-vs-live drift (several #194-lane migrations are live-but-unledgered by design of the workflow apply-list) |

## Already in #194 (O2 must NOT duplicate)

The entire `6bed5c5e` closure (P1-C logic, both invariant suites, the migration, the read-model
change), the `f600d002` perf fix (adopt, don't re-derive), the Serena apply-list edits, the
per-run Golden fixture infra.

## O2-only (carry forward in the replay)

Everything in O2's net patch outside the nine closure files: P2–P6 + P1-C ops exposure, X1
retirement (incl. the server.js `/api/verification` removal), X2 registration + truth model, X3
lifecycle/step-up/session security, X4 biometrics architecture (provider NOT ACTIVATED), X5
dealer onboarding, X5A workbook catalogue/registry/workspace, X6 assurance projection + semantic
events + bounded comms wiring, and the six O2 migrations above.

## Potential conflicts (semantic review required)

`backend/routes/vehiclesRoutes.js` (merge both sides, above) · `backend/server.js` (O2 removals
vs #194 legacy mount — O2 wins; verify no new #194-side server.js edits landed after `52ebcd46`)
· any file the landed base changes after this manifest's authoring (re-run the per-file diff
before replaying).

## Required post-reconciliation tests (minimum, on the reconciled head)

former-seller P1-C `o2-former-seller-authorization` 11/11 · `o2-transfer-authority-supersession`
· Seller suites (incl. seller-history disclosures + finance-obligation authority) · Marketplace
reference regression · Passport foundation V1–V16 · X2 `o2-x2-*` · X3 `o2-x3-*` · X4 `o2-x4-*` ·
X5 `o2-x5-*` + dealer suites · X5A `o2-x5a-*` (registry tripwire included) · X6 `o2-x6-*` +
`communication-event-coverage` · migration integrity · FULL backend (0 fail) · FULL web ·
tsc · lint NET_NEW 0/0 — then the O2 tracker/receipts updated with the reconciled head.

## Gate chain after acceptance (do not collapse)

`PO merge/land decision → O2 reconciliation (this manifest) → shared-staging DDL parity plan
(six O2 migrations + ledger reconciliation) → synthetic identity fixture approval (reuse the
per-run-identity pattern) → O2 preview pairing (two rows, additive) → P7 → X7.`
