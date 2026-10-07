# OC-5R — Staging database healing & migration convergence: recertification package

**Status:** candidate evidence for moderator review. **No certification level is claimed or issued by this document.**
The moderator decides what, if anything, it certifies. Under `ONE_CARUP_EVIDENCE_CERTIFICATION_POLICY.md`, DATABASE-CERTIFIED
covers the repository's SQL on disposable PostgreSQL and never the contents of a real CarUp Supabase project (guard rule 6), and
DEPLOYED-CERTIFIED needs a deployed SHA, which this work did not produce. So this package is evidence about the **staging
project's database state**, presented for review.

**Target:** canonical staging `eoyenigwevnxwwhyhaer` only. Production was not connected to, queried, or written at any point.

## Commits (branch `fix/oc5r-real-runtime-source-closure`, PR #222, Draft)

| Commit | What it is |
|---|---|
| `9d2edd98` | Starting head (DB2B-3R1 accepted) |
| `0510b019` | Staging runner rewritten: plan-driven, full-filename identity, the ledger is written only after SQL and effect probes |
| `a7a101e3` | `20261007063512_vehicles_trust_score_unknown_is_null.sql` (DROP DEFAULT only) |
| `bafac027` | Runner: real `replay` action (it was accepted but never implemented) |
| `92051a8b` | Runner: one plan may repair a file into the ledger and later replay it |
| `0f847573` | Runner: a dry run judges a replay the way the apply will |
| `fe6e93f7` | Manifest + convergence plan. **This is the exact head that was rehearsed and executed live.** |
| this commit | Post-convergence manifest and this package |

## Recovery points (outside Git, `~/carup-staging-backups/`, directory 0700, files 0600)

| Dump | sha256 | Taken (UTC) | Role |
|---|---|---|---|
| `…20261006T113156Z.dump` | `a99a7316…2641` | 2026-10-06 11:31:56 | DB2A-R1 recovery point (kept) |
| `…20261007T061935Z.dump` | `ffd3ae77…3c11` | 2026-10-07 06:19:35 | Stage 0: clean recovery point before Trust |
| `…20261007T073232Z.dump` | `a453bbaa…ab9a` | 2026-10-07 07:32:32 | Stage 4: post-Trust checkpoint and the Stage 5 recovery authority |

Every dump has `pg_restore --list` rc 0, server 17.6 and client pg_dump 18.6. The Stage-4 checkpoint was also restored in full
(0 errors) for the rehearsal.

## Stage results

| Stage | Result | Evidence |
|---|---|---|
| 0 Recovery | `.env.staging` 0600, gitignored and untracked; new dump; old dump kept | dump receipts |
| 1 Runner | 16 PGlite tests; every runner guard mutation-tested; each mutation was caught | `backend/tests/oc5r-staging-migration-runner.test.js` |
| 2 Trust (DB2B-4) | Default dropped by the runner (ledger 164→165); six default-80 VINs set to NULL by an exact-PK staging-only correction; whole-DB fingerprint: only `vehicles` and the ledger changed | rehearsal: 10 steps plus 4 negative controls on PG17.11 |
| 3 Manifest | 215 files: 109 RECORDED_AND_PRESENT, 79 EFFECT_PRESENT_LEDGER_MISSING, 13 ABSENT, 5 PARTIAL, 1 IDEMPOTENT, 7 NEVER_APPLY, 1 UNPROBEABLE, **0 AMBIGUOUS_COLLISION** (8 shared prefixes resolved by full filename) | `database/convergence/oc5r-staging-manifest.json` |
| 4 Rehearsal | Faithful PG17.11 restore of the checkpoint (original owners and ACLs, live `postgres` role model): apply 79 repaired / 19 applied / 1 replayed; second apply and dry-run 99 ALREADY_RECORDED; 2,288/2,289 probes true, and the 1 `cron.job` probe is not evaluable on that engine but is true live; Email 1.0 pre/postflight PASS; data changes were inserts only, into the ledger and 2 template tables | rehearsal receipt (12 steps) |
| 5 Live convergence | 8 preflight gates PASS; apply 2026-10-07 07:45:13Z→07:49:47Z, COMPLETE: 79 LEDGER_REPAIRED, 19 APPLIED, 1 REPLAYED; ledger 165→263 | live receipt (postflight A–G PASS) |
| 6 Recertification | Post-convergence manifest **207 RECORDED_AND_PRESENT, 7 NEVER_APPLY, 1 RECORDED_ONE_TIME_DATA_MIGRATION_NEVER_REPLAY** (Stage-A vocabulary; it read UNPROBEABLE before), with 2,289/2,289 probes true live; the integrity sweep, the assertions and the staging integration suite are below | `database/convergence/oc5r-staging-manifest.post-convergence.json` |

