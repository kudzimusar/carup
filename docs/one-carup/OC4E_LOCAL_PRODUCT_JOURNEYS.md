# OC-4E — Local product-journey proof

**Branch:** `feat/oc4e-local-product-journeys`. It is based on the OC-4D head `56b29764`, so the lineage stays linear.

**Status:** local proof only. Canonical staging (`carup-staging`, `eoyenigwevnxwwhyhaer`) is unavailable, so deployed journeys are the deferred steps of the RC1 runbook. Nothing here calls a live provider, a deployed backend, or any database other than in-process doubles.

## What runs

### 1. Backend journeys through the shipped app — `backend/tests/oc4e-product-journeys.test.js`

**How it runs:**
- The real `server.js` app on an ephemeral port.
- Real routes and real session authentication: every caller holds a `user_sessions` row; no x-user-id fallback is used.
- Real services, against one in-memory Supabase world: `backend/tests/helpers/inMemorySupabaseWorld.js`.

**What the world is:**
- It is table-agnostic and applies PostgREST-faithful `select()` column projection.
- Without that projection a route's query-level privacy allow-list is never exercised. That produced a false positive here first.

**What is mocked:** Cloudflare Workers AI is intercepted at `fetch`, by model and by prompt. Qwen (`@cf/qwen/qwen3.8-27b`) answers OCR; Gemma (`@cf/google/gemma-4-26b-a4b-it`) answers general AI.

| Journey | The governing law it asserts at the consequential step |
|---|---|
| Identity | Capture → Qwen classifies and reads, producing a **candidate** → OCR alone verifies no one → a **human** approves → the decision is audited. |
| People & Compliance | A reviewer reads the person as separate facts. No reviewer id, internal note or artefact path leaks. An owner account is refused. The admin **cannot decide their own** identity session, and nothing is recorded first. |
| Owner / Evidence | An upload records chain of custody. The owner reads only the participant projection; a stranger is refused. |
| Ledger | An empty ledger is `verified:false`. A domain decision is **recorded** by `blockchainService.addEvent` alone. Owners see only the integrity projection: no chain, payload or signature. A stranger gets 403; an anonymous caller gets 401. |
| Garage | An odometer capture becomes a **candidate** reading on Qwen. The vehicle's mileage is untouched. |
| AI | A fraud scan is advisory machine output from Gemma. An anonymous visitor costs **zero** provider calls. |
| Seller (private) | An AI listing draft is advice: one Gemma call for a session-proven seller, and the vehicle row is byte-identical afterwards. |
| Seller (Dealer) | A governed dealership lists as Dealer (tenant set, no private owner). A **mechanic of the same dealership** is refused — 400, with no listing subject — and nothing is written. |
| Buyer | The public vehicle view never carries the owner or seller identity. |
| Diaspora | A golden Scenario Lab scenario previews end to end: dry run only, nothing written, production forbidden. |
| Mechanic → PartSentry → Ledger | A mechanic with no work order is refused and changes nothing. The assigned mechanic's log is recorded, the canonical odometer follows it, and the ledger records the event. The chain verifies **and authenticates**: the system event plus the mechanic's custodied key, under the Issue #158 contract modelled as FINALIZED. |

### 2. Browser proof on localhost — `tests/agents/50-oc4e-converged-journeys.spec.ts`

**Configuration** (`playwright.oc4e-local.config.ts`):
- Port 5199, `--strictPort`, `reuseExistingServer: false`. This guarantees the run is this tree's dev server, not another worktree's.
- The API is mocked at the browser boundary, including the real CSRF flow. A mock that skips CSRF proved nothing; that was the first failure found here.

**Tests:**
- **Buyer:**
  - Anonymous: Gutu AI says a session is needed and sends no session.
  - Signed in: the session is sent, and the AI answer carries no fallback badge.
- **Owner PartSentry:** the badge comes from the integrity projection alone.
  - Verified and authenticated: "Ledger Verified".
  - Intact but unauthenticated: amber "signatures unverified".
  - Broken: "Tampered".
  - Empty: no badge.
  - Failed verification: "Verification unavailable", never a verdict.

### 3. Mobile (Expo)

The native path is proven by the native suites CI runs: `mobile` tsc, the upload-queue tests and the garage odometer tests.

An Expo runtime (Metro / device) was **not** run in this phase.

## Results

| Proof | Result |
|---|---|
| Backend journeys | 11/11 |
| Browser spec | 7/7 |
| Mutants — first eight journeys | 10/10 killed (J1–J10) |
| Mutants — three journeys added after OC-4D | 4/4 killed (NJ1–NJ4) |
| Mutants — browser spec | 5/5 killed (B1, B2, L1–L3) |

Every mutant was killed by its intended test.

## Recorded, not hidden

- **Older local agent specs** (`tests/agents/01/02/03/07/10/14/16`) fail identically on `main` and on this lineage: 11 failed / 3 passed / 2 skipped in both. That is a stale baseline, not evidence either way, so they are not part of this proof.
- **PartSentry partial write.** The mechanic journey surfaced it: with the custody contract absent, the ledger write refused after the log and odometer write had already persisted, and the route answered 400. This predates OC-4. It is recorded in `OC4D_DOMAIN_LINEAGE_CONVERGENCE.md`.
- **The in-memory world is not a database.** It has no FKs, RLS, triggers or CHECKs; those are proven on real PostgreSQL (PGlite) in the OC-3D and OC-4A suites. What this phase proves is the wiring.
