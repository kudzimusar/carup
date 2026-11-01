# CARUP-PAY-03A-STG01-FINAL — Final Execution & Certification Report

**Programme:** CarUp Payments 2.0 · **Authority:** [Issue #247](https://github.com/kudzimusar/carup/issues/247) · **Product PR:** [#250](https://github.com/kudzimusar/carup/pull/250) (Draft, unmerged)
**Branch:** `feat/carup-pay-03a-real-report-sandbox-commerce` · **Implementation parent:** `b72dbefc4a0bfb11dd24672b775dd66178b1441c` (exact-head CI `41261473725` SUCCESS)
**Runtime candidate (Stages 5–6):** `cc4f66384baf285eb8ebd3fca5bf7199a0b8f609` — required CI `41271920394` SUCCESS (supersedes `5b045fe2`, withdrawn before any payment after the independent challenge)
**Production authorization:** NONE (never accessed) · **Shared staging mutation:** NONE (read-only census only) · **Merge:** NONE

**Stage 6 executed under the Owner's explicit authorizations:** exactly ONE Stripe TEST-mode payment (JPY 100, QA vehicle `QA-PAY03A-0001`) and exactly ONE full refund, both reconciled end to end. This is a **QA-only mechanical rehearsal**, not genuine commercial acceptance.

---

## 1. Disposition summary

| Gate | Result | Evidence |
|---|---|---|
| Source and CI | **PASS** | Required PAY-02/03A workflow green on the runtime candidate; every other red check is byte-identical at the certified parent (§8) |
| Environment | **PASS** | Isolated local Supabase (127.0.0.1:54321/54322), `env -i` backend, runtime-proven SHA on both tiers, PAY-01C evidence preserved (§3) |
| Genuine vehicle provenance | **BLOCKED — DATA AUTHORITY** | Owner decision 2026-11-01; Vezel and staging census (§4) |
| Product policy | **PASS (sandbox only)** | Owner approved the sandbox policy and fail-closed threshold as implemented; retail NOT approved (§4.4) |
| Customer experience | **PASS** | At `cc4f6638`: 10/10 headed browser tests × 3 viewports, axe WCAG A/AA, 34/34 HTTP security cases (§5) |
| Financial transaction | **PASS (QA-only mechanical)** | §6 |
| Fulfillment | **PASS** | §6 |
| Entitlement and sharing | **PASS** | §6 |
| Refund and revocation | **PASS** | §6 |
| Independent certification | **PASS with conditions** (12 of 13 findings remediated or verified; F5 open, F13 informational) | §7 |

**Specialist recommendation:** **RECOMMEND ACCEPT — scoped to the mechanical sandbox lifecycle and source.** The genuine, source-backed commercial product is **not** accepted: that gate is BLOCKED_DATA_AUTHORITY by Owner decision. Accepting carries open conditions (F5; retail blockers F-LIFE-1 and the free-route overlap). The Moderator retains final authority.

A successful QA-only payment certifies the **mechanical** financial integration only. It does **not** close the genuine, source-backed product gate, which remains blocked on data authority.

---

## 2. Defects found and fixed in this assignment

Each was demonstrated first (failing test or physical observation), then fixed with a bounded change and a regression test.

| ID | Defect (as demonstrated) | Fix | Commit |
|---|---|---|---|
| D-ELIG-1 | Eligibility used a **denylist**; `partsentry_logs.verification_status` `unverified`/`disputed` (and unknown) counted as verified history → purchasable and labelled `GENUINE_VERIFIED_SOURCE_BACKED` | (source, status) **allowlist**, fail-closed | `15696c41` |
| D-AUDIT-1 | Governed refund recorded the **buyer** as PAY-01A actor and the administrator **nowhere** | Proven admin required; authoritative `PAY03A_ADMIN_REFUND_REQUESTED` audit written **before** any provider call (refund refused if it fails), `…_RESULT` after; reconcile attributed | `8b6709d1` |
| D-UI-1 | Admin order panel swallowed read errors and showed "No PAY-03A … orders" | `role=alert` error state; stale-row warning; empty statement only after a successful read | `f5c67902` |
| D-ELIG-2 | Every `vehicle_ownership_history` row counted as history; on staging **328/329** rows are CarUp initial registrations (no previous owner) → 326/365 non-QA vehicles purchasable | Ledger events count only up to **genuine changes of owner**; failed read fails closed | `0125074a` |
| D-ELIG-3 | Unclassified and **self-verified** evidence counted (staging: all 14 candidates unclassified, 12 self-verified) | Evidence must map to a lifecycle category and be independently reviewed (reviewer ≠ uploader) | `722daa46` |
| D-DATE-1 | `captured_at` defaults to upload time; lifecycle would date undated evidence at upload | Qualifying evidence requires a source-attested `event_date` (Owner-approved threshold) | `1f53c883` |
| D-PROV-1 | Upload/classification/ingestion provenance hashes taken over insertion order; JSONB reorders keys → product endpoint reported `chain_valid:false` for every uploaded chain | JSONB-canonical hashing in `computeContentHash` (no-op for already-valid hashes) | `8d5f7fc0` |
| D-HASH-1 | Paid snapshot's marketed SHA-256 not reproducible from the JSONB-stored report the buyer receives | Canonicalize once, hash, store canonical; `content_hash_scheme: sha256:jsonb-key-order-json-v1` | `8d5f7fc0` |
| D-A11Y-1 | axe: 4 serious contrast failures on the purchase page (badge 2.8:1, terms labels 2.56:1) | orange-700 / slate-600 | `e6646cdd` |
| D-UX-1 | 390 px purchase page overflowed 122 px; admin console 7 px | Wrap-safe badges, `min-w-0` grid cards, wrapping blocker text | `29066eaf`, `5f19db6f`, `5b045fe2` |

| F4 / F8 | **Independent challenge:** a failed provider refund left the buyer charged, re-entitled and locked out (one-way snapshot revocation at `refund_pending`); sync and fulfillment locked rows in opposite orders | **New forward-only migration** `20261101100000`: suspend without revoking; same advisory lock on the payment reference in both RPCs. Smoke proves suspend → failed refund restores access → refunded revokes; mutation-checked | `5be2903a` |
| F2 | Paid snapshot payload carried `buyer_id`, `payment_reference`, order/quote ids — served to anyone holding a share link | Identifiers removed from the payload (binding stays in DB columns) | `89fb4f06` |
| F3 | Legacy `POST /api/report-versions/:id/revoke` (any signed-in account) could permanently revoke a buyer's paid snapshot | Paid snapshots revocable only by the governed refund (403 otherwise) | `89fb4f06` |
| F6 | Discovery listed draft vehicles to any signed-in account and exposed the legacy `trust_score` | Public status/publication gate on discovery and readiness; no raw trust score | `89fb4f06` |
| F7 | The free-vs-paid comparison claimed the free route had no snapshot/hash/share link — false (Milestone 4 route) | Honest comparison; **Owner re-confirmed** sandbox-only approval with it | `89fb4f06` |
| F1 | Current-condition and dealer-listing evidence qualified as "history" | Excluded (**Owner decision**) | `89fb4f06` |
| F9 / F10 / F11 | Commerce default-on vs webhook sync default-off; 5xx echoed DB errors; audit role taken from tenant-influenced role | Explicit opt-in; no 5xx details; platform role | `89fb4f06` |

Test-hygiene correction: unit tests no longer attach synthetic "verified" history to the real T11 CAP Vezel (`RU3-1316558`).

---

## 3. Isolated environment

* **Database:** the Owner-authorized local stack `carup-pay01a-supabase` (API 54321, PostgreSQL 54322, Studio 54323, Mailpit 54324). Production `vhmnajoeicasaigiophh` and staging `eoyenigwevnxwwhyhaer` were never written.
* **Schema build:** `scripts/uat/pay03a-stg01-local-db-build.sh` layered the PAY-02/03A CI recipe plus the canonical migrations the real routes need. All 40 entries are recorded in `carup_uat.migration_ledger` (including the forward migration `20261101100000`) with SHA-256 of the file and of the applied Up section; re-runs fail on drift. `20261031160000` was a **fresh** install here (never previously applied), so the R3-R1 amendment needed no forward-only migration. Local alignments, all recorded: canonical `users` columns; PAY-01A `vehicles` stub **archived, not dropped**; a uuid default for the hand-built `user_sessions.id`; pre-created pre-image columns for `20260818110000` (finding F-MIG-1); the CAP-R2 `vehicle_media_references` subset; and `users.email_verified_at`.
* **PAY-01C preservation:** a full dump was taken first (SHA-256 `1d1b4b36…a553a0`). Every original row of all nine pre-existing tables is still present and byte-identical over its pinned columns; payment-evidence fingerprints are identical (4 payments, 14 Stripe receipts, 1 demo order). The PAY-01C backend on 5017 was never touched and answered `/api/health` 200 throughout.
* **Runtime:** `scripts/uat/pay03a-stg01-local-runtime.sh`. The backend runs under `env -i` with an explicit allowlist from a dotfile-free, space-free worktree at the exact clean SHA. Supabase is resolved from the stack's own directory (finding F-ENV-1). Both tiers report the candidate: `/api/health.build.commit_sha` and the production web bundle's `carup-provenance.json`. Stage 5 used a deliberately non-functional `sk_test_` placeholder, so no Checkout session was possible; Stage 6 keys were typed by the Owner at hidden prompts.
* **Ports:** backend 5031, web 5183. PAY-01C keeps 5017.

---

## 4. Stage 4 — Genuine data and product policy

### 4.1 Honda Vezel `RU3-1316558` (BE FORWARD `CD740269`) — read-only staging inspection

| Item | Finding |
|---|---|
| Evidence rows | **53** (50 `export_yard_photo`, `bill_of_lading`, `commercial_invoice`, `export_certificate`) — **all `pending`, all `private`**, 0 reviewed, 0 with `event_date`, 53/53 `captured_at = uploaded_at` |
| Gallery position 1 | evidence `9815a9a0-c7d4-46a0-a804-c29c66ffbaf9`; `ocr-documents/RU3-1316558/import_photo_5eed6c253be0.jpg`; JPEG 46,529 B; SHA-256 `8068083b4058881514147a42052b8b18afe92436306ca3fdca87920bfb4cc226`; no source name, source reference, event date or capture country on the row; only source link is the media reference (BE_FORWARD_CAP / CD740269 / position 1) |
| What it can support | At most "a photo supplied by BE FORWARD for purchase CD740269 is on file, unreviewed". **Not** a dated export-yard event, departure, customs, registration, accident, ownership or mileage history |
| Publication | BE FORWARD-watermarked third-party image; any publication needs a reuse permission |
| Private PDFs | Remain `private`/`pending`; untouched |
| CAP progress records (14) | Seller-portal logistics steps, `REPORTED`, undated — not vehicle-history facts |

### 4.2 Operational vehicle search (same criteria, read-only aggregates, shared staging)

370 vehicles (5 QA by code rule). Under the corrected gate, **0 of 365 non-QA vehicles qualify**:
* 14 had verified public evidence, but every one is unclassified and undated, and 12 of the 14 were verified by their own uploader.
* 326 were "eligible" only through ledger rows that are initial registrations.
* The single genuine transfer was executed on the vehicle's creation day (a UAT artefact) and has no evidence.

### 4.3 Owner decision — genuine-data gate

> "Record BLOCKED (Recommended)" — 2026-11-01T03:33:12Z (recorded `owner-decisions-*.json`, protected evidence store)

**Result:** `PAY03A_GENUINE_DATA_PROVENANCE_BLOCKED` / **BLOCKED_DATA_AUTHORITY**. No photo was accessed; Vezel evidence is untouched.

### 4.4 Commercial product policy — Owner-approved for **sandbox only**

> "Approve sandbox-only (Recommended)" — 2026-11-01T03:33:12Z

* **Product:** `intel.report.vehicle_history_single`, product version 1.
* **Paid deliverable:** an immutable, versioned snapshot of the **same** `assembleReport` engine as the free live report. It claims no exclusive or secret data. It comes with a buyer order record bound to the canonical payment, a SHA-256 hash reproducible from the delivered JSON, and a buyer-controlled expiring share link (default 7 days, minimum 5 minutes, maximum 30 days).
* **Free report:** unchanged. It is a live, ephemeral view with no snapshot, hash, order or share link.
* **Minimum evidence threshold (implemented, fail-closed):** at least one of the following, in each case with explicit limitations disclosed:
  - one independently reviewed (reviewer ≠ uploader), classified, public-safe evidence item that carries a **source-attested `event_date`**;
  - a verified maintenance record;
  - a genuine CarUp ownership transfer (previous owner recorded and different).
* **What never counts:** registration rows, upload timestamps, and unverified, disputed, self-verified or unclassified records.
* **Refunds:** a full refund revokes the snapshot and every share link; partial refunds are refused. `refund_pending` suspends access.
* **Retention:** the snapshot is retained (immutable, revoked flag) for audit; access requires an active entitlement.
* **Price:** JPY 100 is a **sandbox test fixture**, not a retail price.
* **Retail prerequisites (open):** merchant and legal entity, customer terms, retail price, BE FORWARD reuse permission (if their media is ever shown), and genuine dated evidence.

---

## 5. Stage 5 — Physical UAT (isolated runtime)

### 5.1 Evidence-review mechanics (QA data, governed routes)

* **Independent review:** the QA seller uploaded through `POST /api/vehicles/:vin/evidence/upload`. The admin reviewer verified through `PATCH …/verify`, the atomic `carup_review_vehicle_evidence` RPC, and got 200 `verified`. One `EVIDENCE_VERIFIED` audit was written for the reviewer, and provenance shows `uploaded`(seq 1) → `approved`(seq 2) with `prev_hash` linked.
* **Self-review refused:** the reviewer verifying their own upload got **403 `EVIDENCE_REVIEW_SELF_FORBIDDEN`**.
* **Replay and conflict refused:** a replayed verify and a conflicting reject both got **409 `EVIDENCE_REVIEW_CONFLICT`**, with exactly one verified audit and no rejection.
* **Identity checks:** an owner role gets **403**, and an `x-user-id` fallback carrying a CSRF token valid for that identity gets **401** at the auth layer.

### 5.2 HTTP negative-security matrix — 34/34 PASS at `cc4f6638`

Run against the running backend (`scripts/uat/pay03a-stg01-http-matrix.mjs`). Results by area:

| Area | Cases | Result |
|---|---|---|
| Authentication | unauthenticated, expired session, header-fallback identity | 401 |
| Role isolation | buyer on admin list, refund, reconcile | 403 |
| Unknown or foreign order, stale return | — | 404 `PAY03A_ORDER_NOT_FOUND` |
| Unknown vehicle | — | 404 |
| Ineligible vehicles | metadata-only, registration-only, unverified | 422 before charging |
| Client price, currency or merchant override | — | 400 |
| Invalid idempotency key | — | 400 |
| Eligible checkout without provider access | — | 503 `PAY01A_ACCOUNT_VERIFICATION_UNAVAILABLE` |
| Ledger after refused attempts | — | 0/0/0 quotes/orders/payments |
| Checkout rate limit | spoofed `X-Forwarded-For` on each request | 6th request 429 (limit holds) |
| Draft (unpublished) vehicle (N23) | readiness and discovery | 404 and not listed (F6) |
| Forged webhook | — | 400 `PAY01A_SIGNATURE_INVALID` |
| PostgREST bypass | `anon` / `authenticated` read of orders, payments, audit; RPC calls; forged snapshot insert | refused (401/403/404) |
| Authenticated read of paid snapshots (S04) | — | 0 rows. **Vacuous in Stage 5** (no snapshot existed yet); re-proven non-vacuously in Stage 6 |

### 5.3 Browser UAT — `web/e2e/pay03a-real-report-purchase.spec.ts` — 10/10 PASS at `cc4f6638` (headed Chromium)

* **Provenance:** both tiers report the candidate commit.
* **Signed out:** the sign-in requirement is shown.
* **Buyer journey at 1440×900, 768×1024 and 390×844:**
  - the metadata-only and registration-only QA controls are refused with the buy button disabled;
  - the evidence-backed QA vehicle is eligible at ¥100, classified `QA_INTEGRATION_FIXTURE`, and shows its limitations and the free-versus-paid comparison;
  - no horizontal overflow and **no serious or critical axe violations**;
  - no secrets, bucket names or passwords in the DOM.
* **Checkout without provider access:** a visible error, no Stripe navigation, no order.
* **Forged Stripe return URL:** no entitlement, and the parameters are stripped.
* **Admin console:** a successful empty read, not an error.
* **Role isolation:** a buyer cannot open the admin consoles.
* **Review surface:** loads for QA, while the genuine Vezel is absent locally.
* **Private media:** an outsider sees no private evidence id or bucket name.

---

## 6. Stage 6 — Authorized sandbox purchase, fulfillment, sharing and refund

**Authority.** Recorded, Owner's own selections:
- 2026-11-01T03:33:12Z — one payment and one refund authorized;
- re-confirmed for candidate `cc4f6638` at 2026-11-01T06:42:31Z.

**Runtime.**
- Owner-started backend under `--stage6`; the test keys were typed at hidden prompts and never seen.
- The Owner ran a Stripe CLI listener forwarding to `127.0.0.1:5031` (CLI account `acct_1UVnGaEjgXqvlsJk`, "CarUp Japan sandbox").
- The pre-existing PAY-01C listener (to 5017) was still running, so events were also forwarded there. This is analysed as safe: the RPC is idempotent and the PAY-01C sync is a no-op for non-demo payments.

| Item | Value |
|---|---|
| Buyer | `u_2814e4a5f16a4826` (`pay03a.buyer.a@carup-uat.invalid`) |
| Vehicle | `QA-PAY03A-0001` — `QA_INTEGRATION_FIXTURE` |
| Order | `e008dde9-117c-46fd-b237-c58690b84f6d` |
| Payment reference | `pay01a_f5b5f516-aa8a-446b-9f91-8e1ace0f076c` |
| Checkout Session | `cs_test_a17h8PiHLraKwvNxs8Cy1tZNEvSmB9ctxVOjAAhxzfW1elcUhcYNYorsH4` (Stripe page badge: **Sandbox**, ¥100) |
| PaymentIntent | `pi_3UWtRAEjgXqvlsJk1HmIqpp5` |
| Refund | `re_3UWtRAEjgXqvlsJk1gw5dZSZ` (one) |
| Report version | `d2d4888f-e1fe-4c53-bb19-808c77c1fdc7` (v1) — content hash `908d97be6979702204cdec5e9cf1184399aaeadbd8e1f933229fdac119d94239` |
| Webhook events recorded | `checkout.session.completed`, `payment_intent.succeeded`, `refund.created`, `refund.updated`, `charge.refunded` |

**Session recovery.** The first purchase step created the authorized session but lost the response body when the page navigated to Stripe. Recovery used the product's idempotent replay with the ledger-recorded Idempotency-Key, which returned the **identical** `cs_test_` id and order. Counts stayed at 1 quote, 1 order and 1 payment throughout. The test card was then entered once and Pay clicked once.

**Paid checks — 22/22 PASS** (`evidence/pay03a-stg01/stage6-paid-checks.json`):
* **Ledger:** canonical binding of payment, quote and order is correct; exactly one report version.
* **Hash (D-HASH-1, physical):** SHA-256 over the **delivered** report JSON equals `content_hash`.
* **Privacy:** no buyer, payment or order identifiers in the report; private evidence absent.
* **Access refusals:** another buyer gets 404, anonymous gets 401, and a buyer refund attempt gets 403.
* **S04, now non-vacuous:** an authenticated PostgREST read returns 0 rows while a real paid snapshot exists.
* **Share links:** a link opens anonymously while entitled, and returns **410 expired** after 300 s.
* **Recovery:** admin reconcile is idempotent and attributed.

**Refunded checks — 15/15 PASS** (`stage6-refunded-checks.json`):
* **One refund:** a single `re_`, with the original references preserved.
* **State:** quote `refunded`, order `revoked_refunded`, snapshot revoked.
* **Buyer access:** the report returns 403, the existing share link 410 **revoked**, and a new share 403.
* **Other buyers:** 404.
* **Replayed refund:** idempotent, with **no second refund**.
* **Audit:** `REQUESTED` written before and `RESULT` after the provider call, attributed to the platform admin; admin history stays auditable.

**PAY-01C:**
* Every original row is still byte-identical after Stage 6 (`pay01c-preservation-summary.txt`).
* **Observation:** the PAY-01C backend process (pid 28526, started 2026-10-31) was found stopped after the Owner's terminal steps. Every stop command in this assignment was guarded to processes running from the PAY-03A worktree. The PAY-01C evidence is unaffected, and the process can be restarted with the Owner's PAY-01C launcher.

**Not executed (by design, to stay within one authorized session):** a live duplicate-checkout replay with a *different* key, live out-of-order webhook injection, and a live failed-refund test. These are covered by unit tests and by the PostgreSQL smoke.


## 7. Stage 7 — Independent certification

### 7.1 Exact-head custody
* **Implementation parent:** `b72dbefc`.
* **Runtime candidate:** `cc4f6638`. Every subsequent commit is test, evidence or documentation only (see the final-head note in §8).
* **Migrations:**
  - the only new one is `20261101100000`, forward-only, and it leaves applied files untouched;
  - shared staging has **no** PAY-01A/01C/02/03A migration applied (read-only check);
  - Production was not inspected (no authorization).
* **PR #250:** Draft and unmerged.

### 7.2 Independent adversarial challenge
A separate reviewer was given the code and the challenge list, not this report's conclusions. It worked offline with a connection guard.

| Finding | Severity | Disposition |
|---|---|---|
| F1 non-historical categories | Medium | Fixed (Owner decision) |
| F2 identifiers in shared payload | Medium | Fixed |
| F3 legacy route revokes paid snapshot | Medium-Low | Fixed |
| F4 failed refund lock-out | Medium | Fixed — forward migration, mutation-checked |
| F5 out-of-band **partial** refund never reconciles; share link keeps serving | Low-Medium | **OPEN — condition.** Fix: on refund-evidence mismatch, move the payment to a suspending state and alert |
| F6 drafts enumerable, legacy trust score | Low-Medium | Fixed |
| F7 false free-vs-paid claims | Low-Medium | Fixed; Owner re-confirmed |
| F8 lock-order deadlock | Low | Fixed by design (advisory lock); not stress-tested concurrently |
| F9 / F10 / F11 | Low | Fixed |
| F12 migration edited in place | Process | Verified: no persistent shared environment applied any version; the fix shipped as a forward migration |
| F13 integer-like JSON keys | Info | Documented limitation: the scheme is defined over JSONB key order; current payloads contain no integer-like keys |

**What the reviewer found sound:**
* identity comes only from a proven session;
* the provider, amount and currency are enforced;
* replaying an Idempotency-Key converges on the same records;
* webhook verification is correct;
* one report version per order;
* RLS hides paid snapshots;
* share-token entropy and expiry are adequate;
* the refund audit is fail-closed;
* the evidence-review RPC is restricted to the service role and refuses self-review;
* `SECURITY DEFINER` functions are hardened;
* the browser never treats Stripe return parameters as payment proof.

## 8. CI on the certified heads

* **Runtime candidate:** required workflow `pay02-commercial-foundation-ci.yml` run `41271920394` SUCCESS on `cc4f6638`. Both jobs passed, including the disposable-PostgreSQL contract with the new migration.
* **Earlier candidate:** `5b045fe2`, run `41269052268`, SUCCESS.
* **Other red checks** are byte-identical at the certified parent `b72dbefc` and are not introduced here:
  - `featureManifest.drift.test.ts` (2 tests);
  - the Diaspora `SAILING MATCH` test;
  - `UNGOVERNED_BRANCH` in the deployed-staging gate (no staging journey ran).
* **Final head:** documentation and evidence only. It re-runs the required workflow; the result is recorded in the PR.

## 10. Next Payments 2.0 milestone

1. **Close F5:** suspend access on refund-evidence mismatch, and alert.
2. **Canonical Vehicle Truth:** fix F-LIFE-1, the registration-row labelling and upload-time dating.
3. **Genuine evidence capture:** capture with source-attested event dates, and decide on a BE FORWARD reuse permission. This is what unblocks the genuine product.
4. **Owner decisions on the free-route overlap:** restrict or price the Milestone 4 self-service snapshot.

**PAY-03B — Dealer and Business Subscriptions** may proceed under its own authority once the Moderator accepts this scope.



## 9. Findings outside PAY-03A scope (reported, not changed)

| ID | Finding | Owner |
|---|---|---|
| F-MIG-1 | `20260818110000_issue164_listing_location_provenance.sql` pre-image parses `count(<new column>)` inside `EXECUTE` and fails on any database lacking those columns (fresh install). File is production-pinned. | Canonical Vehicle Truth |
| F-LIFE-1 | Canonical lifecycle labels CarUp initial-registration ledger rows "Ownership transfer" (free and paid reports) and dates undated evidence at upload time. PAY-03A's gate no longer counts them, but they still render in report content: **retail blocker**. | Canonical Vehicle Truth |
| F-RL-1 | All `isSensitive` routes share one per-IP counter, and each compares its own max against it. A NAT'd population (e.g., carrier-grade NAT) shares a 5/min checkout budget. | Platform security |
| F-ENV-1 | The Supabase CLI resolves `SUPABASE_PROJECT_ID` from the caller's `.env`; run from a CarUp checkout it resolved the **production** ref. The launcher now isolates it, but operators should know. | Platform tooling |
| F-RLS-1 | Local `vehicle_ownership_history` has no RLS and is readable by `anon` (owner ids). Check production/staging posture. | Platform security |
| F-CI-1 | `featureManifest.drift.test.ts` (2 tests) and the Diaspora `SAILING MATCH` test fail identically at `b72dbefc` and at the candidate; the deployed-staging gate fails closed with `UNGOVERNED_BRANCH` on every head of this PR. | Feature governance / Trade OS |
