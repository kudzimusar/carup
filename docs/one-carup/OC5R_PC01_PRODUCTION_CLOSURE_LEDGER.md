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

---

## Defects found and fixed

| # | Defect | Class | Fix |
|---|---|---|---|
| PC01-DF1 | `backend/tests/ci-staging-shard-aggregate.test.js` still asserted `TRADEOS_WORKER_SECRET is not configured`. REL-03A (`9257be51`) had moved the shard to the canonical `COMMUNICATION_WORKER_SECRET`, so the full backend suite was **red at the starting authority `98158b51`** (proved in a clean worktree) | pre-existing harness drift | The assertion follows the canonical secret and still requires a loud `exit 1`. It also now **forbids** `TRADEOS_WORKER_SECRET` returning to the shard (REL-03B §5). Verified 17/17, and it kills a fail-open mutant |

## Running blockers

_None yet: the governed run is awaiting the protected `staging` environment approval (owner action)._
