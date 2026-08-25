/**
 * ===========================================================================================
 * THE CANONICAL VEHICLE MEDIA CONTRACT — Issue #164 Phase 5. THIS SHAPE IS FINAL.
 *
 * Vehicle Detail must compose two things that look alike and are not alike. This module is the
 * single place that says how, so the convergence stage wires read paths to a declared shape
 * instead of inventing one per surface.
 *
 *   {
 *     listing_media: {                              // marketing/presentation. UNVERIFIED.
 *       state:               'published'|'none'|'not_loaded',
 *       items:               [{ media_id, url, url_form, position, is_primary }],
 *       unpublishable_count: number,
 *       empty_statement:     string|null,
 *     },
 *     verified_evidence: {                          // governed proof. Reviewed.
 *       state:               'published'|'none'|'not_loaded',
 *       items:               [{ ...PUBLIC_EVIDENCE_FIELDS, file_url_form }],
 *       unpublishable_count: number,
 *       empty_statement:     string|null,
 *     },
 *   }
 *
 * The two BLOCK ENVELOPES are deliberately identical (a consumer reads both through one protocol).
 * The two ITEM SHAPES share NOT ONE KEY NAME, which is what makes "these can never be conflated"
 * an assertion a test can run rather than a convention a reviewer has to enforce by eye.
 *
 * ── THE DEFECT THIS EXISTS TO CLOSE ────────────────────────────────────────────────────────
 * Marketplace served a card image for a VIN while Vehicle Detail said "No verified images
 * uploaded yet" for the same VIN. THIS SECTION IS HISTORY, IN THE PAST TENSE, AND SAYS SO: the
 * paragraph below used to read "Verified still reproducing at this SHA", and that claim outlived
 * its own fix. This module IS the fix, so a file that describes the defect as live describes a
 * state this repository has not been in since the module was added. Corrected rather than deleted,
 * because the mechanism is the reason for every rule under it.
 *
 * As it stood before Phase 5:
 *
 *   · Vehicle Detail called `lookupVehiclePassport` FIRST and RETURNED EARLY on success, so no
 *     marketplace-detail merge ever ran.
 *   · It hydrated the gallery from `d.images`. The passport body had no `images` key and no `media`
 *     key: `buildVehiclePassport` projects the vehicle through `PUBLIC_VEHICLE_FIELDS`, which names
 *     no image column, and `vehicles` HAS no image column.
 *   · `listing_images` is a separate table and the passport path NEVER read it.
 *   · So `d.images` was `undefined` -> `images: []` -> the "no images" branch -> the placeholder.
 *
 * NO LINE ANCHORS INTO `web/**` APPEAR ABOVE, DELIBERATELY. The four this paragraph used to carry
 * (VehicleDetail.tsx:634-657, :645, :883-887, :1108) had all rotted onto unrelated lines — :634 is
 * a comment about Rule 8, :645 an `evidence_type` test, :883-887 trust-score parsing, :1108 a
 * loading flag — and the two identifiers they pointed at, `hasRealImages` and `d.images`, no longer
 * exist in that file at all. A precise-looking citation that resolves to the wrong line is worse
 * than no citation: it is checked once, believed, and then quoted. The mechanism is named instead,
 * because names survive edits and line numbers in a file two other lanes are editing do not.
 *
 * ── WHO READS `listing_images` NOW: THREE, NOT TWO ─────────────────────────────────────────
 * This paragraph used to say "the only two readers in the repository are
 * `listingSummaryService.fetchListingRelatedRows` and, through it, `marketplaceListingDetailService`
 * — both marketplace-only". That was true before this module and false after it, and it was false
 * BECAUSE OF this module: closing the defect above meant giving the passport the read it lacked.
 * A contract file that under-counts its own readers under-states its own blast radius. Measured by
 * `.from('listing_images')` over the repository at this SHA:
 *
 *   READS
 *     1. `listingSummaryService.readListingImages` — batched `.in('vin', vins)`, wrapped so a
 *        thrown query returns `{ ok: false, rows: null }` rather than `[]`. Reached by FOUR
 *        marketplace consumers through `fetchListingRelatedRows`: discovery, moderation, saved and
 *        listing-detail. (The old note named the last of those as if it were the only one.)
 *     2. `marketplaceListingDetailService` — no query of its own; it consumes (1) and calls
 *        `toListingMediaBlock`.
 *     3. `buildVehiclePassport` (backend/server.js) — THE THIRD READER, added by this change-set,
 *        and the reason the count in this header had to change. It is also the only reader that is
 *        not marketplace-only, which is why it is the only one that needs the publication gate in
 *        Rule 1b. Measured over the four marketplace consumers, none of them does:
 *          · discovery, saved, and listing-detail's PUBLIC audience all run `filterVisibleVehicles`
 *            (`isPubliclyVisiblePublication` + `isPublicVehicleStatus`) before any row is projected,
 *            so an unpublished listing never reaches a media projection at all — the marketplace
 *            gates by refusing the LISTING, and a block-level gate there would be dead code that
 *            looks load-bearing;
 *          · `listListingsForAdmin` (moderation) and listing-detail's ADMIN audience deliberately
 *            DO see unpublished listings, behind `assertModerator` — a moderation queue that hid
 *            the listings needing moderation would be useless. That is the same entitlement
 *            `listingAudience: 'owner'` names on the passport, reached through a different door,
 *            and Rule 1b leaves both untouched.
 *   WRITE
 *     4. `POST /api/vehicles/add` (backend/server.js) — the insert, gated on `isPublishableMediaUrl`
 *        from this module so the writer and the reader share one definition of publishable.
 *
 * THE SENTENCE IS THE SECOND DEFECT, AND THE WORSE ONE. "No verified images uploaded yet" answers
 * a question about EVIDENCE using a control that renders LISTING MEDIA. It states a finding about
 * governance ("nothing here is verified") on a surface whose input is a seller's marketing photos,
 * which are never verified by anything. Even with the gallery correctly hydrated, that sentence
 * would be false in the other direction: three verified photos would have appeared under a control
 * that had just called them unverified. Fixing only the plumbing would have left it in place.
 *
 * ── RULE 1: A BLOCK THAT WAS NEVER READ MAY NOT SAY "NONE" ─────────────────────────────────
 * This is the defect stated as a state, and it is the whole reason `not_loaded` exists.
 *
 *   `not_loaded` — this read path did not consult the source. Nothing is claimed. `items` is
 *                  empty and `empty_statement` is NULL, so a consumer that renders the statement
 *                  renders nothing at all.
 *   `none`       — the source WAS consulted and holds nothing publishable. This is a finding, and
 *                  it gets a sentence.
 *   `published`  — at least one item.
 *
 * Mechanically: `undefined`/`null` rows in means `not_loaded`; an ARRAY in — including `[]` —
 * means the caller looked. A read path that does not query `listing_images` therefore CANNOT emit
 * "no photos"; it emits `not_loaded` and the surface has nothing to render. That is the inverse of
 * what shipped, where a path that had never heard of `listing_images` published a confident
 * negative about it.
 *
 * ── RULE 1b: AN UNPUBLISHED LISTING PUBLISHES NO GALLERY — AND SAYS NOTHING ABOUT WHY ───────
 * Product-owner decision. Anonymous callers get listing media only when the LISTING is published.
 * Owner, admin and government keep full access through the paths that already govern them.
 *
 * The defect this closes is the one this module created. `listing_images` is keyed by VIN, the
 * passport resolves by VIN, and the passport applies no marketplace visibility filter — correctly,
 * because it is the canonical record of a VEHICLE and not of a listing. So the moment the passport
 * gained the read above, a photograph on an UNPUBLISHED listing became reachable by any anonymous
 * caller holding the VIN, on a surface where the marketplace answers 404. Measured on staging:
 * `WBA8E9C50JNUAT202` is `publication_status = 'draft'` and carries one `listing_images` row, and
 * the anonymous passport served it. Nothing decided that; it fell out of the wiring.
 *
 * WHAT THE GATED BLOCK SAYS, AND WHY THE OBVIOUS ANSWERS ARE BOTH WRONG.
 *
 *   REJECTED — a `withheld` state, or a non-zero `unpublishable_count` over the hidden rows. Both
 *   answer "does this unpublished listing have photographs?", which is the question the gate exists
 *   to refuse. A count is a disclosure with the pixels removed.
 *
 *   REJECTED — `state: 'none'` carrying "No photos have been added to this listing." That is a NEW
 *   PUBLIC FALSEHOOD in place of a disclosure: photos WERE added. A redaction that makes the
 *   product lie is strictly worse than the leak it closes, and this programme has made that mistake
 *   before.
 *
 *   ADOPTED — the gated block is BYTE-IDENTICAL to the block a published listing with no photos
 *   publishes, and the sentence it carries is true of both. `toGatedListingMediaBlock` produces it
 *   by calling `toListingMediaBlock` OVER AN EMPTY INPUT — the same projector, not a parallel one —
 *   so the two cannot drift apart into distinguishable shapes by anybody's future edit.
 *
 * THE SENTENCE THEREFORE HAD TO CHANGE FOR EVERY CALLER, not just for the gated one, and Rule 2
 * records the new wording. Two sentences, one per case, would BE the enumeration leak.
 *
 * THIS IS NOT A RULE 1 VIOLATION, THOUGH IT LOOKS LIKE ONE. `none` is still a finding backed by a
 * read: the read that grounds it is the VEHICLE read, whose `publication_status` this block
 * consults. A listing that is not published has no published photographs — that follows from the
 * publication state alone, without consulting the photo table at all. Rule 1 forbids asserting a
 * negative you did not check; it does not require checking the table that could not change the
 * answer.
 *
 * AND WHEN THE PUBLICATION STATE ITSELF CANNOT BE READ, THE BLOCK IS `not_loaded`. Not `none` —
 * "no photos are published" is a claim, and a render that could not establish whether the listing
 * is published has not earned it (the listing may be published and full of photographs). Not open
 * either: an unreadable gate that publishes is not a gate. `not_loaded` is the one state that is
 * both closed and silent, which is exactly what Rule 1 invented it for. Note that this is the
 * OPPOSITE default from `isPubliclyVisiblePublication`, which returns TRUE for an absent value on
 * purpose, so that hermetic fixtures predating the publication lifecycle keep working in a
 * marketplace filter. Reusing that helper here would make an absent column publish an unpublished
 * gallery, so this module resolves absence itself — while importing the same
 * `publiclyVisiblePublicationStatuses()` value set, so the two can never disagree about which
 * statuses are public.
 *
 * ── RULE 2: THE TWO EMPTY STATES ARE DIFFERENT SENTENCES AND NEITHER IMPLIES THE OTHER ─────
 *   listing_media.empty_statement    "No photos are published for this listing."
 *   verified_evidence.empty_statement "No verified evidence has been published for this vehicle."
 *
 * THE LISTING SENTENCE WAS "No photos have been added to this listing." and Rule 1b is why it is
 * not any more — but it was ALREADY false in a second, older case that had nothing to do with the
 * gate: a listing whose every row is unpublishable reaches `state: 'none'` with
 * `unpublishable_count > 0`, and "nobody added a photo" is exactly what did not happen there. The
 * new wording states only what this contract can actually observe about its own output — that it
 * published none — and asserts nothing about what the seller did or what the table holds. That
 * makes it true of all three cases at once, which is what makes them indistinguishable.
 *
 * A vehicle with photos and no evidence, and a vehicle with evidence and no photos, are BOTH
 * ordinary and must read differently. On staging today they are not hypothetical and they do not
 * overlap: three VINs carry a listing image and zero evidence; one VIN (WBA8E9C50HK000732) carries
 * one verified evidence row and zero listing images; the remaining twelve carry neither. Not one
 * of the sixteen has both. The single sentence that shipped was wrong for every one of the four.
 *
 * ── RULE 3: LISTING MEDIA MAKES NO VERIFICATION CLAIM, AND CANNOT ──────────────────────────
 * Not as a matter of taste — as a matter of what the table holds. Measured on staging,
 * `listing_images` is (id, vin, image_url, is_primary, display_order, created_at). There is no
 * uploader, no capture time, no reviewer, no status, no checksum, no source. There is nothing in
 * the row a verification claim could be built from, so any trust word attached to a listing photo
 * is authored by the renderer and asserted on the seller's behalf.
 *
 * `findTrustLanguage()` makes that checkable over the strings THIS CONTRACT authors — state names,
 * url forms, empty statements, keys. It deliberately does NOT scan the `url` value: that string is
 * the seller's, and a photo filed as `verified-dealer-stock.jpg` is not this contract making a
 * claim. We govern what we say, not what a filename happens to contain.
 *
 * Corollary, and the one that bites: `created_at` is NOT published on a listing item, although the
 * column exists. It is the row's INSERT time, and a gallery that shows a date next to a photo is
 * read as when the photo was taken. `vehicle_evidence` has `captured_at` for exactly that, gated
 * behind a review; `listing_images` has nothing of the sort. (It also keeps the item key sets
 * disjoint, since `created_at` is in PUBLIC_EVIDENCE_FIELDS — but the reason is the first one.)
 *
 * ── RULE 4: EVIDENCE KEEPS PHASE 0's ALLOW-LIST, UNFORKED ──────────────────────────────────
 * Evidence items are built by `toPublicEvidence` from `publicVehicleProjection.js`. This module
 * imports it; it does not restate it and does not maintain a parallel list. `uploaded_by`,
 * `verified_by`, `tenant_id`, `source_id`, `file_path`, `storage_bucket`, `verification_notes`,
 * `metadata`, `plate_number`, `chassis_number`, `engine_number` stay out because that list keeps
 * them out, and they stay out FOR EVERY AUDIENCE here.
 *
 * `audience: 'owner'` widens WHICH ROWS are published, never WHICH FIELDS. An owner is entitled to
 * see their own pending evidence; nobody is entitled to read an uploader id out of a media block.
 * The route's separate authorized `evidenceVault` is unchanged and is not this module's business.
 *
 * ── RULE 5: URL HONESTY — WHAT A CONSUMER MAY ASSUME, WHICH IS ALMOST NOTHING ───────────────
 * A media URL in this contract is AN UNVALIDATED STRING SOMEONE RECORDED. The only guarantees are
 * the ones `url_form` states about the STRING. Nothing here asserts the asset exists, that it is
 * an image, that it is reachable from the caller's network, or that it depicts this vehicle.
 *
 *   `absolute_https`     — begins `https://`. Resolves independent of the viewing page.
 *   `absolute_http`      — begins `http://`. Published, and flagged: it will be blocked as mixed
 *                          content on an https page.
 *   `protocol_relative`  — begins `//`. LOOKS site-relative and is not: the host is foreign, only
 *                          the scheme is inherited. Called out precisely because it is the form
 *                          most easily mistaken for the safe one.
 *   `site_relative`      — begins with a single `/`. Resolves against THE VIEWING ORIGIN, which is
 *                          not necessarily where the asset lives, and differs between carup.dev,
 *                          a preview deploy and localhost.
 *
 * NEVER SIGNED. This contract emits no signed URL, no token and no expiry, and a consumer may not
 * treat any URL here as access-controlled. `storageService.generateSignedUrl` exists and produces
 * expiring URLs for the private `ocr-documents` bucket; nothing in either media source stores its
 * output, and re-signing here would silently put an expiry on a string consumers cache.
 *
 * Anything else — `data:`, `blob:`, `javascript:`, a bare `photo.jpg` (which resolves against the
 * current PATH, so `/marketplace/<VIN>` makes it `/marketplace/photo.jpg`), a blank string, a
 * non-string — is UNPUBLISHABLE. It is not silently dropped: `unpublishable_count` records it, so
 * a block that held media it could not publish reports `state: 'published'` with a short list or
 * `state: 'none'` with a non-zero count, and never passes off "we could not render it" as "the
 * seller added none". Silent dropping is the same lie as the sentence in Rule 1, one layer down.
 *
 * MEASURED, so nobody reads the above as defensive styling:
 *   · 3 of 3 `listing_images` rows on staging are `site_relative`: `/uat/owner/subaru-impreza.svg`,
 *     `/uat/owner/toyota-corolla.svg`, `/uat/owner/bmw-320i.svg`. No such directory exists in
 *     `web/public`, no code in the repository writes those strings, and all three rows share one
 *     insert timestamp — they were placed directly into staging by a UAT script that is not here.
 *     They render as broken images rather than as the placeholder, because `ListingImage` branches
 *     on `src` being truthy and a dangling path is truthy.
 *   · The write path (`POST /api/vehicles/add`, `backend/server.js`) USED TO store `image_url: url`
 *     verbatim from the request body — no scheme check, no host check, no length check, no
 *     existence check. Reproduced against the shipped handler before the fix: a five-image
 *     submission stored `javascript:alert(document.cookie)`, `data:image/png;base64,…`, a
 *     whitespace-only string and a path-relative `photo.jpg`, i.e. four rows this projection can
 *     never publish. It now gates on `isPublishableMediaUrl` BELOW — this exact function, imported,
 *     not restated — so the reader and the writer cannot drift apart, and refused values are
 *     reported to the caller as `images_unpublishable_count` instead of being silently stored.
 *   · The one `vehicle_evidence` row is `absolute_https` on `staging.carup.local`, a host that does
 *     not resolve; its `storage_bucket`/`file_path` name `vehicle-images/qa/evidence-73.jpg`, and
 *     `storage.objects` holds ZERO rows for that bucket. Both of its URLs are dangling, by two
 *     independent routes.
 *
 * ── RULE 6: PRIMACY IS THE SELLER'S CHOICE OR IT DOES NOT EXIST ────────────────────────────
 * `is_primary` is published `true` only when a row says so. When no row claims primacy, NO item is
 * primary — the projection does not elect one. Ordering and primacy are different facts: `position`
 * always says what to show first; `is_primary` says the seller chose it, and inventing that choice
 * is a fabrication in the same family as the seller labels Phase 4 removed.
 *
 * When SEVERAL rows claim primacy (nothing in the schema prevents it — there is no partial unique
 * index on `(vin) WHERE is_primary`), the first in sort order keeps the claim and the rest are
 * demoted, so a consumer never has to arbitrate between two "main photos".
 *
 * NO `primary_url` MIRROR. The primary is `items.find(i => i.is_primary)`. Publishing the same URL
 * at a second key is how Phase 4 ended up with `plate_status` answering one question twice in one
 * body with two different answers; one fact lives in one place. (`marketplace` summaries keep their
 * own `primary_image_url` key for existing consumers — that path is not changed here, and it is
 * recorded below as a finding, not adopted.)
 *
 * `position` is the projection's dense 0-based ordinal AFTER sorting, not the raw `display_order`.
 * The raw column is 0 on 3 of 3 staging rows and is not unique per VIN, so it cannot address a
 * photo; `position` can.
 *
 * ── RULE 6b: EVERY PUBLISHED ITEM CARRIES A STABLE OPAQUE IDENTITY ─────────────────────────
 * `position` addresses a SLOT; `media_id` addresses a PHOTOGRAPH. They are different facts and the
 * distinction is not academic: `position` is this projection's dense ordinal, so it changes when any
 * other row is added, removed or re-ordered, and it is equal to `0` on the first item of every
 * vehicle in the fleet. Nothing keyed on it survives a second read.
 *
 * URL EQUALITY IS THE WEAKER PROOF, which is why it is not the identity. A URL may be rewritten
 * between surfaces — CDN host, origin swap, signing, a resize suffix — and still be the same
 * photograph; and two genuinely different photographs may collide on a site-relative path, which is
 * not hypothetical here, since 3 of 3 staging rows are site-relative `/uat/owner/*.svg` strings
 * written by a UAT script with no uniqueness constraint behind them (Rule 5, and finding 3: there is
 * no CHECK and no unique index on `listing_images.image_url`). Continuity proven by comparing URL
 * STRINGS across list/detail/passport therefore proves that two surfaces printed the same
 * characters, not that they showed the same picture.
 *
 * `media_id` IS `listing_images.id` — the row's own primary key, `uuid` NOT NULL DEFAULT
 * `gen_random_uuid()`, measured v4 (random) on 3 of 3 staging rows. Stable because it is STORED at
 * insert and read back, never recomputed from content, position or ordering; two independent
 * projections of the same row therefore agree, and they agree even when the rows arrive in a
 * different order or alongside different siblings.
 *
 * THIS IS SYMMETRY, NOT A WIDENING. `PUBLIC_EVIDENCE_FIELDS` has published `id` as its FIRST field
 * since Phase 0, so an evidence item has always been addressable and a listing item has not. The
 * asymmetry was the anomaly. Recorded as such in ADR-002 rather than as a new public column.
 *
 * IT IS NOT KEYED `id`, AND THAT IS RULE 7 DOING ITS JOB. The evidence item shape already contains
 * `id`; publishing a listing identity under the same name would put one key name on both item
 * shapes and collapse the disjointness proof — the very property that makes "these can never be
 * conflated" executable. `media_id` names itself, belongs to one shape, and keeps the sets disjoint.
 *
 * WHAT IT MAY NEVER BE. An opaque row identifier and nothing else — never a storage path, bucket
 * name, object key, uploader id or tenant id. That is enforced MECHANICALLY rather than by review:
 * `toMediaIdentity` publishes only a value matching the canonical UUID grammar, so a path, a bucket
 * name or a filename cannot be published as an identity even if some future row carries one in `id`.
 * There is in any case nothing private to leak — `listing_images` is
 * (id, vin, image_url, is_primary, display_order, created_at) and holds no locator column at all;
 * `image_url` is already published, so the identity discloses strictly less than the item beside it.
 * (Contrast `vehicle_evidence`, which DOES have `storage_bucket`/`file_path` — and whose `id` has
 * been public since Phase 0 without exposing either, because a random uuid derives nothing.)
 *
 * A ROW WITHOUT A USABLE IDENTITY IS UNPUBLISHABLE, AND COUNTED — the same treatment an
 * unrenderable URL gets, for the same reason. An item published with a null or duplicated identity
 * is worse than an absent one: a consumer keying a gallery, a cache or a selection on it would
 * silently conflate two photographs, which is precisely the failure the identity exists to prevent.
 * A REPEATED identity is likewise counted, first occurrence winning, so the block can always address
 * its own items.
 *
 * ── RULE 7: THE BLOCKS ARE DISJOINT BY CONSTRUCTION, NOT BY DISCIPLINE ─────────────────────
 * Each projector reads the column names of ITS OWN table and gates on them:
 *   · a `listing_images` row has `image_url` and no `verification_status`/`visibility_level`, so
 *     feeding one to the evidence side yields nothing publishable;
 *   · a `vehicle_evidence` row has `file_url` and no `image_url`, so feeding one to the listing
 *     side yields nothing publishable.
 * Neither direction throws and neither is a special case — the gates are the ordinary ones. A
 * listing photo cannot be promoted into evidence by being displayed, and an evidence artifact
 * cannot be demoted into the gallery by being an image.
 *
 * THE SAME URL MAY LEGITIMATELY APPEAR IN BOTH BLOCKS and that is not conflation. A file can be a
 * seller's marketing photo AND, separately, a reviewed artifact; both buckets can serve from
 * `vehicle-images`. Provenance travels with the ITEM, not with the string. Deduplicating across
 * the blocks would be the actual error: it would make one of the two claims disappear.
 *
 * ── RULE 8: `dealer_listing` EVIDENCE IS EVIDENCE ABOUT AN ADVERTISEMENT ────────────────────
 * The taxonomy already contains the trap. `vehicle_evidence.evidence_type` permits
 * `dealer_listing_photo`, and `evidence_class_taxonomy` carries the class `dealer_listing` with
 * subtypes `listing_photograph`, `advertised_mileage`, `advertised_condition`.
 *
 * Such a row stays in the EVIDENCE block: it is a governed artifact with provenance and a review
 * decision. But `verification_status: 'verified'` on it attests THAT THIS WAS THE ADVERTISED
 * PHOTO — it does not attest anything about the vehicle. It is likewise never copied into
 * `listing_media`: the gallery is the seller's CURRENT presentation, and a captured historical
 * advertisement is not that. This module keeps them apart; a surface that renders the evidence
 * block must not describe such an item with language it would use for an inspection photo.
 *
 * ── FINDINGS RECORDED, NOT FIXED HERE (they belong to other owners) ────────────────────────
 *   1. `listing_images` is unreadable from a browser, and it FAILS LOUDLY rather than quietly.
 *      This entry previously claimed a direct-from-browser read "returns an empty set with no
 *      error". THAT WAS FALSE, and the correction matters more than the wording: a silent empty set
 *      IS the defect this module exists to close, while a raised error is a read that never
 *      happened and that `not_loaded` can represent honestly. Re-measured read-only on staging
 *      (`eoyenigwevnxwwhyhaer`):
 *
 *        has_table_privilege('anon',          'public.listing_images', 'SELECT')  ->  false
 *        has_table_privilege('authenticated', 'public.listing_images', 'SELECT')  ->  false
 *        BEGIN; SET LOCAL ROLE anon;          SELECT count(*) FROM listing_images;
 *          ->  ERROR 42501: permission denied for table listing_images
 *        BEGIN; SET LOCAL ROLE authenticated; SELECT count(*) FROM listing_images;
 *          ->  ERROR 42501: permission denied for table listing_images
 *
 *      `anon` and `authenticated` appear in `information_schema.role_table_grants` for this table
 *      with NO ROWS AT ALL — there is no GRANT, so the privilege check fails first and RLS IS NEVER
 *      REACHED. RLS is enabled with 0 policies behind it, which is a SECOND lock, not the operative
 *      one. That is the applied end state of
 *      `20260619201406_production_access_containment.sql` (ENABLE RLS + REVOKE ALL FROM anon,
 *      authenticated + GRANT ALL TO service_role over eleven tables). `vehicle_documents` is in the
 *      same state (also 0 rows). NO MIGRATION IS AUTHORED FOR THIS — there is nothing to change.
 *
 *      `vehicle_evidence` is the contrast that proves the distinction is real rather than pedantic:
 *      it HAS the grant and 4 policies, including an `anon` SELECT gated on
 *      `public_safe AND verified` — the same gate this module applies — so the identical anon read
 *      returns a FILTERED SET (measured: 1 row) with no error. Grant-then-filter and no-grant-at-all
 *      are different mechanisms with different failure modes, and only one of them is silent.
 *
 *      THE RESIDUAL RISK, therefore, is somebody following the hint PostgreSQL prints in that very
 *      error — `GRANT SELECT ON public.listing_images TO anon;` — which without a policy converts
 *      the loud 42501 into exactly the silent empty set this contract was opened to eliminate.
 *      Guarded by `issue164-phase5-marketplace-convergence.test.js`, which refuses such a GRANT in
 *      any migration and refuses any client-side query of this table.
 *   2. `buildMarketplaceListingSummary` elects `primary_image_url` as `sorted[0]` regardless of
 *      whether any row claims `is_primary`, so it can publish a seller choice nobody made. Not
 *      changed here: that is a read path, and read paths are the next stage.
 *   3. There is no partial unique index enforcing one primary per VIN, and no CHECK on
 *      `listing_images.image_url`. Both are cutover candidates; no migration is authored by this
 *      phase.
 *   3b. DATA DEBT — THREE LIVE ROWS CLAIM A PRIMACY NO SELLER EXPRESSED. All 3 of 3
 *      `listing_images` rows on staging carry `is_primary = true`, so every one of them is
 *      published today as `primary_image_state: 'seller_primary'` — the label that means "the
 *      seller chose this photo". No seller did. Exact ids, for the cutover that may correct them:
 *
 *        5596b493-f21a-40eb-aba5-947b26e76cd5  JTNBU4EE0J9UAT101  /uat/owner/toyota-corolla.svg
 *        6a4b5b86-fbf2-448e-856e-9fa14299c2d7  JF1GPAL60J9UAT303  /uat/owner/subaru-impreza.svg
 *        fb7b28c2-c6d5-443e-9758-0b7a790be6f2  WBA8E9C50JNUAT202  /uat/owner/bmw-320i.svg
 *
 *      THEY DID NOT COME FROM THE FABRICATING WRITE PATH, though the effect is identical. All three
 *      share `xmin = 661839` — ONE inserting transaction — and so do the three `vehicles` rows they
 *      belong to; `/api/vehicles/add` writes images for exactly ONE vin per request, so three
 *      distinct VINs could not share a transaction. One of those vehicles also has `owner_id IS
 *      NULL`, which that handler cannot produce (it stamps the caller), and the other two are owned
 *      by `u_uat_ref_owner_2026`. They were seeded, matching the single `created_at` of
 *      2026-08-16 22:52:25.977933+00 and the `/uat/owner/*.svg` paths that exist nowhere in
 *      `web/public`. The distinction is worth recording because it changes the remedy: fixing the
 *      write path does NOT retire this debt, and no amount of future correct writing will.
 *      NOT CORRECTED HERE — this phase writes to no database.
 *   4. `vehicle_documents` (logbook/insurance/customs/police clearance, with its own
 *      `verification_status`) is written and read by NOTHING in the repository and holds 0 rows. It
 *      is a third media concept that is dormant, not a third source this contract composes. If it
 *      is ever activated it is EVIDENCE, not listing media, and it must arrive through
 *      `vehicle_evidence` or get its own allow-list — never through `listing_media`.
 * ===========================================================================================
 */

