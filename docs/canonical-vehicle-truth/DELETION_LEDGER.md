# Deletion / deprecation ledger — Issue #164

Every removal this programme makes, with the evidence that made it safe. Entries are added as
they are authorised, not in advance.

---

## 1. `public.vehicle_listing_summaries` — REMOVED (authorised 2026-08-17)

**Migration:** `database/migrations/20260818100000_issue164_drop_dead_vehicle_listing_summaries.sql`
**Preflight:** `backend/scripts/issue164-drop-listing-summaries-preflight.mjs`
**Guard:** `backend/tests/issue164-dead-listing-summary.test.js` (10 invariants)

### Why

Created by `20260603132036_marketplace_listing_summary_infra.sql` as a future materialized
listing-card model. The refresh workers were deferred and never written, so it has stood empty
while the live read path resolved listings from `public.vehicles`.

The risk is not the empty table — it is that the table is a **second declaration of the public
listing contract**, carrying its own `duty_cleared`, `cid_clear`, `passport_verified`,
`plate_verified` and `trust_score` columns, and it is **publicly readable** (RLS policy plus
`SELECT` to `anon` and `authenticated`). Issue #164 exists because CarUp had several competing
sources of vehicle truth; a dormant one invites a future writer to populate it and republish an
unreconciled second set of trust claims straight to anonymous callers.

### Conditions required by the product-owner decision, and how each is met

| # | Condition | How it is enforced |
|---|---|---|
| 1 | No `CASCADE` | The `DROP TABLE` is plain (RESTRICT default). A test asserts `CASCADE` appears nowhere in the executable SQL, so an unanticipated dependent aborts the drop instead of being silently removed. |
| 2 | Zero rows | `count(*)` — not `reltuples`, which is a planner estimate that reads 0 on an unanalysed table. Any row raises. |
| 3 | No dependent views / functions / FKs | Three separate guards: dependent views (incl. materialized), inbound foreign keys, and routines whose body names the table. Each raises. |
| 4 | No application references | Not checkable in SQL. A source scan over `backend`, `web/src`, `shared`, `mobile` fails the build if any code path queries the relation. |
| 5 | Canonical staging guard before applying | The preflight positively identifies staging ref `eoyenigwevnxwwhyhaer` and exits BLOCKED on an unset, forbidden, or unrecognised target — "not production" is not sufficient. |
| 6 | Stop, do not delete, if a future preflight finds rows/dependencies | Every guard `RAISE`s, which aborts the runner's transaction and leaves the table exactly as it was. A refusal is a correct outcome. |

### Evidence

Measured on staging (`eoyenigwevnxwwhyhaer`, PostgreSQL 17.6) before authoring:
**0 rows · 0 dependent views · 0 inbound FKs · 0 triggers**; own objects only (1 RLS policy,
4 indexes, 1 outbound FK to `vehicles(vin)`), all removed by `DROP TABLE` itself without CASCADE.

Behavioural proof against real PostgreSQL (PGlite, 19 assertions, all passing):

| Scenario | Result |
|---|---|
| Empty table, no dependents | drops |
| Table holds 1 row | **REFUSES**, row not deleted, table intact |
| Dependent view exists | **REFUSES**, view not dropped, table intact |
| Inbound foreign key exists | **REFUSES**, table intact |
| Routine references the table | **REFUSES**, table intact |
| Table absent (fresh DB) | clean no-op |
| Re-applied after a real drop | clean no-op |

Repo migration harness (`database/test/migration_pglite_check.mjs`): **overall PASS**.

### Deliberately NOT removed — recorded as debt

`backend/services/trustGovernance/trustPermissionService.js:30` holds the string
`'vehicle_listing_summaries_refresh'` in `SUMMARY_FACTS`. That is a trust-fact **permission label**,
not table access; no code reads or writes the relation, so dropping it cannot break anything.

It becomes debt the moment the migration is applied — a governance permission to refresh something
that no longer exists. It is **not** dead yet: the migration is unapplied, so
`public.vehicle_listing_summaries` still exists on staging (confirmed read-only during the Phase 5
close-out: `to_regclass` non-null, 0 rows). Removing the label changes the governance permission set,
which has its own blast radius and belongs in a separate reviewed change. The guard pins it by exact
set equality, so it cannot be quietly forgotten.

