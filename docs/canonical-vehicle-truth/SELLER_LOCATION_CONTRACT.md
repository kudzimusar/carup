# Seller, Location, Registration & Specification Contract — Issue #164 Phase 4

**Status:** the shape below is FINAL. The two convergence stages consume it; they do not redesign it.

Canonical module: `backend/utils/publicVehicleProjection.js` (contract header at the top of the
file, implementation at the bottom).
Companion migration: `database/migrations/20260817160000_issue164_listing_location_provenance.sql`
(authored, **not applied**).
Permanent guard: `backend/tests/issue164-phase4-seller-location.test.js`.

Builds on, and does not fork:
`FIELD_STATES` / `fieldState` / `statedValue` (Phase 1), `toPublicTrust()` (Phase 3, ADR-001),
`FACT_MODEL.md` (Phase 2).

---

## 0. What was actually wrong

Measured on staging `eoyenigwevnxwwhyhaer` (PostgreSQL 17.6, 16 rows in `public.vehicles`) before
a line was written. Not inferred from the migration files — the migrations and the live schema
disagree, and the live schema is what serves shoppers.

| finding | measurement |
|---|---|
| No location column exists on the vehicle **at all** | one hit for city/province/location/country/address/region across all of `public.vehicles`: `registration_country` |
| The marketplace prints a country constant on every card | `listingSummaryService.buildMarketplaceListingSummary` emits a hardcoded `location` string |
| The write path accepts a location and throws it away | `/api/vehicles/add` destructures `location` and `province` from `req.body` and references neither afterwards |
| `registration_authority` is 100% schema-manufactured | one value on **16 of 16** rows — and **zero** application writers repo-wide |
| `registration_status` is 100% schema-manufactured | one value on **16 of 16** rows — **zero** writers |
| `plate_status` is 100% schema-manufactured | one value on **16 of 16** rows — **zero** writers |
| `registration_country` is split writer/default | 13 rows hold the default's code form, 3 hold a spelled-out form |
| `current_seller_type` is split writer/default | 13 rows hold the default's label, 3 hold the writer's slug |
| Every listing shows a generic seller label | `public_seller_display_enabled = false` on **16 of 16** rows |
| `seller_type` is inferred from a join | any vehicle with a joined `tenants` row is classified as a dealer regardless of `current_seller_type` |

**The root cause is not a rendering bug.** Two encodings in one column, and a value present on
100% of rows with no writer behind it, are the signature of a schema DEFAULT standing in for a
fact. The read path could not have got this right: it was reading columns the database had filled
in on the vehicle's behalf.

Inventory query used, kept here so the pre-change state can be recovered without this document:

```sql
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'vehicles'
 ORDER BY ordinal_position;
```

---

## 1. The rule that decides everything else

> **A value is a claim only when something recorded who asserted it.**

`registration_authority` is not "probably right"; it is a string the DDL wrote. Nothing about the
value's *shape* distinguishes a genuine assertion from a manufactured one, so the contract does not
test the shape. It tests provenance: a companion `*_source` column naming a member of
`CLAIM_SOURCES`. No source, no claim — whatever the column holds.

Three corollaries the convergence stages must not soften:

1. **No source ⇒ `not_recorded`, and `value: null`.** Not "recorded with low confidence". A value
   without provenance is not a smaller claim; it is not a claim.
2. **Unrecognised source ⇒ no provenance.** `isClaimSource()` fails closed, so a typo or an
   invented source string cannot manufacture a recorded fact. The same vocabulary is a CHECK
   constraint on every `*_source` column, so the two layers cannot drift.
3. **A source is not a trust signal.** `registry_verified` records *where a value came from*, not
   how much to believe the listing. Trust is `canonicalTrustService`'s contract (Phase 3) and is
   not restated, duplicated or scored here.

---

## 2. The shape — `toListingClaims(vehicle, options)`

Five blocks. Every leaf is a stated pair. `state` is always one of the four `FIELD_STATES`
(`recorded` | `not_recorded` | `withheld` | `not_applicable`). A block carries **exactly** its
declared fields — always all of them, never more — so "the key is missing" is not a third way of
saying unknown.