import { PUBLIC_EVIDENCE_FIELDS, toPublicEvidence } from './publicVehicleProjection.js';
// Rule 1b. Imported for the VALUE SET alone — which `publication_status` values are public — so
// this gate and the marketplace filter cannot come to disagree about what "published" means. The
// POLICY for an absent value is deliberately NOT imported; see `resolveListingPublication`.
import { publiclyVisiblePublicationStatuses } from './vehicleStatus.js';

/**
 * The three states a media block can be in. Closed vocabulary, so a consumer validates rather
 * than trusts. See Rule 1: `not_loaded` is the one that closes the original defect.
 */
export const MEDIA_BLOCK_STATES = Object.freeze({
  PUBLISHED: 'published',
  NONE: 'none',
  NOT_LOADED: 'not_loaded',
});

export const MEDIA_BLOCK_STATE_VALUES = Object.freeze(Object.values(MEDIA_BLOCK_STATES));

/** True when `state` names one of the three declared block states. */
export function isMediaBlockState(state) {
  return MEDIA_BLOCK_STATE_VALUES.includes(state);
}

/**
 * What a consumer may assume about the URL STRING. Never about the asset behind it. See Rule 5.
 */
export const MEDIA_URL_FORMS = Object.freeze({
  ABSOLUTE_HTTPS: 'absolute_https',
  ABSOLUTE_HTTP: 'absolute_http',
  PROTOCOL_RELATIVE: 'protocol_relative',
  SITE_RELATIVE: 'site_relative',
});

