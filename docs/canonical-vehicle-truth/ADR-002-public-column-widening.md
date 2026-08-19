# ADR-002 — Accepting a 7-column widening of the legacy public vehicle endpoints

**Status:** ACCEPTED by lead architect. Raised by independent review as "sign this off, do not absorb it."

## What changed

`/api/vehicles` and `/api/vehicles/:vin/details` previously projected through
`PUBLIC_VEHICLE_COLUMNS` (24 columns). Phase 0 converged them onto the canonical
`PUBLIC_VEHICLE_SELECT` (31 columns). Net **+7**:

`registration_authority`, `registration_status`, `plate_status`, `zimra_verified`,
`inspection_ready`, `safe_pay_ready`, `public_seller_display_enabled`

### Amended in Phase 1 — the same +7 now applies to two further endpoints

Phase 1 converged the remaining `PUBLIC_VEHICLE_COLUMNS` consumers onto the same canonical
list, so this sign-off explicitly extends to:

- `GET /api/vehicles/:vin/recommendations` (via `recommendationService`) — anonymous;
- the `vehicles(...)` embed on `GET /api/vehicles/saved` — authenticated, but the embedded rows
  belong to *other* sellers, so they are public-class data and are judged on the same basis.

Independently verified on staging: all 7 are low-cardinality enums or booleans
(`registration_authority` = `CVR` for all 16 rows; `plate_status` = `Active` for all 16;
the three booleans split 13/3, 12/4, 12/4; `public_seller_display_enabled` false for all).
None is a join key, and none can single out a person, plate, chassis or owner.
No column was dropped by either convergence — the change is strictly widening.

## Why this is acceptable

1. **Not a new exposure class.** All 7 are already returned to anonymous callers today by
   `GET /api/marketplace/listings` (verified live: the UAT Toyota payload carries `zimra_verified`,
   `plate_status`, `inspection_ready`, `safe_pay_ready`). Convergence onto one contract makes the
   public surface *consistent*; it does not reveal a category of fact that was previously private.
2. **None is identifying.** No value in the set can single out a person, a plate, or a chassis.
   `plate_status` is a lifecycle state (`Active`/`Flagged`/`Suspended`), not the plate.
   `public_seller_display_enabled` is a display posture flag, not seller identity.
3. **The alternative is worse.** Keeping two divergent public column lists is precisely the
   root cause (RC-2) this programme exists to remove: N projections drift, and the narrowest one
   provides false assurance while a sibling endpoint leaks.

## What is explicitly NOT widened

The 4 genuinely private columns are dropped for **both** audiences on these routes:
`owner_id`, `tenant_id`, `current_seller_id`, `temp_plate_id`.

## Related, deliberately not changed

`backend/routes/partnerApiRoutes.js:50,56` returns `plate_number`, but only behind
`requirePartnerScope('vehicle:identity')`. That is a governed partner scope, not an anonymous
leak. It is a **convergence gap**, not a P0, and is deferred to Phase 1 API convergence.

## Caveat carried forward

`zimra_verified` / `inspection_ready` / `safe_pay_ready` are today unbacked denormalized booleans
(Phase 2 classifies them; Phase 3 derives them). Publishing them consistently does not make them
*true* — it makes them consistently visible. Their truthfulness is Phase 2/3 work, and the
invariant suite must forbid a `verified` claim without provenance regardless of which endpoint
serves it.

---

## Amended in Phase 5 — `listing_images.id`, published as `listing_media[].media_id`

**Status:** ACCEPTED. Recorded here because the question "is this a widening?" must be answered in
writing, not because the answer turned out to be yes.

### What changed

`buildVehiclePassport` now reads `listing_images` and publishes each row's primary key as
`listing_media[].media_id` — a stable opaque identity for a gallery photograph. The gallery read
selects `id, image_url, is_primary, display_order`.

### Is it a widening? Two answers, and both are recorded

**By column: yes, narrowly.** `listing_images.id` was on no public surface before this change. The
passport never read the table at all, and `marketplaceListingDetailService` mapped its rows to
`{url, type, is_primary}`, dropping the id. So the column is new to the public surface.

**By disclosure class: no.** `PUBLIC_EVIDENCE_FIELDS` has published `id` — the primary key of
`vehicle_evidence` — as its **first field since Phase 0**. An opaque row identifier on a media item
is therefore an already-accepted category of public fact. What Phase 5 changed is that the *gallery*
now has one too. The asymmetry (evidence addressable, listing media not) was the anomaly; this
removes it. Adding it is consistency, not a new kind of exposure.

### Why an identity was needed at all

