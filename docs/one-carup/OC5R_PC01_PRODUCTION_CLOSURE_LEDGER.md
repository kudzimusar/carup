# OC-5R-PC01 — Production Closure Ledger

The single cumulative record for **OC-5R-PC01 (controlled long-run reconciliation → production-ready candidate)**. Every phase appends here; the final report is reconstructable from this file alone.

| | |
|---|---|
| Repository / PR | `kudzimusar/carup` · PR #222 (Draft, unmerged) · `fix/oc5r-real-runtime-source-closure` |
| PR base | `feat/oc-expo-push-foundation` @ `9369d3a458283282f3a2ef071a5bed9582a0c9f3` |
| Starting authority | `98158b5157a681fdb99ddbdde6e810a92e097ce0` |
| Staging | `eoyenigwevnxwwhyhaer` |
| Production | the CarUp production project — **forbidden for any mutation** in every pre-production phase |
| `main` | `bb9d9900` (unchanged) |

## Custody notes

- **Supabase connection custody.** The moderator's `link_id` is a connector handle from the moderator's environment. No tool here takes one.
  - The claude.ai Supabase connector cannot open the CarUp staging project (`permission denied`). It is treated as the HealthTimes connection and **not used**.
  - Reads go through the CarUp-dedicated, project-pinned staging server, proven before use (`get_project_url` → `https://eoyenigwevnxwwhyhaer.supabase.co`), and through the read-only custody helper (staging-only, `default_transaction_read_only`).
  - Every **mutation** runs inside a governed GitHub workflow in the `staging` environment, at an exact pushed SHA.
- **Protected-environment approval.** The `staging` environment requires a reviewer (`kudzimusar` or `11-eleven-skm`). This agent's CLI is authenticated as `kudzimusar`, but it **never approves its own deployments**: approval is an owner action.

---

## PC01-A — Exact recustody / no-rediscovery gate — **PASS** (2026-10-10T08:19–08:30Z, read-only)

| Check | Observed |
|---|---|
| PR #222 head | `98158b51…` (= `origin/fix/oc5r-real-runtime-source-closure`); base `9369d3a4`; Draft, open, mergeable; 222 files |
| B6 | run 38016065906, job 114106468774 `drain`: **success** at `98158b51` |
| Queue totals | eligible pending **381** (no pending ≥ 5 attempts) · processed **1044** · dead_letter **121** · quarantined **196** · total 1742 |
| Pending by family | requested 65 · received 65 · approved 17 · rejected 17 · cancelled 14 · evidence.review.decided 93 · marketplace.inquiry.created 82 · rfq.quote_submitted 14 · rfq.quote_accepted 14 (= the brief) |
| Dead letters by family | evidence.review.decided 101 · identity.verification.decided 6 · marketplace.inquiry.created 5 · warehouse.cargo_received 3 · warehouse.measurement_discrepancy 2 · ownership.transfer_completed 2 · transfer_action_required 1 · transfer_started 1 (= the brief) |
| B5 quarantine | 196 rows: AUDIT_ONLY_LEGACY 6 · LEGACY_DUPLICATE_WORKFLOW_EVENT 16 · LEGACY_DUPLICATE_DIRECT_NOTIFICATION 168 · RETIRED_HISTORICAL_EVENT 6. All stamped in one transaction (2026-10-10 00:46:10Z) |
| Schedulers | `carup-communication-worker-every-minute` and `carup-events-outbox-every-minute`: both `active = false` |
| Queue head | D7 (`reservation_requested`, 2026-09-08 02:42Z …) |
| Newest event | 2026-10-08 05:26:33Z, so no event has been produced since the REL-02 run |

- **Stale-run hygiene.** Diaspora gate run 38016068827 (an auto-trigger at `98158b51`) had sat `pending` for 6 h, with no jobs and no pending deployment. It would have failed its pairing proof. It was **cancelled**, so it could not be approved mid-drain.
- **Mutations:** none.

---

## PC01-B — D7 current authority + historical queue closure — **authority PASS; processing via the governed run below**

**Source authority** (at `98158b51`):

- **Producer:** `backend/services/diaspora/containerBookingNotifier.js` emits after the audited mutation. Last changed 2026-09-04, before the oldest pending D7 row.
- **Subscribers:**
  - Communications: all five pending families are in `COMMUNICATION_EVENT_TYPES` (`communicationEventListeners.js`).
  - Other: none. The runtime (`server.js`) registers only `registerDomainListeners` (4 unrelated families) and the Communications listeners.
- **Policy** (`NOTIFICATION_POLICIES`): `channels ['in_app']`, `fallbackChannels []`, `policyChannelsOnly: true`, template `container_booking_update`.
  - `policyChannelsOnly` is enforced as a hard cap after the user-preference merge.
- **Template:** `container_booking_update` active, version 1, `in_app`/`en`, approved. Required variables: `reference`, `status`, `route`.
- **Dedupe:** per event (`dedupeParts[1] = event.id`). Every processed event yields its own notification and thread message.
- **Thread type** `container` is allowed by the live `message_threads_thread_type_check`.

**Live rows** (all 178 pending D7):

| Check | Result |
|---|---|
| Payload | one keyset per family, exactly the current producer's |
| `reservation_received` (65) | `recipientUserId` = the container's `coordinator_id` in 65/65 |
| buyer-directed (113) | `buyerId` = the reservation's buyer in 113/113 |
| `reference` / `status` / `route` | none missing; status matches family (`REQUESTED`/`APPROVED`/`REJECTED`/`CANCELLED`) |
| recipients | `u_tradeos_operator` 65 · `u_tradeos_participant_a` 62 · `u_tradeos_participant_b` 51. All real users, all tenant Hikari |
| reservations / containers | 178/178 exist |
| prior notifications for these events | **0**, so processing creates rather than duplicates |
| legitimacy | current workflow rows, not B5's legacy uppercase duplicates |

