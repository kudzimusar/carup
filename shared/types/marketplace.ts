/**
 * Marketplace v1 canonical contracts (shared web + mobile + backend reference).
 *
 * These describe the SAFE PUBLIC shape of marketplace data. Backend is the sole
 * authority for trust/verification/risk — the frontend renders only what the backend
 * supplies and never invents badges. See docs/MARKETPLACE_V1_IMPLEMENTATION_MAP.md.
 */

import type {
  MarketplaceListingSummary,
  MarketplacePrimaryImageState,
  MarketplaceReservationState,
  MarketplaceReservationSummary,
  MarketplaceTag,
} from './index';

export type MarketplaceListingType =
  | 'vehicle'
  | 'part'
  | 'service'
  | 'garage'
  | 'dealer_stock'
  | 'import_request'
  | 'container_space'
  | 'diaspora_request';

export type MarketplacePublicStatus =
  | 'draft'
  | 'pending_review'
  | 'public'
  | 'suppressed'
  | 'rejected'
  | 'archived';

export type MarketplaceRiskStatus = 'clear' | 'watch' | 'flagged' | 'blocked';

export type MarketplacePartSentryPublicStatus =
  | 'not_applicable'
  | 'eligible'
  | 'ineligible'
  | 'review_required'
  | 'suppressed';

export interface MarketplacePartFitment {
  taxonomy_version: string;
  make: string;
  model: string;
  year_from: number | null;
  year_to: number | null;
  body_style?: string | null;
  engine_code?: string | null;
  variant?: string | null;
}

export type MarketplaceEvidenceStatus = 'none' | 'partial' | 'verified' | 'review_required';

export type MarketplaceIdentityStatus = 'unverified' | 'pending_review' | 'verified' | 'rejected';

/** Backend-generated trust summary. The frontend MUST NOT synthesize these fields. */
export interface MarketplaceTrustSummary {
  trust_badges: string[];
  public_badge_copy: string[];
  evidence_status: MarketplaceEvidenceStatus;
  vehicle_passport_available: boolean;
  identity_verified: boolean;
  dealer_verified: boolean;
  partsentry_public_status: MarketplacePartSentryPublicStatus;
  suspicion_status: 'clear' | 'watch' | 'flagged';
  risk_status: MarketplaceRiskStatus;
  risk_reasons: string[];
  safe_public_copy: string;
  /** Admin-only narrative — present only for admin/reviewer audiences. Never sent to public. */
  admin_explanation?: string;
  // Plan §6 MarketplaceTrustSummary contract aliases (additive superset; same governed values).
  public_copy?: string;
  safe_public_claims?: string[];
  risk_flags_public?: string[];
  verification_status?: 'unverified' | 'pending' | 'verified' | 'rejected' | 'manual_review';
  trust_score?: number | null;
}

export interface MarketplaceVerificationSummary {
  seller_verified: boolean;
  identity_status: MarketplaceIdentityStatus;
  vehicle_evidence_verified: boolean;
  part_provenance_verified: boolean;
  inspection_available: boolean;
  inspection_verified: boolean;
  verification_notes_public: string[];
}

export interface MarketplacePricingSummary {
  asking_price?: number;
  currency?: string;
  estimated_fair_min?: number;
  estimated_fair_max?: number;
  price_confidence: 'low' | 'medium' | 'high';
  inspection_estimate?: number;
  local_transport_estimate?: number;
  export_import_estimate?: number;
  container_shipping_estimate?: number;
  documentation_estimate?: number;
  service_fee_estimate?: number;
  referral_discount_estimate?: number;
  estimated_total?: number;
  price_warnings: string[];
  /** True when only deterministic static bands were used (AI price intelligence unavailable). */
  estimate_basis: 'deterministic' | 'ai_assisted';
}

