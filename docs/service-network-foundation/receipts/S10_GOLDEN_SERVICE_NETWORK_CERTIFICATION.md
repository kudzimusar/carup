# S10 — Golden Journey and Exact-Head Certification

- **Programme:** CarUp Service Network Foundation 1.0
- **Date:** 2026-08-29
- **Implementation base:** `main` @ `ba208963d863654157335189c60f587cbe330041` (pre-#194, owner override — see PRE_S0 §1)
- **Branch / PR:** `feat/service-network-foundation-1-0` → Draft PR #197

## 1. Certification status

**S0–S10 are complete and green on this base.** The PR remains **Draft**: the owner override
allowed implementation to proceed against pre-#194 `main`, and the standing rebase obligation
(§5) must be discharged before this work can be considered final.

## 2. The Golden Journey (plan §S10)

`backend/tests/service-network-s10-golden-journeys.test.js` drives the **real** Service Network
services end to end. Each phase certified its own contracts; these prove the phases **compose**.

| Journey | What it certifies | Result |
|---|---|---|
| **A — evidence-rich service** | The whole plan journey: owner → directory → garage detail → service request → canonical conversation → acceptance → work order → mechanic assignment → mileage/work/part/evidence → completion → owner Service History → garage customers → Intelligence measurability | **PASS** |
| **B — sparse service** | Missing optional data renders truthfully: absent cost is `recorded:false` (never 0), provenance stays `unknown`, no mileage claim without a reading | **PASS** |
| **C — cross-tenant attack** | Seven hostile calls from garage B (read, accept, complete, open work order, restatus, assign, read assignment) all read **404, never 403** — no existence oracle — and garage B's own queue and customer list stay empty. Nothing mutated | **PASS** |
| **D — QR** | Resolves the right resource; unauthenticated gets only a sign-in path with no VIN; a non-participant learns nothing (not even status); tenant authorization preserved; `source_channel: 'qr'` survives the whole journey; a scoped capability redeems exactly once | **PASS** |
| **E — Communications degraded** | An outbox failure and a conversation-provider outage both leave the Service Case byte-identical and authoritative, report the failure honestly, and the journey still continues | **PASS** |
| **F — ownership continuity** | Service history survives transfer: the new owner sees the record, **no prior-owner id or name leaks**, and the previous owner loses visibility | **PASS** |
| **G — duplicate / retry** | Retried inquiry bridge, work order, assignment and completion each produce exactly one record, and exactly **one** `service.case.completed` event | **PASS** |
| **H — adverse truth** | Unknown provider stated (`known:false`), absent cost stated, no maintenance-interval prediction anywhere in the payload, cancelled history retained and truthful | **PASS** |

Two invariants are asserted at the seams inside Golden A, where they are most likely to break:

- **`vehicles.mileage` is unchanged (120000)** after a 131500 service observation — no second
  canonical odometer writer exists (Invariant §13.1).
- **`vehicles.trust_score` is unchanged (72)** through a fully completed, evidence-backed
  service — service activity is not Trust (Invariant 4).

## 3. Exact-head certification battery

Every gate below was run at this head, in the exact `ci.yml` environment
(`NODE_ENV=test`, test Supabase/JWT placeholders, `ALLOW_OCR_MOCK=true`).

**26 of 26 gates passed. Zero failures.**

| Gate | Result |
|---|---|
| Web typecheck (`tsc --noEmit`) | **PASS** — zero diagnostics |
| Migration integrity (`migration_pglite_check.mjs`) | **PASS** |
| Issue #101 — P0 hardening, parity, parity→P0 chain, public_keys transition, post-cutover certifier (5) | **PASS** |
| Diaspora ledger harnesses (11) | **PASS** |
| Service Network migration harnesses — S1, S2, S3, S4, S5, S8 (6) | **PASS** |
| **Full backend suite** | **PASS** — 4490 tests, **4469 pass, 0 fail**, 21 skipped, 48 suites |
| **Full web suite** | **PASS** — 108 files, **1115 tests, 0 fail** |

Baseline at `ba208963` before any Service Network work was 4352 backend tests / 0 fail and
106 web files / 1097 tests. The programme added **+138 backend tests and +18 web tests with
zero regressions** across all eleven phases.

## 4. Defects found and fixed during the programme

Four are worth recording because each would have produced a **false pass**:

1. **`mockSupabase` had no `count` support** (S1) — `select(…, {count:'exact'})` returned
   `undefined`, which a service reading `count ?? 0` turns into a fabricated zero.
2. **Unregistered unique indexes** (S5) — the mock accepted a duplicate part attach that
   PostgreSQL refuses.
3. **Comparison filters were no-ops** (S8) — `.gt()/.lt()/.gte()/.lte()` returned the whole
   table, so **capability expiry was unenforceable in test** and every range-filtered
   assertion was vacuous. Fixed with SQL three-valued semantics; the suite stayed green,
   proving nothing depended on the break.
4. **PGlite teardown made a CI gate nondeterministic** (S1) — the harness printed every check
   as OK and still exited `100`, so the gate's verdict depended on interpreter teardown.

A fifth was a measured **schema truth**, not a bug (S4): the Title-Case work-order status
`CHECK` exists only in the retired `009_phase4_schema.sql`, and legacy `006` defaults status
to `'pending'` with no constraint. The database therefore does **not** uniformly enforce that
vocabulary. No CHECK was added — legacy rows can legitimately hold `'pending'` — so
enforcement lives in the service layer, and the harness now pins the schema fact so a future
assumption of DB enforcement is caught.

## 5. Standing obligation before this PR is marked ready

Per the owner override recorded in PRE_S0 §1, this work was built on **pre-#194 `main`**.
Before readiness:

1. Fetch the new canonical `main` once #194 (or its approved successor) merges; record its SHA.
2. Rebase `feat/service-network-foundation-1-0` onto it.
3. **Re-run S0** against merged truth and reconcile every `[#194-sensitive]` item recorded in
   the S1–S9 receipts — principally: extend (never fork) `passportServicePartsProjection`'s
   frozen `SERVICE_AUTHORITIES`; register `service.*` events in
   `DETERMINISTIC_EVENT_IDENTITY_FIELDS` **and** the DB dedupe trigger in lockstep; re-point
   I9's service-demand read from `seller_id` to `target_provider_tenant_id`; reconcile the I9
   `NOT_MEASURABLE` registry against S7 §3.
4. Re-run this entire battery at the rebased head.
5. Then, and only then, mark PR #197 ready.

## 6. Explicitly outside this certification

Production schema application, provider activation (WhatsApp/push/email sending), real garage
onboarding, production QR distribution and any production write remain owner-gated and
untouched (plan §35). No staging deployment was performed, and no test enqueues against
staging Postgres — the real-adapter send hazard was honoured throughout. Playwright E2E and
the lint-regression gate are CI-side and were not run locally; the mobile workspace was
deliberately not installed in this lane.