export const MEDIA_URL_FORM_VALUES = Object.freeze(Object.values(MEDIA_URL_FORMS));

/**
 * The EXACT keys a listing-media item carries. Always all of them, never any other.
 *
 * `media_id` leads, mirroring `id` at the head of PUBLIC_EVIDENCE_FIELDS: identity first, then the
 * locator, then presentation. It is spelled `media_id` and not `id` so the two item shapes keep
 * ZERO key names in common — see Rule 6b and Rule 7.
 */
export const LISTING_MEDIA_ITEM_FIELDS = Object.freeze([
  'media_id', 'url', 'url_form', 'position', 'is_primary',
]);

/**
 * The EXACT keys an evidence item carries: Phase 0's allow-list verbatim, plus the url-form
 * classification of `file_url`. Named `file_url_form` rather than `url_form` so the two item
 * shapes stay key-disjoint (Rule 7) — the classification is the same function either way.
 */
export const EVIDENCE_MEDIA_ITEM_FIELDS = Object.freeze([
  ...PUBLIC_EVIDENCE_FIELDS, 'file_url_form', 'file_availability',
]);

/**
 * Does this row NAME a real stored artifact, independently of whether its `file_url` happens to be
 * a renderable URL?
 *
 * A private-bucket document is addressed by (`storage_bucket`, `file_path`) and its `file_url` is
 * bucket-relative by design. Reading only `file_url` therefore mistakes "stored privately" for
 * "does not exist" — which is exactly how four verified documents came to be published as absent.
 * The locator is READ here to answer that question and is never itself published.
 */