```
seller
  relationship     {value: true|null, state}          that a seller is linked. NEVER the id.
  seller_type      {value, state, source}             provenance-gated
  display_label    {value, state}                     the seller's OWN published name only
  contact_channel  {value: string[]|null, state}      channel KINDS, never an address

location                                              all three provenance-gated
  city             {value, state, source}
  province         {value, state, source}
  country          {value, state, source}

registration                                          all four provenance-gated
  country          {value, state, source}
  authority        {value, state, source}
  status           {value, state, source}
  plate_status     {value, state, source}

specification                                         no provenance columns exist yet
  mileage | fuel_type | transmission | drivetrain | color | condition_category   {value, state}

publication
  publication_status | listing_status                 {value, state}
```

### Exported surface

| export | purpose |
|---|---|
| `toListingClaims(vehicle, options)` | the entry point — all five blocks |
| `toSellerClaim` / `toLocationClaim` / `toRegistrationClaim` / `toSpecificationClaim` / `toPublicationClaim` | one block each |
| `LISTING_CLAIM_BLOCKS` | block name → its exact field list |
| `CLAIM_SOURCES`, `isClaimSource` | the provenance vocabulary |
| `CLAIM_VISIBILITY` | `public` / `withheld` |
| `attestedValue(value, source, options)` | provenance-gated `{value, state, source}` |
| `sealClaimBlock(name, entries)` | **the helper a read path calls** — throws on a bare value |
| `isStatedValue`, `findBareClaims` | guards a suite (or a route) can assert with |
| `assertContactChannelKinds` | rejects an address passed where a channel kind belongs |
| `LISTING_CLAIM_COLUMNS` | the 12 new columns — see §6, do not add to the select yet |
| `CONDITION_ABSENCE_MARKER` | the schema's own "not classified" marker |

### `options`

| option | effect |
|---|---|
| `audience: 'public' \| 'owner'` | `'owner'` lifts the two withholding gates. It never relaxes a provenance requirement — an owner may see their own unpublished data, not be told a claim exists that never did. |
| `sellerDisplayName` | the seller's own published name, resolved by the caller (e.g. the joined tenant's name). Never a category label. |
| `publishedContactChannels` | channel **kinds**. `undefined` = not consulted → `not_recorded`; `[]` = consulted, none published → `withheld` when a seller is linked. |
| `sellerTypeSource` / `locationSource` | provenance overrides when the caller resolved it outside the row. |
| `registrationWithheld` | for a surface that must not disclose registration lifecycle to this audience. |

---

## 3. Withheld is not unrecorded

`withheld` = a fact exists and this audience is not cleared for it.
`not_recorded` = we hold nothing.

A withheld leaf carries `value: null` **and** `source: null`, and any two withheld leaves are
byte-identical to each other — the response discloses nothing about **which** value is being hidden:
not its content, not its length, not its origin. If it were not, the response would answer the very
question the withholding exists to refuse — absence read as proof, principle 9.
(`registry_verified, but you may not see it` already narrows down what is behind it.)

> **Byte-identity is scoped to WHICH value is hidden, and never to WHETHER a fact exists.**
> `withheld` is only ever reached on a path that has already established a fact is there, so the
> two cases it must be indistinguishable between are *this* hidden value and *that* one — never
> "a hidden value" versus "nothing at all". Extending it to the second is not a stricter reading of
> the same principle; it is the reasoning that MANUFACTURES a withholding, because it makes emitting
> `withheld` over an empty column look like the safe default. It is the defect this contract's own
> Rule 2 forbids, and it is the one the seller gate below shipped with before it was fixed. Absence
> and refusal are different answers and the contract's job is to keep telling them apart.

The two real gates, both of which lift for `audience: 'owner'`:

| gate | withheld when |
|---|---|
| `seller.display_label` | a seller is linked, **a name was resolved for that seller**, and `public_seller_display_enabled !== true` |
| `location.*` | a location has provenance but `listing_location_visibility !== 'public'` |

**The existence test runs FIRST on the seller gate, and the order is load-bearing.** Consulting
consent first — the shape `toSellerClaim` originally shipped — makes every non-consenting seller
publish `withheld` whether or not a name exists. Callers resolve a name only for a joined tenant, so
a private seller has no name source on that path at all, and the API then asserted "a name exists,
you are not cleared to see it" over an empty column: a withholding fabricated for a seller who never
had a name to withhold. A linked seller with no resolved name is `not_recorded`, for every audience.

