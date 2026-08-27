import { useParams, Link, useNavigate } from 'react-router-dom'
import { useState, useEffect, useCallback } from 'react'
import { PremiumEvidenceGallery } from '@/components/PremiumEvidenceGallery'
import VehicleLifeStageTimeline from '@/components/VehicleLifeStageTimeline'
import VehicleTemporalComparison from '@/components/VehicleTemporalComparison'
import VehicleDisclosurePanel from '@/components/VehicleDisclosurePanel'
import VehicleHistoryReport from '@/components/VehicleHistoryReport'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Car, CheckCircle, Shield, ShieldCheck, Gauge, Fuel, Settings2, MapPin, Calendar,
  Phone, MessageSquare, Heart, Share2, ArrowLeft, AlertTriangle, Search,
  FileCheck, Star, Loader2, Lock, CreditCard, ChevronLeft, ChevronRight,
  XCircle, HelpCircle, Wrench, UserCheck, TrendingDown, ClipboardCheck,
  Clock, Image as ImageIcon, FileText, FileSearch, Link2, Copy, GitCompare
} from 'lucide-react'
import { formatPrice } from '@/data/mockData'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { useAuth } from '@/context/AuthContext'
import { toast } from 'sonner'
import type {
  Vehicle,
  VehicleIdentity,
  VehiclePassport,
  TimelineEvent,
  VehicleLifecycleEvent,
  PassportVerificationSource,
  MarketplaceListingDetail,
  MarketplaceMedia,
  VehicleEvidence,
  EvidenceTaxonomyResponse,
  EvidenceSource,
  TemporalFinding,
  DisclosureConflict,
  VehicleHistoryReportData,
  TrustDecision,
} from '@/types'
import { TrustSummaryPanel } from '@/components/marketplace/TrustSummaryPanel'
import { SourceCoveragePanel } from '@/components/SourceCoveragePanel'
import { TrustDecisionPanel } from '@/components/TrustDecisionPanel'
import { AllInPricePanel } from '@/components/marketplace/AllInPricePanel'
import { SafetyWarnings } from '@/components/marketplace/SafetyWarnings'
import { InquiryModal } from '@/components/marketplace/InquiryModal'
import DisputePanel from '@/components/DisputePanel'
import { MarketplaceShareSheet } from '@/components/marketplace/MarketplaceShareSheet'
import { VehicleIntelligenceStory } from '@/components/marketplace/VehicleIntelligenceStory'
import { captureReferralFromUrl, getStoredAttribution } from '@/lib/marketplaceReferral'
import { governedLocationLine, summaryLocationLine, type LocationClaim } from '@/lib/governedLocation'

/** Minimal Vehicle hydrated from the governed marketplace detail (fallback when passport lookup misses). */
function vehicleFromMarketplaceDetail(d: MarketplaceListingDetail): Vehicle {
  return {
    vin: d.vin,
    id: d.vin,
    make: d.make,
    model: d.model,
    year: d.year,
    mileage: d.mileage,
    price: d.price,
    currency: d.currency,
    fuel_type: d.fuel_type || undefined,
    transmission: d.transmission || undefined,
    status: d.status,
    // `trust_score` is deliberately NOT carried over. It is the unversioned cache column, the page
    // renders no trust claim from it, and leaving it on the hydrated Vehicle is how a later edit
    // reaches for it as a fallback. The canonical projection is the only trust input here.
    //
    // `images` is not carried over either, and for the same reason. It used to be flattened here to
    // `string[]`, which threw away `is_primary`, the ordering and the ability to tell "the listing
    // gallery was never read" from "the listing has no photos". The gallery now reads the canonical
    // listing-media block off `detail.media` directly; a `Vehicle.images` array left on this object
    // is only a second, lossier copy for a later edit to reach for.
    location: d.location,
    sellerName: d.seller_summary?.display_label,
    sellerType: d.seller_summary?.seller_type === 'dealer' ? 'Dealership'
      : d.seller_summary?.seller_type === 'private' ? 'Private Owner'
      : undefined,
    created_at: d.created_at || undefined,
  } as Vehicle
}

// ── Governed identifier states ───────────────────────────────────────────────
/**
 * The passport identity block carries `identifiersRedacted`, which the shared
 * VehicleIdentity type does not declare yet.
 */
type PassportIdentity = VehicleIdentity & { identifiersRedacted?: boolean }

/**
 * A governed identifier has three distinct truths and the page must never collapse them:
 * `withheld` means this audience is not allowed to see it, `unrecorded` means it does not
 * exist. Withheld is a rule about the caller — never a data-quality finding about the
 * vehicle, and never an input to a confidence or trust claim.
 */
type IdentifierState = 'present' | 'withheld' | 'unrecorded'

function identifierState(value: string | null | undefined, redacted: boolean): IdentifierState {
  if (value) return 'present'
  return redacted ? 'withheld' : 'unrecorded'
}

// ── The canonical media contract, client side (Issue #164 Phase 5) ───────────
/**
 * TWO CONCEPTS THAT LOOK ALIKE AND ARE NOT ALIKE. `backend/utils/vehicleMediaProjection.js` is the
 * canonical statement of this contract; the declarations below are its client mirror, because
 * `web/` resolves only `@/*` and `@shared/*` and cannot import from `backend/`. The mirror is kept
 * honest by `VehicleDetail.media.test.tsx`, which reads the backend module's source and asserts
 * that the two empty statements here are that module's exported sentences character-for-character,
 * and that every field this page publishes on an evidence item is in Phase 0's allow-list.
 *
 *   LISTING MEDIA    — the seller's marketing photos. UNVERIFIED, and unverifiable: `listing_images`
 *                      is (id, vin, image_url, is_primary, display_order, created_at). There is no
 *                      uploader, no capture time, no reviewer and no status in the row, so any trust
 *                      word attached to a listing photo is authored by this renderer and asserted on
 *                      the seller's behalf.
 *   VERIFIED EVIDENCE — governed artifacts with provenance and a review decision.
 *
 * ── THE DEFECT THIS CLOSES ─────────────────────────────────────────────────────────────────
 * Marketplace served a card image for a VIN while this page said "No verified images uploaded yet"
 * for the same VIN. `lookupVehiclePassport` runs first and RETURNS EARLY on success, and the gallery
 * was hydrated from `passportData.vehicle.images` — but the passport projects `vehicles` through
 * `PUBLIC_VEHICLE_FIELDS` and `vehicles` has no image column. `listing_images` is a separate table
 * that the passport path never reads. So `d.images` was `undefined`, the gallery went empty, and the
 * placeholder fired for a car whose photos were sitting on the Marketplace card.
 *
 * THE SENTENCE WAS THE SECOND DEFECT AND THE WORSE ONE. It answered a question about EVIDENCE with a
 * control that renders LISTING MEDIA, stating a governance finding ("nothing here is verified") over
 * a seller's advertising photos, which are never verified by anything. Fixing only the plumbing
 * would have left it in place, and it would then have been false in the other direction: three
 * seller photos rendering under a control that had just called them unverified.
 *
 * ── RULE 1: A BLOCK THAT WAS NEVER READ MAY NOT SAY "NONE" ─────────────────────────────────
 * That is why `not_loaded` exists, and it is the defect turned into a state.
 *
 *   `not_loaded` — this page did not consult the source. Nothing is claimed in either direction.
 *   `none`       — the source WAS consulted and holds nothing publishable. That is a finding, and
 *                  it gets a sentence.
 *   `published`  — at least one item.
 *
 * On this page the ONLY reader of `listing_images` is the governed marketplace detail, whose `media`
 * array is built from exactly the rows the Marketplace card is built from. So a vehicle that has no
 * public marketplace listing yields `not_loaded`, never `none`: this page genuinely does not know
 * whether that seller uploaded photos, and it now says so instead of publishing a confident negative
 * about a table it never queried.
 *
 * ── RULE 2: THE TWO EMPTY STATES ARE DIFFERENT SENTENCES, AND NEITHER IMPLIES THE OTHER ────
 * A vehicle with photos and no evidence, and a vehicle with evidence and no photos, are both
 * ordinary. On staging they are not hypothetical and they do not overlap: three VINs carry a listing
 * image and zero evidence, one VIN carries one verified evidence row and zero listing images, and
 * twelve carry neither. Not one of the sixteen has both. The single sentence that shipped was wrong
 * for every one of those four situations.
 *
 * ── RULE 5: URL HONESTY ────────────────────────────────────────────────────────────────────
 * A media URL is an unvalidated string somebody recorded — the write path stores `image_url: url`
 * verbatim with no scheme, host, length or existence check. `url_form` describes the STRING and
 * nothing else. A value this contract will not publish (`data:`, `blob:`, `javascript:`, a bare
 * `photo.jpg` that would resolve against `/marketplace/<VIN>`, a blank, a non-string) is COUNTED,
 * never silently dropped: passing "we could not render it" off as "the seller added none" is the
 * same lie as Rule 1, one layer down.
 */
type MediaBlockState = 'published' | 'none' | 'not_loaded'

type MediaUrlForm = 'absolute_https' | 'absolute_http' | 'protocol_relative' | 'site_relative'

/**
 * The two sentences, character-for-character as `vehicleMediaProjection.js` exports them. They are
 * imported-by-assertion rather than by module, so the wording cannot drift apart silently — "No
 * verified images uploaded yet" was authored in this very file, which is precisely how a marketing
 * gallery came to publish a governance finding.
 */
// UPDATED TO FOLLOW THE CONTRACT, NOT REWORDED HERE. `vehicleMediaProjection.js` changed this
// sentence from "No photos have been added to this listing." under its Rule 1b: an unpublished
// listing's gallery is now gated, and the gated block is BYTE-IDENTICAL to a published-and-empty
// one, so the sentence had to become true of three cases at once — nothing published because the
// listing is not published, because the seller added none, and because every recorded row was
// unpublishable. The old wording asserted the seller's behaviour and was false in two of them.
// The mirror-by-assertion below is what caught the drift the moment it happened.
const LISTING_MEDIA_EMPTY_STATEMENT = 'No photos are published for this listing.'
const VERIFIED_EVIDENCE_EMPTY_STATEMENT = 'No verified evidence has been published for this vehicle.'

/** The uniform envelope. Both blocks carry it; their ITEM shapes are what differ. */
type MediaBlock<TItem> = {
  state: MediaBlockState
  items: TItem[]
  unpublishable_count: number
  empty_statement: string | null
}

/**
 * A listing-media item. Shares NOT ONE KEY NAME with an evidence item — see Rule 7 below.
 *
 * RULE 6b: `media_id` IS THE IDENTITY; `position` IS ONLY A SLOT. `position` is this projection's
 * dense ordinal, so it changes whenever a sibling row moves and it is `0` on the first photo of
 * every vehicle. `url` is no better as an identity: it survives being rewritten by a CDN or a resize
 * and it can collide, since 3 of 3 rows in staging are site-relative `/uat/owner/*.svg` paths with
 * no uniqueness constraint behind them. Only `media_id` — `listing_images.id`, a stored uuid — names
 * the same photograph across two reads and two surfaces.
 *
 * It is `media_id` rather than `id` because an evidence item already carries `id`; one key name on
 * both shapes would collapse the Rule 7 disjointness proof.
 *
 * `null` MEANS THIS TRANSPORT DID NOT CARRY ONE, and is never a fabricated value. It is READ, never
 * assumed: every transport is asked for `media_id` and `toMediaIdentity` decides whether what came
 * back is an identity. Deriving one from the array index or from the URL would manufacture exactly
 * the unstable value this field exists to replace, so when nothing was carried the honest answer is
 * to say so.
 *
 * CORRECTED AT THIS SHA. This comment used to record a finding — "the marketplace transport maps
 * only `{url, type, is_primary}` and drops `id`" — and `toListingMediaBlock` hardcoded `null` on
 * the strength of it. That is no longer true: `marketplaceListingDetailService` now publishes the
 * canonical `listing_media` envelope AND a `media` compatibility view carrying `media_id`,
 * `url_form` and `position`. Hardcoding `null` against a wire that now carries the identity would
 * discard a fact we have, which is the same class of defect as inventing one we do not.
 */
type ListingMediaItem = {
  media_id: string | null
  url: string
  url_form: MediaUrlForm
  position: number
  is_primary: boolean
  synthetic_demo: boolean
}

/**
 * The canonical UUID grammar, and nothing else — anchored, so no value carrying a `/`, a `.`, a
 * space, a bucket name or a file extension can pass. Mirrors MEDIA_IDENTITY_PATTERN in
 * backend/utils/vehicleMediaProjection.js.
 *
 * Re-validated here rather than trusted, on this file's standing rule that nothing crosses the wire
 * unchecked: a regressed server must not be able to push a storage path onto the page by putting it
 * in the `media_id` slot of a canonical-looking envelope.
 */
const MEDIA_IDENTITY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The wire value as a stable opaque identity, or `null` when it is not one. Case-normalised. */
function toMediaIdentity(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!MEDIA_IDENTITY_PATTERN.test(trimmed)) return null
  return trimmed.toLowerCase()
}

/**
 * Classify a media URL string. `null` means unpublishable. Order matters: `//` must be tested before
 * the single-slash case, or a foreign host would be published as if it resolved against our origin.
 */
function classifyMediaUrl(url: unknown): MediaUrlForm | null {
  if (typeof url !== 'string') return null
  const trimmed = url.trim()
  if (trimmed === '') return null
  if (trimmed.startsWith('//')) return 'protocol_relative'
  if (trimmed.startsWith('/')) return 'site_relative'
  const lower = trimmed.toLowerCase()
  if (lower.startsWith('https://')) return 'absolute_https'
  if (lower.startsWith('http://')) return 'absolute_http'
  return null
}

function sealBlock<TItem>(
  state: MediaBlockState,
  items: TItem[],
  unpublishableCount: number,
  emptyStatement: string,
): MediaBlock<TItem> {
  return {
    state,
    items,
    unpublishable_count: unpublishableCount,
    // A sentence belongs to `none` alone. `published` has items to speak for it, and `not_loaded`
    // has nothing to say — rendering a statement there is the defect this contract closes.
    empty_statement: state === 'none' ? emptyStatement : null,
  }
}

function notLoadedBlock<TItem>(): MediaBlock<TItem> {
  return { state: 'not_loaded', items: [], unpublishable_count: 0, empty_statement: null }
}

/**
 * The `media` array AS BYTES, which is a different statement from the one the contract makes.
 *
 * FINDING CLOSED, AND THE CLOSURE IS RECORDED BECAUSE THE FINDING WAS. This slot used to read
 * `MarketplaceMedia & { media_id?: unknown }`, with a note that `shared/types/marketplace.ts` still
 * declared `{ url, type, is_primary? }` while the service published `media_id`, `url_form` and
 * `position` — the declared type being a strict SUBSET of the wire. That gap is now closed AT THE
 * CONTRACT: `MarketplaceMedia` extends `MarketplaceListingMediaItem`, and `MarketplaceListingDetail`
 * declares `listing_media`. The page no longer widens a cross-surface type from inside a .tsx file,
 * which is the mistake that put a governance sentence in a component in the first place.
 *
 * THE PAGE STILL DOES NOT TRUST IT, and the two facts are not in tension. A declaration binds the
 * CONTRACT; it does not bind the BYTES a particular deploy sends. A server predating the widened
 * view carries no `media_id` at all, and a regressed one could put a storage path there. So every
 * key is re-widened to `unknown` and a validator decides: `classifyMediaUrl` for the url,
 * `toMediaIdentity` for the identity, `=== true` for the flag.
 *
 * DERIVED from the shared type rather than restated, via `keyof`. If the contract gains a key this
 * view gains it too, so the page cannot quietly go on reading a shape the contract has moved past —
 * which is exactly how the previous local widening survived a whole phase after it stopped being
 * true.
 */
type WireMarketplaceMedia = { [K in keyof MarketplaceMedia]?: unknown }

/**
 * THE LISTING-MEDIA BLOCK — the gallery.
 *
 * `undefined`/`null` in means THIS PAGE DID NOT LOOK and yields `not_loaded`. An array in — `[]`
 * included — means it looked.
 *
 * RULE 6: PRIMACY IS THE SELLER'S CHOICE OR IT DOES NOT EXIST. `is_primary` is published `true` only
 * where a row claims it; no primary is elected when nobody claimed one, because ordering and primacy
 * are different facts and inventing the seller's choice is a fabrication in the same family as the
 * seller labels Phase 4 removed. Nothing in the schema prevents several rows claiming primacy (there
 * is no partial unique index on `(vin) WHERE is_primary`), so the first in sort order keeps the claim
 * and the rest are demoted — a consumer never has to arbitrate between two "main photos".
 */
