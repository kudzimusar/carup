# CarUp Marketplace Classification Backfill Plan

Navigation Intelligence — making the deferred Buy-menu links *truthful* before they are wired.

## Why this exists

The marketplace URL contract (Phase 1) supports `category=` and `tag=` deep-links, but most of the
target categories/tags have **0 live coverage**, so their nav links stay deferred (sparse-tag
promotion guard). To wire them honestly we must first populate the underlying source data — but
**only where we can do so truthfully**. This artifact is a **read-only dry-run**: it shows exactly
what a safe classification backfill *would* do, with zero database writes, so the rules and coverage
can be reviewed before any data changes.

- Rules module: [`backend/services/marketplace/marketplaceClassificationRules.js`](../backend/services/marketplace/marketplaceClassificationRules.js) (pure functions)
- Dry-run script: [`scripts/marketplace-classification-dryrun.js`](../scripts/marketplace-classification-dryrun.js) (SELECT-only)
- Tests: [`backend/tests/marketplace-classification-rules.test.js`](../backend/tests/marketplace-classification-rules.test.js)
- Outputs (untracked): `scratch/marketplace-classification-dryrun.json` + `.md`

## Architecture note (what a backfill targets)

`listMarketplaceListings` computes the marketplace summary **on the fly** from source rows
(`vehicles` + `vehicle_evidence` + `partsentry_logs` + `vehicle_ownership_history`). The
`vehicle_listing_summaries` table exists but is **not** the live read path. So a future backfill
targets **source rows** (e.g. `vehicles.vehicle_condition_category`, `vehicles.passport_verified`,
verified PartSentry state) — not the summary table.

## Current coverage (from the dry-run)

171 vehicles, 142 public; `vehicle_condition_category` is `unknown` for all 142.

| Target | Current live coverage |
|---|---|
| `dealer_verified` (tag) | wired (≈ 35, tenant-linked) |
| `passport_verified` (tag) | 0 |
| `partsentry_checked` (tag) | 0 (425 logs exist; **0** verified + public-card eligible) |
| `brand_new` / `recently_imported` / `locally_used` / `second_hand` (category) | 0 / 0 / 0 / 0 |

> **Data-quality caveat:** the live dataset is largely seed/test data — `import_source='test'` on
> 104/142 public rows, all `registration_country='zw'`, all `current_seller_type='private owner'`.
> Backfilling classifications onto seed rows would manufacture false coverage; the dry-run excludes
> poisoned values and surfaces them explicitly.

## Safe automatic classifications

Only two categories may be proposed automatically, from trustworthy source fields:

- **`locally_used`** — `registration_country ∈ {zw, zimbabwe}` AND `import_source` is local/absent
  AND current category is `unknown` AND no real foreign import. *(Dry-run: 0 → 35.)*
- **`recently_imported`** — `import_source` is in a **curated real-import allowlist**
  (japan, uk/united kingdom, south africa/sa, …), excluding `local`, `test`, null, and unrecognized
  values. *(Dry-run: 0 → 3 — borderline; meets the ≥3 gate but thin.)*

`import_source='test'` is **poisoned** and excluded from both. *(Dry-run: 104 excluded.)*

## Governed-only classifications (never auto-inferred)

- **`brand_new`** — never inferred from year/price/mileage/seller. Requires a governed claim
  (dealer asserts brand-new + invoice / dealer-listing photo, admin-approved).
- **`second_hand`** — never inferred as "everything not new." Requires a trustworthy condition source.
- **`passport_verified`** — requires an **approved trust-fact request** over **verified**
  registration/ownership evidence (admin/government). Currently 0 evidence rows live.
- **`partsentry_checked`** — requires verified PartSentry review: `verification_status='verified'`
  AND `part_verification_status='verified'` AND `public_card_eligible=true` AND
  `suspicion_status ∈ {none, cleared}`, with no self-approval (mechanic ≠ approver).

## Dry-run process

```
node scripts/marketplace-classification-dryrun.js
```

Read-only. Produces machine JSON + human markdown in `scratch/`, with: current coverage, projected
auto candidates (`locally_used`, `recently_imported`), governed-only counts, row-level proposals,
excluded rows + reasons, before/after coverage vs the ≥3 nav threshold, and a recommendation
(`WIRE-after-approved-backfill` / `DEFER` / `GOVERNED-ONLY`) per target.

## Backfill approval process (later, separately authorized)

1. Run the dry-run; **review** the proposed rows and excluded (poisoned/seed) rows.
2. Decide the seed/test-data policy (exclude vs purge vs wait for real listings).
3. **Approved backfill of the SAFE bucket only** (`locally_used`, optionally `recently_imported` if
   coverage holds) via a reviewed, **idempotent** (`WHERE vehicle_condition_category='unknown'`),
   reversible, audited script — a separate task, not this one.
4. Governed tags are **populated through review**, not backfill (apply the `trust_fact_requests`
   migration + Phase-2A setter / PartSentry public-card workflow first).
5. Re-check coverage (read-only) ≥3 per target.
6. Wire newly-truthful nav links one PR per proven target (Phase 2.1 pattern).

## Legal / trust wording guardrails

- **Do not** say "safe" or "clean."
- **Do not** say "government cleared / police cleared / customs cleared" unless the value comes from
  the actual registry. CarUp evidence ≠ official government confirmation.
- Prefer "signal", "on file", "evidence-backed", "CarUp data", "verification status".
- Distinguish, in labels and copy:
  - **seller/dealer verification** ("Dealer Verified" = sold by a verified dealer) vs
    **vehicle verification** (the vehicle itself is verified);
  - **evidence present** (uploaded) vs **evidence verified** (`verification_status='verified'` +
    `visibility_level='public_safe'`);
  - **CarUp evidence** vs **official registry/government confirmation** (ZIMRA/CID/CVR/ZRP).
- `recently_imported` / `locally_used` are **classifications**, not trust claims — do not let
  "recently imported" imply duty/customs cleared.

## Next steps

1. Build/run the dry-run (this PR). 2. Review rules + output. 3. Approved safe-bucket backfill
(separate task). 4. Governed workflow for `passport_verified` / `partsentry_checked`. 5. Re-check
coverage. 6. Wire newly-truthful nav links per target.