Continuity between Marketplace, Vehicle Detail and the passport was previously proven by comparing
URL **strings**. That proves three surfaces printed the same characters, and it is wrong in both
directions: a URL survives a CDN rewrite, an origin swap or a resize suffix and is still the same
photograph, while two different photographs can collide on one site-relative path — and 3 of 3
`listing_images` rows on staging are exactly such paths (`/uat/owner/*.svg`), with no unique index
and no CHECK behind them. `position` is worse still: it is a dense ordinal that moves whenever a
sibling row moves and is `0` on the first photo of every vehicle in the fleet.

### Why it discloses nothing

1. **Nothing to derive.** `listing_images` is `(id, vin, image_url, is_primary, display_order,
   created_at)`. It has **no** storage bucket, object path, uploader, tenant or reviewer column. There
   is no private locator on the row for an id to point at, and `image_url` — the only locator that
   exists — is already published beside it. The identity discloses strictly less than the item it
   sits on.
2. **The value is random.** `id` is `uuid NOT NULL DEFAULT gen_random_uuid()`, measured **v4** on 3
   of 3 staging rows. It is not derived from content, path, owner or time, so it is not reversible to
   anything.
3. **Precedent under harder conditions.** `vehicle_evidence` *does* carry `storage_bucket` and
   `file_path` (`vehicle-images` / `qa/evidence-73.jpg` on staging). Its `id` has been public since
   Phase 0 and exposes neither, because a random uuid derives nothing. Listing media is the easier
   case.
4. **Bounded mechanically, not by review.** `toMediaIdentity` publishes only values matching the
   anchored canonical UUID grammar. A storage path, a bucket name, a filename or a uuid *with* an
   extension cannot be published as an identity even if a future row carries one in `id`. This is a
   grammar, not a convention — see the mutation record in `MEDIA_EVIDENCE_CONTRACT.md`.

### Why it is `media_id` and not `id`

The two media item shapes share **not one key name**, which is what makes "a listing photo and a
verified artifact can never be conflated" a property a test executes rather than a rule a reviewer
enforces by eye. `id` is already the first field of the evidence item. Publishing the listing
identity under the same name would have put one key on both shapes and collapsed that proof.

### What is explicitly NOT published

`listing_images.created_at` remains unread and unpublished. It is the row's INSERT time, and a date
rendered beside a photograph is read as when the photograph was taken. `vehicle_evidence` has
`captured_at` for that claim, behind a review; `listing_images` has no equivalent and no reviewer,
so the passport must not imply one.

### Closed within Phase 5 — the marketplace transport now carries the identity

An earlier revision of this ADR carried a finding forward: `marketplaceListingDetailService` still
dropped `id`, so the marketplace transport could not name a photograph and the client published
`media_id: null` on that path. **That is no longer true and the finding is closed.**

`marketplaceListingDetailService` now derives its media from the same single projection as the
passport — `toListingMediaBlock(imageRows)` — and publishes BOTH the canonical `listing_media`
envelope AND a `media` compatibility view whose items carry `media_id`, `url`, `url_form`,
`position`, `is_primary` and `type`. `media_id` on that view is `listing_media[].media_id`
unchanged, so it is the same gated identity, not a second derivation. The client reads it at
`VehicleDetail.tsx` and renders it as `data-media-id`.

Two consequences worth stating, because they are the reason this closure is real rather than
cosmetic:

- **There is one definition of the identity, not two.** The marketplace lane does not re-implement
  the UUID grammar; it consumes the projection's already-gated value. A path, bucket or filename
  cannot enter the marketplace payload as an identity for exactly the reason it cannot enter the
  passport's.
- **`media_id: null` is still reachable and still correct.** When `toMediaIdentity` refuses a value
  that does not match the anchored UUID grammar, the item publishes `media_id: null`. `null`
  remains the truthful answer — a value synthesised from the array index would reintroduce exactly
  the instability this field replaces.

The `type: 'image'` key on the compatibility view is a statement about the row's SOURCE
(`listing_images`), never a claim about the asset at `url`. And because `not_loaded` cannot be
expressed in an array, the compatibility view flattens it to `[]`; `listing_media.state` remains the
only place on the payload where "we did not look" can be said, which is why the envelope — not the
array — is the authority.

---

## Amended in Phase 5 — the anonymous Passport and a DRAFT listing's photographs

**Status: DECIDED by the product owner, 2026-08-19.** Recorded here because it is a decision about
what an anonymous caller receives, which is this ADR's subject. The *lookup* half of passport
disclosure policy — who may resolve which identifier to a VIN at all — lives in
`ADR-003-passport-lookup-policy.md`, and the two are complementary: ADR-003 governs **whether the
passport resolves**, this entry governs **what the resolved body contains**. Read together they are
the whole anonymous-passport disclosure surface. The executable form of this decision is Rule 1b in
`MEDIA_EVIDENCE_CONTRACT.md`.

### The problem, and that nobody chose it

Phase 5 gave `buildVehiclePassport` a `listing_images` read it had never had. That was the fix for
the defect the whole issue is named after. It also, as a side effect nobody decided, made an
**unpublished** listing's photographs reachable by any anonymous caller holding the VIN.