/**
 * ── THE CANONICAL VEHICLE MEDIA CONTRACT, DECLARED (Issue #164 Phase 5) ────────────────────────
 *
 * The authority is `backend/utils/vehicleMediaProjection.js`; this is its DECLARATION for the
 * surfaces that cannot import it. Everything below mirrors that module's exported shape, and the
 * rule numbers refer to its rules.
 *
 * WHY IT IS DECLARED HERE AND NOT IN A PAGE. The service published `media_id`, `url_form` and
 * `position` on every media entry plus the `listing_media` envelope beside it, while this file still
 * said `MarketplaceMedia = { url, type, is_primary? }` — a declared type that was a STRICT SUBSET of
 * the wire. `VehicleDetail.tsx` had to widen it locally to read an identity that was already being
 * sent, and recorded the gap as a finding rather than fixing it in a .tsx file, because a page
 * authoring a cross-surface contract is how "No verified images uploaded yet" — a governance
 * sentence — came to be written in a component. This is the right place; the page's local widening
 * is retired.
 */

/**
 * RULE 5: URL HONESTY. What a consumer may assume about the URL STRING, and nothing about the asset
 * behind it. No URL in this contract is signed, and none is checked for existence, reachability, or
 * for depicting the vehicle.
 *
 *   `absolute_https`    — begins `https://`. Resolves independent of the viewing page.
 *   `absolute_http`     — begins `http://`. Published, and flagged: blocked as mixed content on an
 *                         https page.
 *   `protocol_relative` — begins `//`. LOOKS site-relative and is not: the host is foreign and only
 *                         the scheme is inherited.
 *   `site_relative`     — begins with a single `/`. Resolves against THE VIEWING ORIGIN, which is
 *                         not necessarily where the asset lives.
 *
 * Anything else (`data:`, `blob:`, `javascript:`, a bare `photo.jpg`, a blank, a non-string) is
 * UNPUBLISHABLE and never appears — it is counted in `unpublishable_count` instead.
 */
export type MarketplaceMediaUrlForm =
  | 'absolute_https'
  | 'absolute_http'
  | 'protocol_relative'
  | 'site_relative';

/**
 * RULE 1: A BLOCK THAT WAS NEVER READ MAY NOT SAY "NONE".
 *
 *   `not_loaded` — this read path did not consult the source. NOTHING is claimed, `items` is empty
 *                  and `empty_statement` is null, so a consumer rendering the statement renders
 *                  nothing at all. This state is the whole reason the defect closed: a path that
 *                  never queried `listing_images` used to publish a confident negative about it.
 *   `none`       — the source WAS consulted and holds nothing publishable. A finding, and it gets a
 *                  sentence.
 *   `published`  — at least one item.
 *
 * `state` is REQUIRED and is the discriminator. A body carrying no `state` is not a media block, and
 * a consumer must parse it as nothing rather than as an empty gallery.
 */
export type MarketplaceMediaBlockState = 'published' | 'none' | 'not_loaded';

/**
 * A listing-media item — the seller's own advertising photo. UNVERIFIED, and incapable of carrying a
 * verification claim: `listing_images` is (id, vin, image_url, is_primary, display_order,
 * created_at) and holds no uploader, no capture time, no reviewer, no status and no checksum, so
 * any trust word attached to one is authored by the renderer (Rule 3).
 *
 * SHARES NOT ONE KEY NAME with an evidence item (Rule 7), which is what makes "these two can never
 * be conflated" an assertion a test can run rather than a convention a reviewer enforces by eye.
 *
 * `created_at` is deliberately NOT published although the column exists: it is the row's INSERT
 * time, and a date beside a photo is read as when the photo was taken.
 */