export function hasStorageLocator(row) {
  return typeof row?.storage_bucket === 'string' && row.storage_bucket.trim() !== ''
    && typeof row?.file_path === 'string' && row.file_path.trim() !== '';
}

/** The uniform envelope both blocks carry. Shared on purpose; the ITEM shapes are what differ. */
export const MEDIA_BLOCK_ENVELOPE_FIELDS = Object.freeze([
  'state', 'items', 'unpublishable_count', 'empty_statement',
]);

/**
 * The two sentences. Exported so a surface imports the wording instead of authoring its own —
 * "No verified images uploaded yet" was authored in a .tsx file, which is precisely how a
 * marketing gallery came to publish a governance finding.
 */
/**
 * NON-DISTINGUISHING BY CONSTRUCTION — see Rule 1b. This sentence is published verbatim by an
 * unpublished listing that holds photographs, by a published listing that holds none, and by a
 * published listing whose every row was unpublishable. It asserts only what this contract itself
 * did (published nothing) and nothing whatever about what the table holds or what the seller did,
 * which is the property that makes those three cases indistinguishable from outside.
 *
 * "No photos have been added to this listing." — the wording this replaces — asserted a fact about
 * the seller's behaviour, and was false in two of the three.
 */
export const LISTING_MEDIA_EMPTY_STATEMENT = 'No photos are published for this listing.';
export const VERIFIED_EVIDENCE_EMPTY_STATEMENT = 'No verified evidence has been published for this vehicle.';