- **History.** 219 earlier D7 events were processed end-to-end in September: 183 `container_booking` in-app notifications, **every one** with an `event_id` resolving to a processed D7 event. There is no direct, non-outbox D7 path.
- **Fresh-D7 truth stays separate.** Historical backlog closure proves nothing about a fresh D7 run. Fresh D7 certification is PC01-J's job: the REL-03A run-scoped spec 45 asserts the current reservation, `event_id`, `created_at` after the mutation, and the exact `RES-…` in the UI. September notifications cannot satisfy it.

**FIFO constraint.** The worker takes the oldest 10 pending rows of any family. Rows 1–30 are D7 only. Rows 31–40 hold 5 D7, 3 `evidence.review.decided` and 2 `marketplace.inquiry.created` rows, and marketplace pairs recur every 10–25 rows. So D7 and Class-A cannot drain past row 30 until PC01-D is decided. The phases therefore execute in the queue's own order: **B (30) → D → B/C (269) → E**.

## PC01-C — Remaining Class-A pending — **authority PASS**

| Family | Rows | Proof |
|---|---|---|
| `evidence.review.decided` | 93 | keyset `decision, evidenceId, listingId, recipientUserId, vin`. `reference` ← `evidenceId` and `listing_id` ← `listingId` (no generic fallback); decision present; evidence exists; recipients are real users; `evidence_review_v1` (in-app, approved: `reference, listing_id, decision`); thread `trust_safety` allowed |
| `diaspora.rfq.quote_submitted` / `_accepted` | 14 / 14 | `reference`, `status`, `route` all present; recipients `u_tradeos_rfq_buyer` / `u_tradeos_rfq_supplier`; `rfq_update_v1` (in-app, approved: `reference, status, route`) |

- **Policy and subscribers.** All three families are `in_app` only, with no fallback and `policyChannelsOnly`, and have no non-Communications subscriber.
- **Prior notifications:** 0. B5 quarantined none of these families.

## PC01-D — Marketplace Class-B decision — **classification complete: 82/82 `STALE_HISTORICAL_QUARANTINE`**

- **Policy:** `in_app` + `push` + `email`, with `whatsapp` and `sms` fallback, and no `policyChannelsOnly`. Any delivery queues external-channel rows.

**Per-row facts** (82/82):

| Check | Result |
|---|---|
| inquiry | exists; inquiry seller = event recipient = the vehicle's seller |
| inquirer | guest, all at the reserved **`example.test`** domain (automated UAT `ask-about` / `request-inspection`); 43 purchase-interest, 39 inspection-request |
| inquiry status | all still `new` |
| listing | **none live**: 79 `Sold/publishable`, 3 `Available/publishable` (never published) |
| prior notifications | 0 for the event, 0 for any other event on the same inquiry; no duplicate events |
| recipients | 79 on `carup-staging.test`; **3 on a real `gmail.com` mailbox** (owner account `u_66cace85fad949e4`, VIN `GFC27-027051`). Delivery would email a real person about a synthetic inquiry |
| threads | 6 inquiries already have a seller-side thread created by the inquiry route (1 message each), but no notification |

**Deterministic rule** (`marketplaceDisposition`):

1. A prior notification → `ALREADY_SATISFIED_IDEMPOTENT`.
2. A broken reference → `DEFECT_REQUIRING_REMEDIATION`.
3. A synthetic guest on a reserved domain **and** a listing that is not live → `STALE_HISTORICAL_QUARANTINE`.
4. Otherwise → `SAFE_CURRENT_DELIVERY`, which this programme will **not** deliver without LIVE-PROVIDER authority.

**Outcome:** STALE 82, all other categories 0. Disposition: governed quarantine (status `quarantined`, reason `STALE_HISTORICAL_QUARANTINE`, provenance metadata). No external send, no deletion.

## PC01-E — Dead-letter reconciliation — **classification complete: 114 `REPLAYABLE_CURRENT_WORK` + 7 `SUPERSEDED_HISTORICAL_WORK`**

| Group | Rows | Original failure | Today | Disposition |
|---|---|---|---|---|
| `evidence.review.decided` | 101 | `evidence_review_v1` not registered (Aug 30 – Sep 3) | template registered and approved 2026-10-07; same current keyset as the pending rows; evidence exists; recipients exist; 0 notifications; in-app only | **REPLAYABLE** |
| `diaspora.warehouse.cargo_received` / `measurement_discrepancy` | 3 / 2 | old template required `route` | REL-03B-2 `warehouse_intake_update_v1` needs only `reference`, `headline` (present); B6 processed 44 rows of the identical keyset | **REPLAYABLE** |
| `vehicle.ownership.transfer_*` | 4 | `ownership_transfer_v1` not registered | registered and approved 2026-10-07 (`default` channel: `listing_id`, `status`, `reference` all render); one O2 UAT transfer; recipients exist; in-app only | **REPLAYABLE** |
| `identity.verification.decided` | 4 | `verification_decision_v1` not registered | registered and approved; recipients are `carup-uat.invalid` fixture users; in-app only | **REPLAYABLE** |
| `identity.verification.decided` | 2 | template not registered | **recipient user no longer exists**: created 2026-09-06 by garage-onboarding UAT (audit `GARAGE_EVIDENCE_UPLOADED`, `VERIFICATION_SESSION_CREATED`), since removed | **SUPERSEDED_HISTORICAL_WORK** |
| `marketplace.inquiry.created` | 5 | "no seller participant" | superseded payload shape (no `sellerId`/`listingId`), synthetic Sep-5 inquiries | **SUPERSEDED_HISTORICAL_WORK** |

- **Rule** (`deadLetterDisposition`):
  1. A prior notification → `ALREADY_SATISFIED`.
  2. A superseded shape or an absent recipient → `SUPERSEDED_HISTORICAL_WORK`.
  3. Subscribed, in-app only, render-ready and addressable → `REPLAYABLE_CURRENT_WORK`.
  4. Otherwise → `CURRENT_PRODUCT_DEFECT`.