function toListingMediaBlock(rows: WireMarketplaceMedia[] | null | undefined): MediaBlock<ListingMediaItem> {
  if (!Array.isArray(rows)) return notLoadedBlock()

  let unpublishable = 0
  const candidates: Array<{ mediaId: string | null; url: string; form: MediaUrlForm; claimsPrimary: boolean; syntheticDemo: boolean; index: number }> = []
  const identitiesTaken = new Set<string>()
  rows.forEach((row, index) => {
    // Video and document entries are not gallery photos. They are not "unpublishable" either — the
    // block simply is not about them, so counting them would overstate a fault.
    if (row?.type !== 'image') return
    const form = classifyMediaUrl(row?.url)
    // Rule 6b, and the same re-validation the canonical transport gets: the identity is READ from
    // the entry and checked against the grammar, never taken on trust and never hardcoded. An
    // entry that carries none — a server predating the widened compat view — yields `null` here
    // BECAUSE `toMediaIdentity` refused what it was given, which is a fact about the payload
    // rather than a decision this function made on the payload's behalf.
    const mediaId = toMediaIdentity(row?.media_id)
    // Rule 6b's uniqueness half, resolved in INPUT ORDER exactly as the backend block does — before
    // the sort below, so the surviving entry is the same one whichever way the payload happened to
    // be ordered, and a duplicate can never take the primacy claim from the entry that outranked it
    // on arrival. Counted, never silently dropped. `null` is exempt for the reason recorded at the
    // bottom of this function: an unnamed photograph is still a photograph.
    if (form === null || (mediaId !== null && identitiesTaken.has(mediaId))) {
      unpublishable += 1
      return
    }
    if (mediaId !== null) identitiesTaken.add(mediaId)
    candidates.push({
      mediaId,
      url: String(row.url).trim(),
      form,
      claimsPrimary: row.is_primary === true,
      syntheticDemo: row.synthetic_demo === true || String(row.url).includes('/marketplace-reference-synthetic/'),
      index,
    })
  })

  // The server already ordered these (primary first, then display_order). Sorting again on the one
  // fact that survives into `MarketplaceMedia` keeps primacy at position 0 without inventing an
  // order the payload does not carry; `index` breaks ties, so the server's order is preserved.
  candidates.sort((a, b) => {
    if (a.claimsPrimary !== b.claimsPrimary) return a.claimsPrimary ? -1 : 1
    return a.index - b.index
  })

  let primaryTaken = false
  const items = candidates.map((candidate, position) => {
    const isPrimary = candidate.claimsPrimary && !primaryTaken
    if (isPrimary) primaryTaken = true
    // Carried from the entry, NEVER derived from `position` or from the URL: an index-derived value
    // is `0` on the first photo of every vehicle and moves whenever a sibling row moves, which is
    // the precise instability Rule 6b exists to eliminate. `null` reaches here only when
    // `toMediaIdentity` refused the wire value — no identity was carried, or what was carried was
    // not one — and an absent `data-media-id` is the page saying exactly that.
    //
    // DELIBERATE DIVERGENCE FROM THE BACKEND BLOCK, recorded so the mirror pin is not over-read:
    // `toListingMediaBlock` in `backend/utils/vehicleMediaProjection.js` counts an identity-less row
    // as unpublishable and emits NO item, because it reads `listing_images` where `id` is a stored
    // uuid and its absence means the row is malformed. This function reads a WIRE payload, where a
    // server predating the widened compat view legitimately carries no identity at all. Dropping
    // those photos would blank the gallery of every such vehicle — the original defect, re-entered
    // through the identity door. A photograph we cannot name is still a photograph the seller
    // added; only the ability to NAME it is missing, and the page says which.
    return { media_id: candidate.mediaId, url: candidate.url, url_form: candidate.form, position, is_primary: isPrimary, synthetic_demo: candidate.syntheticDemo }
  })

  return sealBlock(items.length ? 'published' : 'none', items, unpublishable, LISTING_MEDIA_EMPTY_STATEMENT)
}

/**
 * RULE 4: EVIDENCE KEEPS PHASE 0's ALLOW-LIST, NARROWED — NEVER WIDENED.
 *
 * Every name here is in `PUBLIC_EVIDENCE_FIELDS` (`backend/utils/publicVehicleProjection.js`), and
 * the media test asserts that containment against the backend source, so this page can only ever
 * publish a subset of what Phase 0 already cleared. `uploaded_by`, `verified_by`, `uploader_role`,
 * `tenant_id`, `source_id`, `file_path`, `storage_bucket`, `verification_notes` and `metadata` are
 * therefore unreachable from this projection FOR EVERY AUDIENCE — an item is built field by field,
 * so a server that regressed and sent an uploader id could not push it into the DOM through here.
 *
 * The web `VehicleEvidence` type still declares `uploaded_by: string` as required, which is exactly
 * why the projection exists: the type says the identity is there, and the contract says it never
 * leaves the server.
 */
const VEHICLE_DETAIL_EVIDENCE_FIELDS = [
  'id', 'vin', 'evidence_type', 'evidence_class', 'evidence_subtype',
  'event_type', 'event_date', 'captured_at', 'uploaded_at', 'verified_at',
  'verification_status', 'visibility_level',
  'file_url', 'mime_type', 'source_name', 'checksum', 'image_hash',
  'linked_registry_event_id', 'timeline_event_id',
] as const

/**
 * Apply the allow-list. ONE function, used by both transports, so "which fields may be published"
 * is answered in exactly one place. Nothing is spread: the item is built field by field, which is
 * what makes an internal identity structurally unreachable rather than merely unrendered today.
 */
function pickPublicEvidenceFields(row: unknown): Record<string, string | null> {
  const source = (row ?? {}) as Record<string, unknown>
  const projected = {} as Record<string, string | null>
  for (const field of VEHICLE_DETAIL_EVIDENCE_FIELDS) {
    const value = source[field]
    // Absent stays absent-as-null; no default is invented, and a non-scalar (an object a server
    // nested under an allow-listed name) is refused rather than stringified into the page.
    projected[field] = typeof value === 'string' || typeof value === 'number' ? String(value) : null
  }
  return projected
}

/**
 * An evidence item: the allow-listed fields plus the url-form classification of `file_url`. Named
 * `file_url_form`, not `url_form`, so the two item shapes stay KEY-DISJOINT.
 *
 * RULE 7: THE BLOCKS ARE DISJOINT BY CONSTRUCTION, NOT BY DISCIPLINE. A listing item's keys are
 * {media_id, url, url_form, position, is_primary} and an evidence item's are the names above; they
 * share not one — which is why the listing identity is `media_id` and not `id`, since `id` is
 * already the first field of the evidence allow-list. That is what makes "these can never be conflated" an assertion a test can run rather than a
 * convention a reviewer has to enforce by eye. The same URL may legitimately appear in both blocks
 * and that is not conflation — provenance rides the ITEM, not the string, and de-duplicating across
 * the blocks would make one of two independent claims disappear.
 */
type VerifiedEvidenceItem =
  { [K in (typeof VEHICLE_DETAIL_EVIDENCE_FIELDS)[number]]: string | null }
  // `file_url_form` is nullable ONLY for a withheld artifact: there is no URL to classify, and
  // inventing a form for a file that was deliberately not published would be a claim about an
  // address that does not exist. `MediaUrlForm` itself is unchanged — the union still describes
  // exactly the forms a REAL url can take.
  & { file_url_form: MediaUrlForm | null; file_availability?: EvidenceFileAvailability }

/**
 * Whether the ARTIFACT can be shown, which is a separate question from whether the FACT is published.
 *
 * `withheld_private` means the document is real, reviewed, and deliberately not exported — it lives in
 * the private bucket and no signed URL is minted for a public caller. The row is still a governed
 * fact and must render as one.
 */
type EvidenceFileAvailability = 'viewable' | 'withheld_private'

/**
 * The public gate, re-applied on the client: `visibility_level === 'public_safe' AND
 * verification_status === 'verified'`. `buildVehiclePassport` already filters in SQL; re-applying it
 * means a route that ever forgot the filter cannot leak restricted evidence through this surface. A
 * row missing either column FAILS — absence is not permission, and it is also what stops a
 * `listing_images` row (which has neither column) from being rendered as evidence.
 */
function isEvidenceRowClearedForPublic(row: VehicleEvidence | null | undefined): boolean {
  if (!row || typeof row !== 'object') return false
  return row.visibility_level === 'public_safe' && row.verification_status === 'verified'
}

/**
 * THE VERIFIED-EVIDENCE BLOCK — governed artifacts, each with provenance and a review decision.
 *
 * A row this audience may not see is NOT counted anywhere: publishing "2 withheld" over a restricted
 * evidence set would tell an anonymous visitor that restricted evidence exists, which is the very
 * question the gate refuses. A row that is cleared and then unrenderable IS counted — that is our
 * defect, not the vehicle's, and the block must not pass it off as "no verified evidence".
 */
function toVerifiedEvidenceBlock(
  rows: VehicleEvidence[] | null | undefined,
): MediaBlock<VerifiedEvidenceItem> {
  if (!Array.isArray(rows)) return notLoadedBlock()

  let unpublishable = 0
  const items: VerifiedEvidenceItem[] = []
  for (const row of rows) {
    if (!isEvidenceRowClearedForPublic(row)) continue
    const form = classifyMediaUrl(row.file_url)
    if (form === null) {
      unpublishable += 1
      continue
    }
    items.push({ ...pickPublicEvidenceFields(row), file_url_form: form } as VerifiedEvidenceItem)
  }

  return sealBlock(items.length ? 'published' : 'none', items, unpublishable, VERIFIED_EVIDENCE_EMPTY_STATEMENT)
}

// ── The contract's OTHER transport: the passport's own media blocks ──────────
/**
 * TWO TRANSPORTS, ONE CONTRACT — the same arrangement this page already runs for trust.
 *
 * `buildVehiclePassport` now composes `toVehicleMedia(...)` and spreads `listing_media` and
 * `verified_evidence` onto the passport body. That is the CANONICAL transport: it reads
 * `listing_images` directly, so it can answer for a vehicle that has no public marketplace listing
 * at all — the case where the derived block below can only ever say `not_loaded`. The marketplace
 * detail remains the second transport and the fallback, and both carry the same declared shape.
 *
 * A body that does not carry the key is NOT an empty gallery. `state` is the discriminator and it is
 * REQUIRED, exactly as `evaluation_state` is for the trust projection: a response missing it parses
 * as NOTHING rather than as a media block, so a server that has not been updated makes this page
 * fall back rather than publish a negative nobody asserted.
 *
 * NOTHING IS TRUSTED ACROSS THE WIRE. URLs are re-classified and evidence items are re-picked
 * through the same allow-list the derived path uses, so a server that regressed cannot push an
 * uploader id or a `javascript:` URL onto the page by putting it in a canonical-looking envelope.
 */
type RawMediaBlock = {
  state: MediaBlockState
  items: Array<Record<string, unknown>>
  unpublishable_count: number
}

function readMediaBlockEnvelope(raw: unknown): RawMediaBlock | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const block = raw as Record<string, unknown>
  const state = block.state
  if (state !== 'published' && state !== 'none' && state !== 'not_loaded') return null
  if (!Array.isArray(block.items)) return null
  const count = block.unpublishable_count
  return {
    state,
    items: block.items.filter(
      (entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry),
    ),
    unpublishable_count: typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0,
  }
}

/**
 * Re-derive the state from what SURVIVED our own checks. If the server published items and none of
 * them is renderable here, that is `none` WITH a count — never `published` with an empty list, and
 * never a silent drop.
 */
function stateFor(itemCount: number, envelopeState: MediaBlockState): MediaBlockState {
  if (itemCount > 0) return 'published'
  return envelopeState === 'not_loaded' ? 'not_loaded' : 'none'
}

function readListingMediaBlock(raw: unknown): MediaBlock<ListingMediaItem> | null {
  const envelope = readMediaBlockEnvelope(raw)
  if (!envelope) return null

  let unpublishable = envelope.unpublishable_count
  const items: ListingMediaItem[] = []
  const identitiesTaken = new Set<string>()
  let primaryTaken = false
  for (const entry of envelope.items) {
    const form = classifyMediaUrl(entry.url)
    // Re-validated, not trusted (Rule 6b). A server that regressed cannot put `qa/evidence-73.jpg`
    // or a bucket name in this slot and have the page treat it as an identity: anything outside the
    // UUID grammar becomes `null`, which reads as "this transport carried no identity" rather than
    // as a locator the page would then be free to render or log.
    const mediaId = toMediaIdentity(entry.media_id)
    // RULE 6b, UNIQUENESS — the half this reader used to skip. Grammar and primacy were both
    // re-arbitrated off the wire and uniqueness was not, so a payload carrying ONE media_id on TWO
    // urls rendered two thumbnails under one name (measured: two `data-media-id` attributes with
    // the same value, and React's "Encountered two children with the same key" on the very key the
    // comment below says exists so the node follows the picture rather than the slot). Not
    // reachable from today's server, where `id` is the row's primary key — but this file's posture
    // is that nothing is trusted across the wire, and a re-check that stops one field short of the
    // guarantee it is protecting is not a re-check.
    //
    // Matched to `toListingMediaBlock` in `backend/utils/vehicleMediaProjection.js`, which resolves
    // duplicates in INPUT order (first occurrence keeps the identity) and COUNTS the loser in
    // `unpublishable_count` rather than dropping it silently — because "we could not publish it" is
    // not "the seller added none". Same rule here, and the entry is discarded BEFORE the primacy
    // arbitration below, so a demoted duplicate can never consume the seller's one primacy claim.
    //
    // `null` identities are exempt, and that is the SAME deliberate divergence recorded on
    // `toListingMediaBlock` below rather than a second one: a server predating the widened contract
    // carries no identity on ANY entry, and treating "unnamed" as "already taken" would blank every
    // such gallery from the second photo on — the original defect, re-entered through the identity
    // door. Only a name that was actually carried can be claimed twice.
    if (form === null || (mediaId !== null && identitiesTaken.has(mediaId))) {
      unpublishable += 1
      continue
    }
    if (mediaId !== null) identitiesTaken.add(mediaId)
    const isPrimary = entry.is_primary === true && !primaryTaken
    if (isPrimary) primaryTaken = true
    items.push({
      media_id: mediaId,
      url: String(entry.url).trim(),
      url_form: form,
      position: items.length,
      is_primary: isPrimary,
      synthetic_demo: entry.synthetic_demo === true || String(entry.url).includes('/marketplace-reference-synthetic/'),
    })
  }
  // The SENTENCE is ours, not the server's. `empty_statement` arrives on the wire, but rendering a
  // server-supplied string into a governance-sensitive empty state is exactly how "No verified
  // images uploaded yet" would come back through a new door. The two constants are asserted equal
  // to the contract's exported ones, so this cannot drift into a disagreement.
  return sealBlock(stateFor(items.length, envelope.state), items, unpublishable, LISTING_MEDIA_EMPTY_STATEMENT)
}

function readVerifiedEvidenceBlock(raw: unknown): MediaBlock<VerifiedEvidenceItem> | null {
  const envelope = readMediaBlockEnvelope(raw)
  if (!envelope) return null

  let unpublishable = envelope.unpublishable_count
  const items: VerifiedEvidenceItem[] = []
  for (const entry of envelope.items) {
    const form = classifyMediaUrl(entry.file_url)

    // A WITHHELD FILE IS NOT A MISSING RECORD.
    //
    // This loop re-derives the server's verdict, and it used to re-derive the server's BUG with it:
    // `classifyMediaUrl(null)` returns null, so a deliberately withheld private document was counted
    // as unpublishable and dropped — which is how four verified, reviewed documents still rendered as
    // "No verified evidence has been published for this vehicle" AFTER the backend had been fixed to
    // publish them. Fixing only the server would have left this surface telling the same untruth.
    //
    // `file_availability: 'withheld_private'` is the server stating that the artifact is real and
    // deliberately not exported. The fact is published; only the file is absent.
    const availability = (entry as { file_availability?: unknown }).file_availability
    if (availability === 'withheld_private') {
      items.push({
        ...pickPublicEvidenceFields(entry),
        file_url: null,
        file_url_form: null,
        file_availability: 'withheld_private',
      } as VerifiedEvidenceItem)
      continue
    }

    if (form === null) {
      // Names no artifact this surface can render and was not declared withheld: still our defect.
      unpublishable += 1
      continue
    }
    items.push({
      ...pickPublicEvidenceFields(entry),
      file_url_form: form,
      file_availability: 'viewable',
    } as VerifiedEvidenceItem)
  }
  return sealBlock(stateFor(items.length, envelope.state), items, unpublishable, VERIFIED_EVIDENCE_EMPTY_STATEMENT)
}

/**
 * The passport keys the media contract is spread onto.
 *
 * STILL DECLARED LOCALLY, and NOT for the reason its neighbour used to be. `VehiclePassport` is the
 * passport body's type, not the marketplace contract, so widening it is a different lane's contract
 * and not something this phase's shared-type work reaches. `unknown` rather than the declared block
 * type is also the right shape here for the same reason it is on `WireMarketplaceMedia`:
 * `readMediaBlockEnvelope` must be handed something it is obliged to validate.
 */
