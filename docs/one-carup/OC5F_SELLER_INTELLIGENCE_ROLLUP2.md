# OC-5F — Seller intelligence rollup@2 and the Seller staging journeys (the #213 port)

Branch `feat/oc5f-seller-intelligence-rollup2`, stacked on OC-5E (`738fec85`), itself stacked on
OC-5D, OC-5C, OC-5B and OC-5A from RC1 (`75449a16`). PR #213 (`ab9cc0e7`, Draft, base
`integration/vehicle-passport-v16-cert`) was **ported, never merged**. Three slices were re-read
against this lineage and ported:

- **A** — rollup@2;
- **B** — the compare-funnel migration;
- **F** — the Seller staging phases P, Q and R.

Slices **D** and **O** wait on owner decisions and were not ported.

Evidence levels follow `ONE_CARUP_EVIDENCE_CERTIFICATION_POLICY.md`.

- Every slice is **SOURCE-certified** (CI plus mutation testing).
- The migration is also **DATABASE-certified**: PGlite over the repository's own Intelligence rollup
  migration, with Supabase's default privileges applied.
- Spec 48 is authored, typechecked, collected and pinned. **It has never run**: OC-5 deploys nothing
  to staging while staging identity is unresolved.

Receipts are in `certification/ONE_CARUP_CERTIFICATION_MANIFEST.json`.

Nothing here is deployed, live-provider certified or owner-accepted. No migration was applied
anywhere. No provider is called by any path in this phase.

## Slices

| Slice | Commit | CI | Mutants | Disposition |
|---|---|---|---|---|
| F1 — a refused rollup write fails the day | `f5de0967` | 37254712482 (see below) | 3/3 | NEW FIX (found while porting A) |
| B — the seller compare column | `ec63ab97` | 37254712482 | 3/3 | PORTED, re-stamped, hardened |
| A — rollup@2 | `135319f0` | 37255370913 | 10/10 | PORTED, re-authored (attribution) |
| F — spec 48 and its gate | `6a64ea49` | 37256453786 | 21/21 | PORTED as a sibling; Phase Q authored, not run |

37 mutants were killed and none survived. Two of slice F's mutants are product mutations: the
fixture filter and the route's scope shape.

`f5de0967`'s own run (37254553524) was cancelled. The gate cancels a run in progress when the branch
moves, and `ec63ab97` was pushed while it ran. Run 37254712482 is the first completed run that
contains `f5de0967`, and the receipts cite it at `ec63ab97`.

## What changed beyond #213, and why

**Rollup writes fail closed (F1).**
- #213's `writeRollups` ignored the upsert's `{error}`. A refused write reported `ok: true`, marked
  the run completed, and wrote nothing.
- The run-ledger insert and the completion update were unchecked too.
- Now a refused write names its table and code, the run is marked failed, and the day reports
  `ok: false` (the route answers 207).
- The run ledger still never blocks a day (kept), but a day without one now says so.
- `readListingOwners` still degrades silently. Making it fail reverses a documented choice, so it is
  an open decision below.

**The compare column (B).**
- Re-stamped `20260928133000` → `20261004200000`. #213's stamp sorted ahead of 18 migrations already
  on this lineage.
- #213 wrote `ALTER TABLE IF EXISTS`, so on a database without the Intelligence tables, Up did
  nothing and raised nothing. The production runner records a migration as applied either way, and a
  silent no-op recorded as applied is how a later deploy finds the column missing. Up now raises.
- #213 had no test for the migration at all. It now has five, on real PostgreSQL:
  - Up applies twice;
  - existing rows read 0;
  - −1 is refused;
  - RLS stays forced and no client role can read the column;
  - Down runs twice, then Up again;
  - Up raises without the table.

**rollup@2 (A).**
- **Reservations are credited by `vehicle_reservations.seller_id`.** That column is NOT NULL and
  names the seller the reservation was made with. #213 credited whoever was the listing's seller at
  recompute time. After a completed transfer that is the **buyer**, and a failed owner lookup dropped
  the reservation while the run reported success. A seller with no other activity that day still
  gets a row.