/** The gate a `vehicle_evidence` row must pass to reach a public audience. */
export const PUBLISHABLE_EVIDENCE_VISIBILITY = 'public_safe';
export const PUBLISHABLE_EVIDENCE_STATUS = 'verified';

/**
 * Words that assert governance. None of them may appear in anything the LISTING block authors.
 * Lowercase; matched as substrings against lowercased strings, so 'verified'/'verification' are
 * both caught by 'verif'. Kept as whole recognisable stems rather than initials so the list reads
 * as the claim it forbids.
 */
export const TRUST_LANGUAGE = Object.freeze([
  'verif', 'evidence', 'trust', 'certif', 'authentic', 'proof', 'proven',
  'inspect', 'approved', 'official', 'guarantee', 'validated', 'genuine', 'vetted',
]);

/**
 * Keys whose VALUES are recorded by someone else and are therefore not this contract's speech.
 * `findTrustLanguage` skips them: a seller's file named `verified-stock.jpg` is not CarUp making a
 * verification claim, and flagging it would make the guard fire on data instead of on contract.
 */
const AUTHORED_BY_OTHERS = Object.freeze(['url', 'file_url']);

/**
 * Classify a media URL string. Returns one of MEDIA_URL_FORM_VALUES, or `null` when the value is
 * unpublishable — not a string, blank, a scheme this contract will not emit (`data:`, `blob:`,
 * `javascript:`, `file:`, …), or a path-relative reference that would resolve against whatever
 * route the viewer happens to be on.
 */
