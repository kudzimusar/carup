# Backup & Restore Runbook (Milestone 6, master plan §12.8)

## Database (Supabase Postgres)

- **Automated backups:** Supabase daily backups + **Point-In-Time Recovery (PITR)** — enable PITR
  on the project (paid tier). Verify the retention window (target ≥ 7 days; 30 for production).
- **Logical export (independent copy):** nightly `pg_dump` of the public schema to an
  independent, encrypted object store (NOT the same provider) — guards against provider-account loss.
  Run from CI/cron with a least-privilege read role, not the service-role key.
- **Encryption:** backups encrypted at rest (provider-managed) + the independent dump encrypted
  with a customer-held key (rotated per `SECRETS_ROTATION_RUNBOOK.md`).
- **Retention:** PITR window per tier; independent dumps retained 30 days, weekly for 1 year.

## Evidence storage (Supabase Storage)

- Buckets: `vehicle-images` (public-safe) + `ocr-documents` (private). Enable bucket **versioning**
  / soft-delete where available; nightly sync of object metadata + a sampled integrity manifest
  (object path → SHA-256) to the independent store.
- Evidence rows carry `checksum` (SHA-256) — restore verification compares restored object bytes
  to the stored checksum (see below).

## Configuration / IaC

- All migrations are in `database/migrations/` (source of truth). WAF/Fly/Cloudflare config is in
  `infra/` + the ADR. Keep these in git; they are the configuration backup.

## RESTORE TEST procedure (run quarterly; record results)

1. **Provision** a throwaway Supabase project (or branch) — NEVER restore over production.
2. **DB restore:** restore the latest PITR snapshot (or apply the nightly `pg_dump`) into the
   throwaway project.
3. **Migrations check:** confirm `database/migrations/` applies cleanly on top (no drift).
4. **Storage restore:** restore a sample of evidence objects into a throwaway bucket.
5. **Integrity verification:** for the restored sample, recompute SHA-256 of each object and
   compare to `vehicle_evidence.checksum`; recompute the provenance hash chain
   (`verifyProvenanceChain`) for affected evidence — both must pass.
6. **Smoke test:** point a staging API at the restored DB; run `node --test backend/tests/*.test.js`
   against the restored data shape; load a buyer report.
7. **Record:** restore time (→ informs RTO), data loss window (→ informs RPO), integrity pass/fail.
8. **Teardown** the throwaway project.

## External blocker

PITR + independent encrypted store require a paid Supabase tier + a second storage provider +
credentials. The procedure is defined and testable in staging; production backups await account
provisioning. **Never run a destructive restore against production Supabase** (master plan §19).