**Absence is not permission.** An undeclared `listing_location_visibility` withholds. This is the
same rule `isPublicPlateHistoryRow` already applies to plate history, not a new one.

**Nothing recorded means nothing to withhold.** An unprovenanced location is `not_recorded` for
every audience, so `withheld` can never become a way of implying a location exists.

`public_seller_display_enabled` is compared with `=== true`, never coerced. A string, a `1` or an
`undefined` is not a seller's consent to be named.

---

## 4. What is removed, and what is not put back

Removing a claim is in scope. Inventing a replacement is not.

- **No generic seller label.** `'Verified dealer'` is not emitted — dealer registration is not
  verification, and `Marketplace.tsx:141` already says so in its own comment. Neither is a generic
  private-seller label: a listing whose seller has published no name **has no name to show**, and
  a category label filling the gap is the same fabrication in a smaller font. `display_label` is
  the seller's own published name or it is a non-recorded state.
- **No seller type inferred from a join.** A joined `tenants` row means a tenant exists, not that
  the seller is a dealer.
- **Location never falls back to registration, or to the seller's profile.** Where a car is
  registered is not where it is; where its seller lives is not where it is. `location.country`
  reads `listing_country` and nothing else. This is the most tempting substitution on the whole
  contract and it is the one that produced the hardcoded country string on every card.
- **A genuine zero is a fact.** `0` and `false` are `recorded`; `''` and whitespace are not.
  A vehicle with 0 km has a recorded mileage. A vehicle whose mileage was never captured does not.
- **`condition_category`'s `unknown` maps to `not_recorded`.** That value is the schema's own
  declared absence marker (one of the six its CHECK permits). Agreeing with the database is not
  the same as inventing a state.
- **One body, one answer.** A flat convenience field published beside a governed claim must be
  *derived from that claim*, never re-read from the column. The card carried `plate_status:
  "Active"` and `seller_type: "private"` next to `claims.registration.plate_status` and
  `claims.seller.seller_type` reporting `not_recorded` — the same question answered twice,
  differently, in one response, where a consumer reading the wrong one cannot even tell it disagreed
  with the other. A **derived** publication counts as an answer too: `marketplace_tags` containing
  `private_sale` asserts a seller type just as surely as the field does, so tags follow the claim
  as well. Being non-identifying, or being needed by an existing consumer, is not provenance and
  never justified the second copy.

### The stated consequence

No existing row carries provenance and **none is backfilled**. On the day the read paths consume
this contract, all 16 listings report registration, seller type and currency as `not_recorded`, and
every listing reports its location as `not_recorded`. The flat card fields follow: `plate_status`,
`seller_type` and `currency` publish `null` with a `*_state` companion, and no listing earns a
`dealer_verified` or `private_sale` tag.

That is the intended outcome, not a regression to be softened. Sixteen unfounded claims stop being
published and zero are invented to replace them. A seller or an operator restores a fact by
asserting it **with its source** through the write path. Restoring the three genuine
`current_seller_type` slugs by backfilling a provenance value for them would mean provenance could
be granted after the fact — which would make it mean nothing.

---

## 5. Known limitations — stated, not papered over

A consumer must not read `recorded` as "verified".

1. **Specification carries no provenance, so `recorded` here means only "the column holds it".**
   `/api/vehicles/add` *used to* substitute a fuel type, a transmission, a colour and a drivetrain
   when the client omitted them; those substitutions are **removed** — an omitted specification now
   stores `NULL`. That closes the source, and it does not close the limitation: these columns still
   have no `*_source` to gate on, so this contract cannot distinguish a seller's declaration from a
   value written by some other path, and any future substitution anywhere would again be `recorded`
   and invented. It stays closable only at the write path. Reporting a value as `not_recorded`
   because it *might* have been substituted would be a second fabrication in the opposite direction.
2. **`mileage` cannot express "not captured".** It is `NOT NULL` with no default. The write path
   *used to* coerce a missing mileage to `0`; it now **rejects the submission with a 400** instead,
   because where a column cannot record "unknown" the honest resolution is to refuse the write
   rather than invent the value. Measured: **0 of 16** staging rows hold mileage `0`, so no live row
   is ambiguous. The limitation itself is unclosed — a `0` in this column is still unfalsifiably
   either a delivery-mileage vehicle or a legacy coercion, and only making the column nullable fixes
   that, which is a separate reviewed migration.