type PassportMediaTransport = { listing_media?: unknown; verified_evidence?: unknown }

/**
 * Choose between two TRANSPORTS: THE ONE THAT ACTUALLY LOOKED WINS, and when neither looked the
 * answer is `not_loaded`. A `not_loaded` block is not a tie-breaker candidate — preferring it over a
 * transport that did read the source would reinstate the defect with extra steps.
 *
 * NOTE THE SCOPE, because it is the distinction a mutation on this lane forced into the open. This
 * chooses between transports — two SEPARATE READS of the source, by two different routes, either of
 * which may not have happened. It does NOT choose between two VIEWS of one read: within a single
 * payload the canonical envelope is the authority and its weaker views are not second opinions. See
 * `marketplaceBlock` below.
 */
function resolveMediaBlock<TItem>(
  canonical: MediaBlock<TItem> | null,
  derived: MediaBlock<TItem>,
): MediaBlock<TItem> {
  if (canonical && canonical.state !== 'not_loaded') return canonical
  if (derived.state !== 'not_loaded') return derived
  return notLoadedBlock<TItem>()
}

/**
 * RULE 8: `dealer_listing` EVIDENCE IS EVIDENCE ABOUT AN ADVERTISEMENT.
 *
 * `vehicle_evidence.evidence_type` permits `dealer_listing_photo`, and `evidence_class_taxonomy`
 * carries the class `dealer_listing`. Such a row stays in the EVIDENCE block — it is a governed
 * artifact with provenance and a review decision — but its `verified` status attests THAT THIS WAS
 * THE ADVERTISED PHOTO and attests nothing about the vehicle. It is never copied into the gallery
 * either: the gallery is the seller's CURRENT presentation, and a captured historical advertisement
 * is not that. So it must not be described with the language used for an inspection photo.
 */
function isAdvertisementEvidence(item: VerifiedEvidenceItem): boolean {
  return item.evidence_class === 'dealer_listing'
    || (item.evidence_type ?? '').startsWith('dealer_listing')
}