### Not reversible by rollback, by design

The `Down` section is non-executable. Recreating the table would restore the competing listing
contract this removes, and would restore the shape without data (there was none). If a materialized
listing read model is ever genuinely wanted, the forward path is a **new** migration that creates it
deliberately alongside the refresh workers that were never written, derived from the canonical fact
model rather than carrying duplicate boolean columns.

### Status

Migration authored, proven and committed. **Not yet applied to any database** — application is a
guarded staging run, preceded by the preflight. Production remains untouched.

---

## 2. The marketplace's second media contract — REMOVED (Issue #164 Phase 5)

**Files:** `backend/services/marketplace/marketplaceListingDetailService.js`,
`backend/services/marketplace/listingSummaryService.js`
**Guard:** `backend/tests/issue164-phase5-marketplace-convergence.test.js` (35 assertions, 8 suites)
**No migration.** Nothing in the database changes.

### What was deleted

Two independent definitions of "a publishable listing photo" existed in the repository, on the
same three rows of the same table. The marketplace held the permissive one, and it was the one on
the public wire.

| | canonical (`utils/vehicleMediaProjection.js`) | marketplace (deleted) |
|---|---|---|
| publishable url | `https:` / `http:` / `//` / `/` — anything else is refused **and counted** | `.filter((row) => row?.image_url)` — is the column truthy |
| primacy | first claimant in sort order; the rest demoted (Rule 6) | `Boolean(row.is_primary)` — **every** claimant |
| identity | `media_id` = `listing_images.id` (Rule 6b) | dropped |
| read that failed | `not_loaded`, `empty_statement: null` (Rule 1) | `[]` — indistinguishable from "the seller added none" |

### Reproduced before deleting

Four rows whose `image_url` values were `data:image/png;base64,AAAA`, `javascript:alert(1)`,
`photo.jpg` and one real `https://` URL:

| surface | before | after |
|---|---|---|
| `detail.media` | **all four, verbatim** | one item, `unpublishable_count: 3` |
| `detail.primary_image_url` | `"data:image/png;base64,AAAA"` | the real URL |
| `summary.primary_image_url` (list card) | `"data:image/png;base64,AAAA"` | the real URL |
| two rows both claiming primacy | **two** `is_primary: true` | `[true, false]` |

`primary_image_url` is the one that mattered most: **four** surfaces put it straight into an
`<img src>` — `Marketplace.tsx` (via `summary.primary_image_url` → `vehicle.images[0]`, then
`ListingImage`), `VehicleSearch.tsx`, `dashboard/owner/SavedCars.tsx` and `MarketplaceCompare.tsx` —
and the shared `ListingImage.tsx` branches on `src` being **truthy** (`if (src)`) and applies no
classification at all. The detail page re-classifies, so nothing rendered there — that is luck
downstream of a permissive server, and it never extended to the list, compare or saved-cars
surfaces.

> **Count corrected.** An earlier revision of this paragraph named **three** surfaces and omitted
> `Marketplace.tsx`, which is the primary discovery grid. Re-measured by grepping
> `primary_image_url` across `web/src`, `mobile/` and `shared/`: four rendering consumers, plus type
> declarations in `web/src/types/index.ts`, `shared/types/index.ts` and `mobile/utils/marketplaceApi.ts`.
> **The same undercount is repeated in the header comment of
> `backend/services/marketplace/listingSummaryService.js`**, which names the same three. That file is
> owned by a sibling lane and is not edited here; it is reported. The undercount does not change any
> conclusion — it understates the blast radius of the deleted permissive projection by one surface.

### What was NOT deleted, and why

**The `media` key survives**, as a strictly-derived compatibility view rather than a second
computation. Every consumer was checked before the decision:

