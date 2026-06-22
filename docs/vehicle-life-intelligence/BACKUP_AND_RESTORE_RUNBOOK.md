# Backup & Restore Runbook

- **Status:** Proposed (Milestone 6)
- **Owners:** Infrastructure & Release (primary), Database on-call (secondary)
- **Systems:** Supabase Postgres (system of record), Supabase Storage (evidence)
- **Relates to:** `DISASTER_RECOVERY_RUNBOOK.md`, `evidenceService.js`
  (`checksum_sha256`)

> Evidence integrity is the product. A restore that loses or corrupts evidence
> files breaks the verifiable-history promise, so every restore MUST end with a
> checksum verification pass (§5).

---

## 1. What we back up

| Asset | Store | Mechanism | Frequency | Retention |
| ----- | ----- | --------- | --------- | --------- |
| Postgres (all `trust_*`, `evidence`, `blockchain_events`, users, marketplace) | Supabase Postgres | Automated daily backup + PITR (WAL) | Daily snapshot; PITR continuous | 30 days (prod), 7 days (staging) |
| Evidence files (`ocr-documents`, `vehicle-images`, evidence buckets) | Supabase Storage | Bucket versioning + nightly export to cold object store | Nightly | 90 days versions; 1 year cold copy |
| DB schema/migrations | Git (`database/migrations/`) | Source control | Per commit | Indefinite |
| Secrets references (not values) | Secret manager / Vercel/Fly env | Provider-managed | n/a | n/a |

## 2. Database backup

### 2.1 Automated daily backups + PITR

- Supabase **daily logical backups** are enabled on the production project.
- **Point-in-Time Recovery (PITR)** is enabled (WAL archiving), giving recovery to
  any second within the retention window. PITR is the basis for the RPO target in
  `DISASTER_RECOVERY_RUNBOOK.md`.
- Verify enablement: Supabase Dashboard -> Project -> Database -> Backups.

### 2.2 Independent off-platform dump (defence-in-depth)

A scheduled job (Fly.io worker or CI cron) takes an encrypted `pg_dump` and
uploads it to a separate cloud bucket, so a Supabase-account-level incident does
not destroy every copy.

```sh
# Runs in an environment where SUPABASE_DB_URL is injected from the secret
# manager. The value is NEVER printed or committed.
TS=$(date -u +%Y%m%dT%H%M%SZ)
pg_dump "$SUPABASE_DB_URL" --format=custom --no-owner --no-privileges \
  | gpg --encrypt --recipient "$BACKUP_GPG_RECIPIENT" \
  > "carup-db-${TS}.dump.gpg"
# Upload to the off-platform bucket (S3/R2). Object-level SSE enabled.
```

- **Encryption:** GPG (asymmetric) at rest before upload **and** bucket-level SSE.
- **Retention:** 30 daily, 8 weekly, 12 monthly (grandfather-father-son).

## 3. Evidence storage backup & versioning

- **Bucket versioning** ON for evidence buckets so overwrites/deletes are
  recoverable for 90 days.
- **Nightly export** mirrors evidence objects to an independent cold object store
  (different provider/account than Supabase).
- The DB `evidence` table is the manifest: each row carries `checksum_sha256`
  (computed by `checksumForBuffer` = `sha256(fileBuffer)`), `vin`, storage path,
  and `metadata`. A backup is only valid if **DB rows and stored objects agree**.

## 4. Encryption & access

- DB dumps: GPG-encrypted + bucket SSE.
- Evidence cold copies: bucket SSE; access via least-privilege role (read for
  the export job, restricted restore role for operators).
- Backup bucket access is **not** granted to the runtime service-role key — a
  compromised app key must not be able to delete backups.

## 5. RESTORE TEST PROCEDURE (run quarterly + before each major release)

This is a **drill against a throwaway target**, never against production.

### 5.1 Restore the database

```sh
# 1. Create an isolated restore target (Supabase branch or scratch project).
#    DO NOT restore into the production project.
# 2. Restore the most recent off-platform dump into the scratch DB.
gpg --decrypt "carup-db-<TS>.dump.gpg" \
  | pg_restore --no-owner --no-privileges --dbname "$RESTORE_DB_URL"
# (For PITR drills instead: use the Supabase Dashboard PITR restore on a branch
#  and pick a target timestamp.)
```

### 5.2 Sanity-check the restored schema/data

```sh
psql "$RESTORE_DB_URL" -c "SELECT count(*) FROM evidence;"
psql "$RESTORE_DB_URL" -c "SELECT count(*) FROM blockchain_events;"
psql "$RESTORE_DB_URL" -c "SELECT count(*) FROM trust_audit_events;"
# Compare counts against the pre-incident baseline recorded in the DR ticket.
```

### 5.3 Restore evidence objects

Restore the evidence buckets from the cold copy / versioned bucket into a scratch
bucket reachable by the restore target.

### 5.4 VERIFY EVIDENCE INTEGRITY (checksums) — REQUIRED

The product guarantee is that stored evidence matches its recorded hash. After
restore, recompute each object's SHA-256 and compare to `evidence.checksum_sha256`.

```sh
# Pseudocode driver (Node) — uses the same hash the app uses
# (crypto.createHash('sha256').update(buffer).digest('hex')).
#
# for each row in: SELECT id, vin, storage_path, checksum_sha256 FROM evidence
#   buffer   = downloadFromRestoredBucket(row.storage_path)
#   computed = sha256(buffer)
#   if computed !== row.checksum_sha256:  -> RECORD MISMATCH (row.id, row.vin)
#   if object missing:                    -> RECORD MISSING  (row.id, row.vin)
#
# PASS criteria: 0 mismatches AND 0 missing objects.
```

- Cross-check the chain: for sampled VINs, run `verifyChain(vin)` against the
  restored DB (`backend/services/blockchain/blockchainService.js`) and confirm
  `verified === true`.
- Record results (rows checked, mismatches, missing, chain status) in the restore
  test report attached to the DR ticket.

### 5.5 Pass / fail

- **PASS:** schema present, row counts within expected delta, **0 checksum
  mismatches, 0 missing objects**, sampled chains verify.
- **FAIL:** any checksum mismatch, missing object, or chain failure → open an
  incident, do not certify backups, escalate per DR runbook.

## 6. Cadence & ownership

| Activity | Frequency | Owner |
| -------- | --------- | ----- |
| Daily backup + PITR health check | Daily (automated + alert) | DB on-call |
| Off-platform dump | Daily | Infra |
| Evidence export | Nightly | Infra |
| Full restore test (this doc §5) | Quarterly + pre-major-release | Infra + DB on-call |
| Backup encryption key review | Annual | Security |