3. **`currency` is gated outside the sealed blocks.** `LISTING_CLAIM_BLOCKS` has no leaf for it, so
   its provenance gate lives in `listingSummaryService.currencyClaim()` (and is re-derived, not
   inherited, in `marketplacePricingService`) rather than in `toListingClaims`. It behaves
   identically — `attestedValue(currency, currency_source)` — but it is not covered by
   `sealClaimBlock`/`findBareClaims`, so nothing structurally prevents a future surface publishing
   the raw column beside it. Additionally `currency_source` **is in the authored migration** (added by N3, with the same CLAIM_SOURCES vocabulary CHECK as the other six source columns):
   §6 step 0 records how the gate was made reachable rather than permanently closed.
4. **`vehicles.trust_score` still carries `DEFAULT 80.0` at the column level.** Deliberately
   untouched by this phase and by the companion migration: trust is the certified Phase 3 contract
   (ADR-001), where the read path publishes only `canonicalTrustService`'s projection and the write
   path already inserts an explicit `NULL`. **Recorded as an open finding for the phase that owns
   the trust cache.** Changing it here would edit a certified contract sideways.
5. **`registration_country` loses two genuine encodings.** 3 of 16 rows hold a writer-supplied
   country; after this contract they read `not_recorded` because no provenance exists for them.
   Accepted, for the reason in §4.
6. **`vehicles.current_seller_type` is still projected bare onto the passport.** It is in
   `PUBLIC_VEHICLE_FIELDS`, and `buildVehiclePassport`'s `CLAIM_GOVERNED_COLUMNS` withdraws only the
   four registration columns — so the passport publishes `vehicle.current_seller_type: "Private
   Owner"` beside `claims.seller.seller_type: not_recorded`, one body answering one question twice.
   The marketplace card and detail payload are fixed; the passport is **open**, and closing it means
   adding `current_seller_type` to `CLAIM_GOVERNED_COLUMNS` in `backend/server.js`. Measured: 13 of
   16 rows hold the DEFAULT label `'Private Owner'`, 3 hold the writer's `'private'` slug.

---

## 6. What the convergence stages must do — in this order

Steps marked **DONE** shipped in this phase and are listed so the order stays legible, not as work
to repeat. Steps marked **OPEN** are what is actually left.

0. **DONE — `currency_source` lands with the DEFAULT drop.** Dropping `currency`'s DEFAULT is only
   the removing half: without a source column the currency gate (§5.3) would report `not_recorded`
   for every listing forever, including a currency a seller genuinely stated — a fabricated
   withholding, the inverse of the defect this phase removes. All three halves shipped together:
   the column plus the same `CLAIM_SOURCES` CHECK the other `*_source` columns get; an entry in
   `LISTING_CLAIM_COLUMNS`; and `currency_source: claimSource` written beside the `currency` that
   `/api/vehicles/add` already requires. Proved end-to-end in PGlite: a stated `ZWG` stores and
   publishes, a silent insert stores NULL/NULL rather than a manufactured USD.
1. **OPEN — apply the migration first.** `LISTING_CLAIM_COLUMNS` names 12 columns that do not exist
   yet. They are deliberately **not** in
   `PUBLIC_VEHICLE_FIELDS`/`PUBLIC_VEHICLE_SELECT`, nor in `LISTING_SELECT_COLUMNS`: PostgREST fails
   an entire select when it names an unknown column, so widening the canonical select before the
   migration lands would take down every public vehicle read. Migration, then select, then read
   paths.
2. **Route every governed fact through `sealClaimBlock()`.** It throws instead of emitting a bare
   value. A `TypeError` in a route is a bug report; a hardcoded country in a response body is a
   fabricated fact shipped to a shopper, and only one of those is recoverable.
3. **Assert `findBareClaims(body).length === 0`** on each converged surface. Note what this does
   **not** catch: a bare copy of a governed fact sitting *outside* a block — `plate_status` on the
   card, `current_seller_type` on the passport — is invisible to it, because it walks declared block
   names only. Those need their own assertion per surface, and §5.6 is the one still open.
4. **DONE — the write-path hole is closed.** `/api/vehicles/add` persists `location`/`province`
   into `listing_city`/`listing_province`/`listing_country` **together with**
   `listing_location_source` and `listing_location_visibility`, and reports `location_recorded` on
   the response. The database refuses a location without provenance
   (`vehicles_listing_location_requires_source`), so a partial write fails loudly rather than
   storing an unattributable place name.
