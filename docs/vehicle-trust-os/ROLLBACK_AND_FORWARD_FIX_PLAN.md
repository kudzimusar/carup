# Vehicle Trust OS — Rollback & Forward-Fix Plan (Production)

Scope: the ten Vehicle Trust migrations + PR #103 on `vhmnajoeicasaigiophh`. Prefer **forward-fix**;
use rollback only for integrity-threatening failures.

## Decision matrix
| Situation | Action |
|---|---|
| A migration fails mid-apply | Runner already stops on first error + that migration's tx rolled back. Fix root cause, re-run from the failed file (idempotent). No data loss. |
| Post-apply verification fails (missing table/policy/trigger) | Forward-fix: re-apply the specific migration (idempotent) or a corrective migration. Do not drop tables with data. |
| App regression after merge/deploy, schema OK | Roll back the **deployment** (revert PR #103 / redeploy previous build). Leave schema (additive, backward-compatible). |
| Data-integrity breach (wrong-VIN attach, private leak, cross-tenant, lost audit) | STOP. Restore from PITR/snapshot to the pre-cutover restore point. Then triage before retry. |

## Schema rollback (only if required)
Each migration ships a tested `-- +migrate Down` (apply/down/reapply verified in Gate 1, pglite).
Roll back in **reverse order** (10 → 1):
```
20260624150000 → 20260624140000 → 20260624130000 → 20260624120000 →
20260621170000 → 20260621160000 → 20260621150000 → 20260621140000 →
20260621130000 → 20260621120000
```
Cautions:
- Down sections DROP the new tables — **only run on an empty/rolled-back dataset** or after a PITR
  decision; dropping tables with production evidence destroys data. Prefer PITR restore over Down
  when data exists.
- Append-only tables (provenance, report_versions, etc.) cannot be row-deleted (triggers); a Down
  drops the whole table — acceptable only when abandoning the feature data.
- `listing_publication_lifecycle` Down drops `vehicles.publication_status`/`temp_plate_id` columns
  (additive add → safe drop); confirm no dependent app reads first.

## Full restore (integrity breach)
1. Put app in maintenance / disable writes to affected surfaces.
2. Restore `vhmnajoeicasaigiophh` to the recorded pre-cutover PITR timestamp (or load the pg_dump).
3. Verify evidence checksums + provenance chain integrity post-restore.
4. Re-deploy the previous frontend/backend build.
5. Root-cause, fix forward, re-qualify, re-authorize.

## Forward-fix (preferred)
- Author a new timestamped corrective migration (never edit an applied migration).
- Keep changes additive + reversible; re-run Gate 1 (pglite) + Gate 2 before re-applying.
- For the Gate 15 credential exposure: rotate the production password + sanitize the 28 files in a
  follow-up commit; re-run Gate 15 to 0 matches. (This is a prerequisite, not a rollback step.)

## Communication
- Owner declares incident severity; updates every 30 min for SEV1/2; user-facing notice for any
  data-integrity or availability event. Record the cutover log (target, restore point, hashes,
  results, decisions).