- **Outcome:** `ALREADY_SATISFIED` 0, `CURRENT_PRODUCT_DEFECT` 0.
- **Replay path.** Exact ids only, through the worker's own `reprocessDeadLetters({ ids })`, then the same gated FIFO drain. The 7 superseded rows get governed historical quarantine (original status `dead_letter` recorded). There is no blind replay.

## The governed closure run (PC01-B → E)

| | |
|---|---|
| Workflow | `.github/workflows/oc5r-pc01-queue-closure.yml` (push-triggered on its own files, `environment: staging`) |
| Runner | `scripts/ci/oc5r-pc01-queue-closure.mjs` |
| Contract | `scripts/ci/lib/oc5r-pc01-queue-closure-contract.mjs` + `oc5r-pc01-frozen-sets.json` (frozen read-only 2026-10-10) |
| Offline proof | `backend/tests/oc5r-pc01-queue-closure-contract.test.js` 18/18, run by the workflow **before** any secret is read |

**Frozen populations** (`md5` over id, type, status, attempts and `created_at`, UTC):

| Set | Rows | Fingerprint |
|---|---|---|
| B/C drain | 299 | `b808839e0453af69d15ac06f36c11f39` |
| D marketplace | 82 | `0b3dfeac47a0092ea1d5282b6e262da0` |
| E superseded | 7 | `2f86c127cbe519c1e908d0ec45aa5f09` |
| E replay | 114 | `6da46b14ae4f4e634a112ac768cbe794` |
| S1 D7 prefix | 30 | the first 30 FIFO ids, plus the exact boundary batch |

**Segments.** Each is fail-closed with exact expectations, and totals are derived from the start, never typed:

| # | Phase | Action | Expected after |
|---|---|---|---|
| S0 | preflight | totals, schedulers, B5 reasons, four fingerprints, queue head = frozen D7 prefix, per-row D/E dispositions recomputed live | 381 / 121 / 1044 / 196 |
| S1 | B | drain while every row is D7 (30 rows); must stop at the frozen boundary batch on `unauthorized_family_boundary` | pending 351, processed 1074 |
| S2 | D | atomic quarantine of the 82 (`FOR UPDATE NOWAIT`, fingerprint re-checked in the transaction) | pending 269, quarantined 278 |
| S3 | B/C | drain D7 + Class-A to `empty_queue`; processed set = frozen 299 − S1's 30 | pending 0, processed 1343 |
| S4 | E | atomic quarantine of the 7 (`dead_letter` → `quarantined`) | dead 114, quarantined 285 |
| S5 | E | `reprocessDeadLetters` on the exact 114, then drain; processed set = the 114 | dead 0, processed 1457 |

**Every cycle repeats B6's per-batch contract:**

1. A fresh read-only inventory.
2. The gate: every row an allowed family, `IN_APP_ONLY`, render-ready, and the inventory's combined gate passes.
3. A queue-head match and an exact row snapshot (`FOR UPDATE NOWAIT`, rolled back).
4. One `pollEvents()`.
5. Per-row reconciliation: +1 attempt, `processed`, no error, its own in-app notification and message, zero external notification, attempt or send.
6. Global checks: external delivery attempts, external-send evidence and external queue rows unchanged; no new dead letter or quarantine mid-drain.

**Final assertion:** pending **0**, dead_letter **0**, processed **1457**, quarantined **285** = B5's 196 (reasons unchanged) + 82 `STALE_HISTORICAL_QUARANTINE` + 7 `SUPERSEDED_HISTORICAL_WORK`. The 205 existing external delivery attempts and 510 external queue rows are unchanged, and both schedulers stay inactive.

**Pre-run verification** (read-only, 2026-10-10):

- The runner's own preflight SQL, through the custody helper, reproduced all four fingerprints.
- The contract's JS rules over the live rows gave: head = frozen prefix; marketplace 82/82 STALE; replay 114/114 REPLAYABLE; superseded 7/7.
- **Rendering.** All 114 replay rows render through `CommunicationTemplateService.render` with variables projected from their real payloads (evidence 101, identity 4, warehouse 5, ownership 4).
- **The governed resolver** (`communicationGovernedTemplateService.resolveGovernedVersion`) accepts an approved `default`-channel version for an in-app send. That covers `ownership_transfer_v1`, and matches the render-contract selection exactly.
- **Thread types.** Every policy thread type in scope (`container`, `trust_safety`, `marketplace_inquiry`, `account`) is allowed by the live `message_threads_thread_type_check`.

### Result — run 38039280275: **PC01-B–E ACCEPTED by the moderator; recustodied 2026-10-10T13:17Z**