- Seller rows carry `compare_adds`, the funnel's compare stage. The pulse emits `compare_adds` and
  `reservations`.
- `kpi_catalogue@2`: the three I4 entries describe rollup@2's numbers. A drift guard fails whenever a
  rollup bump leaves the catalogue behind.
- **A pre-existing defect, found on the way.** The Owner Dashboard report read
  `metrics.unique_visitors`, a key nothing emits, so "Unique visitors" always read "Not measured". Its
  test fixture supplied the key the product never does. Fixed. A wiring test now requires every
  report key to be one the pulse actually emits. Completeness and lost opportunity are the two
  documented never-emitted rows.
- The rollup test fake now projects the selected columns. Against the old fake, a read that forgot
  `seller_id` passed.

**The Seller staging phases (F): spec 48.**
- #213 proved Home resilience (P), the inquiry → Communications → reply path (Q) and the
  republish-to-sold lifecycle (R) by **editing certified spec 38**. Its copy of spec 38 would also
  have reverted three later fixes on this lineage:
  - the per-run Golden Seller;
  - teardown outside the journey's budget;
  - the 7-day Intelligence window.

  The phases are now a sibling, spec 48.
- **P — Home.**
  - Ordinary Home never shows Seller automation.
  - The run's own preview scope renders the published listing on the same Home card. The cover is
    the Seller's choice, proved by its decoded natural size (every fixture has a unique size).
  - When the listing is the hero, the hero renders that cover rather than the fallback. Whether the
    hero branch ran is recorded as an annotation, never left silent.
- **R — the lifecycle.**
  - Unpublish withdraws the listing from the Marketplace **and Home**.
  - Republish brings it back to both.
  - Sold retires it, and the Passport survives commerce.
  - Retirement moves availability only; the publication history stays (R27).
- **Q — Communications is `fixme`.**
  - A guest inquiry defaults to WhatsApp (`InquiryModal`). The buyer's WhatsApp becomes the primary
    binding (`communicationConversationService`), and the Seller's reply is delivered there.
  - As #213 wrote it, with `+263771234567`, the reply would be a **real WhatsApp message**.
  - The reply path is slice D, an owner decision.
  - When Q is enabled, its inquiry is email-only to a reserved `.test` address. A pin forbids filling
    the phone.
- **Deviation from the scoping plan.** Spec 48 is **not** in `playwright.staging.config.ts`'s
  `testMatch`.
  - The aggregate Diaspora gates run that `testMatch` whole (the chromium shard measured ~29.7 of its
    35 minutes), so adding spec 48 would change what certified gates run.
  - Spec 48 has its own config (the staging harness, narrowed to spec 48) and its own workflow,
    `seller-home-lifecycle-staging-uat.yml`.
- **The workflow.**
  - The governed preview pair is proved before any identity is written.
  - Identities come from the Diaspora bootstrap. Shared identities are set from the protected secret
    and are never rotated to a random password underneath another gate.
  - Each run gets three new per-viewport Golden Sellers, so no other spec's sweep can retire this
    spec's listings.
  - Every viewport is measured once the run is set up.
  - A sweep always runs, and it fails the gate if the run left a listing in commerce.
  - Without a governed pair, the gate fails by name before any staging contact.
- `backend/tests/oc5f-seller-home-gate.test.js` pins all of the above. That includes the product
  contract spec 48 rests on: a marked fixture is hidden from ordinary discovery, its own run scope
  reveals it, another run's scope does not, and a sold listing leaves even its own scope.

## Not ported, and why

- **D** (`ab9cc0e7`) materialises inquiry conversations without the provider scheduler. It is the
  production inquiry path: an owner decision. It also gates Phase Q.
- **O** is whole-file copies of the Owner Dashboard and Seller Intelligence. Those copies would
  regress lineage fixes, including the period selector spec 38 relies on. Which Intelligence panels
  show which numbers is an owner decision. Until then, `compare_adds` and `reservations` reach no
  screen, and the KPI catalogue gains entries only when a screen shows them.
- **`f45dce7b`** edits the certified `seller-exact-head-staging-uat.yml`. Certified gates are never
  edited.