The two surfaces disagreed, in the direction that matters:

- **The Marketplace 404s a draft.** `filterVisibleVehicles` (`isPubliclyVisiblePublication` +
  `isPublicVehicleStatus`) runs before any row is projected, so a draft never reaches a media
  projection at all.
- **The passport had no publication gate, correctly.** It is the canonical record of a **vehicle**,
  not of a listing, and `listing_images` is keyed by VIN, and the passport resolves by VIN. Three
  correct local decisions composed into a disclosure.

Measured on staging (`eoyenigwevnxwwhyhaer`, read-only): `WBA8E9C50JNUAT202` is
`publication_status = 'draft'` and carries one `listing_images` row. This was live data, not a
hypothetical.

### Decision

**GATE.** Anonymous callers receive listing media **only for a published listing**. Owner, admin and
government keep the access they already had.

**And the gated response must be non-enumerable: a draft-with-photos and a published-with-no-photos
must be indistinguishable.**

### Why the second sentence is the substance of the decision

A gate is easy; a gate that does not leak the thing it is hiding is the actual requirement, and the
two obvious implementations both fail it:

1. **A `withheld` state, or a non-zero count over the hidden rows.** Both answer *"does this
   unpublished listing have photographs?"* — which is the question the gate exists to refuse. A
   count is a disclosure with the pixels removed. It reduces the leak from *the photographs* to
   *their existence*; it does not close it.
2. **Saying "no photos have been added to this listing" about a listing that HAS photos.** This is
   the one worth stating plainly, because it is the tempting one: it looks like a redaction and it
   is a **new public falsehood**. It replaces a disclosure with a lie about the seller's behaviour,
   on the surface whose entire subject is that CarUp does not publish things it cannot support. A
   redaction that makes the product lie is strictly worse than the leak it closes — and this
   programme has made that mistake before, which is why it is written down rather than assumed.

The requirement is therefore **equality of output**, not merely absence of the photographs.

### What Lane D actually implemented — read from the shipped code, not predicted

Verified against `backend/utils/vehicleMediaProjection.js` and `buildVehiclePassport` in
`backend/server.js` at this tree:

- **The gate lives in the contract, not in the route.** `toGatedListingMediaBlock(rows, options)`,
  reached through `toVehicleMedia({ …, listingPublicationStatus, listingAudience })`. Deciding it in
  the route would have meant inlining `vehicle.publication_status === 'published'` into the one
  function whose whole subject is that there is a single definition of published — the passport's
  collaborator set is closed, so the canonical helper is not reachable from inside it. The contract
  already imports the definition; the contract decides.
- **Non-enumerability holds by construction, not by matching.** A gated caller gets
  `toListingMediaBlock(NO_ROWS)` — *the same projector over an empty input*, not a hand-built
  lookalike. So byte-identity with a published-and-empty listing cannot be broken by any future edit
  to what an empty block looks like.
- **The sentence changed for every caller.** `LISTING_MEDIA_EMPTY_STATEMENT` is now
  *"No photos are published for this listing."* It asserts only what the contract itself did, and
  nothing about the seller or the table. Two sentences — one for the gated case, one for the genuine
  case — would **be** the enumeration leak. It also fixes an older falsehood unrelated to the gate:
  a listing whose every row is unpublishable also reaches `none`, and nobody failed to add a photo
  there either.
- **The rows are still read for a listing we may not publish**, deliberately: a draft and a published
  listing issue the same queries in the same order, so response time carries no signal either. The
  rows are discarded inside the process and never counted or summarised.
- **An unreadable publication state answers `not_loaded`, not `none`.** A gate that fails open is not
  a gate; and "no photos are published" is a claim a render that could not establish publication has
  not earned. This is deliberately the **opposite** default from `isPubliclyVisiblePublication`,
  which returns `true` for an absent value so hermetic fixtures keep flowing through the marketplace
  filter — while the same `publiclyVisiblePublicationStatuses()` **value set** is imported, so the
  two gates cannot disagree about which statuses are public.
- **Evidence is not gated by this decision.** A verified registration document is a fact about the
  **car** and stays true whether or not anyone is advertising it. `audience` (evidence) and
  `listingAudience` (listing media) are separate parameters precisely so that widening one cannot
  widen the other.

### Is this a widening or a narrowing?

**A narrowing, relative to the change-set it ships with; a no-op relative to `origin/main`.** Before
Phase 5 the passport served no listing media at all. This decision means the passport serves listing
media *exactly where the marketplace already would*, and serves the owner/admin/government audiences
what they could already reach. No caller loses access they had before this branch.

### Guarded by

`backend/tests/issue164-phase5-listing-publication-gate.test.js` — **35 tests, 8 suites, 0 fail** at
the time of writing.