| | |
|---|---|
| Run / job / artifact | **38039280275** / 114176118881 / 11670405560 |
| Authority | `bcd7076a22f16c18e82fb07ef50eb8f02e18a136` (the run's checkout; still the PR head at recustody) |
| Environment approval | owner; the job ran 2026-10-10T12:08:32Z → 12:36:20Z, conclusion `success`, every step green |
| Runner window | 2026-10-10T12:09:09.858Z → 12:36:17.474Z |
| Artifact digest | `sha256:bc40fcdac9813502ece29c51badbc3a985e1d16ec8df1b2492d316f691198003`. It is the expected value and was **recomputed independently** from the downloaded zip |
| Receipt | `docs/one-carup/evidence/OC5R_PC01_QUEUE_CLOSURE_RECEIPT_RUN38039280275.json`, the exact bytes from the artifact (`sha256 538687eda9c407c50e982524b5bae2a4493fb1e942f26a53b28a86c02e5fd3a0`; ids, counts and verdicts only) |
| Worker calls | **42** (3 + 27 + 12 cycles, every cycle green) |
| Notifications / messages added | **413 / 413**, all in-app |
| External attempt / send / queue delta | **0 / 0 / 0**. The 644 attempts, 205 external, 157 send evidence and 510 external queue rows are identical at start and end |
| Schedulers | inactive at start and end |

| | Pending | Dead letter | Processed | Quarantined |
|---|---|---|---|---|
| **Start** | 381 | 121 | 1044 | 196 |
| **Finish** | **0** | **0** | **1457** | **285** |

| Segment | Result |
|---|---|
| S1 D7 prefix (PC01-B) | 30 processed, in frozen FIFO order; stopped at `unauthorized_family_boundary` (3 cycles) |
| S2 marketplace (PC01-D) | 82 quarantined, `STALE_HISTORICAL_QUARANTINE`, fingerprint `0b3dfeac…`, 0 deleted |
| S3 B/C drain | 269 processed = the frozen 299 minus S1's 30; `empty_queue` (27 cycles) |
| S4 superseded (PC01-E) | 7 quarantined, `SUPERSEDED_HISTORICAL_WORK`, fingerprint `2f86c127…`, 0 deleted |
| S5 replay (PC01-E) | exactly the frozen 114 replayed and processed; `empty_queue` (12 cycles) |

**Independent reconciliation: 36/36 RECONCILED** (`docs/one-carup/evidence/OC5R_PC01_QUEUE_CLOSURE_RECONCILIATION.json`;
read-only re-read of staging at 2026-10-10 13:15:19Z). Beyond the receipt's own figures:

- **Live state.**
  - Totals are 0 / 0 / 1457 / 285, with nothing stuck and no other status.
  - The reasons are B5's 6 / 168 / 16 / 6, plus 82 + 7.
  - All 3 `cron.job` rows are inactive.
  - Delivery figures are identical to the receipt's start.
- **The 413 drained rows.**
  - All are `processed`, each with exactly one in-app notification and its message, all created inside the run window.
  - There were 0 external attempts.
  - Nothing else was processed: 1,044 + 413 = 1,457.
  - No domain event was created in the window, and no window notification belongs to any other event.
- **The 89 new quarantines** are exactly the frozen ids, all quarantined inside the window, with full provenance:
  - `programme` OC-5R; `task` `PC01-S2_D_MARKETPLACE` / `PC01-S4_E_SUPERSEDED`; `phase`; `authority_sha` `bcd7076a`;
  - `frozen_set`, `frozen_fingerprint`, `historical_disposition`, `original_status`, `original_attempts`, `rule`.
  - Rebuilding the pre-quarantine fingerprint from that provenance gives **exactly** `0b3dfeac…` and `2f86c127…`.
- **B5's 196 are intact.** All were quarantined before this run, and their reasons are unchanged. B5's own frozen
  fingerprint **`5f95aa13…` rebuilt from provenance**, so no column B5 froze has changed.
- **Observation (pre-existing, not a closure defect).** `eventWorker` marks a row processed without writing
  `processed_at`, and 0 of all 1,457 processed rows carry it. The window proof therefore rests on each row's in-window
  notification. Carried to PC01-M as an observability residual.

**D7.** S1 and S3 drained the historical D7 backlog in-app. **This is not fresh D7 certification.** Fresh D7 remains a
PC01-J item on the new pair, run-scoped, and never uses historical notifications.

---

## Defects found and fixed

| # | Defect | Class | Fix |
|---|---|---|---|
| PC01-DF1 | `backend/tests/ci-staging-shard-aggregate.test.js` still asserted `TRADEOS_WORKER_SECRET is not configured`. REL-03A (`9257be51`) had moved the shard to the canonical `COMMUNICATION_WORKER_SECRET`, so the full backend suite was **red at the starting authority `98158b51`** (proved in a clean worktree) | pre-existing harness drift | The assertion follows the canonical secret and still requires a loud `exit 1`. It also now **forbids** `TRADEOS_WORKER_SECRET` returning to the shard (REL-03B §5). Verified 17/17, and it kills a fail-open mutant |
| PC01-DF2 | `ci.yml`'s release guard (`scripts/ci/assert-db-connections-released.mjs`) has been **red since PROV-01 (`f498e4a6`, 2026-10-08)**, before the starting authority. `ci.yml` runs only on `main`, so nobody saw it, and it would have turned `main` red on merge. There were 7 unguarded `connect()` calls: the provider proof, REL-03B5 (×2 scripts, ×2 in its workflow), REL-03B6's workflow, and **PC01's own closure runner** | pre-existing CI-guard failure, plus one more instance of my own | Each call is now `try { connect } catch { end; throw }`, the guard's own rule. Fixing the REL-03B5/B6/PC01 files would by itself have **started** those one-shot staging mutations, since each was push-triggered on its own files. They are completed, so their triggers are retired to `workflow_dispatch` in the same commit (GitHub reads triggers from the pushed head). Guard: rc=1 → rc=0 |
| PC01-DF3 | Mobile certification was red twice over, with no product cause. (a) The tab guard counted header literals against `fetch` calls, but since `73248e82` (2026-08-19) escrow sends the ngrok header to both of its fetches through **one** shared `headers` object, so it read as "1 of 2". (b) Vitest tried two standalone `tsx` scripts as suites ("No test suite found"). Its own config says such scripts must be excluded | pre-existing harness defects | (a) The guard now judges **each call**, which is stricter than counting; mutants give "2 of 2" and "1 of 2" and name the call. (b) Both scripts are excluded. Mobile: vitest 6/66; all 18 `tsx` scripts rc=0; `tsc` clean |

## PC01-F — Source-lane semantic convergence — **disposition complete (read-only)**

**Method.** The accepted RC2 record (`ONE_CARUP_OPEN_PR_DISPOSITION_RC2.md`) classified these **same** heads commit by commit: #208 `e65c0bb8`, #209 `ce45e16f`, #213 `ab9cc0e7`, #217 `6c8ff6f7`. None has moved since. PC01-F therefore re-verified that record at `bcd7076a`:

- **History:** the 144 post-RC2 commits.
- **Patch equivalence:** `git cherry` for every PR.
- **Files:** a file-level comparison of every file each PR changed, then spot-verification of 77 ABSENT, BOTH_CHANGED or MISSING files.
- **Conversion:** mapped onto the four categories, with concrete paths.

Commit counts were not used as evidence. The most consequential new claims were then **independently re-proved in source and on live staging** by the lead (marked ✔).

| PR | ALREADY_PRESENT_IN_#222 | SUPERSEDED_BY_NEWER_AUTHORITY | STILL_REQUIRED_AND_MISSING | REJECTED / OBSOLETE | Capabilities |
|---|---|---|---|---|---|
| #208 People / Identity / Dealer | 14 | 3 | 5 | 9 (incl. deferred by recorded owner decision) | 31 |
| #209 Garage / Mechanic | 11 | 4 | 3 | 4 | 22 |
| #213 Seller UAT remediation | 6 | 1 | 4 (all owner-gated) | 2 | 13 |
| #217 AI gateway / Gemma | 5 | 2 | 0 | 1 | 8 |

**Already present / superseded (summary).**
- **#208:** P1–P6, X1–X3, X5 (applicant and workbook mapping), X6, X4 interface, dealer listing authority, the transfer-refusal vocabulary, upload idempotency (bounded), U1 and U2. All arrived by re-authored ports (OC-4D, OC-5C, #194, OC-5J). The narration layer, P7 contrast and the U1 boundary test are superseded.
- **#209:** GMO-0/1/2/3/4/6/7 via OC-5E/C3, the tenant-role catalogue (OC-5A), the document-bytes extraction and the governed Qwen classifier. GMO-5's oldest-membership context is superseded by OC-5D's verified active tenant and must never return. The step-up UI is superseded by OC-5C's single path.
- **#213:** rollup@2 (A1; A2's attribution superseded by `vehicle_reservations.seller_id`), the compare-funnel migration (B), Communications test ids (C), the Landing fixture scope (E), and Home/unpublish/republish/sold (F-P/R, **deployed PASS** at REL-02).
- **#217:** `aiCapabilities`, `aiRuntimeConfig`, `carUpAiGateway`, the 36-case gateway tests and env keys are present. The provider's HTTP client is superseded by the shared `cloudflareAiTransport` (same failure codes, better redaction), and the body is #217's plus `enable_thinking=false` (REL-02 E). Governing checks hold: only the transport builds Workers AI URLs; OCR stays Cloudflare/Qwen off the gateway; `/api/ai/ocr` answers 410; `askGemini` is retired.

**Rejected / obsolete.**
- **Never as written:** whole-file `verificationSessionService` (re-exposes `review_notes` and the reviewer's identity), `authMiddleware`, `server.js`, `aiServiceBus`, the DI service, and `trustGraphService` (a second Trust writer).
- #208's original migrations and harness edits.
- `f45dce7b` (edits a certified gate), and #213's spec 38 copy.
- The GMO-8 acceptance, which certified #209's lineage only.
- **Deferred by recorded owner decision:** X4 consent/assessment, dealer company-document OCR, the X5A workbook catalogue and AI Workbook Assistant, U3, `workbook.import.completed`, the HMAC stamp, the U2 timing log, and PDF identity documents (H truthfully accepts images only).

### STILL_REQUIRED_AND_MISSING — disposition

| # | Item | Source | Evidence on `bcd7076a` | Disposition |
|---|---|---|---|---|
| F1 | **Identity decision fail-open (new).** A system-classified non-document can be escalated with reason `OTHER` and then **approved** | #209 review | ✔ `decisionRecorder.recordDecision` writes `primary_reason_code` for **every** action (escalate and note included, no validation). The non-document path stores the classification only in `verification_assessments`, so the approve gate (`buildAssessmentSummary(session)`) reads `NOT_RUN`. `OTHER` has `approveAllowed: true`. ✔ Live staging: **6** `pending_manual_review` sessions are in exactly this state (`DOCUMENT_NOT_VISIBLE`, session classification NULL). 0 approved sessions carry a non-valid assessment (not exploited). Violates the PO ruling §12D invariant 4 | **PC01-G (bounded: fail-open validation)** |
| F2 | **Classification and extraction trust as independent axes** (`43be0ad2`) | #209 | ✔ `verificationSessionService.js:531` makes core fields `PARTIALLY_TRUSTED` only if the classification is exactly `valid_identity_document`. A `likely` document with fields is stamped `OCR_RESULT_UNTRUSTED` (`approveAllowed: false`). Honest applicants are blocked, and garage approval/activation require usable identity. **Authority:** the PO ruling §12D (frozen: 12 invariants; `OCR_RESULT_UNTRUSTED` stays blocking) and OC-5E decision #9 ("port before any end-to-end garage UAT") | **PC01-G**: one file, re-keyed to H's `providerUsage.imageBytesSent`. Take no whole file, no `reasonCodes` and no `decisionPolicy` change |
| F3 | **Identity upload/submit hardening** | #208 (RC2 P3, wider) | ✔ `uploadVerificationSessionImage` and `submitVerificationSession` have **no session-state gate** (routes: `authorizeRole()` only; `fetchSession` checks ownership only). A rejected applicant can re-upload and resubmit the same session, bypassing policy A. A verified session's evidence can be replaced after approval. Also: the declared MIME type is trusted at upload; base64 is lenient; the UI's "15 MB" exceeds the 15 MB JSON body limit for base64 (~11.2 MB of real file) | **PC01-G**: state gates (upload: draft, captured, uploaded, retry_requested; submit: uploaded, retry_requested; else 409), strict base64 + magic-byte sniff (`detectImageType`) + `image/jpg` normalisation + minimum size, and a 10 MB server and UI limit |
| F4 | Keyboard-reachable file inputs (WCAG 2.1.1/4.1.2, level A) | #208 | `className="hidden"` inputs inside non-focusable labels: `RegistrationJourney.tsx`, `DealerOnboarding.tsx` (×2). The same defect is in `GuestSell.tsx` | **PC01-G**: `sr-only` + `focus-within` ring |
| F5 | Home page phone layout | #208 `b822a3bb` | `Landing.tsx` and `JourneyMediaStory.tsx` are the pre-fix layout. The Product Owner failed it on a phone. Overflow is unmeasured | **PC01-G**: measure at 393 and 320 px first; port layout classes only if it fails |
| F6 | Dealer onboarding phone layout remainder | #208 | Rows do not stack; no `min-w-0`; the page clips (`overflow-x-clip`) | **PC01-G**: measure at 393 px; classes only |
| F7 | Identity-provider outage record | #209 | Live gap: an unconfigured classifier yields `UNCERTAIN`, then `DOCUMENT_NOT_VISIBLE` (not approvable). Unrecorded on H | **PC01-G** (docs, updated to H's `isConfigured()`). **Owner decision:** manual-review fallback when the classifier is down |
| F8 | O2 runtime re-certification (P7, X7, mobile, owner UAT) | #208 | No O2 deployed gate on H. #208's workflows hard-pin #208 SHAs; its spec 45 collides with Trade OS | **PC01-J** sibling gate (spec 44 or 49) on the governed pair |
| F9 | GMO-8 deployed golden journey | #209 | No equivalent on H. `oc5h-rc2-garage-journey` is PGlite with a pre-approved identity | **PC01-J** sibling gate. Owner decisions: real identity approval (needs F2) vs out-of-band; reviewer identity; Cloudflare spend |
| F10 | #213 D: thread materialized inline on inquiry | #213 | `createInquiry` writes the row and the durable event only. H is **truthful** without it (the inbox reads `marketplace_inquiries`) | **Owner decision** (sync materialization + failure rule, or a governed async drain, or leave spec 48 Q unrun) |
| F11 | #213 F-Q: spec 48 Phase Q | #213 | `test.fixme`; depends on D or a governed drain; email-only pin kept | **Owner decision** (through F10) |
| F12 | #213 O: Seller Intelligence panels and the Owner Dashboard cockpit | #213 | H shows only rollup-backed numbers and states unavailability: truthful | **Owner decision** (panels, reservation semantics, dashboard layout) |

**Discovered alongside (not owned by the four PRs):**

| Finding | Detail | Disposition |
|---|---|---|
| Staging definition drift | #208's P7 workflow applied six of #208's own migrations to staging. OC-5R later **ledger-repaired** H's `20261004170000/170100/173000` over those objects, with existence-only probes. The definitions differ: FK `CASCADE` vs `RESTRICT`, missing CHECKs, an unpinned function `search_path`. `20260904090000` (two DROP NOT NULLs) is recorded nowhere | **PC01-H**: read-only catalogue probe first |
| `activate_garage_application` on staging | The ledger check accepted a body hash (`06da4e43…`) that matches no committed body. OC-5E's hardening (`search_path`, grants) is unverified on staging | **PC01-H**: read-only `pg_proc` probe |
| Legacy `/kyc` page | Posts identity documents (including PDFs) to `/api/media/upload/document` with the national id as a pseudo-VIN: a second, ungoverned identity intake | **Owner decision:** retire or redirect to `/onboarding` |
| Upload-idempotency candidate migration | Concurrent dedupe absent until it is promoted | **Owner decision** |
| Stale documentation | `CARUP_AI_CONSUMER_MATRIX.md`: the #217 "byte-identical" line (Gemma now differs by `enable_thinking`) and the price-estimate row (no inference since `5b55db00`) | **PC01-G** docs correction |

## PC01-G — Final source candidate — **source items F1–F7 implemented; certification in progress**

The work is built on a local branch from `bcd7076a`, one commit per item. It is pushed only after the closure-evidence
commit, rebased onto it, so the closure run's exact head is never moved. Final SHAs are recorded when pushed.

| # | Outcome | Deviation from the PC01-F plan, and why | Proof |
|---|---|---|---|
| F1 | A reviewer action can never relax a blocking reason the system assigned. Resubmission and rejection still assign. An escalation or note may tighten, and may lift only the reviewer's own `escalation` marker. Unknown reason codes are refused | "Notes never change the reason" would have deadlocked `SPECIALIST_REVIEW_REQUIRED`: a note is the only action left in `ESCALATED`. So notes and escalations lift only the `escalation` category | 7 tests (`pc01-identity-decision-integrity`); the exploit chain fails first |
| F2 | Classification and extraction trust are independent axes. Core identity fields are `PARTIALLY_TRUSTED` only with positive proof the provider processed the image (`provenance.imageBytesSent > 0`). Otherwise they are `OCR_RESULT_UNTRUSTED` | — (one file, re-keyed; no `reasonCodes` or `decisionPolicy` change) | 12 tests (`o2-identity-review-contract`, ported from #209). Two fixtures now model the real provider shape, with assertions unchanged |
| F3 | Upload and submit are open only in the four applicant-owned states the wizard offers. Anything else is a 409 naming the state, storing nothing and changing nothing. Both status writes are **compare-and-set**. The payload must be strict base64 whose magic bytes match the declared type; `image/jpg` is normalised; at least `MIN_IMAGE_BYTES` | (a) Submit also admits `draft`/`captured`: they can never pass the missing-uploads check, so they keep its precise 400 instead of a generic 409. (b) **Compare-and-set added:** `_checkReject`/`_checkEscalate` accept `APPLICANT_ACTION_REQUIRED`, so a reviewer's rejection racing an upload was written over with `uploaded`. (c) **The 10 MB alignment was withdrawn → F3b** | 11 tests (`pc01-identity-upload-integrity`, including the shipped routes: 409/400). 9 fail on the pre-F3 service; 8/8 guard mutants are killed. Five hand-rolled mocks gained a faithful `.in()`; one had a no-op `.in()` that would have hidden the compare-and-set |
| F3b | **Owner decision: upload size truth.** Proved on the deployed backend: a 3 MB body reaches Express (403 CSRF); a 5 MB body gets `413 FUNCTION_PAYLOAD_TOO_LARGE` from the platform. Base64 JSON uploads above ~3.3 MB of image fail on every deployed runtime, for identity, dealer and garage alike, while the pages promise 15 MB. There is no client compression | Not a bounded fix. The options are browser-side compression, direct-to-storage signed upload, or a smaller promise. That is product semantics | — |
| F3c | **New: garage evidence must be the file type it declares** (present on #222 and on #209's head). It follows dealer onboarding's rule: strict base64, signature equals declared type, filed as what it is | Found while aligning F3. Bounded fail-open validation (§16) | 2 tests (CONTENT section of `o2-ocr-c3-garage-security`). Both fail on the pre-F3c service; 3/3 mutants killed. Four junk-byte fixtures now use real signatures, including the `../app-bob` case, so "evidence type refused first" stays a real assertion |
| F4 | Every file picker on the applicant and seller paths is reachable by keyboard: identity tiles, dealer document and workbook, guest and owner listing photos (`sr-only` plus a `focus-within` ring), and the Trust & Safety dropzone (a keyboard button) | Scope grew by two **found** sites, `SellVehicle` and `TrustSafety`. **`/kyc` is left alone:** whether it exists is an owner decision (below) | Five tests, one per page, that fail on the pre-F4 pages. Technique: Tailwind's own `.hidden`/`.sr-only` rules make user-event's Tab skip `display:none` as a browser does |
| F5 | **Measured FAIL → ported.** Home at 320 px showed 0/3 primary actions and no search before the bottom nav. The #208 `b822a3bb` classes are ported (class-only, 40 lines 1:1), with **`lg:` guards** where they leaked to desktop | The leak: an added `sm:leading-[…]` outranks the line-height `sm:text-*` sets, which desktop actually renders. Also a shadow, a badge colour, trust-strip padding, and card spacing | Local, every API stubbed, zero egress. 320 px: h1 48→40.8 px, primary action above the fold 0→1 of 3, page 15,215→12,988 px. 393 px: 3/3 actions and search on the first screen. **1024 and 1440 px: 0 box differences across 1,098 elements** |
| F6 | **Measured.** The page itself is clean at 320/393 px. Once a workbook was inspected, the **mapping decision was off-screen** behind an unannounced horizontal scroll. Fixed: rows stack on phones; from `sm` up it is the same table (0/62 differences at 640/1024/1440). Every mapping select is now named (WCAG 4.1.2) | — | One test that fails on the pre-F6 page |
| F7 | `CARUP_OPERATIONS_O2_IDENTITY_PROVIDER_RESILIENCE_FOLLOWUP.md` is re-keyed to this lineage. It records that the pre-F1 route was a defect, not a fallback. The stale `CARUP_AI_CONSUMER_MATRIX.md` lines are corrected (price estimate: no inference since `5b55db00`; Gemma body differs by `enable_thinking` since `e8d5eede`) | — | Docs only; CR-1 clean |

**New owner items from PC01-G:** F3b (upload size truth). Also the legacy `/kyc` page, beyond the existing row below: it
prefills a fabricated identity (`Tendai Moyo`, `63-1234567A89`), and its three dropzones are not keyboard-reachable.

**Certification at the local candidate head** (exact `ci.yml` environment; `ci.yml` itself does not run on PR #222).

| Gate | Result |
|---|---|
| Full backend suite (`backend/tests/*.test.js`, at `8d8de59d`) | 8,414 tests: 8,391 pass, **0 fail**, 23 skipped. This is +32 against the pre-G 8,382, which is exactly F1 7 + F2 12 + F3 11 + F3c 2 |
| Full web suite (`vitest run` from `web/`) | 239 files, **2,267/2,267** |
| Web typecheck (`tsconfig.app.json`) · `tsc -b` · production build | rc 0 · rc 0 · rc 0 |
| `database/test` PGlite checks (all 20 listed in `ci.yml`, plus 11 `diaspora_*` harnesses) | all rc 0 |
| `assert-gate-assertions-intact` · shard tripwires · CR-1 credential scan · `git diff --check` | rc 0 |
| `assert-db-connections-released` | **rc 1 → fixed by DF2 → rc 0** |
| Mobile: vitest · `test:static` · the other 13 `tsx` scripts · `tsc --noEmit` | **red → fixed by DF3 →** 6/66 · rc 0 · rc 0 · rc 0 |
| The lint-baseline gate | not run locally (standing rule). Every changed web file passes eslint |

The full backend suite and the CI-equivalent are re-run at the exact pushed head before PC01-I.

## PC01-H — Staging DB convergence (`eoyenigwevnxwwhyhaer` only) — **read-only recertification done; correction built, not executed**

The OC-5R pipeline was re-run against a fresh read-only capture (2026-10-10 10:56:01Z). The candidate's migrations are
byte-identical to `bcd7076a`'s (`diff -r`): F1–F7 add none.

| Check | Result | Against the OC-5R accepted baseline |
|---|---|---|
| Ledger ↔ source (post-mode manifest) | **208 RECORDED_AND_PRESENT**, 7 NEVER_APPLY, 1 ONE_TIME_DATA_MIGRATION_NEVER_REPLAY, 1 UNPROBEABLE | +1 recorded: REL-03B5 `20261009110000`. The UNPROBEABLE file is REL-03B2 `20261009090000` (template data). A manual probe finds its **3/3 templates and their approved v1 versions exact** |
| Ledger rows | 265 (orphan 38, double-recorded 17) | 263 + the two REL-03B migrations; orphans and doubles unchanged |
| Strict reverse lineage | **7,707 live objects; nothing unexplained beyond the custody record** (PR208 dealer-extraction: 4 columns; X4 biometric consent: 36 objects) | +4 = the B5 quarantine migration's 3 columns + 1 CHECK, all explained by lineage |
| Integrity sweep | 509 FKs, all validated, **0 orphans, 0 anomalies**; 1 authored NOT VALID CHECK | identical |
| Function bodies | 91 EXACT, 11 CANONICAL. `carup_ts_deterministic` reads ABSENT, but it is a `pg_temp` helper used only during its migration, so the absence is correct | identical |
| Schedulers | all 3 `cron.job` rows inactive | — |

**Definition drift (D1–D7) — measured; every other column, CHECK list, trigger, grant and RLS flag matches.**

| # | Object | Live | This lineage |
|---|---|---|---|
| D1 | `identity_lifecycle_events.user_id` FK | `ON DELETE CASCADE` (#208) | `RESTRICT` (`20261004170000`) |
| D2 | `dealer_workbook_mapping_confirmations` user, dealer FKs | `CASCADE` (#208) | `RESTRICT` (`20261004173000`) |
| D3 | `dealer_workbook_mapping_confirmations` CHECKs | none | checksum `^[0-9a-f]{64}$`, `mapping` is an array |
| D4 | `dealer_workbook_mapping_confirmations.dealer_id` | nullable (#208 `20260904090000`) | `NOT NULL` |
| D5 | `diaspora_workbook_import_receipts.tenant_id` | nullable (#208 `20260904090000`, **recorded nowhere**) | `NOT NULL` (`20260727120000`) |
| D6 | `identity_lifecycle_events_append_only()` | no `search_path` | `public, pg_temp` |
| D7 | `activate_garage_application(uuid, text)` | #209's: no `search_path` (body canonical-equal; that is the `06da4e43` hash) | OC-5E: `public, pg_temp`. Grants already match (`service_role` only) |

Both O2 tables have 0 rows, no policies, and nothing references or views them. 0 receipts have a null tenant.

**The correction** (`database/scripts/lib/pc01StagingDefinitionConvergence.mjs` and its CLI) rebuilds the objects from
the lineage's own SQL. In one transaction it:
1. checks 13 pre-assertions that **are** the measured drift, so production, a converged staging, or a moved staging is
   refused;
2. drops the two empty tables (`DROP … RESTRICT`) and replays their migrations' Up sections;
3. replays the GMO-4 function migration;
4. sets `tenant_id` to `NOT NULL`;
5. checks 14 post-assertions.

There is a dry-run mode, and a recovery script restores the recorded pre-image.

PGlite rehearsal: fresh lineage, then the measured drift, then converge. The result is an **identical catalog to the
fresh lineage**. A fresh lineage is refused; a dry run is a no-op; a second run refuses; a non-empty table refuses and
keeps its row; recovery restores the pre-image. 4/4 mutants are killed.

**Execution:** after the G push. Dry run first, then apply, then the read-only pipeline re-run. Receipts go to
`docs/one-carup/evidence/`.

## PC01-L preparation (read-only; to be re-proved on the final candidate)

Six security branches exist. Each was checked against the candidate by ancestry and content:

| Branch | Head | Ancestor of #222 / `main` | Containment on the candidate |
|---|---|---|---|
| `hotfix/oc-p0l-verify-ledger-containment` | `59e9eebf` (2026-10-04) | no / no | **Equivalent re-authoring (OC-3B).** The route `GET /api/vehicles/:vin/verify-ledger` is `authorizeSessionRole(), requireVehicleObjectAuthority()`. Files: `backend/middleware/vehicleObjectAuthority.js`, `backend/services/blockchain/ledgerIntegrityProjection.js` (allow-listed projection, never the chain). Tests: `oc3b-ledger-integrity-containment`; `oc3b-ai-authority-invariants`; `oc4a-provenance-object-authority` (an unknown VIN gets the same refusal as an unrelated one); `oc4e-product-journeys` (anonymous refused) |
| `security/production-access-containment` | `4d17cce3` (2026-06-21) | no / no | **Byte-identical on the candidate:** `20260619201406_production_access_containment.sql`, `20260620232827_issue77_access_containment_followup.sql`, `issue77-access-containment-followup.test.js` |
| `hotfix/d0-evidence-route-private-data-exposure` | `c564a3eb` | yes / yes | by ancestry |
| `hotfix/db-anon-column-exposure` | `72c535b4` | yes / yes | by ancestry |
| `hotfix/audit-logger-fk-safe-fallback` | `4bedffce` | yes / yes | by ancestry |
| `security/cr1-credential-remediation` | `8a7cb544` | yes / yes | by ancestry |

## Running blockers

**Nothing is gating.** The owner approved the `staging` environment and closure run 38039280275 succeeded (ACCEPTED,
recustodied above). Next: rebase the 11-commit PC01-G stack (F1, F2, F3, F3c, F4, F5, F6, F7, DF2, DF3, H tooling — earlier reported as "12" by miscount) onto this evidence commit, certify the exact head, push,
then PC01-H → I → J smoke.

**Owner decisions carried to M** (none blocks a source or staging step):

| # | Decision |
|---|---|
| 1 | F3b — upload size truth |
| 2 | The legacy `/kyc` intake: retire or redirect it (it prefills a fabricated identity and is keyboard-inaccessible) |
| 3 | Identity-provider outage path (F7 record) |
| 4 | #213 D / F-Q / O (F10–F12) |
| 5 | #208's deferred set: PDF identity, the X4 provider, dealer company-document OCR, X5A, the upload-idempotency migration |
| 6 | #209: garage notifications, the GMO-8 approach, the reviewer identity, Cloudflare spend |

**Missing for PC01-J/K (owner action):**
- `COMMUNICATION_WORKER_SECRET` in Vercel Preview for this branch, for a fresh D7;
- `STAGING_UAT_KINGSTONE_EMAIL` / `_PASSWORD`;
- the `TRADEOS_T3_{REQUESTER,PROVIDER}_{EMAIL,PASSWORD}` credentials.

**Production-promotion precondition:** the vision provider's configuration must be present (by variable name) and live,
or every production identity case is refused (F7).
