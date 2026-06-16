/**
 * Marketplace v1 canonical contracts (shared web + mobile + backend reference).
 *
 * These describe the SAFE PUBLIC shape of marketplace data. Backend is the sole
 * authority for trust/verification/risk — the frontend renders only what the backend
 * supplies and never invents badges. See docs/MARKETPLACE_V1_IMPLEMENTATION_MAP.md.
 */

import type { MarketplaceListingSummary, MarketplaceTag } from './index';

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

export interface MarketplaceMedia {
  url: string;
  type: 'image' | 'video' | 'document';
  is_primary?: boolean;
}

export interface MarketplaceSellerSummary {
  display_label: string;
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
  media: MarketplaceMedia[];
  seller_summary: MarketplaceSellerSummary;
  trust_summary: MarketplaceTrustSummary;
  verification_summary: MarketplaceVerificationSummary;
  pricing_summary: MarketplacePricingSummary;
  safety_warnings: string[];
  /** Future SafePay transaction-intent readiness (contract only in v1). */
  transaction_intent?: MarketplaceTransactionIntent;
}

/** SafePay-ready contract (NOT implemented in v1 — fields are forward-compatible only). */
export interface MarketplaceTransactionIntent {
  transaction_intent_id: string | null;
  payment_readiness_status: 'not_ready' | 'inquiry_only' | 'deposit_allowed' | 'escrow_ready';
  escrow_required: boolean;
  deposit_allowed: boolean;
  operator_review_required: boolean;
  fraud_hold_status: 'none' | 'hold' | 'cleared';
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
export type { MarketplaceListingSummary, MarketplaceTag };