| consumer | reads | verdict |
|---|---|---|
| `web/src/pages/VehicleDetail.tsx`, the marketplace-transport fallback | `detail.media`, and **drops any entry whose `type !== 'image'`** | live — renaming the key or dropping `type` blanks the gallery |
| `mobile/utils/marketplaceApi.ts`, the `MarketplaceListingDetail` declaration | declared `media?: {url, type, is_primary}[]` | **type declaration only — zero runtime readers in `mobile/`** |
| `backend/tests/marketplace-v1-spine.test.js`, the detail spine assertion | `detail.media[0].url` | corrected, not weakened (below) |

> **Anchors removed, not merely refreshed** (`MEDIA_EVIDENCE_CONTRACT.md` §8). This table carried
> `VehicleDetail.tsx:1376`, `marketplaceApi.ts:57` and `marketplace-v1-spine.test.js:193`. All three
> have since moved — the page's marketplace transport now resolves envelope-first around `:1500`,
> and `marketplaceApi.ts:57` is now inside the `MobileListingMediaBlock` envelope this same phase
> added. The **verdicts are unchanged and were re-verified**: `VehicleDetail.tsx` still requires
> `row?.type !== 'image'` before it will take an entry, `mobile/` still declares the array and never
> reads it at runtime (it now declares `listing_media` too, and marks it the authority), and the
> spine assertion still reads `detail.media[0].url`.

So the shape is preserved and made a **superset**: `{media_id, url, url_form, position, is_primary, type}`.
Every entry is `listing_media.items[i]` plus the one legacy key, pinned to exact structural
equality by *every media entry is its listing_media item plus exactly one legacy key*. A view
cannot disagree with its source; a second projection can, and that distinction is the only reason
this is not the `plate_status` duplication Phase 4 removed.

`listing_media` — the canonical envelope — is published alongside it and is **the authority**.
It is required, not decorative: `state`, `unpublishable_count` and `empty_statement` cannot be
expressed in an array, so without it the converged path would have started silently dropping
unpublishable rows, which is Rule 5's lie one layer up from where it was found.

### Existing test CORRECTED, not weakened — stated explicitly

`backend/tests/marketplace-v1-spine.test.js`, the marketplace-detail spine test. The `listing_images` fixture was
`{vin, image_url, is_primary, display_order}` with **no `id`**. `listing_images.id` is
`uuid NOT NULL DEFAULT gen_random_uuid()` — the primary key — so the table cannot produce such a
row and the fixture was never faithful to it. Once identity became a publication requirement the
row turned unpublishable and `assert.ok(detail.media.length === 1 …)` failed. **Reproduced first:
`media.length` was 0.**

The fixture was corrected; the assertion was not touched. Relaxing it would have converted a test
about "the detail publishes the seller's photo" into a test about an empty gallery — the defect
this phase closed. Three assertions were **added** (the published `media_id`, and the canonical
envelope agreeing with the view).

### Behaviour deliberately preserved

The cover-image **election** is unchanged. The canonical block already sorts primary-claimants
first, then `display_order`, then input order, so `items[0]` is the same row the old sort picked.
Only the publishability gate is new — changing the election would have blanked cards on every
listing whose photos carry no primary claim.

`primary_image_state` was added instead, in the `*_state` idiom Phase 4 established for `location`
and `currency`: `seller_primary` / `first_published` / `none` / `not_loaded`. Verified on the
shipped code — with two rows neither claiming `is_primary`, `primary_image_url` was still the
lower-`display_order` one, a "primary" nobody chose. The fact is not withdrawn, it is labelled.

### Anti-vacuity

Eight mutations applied, each restored and verified byte-identical with `cmp`:

| # | mutation | named tests killed |
|---|---|---|
| C1 | restore the permissive url handling in the detail | **7** (*the marketplace DETAIL refuses every value…*, *agrees with the canonical projection on EVERY url form*, *NEITHER marketplace file contains a url test of its own*, *the DETAIL does not re-implement sorting or primacy arbitration*, *one read feeds both surfaces*, *every media entry is its listing_media item…*, *the DETAIL demotes a second primary claimant*) |
| C2 | drop `media_id` from the marketplace surface | **6** (incl. *is STABLE UNDER RE-ORDERING*, *is DISTINCT per item*, and the corrected spine test) |
| C3 | list card reverts to the truthy election | **8** (incl. *honours is_primary over display_order*, *elects the first slot when NOBODY claims primacy — and SAYS SO*) |
| C4 | the read stops selecting `id` | **13**, behaviourally — the convergence suite uses a stub that honours `.select()` as PostgREST does |
| C5 | a failed read degrades to `[]` again | **3** (*a FAILED listing_images read is not_loaded*, *the shared read reports whether listing_images was consulted at all*, *the two states are not interchangeable on the LIST card either*) |
| C6 | `media` becomes a second projection instead of a view | **2** — precisely the two that measure the derivation |
| C7 | e2e reverts to the defect sentence | **2** (*no longer asserts the sentence that WAS the defect*, *asserts the defect sentence is ABSENT from the page*) |
| C8 | stop publishing the canonical envelope | **9** |