- **#213's Phase P unit test and its `JourneyMediaStory` change.**
  - `Landing.tsx` on this lineage is already identical to #213's.
  - The `JourneyMediaStory` change only alters the default branch. `JourneyScene` is a closed union
    of eight scenes and Home uses all eight, so that branch can only ever be `parts`. Behaviour is
    unchanged.
  - The unit test pins that refactor's source text.

## Operations: the rollup@2 recompute plan

This plan is for staging only. Production waits on the Intelligence approval (decision 7).

**Preconditions, in this order.**
1. Migration `20261004200000` is applied, and PostgREST's schema cache sees `compare_adds`.
2. Then the code. Seller rows write `compare_adds`. Without the column every seller write is refused,
   and after F1 the day fails loudly instead of reporting success.

**Staging already has the column.** On 2026-09-28, #213's Seller Exact-Head gate (run 36393616046,
step "Apply additive Seller migrations to approved staging") executed this migration's Up section
directly and proved the column. It records no ledger row. OC-5 has no staging access, so this was
read from that run's log and not re-checked against the database. Every statement in the migration
is idempotent, so applying it records the ledger row and leaves the table as it is.

**Recompute.**
- Recompute every day in `[today−89, today−2]` that has a completed rollup@1 run.
- Go oldest block first, at most 31 days per call: `POST /api/internal/intelligence/rollup {date, days}`.
- Then recompute yesterday, then today. Never today first.

**Verify.**
- `rollup-status` shows a completed rollup@2 run for each day.
- rollup@1 and rollup@2 agree on every unchanged metric for the same day: views, unique viewers,
  saves, shares, inquiries and inspections.
- A seller's `compare_adds` equals the sum over that seller's listings.
- A seller's `reservations` equals the active `vehicle_reservations` with that `seller_id` created
  that day.
- `my-analytics` reports rollup@2, and the report reports `kpi_catalogue@2`.

**Disclose: a backfill is not a faithful replay.**
- Reservations are counted active-at-recompute, per the existing contract §7. A reservation cancelled
  since then is not counted.
- `net_watchlist` is as of today.
- Events are still attributed to the seller on the **current** vehicle record, as in rollup@1. Only
  reservations now carry their own seller.

**Rollback.**
1. Redeploy the rollup@1 code.
2. Recompute any day that has only rollup@2 rows. Rows are keyed by version, so rollup@1 rows were
   never overwritten.
3. Run the migration's Down.

## Not applied anywhere

`database/migrations/20261004200000_seller_intelligence_compare_funnel.sql`. Staging holds the column
through #213's gate (run 36393616046), without a ledger row.

## Residuals recorded for the RC2 scan

- **The shared config's "additive" claim.** `playwright.staging.config.ts` calls each `testMatch`
  addition "additive" because certified gates name their spec. The aggregate Diaspora gates do not
  name a spec, so specs 42–47 already run inside them. That config belongs to certified gates, so it
  is not changed here.
- **Two gates can break each other's credentials.** The media lifecycle gate (spec 42) rotates
  `uat.buyer` and `uat.reviewer` to a random password per run. The bootstrap sets them from the
  protected secret. Two such gates on different branches (different lock groups) can invalidate each
  other's credentials mid-run.
- **`readListingOwners`** degrades silently (decision 3).

## Open owner decisions recorded by this phase

1. **Which reservations count:** active-at-recompute (kept; contract §7) or those made that day.
   Decide before production recomputes.
2. **Dealer (tenant) reservations** stay 0, as #213 left them.
3. **`readListingOwners`:** keep degrading silently, or fail the day. This is moderator sign-off,
   because it reverses a documented choice.
4. **Backfill depth** (90 days) and whether history is re-attributed.
5. **D: the production inquiry path.** It gates spec 48's Phase Q.
6. **O: the Intelligence panels**, or approve the three funnel rows in Seller Intelligence.
7. **Production for A and B:** the Intelligence approval.
8. **When spec 48 first runs.** It needs a governed preview pair for the RC2 candidate, which is a
   step of the RC2 runbook.