## Executed (19, in this order; one runner transaction per group)

1. `20260826120000_email_1_0_hardening`. Its own BEGIN/COMMIT envelope was unwrapped into the runner transaction. It was applied **atomically with the replay of `20261004180600_service_network_o4_event_dedupe`**, because Email 1.0 rewrites `communication_domain_event_dedupe_key()` and its trigger, which SN-O4 had moved on from. The replay restores SN-O4's body and writes no ledger row.
2. `20260828220000_passport_ownership_transfer_communications`
3. The **Issue-158 custody chain as one atomic group**: `20260828210000`, `20260829003000`, `20260829020000`, `20260829040000`, `20260830060000`
4. `20260901120000_vehicle_finance_obligation_authority`, then `20260902123000_auth_activity_not_conversation` (idempotent; it matched 0 rows)
5. `20261003100000_ocr_c3_garage_evidence_lineage_reconciliation`, then `20261004150000_o2_dealer_compliance_decision_template`
6. `20261004160100_oc5a_work_order_owner_authorization`, then `20261004160200_oc5a_partsentry_attested_record_and_ledger_intents`
7. `20261004172000_o2_x6_semantic_event_templates`, then `20261004180800_service_network_case_status_template`
8. `20261004190000_gmo3`, `20261004190200_gmo6`, `20261004190300_gmo7`, then `20261004210000_oc5g_policy_notification_templates`

A late-apply regression check across all 19 found exactly one migration that touches an object a later recorded file also
defines: Email 1.0 → SN-O4. That is why the replay exists.

**Ledger-only repairs (79):** each one's effect was proven present by its probes, then recorded as version = full filename,
`created_by = oc5r-ledger-repair`, `idempotency_key = sha256:<file sha>`. No SQL ran for a repair. They include the three
version-only collision siblings (`20260621120000_vehicle_life_evidence_taxonomy_provenance`,
`20260621130000_external_source_ingestion`, `20260621140000_ai_temporal_disclosure_intelligence`). In each case the
prefix row names the sibling by slug.

## Never applied (7)

- `003_add_user_sessions`, `004_add_tamper_proofing`: parser registry SQLITE_DIALECT_ONLY.
- `009_phase4_schema`: parser registry RETIRED_UNAPPLIABLE.
- `supabase_schema.sql`: parser registry NON_MIGRATION_FILES.
- `001_add_financial_ledger`, `002_add_notification_queue`: SQLite-era files for the local dev database. **Stage A (OC-5R closure) added them to the parser registry SQLITE_DIALECT_ONLY** (sha-pinned; the local SQLite runner keeps applying them). Every PostgreSQL plan action — ledger repair included — is now refused.
- `20260712100000_communication_scheduler_production_activation`: schedules a production-alias worker. Never apply it to staging.

**RECORDED_ONE_TIME_DATA_MIGRATION_NEVER_REPLAY (1):** `20260808140000_publication_gate_backfill` is recorded. It was a one-time UPDATE whose post-state the DB2B-1
quarantine reversed on purpose. Since Stage A the runner refuses to execute or replay it (`ONE_TIME_DATA_MIGRATIONS`, sha-pinned, mutation-tested); only a ledger-only record runs no SQL.

## Recertification evidence (Stage 6)

- **Synthetic truth:** 0 published vehicles, 0 published garages, 0 synthetic media objects and 0 synthetic listing images. All 147 retired PKs are absent. u3 is tombstoned. `escrow_56bf399159` is byte-equal. 3 sandbox verification rows are preserved.
- **Trust:** `trust_score` is nullable with no default. There are 0 unevaluated 80s. 232 scored vehicles = 232 versioned. Evaluated Trust is byte-identical to the post-DB2B-4 state. The six VINs are NULL and otherwise unchanged. No reconciliation work was enqueued for them, and no fabricated history was written.
- **Legacy evidence:** the evidence, provenance, verification and blockchain tables are unchanged on their pre-existing columns. There are 0 terminal blockchain events, so the `operation_id` backfill touched nothing.
- **Integrity sweep:** 509 foreign keys, all validated, 0 orphan rows. There is one NOT VALID constraint (`vehicles_registration_status_canonical_when_sourced`, authored NOT VALID) and it has 0 violating rows. No anomaly was found, and nothing was cleaned up.
- **Staging integration:** `diaspora-staging-integration.test.js` against staging: 4/4 pass, 0 skipped. The whole-DB fingerprint (327 tables) was identical before and after: **net-zero**.
- **Ledger audit:** 79 `oc5r-ledger-repair` rows plus 20 `oc5r-staging-runner` rows (19 plus Trust). No wrong row, no row for a NEVER_APPLY file, no duplicate idempotency key.
- **Background traffic:** in every window the only rows outside the expected inserts were `SECURITY_CSRF_VIOLATION` on `/triggers/github`. All 33,419 `trust_audit_events` rows that existed at the checkpoint instant are byte-identical afterwards.