C5 and C6 kill disjoint sets: a second projection is still Rule-1-correct, and a `[]`-degrading
read still produces a faithful view of what it read. Each guarantee is measured by its own test.

### Findings RECORDED, not fixed — they belong to files this lane does not own

**F1 — the listing-image write path in `POST /api/vehicles/add` (`backend/server.js`). THREE
defects, one of which is a fabrication.** (`backend/server.js` was owned by a concurrent lane; not
edited here.)

> **Anchor corrected.** This finding was filed against `backend/server.js:2154-2167` with the
> snippet line-numbered `2155`–`2167`. Those ordinals resolve against **neither** the base commit
> nor the working tree: at `3adb95e4` the block is **`2062-2074`**, and the `res.status(201)` that
> follows it is at **`:2077`**. Re-anchored to the base commit and to the route name, per
> `MEDIA_EVIDENCE_CONTRACT.md` §8. The snippet itself is byte-accurate; only its ordinals were wrong.

```js
// backend/server.js @ 3adb95e4, lines 2062-2074
2062    // Persist listing images directly in the listing_images table
2063    if (Array.isArray(images) && images.length > 0) {
2064      const imageRecords = images.map((url, idx) => ({
2065        vin,
2066        image_url: url,          // <- F1a: stored VERBATIM. No scheme, host, length or existence check.
2067        is_primary: idx === 0,   // <- F1b: FABRICATES the seller's primary choice from array order.
2068        display_order: idx
2069      }));
2070      const { error: imageError } = await supabase.from('listing_images').insert(imageRecords);
2071      if (imageError) {
2072        console.error('⚠️ Failed to save listing images:', imageError.message);   // <- F1c
2073      }
2074    }
```
…and the route then returns `res.status(201)` at **:2077** regardless.

* **F1a** — `image_url: url` verbatim. This is the *source* of every unpublishable value the read
  path now has to refuse. The convergence stops them being published; it cannot stop them being
  stored, and each one is a photo the seller believes they uploaded.
* **F1b — the more serious one, and it is not in the original brief.** `is_primary: idx === 0`
  writes `true` for the first element of the request array. The seller never chose it. **Rule 6
  says primacy is the seller's choice or it does not exist**, and this is that fabrication
  persisted into the database, where the read path can no longer tell it from a real choice. Phase
  5 removed elected primacy from three read surfaces while the write path was still manufacturing
  it. `primary_image_state: 'seller_primary'` is therefore only as truthful as this line.
* **F1c** — an insert failure is `console.error`-d and the route still returns **201** with
  `success: true`. A seller is told their photos were saved when they were not. This is the same
  class as the location defect Phase 4 closed **in this very handler**, which now reports
  `location_recorded: false` on the response. The pattern to copy is eleven lines below the bug: add
  `images_recorded` to the 201 body.

> **Status of F1a–F1c at the current tree (Phase 5 close-out).** The snippet above is the code **as
> found**; it is retained as the record of the defect, not as a description of the handler today.
> Re-read against `backend/server.js` at this HEAD:
>
> - **F1b — CLOSED in code, OPEN in data.** The write path no longer fabricates primacy: it writes
>   `is_primary: entry.claimsPrimary`, so nothing claimed means no row claims and the read path
>   reports `first_published` rather than `seller_primary`. The three rows the old path's shape
>   already wrote to staging were **not** repaired — see `PUBLIC_API_INVENTORY.md` §12, which records
>   the measurement and why repair is deliberately out of scope.
> - **F1c — CLOSED.** The 201 body now carries four independent facts, none derivable from another:
>   `images_recorded`, `images_recorded_count`, `images_unpublishable_count` and
>   `images_primary_recorded`. A failed insert now reports `images_recorded: false` instead of a bare
>   `success: true`.
> - **F1a — OPEN, by design.** `image_url` is still stored substantially verbatim. The read path
>   refuses unpublishable values rather than the write path rejecting them; a storage-side CHECK
>   constraint remains a Phase 6 candidate (`MEDIA_EVIDENCE_CONTRACT.md` §6, item 3).