/** `snake_case_type` → `Snake case type`, so an unmapped taxonomy value stays readable and visible. */
function humaniseEvidenceType(item: VerifiedEvidenceItem): string {
  const raw = item.evidence_subtype || item.evidence_type
  if (!raw) return 'Evidence type not recorded'
  const spaced = raw.replace(/_/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** A date the buyer can read, or an explicit statement that it was never recorded. */
function evidenceDate(value: string | null): string {
  if (!value) return 'not recorded'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'not recorded' : parsed.toLocaleDateString()
}

// ── localStorage helpers ─────────────────────────────────────────────────────
function getFavorites(): string[] {
  try { return JSON.parse(localStorage.getItem('carup_favorites') || '[]') } catch { return [] }
}

// ── Timeline event icon & color mapping ────────────────────────────────────
function timelineIcon(source: string) {
  const map: Record<string, { icon: typeof Wrench; color: string }> = {
    service:            { icon: Wrench,        color: 'text-blue-600 bg-blue-50' },
    ownership_transfer: { icon: UserCheck,     color: 'text-purple-600 bg-purple-50' },
    insurance:          { icon: Shield,        color: 'text-green-600 bg-green-50' },
    escrow:             { icon: Lock,          color: 'text-amber-600 bg-amber-50' },
    zimra:              { icon: ClipboardCheck,color: 'text-orange-600 bg-orange-50' },
    cvr:                { icon: FileCheck,     color: 'text-teal-600 bg-teal-50' },
    vid:                { icon: CheckCircle,   color: 'text-green-700 bg-green-50' },
    cid:                { icon: Shield,        color: 'text-red-600 bg-red-50' },
    zinara:             { icon: TrendingDown,  color: 'text-gray-600 bg-gray-50' },
    plate_assigned:      { icon: FileCheck,     color: 'text-blue-600 bg-blue-50' },
    temporary_id_issued: { icon: ClipboardCheck,color: 'text-amber-600 bg-amber-50' },
    plate_verified:      { icon: CheckCircle,   color: 'text-green-600 bg-green-50' },
    plate_changed:       { icon: Calendar,      color: 'text-purple-600 bg-purple-50' },
    plate_flagged:       { icon: AlertTriangle, color: 'text-red-600 bg-red-50' },
    plate_suspended:     { icon: XCircle,       color: 'text-red-700 bg-red-50' },
    evidence:            { icon: ImageIcon,     color: 'text-orange-600 bg-orange-50' },
  }
  return map[source] ?? { icon: Clock, color: 'text-gray-500 bg-gray-50' }
}

function lifecycleIcon(category: string) {
  const map: Record<string, { icon: typeof Wrench; color: string }> = {
    import:             { icon: ClipboardCheck, color: 'text-sky-700 bg-sky-50' },
    auction:            { icon: Car,            color: 'text-violet-700 bg-violet-50' },
    accident:           { icon: AlertTriangle,  color: 'text-red-700 bg-red-50' },
    repair:             { icon: Wrench,         color: 'text-amber-700 bg-amber-50' },
    service:            { icon: Wrench,         color: 'text-blue-700 bg-blue-50' },
    inspection:         { icon: CheckCircle,    color: 'text-emerald-700 bg-emerald-50' },
    ownership_transfer: { icon: UserCheck,      color: 'text-purple-700 bg-purple-50' },
    registration:       { icon: FileCheck,      color: 'text-teal-700 bg-teal-50' },
    insurance:          { icon: Shield,         color: 'text-green-700 bg-green-50' },
    clearance:          { icon: ShieldCheck,    color: 'text-indigo-700 bg-indigo-50' },
    dealer_listing:     { icon: Car,            color: 'text-orange-700 bg-orange-50' },
    current_condition:  { icon: Gauge,          color: 'text-slate-700 bg-slate-100' },
  }
  return map[category] ?? { icon: Clock, color: 'text-gray-500 bg-gray-50' }
}

function lifecycleStatusLabel(event: VehicleLifecycleEvent): string {
  if (event.detail_state === 'summary_only') return 'Recorded · detail private'
  if (event.verification_status === 'seller_stated') return 'Seller stated'
  if (event.verification_status === 'verified') return 'Verified'
  if (event.verification_status === 'active') return 'Active'
  if (event.verification_status) return event.verification_status.replace(/_/g, ' ')
  return 'Recorded'
}

// Removed formatEvidenceLabel since it is no longer used here

/**
 * The passport's non-score signals. These moved from `trustReport.metrics` to `trustSignals` when
 * `trustReport` became the canonical projection (server.js: "Kept OUT of trustReport because that
 * object's key set is the public trust contract"). They are FACTS OBSERVED, never a verdict — the
 * backend even stamps `signals_are_not_a_trust_score: true` on them — so nothing here is combined
 * into a score.
 */
type TrustSignals = {
  cvr_synced?: boolean
  zimra_duty?: boolean
  zrp_police_cleared?: boolean
  odometer_consistent?: boolean
  maintenance_logs_count?: number
  stolen_alert_active?: boolean
}

function readTrustSignals(passport: VehiclePassport | null): TrustSignals | null {
  const raw = (passport as { trustSignals?: unknown } | null | undefined)?.trustSignals
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw as TrustSignals
}

// ── Derive Verification sources from passport data ──────────────────────────
/**
 * WHEN NO SIGNALS WERE REPORTED, NOTHING IS CLAIMED IN EITHER DIRECTION. Every row below used to
 * collapse "the passport reported nothing" into the negative branch, which published sentences like
 * "No active stolen vehicle alert" and "CID check passed" off an absent object — a clean bill of
 * health fabricated from a missing field. Absent signals now render `unknown`.
 */
function buildVerificationSources(passport: VehiclePassport | null): PassportVerificationSource[] {
  if (!passport) return []

  const m = readTrustSignals(passport)
  const chain = passport.chainVerification

  const sources: PassportVerificationSource[] = [
    {
      label: 'VIN / Ledger Integrity',
      status: chain?.verified ? 'verified' : 'not_verified',
      detail: chain?.verified
        ? 'CarUp audit ledger hash chain verified — no tampering detected'
        : 'Ledger integrity check failed or no events recorded',
    },
  ]

  if (!m) {
    // The passport carried no signal report. Say that, once, instead of seven fabricated verdicts.
    return [
      ...sources,
      {
        label: 'Registry & clearance checks',
        status: 'unknown',
        detail: 'This passport reported no registry, clearance or odometer signals, so none is '
          + 'stated for this vehicle in either direction.',
      },
    ]
  }

  return [
    ...sources,
    {
      label: 'ZIMRA Customs Cleared',
      status: m.zimra_duty ? 'verified' : 'not_verified',
      detail: m.zimra_duty
        ? 'Import duty paid and confirmed via ZIMRA registry'
        : 'No ZIMRA customs declaration found',
    },
    {
      label: 'CVR Ownership Registration',
      status: m.cvr_synced ? 'verified' : 'not_verified',
      detail: m.cvr_synced
        ? 'Vehicle registered in Central Vehicle Registry'
        : 'CVR record not yet linked',
    },
    {
      label: 'ZRP Police Clearance',
      status: m.zrp_police_cleared ? 'verified' : 'not_verified',
      detail: m.zrp_police_cleared
        ? 'CID check passed — not flagged as stolen'
        : 'CID police clearance not yet recorded',
    },
    {
      label: 'Odometer Consistency',
      status: m.odometer_consistent ? 'verified' : 'warning',
      detail: m.odometer_consistent
        ? 'No odometer rollback anomalies detected across service logs'
        : 'Potential mileage discrepancy detected — inspect service history',
    },
    {
      label: 'Active Stolen Alert',
      status: m.stolen_alert_active ? 'warning' : 'verified',
      detail: m.stolen_alert_active
        ? '⚠️ Active police alert on this VIN — do not purchase'
        : 'No active stolen vehicle alert',
    },
    {
      label: 'Service Records',
      status: (m.maintenance_logs_count ?? 0) >= 1 ? 'verified' : 'not_verified',
      detail: (m.maintenance_logs_count ?? 0) >= 1
        ? `${m.maintenance_logs_count} signed maintenance log(s) on the CarUp audit ledger`
        : 'No mechanic-signed service records found',
    },
  ]
}

// ── Status badge for verification sources ───────────────────────────────────
function VerificationBadge({ status }: { status: PassportVerificationSource['status'] }) {
  const map = {
    verified:     { label: 'Verified',   cls: 'bg-green-500 text-white' },
    not_verified: { label: 'Unverified', cls: 'bg-gray-400 text-white' },
    warning:      { label: 'Warning',    cls: 'bg-amber-500 text-white' },
    unknown:      { label: 'Unknown',    cls: 'bg-gray-300 text-gray-700' },
  }
  const { label, cls } = map[status]
  return <Badge className={`${cls} text-[10px]`}>{label}</Badge>
}

// ── The canonical trust projection (Issue #164, ADR-001) ────────────────────
/**
 * THE TEN FIELDS. `backend/services/trustDecision/canonicalTrustService.js` → `toPublicTrust()` is
 * the ONE public trust contract. This page renders those ten fields and derives NOTHING from
 * anything else:
 *
 *   - `vehicle.trust_score` is never read for a trust claim. It is an unversioned cache column with
 *     several writers, and it is where the hand-set 84 came from.
 *   - `passport.trustReport` is now the canonical projection itself (server.js
 *     `canonicalPassportTrust`). It used to be the deprecated 70-baseline trustGraph engine's
 *     `{trustScore, metrics}`, which is where the 90 came from; the non-score signals moved to
 *     `passport.trustSignals`, and `readPublicTrust` refuses the old shape outright.
 *   - `decision.overall_trust.*` is never read for a trust claim either. Reading it was a SECOND
 *     forked public contract: the authority publishes a real 0 for the `insufficient_evidence`
 *     band and this page used to suppress it, so the same VIN read differently here than in the
 *     projection every other surface consumes.
 *
 * The decision is still fetched — its `dimensions[].reason_codes` say WHY, which the projection
 * does not carry — but the number, the band, the lifecycle state, the confidence, the evidence
 * basis and the limitations are all the projection's, verbatim.
 *
 * TWO TRANSPORTS, ONE CONTRACT. The projection reaches this page on the passport (public, always
 * fetched) and, when that route also publishes it, beside the trust decision. Both are the same
 * `toPublicTrust()` output from the same service and both are read by the one function below, so
 * this is one contract carried two ways — not two contracts.
 *
 * SCORE `null` IS NOT `0`. A null score means no canonical evaluation exists; it must render as an
 * explicit state, never as a number, a bar, or a percentage.
 */
const EVIDENCE_BASIS_FIELDS = [
  'governed_facts_total',
  'governed_facts_substantiated',
  'governed_facts_adverse',
  'connected_sources',
  'unbacked_legacy_claims',
] as const

type PublicTrustEvidenceBasis = Record<(typeof EVIDENCE_BASIS_FIELDS)[number], number | null>

type PublicTrust = {
  vin: string
  score: number | null
  band: string | null
  evaluation_state: string
  confidence: string
  evidence_basis: PublicTrustEvidenceBasis | null
  calculation_version: string | null
  evaluated_at: string | null
  known_limitations: string[]
  source: string
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Read a canonical projection. This narrows types; it does not compute. A field the server did not
 * send stays absent (null / 'unavailable') rather than being reconstructed from anything else on
 * the response — reconstructing it is what forking the contract means.
 *
 * `evaluation_state` is the discriminator, and it is required. That is what makes the deprecated
 * `{vin, trustScore, metrics}` shape parse as NOTHING rather than as a trust record: against a
 * server that still serves the old passport body this page reports "unavailable" instead of
 * quietly publishing the 70-baseline engine's number again.
 */
function readPublicTrust(raw: unknown): PublicTrust | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const t = raw as Record<string, unknown>
  if (typeof t.evaluation_state !== 'string') return null
  const basis = t.evidence_basis
  return {
    vin: typeof t.vin === 'string' ? t.vin : '',
    score: numberOrNull(t.score),
    band: typeof t.band === 'string' ? t.band : null,
    evaluation_state: t.evaluation_state,
    confidence: typeof t.confidence === 'string' ? t.confidence : 'not_evaluated',
    evidence_basis: basis && typeof basis === 'object' && !Array.isArray(basis)
      ? EVIDENCE_BASIS_FIELDS.reduce((out, field) => {
        out[field] = numberOrNull((basis as Record<string, unknown>)[field])
        return out
      }, {} as PublicTrustEvidenceBasis)
      : null,
    calculation_version: typeof t.calculation_version === 'string' ? t.calculation_version : null,
    evaluated_at: typeof t.evaluated_at === 'string' ? t.evaluated_at : null,
    known_limitations: Array.isArray(t.known_limitations)
      ? t.known_limitations.filter((entry): entry is string => typeof entry === 'string')
      : [],
    source: typeof t.source === 'string' ? t.source : 'none',
  }
}

/**
 * Band labels. An unrecognised band falls through unchanged rather than being mapped onto a
 * familiar tier, so a vocabulary change upstream stays visible instead of being absorbed. There is
 * deliberately no 'Excellent' / 'Good' / 'Fair' / 'High Trust' here: those were client-side tiers
 * awarded by thresholds this page has no authority to set.
 */
const TRUST_BAND_LABELS: Record<string, string> = {
  high: 'High trust',
  moderate: 'Moderate trust',
  low: 'Low trust',
  insufficient_evidence: 'Insufficient evidence',
}
const TRUST_BAND_TONE: Record<string, { badge: string; text: string }> = {
  high: { badge: 'bg-green-600', text: 'text-green-700' },
  moderate: { badge: 'bg-amber-500', text: 'text-amber-700' },
  low: { badge: 'bg-red-500', text: 'text-red-700' },
  insufficient_evidence: { badge: 'bg-gray-500', text: 'text-gray-600' },
}
const TRUST_NEUTRAL_TONE = { badge: 'bg-gray-500', text: 'text-gray-600' }

/** Lifecycle labels — the axis that says whether an evaluation exists at all. */
const TRUST_STATE_LABELS: Record<string, string> = {
  evaluated: 'Evaluated',
  stale: 'Assessment out of date',
  not_evaluated: 'Not evaluated',
  unavailable: 'Trust assessment unavailable',
}

/** Why there is, or is not, a number. Every state reads differently from every other. */
const TRUST_STATE_DETAIL: Record<string, string> = {
  stale: 'This vehicle was last assessed under superseded rules. The earlier score is withheld '
    + 'rather than shown as if it were current.',
  not_evaluated: 'CarUp has not produced a governed trust assessment for this vehicle. That is not '
    + 'a score of zero and says nothing for or against the vehicle.',
  unavailable: 'CarUp could not produce a trust assessment for this request. That is a fact about '
    + 'the request, not a finding about the vehicle.',
}

const TRUST_CONFIDENCE_LABELS: Record<string, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
  not_evaluated: 'Confidence not assessed',
}

type TrustPresentation = {
  /** The projection's number, or null. Never defaulted, never floored, never zero-filled. */
  score: number | null
  band: string | null
  state: string
  /** The one line the surface leads with. */
  headline: string
  /** The sentence that keeps each state distinguishable from the others. */
  detail: string
  tone: string
  toneText: string
}

function presentTrust(
  trust: PublicTrust | null,
  opts: { loading: boolean; authenticated: boolean },
): TrustPresentation {
  const neutral = {
    score: null,
    band: null,
    tone: TRUST_NEUTRAL_TONE.badge,
    toneText: TRUST_NEUTRAL_TONE.text,
  }
  if (opts.loading) {
    return { ...neutral, state: 'unavailable', headline: 'Checking…', detail: '' }
  }

  if (!trust) {
    // No projection reached this page: the visitor is signed out, or the authority could not be
    // read. Nothing about this vehicle's trust may be asserted in either direction.
    return {
      ...neutral,
      state: 'unavailable',
      headline: opts.authenticated ? TRUST_STATE_LABELS.unavailable : 'Sign in to view trust',
      detail: opts.authenticated
        ? TRUST_STATE_DETAIL.unavailable
        : 'CarUp publishes a vehicle’s governed trust assessment to signed-in users.',
    }
  }

  // FAIL CLOSED. The contract guarantees a score exists only in the `evaluated` state; this page
  // still refuses to print one otherwise, so a route that ever published a raw decision here shows
  // its lifecycle state rather than an ungoverned number.
  const publishable = trust.evaluation_state === 'evaluated' && trust.score !== null
  if (!publishable) {
    const state = trust.evaluation_state
    return {
      ...neutral,
      state,
      headline: TRUST_STATE_LABELS[state] ?? TRUST_STATE_LABELS.not_evaluated,
      detail: TRUST_STATE_DETAIL[state] ?? TRUST_STATE_DETAIL.not_evaluated,
    }
  }

  const band = trust.band
  const tone = (band ? TRUST_BAND_TONE[band] : undefined) ?? TRUST_NEUTRAL_TONE
  return {
    score: trust.score,
    band,
    state: trust.evaluation_state,
    headline: (band ? TRUST_BAND_LABELS[band] : undefined) ?? (band ?? '').replace(/_/g, ' '),
    // An `insufficient_evidence` score IS a measurement. Saying so is what keeps it from reading
    // like the `not_evaluated` state above, and keeps it from reading like a bad-vehicle verdict.
    detail: band === 'insufficient_evidence'
      ? 'CarUp evaluated this vehicle and found too little authoritative evidence to support a '
        + 'higher score. This is a measured result, not a missing one.'
      : 'Published by CarUp’s trust authority under its current calculation rules.',
    tone: tone.badge,
    toneText: tone.text,
  }
}

/**
 * A price is a number AND a currency — never one without the other. `vehicle.currency ?? 'USD'`
 * fabricated a currency the seller never stated (the passport withdraws currency unless it is
 * provenance-backed). Show a formatted price only when both the amount and a real currency are
 * present; otherwise say the price is not recorded rather than invent USD.
 */
function governedPrice(price: unknown, currency: unknown): string {
  const amount = typeof price === 'number' && Number.isFinite(price) ? price : null
  const ccy = typeof currency === 'string' && currency.trim() ? currency.trim() : null
  if (amount === null || ccy === null) return 'Price not recorded'
  return formatPrice(amount, ccy)
}

// ─────────────────────────────────────────────────────────────────────────────
export default function VehicleDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { fetchVehicle, fetchVehiclePassport, lookupVehiclePassport, fetchMarketplaceListingDetail, saveMarketplaceListing, unsaveMarketplaceListing, fetchSavedMarketplaceListings, fetchEvidenceTaxonomy, fetchEvidenceSources, fetchTemporalFindings, fetchDisclosureConflicts, fetchVehicleReport, generateReportVersion, createReportShareLink, fetchVehicleTrustDecision } = useCarUpApi()
  const { isAuthenticated, user, loading: authLoading } = useAuth()

  // Buyers/owners can generate a snapshot + share link; backend enforces the role.
  // Keep the owner actions unobtrusive: only authenticated privileged roles see them.
  const canManageReport = isAuthenticated && ['owner', 'dealer', 'admin', 'government'].includes(user?.role ?? '')

  const [vehicle, setVehicle]   = useState<Vehicle | null>(null)
  const [passport, setPassport] = useState<VehiclePassport | null>(null)
  const [detail, setDetail]     = useState<MarketplaceListingDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(true)
  const [loading, setLoading]   = useState(true)
  // A plate / temporary-identifier lookup is refused for signed-out visitors by design. That is a
  // statement about the caller, not about the vehicle, so it must not render as "Vehicle Not Found".
  const [lookupNeedsSignIn, setLookupNeedsSignIn] = useState(false)

  const [currentImageIdx, setCurrentImageIdx] = useState(0)
  // A syntactically publishable media address can still fail at delivery time. Keep that
  // browser-runtime failure separate from the canonical media block: it is neither `none` nor
  // `not_loaded`, and it must not turn into a broken-image glyph or a claim about the seller.
  const [failedListingMedia, setFailedListingMedia] = useState<{ vin: string | undefined; urls: string[] }>({ vin: id, urls: [] })
  const failedListingMediaUrls = failedListingMedia.vin === id ? failedListingMedia.urls : []
  const markListingMediaFailed = useCallback((url: string) => {
    setFailedListingMedia((previous) => {
      const urls = previous.vin === id ? previous.urls : []
      return urls.includes(url) ? previous : { vin: id, urls: [...urls, url] }
    })
  }, [id])
  const [isFav, setIsFav]         = useState(() => getFavorites().includes(id || ''))
  // Session-only acknowledgement that this browser submitted a reservation request. It never
  // asserts reserved state on its own — `status` from the server is the only source of "Reserved".
  const [reserveRequested, setReserveRequested] = useState(false)
  const [financeInterestRequested, setFinanceInterestRequested] = useState(false)

  const [lookupQuery, setLookupQuery] = useState('')

  // Vehicle Life Evidence Taxonomy (M1) — used to derive a life-stage class for
  // legacy evidence and to resolve human-readable source labels in the timeline.
  const [evidenceTaxonomy, setEvidenceTaxonomy] = useState<EvidenceTaxonomyResponse | null>(null)
  const [evidenceSources, setEvidenceSources] = useState<EvidenceSource[]>([])

  useEffect(() => {
    let mounted = true
    Promise.allSettled([fetchEvidenceTaxonomy(), fetchEvidenceSources()]).then(([tax, src]) => {
      if (!mounted) return
      if (tax.status === 'fulfilled') setEvidenceTaxonomy(tax.value)
      if (src.status === 'fulfilled') setEvidenceSources(src.value.sources || [])
    })
    return () => { mounted = false }
  }, [fetchEvidenceTaxonomy, fetchEvidenceSources])

  // Vehicle Life Intelligence (M3): reviewer-confirmed, public-safe temporal
  // comparisons and disclosure conflicts. Buyers typically see empty/governed
  // results — that is correct and expected; the UI handles empty gracefully.
  const [temporalFindings, setTemporalFindings] = useState<TemporalFinding[]>([])
  const [disclosureConflicts, setDisclosureConflicts] = useState<DisclosureConflict[]>([])

  useEffect(() => {
    const vin = vehicle?.vin || id
    if (!vin) return
    let mounted = true
    Promise.allSettled([fetchTemporalFindings(vin), fetchDisclosureConflicts(vin)]).then(([findings, conflicts]) => {
      if (!mounted) return
      setTemporalFindings(findings.status === 'fulfilled' ? findings.value.findings || [] : [])
      setDisclosureConflicts(conflicts.status === 'fulfilled' ? conflicts.value.conflicts || [] : [])
    })
    return () => { mounted = false }
  }, [vehicle?.vin, id, fetchTemporalFindings, fetchDisclosureConflicts])

  // The trust DECISION (ADR-001) supplies reason codes — `dimensions[].reason_codes` — and nothing
  // else. The trust CLAIM comes from the canonical projection resolved below. The route requires a
  // session, so a signed-out visitor simply gets no reason codes; the passport still carries the
  // projection, so the trust state itself is public.
  const [trustDecision, setTrustDecision] = useState<TrustDecision | null>(null)
  const [routeTrust, setRouteTrust] = useState<PublicTrust | null>(null)
  const [trustDecisionLoading, setTrustDecisionLoading] = useState(true)

  useEffect(() => {
    const vin = vehicle?.vin || id
    if (!vin || authLoading) return
    let mounted = true
    if (!isAuthenticated) {
      // Nothing to ask for, and nothing may be assumed. Resolve the loading state only.
      Promise.resolve().then(() => {
        if (!mounted) return
        setTrustDecision(null)
        setRouteTrust(null)
        setTrustDecisionLoading(false)
      })
      return () => { mounted = false }
    }
    fetchVehicleTrustDecision(vin)
      .then((r) => {
        if (!mounted) return
        setTrustDecision(r.decision ?? null)
        setRouteTrust(readPublicTrust((r as { trust?: unknown }).trust))
      })
      .catch(() => { if (mounted) { setTrustDecision(null); setRouteTrust(null) } })
      .finally(() => { if (mounted) setTrustDecisionLoading(false) })
    return () => { mounted = false }
  }, [vehicle?.vin, id, authLoading, isAuthenticated, fetchVehicleTrustDecision])

  // Vehicle History Report (M4): full public-safe buyer report. Audience is derived
  // server-side from role; buyers get verified, public-safe data only. Loaded lazily
  // alongside the page so the dedicated tab renders immediately when opened.
  const [report, setReport] = useState<VehicleHistoryReportData | null>(null)
  const [reportLoading, setReportLoading] = useState(true)
  const [reportError, setReportError] = useState<string | null>(null)
  const [reportBusy, setReportBusy] = useState(false)
  const [shareLink, setShareLink] = useState<string | null>(null)

  // Vehicle History Report fetch. No synchronous setState in the effect body
  // (react-hooks/set-state-in-effect): reportLoading is initialised true and all state
  // updates happen in async continuations; error is cleared on a successful load.
  useEffect(() => {
    const vin = vehicle?.vin || id
    if (!vin) return
    let mounted = true
    fetchVehicleReport(vin)
      .then((data) => { if (mounted) { setReport(data); setReportError(null) } })
      .catch((err) => { if (mounted) setReportError(err instanceof Error ? err.message : 'Report unavailable') })
      .finally(() => { if (mounted) setReportLoading(false) })
    return () => { mounted = false }
  }, [vehicle?.vin, id, fetchVehicleReport])

  const handleGenerateReportVersion = useCallback(async () => {
    const vin = vehicle?.vin || id
    if (!vin) return
    setReportBusy(true)
    try {
      const version = await generateReportVersion(vin)
      toast.success(`Report version v${version.version} snapshotted.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not generate report version.')
    } finally {
      setReportBusy(false)
    }
  }, [vehicle?.vin, id, generateReportVersion])

  const handleCreateShareLink = useCallback(async () => {
    const vin = vehicle?.vin || id
    if (!vin) return
    setReportBusy(true)
    try {
      // Snapshot a fresh version, then create an expiring share link for it.
      const version = await generateReportVersion(vin)
      const link = await createReportShareLink(version.id)
      const url = `${window.location.origin}/reports/shared/${link.share_token}`
      setShareLink(url)
      try {
        await navigator.clipboard?.writeText(url)
        toast.success('Share link created and copied to clipboard.')
      } catch {
        toast.success('Share link created.')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create share link.')
    } finally {
      setReportBusy(false)
    }
  }, [vehicle?.vin, id, generateReportVersion, createReportShareLink])

  const handleLookupSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (lookupQuery.trim()) {
      navigate(`/marketplace/${lookupQuery.trim()}`)
    }
  }

  useEffect(() => {
    if (!id) return
    let mounted = true

    const load = async () => {
      try {
        setLoading(true)
        // 1. Try looking up the passport using the new lookup endpoint
        const passportData = await lookupVehiclePassport(id)
        if (!mounted) return

        if (passportData) {
          setPassport(passportData)
          const d = passportData.vehicle
          setVehicle({
            ...d,
            id: d.vin,
            // NO `images` HERE. This line used to read `d.images` off the passport vehicle, and that
            // key does not exist: `buildVehiclePassport` projects `vehicles` through
            // `PUBLIC_VEHICLE_FIELDS`, which names no image column, and the `vehicles` table has no
            // image column to name. Photos live in `listing_images`, which this path never reads.
            // Because this branch RETURNS EARLY on success, the empty array it produced was the
            // page's final answer — which is how a car with photos on its Marketplace card ended up
            // announcing that it had none. The gallery now reads the listing-media block instead.
            features: d.features ?? [],
            sellerName:   d.tenant?.name  ?? passportData.ownershipSummary?.currentSellerDisplayName ?? undefined,
            sellerPhone:  d.tenant?.phone,
            sellerAvatar: d.tenant?.logo_url ?? null,
            sellerType:   passportData.ownershipSummary?.currentSellerType ?? undefined,
            // `location`/`province` are NOT columns on the vehicle projection (PUBLIC_VEHICLE_FIELDS
            // names none), and `created_at` is the row-insert time, not a date this listing was
            // published. Copying either here is how "Location not recorded" and "Listed <insert
            // date>" reached a page whose own passport carried the governed location. The location
            // comes from `claims.location`; there is no governed listing date, so none is shown.
          })
          setLoanAmount((d.price ?? 0).toString())
          setLoading(false)
          return
        }
      } catch (err) {
        if ((err as { code?: string })?.code === 'LOOKUP_REQUIRES_AUTHENTICATION') {
          setLookupNeedsSignIn(true)
        }
        console.warn('lookupVehiclePassport failed, trying fallback details fetch:', err)
      }

      // 2. Fallback to VIN canonical endpoints if lookup fails
      try {
        const [vehicleData, passportData] = await Promise.allSettled([
          fetchVehicle(id),
          fetchVehiclePassport(id),
        ])

        if (!mounted) return

        if (vehicleData.status === 'fulfilled' && vehicleData.value) {
          const d = vehicleData.value
          setVehicle({
            ...d,
            id: d.vin,
            // Same as the lookup branch above: the canonical vehicle endpoint is a `vehicles`
            // projection and carries no gallery either. The listing-media block is the one source.
            features: d.features ?? [],
            sellerName:   d.tenant?.name,
            sellerPhone:  d.tenant?.phone,
            sellerAvatar: d.tenant?.logo_url ?? null,
            sellerType:   d.current_seller_type,
            // `location`/`province` are NOT columns on the vehicle projection (PUBLIC_VEHICLE_FIELDS
            // names none), and `created_at` is the row-insert time, not a date this listing was
            // published. Copying either here is how "Location not recorded" and "Listed <insert
            // date>" reached a page whose own passport carried the governed location. The location
            // comes from `claims.location`; there is no governed listing date, so none is shown.
          })
          setLoanAmount((d.price ?? 0).toString())
        }

        if (passportData.status === 'fulfilled' && passportData.value) {
          setPassport(passportData.value)
        }
      } catch (err) {
        console.error('VehicleDetail load fallback error:', err)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()
    return () => { mounted = false }
  }, [id, fetchVehicle, fetchVehiclePassport, lookupVehiclePassport])

  // Backend-governed marketplace detail (trust/verification/pricing summaries). Best-effort: if the
  // listing is not a public marketplace listing this stays null and the page renders the passport view.
  useEffect(() => {
    if (!id) return
    let mounted = true
    captureReferralFromUrl()
    const attr = getStoredAttribution()
    setDetailLoading(true)
    fetchMarketplaceListingDetail(id, { ref: attr.referral_code, campaign: attr.campaign_code, source: attr.source })
      .then((d) => {
        if (!mounted) return
        setDetail(d)
        // Fallback: a real public marketplace listing must always open a real detail page. If the
        // passport lookup didn't resolve a vehicle, hydrate from the marketplace detail so the page
        // renders instead of showing "Vehicle Not Found".
        // A public Marketplace detail is sufficient to render the public listing. Passport lookup is
        // a richer enrichment path, not a prerequisite: staging proved that endpoint can remain pending
        // while the governed Marketplace detail has already returned successfully. Do not hold the
        // entire buyer page behind that independent read or a valid listing becomes an infinite spinner.
        // Preserve a richer vehicle already resolved for THIS VIN; replace any stale previous-route VIN.
        setVehicle((prev) => prev?.vin === d.vin ? prev : vehicleFromMarketplaceDetail(d))
        setLoanAmount((d.price ?? 0).toString())
        setLoading(false)
      })
      .catch(() => { if (mounted) setDetail(null) })
      .finally(() => { if (mounted) setDetailLoading(false) })
    return () => { mounted = false }
  }, [id, fetchMarketplaceListingDetail])

  // Saved state is SERVER-backed + account-scoped for authenticated users (existing /marketplace/saved
  // API), so it survives refresh and never leaks across accounts. Guests keep the browser-local list.
  useEffect(() => {
    if (!isAuthenticated) return
    const vin = vehicle?.vin || id
    if (!vin) return
    let active = true
    fetchSavedMarketplaceListings()
      .then(res => { if (active) setIsFav((res.listings || []).some(l => l.vin === vin)) })
      .catch(() => { /* server unavailable — keep current */ })
    return () => { active = false }
  }, [isAuthenticated, vehicle?.vin, id, fetchSavedMarketplaceListings])

  const toggleFavorite = useCallback(async () => {
    if (!vehicle) return

    if (isAuthenticated) {
      // Server-backed + account-scoped. Optimistic toggle, rolled back on error. No localStorage write.
      const vin = vehicle.vin || id || ''
      if (!vin) return
      const previous = isFav
      setIsFav(!previous)
      try {
        if (previous) {
          await unsaveMarketplaceListing(vin)
          toast.info('Removed from saved cars')
        } else {
          await saveMarketplaceListing(vin)
          toast.success(`${vehicle.make ?? ''} ${vehicle.model ?? ''} saved!`)
        }
      } catch {
        setIsFav(previous)
        toast.error('Could not update saved cars. Please try again.')
      }
      return
    }

    // Guest fallback: browser-local only (unchanged behavior).
    const current = getFavorites()
    let updated: string[]
    if (current.includes(vehicle.id || '')) {
      updated = current.filter(i => i !== vehicle.id)
      setIsFav(false)
      toast.info('Removed from saved cars')
    } else {
      updated = [...current, vehicle.id || '']
      setIsFav(true)
      toast.success(`${vehicle.make ?? ''} ${vehicle.model ?? ''} saved!`)
    }
    localStorage.setItem('carup_favorites', JSON.stringify(updated))
  }, [vehicle, id, isAuthenticated, isFav, saveMarketplaceListing, unsaveMarketplaceListing])

  const [shareOpen, setShareOpen] = useState(false)

  const handleShare = useCallback(() => {
    setShareOpen(true)
  }, [])

  const compareHref = vehicle?.vin
    ? `/marketplace/compare?vins=${encodeURIComponent(vehicle.vin)}`
    : '/marketplace/compare'


  // ── Loading / 404 states ─────────────────────────────────────────────────
  if (loading || (!vehicle && detailLoading)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    )
  }

  if (!vehicle && lookupNeedsSignIn) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md px-4" data-testid="lookup-requires-signin">
          <Lock className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Sign in to look up by plate</h1>
          <p className="text-gray-500 mb-6">
            Searching by number plate or temporary identifier needs a CarUp account. Looking up an exact
            VIN is open to everyone.
          </p>
          <div className="flex gap-3 justify-center">
            <Button className="bg-orange-500 hover:bg-orange-600" asChild>
              <Link to="/login">Sign in</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/marketplace">Back to Marketplace</Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!vehicle) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <Car className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Vehicle Not Found</h1>
          <p className="text-gray-500 mb-6">The vehicle you're looking for doesn't exist or has been removed.</p>
          <Button className="bg-orange-500 hover:bg-orange-600" asChild>
            <Link to="/marketplace">Back to Marketplace</Link>
          </Button>
        </div>
      </div>
    )
  }

  // ── Derived values ────────────────────────────────────────────────────────
  /**
   * THE LISTING-MEDIA BLOCK — TWO TRANSPORTS, ONE CONTRACT; AND WITHIN EACH, ONE AUTHORITY.
   *
   * The TRANSPORTS are two independent reads of `listing_images`, either of which may not have
   * happened:
   *   1. `passport.listing_media` — canonical, and the only one that can answer for a vehicle with
   *      no public marketplace listing at all.
   *   2. the marketplace detail — which now CARRIES THE IDENTITY, and is therefore what makes
   *      marketplace→detail continuity checkable on the client rather than only on the server.
   *
   * The marketplace payload publishes that one read TWICE: `listing_media` (the envelope) and
   * `media` (a compatibility array derived from it). Those are not two transports and the page must
   * not treat them as two opinions — the envelope is the AUTHORITY and the array is a strictly
   * weaker view of it, so `??` picks the envelope whenever the payload carries a parseable one and
   * falls to the array only for a payload that carries none.
   *
   * WHY THAT DISTINCTION IS LOAD-BEARING, found by mutating this very expression. The service's own
   * header records it: "`not_loaded` cannot be expressed in an array, so it arrives here as `[]` —
   * indistinguishable from 'no photos'". Under a flat fallback the page read the envelope's
   * `not_loaded`, correctly skipped it as "this did not look", and then answered from the same
   * payload's `[]` — publishing "No photos have been added to this listing." about a table the
   * request had never successfully read. Rule 1's defect, restored through the compatibility key.
   * `unpublishable_count` is lost the same way: `none` with 2 unpublishable rows becomes a bare
   * `none`, and our inability to render a stored address is passed off as the seller's omission.
   *
   * The three input states of the marketplace read, and why each maps where it does (Rule 1):
   *   · still loading           → `not_loaded`. We have not looked yet.
   *   · detail resolved         → we looked. The envelope decides; failing that, `media` (or `[]`).
   *   · detail settled to null  → the listing read did not resolve — a passport-only vehicle, or a
   *                               refused/failed fetch. WE NEVER CONSULTED `listing_images`, so this
   *                               page may not report a negative about it. `not_loaded`.
   *
   * That last case is the original defect: it is precisely the state in which the page used to
   * announce "No verified images uploaded yet".
   */
  const passportMedia = passport as (VehiclePassport & PassportMediaTransport) | null
  // `detailLoading` gates the whole marketplace transport, both of its keys together. A stale
  // `detail` from a previous VIN is not this VIN's answer, and gating one key but not the other is
  // how two views of one read start disagreeing.
  // No local widening any more: `MarketplaceListingDetail` DECLARES `listing_media`, so the key this
  // page reads is the key the contract publishes. Both are still handed to validators — a declared
  // type is a promise about the contract, not about the bytes a given deploy sends.
  const detailMedia = detailLoading ? null : detail
  const marketplaceBlock =
    readListingMediaBlock(detailMedia?.listing_media)
    ?? toListingMediaBlock(detailMedia ? (detailMedia.media ?? []) : undefined)
  const listingMedia = resolveMediaBlock(
    readListingMediaBlock(passportMedia?.listing_media),
    marketplaceBlock,
  )
  // Runtime delivery failures do not mutate the canonical media contract. They only decide
  // which already-published item the browser can present in this render. If every published address
  // fails, the page renders a distinct delivery-failure state rather than pretending the gallery
  // was empty or unread.
  const galleryItems = listingMedia.items.filter((item) => !failedListingMediaUrls.includes(item.url))
  const allListingMediaFailed = listingMedia.state === 'published'
    && listingMedia.items.length > 0
    && galleryItems.length === 0
  const hasListingPhotos = listingMedia.state === 'published' && galleryItems.length > 0
  // The index survives a payload changing under it; a stale index must never index past the array
  // and blank the gallery.
  const activeImageIdx = galleryItems.length > 0
    ? Math.min(currentImageIdx, galleryItems.length - 1)
    : 0
  const activeImage = galleryItems[activeImageIdx]

  // The canonical projection, from the passport first — it is public, it is already fetched, and
  // `server.js` designates `trustReport` as "the ONE trust number this body publishes". The
  // trust-decision route's copy is the same projection from the same service and is used only when
  // the passport carried none, so there is one contract here, not a preference between two answers.
  const publicTrust = readPublicTrust(passport?.trustReport) ?? routeTrust
  const trust          = presentTrust(publicTrust, {
    // The passport resolves with `loading`; only the route call has its own gate.
    loading: loading || (isAuthenticated && !passport && trustDecisionLoading),
    authenticated: isAuthenticated,
  })

  // Location, from the passport's governed claim — the same leaves the Marketplace summary composes
  // server-side, read through the shared rule so one VIN cannot print two different places. When the
  // passport has not loaded, the marketplace summary's already-composed line stands in; both agree
  // because both come from `claims.location`. A stated absence is rendered in words, never omitted.
  const locationLine = passport?.claims?.location
    ? governedLocationLine(passport.claims.location as LocationClaim)
    : summaryLocationLine(vehicle?.location, (vehicle as { location_state?: unknown })?.location_state)

  // Direct contact exists only when the listing carries a real number. There is no fallback
  // number — an unknown contact stays unknown and the buyer is routed to the governed inquiry flow.
  const sellerContactNumber = vehicle.sellerPhone && /[0-9]/.test(vehicle.sellerPhone) ? vehicle.sellerPhone : null
  const sellerWhatsAppLink  = sellerContactNumber
    ? `https://wa.me/${sellerContactNumber.replace(/[^0-9]/g, '')}?text=Hi%2C%20I%20am%20interested%20in%20your%20${vehicle.year ?? ''}%20${vehicle.make ?? ''}%20${vehicle.model ?? ''}%20listed%20on%20CarUp.`
    : null

  // Reservation truth is server-owned and time-sensitive. The listing `status` field is a
  // materialized compatibility cache and can lag reservation expiry/provider state, so it must
  // never create an active hold claim on this page. Only the canonical reservation summary may do
  // that. When that projection is unavailable/inconsistent we fail closed and leave the next step
  // as a governed request for the server to adjudicate.
  const reservationSummary = detail?.reservation_summary
  const isReservedOnServer =
    reservationSummary?.state === 'active' && reservationSummary.reserved === true

  // A null identifier on the passport means "withheld from this audience" when
  // identifiersRedacted is set, and "unrecorded" only when it is not.
  const identity             = passport?.identity as PassportIdentity | undefined
  const identifiersRedacted  = identity?.identifiersRedacted === true

  const timeline            = passport?.timeline ?? []
  const lifecycleEvents     = passport?.lifecycle?.events ?? []
  const lifecycleLoaded     = Boolean(passport?.lifecycle)
  const evidenceVault       = passport?.evidenceVault ?? []
  // One gate, one predicate. `publicEvidence` keeps returning RAW rows because the life-stage
  // timeline and the history thumbnails are typed on `VehicleEvidence`; the block below is what the
  // buyer-facing evidence surface renders, and it is allow-list projected.
  const publicEvidence      = evidenceVault.filter(isEvidenceRowClearedForPublic)
  const verificationSources = buildVerificationSources(passport)

  /**
   * THE VERIFIED-EVIDENCE BLOCK. `passport?.evidenceVault` is passed through UNDEFAULTED on purpose:
   * `?? []` — which the `evidenceVault` line above still needs for its array-typed consumers — is
   * the same defect as the gallery's, one table over. No passport, or a passport body that carried
   * no `evidenceVault` key, means this page did not read the evidence record, and `not_loaded` says
   * so instead of asserting that this vehicle has no verified evidence.
   */
  const verifiedEvidence = resolveMediaBlock(
    readVerifiedEvidenceBlock(passportMedia?.verified_evidence),
    toVerifiedEvidenceBlock(passport?.evidenceVault),
  )

  // Reason codes come from the decision's own dimensions. They are shown verbatim; the page does
  // not translate them into sub-scores, because a code says WHY, not HOW MUCH.
  const trustReasonCodes = Array.from(new Set(
    Object.values(trustDecision?.dimensions ?? {}).flatMap((d) => d.reason_codes ?? []),
  ))
  // Limitations are the PROJECTION's, not the decision's: the projection's list is the superset
  // that also carries the fact resolver's disclosures — including "the stored 'zimra_verified' flag
  // is not supported by any authoritative record and is not published".
  const trustLimitations = publicTrust?.known_limitations ?? []
  const evidenceBasis = publicTrust?.evidence_basis ?? null
  // A basis entry that was never resolved prints as "not recorded", never as 0: a zero here would
  // claim CarUp counted and found none.
  const basisValue = (value: number | null) => (value === null ? 'Not recorded' : String(value))
  // A record count that was never reported stays null. Rendering it as 0 would assert that no
  // service record exists, which is exactly the absence-as-proof this page must not make.
  const trustSignals = readTrustSignals(passport)
  const serviceRecordCount = trustSignals?.maintenance_logs_count ?? null

  return (
    <div className="min-h-screen bg-[#f4f6f9]">
      {/* Breadcrumb */}
      <div className="bg-white border-b">
        <div className="section-padding mx-auto max-w-[1440px] py-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Link to="/" className="hover:text-orange-500">Home</Link>
              <span>/</span>
              <Link to="/marketplace" className="hover:text-orange-500">Marketplace</Link>
              <span>/</span>
              <span className="text-gray-900">{vehicle.make} {vehicle.model}</span>
            </div>
            
            <form onSubmit={handleLookupSubmit} className="flex gap-2 max-w-sm w-full">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Enter VIN, chassis, plate, or temporary ID"
                  value={lookupQuery}
                  onChange={(e) => setLookupQuery(e.target.value)}
                  className="pl-9 h-9 text-xs bg-gray-50"
                />
              </div>
              <Button type="submit" size="sm" className="bg-orange-500 hover:bg-orange-600 text-xs">Lookup</Button>
            </form>
          </div>
        </div>
      </div>

      <div className="section-padding mx-auto max-w-[1440px] py-6">
        <Button variant="ghost" size="sm" className="mb-4 gap-1" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>

        <div className="mb-6" data-testid="vehicle-detail-gallery-first">
          {/* ── LISTING MEDIA — the seller's presentation of the car ─────────────────
              Marketing photos. Nothing in this block asserts governance, because nothing in
              `listing_images` could support such an assertion. Note what is NOT here any more:
              the "Police Checked" badge used to be stamped across the top-left of this photo,
              which put a registry verification claim physically on top of a seller's snapshot.
              It is a fact about the VEHICLE, not about the picture, and it now sits with the
              other vehicle-status badges in the identity row below. */}
          <section className="space-y-3" data-testid="listing-media-block">
            <div className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-gray-400" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-gray-900">Listing photos</h2>
            </div>
            <p className="text-xs text-gray-500" data-testid="listing-media-caption">
              {listingMedia.items.some((item) => item.synthetic_demo)
                ? 'Synthetic reference media for this staging demonstration. These images are not verified evidence and do not affect CarUp Trust.'
                : 'Photos supplied by the seller to advertise this vehicle. CarUp does not review them and makes no claim about what they show.'}
            </p>

            <div className="relative rounded-xl overflow-hidden bg-white card-shadow" data-testid="image-gallery">
              {hasListingPhotos && activeImage ? (
                <>
                  {/* Rule 6b: `data-media-id` is the identity of the photograph on screen, so a
                      test — and a support conversation about "the third photo on this listing" —
                      can name THIS picture rather than whichever one is currently in slot 2. The
                      attribute is absent entirely when the transport carried no identity; it is
                      never a fabricated value. */}
                  <img
                    src={activeImage.url}
                    alt={`${vehicle.make} ${vehicle.model}`}
                    className="w-full aspect-[16/9] object-cover"
                    data-testid="vehicle-image"
                    data-url-form={activeImage.url_form}
                    data-media-id={activeImage.media_id ?? undefined}
                    onError={() => markListingMediaFailed(activeImage.url)}
                  />
                  {/* Rule 6: shown only where a row claims it. No primary is elected when the
                      seller named none — that choice is theirs to make or leave unmade. */}
                  {activeImage.is_primary && (
                    <span
                      className="absolute bottom-3 left-3 rounded-full bg-black/50 px-2 py-1 text-xs text-white"
                      data-testid="listing-media-primary"
                    >
                      Seller’s main photo
                    </span>
                  )}
                  {galleryItems.length > 1 && (
                    <>
                      <button
                        onClick={() => setCurrentImageIdx((activeImageIdx - 1 + galleryItems.length) % galleryItems.length)}
                        aria-label="Previous photo"
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => setCurrentImageIdx((activeImageIdx + 1) % galleryItems.length)}
                        aria-label="Next photo"
                        className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                      <div className="absolute bottom-3 right-3 bg-black/50 text-white text-xs px-2 py-1 rounded-full">
                        {activeImageIdx + 1} / {galleryItems.length}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div
                  className="w-full aspect-[16/9] bg-gray-100 flex flex-col items-center justify-center gap-2 px-6 text-center text-gray-400"
                  data-testid="no-images-placeholder"
                  data-media-state={allListingMediaFailed ? 'published_unavailable' : listingMedia.state}
                >
                  <Car className="w-14 h-14 opacity-30" aria-hidden="true" />
                  {allListingMediaFailed ? (
                    <div data-testid="listing-media-load-failed">
                      <p className="text-sm font-medium text-gray-600">Listing photo unavailable</p>
                      <p className="mt-1 text-xs text-gray-400">
                        CarUp received a published photo address for this listing, but the browser could
                        not load it. That is a delivery failure, not a statement about the vehicle or
                        whether the seller added photos.
                      </p>
                    </div>
                  ) : listingMedia.state === 'none' ? (
                    <div data-testid="listing-media-empty">
                      {/* The block's own sentence, not one authored here. A gallery that invents
                          its own empty-state wording is how the previous one came to publish a
                          governance finding over a seller's advertising photos. */}
                      <p className="text-sm font-medium text-gray-600">{listingMedia.empty_statement}</p>
                      {/* THE SUPPORTING LINE HAD TO CHANGE WITH THE SENTENCE ABOVE IT, and this is
                          the more important half. It used to read "The seller has not added any
                          photos." — which is the EXACT claim the contract withdrew in Rule 1b, and
                          leaving it here would have restored the falsehood one line below the
                          correction: a gated block (an unpublished listing that DOES hold
                          photographs) would have rendered the contract's honest "none published"
                          and then had this page assert, on its own authority, that the seller
                          added nothing. It also breaks the byte-identity the gate depends on the
                          other way round — a surface that describes the three indistinguishable
                          cases differently re-opens the enumeration the gate closed.
                          This line now says only what the block says: nothing is published here,
                          and no reading about the seller follows from that. */}
                      <p className="mt-1 text-xs text-gray-400">
                        That is a statement about what this page publishes, and about nothing else.
                        Nothing follows from it about what the seller did.
                      </p>
                    </div>
                  ) : (
                    <div data-testid="listing-media-not-loaded">
                      {/* RULE 1. This page reads the listing gallery through the governed
                          marketplace detail; when that does not resolve, `listing_images` was
                          never consulted and no negative about it may be published. */}
                      <p className="text-sm font-medium text-gray-600">
                        CarUp did not read this listing’s photo gallery on this page.
                      </p>
                      <p className="mt-1 text-xs text-gray-400">
                        That is a fact about this request, not a finding about the listing. Nothing is
                        stated either way about whether the seller added photos.
                      </p>
                    </div>
                  )}
                </div>
              )}
              <div className="absolute top-4 left-4 flex gap-2">
                {/* No "Featured" badge: it was awarded by a client-side score threshold, which is a
                    merchandising claim the page has no authority to make. "Reserved" stays — it is
                    a listing state, not a claim about the photograph under it. */}
                {detail?.carup_gold?.state === 'qualified' && (
                  <Badge className="border border-amber-200 bg-[linear-gradient(135deg,#f59e0b,#facc15)] font-black uppercase tracking-[0.1em] text-slate-950 shadow-lg" data-testid="vehicle-detail-carup-gold">
                    ★ CarUp Gold
                  </Badge>
                )}
                {isReservedOnServer && <Badge className="bg-amber-500 text-white">Reserved</Badge>}
              </div>
              <div className="absolute top-4 right-4 flex gap-2">
                <button onClick={toggleFavorite} aria-label="Save this vehicle" className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center hover:bg-white">
                  <Heart className={`w-5 h-5 ${isFav ? 'fill-red-500 text-red-500' : 'text-gray-600'}`} />
                </button>
                <Link
                  to={compareHref}
                  aria-label="Compare this vehicle"
                  className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center hover:bg-white"
                  data-testid="vehicle-detail-compare"
                >
                  <GitCompare className="w-5 h-5 text-gray-600" />
                </Link>
                <button onClick={handleShare} aria-label="Share this listing" data-testid="vehicle-detail-share" className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center hover:bg-white">
                  <Share2 className="w-5 h-5 text-gray-600" />
                </button>
              </div>
            </div>

            {/* Rule 5: counted, never silently dropped. A short gallery that hides what it could
                not render is passing our defect off as the seller's omission.

                THE SENTENCE NAMES NO SINGLE CAUSE, AND THAT IS A CORRECTION. It used to end "the
                stored address is not a form CarUp will publish" — a definite finding about ONE
                field, published over a number that has never only counted that field. The
                backend's `unpublishable_count` already merged url failures with identity failures
                (`form === null || mediaId === null || identitiesTaken.has(mediaId)` — one
                increment, three causes), and the count arrives here already merged, so the page
                cannot know which applied and may not say. Rule 6b's uniqueness check on this page
                adds a fourth contributor to the same number. One count, one honest sentence: the
                record could not be published, and the reason is not something this surface
                determined. */}
            {listingMedia.unpublishable_count > 0 && (
              <p className="text-xs text-amber-700" data-testid="listing-media-unpublishable">
                {listingMedia.unpublishable_count} recorded photo(s) could not be shown here, because
                what CarUp holds for them — the stored address, or the name that tells one photograph
                from another — is not in a form it will publish. That is a fault in the record, not a
                statement about the vehicle.
              </p>
            )}

            {/* Thumbnails */}
            {galleryItems.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {/* Rule 6b, and the reason the identity is not decorative: React reconciles on
                    this key. Keyed on `position` the previous thumbnail's DOM node — and its
                    decoded bitmap — is reused for a DIFFERENT photograph whenever the payload
                    re-orders, which is how a gallery briefly shows the wrong car. `media_id` names
                    the photograph, so the node follows the picture rather than the slot. The
                    composite falls back only for the marketplace transport, which carries no
                    identity to key on. */}
                {galleryItems.map((item, galleryIndex) => (
                  <button key={item.media_id ?? `${item.position}-${item.url}`} onClick={() => setCurrentImageIdx(galleryIndex)}
                    data-testid="listing-media-thumb"
                    data-media-id={item.media_id ?? undefined}
                    aria-label={`Show photo ${galleryIndex + 1}`}
                    className={`flex-shrink-0 w-20 h-14 rounded-lg overflow-hidden border-2 transition-colors ${galleryIndex === activeImageIdx ? 'border-orange-500' : 'border-transparent'}`}>
                    <img src={item.url} alt="" className="w-full h-full object-cover" onError={() => markListingMediaFailed(item.url)} />
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <section
          className="mb-6 grid gap-5 border-y border-slate-200 py-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end"
          data-testid="vehicle-detail-intelligence-hero"
        >
          <div>
            <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-orange-600">
              <ShieldCheck className="h-4 w-4" /> CarUp Vehicle Passport
            </div>
            <h1 className="mt-2 text-3xl font-black tracking-[-0.035em] text-slate-950 sm:text-4xl">
              {vehicle.year ?? ''} {vehicle.make} {vehicle.model}
            </h1>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
              <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-orange-500" /> {locationLine.label}</span>
              {typeof vehicle.mileage === 'number' && Number.isFinite(vehicle.mileage) && (
                <span className="inline-flex items-center gap-1.5"><Gauge className="h-4 w-4 text-orange-500" /> {vehicle.mileage.toLocaleString()} km</span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-7 lg:justify-end">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Asking price</p>
              <p className="mt-1 text-2xl font-black text-slate-950">{governedPrice(vehicle.price, vehicle.currency)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Canonical Trust</p>
              <p className="mt-1 text-2xl font-black text-slate-950">{trust.score !== null ? `${trust.score}/100` : trust.headline}</p>
              {trust.score !== null && <p className="mt-0.5 text-xs text-slate-500">{trust.headline}</p>}
            </div>
          </div>
        </section>

        {/* Backend-governed marketplace panels (trust, all-in price, inquiry, safety) */}
        {detail && (
          <div className="mb-6 grid gap-4 lg:grid-cols-3" data-testid="marketplace-detail-panels">
            <div className="space-y-4 lg:col-span-2">
              <TrustSummaryPanel trust={detail.trust_summary} verification={detail.verification_summary} />
              {(vehicle?.vin || id) && <TrustDecisionPanel vin={(vehicle?.vin || id) as string} />}
              {(vehicle?.vin || id) && <SourceCoveragePanel vin={(vehicle?.vin || id) as string} />}
              <SafetyWarnings warnings={detail.safety_warnings} />
            </div>
            <div className="space-y-4">
              <AllInPricePanel pricing={detail.pricing_summary} />
              <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                <h3 className="mb-2 text-sm font-semibold text-gray-900">Contact &amp; inquire</h3>
                <div className="flex flex-col gap-2">
                  <InquiryModal
                    listingId={detail.vin}
                    inquiryTypes={['vehicle_purchase_interest', 'vehicle_inspection_request']}
                    triggerLabel="Send inquiry"
                    triggerClassName="w-full"
                  />
                  <InquiryModal
                    listingId={detail.vin}
                    inquiryTypes={['vehicle_inspection_request']}
                    defaultInquiryType="vehicle_inspection_request"
                    triggerLabel="Request inspection"
                    triggerVariant="outline"
                    triggerClassName="w-full"
                  />
                </div>
                <p className="mt-2 text-[11px] text-gray-500">Inquiries are safe — the CarUp team helps connect you. Never pay outside CarUp.</p>
              </div>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          {/* ── Left column ─────────────────────────────────────────────── */}
          <div className="min-w-0 lg:col-span-2 space-y-6">

            {/* Plate Advisory Banner */}
            {passport && (
              (() => {
                const plateState = identifierState(identity?.plateNumber, identifiersRedacted);
                const tempIdState = identifierState(identity?.temporaryIdentificationNumber, identifiersRedacted);
                // Only assertable once the identifiers are visible: under redaction the page knows
                // neither whether a plate exists nor whether it was verified.
                const isMissing = plateState === 'unrecorded' && tempIdState === 'unrecorded';
                const isUnverified = plateState === 'present' && !identity?.plateVerifiedAt;
                // plateStatus is public in every audience, so a flag is assertable even under redaction.
                const isFlagged = identity?.plateStatus === 'Flagged' || identity?.plateStatus === 'Suspended';

                if (isFlagged) {
                  return (
                    <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg text-red-800 flex items-start gap-3" data-testid="plate-advisory">
                      <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-sm">SECURITY WARNING: Plate Flagged/Suspended</p>
                        <p className="text-xs mt-0.5">The registration plate registered to this vehicle has been marked as Flagged or Suspended by the registry authority. Proceed with caution.</p>
                      </div>
                    </div>
                  );
                } else if (identifiersRedacted) {
                  return (
                    <div className="bg-gray-50 border-l-4 border-gray-300 p-4 rounded-r-lg text-gray-700 flex items-start gap-3" data-testid="plate-advisory-withheld">
                      <Lock className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-sm">Registration identifiers are not shown publicly</p>
                        <p className="text-xs mt-0.5">Plate, temporary ID, chassis and engine numbers are withheld from public view. This is a privacy rule for every listing — it says nothing about this vehicle and does not affect its trust score.</p>
                      </div>
                    </div>
                  );
                } else if (isMissing) {
                  return (
                    <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-lg text-amber-800 flex items-start gap-3" data-testid="plate-advisory">
                      <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-sm">Confidence Advisory: Missing Number Plate</p>
                        <p className="text-xs mt-0.5">This vehicle does not have a permanent registration plate or temporary identification number registered. Trust score confidence has been reduced.</p>
                      </div>
                    </div>
                  );
                } else if (isUnverified) {
                  return (
                    <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-lg text-amber-800 flex items-start gap-3" data-testid="plate-advisory">
                      <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-sm">Confidence Advisory: Unverified Number Plate</p>
                        <p className="text-xs mt-0.5">A number plate is assigned but has not yet been verified against the Central Vehicle Registry (CVR). Trust score confidence has been reduced.</p>
                      </div>
                    </div>
                  );
                }
                return null;
              })()
            )}



            {/* ── VERIFIED EVIDENCE — governed artifacts, deliberately not a gallery ────
                The convergence: both blocks are composed on this page, adjacent, and neither can be
                read as the other. The listing block above is a full-width 16:9 carousel of the
                seller's own pictures; this one is a list of records, each with a review decision and
                its own provenance. A buyer scanning the page meets the difference before they meet
                any individual file. */}
            <Card className="card-shadow border border-gray-100 border-l-4 border-l-emerald-600" data-testid="verified-evidence-block">
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-1">
                  <FileCheck className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-gray-900">Verified evidence</h2>
                </div>
                <p className="text-xs text-gray-500 mb-4" data-testid="verified-evidence-caption">
                  Governed artifacts CarUp has reviewed — registration, inspection, clearance, customs,
                  insurance and service records. These are not the listing photos above: each item here
                  carries its own provenance and a review decision.
                </p>

                {verifiedEvidence.state === 'published' ? (
                  <ul className="space-y-3" data-testid="verified-evidence-list">
                    {verifiedEvidence.items.map((item, i) => {
                      const isImageArtifact = (item.mime_type ?? '').startsWith('image/')
                      const advertisement = isAdvertisementEvidence(item)
                      return (
                        <li
                          key={item.id ?? `evidence-${i}`}
                          className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3"
                          data-testid="verified-evidence-item"
                        >
                          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded border border-gray-200 bg-gray-50">
                            {isImageArtifact && item.file_url ? (
                              <img src={item.file_url} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <FileText className="h-5 w-5 text-gray-400" aria-hidden="true" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-gray-900">{humaniseEvidenceType(item)}</p>
                              <Badge className="bg-emerald-600 text-white text-[10px]" data-testid="verified-evidence-status">
                                Reviewed &amp; verified
                              </Badge>
                            </div>
                            {/* Provenance, and only the kind that belongs to the public projection.
                                Who uploaded it and who reviewed it are internal identities that
                                Phase 0 allow-listed out of every public body; a date that was never
                                recorded says so rather than being back-filled from another column. */}
                            <p className="mt-1 text-xs text-gray-500" data-testid="verified-evidence-provenance">
                              Captured {evidenceDate(item.captured_at)} · reviewed {evidenceDate(item.verified_at)}
                              {' · source '}{item.source_name || 'not recorded'}
                            </p>
                            {/* The record is published; the document is not. Saying so is the point —
                                silence here would read as "there is nothing to see", which is the
                                false-absence this whole block exists to avoid. */}
                            {item.file_availability === 'withheld_private' && (
                              <p className="mt-1 text-xs text-gray-500" data-testid="verified-evidence-file-withheld">
                                CarUp reviewed this document and is not publishing the file itself.
                              </p>
                            )}
                            {advertisement && (
                              <p className="mt-1 text-xs text-amber-700" data-testid="verified-evidence-advertisement-note">
                                This is a record of how the vehicle was advertised. The review attests the
                                advertisement, not the vehicle.
                              </p>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                ) : verifiedEvidence.state === 'none' ? (
                  <div className="rounded-lg border border-dashed border-gray-200 p-4 text-center" data-testid="verified-evidence-empty">
                    <p className="text-sm font-medium text-gray-600">{verifiedEvidence.empty_statement}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      Whether this listing carries photos is a different question, and it is answered
                      separately above.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-gray-200 p-4 text-center" data-testid="verified-evidence-not-loaded">
                    <p className="text-sm font-medium text-gray-600">
                      CarUp did not read this vehicle’s evidence record on this page.
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      Nothing is stated either way about whether governed evidence exists for it.
                    </p>
                  </div>
                )}

                {/* One truth state renders ONE message.
                    This note used to sit outside the state ternary above, so a block reporting
                    state 'none' printed "No verified evidence has been published for this vehicle"
                    and, immediately beneath it, "4 reviewed item(s) could not be displayed" — two
                    statements that cannot both be true of the same vehicle. The backend no longer
                    produces that combination (a row naming a real artifact is published as a fact
                    with the file withheld), and the guard here makes it unrenderable regardless:
                    the shortfall note belongs only to a block that DID publish something. */}
                {verifiedEvidence.state === 'published' && verifiedEvidence.unpublishable_count > 0 && (
                  <p className="mt-3 text-xs text-amber-700" data-testid="verified-evidence-unpublishable">
                    {verifiedEvidence.unpublishable_count} further reviewed item(s) could not be displayed
                    because the stored file address is unusable. The record exists; CarUp could not render
                    it here.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Info card */}
            <Card className="border-0 card-shadow">
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h1 className="text-2xl font-bold">{vehicle.year ?? ''} {vehicle.make ?? ''} {vehicle.model ?? ''}</h1>
                    
                    {/* Plate, VIN and Registration Status identity block */}
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <span className="text-xs font-semibold px-2 py-1 bg-gray-100 rounded text-gray-700 font-mono">
                        VIN: {vehicle.vin}
                      </span>
                      {identity?.plateNumber ? (
                        <span className="text-xs font-bold px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded font-mono flex items-center gap-1" data-testid="identity-plate">
                          Plate: {identity.plateNumber}
                        </span>
                      ) : identity?.temporaryIdentificationNumber ? (
                        <span className="text-xs font-bold px-2 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded font-mono flex items-center gap-1" data-testid="identity-temp-id">
                          Temp ID: {identity.temporaryIdentificationNumber}
                        </span>
                      ) : identifiersRedacted ? (
                        <span className="text-xs font-medium px-2 py-1 bg-gray-100 text-gray-600 border border-gray-200 rounded flex items-center gap-1" data-testid="identity-plate-withheld">
                          <Lock className="w-3 h-3" /> Plate: not shown publicly
                        </span>
                      ) : (
                        <span className="text-xs font-bold px-2 py-1 bg-red-50 text-red-700 border border-red-200 rounded" data-testid="identity-no-plate">
                          No Plate Assigned
                        </span>
                      )}
                      {passport?.identity?.registrationStatus && (
                        <Badge className={`${
                          passport.identity.registrationStatus === 'Current' || passport.identity.registrationStatus === 'Active' ? 'bg-green-500 text-white' :
                          passport.identity.registrationStatus === 'Pending' ? 'bg-amber-500 text-white' : 'bg-red-500 text-white'
                        } text-[10px] font-semibold`} data-testid="registration-status-badge">
                          {passport.identity.registrationStatus}
                        </Badge>
                      )}
                      {/* Government-approval claims (CID/police/ZIMRA/duty) are deliberately absent here.
                          Legacy booleans without authoritative public provenance cannot produce buyer-facing approval badges. */}
                    </div>

                    <div className="flex items-center gap-2 mt-3 text-sm text-gray-500">
                      <MapPin className="w-4 h-4" />
                      <span data-testid="detail-location">{locationLine.label}</span>
                    </div>
                  </div>
                  <div className={`${trust.tone} text-white px-4 py-2 rounded-xl text-center min-w-[70px] max-w-[150px]`} data-testid="trust-score-badge">
                    {trust.score !== null && (
                      <p className="text-2xl font-bold" data-testid="trust-score-value">{trust.score}</p>
                    )}
                    <p className="text-xs" data-testid="trust-score-label">{trust.headline}</p>
                  </div>
                </div>
                {vehicle.description && <p className="text-gray-700 mb-6 leading-relaxed">{vehicle.description}</p>}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                  {[
                    // 0 km is a real reading, so presence is tested on the number, not on truthiness.
                    { label: 'Mileage',       value: Number.isFinite(vehicle.mileage) ? `${vehicle.mileage.toLocaleString()} km` : null, icon: Gauge },
                    { label: 'Transmission',  value: vehicle.transmission || null, icon: Settings2 },
                    { label: 'Fuel Type',     value: vehicle.fuel_type || vehicle.fuelType || null, icon: Fuel },
                    { label: 'Condition',     value: vehicle.condition || null, icon: FileCheck },
                  ].map((item) => (
                    <div key={item.label} className="bg-gray-50 rounded-lg p-3 text-center">
                      <item.icon className="w-5 h-5 text-orange-500 mx-auto mb-1" />
                      <p className="text-xs text-gray-500">{item.label}</p>
                      {item.value ? (
                        <p className="font-semibold text-sm">{item.value}</p>
                      ) : (
                        <p className="text-sm text-gray-400 italic" data-testid="spec-not-recorded">Not recorded</p>
                      )}
                    </div>
                  ))}
                </div>
                {(vehicle.features ?? []).length > 0 && (
                  <>
                    <Separator className="mb-6" />
                    <h3 className="font-semibold mb-3">Features</h3>
                    <div className="flex flex-wrap gap-2">
                      {(vehicle.features ?? []).map((f) => (
                        <Badge key={f} variant="secondary" className="bg-gray-100 text-gray-700 font-normal">{f}</Badge>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Vehicle History Intelligence: a buyer should see the living vehicle story before
                navigating into the deeper report/evidence tools. It renders only the public-safe
                report projection already governed by Truth & Trust. */}
            {report && <VehicleIntelligenceStory report={report} />}

            {/* ── Tabs ─────────────────────────────────────────────────── */}
            <Card className="border-0 card-shadow">
              <CardContent className="p-6">
                <Tabs defaultValue="history">
                  <TabsList className="w-full flex-wrap">
                    <TabsTrigger value="history" className="flex-1">Vehicle History</TabsTrigger>
                    <TabsTrigger value="report" className="flex-1">History Report</TabsTrigger>
                    <TabsTrigger value="evidence" className="flex-1">Evidence Vault</TabsTrigger>
                    <TabsTrigger value="verification" className="flex-1">Verification</TabsTrigger>
                    <TabsTrigger value="market" className="flex-1">Market Analysis</TabsTrigger>
                  </TabsList>

                  {/* ── History tab: canonical lifecycle first, legacy audit timeline as compatibility fallback ── */}
                  <TabsContent value="history" className="mt-4" data-testid="history-tab-content">
                    {lifecycleLoaded ? (
                      lifecycleEvents.length === 0 ? (
                        <div className="text-center py-8 text-gray-400" data-testid="history-empty-state">
                          <Clock className="w-10 h-10 mx-auto mb-3 opacity-30" />
                          <p className="font-medium">No dated lifecycle records in current coverage</p>
                          <p className="text-xs mt-1 text-gray-400">This is not proof of a clean history. Add governed evidence, service, ownership or inspection records to expand coverage.</p>
                        </div>
                      ) : (
                        <div className="space-y-3" data-testid="history-timeline" data-history-source="canonical-lifecycle">
                          {lifecycleEvents.map((event: VehicleLifecycleEvent) => {
                            const { icon: Icon, color } = lifecycleIcon(event.category)
                            const evidenceItem = event.evidence_id
                              ? publicEvidence.find(item => item.id === event.evidence_id)
                              : undefined
                            const isDoc = evidenceItem
                              ? Boolean(evidenceItem.mime_type?.includes('pdf') || evidenceItem.file_url?.endsWith('.pdf') || evidenceItem.evidence_type.includes('document'))
                              : false
                            return (
                              <div
                                key={event.id}
                                className="flex items-start gap-3 border-b border-slate-200 bg-white py-4"
                                data-testid="timeline-event"
                                data-lifecycle-category={event.category}
                              >
                                <div className={`flex-shrink-0 w-9 h-9 flex items-center justify-center ${color}`}>
                                  <Icon className="w-4 h-4" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <p className="font-semibold text-sm text-slate-900">{event.label}</p>
                                    <Badge variant="outline" className="rounded-none text-[10px] capitalize">{event.category.replace(/_/g, ' ')}</Badge>
                                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{lifecycleStatusLabel(event)}</span>
                                  </div>
                                  <p className="text-xs text-slate-500 mt-1">
                                    {event.date ? new Date(event.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date unknown'}
                                    {typeof event.mileage === 'number' ? ` · ${event.mileage.toLocaleString()} ${event.mileage_unit || 'km'}` : ''}
                                    {event.source_kind ? ` · ${event.source_kind.replace(/_/g, ' ')}` : ''}
                                  </p>
                                  {event.detail_state === 'summary_only' && (
                                    <p className="mt-1 text-[11px] text-slate-400">A maintenance event is recorded; public part-level detail is not published from this record.</p>
                                  )}
                                  {evidenceItem && (
                                    <div className="mt-3 flex items-center gap-2">
                                      <div className="h-14 w-16 overflow-hidden border border-slate-200 bg-slate-50" data-testid={`history-thumbnail-${evidenceItem.id}`}>
                                        {!evidenceItem.file_url || isDoc ? (
                                          <div className="flex h-full w-full items-center justify-center" data-testid={!evidenceItem.file_url ? 'history-thumbnail-withheld' : undefined}>
                                            <FileText className="w-6 h-6 text-gray-400" />
                                          </div>
                                        ) : (
                                          <img src={evidenceItem.file_url} className="w-full h-full object-cover" alt="" />
                                        )}
                                      </div>
                                      <span className="text-[11px] text-slate-500">Governed evidence linked to this lifecycle event</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )
                    ) : timeline.length === 0 ? (
                      <div className="text-center py-8 text-gray-400" data-testid="history-empty-state">
                        <Clock className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p className="font-medium">Vehicle lifecycle was not loaded</p>
                        <p className="text-xs mt-1 text-gray-400">CarUp will not turn a missing lifecycle projection into a claim that the vehicle has no history.</p>
                      </div>
                    ) : (
                      <div className="space-y-3" data-testid="history-timeline" data-history-source="legacy-audit-fallback">
                        {timeline.map((event: TimelineEvent, idx) => {
                          const { icon: Icon, color } = timelineIcon(event.event_source)
                          return (
                            <div key={`${event.event_source}-${event.id ?? idx}`} className="flex items-start gap-3 p-3 bg-gray-50" data-testid="timeline-event">
                              <div className={`flex-shrink-0 w-8 h-8 flex items-center justify-center ${color}`}>
                                <Icon className="w-4 h-4" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm">{event.label}</p>
                                {event.desc && <p className="text-xs text-gray-500 mt-0.5 truncate">{event.desc}</p>}
                                <p className="text-xs text-gray-400 mt-1">
                                  {event.timestamp ? new Date(event.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date unknown'}
                                  {event.details?.mileage ? ` · ${event.details.mileage.toLocaleString()} km` : ''}
                                </p>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </TabsContent>

                  {/* ── Vehicle History Report tab (M4): full buyer report ── */}
                  <TabsContent value="report" className="mt-4" data-testid="history-report-tab-content">
                    {/* Owner/dealer/admin actions: snapshot a version + create an expiring share link.
                        Backend role-gates the writes; UI keeps them unobtrusive for privileged roles. */}
                    {canManageReport && (
                      <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50 p-4" data-testid="report-owner-actions">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <FileSearch className="h-4 w-4 text-gray-400" aria-hidden="true" />
                            <span>Snapshot this report or share it with a buyer via an expiring link.</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleGenerateReportVersion}
                              disabled={reportBusy}
                            >
                              {reportBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck className="mr-2 h-4 w-4" />}
                              Generate report version
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              onClick={handleCreateShareLink}
                              disabled={reportBusy}
                            >
                              {reportBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
                              Create share link
                            </Button>
                          </div>
                        </div>
                        {shareLink && (
                          <div className="mt-3 flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-2" data-testid="report-share-link">
                            <Copy className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                            <code className="min-w-0 flex-1 truncate text-xs text-gray-600">{shareLink}</code>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => { navigator.clipboard?.writeText(shareLink); toast.success('Copied.') }}
                            >
                              Copy
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    {reportLoading ? (
                      <div className="flex flex-col items-center py-12 text-gray-400">
                        <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
                        <p className="mt-3 text-sm">Loading vehicle history report…</p>
                      </div>
                    ) : report ? (
                      <VehicleHistoryReport report={report} />
                    ) : (
                      <div className="text-center py-10 text-gray-400" data-testid="history-report-unavailable">
                        <HelpCircle className="w-10 h-10 mx-auto mb-3 opacity-30" aria-hidden="true" />
                        <p className="font-medium">History report unavailable</p>
                        <p className="text-xs mt-1">{reportError || 'The report could not be loaded for this vehicle.'}</p>
                      </div>
                    )}
                  </TabsContent>

                  {/* ── Evidence tab: buyer-facing visual proof timeline ── */}
                  <TabsContent value="evidence" className="mt-4" data-testid="evidence-timeline-tab-content">
                    {/* Vehicle life-stage timeline (M1): groups verified, public-safe evidence by the eight life stages. */}
                    {publicEvidence.length > 0 && (
                      <div className="mb-8">
                        <h3 className="text-lg font-semibold mb-3">Vehicle Life Timeline</h3>
                        <VehicleLifeStageTimeline
                          evidence={publicEvidence}
                          taxonomy={evidenceTaxonomy}
                          sources={evidenceSources}
                        />
                      </div>
                    )}
                    <PremiumEvidenceGallery evidence={evidenceVault} />

                    {/* Vehicle Life Intelligence (M3): reviewer-confirmed, public-safe
                        before/after comparisons across the vehicle's life. Empty is the
                        expected case for most vehicles and implies nothing is wrong. */}
                    <div className="mt-8" data-testid="temporal-comparison-section">
                      <h3 className="text-lg font-semibold mb-1">Component Changes Over Time</h3>
                      <p className="text-xs text-gray-500 mb-3">
                        Reviewer-confirmed before/after comparisons of vehicle components across its life.
                      </p>
                      <VehicleTemporalComparison findings={temporalFindings} />
                    </div>

                    {/* Disclosure conflicts: neutral comparison of seller disclosures
                        against available evidence. Empty is the expected case. */}
                    <div className="mt-8" data-testid="disclosure-panel-section">
                      <h3 className="text-lg font-semibold mb-1">Disclosure Review</h3>
                      <p className="text-xs text-gray-500 mb-3">
                        How the seller's disclosures compare against available evidence, as confirmed by a reviewer.
                      </p>
                      <VehicleDisclosurePanel conflicts={disclosureConflicts} />
                    </div>
                    {/* M5 governance: disputes & corrections (public-safe; owners can raise). */}
                    <div className="mt-8" data-testid="dispute-panel-section">
                      <DisputePanel vin={vehicle?.vin || id || ''} />
                    </div>
                  </TabsContent>

                  {/* ── Verification tab: real trust metrics ── */}
                  <TabsContent value="verification" className="mt-4" data-testid="verification-tab-content">
                    {verificationSources.length === 0 ? (
                      <div className="text-center py-8 text-gray-400">
                        <HelpCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p className="font-medium">Verification data unavailable</p>
                        <p className="text-xs mt-1">Trust report could not be loaded for this vehicle</p>
                      </div>
                    ) : (
                      <div className="space-y-2" data-testid="verification-list">
                        {verificationSources.map((src: PassportVerificationSource) => {
                          const Icon = src.status === 'verified' ? CheckCircle
                            : src.status === 'warning' ? AlertTriangle
                            : src.status === 'not_verified' ? XCircle
                            : HelpCircle
                          const iconColor = src.status === 'verified' ? 'text-green-600'
                            : src.status === 'warning' ? 'text-amber-600'
                            : 'text-gray-400'

                          return (
                            <div key={src.label}
                              className="flex items-center gap-3 p-3 rounded-lg bg-gray-50"
                              data-testid="verification-item"
                            >
                              <Icon className={`w-5 h-5 flex-shrink-0 ${iconColor}`} />
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm">{src.label}</p>
                                {src.detail && <p className="text-xs text-gray-500 mt-0.5">{src.detail}</p>}
                              </div>
                              <VerificationBadge status={src.status} />
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </TabsContent>

                  {/* ── Market Analysis tab ── */}
                  <TabsContent value="market" className="mt-4">
                    <div className="grid sm:grid-cols-3 gap-4">
                      <div className="bg-gray-50 rounded-lg p-4 text-center">
                        <p className="text-xs text-gray-500 mb-1">Listed Price</p>
                        <p className="text-xl font-bold">{governedPrice(vehicle.price, vehicle.currency)}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4 text-center">
                        <p className="text-xs text-gray-500 mb-1">Trust Score</p>
                        {trust.score !== null ? (
                          <p className={`text-xl font-bold ${trust.toneText}`} data-testid="market-trust-score">{trust.score} / 100</p>
                        ) : (
                          <p className={`text-sm font-semibold ${trust.toneText}`} data-testid="market-trust-unscored">{trust.headline}</p>
                        )}
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4 text-center">
                        <p className="text-xs text-gray-500 mb-1">Service Records</p>
                        {serviceRecordCount === null ? (
                          <p className="text-sm text-gray-400 italic" data-testid="service-records-unrecorded">Not recorded</p>
                        ) : (
                          <p className="text-xl font-bold">{serviceRecordCount}</p>
                        )}
                      </div>
                    </div>
                    <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                      <h4 className="font-medium text-sm mb-2">CarUp Data Summary</h4>
                      <p className="text-sm text-gray-600" data-testid="carup-data-summary">
                        {trust.score !== null
                          ? `CarUp's trust authority published ${trust.score}/100 for this vehicle — ${trust.headline.toLowerCase()}.`
                          : `${trust.headline}: CarUp has published no trust score for this vehicle.`}
                        {` ${trust.detail}`}
                        {/* The calculation version is stated only beside a published score. Naming
                            the superseded version beside a withheld one would read as provenance
                            for a number the page is deliberately not showing. */}
                        {trust.score !== null && publicTrust?.calculation_version
                          ? ` Calculation version ${publicTrust.calculation_version}.`
                          : ''}
                        {serviceRecordCount === null
                          ? ' No service-record count is recorded for this vehicle.'
                          : serviceRecordCount > 0
                            ? ` It has ${serviceRecordCount} mechanic-signed service record(s) on the ledger.`
                            : ' No mechanic-signed service records have been submitted yet.'}
                        {/* An adverse alert is stated when it is present. Its absence is NOT stated as
                            "no active alert" — no record is not the same as a clean check. */}
                        {trustSignals?.stolen_alert_active
                          ? ' ⚠️ WARNING: This vehicle has an active police alert.'
                          : ''}
                      </p>
                      <p className="mt-2 text-xs text-gray-500">
                        A recorded event is not by itself a verification, so CarUp does not turn a count of
                        events into a trust claim. Each signal is shown separately in the trust breakdown.
                      </p>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>

          {/* ── Right sidebar ────────────────────────────────────────────── */}
          <div className="space-y-6">
            {/* Price / CTA card */}
            {/* OBS-02: this panel was `sticky top-6` at every breakpoint and unbounded in height, so
                on a short viewport it pinned itself over the vehicle details while the reader
                scrolled. It now sticks only where there is a second column to stick beside, and is
                capped to the viewport with its own scroll so it can never cover the content. */}
            <Card className="border-0 card-shadow bg-gradient-to-br from-[hsl(222,47%,11%)] to-[hsl(222,47%,18%)] text-white lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
              <CardContent className="p-6">
                <p className="text-sm text-gray-300 mb-1">Price</p>
                <p className="text-3xl font-bold">{governedPrice(vehicle.price, vehicle.currency)}</p>
                <div className="flex items-center gap-1 mt-1">
                  <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                  <span className="text-sm text-gray-300" data-testid="sidebar-trust">
                    {trust.score !== null
                      ? `CarUp Trust Score: ${trust.score}`
                      : `CarUp Trust: ${trust.headline}`}
                  </span>
                </div>
                {sellerContactNumber && sellerWhatsAppLink ? (
                  <div className="flex gap-2 mt-6">
                    <a href={`tel:${sellerContactNumber}`} onClick={() => toast.info(`Calling ${vehicle.sellerName ?? 'the seller'}...`)} className="flex-1">
                      <Button className="w-full bg-orange-500 hover:bg-orange-600 gap-1"><Phone className="w-4 h-4" /> Call</Button>
                    </a>
                    <a href={sellerWhatsAppLink} target="_blank" rel="noopener noreferrer" className="flex-1">
                      <Button variant="outline" className="w-full border-white/30 text-white hover:bg-white/10 gap-1"><MessageSquare className="w-4 h-4" /> WhatsApp</Button>
                    </a>
                  </div>
                ) : (
                  <div className="mt-6" data-testid="seller-contact-unavailable">
                    <InquiryModal
                      listingId={detail?.vin || vehicle.vin}
                      inquiryTypes={['vehicle_purchase_interest', 'vehicle_inspection_request']}
                      defaultInquiryType="vehicle_purchase_interest"
                      triggerLabel="Contact through CarUp"
                      triggerClassName="w-full bg-orange-500 text-white hover:bg-orange-400"
                      defaultMessage="I am interested in this vehicle. Please connect me with the seller through CarUp."
                      intentMetadata={{ buyer_intent: 'seller_contact' }}
                    />
                    <p className="mt-2 text-xs text-gray-400">
                      The seller has not published a direct number. CarUp can route your inquiry without exposing private contact details.
                    </p>
                  </div>
                )}
                <Separator className="my-4 border-white/20" />
                {isReservedOnServer ? (
                  <div className="w-full flex items-center justify-center gap-2 bg-amber-600/20 border border-amber-500/40 rounded-lg py-3 text-amber-300 font-semibold text-sm" data-testid="reserved-state">
                    <Lock className="w-4 h-4" /> Reserved
                  </div>
                ) : reserveRequested ? (
                  <div className="w-full flex items-center justify-center gap-2 bg-white/10 border border-white/20 rounded-lg py-3 text-gray-200 font-semibold text-sm" data-testid="reserve-requested-state">
                    <Clock className="w-4 h-4" /> Reservation requested — awaiting confirmation
                  </div>
                ) : (
                  <div data-testid="reservation-request-entry">
                    <InquiryModal
                      listingId={detail?.vin || vehicle.vin}
                      inquiryTypes={['vehicle_purchase_interest']}
                      defaultInquiryType="vehicle_purchase_interest"
                      triggerLabel="Request reservation"
                      triggerClassName="w-full bg-white text-slate-950 hover:bg-orange-50"
                      defaultMessage="I want to reserve this vehicle. Please confirm the seller and tell me the next SafePay step."
                      intentMetadata={{ buyer_intent: 'reservation_request', safepay_requested: true }}
                      onSubmitted={() => setReserveRequested(true)}
                    />
                    <p className="mt-2 text-xs text-gray-400">
                      CarUp resolves the current seller, purchase inquiry, listing terms and Trust gates before a reservation or SafePay step can open.
                    </p>
                  </div>
                )}
                {financeInterestRequested ? (
                  <div className="mt-3 w-full flex items-center justify-center gap-2 bg-blue-600/20 border border-blue-500/40 rounded-lg py-3 text-blue-300 font-semibold text-sm" data-testid="financing-interest-state">
                    <CheckCircle className="w-4 h-4" /> Financing interest sent
                  </div>
                ) : (
                  <div className="mt-3" data-testid="financing-request-entry">
                    <InquiryModal
                      listingId={detail?.vin || vehicle.vin}
                      inquiryTypes={['vehicle_purchase_interest']}
                      defaultInquiryType="vehicle_purchase_interest"
                      triggerLabel="Ask about financing"
                      triggerVariant="outline"
                      triggerClassName="w-full border-white/20 text-white hover:bg-white/10"
                      defaultMessage="I am interested in financing this vehicle. Please tell me which governed lender path is available and what information I need to provide."
                      intentMetadata={{ buyer_intent: 'financing_interest' }}
                      onSubmitted={() => setFinanceInterestRequested(true)}
                    />
                    <p className="mt-2 text-xs text-gray-400">
                      CarUp will not invent a lender, approval, currency or loan terms. A financing application starts only when a real lender path and listing currency are verified.
                    </p>
                  </div>
                )}
                <p className="text-xs text-gray-400 text-center mt-3">🔒 SafePay opens only after CarUp verifies transaction eligibility</p>
              </CardContent>
            </Card>

            {/* Seller card */}
            <Card className="border-0 card-shadow">
              <CardContent className="p-6">
                <h3 className="font-semibold mb-4">Seller Information</h3>
                <div className="flex items-center gap-3 mb-4">
                  {vehicle.sellerAvatar && <img src={vehicle.sellerAvatar} alt="" className="w-12 h-12 rounded-full object-cover" />}
                  <div>
                    <p className="font-medium" data-testid="seller-name">
                      {/* Marketplace seller-profile consent is authoritative as soon as detail loads.
                          Do not wait for passport enrichment before honoring a disabled public profile:
                          that race exposed "Not recorded" for a seller whose public identity is withheld. */}
                      {detail?.seller_summary?.public_profile_enabled === false
                        ? 'Not shown publicly'
                        : vehicle.sellerName
                          ?? (passport?.ownershipSummary?.currentSellerRecorded ? 'Not shown publicly' : 'Not recorded')}
                    </p>
                    {vehicle.sellerType && (
                      <Badge variant="outline" className="text-[10px] mt-0.5">{vehicle.sellerType}</Badge>
                    )}
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-gray-400" />
                    {sellerContactNumber ? (
                      <a href={`tel:${sellerContactNumber}`} className="hover:text-orange-500">{sellerContactNumber}</a>
                    ) : (
                      <span className="text-gray-500" data-testid="seller-phone-unavailable">No contact number published</span>
                    )}
                  </div>
                </div>
                <Button variant="outline" className="w-full mt-4" asChild>
                  <Link to="/dealers">View All Listings</Link>
                </Button>
              </CardContent>
            </Card>

            {/* Vehicle Identity */}
            <Card className="border-0 card-shadow">
              <CardContent className="p-6">
                <h3 className="font-semibold mb-4">Vehicle Identity</h3>
                <div className="space-y-3 text-sm">
                  {[
                    // `redactable` marks the rows the projection withholds from an unauthorized
                    // audience; the rest are public, so absence there can only mean unrecorded.
                    { label: 'VIN', value: identity?.vin || vehicle.vin, redactable: false },
                    { label: 'Chassis No.', value: identity?.chassisNumber || vehicle.chassis_number, redactable: true },
                    { label: 'Engine No.', value: identity?.engineNumber || vehicle.engine_number || vehicle.engineNumber, redactable: true },
                    // Governed identity only. The raw `vehicle.registration_country`/`_authority`
                    // columns carry a fabricated DB DEFAULT ('ZW'/'CVR') on most rows; the passport
                    // withdrew them, so falling back to the column here re-introduced the fabrication.
                    { label: 'Reg. Country', value: identity?.registrationCountry, redactable: false },
                    { label: 'Reg. Authority', value: identity?.registrationAuthority, redactable: false },
                    { label: 'Color', value: vehicle.color, redactable: false },
                  ].map(({ label, value, redactable }) => {
                    const state = identifierState(value, redactable && identifiersRedacted)
                    return (
                      <div key={label} className="flex justify-between">
                        <span className="text-gray-500">{label}</span>
                        {state === 'present' ? (
                          <span className="font-mono text-xs" data-testid="identity-field-present" data-field={label}>{value}</span>
                        ) : state === 'withheld' ? (
                          <span className="text-xs text-gray-500 italic" data-testid="identity-field-withheld" data-field={label}>Not shown publicly</span>
                        ) : (
                          <span className="text-xs text-gray-400 italic" data-testid="identity-field-unrecorded" data-field={label}>Not recorded</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Ownership Summary */}
            {passport?.ownershipSummary && (
              <Card className="border-0 card-shadow" data-testid="ownership-summary-card">
                <CardContent className="p-6">
                  <h3 className="font-semibold mb-4">Ownership Summary</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Current Seller</span>
                      {passport.ownershipSummary.currentSellerDisplayName ? (
                        <span className="font-medium" data-testid="ownership-seller-present">
                          {passport.ownershipSummary.currentSellerDisplayName}
                        </span>
                      ) : passport.ownershipSummary.currentSellerRecorded ? (
                        <span className="font-medium text-gray-500" data-testid="ownership-seller-withheld">
                          Not shown publicly
                        </span>
                      ) : (
                        <span className="font-medium text-gray-500" data-testid="ownership-seller-unrecorded">
                          Not recorded
                        </span>
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Current Owner Type</span>
                      {passport.ownershipSummary.currentSellerType ? (
                        <span className="font-medium" data-testid="ownership-seller-type-present">
                          {passport.ownershipSummary.currentSellerType}
                        </span>
                      ) : (
                        <span className="font-medium text-gray-500" data-testid="ownership-seller-type-unrecorded">
                          Not recorded
                        </span>
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Previous Owners</span>
                      <span className="font-medium" data-testid="prev-owner-count">
                        {passport.ownershipSummary.previousOwnerCount} owner(s) ({passport.ownershipSummary.previousOwnersPublicLabel})
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Owner PII Status</span>
                      <Badge variant="outline" className="text-[10px] text-gray-500 border-gray-200">
                        {passport.ownershipSummary.ownerNamesRedacted ? 'Redacted' : 'Full Access'}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Plate History */}
            {passport?.plateHistory && (
              <Card className="border-0 card-shadow" data-testid="plate-history-card">
                <CardContent className="p-6">
                  <h3 className="font-semibold mb-4">Plate Registration History</h3>
                  {passport.plateHistory.length === 0 ? (
                    passport.plateHistoryRedacted ? (
                      <p className="text-xs text-gray-400" data-testid="plate-history-withheld">
                        Plate registration history is not shown publicly for this vehicle.
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400" data-testid="plate-history-empty">
                        No previous plates logged in history.
                      </p>
                    )
                  ) : (
                    <div className="space-y-3">
                      {passport.plateHistory.map((h, i) => {
                        const plateState = identifierState(h.plate_number, identifiersRedacted)
                        return (
                        <div key={h.id || i} className="border-b border-gray-50 pb-2 last:border-0 last:pb-0">
                          <div className="flex justify-between items-center text-sm">
                            {plateState === 'present' ? (
                              <span className="font-mono font-bold text-xs" data-testid="plate-history-number-present">{h.plate_number}</span>
                            ) : plateState === 'withheld' ? (
                              <span className="text-xs text-gray-500 italic" data-testid="plate-history-number-withheld">Plate not shown publicly</span>
                            ) : (
                              <span className="text-xs text-gray-400 italic" data-testid="plate-history-number-unrecorded">Plate not recorded</span>
                            )}
                            <Badge variant="outline" className={`text-[9px] uppercase ${
                              h.status === 'active' ? 'border-green-300 text-green-700 bg-green-50' : 'border-gray-200 text-gray-500'
                            }`}>
                              {h.status || 'status not recorded'}
                            </Badge>
                          </div>
                          <div className="flex justify-between text-[11px] text-gray-400 mt-1">
                            <span>Type: {h.plate_type || 'not recorded'}</span>
                            <span>{h.issued_at ? new Date(h.issued_at).toLocaleDateString() : 'date not recorded'}</span>
                          </div>
                          {h.reason && <p className="text-[10px] text-gray-500 mt-1 italic">Reason: {h.reason}</p>}
                        </div>
                        )
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* What the canonical assessment is based on. The former "Trust Score Breakdown"
                invented per-category percentages on the client; a fabricated precision is worse
                than no breakdown, so only what the authority actually published is rendered here.
                This card is where the projection's other two axes surface: `confidence` (how much
                evidence is behind the number) and `evidence_basis` (what that evidence is). A
                number alone cannot tell an unevidenced vehicle from a genuinely low-scoring one. */}
            {publicTrust && (
              <Card className="border-0 card-shadow" data-testid="trust-basis">
                <CardContent className="p-6">
                  <h3 className="font-semibold mb-1">What this assessment is based on</h3>
                  <p className="text-xs text-gray-500 mb-4" data-testid="trust-state-detail">
                    {trust.detail} CarUp does not estimate a sub-score for a signal it has no record of.
                  </p>

                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="border-gray-200 bg-gray-50 text-[10px] text-gray-600" data-testid="trust-evaluation-state">
                      {TRUST_STATE_LABELS[publicTrust.evaluation_state] ?? publicTrust.evaluation_state}
                    </Badge>
                    <Badge variant="outline" className="border-gray-200 bg-gray-50 text-[10px] text-gray-600" data-testid="trust-confidence">
                      {TRUST_CONFIDENCE_LABELS[publicTrust.confidence] ?? publicTrust.confidence}
                    </Badge>
                    {trust.score !== null && publicTrust.evaluated_at && (
                      <span className="text-[10px] text-gray-500" data-testid="trust-evaluated-at">
                        Evaluated {new Date(publicTrust.evaluated_at).toLocaleDateString()}
                      </span>
                    )}
                    {/* The rules this number was produced under. It was published only inside the
                        "Market Analysis" tab, which is not the active tab, so the version was absent
                        from the Trust panel that states the score — a number with its provenance one
                        click away is a number without provenance. Gated on a published score for the
                        same reason as `evaluated_at`: naming a version beside a WITHHELD score would
                        read as provenance for a number this page is deliberately not showing. */}
                    {trust.score !== null && publicTrust.calculation_version && (
                      <span className="text-[10px] font-mono text-gray-500" data-testid="trust-calculation-version">
                        {publicTrust.calculation_version}
                      </span>
                    )}
                  </div>

                  {evidenceBasis && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-gray-700 mb-2">Evidence behind this assessment</p>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600" data-testid="trust-evidence-basis">
                        <dt>Governed facts backed by a record</dt>
                        <dd className="text-right font-medium">
                          {basisValue(evidenceBasis.governed_facts_substantiated)}
                          {evidenceBasis.governed_facts_total === null ? '' : ` of ${evidenceBasis.governed_facts_total}`}
                        </dd>
                        <dt>Adverse findings</dt>
                        <dd className="text-right font-medium">{basisValue(evidenceBasis.governed_facts_adverse)}</dd>
                        <dt>Connected sources</dt>
                        <dd className="text-right font-medium">{basisValue(evidenceBasis.connected_sources)}</dd>
                        <dt>Stored claims with no backing record</dt>
                        <dd className="text-right font-medium" data-testid="trust-unbacked-claims">
                          {basisValue(evidenceBasis.unbacked_legacy_claims)}
                        </dd>
                      </dl>
                    </div>
                  )}

                  {trustReasonCodes.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-gray-700 mb-2">Reason codes</p>
                      <div className="flex flex-wrap gap-1.5" data-testid="trust-reason-codes">
                        {trustReasonCodes.map((code) => (
                          <Badge key={code} variant="outline" className="border-gray-200 bg-gray-50 font-mono text-[10px] text-gray-600">
                            {code}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {trustLimitations.length > 0 && (
                    <>
                      <p className="text-xs font-semibold text-gray-700 mb-2">Known limitations</p>
                      <ul className="list-disc list-inside space-y-1 text-xs text-gray-600" data-testid="trust-known-limitations">
                        {trustLimitations.map((limitation, i) => (
                          <li key={i}>{limitation}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Ledger verification badge */}
            {passport?.chainVerification && (
              <Card className="border-0 card-shadow">
                <CardContent className="p-4">
                  <div className={`flex items-center gap-2 text-sm ${passport.chainVerification.verified ? 'text-green-700' : 'text-amber-700'}`}>
                    {passport.chainVerification.verified
                      ? <><CheckCircle className="w-4 h-4" /> CarUp audit ledger verified — hash chain intact</>
                      : <><AlertTriangle className="w-4 h-4" /> Ledger integrity unconfirmed</>
                    }
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      <MarketplaceShareSheet
        open={shareOpen}
        onOpenChange={setShareOpen}
        title={`${vehicle.year ?? ''} ${vehicle.make ?? ''} ${vehicle.model ?? ''}`.trim()}
        url={typeof window !== 'undefined' ? window.location.href : ''}
      />

    </div>
  )
}