## Test receipts at the executed head `fe6e93f7`

`ci.yml` triggers only on `main`, so it never runs on PR #222. The backend suite was therefore run locally with `ci.yml`'s validate-job environment.

| Suite | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| Full backend suite (`backend/tests/*.test.js`) | 8,029 | 8,006 | 0 | 23 |
| Migration-enumerating subset (93 files, runner tests included) | 1,355 | 1,337 | 0 | 18 |
| Staging migration runner | 16 | 16 | 0 | 0 |
| PGlite migration chain (`database/test/migration_pglite_check.mjs`) | 29 up / 29 down / 29 re-up | PASS | 0 | — |
| Diaspora staging integration (against staging, net-zero) | 4 | 4 | 0 | 0 |

PR CI at `fe6e93f7`: Communication Command Center CI, Diaspora Phases 3-7 Validation (playwright, staging-integration,
backend-and-build) and Referral Engine CI succeeded. The two failures are the stale pairing gates classified below.

## Disclosures and residuals (moderator decision)

- **Custody rollout is PREPARED.** Key activation is disabled until the protected finalizer runs (DB2A D-5). This is the chain's designed end state, not a partial one.
- **The Trust correction wrote no history or audit row, on purpose.** Canonical `refreshCanonicalTrust` writes none. `trust_score_history` is the retired legacy writers' table, and the production publication gate counts `new_score IS NULL` there as an anomaly. `trust_change_log` may be written only by `governanceService.recordGovernedTrustChange`. The provenance is the receipt, the pre-image and the rollback. A truthful `trust_audit_events` row in the DB2B-1 pattern can be added if wanted.
- **The ledger keeps its history as-is.** 38 MCP-applied rows match no repo file, and 17 files carry two historical rows. Nothing was deleted. 91 recorded files are identified by stated equivalences (their historical naming conventions), and 116 natively.
- **Live schema lineage: 0 unexplained objects** (Stage A strict reverse check, 7,703 live public objects). 7,663 are defined by the lineage; 40 are held under two explicit custody exceptions in `database/convergence/oc5r-lineage-exceptions.json`: **X4-BIOMETRIC-CONSENT-LEDGER** (36 objects, DEFERRED_CANDIDATE_PRESENT_ON_STAGING, 9 consent rows, unresolved CASCADE-vs-RESTRICT retention decision) and **PR208-DEALER-DOCUMENT-EXTRACTION** (4 empty columns on `dealer_compliance_documents` from PR #208's `20260903220000_dealer_onboarding_extensions.sql`, DEFERRED_FOREIGN_LINEAGE_PRESENT_ON_STAGING). The runner refuses every file under custody, by name.
- **Classified separately, not a database finding:** `Seller Home & Lifecycle Staging UAT` and `Diaspora Deployed Staging UAT` fail at "Prove the governed exact-head preview pair" (UNGOVERNED_BRANCH) on every push. These are stale deployment-pair gates, and none of them reached staging. Nothing was deployed: `git.deploymentEnabled` is false in all three `vercel.json` files.
- **Deferred, untouched:** reviewer protection on the staging environment, `/triggers/github` CSRF rejections, the stale deployment/runtime, provider live certification, and native mobile.

## Rollback authority

- **Ledger repairs:** `DELETE … WHERE created_by = 'oc5r-ledger-repair'` (79 rows). These are ledger-only, with no schema effect.
- **Executions:** restore from the Stage-4 checkpoint `a453bbaa…`, and remove the 19 `oc5r-staging-runner` rows.
- **Trust:** the staging correction rollback SQL (it restores the six to 80, byte-verified against the pre-image), then the migration's Down section.
