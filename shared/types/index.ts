export type UserRole = 'owner' | 'dealer' | 'mechanic' | 'bank' | 'insurance' | 'government' | 'admin';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  avatar?: string;
  /**
   * The organisation this SESSION acts for — set only by an explicit selection
   * (PUT /api/auth/active-tenant) and re-verified by the server on every request (OC-5D). Login never
   * picks one. Sent as `x-tenant-id`, which the server treats as an assertion about the selection.
   */
  active_tenant_id?: string | null;
  /** The person's role inside the active organisation (from the verified membership). Display only. */
  tenant_role?: string | null;
  active_tenant?: ActiveTenant | null;
  /** 'selected', 'revoked' (the selection no longer holds — ask again) or 'none'. */
  tenant_context?: TenantContextState;
  /** The organisations the person may act for, as the server verified them at login or /me. */
  memberships?: TenantMembership[];
  /** True when the server could not read the memberships (retry; never "you belong nowhere"). */
  memberships_unavailable?: boolean;
}

export type TenantContextState = 'selected' | 'revoked' | 'none' | 'asserted';

/**
 * OC-5D (P6) — one entry of GET /api/service-history/me, held to
 * shared/contracts/owner-service-history.v1.contract.json. Money is shown with its currency or not at
 * all; every field the schema may lack is nullable and must be rendered with a guard.
 */
export interface ServiceMoney {
  recorded: boolean;
  amount: number | null;
  currency: string | null;
}

export type WorkOrderOwnerAuthorization = 'pending' | 'authorized' | 'declined' | 'revoked';

export interface OwnerServiceHistoryEntry {
  id: string;
  vin: string;
  status: string | null;
  description: string | null;
  issue_description: string | null;
  total_cost: number | null;
  labor_cost: number | null;
  created_at: string | null;
  updated_at: string | null;
  owner_authorization: WorkOrderOwnerAuthorization | null;
  money: ServiceMoney;
  // Service Network enrichment (optional in v1)
  service_case_id?: string | null;
  service_category?: string | null;
  work_performed?: string | null;
  provenance?: string;
  completed_at?: string | null;
  cancelled_at?: string | null;
  performed_at?: string | null;
}

export interface ActiveTenant {
  id: string;
  name: string | null;
  type: string | null;
  status: string | null;
  role: string | null;
}

export interface TenantMembership extends ActiveTenant {
  /** Only an ACTIVE organisation can be selected. */
  selectable: boolean;
}

export interface Vehicle {
  vin: string;
  make: string;
  model: string;
  generation?: string;
  trim?: string;
  year: number;
  color?: string;
  mileage: number;
  fuel_type?: string;
  drivetrain?: string;
  transmission?: string;
  import_source?: string;
  duty_paid: boolean;
  police_verified: boolean;
  status: 'Available' | 'Reserved' | 'Sold' | 'Archived';
  trust_score: number;
  price: number;
  currency: string;
  created_at?: string;
}

export type VehicleConditionCategory =
  | 'brand_new'
  | 'recently_imported'
  | 'locally_used'
  | 'second_hand'
  | 'certified_dealer'
  | 'unknown';

export type MarketplaceTag =
  | 'passport_verified'
  | 'plate_verified'
  | 'evidence_available'
  | 'duty_cleared'
  | 'zimra_verified'
  | 'cid_clear'
  | 'low_mileage'
  | 'fresh_import'
  | 'one_owner'
  | 'dealer_verified'
  | 'private_sale'
  | 'safe_pay_ready'
  | 'inspection_ready'
  | 'recent_service'
  | 'partsentry_checked'
  | 'repair_history_available'
  | 'verified_parts';

export type MarketplacePrimaryImageState =
  | 'seller_primary'
  | 'first_published'
  | 'none'
  | 'not_loaded';

export type MarketplaceReservationState =
  | 'active'
  | 'expired'
  | 'none'
  | 'unavailable'
  | 'inconsistent';

export interface MarketplaceReservationSummary {
  state: MarketplaceReservationState;
  reserved: boolean | null;
  reserved_at: string | null;
  expires_at: string | null;
  reason: string | null;
}

/** Exact ten-field public projection from canonicalTrustService.toPublicTrust(). */
export type MarketplaceTrustEvaluationState = 'evaluated' | 'stale' | 'not_evaluated' | 'unavailable';

export interface MarketplaceTrustEvidenceBasis {
  governed_facts_total: number | null;
  governed_facts_substantiated: number | null;
  governed_facts_adverse: number | null;
  connected_sources: number | null;
  unbacked_legacy_claims: number | null;
}

export interface MarketplacePublicTrust {
  vin: string;
  score: number | null;
  band: string | null;
  evaluation_state: MarketplaceTrustEvaluationState;
  confidence: string | null;
  evidence_basis: MarketplaceTrustEvidenceBasis | null;
  calculation_version: string | null;
  evaluated_at: string | null;
  known_limitations: string[];
  source: 'computed' | 'cache' | 'none' | string;
}

