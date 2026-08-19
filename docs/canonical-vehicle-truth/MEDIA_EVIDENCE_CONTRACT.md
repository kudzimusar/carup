# Media and Evidence Convergence — the canonical contract

Issue #164, Phase 5. Companion to `FACT_MODEL.md` (Phase 2), `ADR-001-trust-authority.md` (Phase 3)
and `SELLER_LOCATION_CONTRACT.md` (Phase 4).

Implementation: `backend/utils/vehicleMediaProjection.js`.
Permanent guards: `backend/tests/issue164-phase5-media-contract.test.js` (the contract),
`…-passport-media-wiring.test.js` (the passport is actually wired to it),
`…-media-identity-containment.test.js` (Rule 6b), `…-listing-publication-gate.test.js` (Rule 1b),
`…-marketplace-convergence.test.js` (one definition across the marketplace), and
`web/src/pages/VehicleDetail.media.test.tsx` (the page).

Decisions this contract executes rather than makes: **`ADR-002-public-column-widening.md`** —
`listing_images.id` as a public `media_id`, and the Rule 1b publication gate on the anonymous
passport. Disclosure policy for the *route* that reaches the passport is
`ADR-003-passport-lookup-policy.md`.

## What this phase changes — CORRECTED

An earlier revision of this line read: *"This phase defines and proves the contract. It changes
**no read path** — that is the next stage."* **That was true when the module was first written and
is false of the change-set this document ships with.** The convergence that was going to be "the
next stage" was folded into Phase 5, and a governing contract that under-states its own blast
radius is the same class of defect as a block that under-states what it read.

Phase 5 defines the contract **and rewrites four read paths onto it**, plus one write path:

| # | read path | what changed |
|---|---|---|
| 1 | `buildVehiclePassport` (`backend/server.js`) | Gained a `listing_images` read it never had, composes `toVehicleMedia(...)` and spreads `listing_media` + `verified_evidence` onto the passport body. This is the path that closes the original defect, and the one that made Rule 1b necessary. |
| 2 | `getMarketplaceListingDetail` (`marketplaceListingDetailService.js`) | Its own sort/filter/map projection was **deleted**; `listing_media` is published as the authority and `media[]` survives only as a strictly-derived compatibility view. |
| 3 | `buildMarketplaceListingSummary` / `listMarketplaceListings` (`listingSummaryService.js`) | The truthy-column cover-image election was **deleted**; `electPrimaryImage` sources from `toListingMediaBlock` and publishes `primary_image_state` / `primary_image_unpublishable_count` beside `primary_image_url`. `fetchListingRelatedRows` now reports **whether the read happened** (`listingImagesRead`) instead of degrading a failed query to `[]`. |
| 4 | `web/src/pages/VehicleDetail.tsx` | Reads the canonical envelope from **both** transports, re-validates every field across the wire, keys the gallery on `media_id`, and renders the contract's sentences instead of authoring its own. |
| 5 | `POST /api/vehicles/add` (write path) | Gates stored URLs on `isPublishableMediaUrl` **imported from this module**, records the seller's primacy claim instead of fabricating it from array order, and reports what was actually stored on the 201 body. |

The ordering claim was not wrong, only the tense: the shape *was* settled before the surfaces
consumed it. They then consumed it in the same phase.

---

## 1. The two concepts, and why they must never be one control

| | **Listing media** | **Verified evidence** |
|---|---|---|
| What it is | The seller's marketing photos: exterior, interior, dashboard, engine, disclosed damage | Governed artifacts: registration, inspection, clearance, customs, insurance, service invoices, reviewed imagery |
| Its job | Show the car | Prove something about the car |
| Source table | `public.listing_images` | `public.vehicle_evidence` |
| Provenance | **None exists.** No uploader, no capture time, no reviewer, no checksum, no source | `uploaded_by`, `verified_by`, `source_id`, `captured_at`, `checksum`, `evidence_class` |
| Review decision | **None.** The table has no status column at all | `verification_status` ∈ pending / verified / rejected / disputed / superseded |
| Audience gate | None (published with the listing) | `visibility_level` ∈ public_safe / restricted / private / government_only |
| Trust language | **Forbidden** | Required — it is the point |

Vehicle Detail composes **both**. A Marketplace listing image stays available on Detail *as listing
media*, and being displayed there does **not** make it evidence.

---

## 2. The shape convergence agents consume

```js
import { toVehicleMedia } from '../utils/vehicleMediaProjection.js';

toVehicleMedia({
  listingImageRows,            // Rule 1: array = we looked; undefined/null = we did not
  evidenceRows,                //   ditto
  audience,                    // EVIDENCE rows only          — 'public' | 'owner'
  listingPublicationStatus,    // LISTING media only (Rule 1b) — vehicles.publication_status, raw
  listingAudience,             // LISTING media only (Rule 1b) — 'public' | 'owner'
})
```

`audience` and `listingAudience` are **two parameters on purpose**: evidence is truth about a
**vehicle**, listing media is content on a **listing**, and neither may widen the other. Both listing
parameters default to the closed direction (`public`, and an absent status ⇒ `not_loaded`).

```
{
  listing_media: {
    state:               'published' | 'none' | 'not_loaded',
    items:               [{ media_id, url, url_form, position, is_primary }],
    unpublishable_count: number,
    empty_statement:     string | null,
  },
  verified_evidence: {
    state:               'published' | 'none' | 'not_loaded',
    items:               [{ ...PUBLIC_EVIDENCE_FIELDS, file_url_form }],
    unpublishable_count: number,
    empty_statement:     string | null,
  },
}
```

The **envelopes are identical** so a consumer reads both blocks through one protocol.
The **item shapes share not one key name** — that is what makes "these can never be conflated" an
assertion a test runs, rather than a convention a reviewer enforces by eye.

Both inputs are independent. Omitting one is legal and produces `not_loaded` for that block only.

---

## 3. The ten rules

### Rule 1 — a block that was never read may not say "none"
`not_loaded` is the original defect expressed as a state. `undefined`/`null` rows in ⇒ `not_loaded`,
`items: []`, **`empty_statement: null`** — a consumer that renders the statement renders nothing.
An **array** in, including `[]`, means the caller looked; only then can the block say `none`.

A read path that does not query `listing_images` therefore **cannot** publish "no photos".

### Rule 1b — an unpublished listing publishes no gallery, and says nothing about why

**Product-owner decision, taken this round. The full reasoning is recorded in
`ADR-002-public-column-widening.md`; this rule is the executable half.** It was missing from this
file while `vehicleMediaProjection.js` cited "Rule 1b" a dozen times — the canonical contract did
not contain the rule its own implementation kept pointing at.

