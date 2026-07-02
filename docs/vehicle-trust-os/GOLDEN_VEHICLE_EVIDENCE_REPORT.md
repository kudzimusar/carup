# Phase 8 — Golden Vehicle MVP Journey (Staging Evidence)

**Date (UTC):** 2026-06-25
**Project:** `eoyenigwevnxwwhyhaer` (STAGING, PostgreSQL 17.6) — production `sfhtlzcgrnrdznhvdrbn` untouched.
**Runner:** `database/scripts/golden_vehicle_journey_staging.mjs`
**Fixture VIN:** `GOLDEN-TRUSTOS-STG-1` (clearly-labelled synthetic).
**Execution mode:** single transaction, **ROLLBACK at end → zero residual data** (append-only triggers fire on `DELETE`/`UPDATE`, not on `ROLLBACK`; SAVEPOINTs isolate expected-failure assertions). Re-runnable. `--commit` persists labelled fixtures if ever needed.

> Government/registry items (ZINARA, CID/stolen) are **labelled synthetic fixtures — NOT live
> government API confirmations**, per the release plan.

## Result: 29 / 29 steps PASS · 0 failed

| # | Step | Result |
|---|---|---|
| 1 | create canonical vehicle | ✓ publication_status=draft |
| 2 | store VIN/chassis/engine/plate + temp-ID | ✓ identity + temp_plate_id stored |
| 3 | create import record | ✓ import evidence + `imported` provenance |
| 4 | upload customs/duty document | ✓ customs doc + `uploaded` provenance |
| 5 | run OCR/extraction | ✓ 4 fields, match_status computed at insert |
| 6 | compare VIN/plate/chassis/engine | ✓ matched=3, mismatch=1 |
| 7 | deliberately produce one mismatch | ✓ plate mismatch present |
| 8 | route mismatch to human review | ✓ review_task opened (vehicle_identity) |
| 9 | reject/correct/supersede mismatch | ✓ reviewer rejected; trust_audit_event written |
| 10 | upload CVR/ownership proof | ✓ verified |
| 11 | upload VID proof | ✓ roadworthiness verified |
| 12 | record ZINARA status | ✓ labelled synthetic (not live API) |
| 13 | record CID/stolen result | ✓ labelled synthetic (not live API) |
| 14 | attach insurance | ✓ insurance evidence attached |
| 15 | completeness/confidence/risk/trust | ✓ evidence classes=4; **governed** trust 40→72 via `trust_change_log` (backed by a review decision) |
| 16 | block publication before policy passes | ✓ gated at `review_pending` |
| 17 | publish after requirements pass | ✓ published with 5 verified evidence |
| 18 | governed public card claims | ✓ public-safe verified=1; restricted-pending excluded=2 |
| 19 | buyer explanations | ✓ itemized in report payload |
| 20 | seller missing-document checklist | ✓ missing: auction, repair, dealer_listing, current_condition |
| 21 | transfer ownership | ✓ owner→owner-2 + transition evidence + provenance |
| 22 | relist the same VIN | ✓ listing snapshots v1 + v2 |
| 23 | previous passport history remains | ✓ evidence=8, provenance=4 preserved after transfer |
| 24 | create report version 1 | ✓ |
| 25 | correct/supersede evidence (governed) | ✓ temporal finding superseded via decision |
| 26 | create report version 2 | ✓ supersedes v1 |
| 27 | report version 1 immutable | ✓ payload UPDATE **blocked** by trigger |
| 28 | public/private + cross-tenant boundaries | ✓ anon provenance grants=0; cross-tenant rows=0; pending conflicts public=0 |
| 28b | append-only provenance | ✓ UPDATE **blocked** by trigger |

## Invariants proven on the live staging schema
- **AI is advisory / governed trust only:** the trust score changed exclusively through
  `trust_change_log` backed by a `review_decisions` row — no automated/AI write path.
- **Ambiguous/mismatched identity is not auto-accepted:** the deliberate plate mismatch routed
  to a `review_tasks` entry and was reviewer-rejected with a `trust_audit_events` record.
- **Missing history is never "clean":** seller checklist explicitly lists missing evidence classes.
- **Publication gate:** vehicle stayed `review_pending` until verified-evidence policy passed.
- **Immutability:** `report_versions` v1 payload and `evidence_provenance_events` rows reject
  UPDATE; `vehicle_document_extractions` content is immutable (corrections via `review_status`).
- **Public/private + tenant isolation:** provenance not granted to `anon`; cross-tenant query
  returns nothing; pending findings never surface in the public projection.

## Phase exit
**PASS — golden journey completes with no skipped critical steps.** Validated against the live
migrated staging database with zero residual data.