**F2 — `web/src/pages/VehicleDetail.tsx`. CLOSED.** The client's marketplace fallback previously
hardcoded `media_id: null` with a comment naming the marketplace as the owner of the gap. Both
halves are now closed. On the wire: `detail.media[].media_id` and
`detail.listing_media.items[].media_id` both carry the row id. On the client: the fallback no longer
hardcodes `null` — it reads the wire value and re-validates it through `toMediaIdentity`
(`mediaId: toMediaIdentity(row?.media_id)`), so an entry yields `null` only because the grammar
*refused* what it was given, which is a fact about the payload rather than a decision the client
made on the payload's behalf. The canonical envelope path does the same
(`media_id: toMediaIdentity(entry.media_id)`).

Identity continuity marketplace → detail is therefore proven on **both** sides, not server-side
only. The remaining preference — reading `detail.listing_media` through `readListingMediaBlock`
rather than re-projecting `detail.media` at all — is now a simplification, not a correctness gap;
see F3 for the one thing that still turns on it.

**F3 — `detail.media` cannot express `not_loaded`. CLOSED.** The finding stands as a statement about
the *array*: `not_loaded` is inexpressible in it, so a client reading `detail.media ?? []` coerces
"we did not look" into "the seller added no photos". **The page no longer reads it that way.**

`VehicleDetail.tsx` now resolves the marketplace transport envelope-first:

```
readListingMediaBlock(detailMedia?.listing_media)
  ?? toListingMediaBlock(detailMedia ? (detailMedia.media ?? []) : undefined)
```

Three things make this the fix rather than a reshuffle:

1. **The envelope is the authority, the array a strictly weaker view of it.** `??` takes the array
   only for a payload carrying no parseable envelope — not as a second opinion on one that does.
2. **A flat fallback re-opened the defect, and that was found by mutating this expression.** Reading
   the envelope's `not_loaded`, correctly skipping it, then answering from the same payload's `[]`
   published the listing empty statement about a table the request never successfully read.
   `unpublishable_count` was lost the same way — `none` with 2 unpublishable rows flattened to a
   bare `none`, passing our inability to render a stored value off as the seller's omission.

   > **Wording note.** This mutation was measured while `LISTING_MEDIA_EMPTY_STATEMENT` was
   > *"No photos have been added to this listing."*, and an earlier revision of this paragraph
   > quoted that literal. The constant has since been retired — it is now
   > *"No photos are published for this listing."* (Rule 1b / Rule 2 in
   > `MEDIA_EVIDENCE_CONTRACT.md`) — so the quotation no longer resolves anywhere in the tree and
   > has been replaced by the name of the constant. **The mutation result is unaffected:** the
   > defect was publishing *a* negative about an unread table, whatever sentence carried it.
3. **`detail` settling to `null` maps to `not_loaded`, not `none`.** A passport-only vehicle or a
   refused/failed fetch means `listing_images` was never consulted, so the page publishes no negative
   about it. That case is the original defect — the state in which the page used to announce "No
   verified images uploaded yet".

Both the *server* and the *page* are now honest. `detailLoading` gates both marketplace keys
together, so a stale `detail` from a previous VIN cannot answer for this one.

**F4 — `media[].type: 'image'`.** Retained for wire compatibility (VehicleDetail.tsx drops entries
whose `type !== 'image'`). It states that the row came from `listing_images` rather than from some
future video or document entry — a fact about the SOURCE. It must never be read as a claim that
the asset at `url` is an image; nothing validates the asset, and `url_form` is the only thing this
contract asserts about the string.
