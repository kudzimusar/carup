# CarUp Marketplace Classification Backfill — Runbook

How to safely apply approved, safe-bucket `vehicle_condition_category` classifications. This is the
**apply** companion to the read-only dry-run from #29. It writes **only** to the source rows
(`vehicles.vehicle_condition_category`), never to the summary table, nav links, or governed signals.

- Pure logic: `backend/services/marketplace/marketplaceBackfill.js`
- CLI: `scripts/marketplace-classification-backfill.js`
- Tests: `backend/tests/marketplace-classification-backfill.test.js`
- Read-only dry-run + plan: `scripts/marketplace-classification-dryrun.js`, `docs/CARUP_MARKETPLACE_CLASSIFICATION_BACKFILL_PLAN.md`

## What it can and cannot do

- **Can** set `vehicle_condition_category` to **`locally_used`** or **`recently_imported`** only.
- **Cannot** write `brand_new`, `second_hand`, `passport_verified`, `partsentry_checked`, or any other
  governed/tag signal — these are hard-rejected (`FORBIDDEN_BACKFILL_TARGETS`).
- **Cannot** override the classification rules: a row is changed only when the merged rules
  independently propose the category AND it matches the approved allowlist entry AND the row is still
  `unknown`. Poisoned/test rows (`import_source='test'`) are always skipped.
- **Cannot** write at all without `--apply`. Default is a read-only dry-run.
- **Does not** wire any navigation links — that remains a later, separate, per-target step.

## Approval process

1. Run the **read-only dry-run** (`scripts/marketplace-classification-dryrun.js`) and review
   `scratch/marketplace-classification-dryrun.json` (row-level candidates + excluded reasons).
2. A human reviewer decides which VINs are **real** (not seed/fixture) and approves them.
3. The reviewer produces an **allowlist file** of approved `{vin, category}` (below).
4. Run this backfill in **dry-run** with that allowlist; review the diff + skipped rows + audit file.
5. Only after sign-off, run with `--apply`. Keep the generated `backfill-revert-*.json`.
6. Re-check coverage (read-only). Wiring nav links is a **separate** PR, only after coverage is
   re-confirmed on real data.

## How to prepare the allowlist

A JSON file (keep it in `scratch/`, untracked). Each entry is an explicitly approved VIN + category:

```json
[
  { "vin": "VIN_REAL_0001", "category": "locally_used" },
  { "vin": "VIN_REAL_0002", "category": "recently_imported" }
]
```
(Equivalently `{ "approved": [ ... ] }`.) `recently_imported` is applied **only** when an entry
explicitly carries that category. Any entry whose category is not `locally_used`/`recently_imported`
is rejected.

## How to run a dry-run (read-only, no DB writes)

```bash
node scripts/marketplace-classification-backfill.js --allowlist scratch/approved-allowlist.json
```
Outputs (in `scratch/`, untracked): before/after diff to stdout, plus
`backfill-audit-<stamp>.json` (each row, `applied:false`) and `backfill-revert-<stamp>.json`.

## How to run apply (ONLY after written approval)

```bash
node scripts/marketplace-classification-backfill.js --allowlist scratch/approved-allowlist.json --apply
```
Each write is double-guarded with `.eq('vehicle_condition_category','unknown')`, so a row already
classified (e.g. by a concurrent process) is left untouched and logged as skipped. Keep the printed
`backfill-revert-<stamp>.json`.

## Rollback procedure

```bash
# dry-run the revert first
node scripts/marketplace-classification-backfill.js --revert scratch/backfill-revert-<stamp>.json
# then apply the revert
node scripts/marketplace-classification-backfill.js --revert scratch/backfill-revert-<stamp>.json --apply
```
This restores each listed VIN's `vehicle_condition_category` to its pre-backfill value (`unknown`).

## Post-backfill coverage check

Re-run the read-only dry-run and confirm coverage moved as expected and no `test` row was touched:

```bash
node scripts/marketplace-classification-dryrun.js
# inspect scratch/marketplace-classification-dryrun.json -> current_coverage / before_after
```
A nav link for a category is only eligible once it has **≥ 3** live listings on **real** data.

## Guardrails / wording

- This tooling classifies condition only. It makes **no** trust claims; do not infer "verified",
  "cleared", or "safe" from a condition category.
- `recently_imported` / `locally_used` are descriptive classifications, not customs/duty statements.
- Governed signals (`passport_verified`, `partsentry_checked`, `brand_new`, `second_hand`) require the
  governed trust-fact / PartSentry workflows (issues #31, #32), never this backfill.