/**
 * The anonymous listing payload. Registry identifiers (plate_number,
 * normalized_plate_number, chassis_number) are absent by contract — see
 * PRIVATE_VEHICLE_FIELDS in backend/utils/publicVehicleProjection.js. Declaring them here
 * would let a consumer compile against a field the API will never send.
 */
export interface MarketplaceCarUpGold {
  state: 'qualified' | 'not_qualified' | 'not_evaluable';
  tier: 'gold' | null;
  label: 'CarUp Gold' | null;
  policy_version: string;
  reason_codes: string[];
}

export interface MarketplaceListingSummary {
  vin: string;
  make: string;
  model: string;
  year: number | null;
  color?: string | null;
  price: number | null;
  currency: string | null;
  mileage: number | null;
  fuel_type?: string | null;
  transmission?: string | null;
  drivetrain?: string | null;
  body_style?: string | null;
  seller_stated_condition?: string | null;
  seller_description?: string | null;
  seller_features?: string[];
  taxonomy_version?: string | null;
  make_taxon_id?: string | null;
  model_taxon_id?: string | null;
  fuel_taxon_id?: string | null;
  transmission_taxon_id?: string | null;
  drivetrain_taxon_id?: string | null;
  body_style_taxon_id?: string | null;
  color_taxon_id?: string | null;
  /**
   * Normally the governed listing lifecycle string. `null` is deliberate when the raw row says
   * Reserved but canonical reservation truth is unavailable/inconsistent: a stale cache is not a
   * smaller fact and may not be published merely because consumers prefer a string.
   */
  status: string | null;
  condition_category: VehicleConditionCategory;
  marketplace_tags: MarketplaceTag[];
  /**
   * Compatibility key only. It is the canonical projection's score when one exists and null in
   * not_evaluated/stale/unavailable states. Consumers MUST read `trust` to understand lifecycle,
   * confidence, provenance and limitations; this key is never a fallback to vehicles.trust_score.
   */
  trust_score: number | null;
  /** Backend-governed premium qualification. Gold is never inferred from score alone. */
  carup_gold?: MarketplaceCarUpGold;
  /** The canonical Trust authority for the listing card. Null means the authority was not read. */
  trust?: MarketplacePublicTrust | null;
  /**
   * THE CARD'S COVER IMAGE. Read `primary_image_state` before describing it — the KEY NAME asserts
   * something the data often cannot support, and only the state says whether it does.
   */
  primary_image_url?: string | null;
  primary_image_state: MarketplacePrimaryImageState;
  primary_image_unpublishable_count: number;
  plate_verified: boolean;
  plate_status?: string | null;
  passport_verified: boolean;
  evidence_count: number;
  partsentry_checked: boolean;
  repair_history_count: number;
  verified_parts_count: number;
  duty_cleared: boolean;
  zimra_verified: boolean;
  cid_clear: boolean;
  seller_type: 'dealer' | 'private' | string | null;
  seller_display_label: string | null;
  seller_public_profile_enabled: boolean;
  location?: string | null;
  location_state?: 'recorded' | 'not_recorded' | 'withheld' | 'not_applicable';
  created_at?: string | null;
  /**
   * Present on public Marketplace API list responses after the Phase 6 route overlay. Optional on
   * this lower-level summary type because the pure listingSummaryService does not read reservation
   * tables; a consumer that did not receive the envelope must treat it as NOT LOADED, never `none`.
   */
  reservation_summary?: MarketplaceReservationSummary;
}

export interface MarketplaceListingsResponse {
  listings: MarketplaceListingSummary[];
  total: number;
  limit: number;
  ranking?: { requested?: string; applied?: string; note?: string };
}

export interface Escrow {
  id: string;
  vin: string;
  buyer_id: string;
  seller_id: string;
  amount: number;
  currency: string;
  status: 'Pending' | 'Escrowed' | 'Inspecting' | 'Completed' | 'Disputed' | 'Refunded';
  fee_split_zimra: number;
  fee_split_escrow: number;
  current_stage: number;
  dispute_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface Organization {
  id: string;
  name: string;
  type: 'dealership' | 'garage' | 'insurance' | 'bank' | 'fleet' | 'import' | 'government';
  created_at: string;
  status: 'active' | 'suspended';
}

export interface Notification {
  id: string;
  recipient_id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
}

export interface ServiceRecord {
  id: string;
  vin: string;
  mechanic_id: string;
  part_name: string;
  part_oem?: string;
  action_type: 'Replaced' | 'Repaired' | 'Inspected' | 'Diagnosed';
  description?: string;
  mileage: number;
  signature: string;
  timestamp: string;
}

// Marketplace v1 canonical contracts (trust/verification/pricing/inquiry/referral).
export * from './marketplace';
export * from './communication';
// Phase 7C: shared identity-verification status mapping + admin review contracts.
export * from './verificationStatus';