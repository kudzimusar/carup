# OC-4A — Evidence-store completion

**Branch:** `feat/oc4a-evidence-store-completion`, based on `ee1f9274`, the accepted end of the OC-3 lineage.

**Status:** source only. Nothing here is applied to any database. Migration candidates live under `database/migration-candidates/oc4a/`, which no runner or workflow applies.

## 1.1 Evidence histories that OC-3D left exposed

These tables had no PostgreSQL protection at all. Their only "protection" came from the SQLite file `004_add_tamper_proofing.sql`, which does not parse on PostgreSQL.

Each table is classified from its measured writers. The writers are pinned by `oc4a-evidence-history-protection.test.js`, so a new writer fails the suite.

| Table | Writers | Classification | Candidate behaviour |
|---|---|---|---|
| `financial_ledger` | None at runtime | **APPEND ONLY** | UPDATE, DELETE and TRUNCATE are refused by trigger and revoked from application roles. A correction is a compensating entry. |
| `partsentry_logs` | Insert: `partsentryService.addRepairLog`. Update: `partsentryReviewService` (the governed review workflow). | **DOMAIN HISTORY WITH GOVERNED CORRECTION** | The repair fact is immutable. Only the six governance fields may change: `public_card_eligible`, `verification_status`, `part_verification_status`, `suspicion_status`, `approved_by`, `approved_at`. The comparison is whole-row, so a column the repository never declared is protected too. DELETE and TRUNCATE are refused. The `vin` and `tenant_id` foreign keys change from CASCADE to RESTRICT, which still holds under `DISABLE TRIGGER USER`. |
| `ocr_documents` | Insert: Document Intelligence. Update: `verificationSessionService` changes `file_path` only. | **CONTROLLED STATUS TRANSITION REQUIRED** | The extraction is immutable. `status` may move within its CHECK constraint. `file_path` may be set once, from Document Intelligence's placeholder. DELETE and TRUNCATE are refused. |

**Deliberate consequences** (owner decisions, not defects):

- The golden-fixture teardown deletes `partsentry_logs`. It collides with this candidate in the same way the OC-3D ledger teardown does.
- `002` declares `blockchain_events.tenant_id ... ON DELETE SET NULL`. Under OC-3D's UPDATE trigger, a tenant that has ledger history therefore cannot be deleted. Under this candidate, the same is true for a tenant with repair history.

## 1.2 Provenance object authority

**Before:** `GET /api/vehicles/:vin/evidence/:evidenceId/provenance` asked only whether the caller was signed in, and it also accepted an asserted `x-user-id`. The route never read `:vin`. Admin, government and reviewer callers received raw rows, including IP addresses and request ids.

**After:** the route requires `authorizeSessionRole()` and then `requireEvidenceObjectAuthority()`. Authority is composed from the one vehicle rule, `resolveVehicleObjectAuthority`, plus two evidence relationships:

- **Pairing:** the evidence must belong to `:vin`.
- **Association:** the evidence's uploader may read its chain of custody.

The projection is an allow-list chosen by **platform** role. A tenant-derived effective role never unlocks a platform projection.

| Audience | Who | Projection |
|---|---|---|
| `participant` | Owner, current seller, organizational tenant, uploader | Event type, actor role, actor type, time, sequence |
| `government` | Platform government role | Participant fields plus custody hashes |
| `reviewer` | Platform reviewer role | Hashes plus allow-listed custody details; no actor ids |
| `admin` | Platform admin family | Adds actor id, request id and route **path** |

No audience ever receives an IP address or a route query string.

Each of these cases receives one identical 403 response:

- a stranger;
- an unknown evidence id;
- a malformed evidence id;
- evidence that belongs to another VIN.

`requireVehicleObjectAuthority` had its own leak: the 403 body said `not_found` for an unknown VIN but `not_scoped` for a stranger, which revealed whether the VIN exists. Both now return the same body. The same fix went to the undeployed hotfix branch `hotfix/oc-p0l-verify-ledger-containment` at `59e9eebf`.

**Findings recorded, not changed:**

- **`reviewer` is not a valid platform role.** The repository's `users_role_check` admits owner, dealer, mechanic, insurance, government, bank and admin only. `reviewer`, `platform_admin` and `super_admin` therefore cannot be platform roles in this schema.
- **Tenant memberships can carry platform-wide authority.** `resolveEffectiveRole` accepts any tenant role except `admin` through `x-stakeholder-role`. Routes that test the *effective* role, including `hasPlatformWideVehicleAuthority`, would therefore grant platform-wide authority to a tenant membership named `government`, `super_admin` or `reviewer`. No runtime path in this lineage writes `tenant_users`. The deferred production read-only audit must count `tenant_users` rows that use platform-authority role names. Phase 4 must check that #197 and #209, which add garage-membership writers, constrain the tenant role vocabulary.