5. **DONE — the substitutions in that write path are deleted** (limitation 1). An omitted fuel type,
   colour, transmission, drivetrain or import source is `NULL`, not a guess; an omitted mileage or
   currency is a 400 rather than a `0` or a `'USD'`.
6. **Do not touch trust.** No block here carries a score, a band or a confidence, and none may be
   added. `canonicalTrustService.toPublicTrust()` remains the only shape that speaks for trust.
7. **DONE — owner-dashboard surfaces no longer render a progress bar for a NULL trust score.**
   `OwnerDashboard.tsx`, `MyGarage.tsx`, `MyListings.tsx` and `SavedCars.tsx` drew a 0%-filled bar
   for "never evaluated"; Phase 3 had fixed `VehicleDetail`/`VehicleProfile` only. This was a
   *rendering* fix against the existing Phase 3 contract and produced no new one.

---

## 7. Migration — owner table and why

`public.vehicles`, justified against every alternative present in the schema rather than assumed.
Full reasoning is in the migration header; the summary:

| candidate | verdict |
|---|---|
| `public.vehicle_listings` | **does not exist** — `to_regclass` is NULL; its only DDL is a SQLite-era file never applied to PostgreSQL |
| `public.vehicle_listing_summaries` | exists, 0 rows, and is **being dropped** by `20260817120000` as a dormant second listing model |
| `listing_images` / `listing_snapshots` | children *of* a listing; a location on either is per-photo or per-snapshot |
| `users.location` | the **seller's** location. A dealer in one city can list a car standing in another — binding the two is the inferred truth this programme removes |
| `dealer_branches.address`, `organization_branches.location` | where an *organisation* is; and 15 of 16 vehicles have no tenant at all |
| **`public.vehicles`** | **chosen** — one VIN = one row = one listing. `publication_status`, `status`, `price`, `currency`, `current_seller_*` already live here and the live read path resolves listings from this table and no other. Adding location here creates no new source of truth; anywhere else creates a second one. |

Columns are prefixed `listing_` deliberately: they are listing facts, not vehicle-identity facts.
If CarUp later separates a listing from a vehicle (the same car relisted twice, in two cities), the
prefix names exactly which columns move — a mechanical split rather than an archaeological one.

**No backfill, and why.** Every new column lands `NULL` on every existing row. There is no honest
value to write: we do not know which city any of the 16 vehicles is in, and choosing the most
likely one — the capital, the seller's profile city, the registration country — would fabricate the
exact class of fact this phase exists to delete. A `NULL` city renders as "not recorded", which is
true. A guessed city renders as a place, and a shopper who drives to it has been lied to by a
default. The postcondition proves the absence of a backfill by counting non-NULLs, and proves no
existing data moved by comparing a pre/post digest of every column the migration could have
touched.

**The six DEFAULTs it drops:** `registration_country`, `registration_authority`,
`registration_status`, `plate_status`, `current_seller_type`, `currency`. Dropping a default
rewrites no row — it changes only what a *future* insert receives when it stays silent, and the
honest answer to silence is `NULL`. Left in place, these accumulate the fabrication on every new
listing, forever.

`currency` was added to that list after the first five, and how it got missed is the more useful
half of the finding. Its fabrication was removed from the application in two places — `currency ||
'USD'` in `listingSummaryService` and again in `/api/vehicles/add` — which read as a closure and was
not one: the column's own DEFAULT went on manufacturing the value one layer down, where no code
review would see it again. Measured: `currency = 'USD'` on **16 of 16** rows, one distinct value,
zero NULLs — the same signature that convicted `registration_authority`. **Deleting an application
substitution while its column DEFAULT stands does not end the fabrication; it only changes who is
doing the inventing.** That is the check to run against the remaining defaults in §7's
"leaves alone" list, not a fact about currency alone.

**What it deliberately leaves alone**, so the omissions are not later read as oversights:
`trust_score`'s default (Phase 3's certified contract), `status`'s default (a lifecycle initial
state, gated by `publication_status DEFAULT 'draft'` which is correctly fail-closed),
`vehicle_condition_category`'s default (the one default here that tells the truth), and the boolean
verification flags (Phase 2's `FACT_MODEL.md`).
