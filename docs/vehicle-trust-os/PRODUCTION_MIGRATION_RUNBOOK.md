# Vehicle Trust OS — Production Migration Runbook

**Target:** `vhmnajoeicasaigiophh` (PRODUCTION). **Precondition:** explicit
`AUTHORIZE VEHICLE TRUST PRODUCTION CUTOVER` received AND the Gate 15 credential blocker cleared
(rotated + sanitized; see `PRODUCTION_CUTOVER_MANIFEST.md` §0). Apply only the ten migrations in §1
of the manifest. No `supabase db push`. No unrelated migrations.

## Roles
- **Operator** (runs commands), **Approver** (confirms target + restore point). Two-person check.

## Pre-cutover
1. **Confirm target:** the runner must refuse unless `SUPABASE_URL` contains `vhmnajoeicasaigiophh`
   AND must refuse if it contains the staging ref `eoyenigwevnxwwhyhaer`. Verify
   `SELECT current_database()` connects to production via the freshly-rotated credential.
2. **Backup / restore point:**
   - Confirm Supabase PITR enabled; record the restore-point timestamp (UTC).
   - Take a logical snapshot: `pg_dump --schema=public --no-owner` to an encrypted, off-provider store.
   - Record both in the cutover log. **Do not proceed without a confirmed restore point.**
3. **Hash check:** for each of the ten files, `shasum -a 256` must equal the manifest §1 value.
4. **Migration ledger:** ensure a ledger exists (or use the runner's per-file logging); record which
   of the ten are already present (idempotent — all use IF [NOT] EXISTS / OR REPLACE).

## Apply
Use a marker-aware runner (Up-only, per-migration transaction, **stop on first SQL error**),
pointed at the production connection string (env only; never hardcoded):

```
# .env.production must contain the rotated SUPABASE_URL (…vhmnajoeicasaigiophh…) + SUPABASE_DB_URL
node database/scripts/apply_migrations_staging.mjs --dry-run   # adapt guard to production ref first
# then live apply once dry-run + guard confirm the production target
```
> Note: `apply_migrations_staging.mjs` is staging-guarded. For production, run an equivalent runner
> whose project guard is `vhmnajoeicasaigiophh` (same logic), or parameterize the guard. Do NOT
> bypass the project guard.

Apply order = manifest §1 (1→10). Stop immediately on any SQL error and consult the rollback plan.

## Post-apply verification (must all pass)
- **Migration ledger:** all ten recorded applied (or already-present), none failed.
- **20 tables** present (manifest §2) + **view** `evidence_sources_public` + **vehicles** columns
  `publication_status`, `temp_plate_id`.
- **RLS** enabled on all sensitive tables; **policies** present where intended; internal/ingestion
  tables service-role-only (no anon/authenticated policy by design).
- **Grants:** no `anon` access to restricted intelligence/ingestion/governance tables.
- **Functions:** `carup_provenance_block_mutation`, `carup_listing_snapshot_block_mutation`,
  `carup_report_version_guard`, governance/dispute/trust-change/extraction guard functions present.
- **Indexes:** taxonomy/source/set/perceptual-hash/ingestion/temporal/report indexes present.
- **Append-only triggers (12):** provenance, listing_snapshot, report_version, review_decisions,
  dispute_events, trust_change_log, extraction content guard — all present and enforcing
  (UPDATE/DELETE blocked).
- Re-run the read-only verification used on staging (table/RLS/policy/grant/trigger counts).

## After verification
- Merge PR #103 at the verified head `a81c3ae…` (manifest §5).
- Verify backend + frontend deployments healthy (`/api/health`).
- Run `PRODUCTION_SMOKE_CHECKLIST.md`.