export interface MarketplaceListingMediaItem {
  /**
   * RULE 6b: THE STABLE OPAQUE IDENTITY — `listing_images.id`, lowercased, gated by an anchored
   * UUID grammar so no storage path, bucket name or filename can be published in this slot.
   *
   * `position` addresses a SLOT and this addresses a PHOTOGRAPH. They are different facts:
   * `position` is a dense ordinal that changes whenever a sibling row moves and is `0` on the first
   * photo of every vehicle, and `url` is no better — it survives a CDN rewrite and it can collide,
   * since there is no unique index on `listing_images.image_url`.
   *
   * It is spelled `media_id` rather than `id` because an evidence item already carries `id`, and one
   * shared key name would collapse the Rule 7 disjointness proof.
   *
   * REQUIRED, because the projection cannot publish an item without one: a row whose `id` fails the
   * grammar is counted in `unpublishable_count` and no item is emitted. A consumer reading a deploy
   * that predates this contract will find the key absent at runtime and must validate rather than
   * trust — the declaration binds the contract, not the bytes on any particular wire.
   */
  media_id: string;
  /** AN UNVALIDATED STRING SOMEONE RECORDED. See `url_form` for the only guarantee attached to it. */
  url: string;
  url_form: MarketplaceMediaUrlForm;
  /** The projection's dense 0-based ordinal AFTER sorting — NOT the raw `display_order` column. */
  position: number;
  /**
   * RULE 6: PRIMACY IS THE SELLER'S CHOICE OR IT DOES NOT EXIST. `true` only where a row claims it;
   * no primary is elected when nobody claimed one. Where several rows claim it — nothing in the
   * schema prevents that — the first in sort order keeps the claim and the rest are demoted, so a
   * consumer never has to arbitrate between two "main photos".
   */
  is_primary: boolean;
  /**
   * True only for generated staging/reference listing media. This is an advertising/demo
   * provenance marker, never a verification/evidence claim and never a Trust input.
   */
  synthetic_demo: boolean;
  /** Seller-authored listing presentation label; never a verification/evidence claim. */
  photo_label: string | null;
}

/**
 * The uniform envelope both media blocks carry. Shared on purpose, so a consumer reads listing media
 * and verified evidence through ONE protocol; the ITEM shapes are what differ.
 */
export interface MarketplaceListingMediaBlock {
  state: MarketplaceMediaBlockState;
  items: MarketplaceListingMediaItem[];
  /**
   * Rows the source held and this contract will not publish — an unrenderable url, or an identity
   * that is missing or repeated. COUNTED, never silently dropped, so a block can never pass "we
   * could not render it" off as "the seller added none".
   */
  unpublishable_count: number;
  /**
   * The sentence, and it belongs to `none` alone — `published` has items to speak for it and
   * `not_loaded` has nothing to say. Null in both of those states.
   */
  empty_statement: string | null;
}

/**
 * The COMPATIBILITY VIEW of `listing_media.items`, kept because renaming it would break live
 * readers. It is not a second computation that could drift: the service builds every entry as
 * `listing_media.items[i]` plus the one legacy key, which is why this type EXTENDS the item type
 * rather than restating it — a view cannot disagree with its source, and the compiler now says so.
 *
 * READ `listing_media`, NOT THIS, WHEN BOTH ARE PRESENT. An array cannot express `not_loaded` (it
 * arrives as `[]`, indistinguishable from "no photos") and it cannot carry `unpublishable_count`.
 * Answering from this key about a payload that has an envelope reinstates Rule 1's defect.
 */
export interface MarketplaceMedia extends MarketplaceListingMediaItem {
  /**
   * A statement about the ROW'S SOURCE — it came from `listing_images` rather than from some future
   * video or document entry. NEVER a claim that the asset at `url` is an image; nothing validates
   * the asset. Only `'image'` is currently emitted.
   */
  type: 'image' | 'video' | 'document';
}

export interface MarketplaceSellerSummary {
  display_label: string | null;
  seller_type: 'dealer' | 'private' | string;
  public_profile_enabled: boolean;
  location?: string;
  country?: string;
}

/** Full listing-detail payload (GET /api/marketplace/listings/:id). */
export interface MarketplaceListingDetail extends MarketplaceListingSummary {
  listing_type: MarketplaceListingType;
  public_status: MarketplacePublicStatus;
  risk_status: MarketplaceRiskStatus;
  description?: string | null;
  short_description?: string | null;
  /**
   * THE AUTHORITY on this payload's gallery. Read this, and `media` only when a payload carries no
   * envelope: this is the one place on the body where "we did not look" can be stated at all.
   */
  listing_media: MarketplaceListingMediaBlock;
  /** The compatibility view, derived from `listing_media.items`. See `MarketplaceMedia`. */
  media: MarketplaceMedia[];
  seller_summary: MarketplaceSellerSummary;
  trust_summary: MarketplaceTrustSummary;
  verification_summary: MarketplaceVerificationSummary;
  pricing_summary: MarketplacePricingSummary;
  /**
   * Phase 6 public reservation authority. Required on detail responses: the page may not infer a live
   * hold from `status`, because that field is a materialized cache and can lag clock/provider state.
   */
  reservation_summary: MarketplaceReservationSummary;
  safety_warnings: string[];
  /**
   * Phase 6 public-safe readiness projection. It never contains participant/provider ids and never
   * asserts buyer-specific deposit eligibility on the anonymous detail response.
   */
  transaction_intent?: MarketplaceTransactionIntent;
}