Anonymous callers receive listing media **only for a published listing**. Owner, admin and
government keep the access they already had.

**Why it is needed at all, and why only now.** It is a defect Phase 5 *created*. `listing_images` is
keyed by VIN, the passport resolves by VIN, and the passport applies no marketplace visibility
filter — correctly, because it is the canonical record of a **vehicle**, not of a listing. So the
moment read path 1 above gained its `listing_images` query, a photograph on an **unpublished**
listing became reachable by any anonymous caller holding the VIN, on a surface where the marketplace
answers 404. Nothing decided that; it fell out of the wiring. Measured on staging:
`WBA8E9C50JNUAT202` is `publication_status = 'draft'` and carries one `listing_images` row.

**The gate is non-enumerable, and that constraint is the substance of the rule.** Two obvious
answers are both wrong:

- **Rejected — a `withheld` state, or a non-zero `unpublishable_count` over the hidden rows.** Both
  answer *"does this unpublished listing have photographs?"*, which is the question the gate exists
  to refuse. A count is a disclosure with the pixels removed.
- **Rejected — `state: 'none'` carrying "No photos have been added to this listing."** That replaces
  a disclosure with a **new public falsehood**: photos *were* added. A redaction that makes the
  product lie is worse than the leak it closes.

**Adopted:** the gated block is produced by calling `toListingMediaBlock` over an **empty input** —
the same projector, not a parallel one — so it is byte-identical to the block a *published* listing
with no photos publishes, and cannot drift into a distinguishable shape by anybody's future edit. A
draft-with-photos and a published-with-no-photos are indistinguishable from outside.