export function classifyMediaUrl(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (trimmed === '') return null;
  // Order matters: `//` must be tested before the single-slash case, or a foreign host would be
  // published as if it resolved against our own origin.
  if (trimmed.startsWith('//')) return MEDIA_URL_FORMS.PROTOCOL_RELATIVE;
  if (trimmed.startsWith('/')) return MEDIA_URL_FORMS.SITE_RELATIVE;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('https://')) return MEDIA_URL_FORMS.ABSOLUTE_HTTPS;
  if (lower.startsWith('http://')) return MEDIA_URL_FORMS.ABSOLUTE_HTTP;
  return null;
}

/** True when `classifyMediaUrl` would publish this value. */
export function isPublishableMediaUrl(url) {
  return classifyMediaUrl(url) !== null;
}

/**
 * The canonical UUID grammar — 8-4-4-4-12 hex, and NOTHING else. Anchored at both ends, so no
 * value carrying a `/`, a `.`, a space, a bucket name or a file extension can satisfy it.
 *
 * This regex IS the "never a private locator" guarantee, mechanically. A reviewer promising that
 * only opaque ids get published is a convention; a grammar that cannot express `vehicle-images` or
 * `qa/evidence-73.jpg` is a proof. See Rule 6b.
 */
const MEDIA_IDENTITY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Project a row's stable opaque identity, or `null` when the row has none this contract will
 * publish. Case is normalised DOWN, because identity must not depend on how a caller happened to
 * serialise it: the same row read twice must compare equal with `===`, not with a case-insensitive
 * comparison every consumer would have to remember to use.
 *
 * Returning `null` is not a soft failure — `toListingMediaBlock` treats it exactly as it treats an
 * unrenderable URL: the row is counted in `unpublishable_count` and no item is emitted. Publishing
 * an item whose identity is null would hand consumers a key that collides with every other
 * identity-less item in the gallery.
 */
