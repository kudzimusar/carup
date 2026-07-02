# Vehicle Trust OS — Production Cutover Manifest

**Status:** ⛔ **NOT AUTHORIZED — 1 critical blocker outstanding (see §0).** Awaiting explicit
`AUTHORIZE VEHICLE TRUST PRODUCTION CUTOVER` from the user. No production change has occurred.

- **Verified release head SHA:** `a81c3ae759fde0e237977a15eb3f1e01bd12a110` (LOCAL == REMOTE on `release/core-vehicle-trust-os-mvp`)
- **PR:** #103
- **Production target:** `vhmnajoeicasaigiophh` (to be re-confirmed at cutover)
- **Staging proof project:** `eoyenigwevnxwwhyhaer` (10/10 applied; golden journey 29/29)

## 0. BLOCKER — must be cleared before authorization
**Exposed production credentials (Gate 15 CRITICAL).** The production DB password for
`vhmnajoeicasaigiophh` is committed in plaintext in **28 tracked files** (`backend/scripts/*.js`,
`scripts/*.js`) and is present in **pushed git history** (base commit `c25b094`).

Required remediation before cutover:
1. **Rotate** the production Supabase database password immediately (treat as compromised) — follow
   `SECRETS_ROTATION_RUNBOOK.md` (emergency rotation). This is mandatory regardless of file cleanup,
   because the old password is already in remote history.
2. **Sanitize** the 28 files: replace hardcoded connection strings with `process.env.SUPABASE_DB_URL`;
   remove dead one-off scripts. (Security remediation — not a feature; scope to a follow-up commit/PR
   so PR #103 stays staging-evidence + docs only, per the "no new features" instruction.)
3. Optional but recommended: purge the secret from history (filter-repo) or rotate + accept history.
4. Re-run Gate 15 → expect 0 matches before authorizing cutover.

(The shipped frontend bundle `web/dist` is clean; the exposure is server-side scripts + history only.)

## 1. Ordered migrations + SHA-256 (the ONLY ten to apply)
Apply in this exact order. Up sections only (the runner strips `+migrate Down`).

| # | Migration file | SHA-256 |
|---|---|---|
| 1 | 20260621120000_vehicle_life_evidence_taxonomy_provenance.sql | `983393661b71d5186a1f3d256c3906ada718487e9df45d4fab7ed0c81f569e90` |
| 2 | 20260621130000_external_source_ingestion.sql | `d3da9207544c6c418aeb9024833196ce180f5fbc64615550171df311dadeb00d` |
| 3 | 20260621140000_ai_temporal_disclosure_intelligence.sql | `8400808f9e5f4a1df87b653865b30bd37c7124f40f8c461e8214d7f591f19817` |
| 4 | 20260621150000_report_versions.sql | `249f85792561ba34bf98e93fd156a1a3137fe2b6f0947a96191d8659e24abca2` |
| 5 | 20260621160000_governance_disputes_corrections.sql | `5923050b5dec8f5d1012db0e394bee546c798343025ff85dbdc85126fc3a7314` |
| 6 | 20260621170000_outbox_dead_letter.sql | `a9be2252d2d9da893d5c36c6831076f30a6d5c9ca39ee09eb4140ce818ba0d16` |
| 7 | 20260624120000_vehicle_trust_security_hardening.sql | `b392d486c73b44b6309b4787ef76c65a39e6fbc5acc7cc3265a1a2a7cd3544f1` |
| 8 | 20260624130000_vehicle_document_extractions.sql | `1fdba1a69c5033674cbf08428644cdd90383a4cf7786210129fcb3d6e9647f28` |
| 9 | 20260624140000_listing_publication_lifecycle.sql | `5640753d403de17fab54010c571c9716e016afb74d6efa77ad64be153a8d5e56` |
| 10 | 20260624150000_trust_change_log_immutability.sql | `04a2438aeefd7175c26b6e23d51f77f95ff3d7cadc743e6480ce821b1483d5ff` |

Verify on the production host before apply: `shasum -a 256 database/migrations/<file>` must match.

## 2. Expected post-apply objects (20 tables + view + columns + triggers)
**20 tables:** evidence_class_taxonomy, evidence_sources, evidence_sets, evidence_provenance_events,
ingestion_jobs, source_records, vehicle_identity_candidates, listing_snapshots, ai_analysis_jobs,
ai_observations, temporal_findings, disclosure_claims, disclosure_conflicts, report_versions,
review_tasks, review_decisions, disputes, dispute_events, trust_change_log, vehicle_document_extractions.
**View:** evidence_sources_public. **New `vehicles` columns:** publication_status, temp_plate_id.
**Append-only/guard triggers (12):** provenance (×2), listing_snapshot (×2), report_version guard,
review_decisions (×2), dispute_events (×2), trust_change_log (×2), extraction content guard.

## 3. Evidence
- **Staging migration:** `STAGING_MIGRATION_REPORT.md` — 10/10 applied to `eoyenigwevnxwwhyhaer`, all objects verified.
- **Golden journey:** `GOLDEN_VEHICLE_EVIDENCE_REPORT.md` — 29/29 steps, transactional rollback (no residual data).
- **Qualification:** `RELEASE_QUALIFICATION_REPORT.md` — 14 PASS / 1 SKIPPED / 1 CRITICAL FAIL.
- **CI:** GitHub Actions run `28153083525` (CI) success on `a81c3ae`.

## 4. Backup / recovery point (to capture at cutover)
- Confirm/enable Supabase PITR on `vhmnajoeicasaigiophh`; record the **pre-cutover restore point
  timestamp** + a logical `pg_dump` snapshot stored off-provider. See `PRODUCTION_MIGRATION_RUNBOOK.md` §Backup.
- Do not proceed without a confirmed restore point.

## 5. Merge + deploy gating
- Merge PR #103 only using the verified head `a81c3ae759fde0e237977a15eb3f1e01bd12a110`.
- Then verify backend + frontend deployments; run `PRODUCTION_SMOKE_CHECKLIST.md`.
- Rollback per `ROLLBACK_AND_FORWARD_FIX_PLAN.md`.

## Recommendation
**Do NOT authorize cutover yet.** Clear the Gate 15 blocker (rotate + sanitize), re-run Gate 15,
optionally run the Playwright journey against staging, then request authorization.