**When the publication state itself cannot be read, the block is `not_loaded`** — not `none` ("no
photos are published" is a claim a render that could not establish publication has not earned) and
not open (a gate that fails open is not a gate). Note this is the **opposite** default from
`isPubliclyVisiblePublication`, which returns `true` for an absent value on purpose so that hermetic
fixtures keep flowing through the marketplace filter. `resolveListingPublication` therefore decides
absence itself while importing the same `publiclyVisiblePublicationStatuses()` **value set**, so the
two gates can never disagree about which statuses are public.

**This is not a Rule 1 violation, although it looks like one.** `none` is still a finding backed by
a read — the **vehicle** read, whose `publication_status` this block consults. A listing that is not
published has no published photographs; that follows from the publication state alone. Rule 1
forbids asserting a negative you did not check. It does not require checking a table that could not
change the answer.

**Evidence is deliberately NOT gated by this rule.** A verified registration document is a fact
about the **car** and stays true whether or not anyone is advertising it. That is why
`listingAudience` + `listingPublicationStatus` are separate parameters from the evidence `audience`
— see Rule 7. One parameter serving both would make the conflation a one-character mistake.

**The gate defaults closed.** A caller naming neither `listingPublicationStatus` nor
`listingAudience` gets `not_loaded`: a future read path that forgets the gate shows an empty gallery
in development rather than leaking an unpublished one in production.

### Rule 2 — the two empty states are different sentences
```
listing_media     "No photos are published for this listing."
verified_evidence "No verified evidence has been published for this vehicle."
```
Exported as constants so a surface imports the wording instead of authoring its own. *"No verified
images uploaded yet"* was authored in a `.tsx` file — which is exactly how a marketing gallery came
to publish a governance finding.

**The listing sentence changed this round, and an earlier revision of this table still carried the
retired one.** It was *"No photos have been added to this listing."* Rule 1b is the immediate
reason — two sentences, one per case, would **be** the enumeration leak, so the wording had to
change for **every** caller and not just for the gated one. But it was already false in a second,
older case that has nothing to do with the gate: a listing whose every row is unpublishable reaches
`state: 'none'` with `unpublishable_count > 0`, and "nobody added a photo" is exactly what did not
happen there.

The new wording asserts only what this contract itself **did** — it published none — and nothing
about what the seller did or what the table holds. That is what makes it true of all three cases at
once, and being true of all three is what makes them indistinguishable.

### Rule 3 — listing media makes no verification claim, and cannot
Not taste: `listing_images` holds nothing a verification claim could be built from. Any trust word
next to a listing photo is authored by the renderer and asserted on the seller's behalf.
`findTrustLanguage()` scans everything the listing block authors — **keys included** — against a
stem vocabulary (`verif`, `evidence`, `trust`, `certif`, `authentic`, `proof`, `inspect`, …).

It deliberately **skips the `url` value**. That string is the seller's; a photo filed as
`verified-dealer-stock.jpg` is not this contract making a claim. We govern what *we* say.

Corollary: `listing_images.created_at` is **not published**. It is the row's INSERT time, and a date
beside a photo reads as when the photo was taken. Evidence has `captured_at` for that, behind a
review; listing media has no equivalent and does not borrow one.

### Rule 4 — evidence keeps Phase 0's allow-list, unforked
Items are built by `toPublicEvidence` (imported, not restated). `uploaded_by`, `verified_by`,
`tenant_id`, `source_id`, `file_path`, `storage_bucket`, `verification_notes`, `metadata` and the
registry identifiers stay out **for every audience**.

`audience: 'owner'` widens **which rows**, never **which fields**.

### Rule 5 — URL honesty
A media URL here is **an unvalidated string someone recorded**. `url_form` describes the **string**:

| form | meaning |
|---|---|
| `absolute_https` | begins `https://` — resolves independent of the viewing page |
| `absolute_http` | begins `http://` — published and flagged; blocked as mixed content on https |
| `protocol_relative` | begins `//` — **looks** site-relative, host is foreign, only the scheme is inherited |
| `site_relative` | single leading `/` — resolves against the **viewing origin**, which differs between `carup.dev`, a preview deploy and localhost |

Nothing asserts the asset exists, is an image, is reachable, or depicts this vehicle.
**Never signed** — no token, no expiry; a consumer may not treat any URL here as access-controlled.

Anything else (`data:`, `blob:`, `javascript:`, a bare `photo.jpg`, blank, non-string) is
**unpublishable** — and is **counted, not silently dropped**. Silent dropping is the same lie as the
sentence in Rule 1, one layer down.

### Rule 6 — primacy is the seller's choice or it does not exist
`is_primary: true` only when a row says so. When nobody claims it, **no item is primary**; the
projection does not elect one. Several claimants ⇒ the first in sort order keeps it, the rest are
demoted. Ordering (`position`, dense from 0) and primacy are different facts.

**No `primary_url` mirror *inside the block*.** The primary is `items.find(i => i.is_primary)`. One
fact lives in one place — Phase 4's `plate_status` answered one question twice in one body, with two
different answers.

**The marketplace list card is the one deliberate exception, and it is a projection of this block
rather than a second opinion on it.** `buildMarketplaceListingSummary` keeps `primary_image_url` for
its existing consumers — four surfaces put it straight into an `<img src>` (`Marketplace.tsx`,
`VehicleSearch.tsx`, `dashboard/owner/SavedCars.tsx`, `MarketplaceCompare.tsx`) and deleting the key
would blank every card. `electPrimaryImage` derives it from `toListingMediaBlock(imageRows).items[0]`
— same sort, same primacy arbitration, same publishability gate — and publishes two companions that
keep the key honest:

| key | meaning |
|---|---|
| `primary_image_state` | `seller_primary` (a row claims it) · `first_published` (nobody claimed; merely the first publishable photo in display order) · `none` · `not_loaded` |
| `primary_image_unpublishable_count` | without it, "three photos we could not render" and "the seller added none" would both read as `none` with a null URL — Rule 5's silent drop, one layer up |

A card key named `primary` asserting a choice nobody made is exactly the fabrication this rule
forbids; the fact is **labelled**, not withdrawn.


### Rule 6b — every published listing item carries a stable opaque identity

`media_id` is **`listing_images.id`** — the row's own primary key, `uuid NOT NULL DEFAULT
gen_random_uuid()`, measured v4 (random) on 3 of 3 staging rows.

**Why identity and not URL equality.** `position` addresses a *slot*; `media_id` addresses a
*photograph*. Comparing rendered URL strings across surfaces is the weaker proof and it fails in
both directions: a URL may be rewritten by a CDN, an origin swap, a signature or a resize suffix and
still be the same picture, while two different pictures may collide on one site-relative path —
there is no unique index and no CHECK on `listing_images.image_url`, and 3 of 3 staging rows are
exactly such paths. `position` is worse: it changes whenever a sibling row moves and is `0` on the
first photo of every vehicle.

**Stability is the claim.** The value is *stored* at insert and read back, never recomputed from
content, position or ordering. The same row therefore yields the same identity across independent
projections, across re-orderings, and alongside different siblings.

**It is not a widening in kind.** `PUBLIC_EVIDENCE_FIELDS` has published `id` as its first field
since Phase 0, so an opaque media-row identifier is an already-accepted class of public fact. The
gallery simply did not have one; the asymmetry was the anomaly. Recorded in
`ADR-002-public-column-widening.md`, which also records the narrower sense in which the *column* is
new to the public surface.

**It is `media_id`, not `id`, because of Rule 7.** The evidence item already carries `id`. One key
name on both item shapes would collapse the disjointness proof.

**What it may never be.** An opaque row identifier and nothing else — never a storage path, bucket
name, object key, uploader id or tenant id. Enforced **mechanically**: `toMediaIdentity` publishes
only values matching the anchored canonical UUID grammar, so a path, a bucket name, a filename, or
even a uuid *with* an extension cannot be published as an identity. There is in any case no private
locator on the row to leak — `listing_images` is
`(id, vin, image_url, is_primary, display_order, created_at)` and carries no bucket, path, uploader
or tenant column at all, while `image_url` is already published beside the identity.

**No identity, no publication — and it is counted.** A row whose `id` is missing, malformed or
already used is treated exactly as an unrenderable URL is: excluded from `items` and recorded in
`unpublishable_count`, never silently dropped. An item published with a `null` or duplicated
identity is worse than an absent one, because a consumer keying a gallery, a cache or a selection on
it would silently conflate two photographs — the precise failure the identity exists to prevent. A
repeated identity resolves first-occurrence-wins, deterministically and independently of sort order.

**Case is normalised down**, so one row compares equal with `===` however a server serialised it.

**On the client.** `web/src/pages/VehicleDetail.tsx` re-validates the wire value through the same
grammar rather than trusting it, re-arbitrates uniqueness and primacy off the wire, and keys the
thumbnail list on `media_id`. Keyed on `position`, React reuses a thumbnail's DOM node and decoded
bitmap for a *different* photograph whenever the payload re-orders — which is how a gallery briefly
shows the wrong car.

**One deliberate divergence between the two implementations, recorded so the mirror is not
over-read.** The **server** block treats an identity-less row as unpublishable and emits no item,
because it reads `listing_images` where `id` is a stored `NOT NULL` uuid and its absence means the
row is malformed. The **client** reads a *wire payload*, where a server predating the widened
contract legitimately carries no identity on **any** entry; dropping those photos would blank the
gallery of every such vehicle — the original defect, re-entered through the identity door. So on the
client a `null` identity is published (and the `data-media-id` attribute is simply absent), while a
`null` identity is exempt from the duplicate check — only a name that was actually carried can be
claimed twice. A photograph we cannot name is still a photograph the seller added; only the ability
to name it is missing, and the page says which.

The marketplace transport **now carries the identity too.** An earlier revision of this section said
it did not — that `marketplaceListingDetailService` mapped rows to `{url, type, is_primary}`,
dropped `id`, and so that path always published `media_id: null`. That was true when written and is
**no longer true**: the service derives its media from the same `toListingMediaBlock` projection and
publishes `media_id` on both `listing_media.items[]` and the `media[]` compatibility view, and the
client re-validates it through `toMediaIdentity` rather than hardcoding `null`.

`media_id: null` remains reachable **on the client only**, and remains correct there — it is what
`toMediaIdentity` produces when the value it is handed falls outside the anchored UUID grammar,
including a payload from a server predating the widened compatibility view. `null` is the truthful
answer for that case; an index-derived value would manufacture the instability this field replaces.
No **server** projection can emit it: `toListingMediaBlock` counts such a row as unpublishable and
publishes no item, so every `media_id` on the wire from this repository is a real uuid or the item
is not there. The two behaviours are the deliberate divergence recorded above, not a disagreement.

### Rule 7 — the blocks are disjoint by construction
A `listing_images` row has `image_url` and no status columns; a `vehicle_evidence` row has
`file_url` and no `image_url`. Feed either to the wrong projector and it publishes nothing — no
throw, no special case, just the ordinary gates.

**The same URL may legitimately appear in both blocks.** A file can be a marketing photo *and*,
separately, a reviewed artifact. Provenance travels with the **item**, not the string.
Deduplicating across blocks would delete one of two real claims.

### Rule 8 — `dealer_listing` evidence is evidence *about an advertisement*
The taxonomy already contains the trap: `evidence_type` permits `dealer_listing_photo` and
`evidence_class_taxonomy` carries class `dealer_listing` with subtypes `listing_photograph`,
`advertised_mileage`, `advertised_condition`.

Such a row **stays in the evidence block** — it is governed. But `verification_status: 'verified'`
on it attests **that this was the advertised photo**, not anything about the vehicle. It is likewise
**never copied into the gallery**: that block is the seller's *current* presentation, and a captured
historical advertisement is not that.

---

## 4. The defect, AS IT STOOD AT BASE COMMIT `3adb95e4` — history, not a live report

> **Anchor and tense.** Every line reference in this section and in §5 resolves against
> `git show 3adb95e4:<file>` and **against nothing else**. An earlier revision titled this section
> *"verified still reproducing at `3adb95e4`"* and left it in the present tense; the change-set that
> ships with this document is the fix, so a reader taking it as a live report was being told this
> repository is in a state it has not been in since `vehicleMediaProjection.js` was added. Retained
> rather than deleted, because the mechanism is the reason for every rule above it.
>
> Two of the anchors below were also wrong *at the base commit itself* and are corrected here — see
> the correction note at the end of the section. Against the **current working tree** none of them
> resolve, and that is expected: `VehicleDetail.tsx` grew by 842 lines (+916/−74) and `server.js` by
> 242 (+252/−10) in
> this change-set. §8 records what this programme now does about line anchors generally.

Marketplace served a card image for a VIN while Vehicle Detail said *"No verified images uploaded
yet"* for the same VIN.

1. `VehicleDetail.tsx:634-657` called `lookupVehiclePassport` **first** and **returned early** on
   success (`setLoading(false); return`) — no marketplace-detail merge ever ran.
2. It hydrated the gallery from `d.images` (`:645`). The passport body had **no `images` key and no
   `media` key**: `buildVehiclePassport` (`backend/server.js:734-1142`) projects through
   `PUBLIC_VEHICLE_FIELDS`, which names no image column, and `vehicles` **has** no image column.
3. `listing_images` is a separate table and the passport path **never read it**. The only two
   readers in the repository were `listingSummaryService.fetchListingRelatedRows:892` and, through
   it, `marketplaceListingDetailService:167` — both marketplace-only.
4. `d.images` was `undefined` ⇒ `images: []` ⇒ `hasRealImages === false` (`:883-887`) ⇒ the
   placeholder at `:1108` fired.

**The sentence is the second defect and the worse one.** Even with the gallery correctly hydrated,
*"No verified images uploaded yet"* would be false in the other direction: three unverified seller
photos would appear under a control that had just made a claim about verification. Fixing only the
plumbing would have left it in place. That is why this phase changes the sentence, not just the wire.

**There are now THREE readers of `listing_images`, not two**, and point 3 above is the reason: the
passport gained the read it lacked. Measured by `.from('listing_images')` across the current tree —
`listingSummaryService.readListingImages` (batched, reached by four marketplace consumers through
`fetchListingRelatedRows`), `marketplaceListingDetailService` (consumes the same rows, no query of
its own), and `buildVehiclePassport`. The passport is the only one that is **not** marketplace-only,
which is precisely why it is the only one that needs Rule 1b: the four marketplace consumers either
run `filterVisibleVehicles` before any row is projected, or (moderation, and listing-detail's admin
audience) see unpublished listings deliberately behind `assertModerator`. There is also a **write**
path, `POST /api/vehicles/add`.

> **Correction to two anchors, measured against `3adb95e4` itself.** `buildVehiclePassport` was
> cited as `server.js:727-1099`. The function actually spans **734–1142** there (`727` is mid-way
> through the header comment; `1099` is inside the return body). The other four anchors — `:634-657`,
> `:645`, `:883-887`, `:1108` — were verified correct at that commit and are unchanged.

---

## 5. What the audit found that the brief got wrong — AS IT STOOD AT BASE COMMIT `3adb95e4`

> **Same anchor and same tense as §4: this is the audit *as it was taken*, not a description of the
> tree this document ships with.** Every item now carries an explicit **status line** giving its
> disposition at the current tree, verified against the code or a read-only staging query rather
> than against another document. Four of the eight items moved this round, and one of them
> (§5.4) was simply **wrong when written**.

| Brief said | Live schema / data says |
|---|---|
| "`listing_images` has **no foreign key** to vehicles (keyed by a free vin string)" | **False.** `listing_images_vin_fkey FOREIGN KEY (vin) REFERENCES vehicles(vin) ON DELETE CASCADE` exists on staging, from `012_storage_and_media_schema.sql`. `vehicle_evidence` carries **two** FKs to `vehicles(vin)` — `vin` and `vehicle_id`, both `ON DELETE CASCADE`. Referential integrity is not the problem; **nobody joins it** is the problem. |
| Implied that fixing the join makes Detail agree with Marketplace | Only for 3 of 16 VINs, and it would leave the false sentence in place. See §4. |

Further, and not in the brief at all:

1. **The two models are perfectly disjoint on staging today.** 3 VINs carry a listing image and
   **zero** evidence; 1 VIN (`WBA8E9C50HK000732`) carries 1 verified evidence row and **zero**
   listing images; the other 12 carry neither. **Not one of the 16 has both.** Any convergence work
   that only tests "photos and evidence together" tests a case that does not exist on staging.
   The inverse defect is real and unnamed: for the evidence VIN, the Marketplace card shows **no**
   image while the passport carries a verified artifact.

   > **Status: UNCHANGED, re-measured read-only on `eoyenigwevnxwwhyhaer` this round.** 16 vehicles,
   > 3 `listing_images` rows across 3 VINs, 1 `vehicle_evidence` row on `WBA8E9C50HK000732`,
   > `vins_with_both = 0`. Also measured this round and material to Rule 1b: of the 3 image-bearing
   > VINs, **`WBA8E9C50JNUAT202` is `publication_status = 'draft'`** — a draft listing holding a
   > photograph, i.e. the gated case is live data and not a hypothetical.

2. **All 3 listing images are dangling site-relative paths.**
   `/uat/owner/subaru-impreza.svg`, `/uat/owner/toyota-corolla.svg`, `/uat/owner/bmw-320i.svg`.
   No `web/public/uat/` directory exists, **no code in the repository writes those strings**, and
   all three rows share one insert timestamp — placed directly into staging by a UAT script that is
   not in this tree. They render as **broken images**, not as the placeholder, because
   `ListingImage` branches on `src` being truthy and a dangling path is truthy.

   > **Status: UNCHANGED, re-verified.** All three rows carry `created_at`
   > `2026-08-16 22:52:25.977933+00`; `web/public/` holds only `favicon.ico`, `favicon.svg`,
   > `images/` and `sw.js`; the only occurrences of `uat/owner` in the repository are documentation
   > and test fixtures. `ListingImage.tsx` still branches on `if (src)`.

3. **The listing-image write path validates nothing.** `backend/server.js:2062-2074` stores
   `image_url: url` verbatim from the request body — no scheme check, no host check, no length
   check. Failures are `console.error`'d and the request still returns `201`.

   > **Status: CLOSED in this change-set — every clause of the item above is now false of the
   > tree.** The `:2062-2074` anchor no longer points at the write path at all: at the current tree
   > those lines are the request-body destructuring near the top of the same handler, ~200 lines
   > above the media block. Verified against `backend/server.js` in `POST /api/vehicles/add`, not
   > against another document:
   >
   > | the item said | the tree now does |
   > |---|---|
   > | `image_url: url` stored verbatim | `submittedMedia.filter((entry) => isPublishableMediaUrl(entry.url))` — an unpublishable URL is **refused at the door**, and `isPublishableMediaUrl` is **imported from this contract's module**, not restated, so writer and reader share one definition |
   > | no record of what was refused | `images_unpublishable_count` on the 201 body |
   > | `is_primary: idx === 0` (fabricated) | `is_primary: entry.claimsPrimary` — the seller's own claim, or nothing (Rule 6 at the layer that was breaking it) |
   > | failure `console.error`'d, `201` with `success: true` regardless | still logged **and** reported: `images_recorded`, `images_recorded_count`, `images_unpublishable_count`, `images_primary_recorded` |
   >
   > Four keys rather than one summary because none is derivable from another: a seller who sent
   > five photos and had one stored, or who chose a main photo whose URL was then refused, learns it
   > at the moment it happens. `images_recorded: false` covers both "none submitted" and "the insert
   > failed" — exactly as `location_recorded` already treated that pair in this same handler.
   >
   > **Refused and counted, not rejected wholesale.** A bad photo URL does not void a real listing;
   > `400`-ing the whole request would discard the vehicle too. What remains open is F1a in
   > `DELETION_LEDGER.md` §2 — the column has no storage-side CHECK, so the *database* still accepts
   > anything the route lets through. That is §6 item 3, and it is a Phase 6 candidate.

4. **`listing_images` has RLS enabled and ZERO policies** — deny-all to `anon` and `authenticated`,
   readable only by `service_role`, which bypasses RLS. Today's backend uses the service key so
   nothing is broken. `vehicle_documents` is in the same state. By contrast `vehicle_evidence` has
   4 policies, including an `anon` SELECT gated on `public_safe AND verified` — the same gate this
   contract applies in code.

   > **Status: CORRECTED — this item was WRONG WHEN WRITTEN, and the error was the one that
   > matters.** It claimed a direct-from-browser read "returns an **empty set with no error**". It
   > does not. Re-measured read-only on `eoyenigwevnxwwhyhaer` this round:
   >
   > ```
   > has_table_privilege('anon',          'public.listing_images', 'SELECT')  ->  false
   > has_table_privilege('authenticated', 'public.listing_images', 'SELECT')  ->  false
   > rows for anon/authenticated in information_schema.role_table_grants      ->  0
   >
   > SET LOCAL ROLE anon;          SELECT count(*) FROM public.listing_images;
   >   ERROR:  42501: permission denied for table listing_images
   >   HINT:   Grant the required privileges to the current role with:
   >           GRANT SELECT ON public.listing_images TO anon;
   > SET LOCAL ROLE authenticated; SELECT count(*) FROM public.listing_images;
   >   ERROR:  42501: permission denied for table listing_images
   > ```
   >
   > **There is no GRANT, so the privilege check fails first and RLS is never reached.** RLS with
   > zero policies is a *second* lock, not the operative one. `vehicle_documents` measures
   > identically. `vehicle_evidence` is the contrast that proves the distinction is real rather than
   > pedantic: it **has** the grant and 4 policies, so the identical anon read returns a **filtered
   > set** (measured: 1 row) with no error. Grant-then-filter and no-grant-at-all are different
   > mechanisms with different failure modes, and only one of them is silent.
   >
   > **Why the correction is load-bearing rather than pedantic.** A silent empty set *is* the defect
   > this contract exists to close; a raised error is a read that never happened, which `not_loaded`
   > represents honestly. Getting this backwards in the governing contract while
   > `RLS_AUDIT.md` stated it correctly is a two-documents-one-fact disagreement of exactly the kind
   > this programme treats. **`RLS_AUDIT.md` § "Addendum — the listing-media tables" is the
   > authority; this item now agrees with it.** See also §6.1.

5. **The one evidence row's file is dangling by two independent routes.** `file_url` is
   `https://staging.carup.local/qa/evidence-73.jpg` (host does not resolve) **and** its
   `storage_bucket`/`file_path` name `vehicle-images/qa/evidence-73.jpg` while `storage.objects`
   holds **zero** rows for that bucket. The bucket exists and is public; it is empty.

   > **Status: UNCHANGED, re-verified read-only this round** — same `file_url`, same
   > `vehicle-images` / `qa/evidence-73.jpg`, `storage.objects` still holds 0 rows for that bucket.

6. **`vehicle_documents` is a dormant third media concept.** Logbook / insurance / customs / police
   clearance, with its own `verification_status` and `uploaded_by` — written and read by **nothing**
   in the repository, 0 rows. If activated it is **evidence**, not listing media.

   > **Status: UNCHANGED, re-verified.** 0 rows; the only occurrences of `vehicle_documents` in
   > `backend/`, `web/src`, `mobile/` and `shared/` are this contract's own commentary and the CI
   > guard in `issue164-phase5-marketplace-convergence.test.js` that refuses a browser-role GRANT on
   > it. No query reads or writes it.

7. **Marketplace elects a primary nobody chose.** `buildMarketplaceListingSummary:525-528` takes
   `sorted[0]` as `primary_image_url` regardless of whether any row claims `is_primary`, and no
   partial unique index enforces one primary per VIN. Recorded, not changed — that is a read path.

   > **Status: CLOSED in code, OPEN in data. The final clause — "recorded, not changed" — is no
   > longer true**, because "that is a read path" stopped being a reason to defer once this phase
   > took on the read paths (see the corrected note at the top of this document).
   >
   > `[...imageRows].sort(...)[0]?.image_url || null` at `listingSummaryService.js:525-528` (base
   > `3adb95e4`) was **deleted** and replaced by `electPrimaryImage`, which sources `items[0]` from
   > `toListingMediaBlock`. The **election is deliberately unchanged** — the canonical block already
   > sorts primary-claimants first, then `display_order`, then input order, so it picks the same row
   > and no card is blanked. What is new is the publishability gate and the label:
   > **`primary_image_state`** is published beside the URL (`seller_primary` / `first_published` /
   > `none` / `not_loaded`), together with `primary_image_unpublishable_count`. See Rule 6.
   >
   > **Still open, and stated so it is not over-claimed:** (a) there is still no partial unique index
   > `ON listing_images (vin) WHERE is_primary` — the table carries only `listing_images_pkey`, the
   > `vin` FK and two non-unique btree indexes — so Rule 6's demotion path is *handled*, not
   > *unreachable*; (b) all **3 of 3** staging rows carry `is_primary = true` at `display_order = 0`,
   > so all three publish `seller_primary` on a claim no seller made. Those rows share one
   > microsecond-identical `created_at` and one `xmin`, so they were **seeded**, not written by the
   > fabricating route — the debt is the same shape, but repairing it is a UAT-fixture decision.
   > Recorded in `PUBLIC_API_INVENTORY.md` §12; no migration is authored, because it is data repair.

8. **`evidence_class = 'dealer_listing'` already exists in the taxonomy**, so the conflation this
   phase forbids has a schema-sanctioned lane. See Rule 8.

   > **Status: UNCHANGED.** Taxonomy fact, untouched by this change-set.

---

## 6. Cutover candidates (authored by nobody yet — recorded for the single guarded migration)

None of these is required for the contract to be consumed; they are recorded so the Phase 6
migration lane can decide.

### 6.1 An `anon` SELECT policy on `listing_images` — **REJECTED, not a candidate**

> **CORRECTED THIS ROUND.** This item previously read: *"RLS SELECT policy on `listing_images` for
> `anon` (listing media is public by definition), or an explicit decision that it stays
> service-role-only."* It **recommended the grant**, in a parenthesis, as the leading option. That
> is the exact change `RLS_AUDIT.md` identifies as the residual **risk** — the one that "converts the
> loud 42501 into exactly the silent empty set this contract was opened to eliminate."
>
> Two Phase 5 documents disagreeing about one measured fact is the disease this programme treats, so
> the disagreement is resolved rather than softened. **`RLS_AUDIT.md` is the correct one**, and it is
> correct on the measurement (§5.4 above, re-verified independently this round): there is no grant,
> the failure is a loud `42501`, and adding `GRANT SELECT … TO anon` **without a policy in the same
> migration** would make the read return an empty set silently.

**The disposition is: it stays service-role-only, and no migration is authored.** The reasoning:

1. **This is not a gap; it is an applied control.** RLS-enabled + zero policies + revoked grants is
   the end state of `20260619201406_production_access_containment.sql`, which covers eleven tables
   including this one. It is the same disposition `RLS_AUDIT.md` records for the Phase 0 cohort:
   *revoke + enable, no policies.* Authoring a migration to "fix" an already-correct, already-applied
   control would put a no-op in the single guarded Phase 6 cutover and dilute it.
2. **"Listing media is public by definition" was the false premise.** Listing media is public
   *through a governed read path* that applies Rule 1b — the publication gate. A blanket `anon`
   SELECT on the table is a **wider** disclosure than the contract itself grants: it would expose an
   unpublished listing's photographs to any browser holding the publishable key, which is the leak
   Rule 1b exists to close, reached one layer below the code that closes it.
3. **A self-scoped policy would match nobody today.** CarUp runs custom backend auth and mints no
   Supabase JWT, so every browser request arrives as `anon` and `auth.uid()` is null. An
   `auth.uid()`-gated policy would read as protection in the catalog while governing zero callers —
   worse than no policy, because it reads as done. (`RLS_AUDIT.md`, "Accepted finding".)

**The residual risk is a future engineer following the hint PostgreSQL prints inside the error
itself.** That is guarded in CI rather than by a note:
`backend/tests/issue164-phase5-marketplace-convergence.test.js` suite 8 refuses any migration
granting `listing_images` / `vehicle_documents` to a browser role, and refuses any client-side
`.from()` query of either. **If a browser-direct read is ever genuinely wanted, the grant and a
matching SELECT policy must land in the same migration**, with an entry in `RLS_AUDIT.md`.

### 6.2 Genuine candidates

1. Partial unique index `ON listing_images (vin) WHERE is_primary` — makes Rule 6's demotion
   unreachable rather than merely handled. (Verified absent: the table carries only
   `listing_images_pkey`, the `vin` FK, and two non-unique btree indexes.)
2. A CHECK constraint on `listing_images.image_url` matching the publishable forms. The **route** now
   refuses unpublishable URLs (§5.3), but the **column** still accepts anything, so this closes
   F1a rather than duplicating a control that already exists.
3. Repointing or removing the fake `staging.carup.local` evidence URL and the three `/uat/owner/*`
   paths, and the three fabricated `is_primary = true` flags — **data repair, not schema**, and a
   UAT-fixture decision rather than a migration.

---

## 7. Test evidence

Re-measured at the current tree on the exact commands in §7.1. Earlier revisions recorded 63/9 and
52, then 77/10 and 71; the later Phase 5 lanes overtook both, and this section has now been wrong
twice by lagging behind rather than by being fabricated — which is why the commands are recorded
beside the numbers.

| suite | tests | suites | fail |
|---|---:|---:|---:|
| `backend/tests/issue164-phase5-media-contract.test.js` | **77** | 10 | 0 |
| `backend/tests/issue164-phase5-passport-media-wiring.test.js` | **21** | 6 | 0 |
| `backend/tests/issue164-phase5-media-identity-containment.test.js` | **19** | 6 | 0 |
| `backend/tests/issue164-phase5-listing-publication-gate.test.js` (Rule 1b) | **35** | 8 | 0 |
| `backend/tests/issue164-phase5-marketplace-convergence.test.js` | **35** | 8 | 0 |
| `web/src/pages/VehicleDetail.media.test.tsx` | **87** | — | 0 |

**A note on the one failure this table used to carry — now CLOSED.** For part of the close-out,
*restates the contract's empty statement EXACTLY (this is the anti-drift pin)* failed, because
`web/e2e/vehicle-detail.spec.ts` still held the retired literal
`'No photos have been added to this listing.'` while `LISTING_MEDIA_EMPTY_STATEMENT` had moved to
`'No photos are published for this listing.'` (Rule 2). **That is the anti-drift pin working exactly
as designed** — it caught a sentence the backend had retired still being asserted against the
browser, across a directory boundary that neither the type-checker nor the bundler crosses. Three
lanes each correctly declined to edit `web/e2e/**` as another lane's file, so the one-line fix went
unowned for a full round; the lead closed it. Full backend gate now: **3896 tests, 3884 pass,
0 fail, 12 skipped, exit 0.**

The backend commands **require the CI environment**, without which the suite does not fail honestly;
it fails for the wrong reason.

### 7.1 The commands these numbers come from

```
# backend — NODE_ENV=test AND ALLOW_OCR_MOCK=true are BOTH required (see below)
NODE_ENV=test SUPABASE_URL=http://localhost:54321 \
SUPABASE_SERVICE_ROLE_KEY=test-service-role-key SUPABASE_ANON_KEY=test-anon-key \
JWT_SECRET=test-jwt-secret ALLOW_OCR_MOCK=true \
  node --test backend/tests/issue164-phase5-media-contract.test.js

# web — cwd MUST be web/, because src/lib/service-worker.test.ts resolves
# process.cwd() + "public/sw.js"
cd web && npx vitest run src/pages/VehicleDetail.media.test.tsx
```

The environment block is not optional decoration. `backend/db/supabase.js` throws on import when
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are absent, which takes whole test FILES down at module
load, and `GeminiClient.js` / `documentClassifier.js` gate their mock on
`NODE_ENV === 'test' && ALLOW_OCR_MOCK === 'true'` — a deliberate guard so mock OCR can never be
reachable in production. Running the suite without these does not measure this contract; it measures
the absence of the environment. See `PUBLIC_API_INVENTORY.md` §13.

Fixtures are the rows staging actually holds, copied from a read-only query, so the positive
assertions are about real shapes and the URL forms are the live forms.

Anti-vacuity: four controls. The trust-language scanner is run against a planted violation and must
flag exactly it (and must **not** flag a seller filename); the cross-contamination detector is run
against a deliberately contaminated payload and must catch **both** directions; the declared field
lists are asserted non-trivial in size; and the staging fixtures are asserted to produce **items**,
not empty blocks.

Mutation-verified — each of these was applied to the module and the suite failed:

| mutation | tests failed |
|---|---|
| `not_loaded` collapsed into `none` | 2 |
| evidence item spreads the raw row | 6 |
| the shipped sentence reinstated as the listing empty statement | 2 |
| evidence audience gate removed | 4 |


### The wiring gap that the first Phase 5 pass left open

An independent certifier rejected the first Phase 5 submission on one item: **the mutation kill
table**. Three mutations survived the entire backend suite (3749 tests, 0 deaths each):

| mutation | before | after |
|---|---|---|
| **M1** delete the `listing_images` read from `buildVehiclePassport` | survived | **5 dead** |
| **M2** delete the `...(vehicleMedia ?? {})` spread from the body | survived | **5 dead** |
| **M3** routes stop passing `toVehicleMedia` as the 6th argument | survived | **1 dead** |

The cause was structural, not an oversight of care: `toVehicleMedia` appeared in exactly one test
file, which exercised the **module** and never `buildVehiclePassport`. All four passport-executing
suites call the builder with ≤ 5 arguments, so `mediaContract` defaulted to `null` and they asserted
the *unwired* shape — correctly, for what they were testing. The fix for the defect that names this
phase was therefore untested at the layer where it lives, and a silent revert would have reopened the
original defect invisibly.

That is material rather than academic: for a VIN with `listing_images` rows but **no public
marketplace listing**, the passport is the only transport — marketplace detail 404s — so an unwired
passport is an empty gallery with no fallback.

Closed by suite 9, which executes the **shipped** `buildVehiclePassport` source against stub
collaborators with the 6th argument supplied. The supabase stub **honours `.select()`**, projecting
each row to exactly the named columns as PostgREST does, so a narrowed query fails behaviourally
rather than only textually.

### Stable-identity mutations

Each was applied, the named tests below went red, and the file was restored byte-identically
(verified with `git diff`).

| # | mutation | named tests failed |
|---|---|---|
| **I1** | drop `media_id` from the published item | **10** — incl. *publishes media_id on EVERY published item*, *carries the ROW id not a value derived from order or position*, *SYMMETRY: both item shapes now carry an identity* |
| **I2** | make the identity index-derived (`position`) | **8** — incl. *is STABLE UNDER RE-ORDERING*, *is STABLE when the row is read alongside different siblings* |
| **I3** | make the identity collide across items (constant) | **8** — incl. *is DISTINCT per item — the identities never collide within a block* |
| **I4** | remove the UUID grammar guard from `toMediaIdentity` | **2** — *NEVER publishes a private locator as an identity*, *treats a row with NO usable identity as unpublishable, and COUNTS it* |
| **I5** | `server.js` stops selecting `id` | **4** — incl. *M1/M2 GUARD: reads listing_images and publishes it as listing_media with real identities* |
| **W1** | client drops `media_id` from the passport transport | **5** — incl. *renders the identity of the photograph on screen*, *is STABLE across two independent renders of the same row* |
| **W2** | client trusts the wire (no grammar re-validation) | **3** — incl. *REFUSES a private locator in the media_id slot* |
| **W3** | gallery keyed on the slot instead of the identity | **1** — *keys the gallery on the identity, not on the slot* |

Note that **I2 and I3 fail different tests**, which is the point: a colliding identity is still a
valid uuid and still distinct-per-*position*, so only the stability assertions catch I2 and only the
distinctness assertion catches I3. Each guarantee is measured by its own test rather than by one
test standing in for all of them.

### An existing test corrected, not weakened

Two pre-existing assertions asserted something that became false and were **corrected to assert the
true thing**:

1. `backend/tests/issue164-phase5-media-contract.test.js` — nine ad-hoc listing-row fixtures were
   written as bare `{ image_url, is_primary, display_order }` literals, a shape the source table
   never produces (`id` is the NOT NULL primary key). Once identity became a publication
   requirement those literals were unpublishable, which would have quietly turned tests about
   *ordering* and *primacy* into tests about *empty blocks*. They now go through a `listingRow()`
   helper that mints a distinct sequential uuid. **No assertion was relaxed** — only the fixtures
   became faithful to the schema.
2. `web/src/pages/VehicleDetail.media.test.tsx` — the disjointness test hardcoded
   `['url', 'url_form', 'position', 'is_primary']`, so the page's item shape could drift from the
   contract's without failing anything. It now reads `LISTING_MEDIA_ITEM_FIELDS` out of the backend
   contract, which is **stricter** than before, and additionally asserts that the listing shape
   contains `media_id` and does *not* contain `id`.

### 7.2 Anti-vacuity for the documentation pass itself

A document can be vacuous the same way a test can: by asserting a guarantee nothing enforces. Every
**status change** claimed in §5 and every **new guarantee** claimed in Rule 1b was therefore checked
by mutating the code it describes and requiring a **named** test to go red. Each mutation was applied
under a SHA-256 guard (`backend/**` is owned by concurrent lanes, so a foreign write during the run
aborts the restore rather than clobbering it), then restored and verified with `cmp` **and** a
matching pre/post checksum.

| # | claim under test | mutation | named tests failed |
|---|---|---|---:|
| **D1** | Rule 1b — the gated block is **non-enumerable** | the UNPUBLISHED branch stops calling `toListingMediaBlock(NO_ROWS)` and hand-builds a `none` block carrying `rows.length` as the count | **5** — *THE PROOF: a draft listing WITH photos and a published listing WITH NONE are byte-identical*, *holds for EVERY unpublished status, not just draft*, *the withheld count is ZERO even when the hidden rows include unpublishable ones*, *the gated block is the SAME COMPUTATION as an empty one, not a lookalike built beside it*, *a signed-in stranger is NOT entitled* |
| **D2** | §5.3 — unpublishable URLs are **refused at the door** | `submittedMedia.filter(isPublishableMediaUrl)` → `submittedMedia` | **4** — *B1b: a URL this contract will not publish is never stored*, *B1b: refused URLs are COUNTED to the caller, never silently discarded*, *B1b: display_order stays dense over the images that were actually stored*, *B1b: a listing whose photos are ALL unpublishable is still created, and says so* |
| **D3** | §5.7 — the truthy card-cover election is **gone** | `electPrimaryImage` reverts to the base commit's sort-filter-truthy election | **4** — *the LIST CARD cover image refuses every value the canonical contract refuses*, *one read feeds both surfaces*, *elects nothing at all when every row is unpublishable, and counts them*, *the card's cover is the canonical block's first item, always* |
| **D4** | §6.1 — the residual `GRANT` risk is **guarded in CI** | a temporary migration containing the literal hint PostgreSQL prints (`GRANT SELECT ON public.listing_images TO anon;`) | **1** — *no migration grants listing media to a browser role*. File deleted in the same command that created it; `git status --porcelain` verified byte-identical before and after |
| **D5** | §5.3 — the write path records the seller's primacy, it does not **fabricate** it | `is_primary: entry.claimsPrimary` → `is_primary: idx === 0` | **5** — *B1a: a request that expresses NO primacy writes NO primacy*, *B1a: the projection then reports first_published, and the DISPLAYED photo is unchanged*, *B1a: a primacy the seller REALLY expressed is recorded verbatim*, *B1a: only `is_primary === true` is a claim — truthy-ish values are not consent*, *the fabricating line is GONE from the shipped source* |

D3's run showed **5** failures, of which one is the pre-existing e2e-literal drift reported above and
is not attributed to the mutation. All five files restored byte-identically; `git status` at the end
of the pass is character-for-character what it was at the start.

**Note that D1 and D3 kill disjoint sets, and that is the point.** A gate that leaks a count is still
Rule-1 correct and still refuses the photographs; a permissive card election is still gated. Neither
mutation is caught by the other's tests, so each guarantee is measured by its own.

### 7.3 The blind spot this pass found in itself

Disclosed because the previous documentation lane's blind spot was *never opening §§4–6 of the file
that names itself the canonical contract*, and assuming one has no equivalent is how the next one is
kept.

**The first draft of the §11.2 correction in `PUBLIC_API_INVENTORY.md` simply refreshed the two stale
ordinals — `server.js:1244` → `:1299`.** That would have been *correct*, would have passed any review
that re-resolved it, and would have been **wrong again within hours**: those two anchors were
themselves written correct by the previous lane and invalidated by a sibling lane's edit **inside
this phase**, and both files are under concurrent edit right now. A fix whose correctness expires
before the PR merges is not a fix; it is the same defect with a fresher timestamp. That is what §8
below exists to prevent, and it was not in the brief — the brief asked only whether to fix the
anchors or scope them, which presumes refreshing them would work.

Recorded as a rule because line rot has now produced a documentation defect in **three** separate
Phase 5 documents, and because the mechanism is structural rather than careless.

**What was measured.** The `file:NNNN` anchors below were re-resolved this round:

| anchors | result |
|---|---|
| `MEDIA_EVIDENCE_CONTRACT.md` §4/§5, into `web/**` and `backend/server.js` | resolve at base `3adb95e4`, **all miss** at the working tree (`VehicleDetail.tsx` +916/−74, `server.js` +252/−10) |
| `PUBLIC_API_INVENTORY.md` §§1–10 — the eight `server.js` route registrations | **miss at `origin/main` by 10–38 lines and in the working tree by 44–836.** Written against branch commit `c662d1a4`, so these eight never resolved on main. Nothing is claimed here about the other 208 anchors in §§1–10; that population was not measured, and `PUBLIC_API_INVENTORY.md` §10b is the only place that scopes it. |
| `PUBLIC_API_INVENTORY.md` §11.2 — `server.js:1244`, `:1259` | resolved **exactly** when written **days ago**; now `1299` / `1314`, moved by a sibling lane's comment block *during this phase* |
| `DELETION_LEDGER.md` §2 F1 — `server.js:2154-2167` | resolve against **neither** base nor working tree (the block is `2062-2074` at base) |

## 8. Line anchors — cite the symbol, not the ordinal

Promoted to its own section because five documents cite `MEDIA_EVIDENCE_CONTRACT.md §8` as the
anchoring rule (`SELLER_LOCATION_CONTRACT.md`, `DELETION_LEDGER.md`, `PUBLIC_API_INVENTORY.md`,
`FACT_MODEL.md`, and §4 of this file). It was written as untitled prose inside §7.3, so every one of those citations
pointed at a section that did not exist — the same defect class §7.3 documents, committed by the
document that defines it. The evidence behind the rule is in §7.3 above.

Line numbers are a fine citation into a file that is not moving, and a liability into
one that is. Concretely:

1. **Prefer the symbol.** `buildVehiclePassport`, `electPrimaryImage`, `readListingImages`,
   `toGatedListingMediaBlock` — names survive edits; ordinals do not. A grep finds the symbol; a
   stale ordinal is checked once, believed, and then quoted onward.
2. **When a line anchor is genuinely needed** — because the claim is about *code as it stood* rather
   than about behaviour — **anchor it to a named commit and say so in the heading**, as §4 and §5
   now do. `git show <sha>:<file>` then makes the citation permanently checkable.
3. **Never anchor into a file another lane is editing concurrently.** `PUBLIC_API_INVENTORY.md`
   §11.2's two anchors were
   correct on the day they were written and were invalidated by a sibling lane, with no error on
   either side. That is not a mistake anyone can avoid by being careful; it is a property of the
   citation form.

**A precise-looking citation that resolves to the wrong line is worse than no citation.** It carries
the authority of a measurement and the content of a guess.