## 1.3 Truthful audit writes

Each finding below was proven by injecting the failure (`oc4a-truthful-audit-writes.test.js`, plus the updated legacy suites).

| Site | Classification | Behaviour now |
|---|---|---|
| `auditLogger`: the authoritative `trust_audit_events` write failed but the legacy mirror landed. This returned `success: true`. | SECURITY / AUTHORITY AUDIT | Returns `success: false` with `mirrored: true`, and logs an error. Required-audit callers fail closed. On PostgreSQL, a governed PartSentry change is refused even though the mirror row was written. |
| Workbook DB export audit | SECURITY / AUTHORITY AUDIT | **No audit, no export.** This reverses Track W's earlier pin. The audit now goes through the same client the export read with; it used to go to the global singleton. |
| Identity decision audit | BUSINESS HISTORY | The decision is durable first, in `verification_decisions`. A failed audit now logs an error and returns `audit_recorded: false`. Previously it was a `console.warn`. |
| Chain-of-custody events (upload, classification correction, partner import) | BUSINESS HISTORY | Still non-blocking, by each domain's decision. A failure is now an ERROR log. The partner-import path was previously `catch {}`. |
| Diaspora best-effort audits, including trade-graph query audits | OBSERVABILITY | Failures are now logged in every environment. Previously they were logged everywhere except production. |
| Legacy organization mirror | OBSERVABILITY | Failures are now reported, bounded. Previously `.catch(() => {})` meant its `{ error }` was never read. |
| Ledger rolling checkpoint | INTEGRITY WITNESS | Non-blocking, because the event is already committed. A failed upsert is now an error log. Previously it logged "Created". |
| `ai_inference_logs` | OBSERVABILITY | The returned `{ error }` is now read. |
| `trustGraphService.calculateVehicleTrustScore` and `recordTrustScoreHistory` | LEGACY-DEAD | **Retired.** There was no runtime caller. |
| `TrustEnforcementEngine` `trust_score_history` writes | LEGACY-DEAD (Trust-lane debt) | Pinned as runtime-unreachable: nothing imports the engine. |

**Other finding (recorded, not changed):** the diaspora audit "cryptographic seal" is an unkeyed sha256 over the row's own fields. Anyone who can write the row can recompute it, so it is a checksum, not a seal.

## 1.4 `ai_fraud_scans` truthfulness

The table has **no PostgreSQL definition** in the repository; its only DDL is in the SQLite file `004`. On a fresh PostgreSQL database, every advisory scan failed to persist, yet `runFraudAnalysis` still answered `persisted: true`. That answer is now truthful.

The writer's envelope now also records `provider`, `execution` and `confidence_reported`, placed ahead of `reasons`.

Candidate `20261004140100` does the following:

- It declares the table where it is absent.
- It adds `analysis_status`, `execution`, `provider` and `model` as **generated** columns. Each row is classified from what its writer recorded:
  - legacy rows → `legacy_unverified` / `unknown`;
  - OC-3E-W1 rows → `completed` / `provider_executed`.

  Generated columns refuse writes, so no caller can forge them.
- `advisory` is constrained to `true` by a CHECK.
- `risk_score` and `confidence` no longer require a filler value.

## 1.5 Migration hygiene

- **SQLite files.** `003_add_user_sessions.sql` and `004_add_tamper_proofing.sql` are SQLite and are **not edited**. Instead they are enumerated in `SQLITE_DIALECT_ONLY` and pinned by sha256. They are refused for any PostgreSQL target by:
  - the canonical parser (PostgreSQL is the default target);
  - both PostgreSQL runners;
  - the PGlite harness.

  A scan of the whole directory fails on any new SQLite-only file that is not enumerated.
- **PGlite** is now a root devDependency pinned to 0.4.1, the version the lockfile already resolved.

## Test and CI wiring

- **Offline OCR regression job:** now also runs the updated `audit-logger`, `verification-decision-policy`, `diaspora-workbook-db-export`, `evidence-catalog-routes` and `migration-integrity` suites.
- **New "OC-4A evidence store (PGlite)" job:** runs the five `oc4a-*` suites.