/**
 * Phase 6 public transaction-readiness contract. This is not a payment instruction and carries no
 * provider/payment intent/counterparty identity. Buyer-specific canonical sessions are available only
 * through authenticated transaction routes.
 */
export interface MarketplaceTransactionIntent {
  transaction_intent_id: string | null;
  payment_readiness_status: 'not_ready' | 'inquiry_only' | 'deposit_allowed' | 'escrow_ready';
  escrow_required: boolean;
  deposit_allowed: boolean;
  operator_review_required: boolean;
  fraud_hold_status: 'none' | 'hold' | 'cleared';
  reservation_state: MarketplaceReservationState;
  reservation_expires_at: string | null;
}

export type MarketplaceInquiryType =
  | 'vehicle_purchase_interest'
  | 'vehicle_inspection_request'
  | 'part_quote_request'
  | 'garage_service_request'
  | 'import_quote_request'
  | 'container_space_interest'
  | 'dealer_stock_request'
  | 'sell_my_car_request'
  | 'trade_in_request'
  | 'diaspora_vehicle_request'
  | 'diaspora_parts_request'
  | 'family_purchase_support';

export type MarketplaceInquiryStatus =
  | 'new'
  | 'assigned'
  | 'contacted'
  | 'qualified'
  | 'closed'
  | 'spam'
  | 'rejected';

export type MarketplaceSourceChannel =
  | 'web'
  | 'mobile'
  | 'whatsapp'
  | 'telegram'
  | 'facebook'
  | 'qr'
  | 'operator';

export interface MarketplaceInquiryInput {
  listing_id?: string;
  inquiry_type: MarketplaceInquiryType;
  message?: string;
  guest_name?: string;
  guest_email?: string;
  guest_phone?: string;
  referral_code?: string;
  campaign_code?: string;
  source_channel?: MarketplaceSourceChannel;
  country?: string;
  metadata?: Record<string, unknown>;
}

/** Public/owner-safe inquiry projection (no internal risk metadata, no assigned operator for guests). */
export interface MarketplaceInquiry {
  id: string;
  listing_id?: string | null;
  inquiry_type: MarketplaceInquiryType;
  status: MarketplaceInquiryStatus;
  source_channel: MarketplaceSourceChannel;
  referral_attributed: boolean;
  created_at: string;
}

export const MARKETPLACE_REFERRAL_EVENT_TYPES = [
  'marketplace_listing_viewed',
  'marketplace_inquiry_created',
  'marketplace_quote_requested',
  'marketplace_inspection_requested',
  'marketplace_listing_paid',
  'marketplace_purchase_confirmed',
  'marketplace_service_booked',
  'marketplace_import_interest_created',
  'marketplace_container_space_interest_created',
] as const;

export type MarketplaceReferralEventType = (typeof MARKETPLACE_REFERRAL_EVENT_TYPES)[number];

export interface MarketplaceReferralEvent {
  event_type: MarketplaceReferralEventType;
  listing_id?: string;
  inquiry_id?: string;
  referral_code?: string;
  campaign_code?: string;
  actor_id?: string;
  source_channel?: MarketplaceSourceChannel;
  metadata?: Record<string, unknown>;
}

/** Re-export for convenience so consumers can import everything from one module. */
export type {
  MarketplaceListingSummary,
  MarketplacePrimaryImageState,
  MarketplaceReservationState,
  MarketplaceReservationSummary,
  MarketplaceTag,
};