export function toMediaIdentity(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!MEDIA_IDENTITY_PATTERN.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

/** True when `toMediaIdentity` would publish this value as an item identity. */
export function isPublishableMediaIdentity(value) {
  return toMediaIdentity(value) !== null;
}

/**
 * Whether an evidence row may be published to `audience`.
 *
 * The public gate is `visibility_level === 'public_safe' AND verification_status === 'verified'` —
 * re-applied here even though `buildVehiclePassport` already filters in SQL, because a caller that
 * forgets the filter must not be able to leak restricted evidence through this projection. A row
 * missing either column fails: absence is not permission (the rule `isPublicPlateHistoryRow`
 * already applies to plate history), and it is also what stops a `listing_images` row — which has
 * neither column — from being published as evidence.
 *
 * `audience: 'owner'` lifts the gate on WHICH ROWS only. It never widens the field allow-list.
 */
export function isEvidenceRowClearedFor(row, audience = 'public') {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  if (audience === 'owner') return true;
  return row.visibility_level === PUBLISHABLE_EVIDENCE_VISIBILITY
    && row.verification_status === PUBLISHABLE_EVIDENCE_STATUS;
}

/** Cleared for this audience AND carrying a URL this contract will publish. */
export function isPublishableEvidenceRow(row, audience = 'public') {
  return isEvidenceRowClearedFor(row, audience) && isPublishableMediaUrl(row.file_url);
}

function sealBlock(state, items, unpublishableCount, emptyStatement) {
  return Object.freeze({
    state,
    items: Object.freeze(items),
    unpublishable_count: unpublishableCount,
    // A sentence belongs to `none` alone. `published` has items to speak for it, and `not_loaded`
    // has nothing to say — rendering a statement there is the defect this contract closes.
    empty_statement: state === MEDIA_BLOCK_STATES.NONE ? emptyStatement : null,
  });
}

function notLoadedBlock() {
  return sealBlock(MEDIA_BLOCK_STATES.NOT_LOADED, [], 0, null);
}

/**
 * THE LISTING-MEDIA BLOCK — the gallery. Seller-provided, unverified, and carrying no claim
 * beyond "these are the photos on this listing".
 *
 * @param {Array<object>|null|undefined} rows raw `listing_images` rows. `undefined`/`null` means
 *   THIS READ PATH DID NOT LOOK, and produces `not_loaded`. `[]` means it looked and found none.
 */
export function toListingMediaBlock(rows) {
  if (rows === undefined || rows === null) return notLoadedBlock();
  if (!Array.isArray(rows)) return notLoadedBlock();

  let unpublishable = 0;
  const candidates = [];
  const identitiesTaken = new Set();
  rows.forEach((row, index) => {
    const form = classifyMediaUrl(row?.image_url);
    const mediaId = toMediaIdentity(row?.id);
    // Rule 6b: no identity, no publication. An item is addressable or it is not published, and
    // either way the row is COUNTED rather than dropped — a gallery keyed on a null or repeated
    // identity conflates photographs, which is the failure the identity exists to prevent.
    // Duplicates resolve first-in-input-order, which is deterministic and independent of the sort
    // below, so the surviving item is the same one on every read.
    if (form === null || mediaId === null || identitiesTaken.has(mediaId)) {
      // Counted, never silently dropped: "we could not publish it" is not "the seller added none".
      unpublishable += 1;
      return;
    }
    identitiesTaken.add(mediaId);
    candidates.push({
      mediaId,
      url: String(row.image_url).trim(),
      form,
      claimsPrimary: row?.is_primary === true,
      // Coerced only for ORDERING. A non-numeric display_order sorts last rather than poisoning
      // the comparator with NaN; it is never published, so no fabricated value escapes.
      order: Number.isFinite(Number(row?.display_order)) ? Number(row.display_order) : Number.MAX_SAFE_INTEGER,
      index,
    });
  });

  candidates.sort((a, b) => {
    if (a.claimsPrimary !== b.claimsPrimary) return a.claimsPrimary ? -1 : 1;
    if (a.order !== b.order) return a.order - b.order;
    return a.index - b.index;
  });

  let primaryTaken = false;
  const items = candidates.map((candidate, position) => {
    // Rule 6: the seller's claim is honoured once. A second claimant is demoted rather than
    // published, and no primary is invented when nobody claimed one.
    const isPrimary = candidate.claimsPrimary && !primaryTaken;
    if (isPrimary) primaryTaken = true;
    return Object.freeze({
      // Rule 6b. Carried straight from the row, NEVER derived from `position` or from the array
      // index: an index-derived value would be equal to 0 on the first photo of every vehicle and
      // would change whenever a sibling row moved, which is the opposite of an identity.
      media_id: candidate.mediaId,
      url: candidate.url,
      url_form: candidate.form,
      position,
      is_primary: isPrimary,
    });
  });

  const state = items.length ? MEDIA_BLOCK_STATES.PUBLISHED : MEDIA_BLOCK_STATES.NONE;
  return sealBlock(state, items, unpublishable, LISTING_MEDIA_EMPTY_STATEMENT);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// RULE 1b — THE LISTING PUBLICATION GATE
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * What this projection was able to establish about the LISTING's publication. Three values, because
 * "not published" and "we could not tell" are different facts with different correct answers, and
 * collapsing them is how a gate ends up failing open on a value it never read.
 */
export const LISTING_PUBLICATION_STATES = Object.freeze({
  PUBLISHED: 'published',
  UNPUBLISHED: 'unpublished',
  UNDETERMINED: 'undetermined',
});

export const LISTING_PUBLICATION_STATE_VALUES = Object.freeze(Object.values(LISTING_PUBLICATION_STATES));

/**
 * Audiences for the LISTING block. Deliberately a DIFFERENT PARAMETER from the evidence
 * `audience`, and that separation is structural rather than stylistic: evidence is vehicle truth
 * and listing media is listing content, so a caller cannot widen one by widening the other even by
 * accident. Conflating the two is the exact error Phase 5 exists to remove — see Rule 7.
 *
 *   `public` — anonymous, or any caller the route did not authorize for this vehicle. Gated.
 *   `owner`  — a caller the ROUTE has already authorized against this vehicle. For the passport
 *              that is the owner plus the PASSPORT_PRIVILEGED_ROLES (admin, government), resolved
 *              from a verified session; this module never decides it and never reads a header.
 */
export const LISTING_MEDIA_AUDIENCES = Object.freeze({ PUBLIC: 'public', OWNER: 'owner' });

/**
 * Classify a `vehicles.publication_status` value for the purpose of this gate.
 *
 * The VALUE SET comes from `publiclyVisiblePublicationStatuses()` — one definition, shared with the
 * marketplace list filter and `isPubliclyVisiblePublication`, so the passport can never publish a
 * gallery for a listing the marketplace hides. The live vocabulary is six values
 * (`draft`, `identity_complete`, `documents_submitted`, `review_pending`, `publishable`,
 * `published`, enforced by `vehicles_publication_status_check`) of which exactly one is public; an
 * unrecognised seventh added by a future migration classifies as UNPUBLISHED, which is the safe
 * direction and needs no edit here.
 *
 * THE ABSENT-VALUE POLICY IS THIS MODULE'S OWN, AND IS THE OPPOSITE OF THE MARKETPLACE HELPER'S.
 * `isPubliclyVisiblePublication(undefined)` returns TRUE by design, so that hermetic fixtures
 * predating the publication lifecycle keep flowing through a marketplace filter. Borrowing it here
 * would mean a passport that could not read the column published the gallery anyway — a gate that
 * opens when it fails is not a gate. Absence, null, a non-string and a blank string are all
 * UNDETERMINED, and `toGatedListingMediaBlock` answers that with `not_loaded`.
 *
 * THE COMPARISON IS EXACT, AND THE VALUE IS NOT TRIMMED FIRST. A padded `'published '` classifies
 * as UNPUBLISHED, because `isPubliclyVisiblePublication` would also hide it: trimming here would
 * make this gate MORE PERMISSIVE than the marketplace filter it shares a value set with, and a
 * passport publishing a gallery for a listing the marketplace hides is the two-answers defect this
 * whole issue exists to close. (`vehicles_publication_status_check` forbids padded values in any
 * case; the point is that the two gates cannot diverge even if it did not.) Whitespace is used for
 * ONE thing only — deciding that a blank string carries no status to read at all.
 */
export function resolveListingPublication(publicationStatus) {
  if (typeof publicationStatus !== 'string') return LISTING_PUBLICATION_STATES.UNDETERMINED;
  if (publicationStatus.trim() === '') return LISTING_PUBLICATION_STATES.UNDETERMINED;
  return publiclyVisiblePublicationStatuses().includes(publicationStatus)
    ? LISTING_PUBLICATION_STATES.PUBLISHED
    : LISTING_PUBLICATION_STATES.UNPUBLISHED;
}

/**
 * `[]` as a shared frozen value, so the gated block is provably the SAME COMPUTATION as the
 * genuinely-empty one rather than a lookalike assembled beside it.
 */
const NO_ROWS = Object.freeze([]);

/**
 * THE GATE. Rule 1b, executable.
 *
 * @param {Array<object>|null|undefined} rows raw `listing_images` rows, exactly as
 *   `toListingMediaBlock` takes them. They are IGNORED when the gate is closed — not counted, not
 *   summarised, not partially described.
 * @param {{listingPublicationStatus?: string|null, listingAudience?: 'public'|'owner'}} [options]
 *
 * Three outcomes, and each one is the whole answer:
 *
 *   AUTHORIZED CALLER   -> `toListingMediaBlock(rows)`, unchanged in every respect. The gate is
 *                          about who may see an unpublished listing's content, and this caller may;
 *                          the route decided that from a verified session before calling.
 *   PUBLISHED LISTING   -> `toListingMediaBlock(rows)`, unchanged in every respect.
 *   UNPUBLISHED LISTING -> `toListingMediaBlock(NO_ROWS)`. NOT a hand-built block that resembles
 *                          one: the identical function over an empty input, so byte-identity with a
 *                          published-and-empty listing holds by CONSTRUCTION and survives any future
 *                          change to what an empty block looks like.
 *   UNDETERMINED        -> `notLoadedBlock()`. Closed and silent; see Rule 1b.
 */
export function toGatedListingMediaBlock(rows, options) {
  const { listingPublicationStatus, listingAudience = LISTING_MEDIA_AUDIENCES.PUBLIC } = options ?? {};

  if (listingAudience === LISTING_MEDIA_AUDIENCES.OWNER) return toListingMediaBlock(rows);

  const publication = resolveListingPublication(listingPublicationStatus);
  if (publication === LISTING_PUBLICATION_STATES.PUBLISHED) return toListingMediaBlock(rows);
  if (publication === LISTING_PUBLICATION_STATES.UNPUBLISHED) return toListingMediaBlock(NO_ROWS);
  return notLoadedBlock();
}

/**
 * THE VERIFIED-EVIDENCE BLOCK — governed artifacts with provenance and a review decision.
 *
 * Items are `toPublicEvidence(row)` (Phase 0's allow-list, imported not restated) plus
 * `file_url_form`. Internal identity never appears, for any audience.
 *
 * @param {Array<object>|null|undefined} rows raw `vehicle_evidence` rows; `undefined`/`null` means
 *   this read path did not look.
 * @param {{audience?: 'public'|'owner'}} [options]
 */
export function toVerifiedEvidenceBlock(rows, options) {
  if (rows === undefined || rows === null) return notLoadedBlock();
  if (!Array.isArray(rows)) return notLoadedBlock();
  const { audience = 'public' } = options ?? {};

  let unpublishable = 0;
  const items = [];
  for (const row of rows) {
    // A row this audience may not see is NOT counted anywhere: publishing "2 withheld" over a
    // restricted evidence set tells an anonymous caller that restricted evidence exists, which is
    // the question the gate exists to refuse.
    if (!isEvidenceRowClearedFor(row, audience)) continue;

    // PUBLISH THE FACT. WITHHOLD THE FILE.
    //
    // This branch used to drop a cleared row whenever its `file_url` was not a renderable URL, and
    // only count it. That reads a STORAGE-LAYOUT question as an EVIDENCE question, and the physical
    // UAT caught what it costs: Golden A's four human-reviewed, `verified` documents live in the
    // private `ocr-documents` bucket and are addressed by a bucket-relative path — the correct
    // canonical contract for a private PII artifact — so all four were refused on string shape and
    // the block collapsed to `state: 'none'`. The page then told an anonymous visitor "No verified
    // evidence has been published for this vehicle" while, two sentences later, admitting four
    // reviewed items existed. `state` is a machine-readable enum, and in this contract's own
    // vocabulary `none` means "we looked and found nothing" (as against `not_loaded`, "we did not
    // look"). A true sentence in a sibling field cannot rescue a false enum.
    //
    // A row that names a real artifact is therefore PUBLISHED as a governed fact — type, review
    // decision, verified date, mime type, size — with the FILE withheld. No signed URL is minted
    // here, deliberately: `evidenceDefaultVisibility()` returns 'restricted' for every document
    // type, so these documents were never cleared for public display, and a signed URL is a
    // shareable bearer capability for its whole TTL.
    //
    // `unpublishable` keeps its original meaning and is now reserved for the genuine case: a row
    // that names NO artifact at all. That is still our defect and is still counted, so the block
    // can never pass "we could not publish it" off as "this vehicle has no verified evidence".
    const form = classifyMediaUrl(row.file_url);
    const hasLocator = hasStorageLocator(row);
    if (form === null && !hasLocator) {
      unpublishable += 1;
      continue;
    }

    const projected = toPublicEvidence(row);
    items.push(Object.freeze({
      ...projected,
      // The locator itself never travels — publishing `file_url` unchanged would leak the
      // bucket-relative `file_path` under a friendlier name.
      file_url: form === null ? null : row.file_url,
      file_url_form: form,
      file_availability: form === null ? 'withheld_private' : 'viewable',
    }));
  }

  const state = items.length ? MEDIA_BLOCK_STATES.PUBLISHED : MEDIA_BLOCK_STATES.NONE;
  return sealBlock(state, items, unpublishable, VERIFIED_EVIDENCE_EMPTY_STATEMENT);
}

/**
 * THE CONTRACT — the entry point the convergence stage consumes.
 *
 * Both inputs are independent: a path may load one and not the other, and the block that was not
 * loaded says so rather than reporting a negative it never checked.
 *
 * ── THE TWO AUDIENCES ARE TWO PARAMETERS, ON PURPOSE ───────────────────────────────────────
 * `audience` governs EVIDENCE ROWS and nothing else. `listingAudience` + `listingPublicationStatus`
 * govern LISTING MEDIA and nothing else. Neither can reach the other's block, so a caller cannot
 * widen evidence by widening the gallery, and the publication state of a LISTING cannot suppress
 * evidence about a VEHICLE. Evidence is deliberately NOT gated by Rule 1b: a verified registration
 * document is a fact about the car and stays true whether or not anyone is advertising it, and
 * conflating listing content with vehicle truth is the error this whole phase exists to remove
 * (Rule 7). One parameter serving both would make that conflation a one-character mistake.
 *
 * ── THE LISTING GATE DEFAULTS CLOSED ───────────────────────────────────────────────────────
 * A caller that names no `listingPublicationStatus` and no `listingAudience` gets `not_loaded` for
 * the gallery: nothing published, nothing claimed. That is the SAFE direction for a projection that
 * feeds anonymous surfaces — a future read path that forgets the gate shows an empty gallery in
 * development instead of leaking an unpublished one in production — and it costs nothing to state,
 * since every real caller already holds the vehicle row the status lives on.
 *
 * @param {{listingImageRows?: Array<object>|null, evidenceRows?: Array<object>|null,
 *          audience?: 'public'|'owner', listingPublicationStatus?: string|null,
 *          listingAudience?: 'public'|'owner'}} [input]
 */
export function toVehicleMedia(input) {
  const {
    listingImageRows,
    evidenceRows,
    audience = 'public',
    listingPublicationStatus,
    listingAudience = LISTING_MEDIA_AUDIENCES.PUBLIC,
  } = input ?? {};
  return Object.freeze({
    listing_media: toGatedListingMediaBlock(listingImageRows, { listingPublicationStatus, listingAudience }),
    verified_evidence: toVerifiedEvidenceBlock(evidenceRows, { audience }),
  });
}

/**
 * Test/guard helper: dotted paths where THIS CONTRACT's own strings use governance language.
 * Values under `AUTHORED_BY_OTHERS` keys are skipped (see Rule 3). Keys are scanned as well as
 * values, so a block cannot smuggle a claim in as a field name.
 *
 * SCOPE: point it at a LISTING block (or at anything a listing surface renders). Pointed at the
 * whole contract it correctly flags `verified_evidence` — that block's entire job is to speak that
 * language, and a guard that stayed silent there would be measuring nothing.
 */
export function findTrustLanguage(node, prefix = '') {
  const hits = new Set();
  const seen = new Set();

  const flag = (path) => hits.add(path);
  const scan = (text, path) => {
    const lower = String(text).toLowerCase();
    if (TRUST_LANGUAGE.some((word) => lower.includes(word))) flag(path);
  };

  const walk = (value, path) => {
    if (typeof value === 'string') {
      scan(value, path);
      return;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((entry, i) => walk(entry, `${path}[${i}]`));
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      scan(key, childPath);
      if (AUTHORED_BY_OTHERS.includes(key)) continue;
      walk(entry, childPath);
    }
  };

  walk(node, prefix);
  return [...hits].sort();
}

/**
 * Test/guard helper: the disjointness proof run against a live payload. Returns the dotted paths
 * where an item carries a key belonging to the OTHER block's item shape — i.e. where a listing
 * photo has started to look like evidence, or evidence has started to look like a gallery slot.
 * An empty array means the two blocks are still structurally distinct in this body.
 */
export function findMediaBlockCrossContamination(media) {
  const offenders = [];
  const listingItems = media?.listing_media?.items;
  const evidenceItems = media?.verified_evidence?.items;

  if (Array.isArray(listingItems)) {
    listingItems.forEach((item, i) => {
      for (const key of Object.keys(item ?? {})) {
        if (EVIDENCE_MEDIA_ITEM_FIELDS.includes(key)) offenders.push(`listing_media.items[${i}].${key}`);
      }
    });
  }
  if (Array.isArray(evidenceItems)) {
    evidenceItems.forEach((item, i) => {
      for (const key of Object.keys(item ?? {})) {
        if (LISTING_MEDIA_ITEM_FIELDS.includes(key)) offenders.push(`verified_evidence.items[${i}].${key}`);
      }
    });
  }
  return offenders.sort();
}
