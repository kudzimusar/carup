export type UserRole = 'owner' | 'dealer' | 'mechanic' | 'bank' | 'insurance' | 'government' | 'admin';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  avatar?: string;
  active_tenant_id?: string | null;
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

/**
 * The anonymous listing payload. Registry identifiers (plate_number,
 * normalized_plate_number, chassis_number) are absent by contract — see
 * PRIVATE_VEHICLE_FIELDS in backend/utils/publicVehicleProjection.js. Declaring them here
 * would let a consumer compile against a field the API will never send.
 */
/**
 * The provenance of `MarketplaceListingSummary.primary_image_url`. Declared beside the summary
 * rather than in `./marketplace.ts` so the URL and the label that qualifies it stay in ONE file —
 * splitting them is how a field ends up published, declared nowhere and read by nobody. Re-exported
 * from `./marketplace.ts` so the marketplace façade carries the whole contract.
 */
export type MarketplacePrimaryImageState =
  | 'seller_primary'
  | 'first_published'
  | 'none'
  | 'not_loaded';

/**
 * Issue #164 Phase 6 — the public reservation vocabulary.
 *
 * `vehicle_reservations` is authoritative; `vehicles.status='Reserved'` is only a cache. The
 * envelope deliberately carries no reservation id, transaction id, buyer/seller id or provider
 * information. `reserved:null` means CarUp could not safely decide, not false.
 */
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

export interface MarketplaceListingSummary {
  vin: string;
  make: string;
  model: string;
  year: number;
  price: number;
  currency: string;
  mileage: number;
  fuel_type?: string | null;
  transmission?: string | null;
  /**
   * Normally the governed listing lifecycle string. `null` is deliberate when the raw row says
   * Reserved but canonical reservation truth is unavailable/inconsistent: a stale cache is not a
   * smaller fact and may not be published merely because consumers prefer a string.
   */
  status: string | null;
  condition_category: VehicleConditionCategory;
  marketplace_tags: MarketplaceTag[];
  trust_score: number;
  /**
   * THE CARD'S COVER IMAGE. Read `primary_image_state` before describing it — the KEY NAME asserts
   * something the data often cannot support, and only the state says whether it does.
   */
  primary_image_url?: string | null;
  /**
   * WHERE THE COVER IMAGE CAME FROM (Issue #164 Phase 5, `listingSummaryService.electPrimaryImage`).
   *
   * REQUIRED, and that is the point of declaring it. `primary_image_url` was published alone for the
   * whole of v1: with two rows neither of which claimed `is_primary`, the lower-`display_order` one
   * was still published under a key called "primary" — a seller's choice nobody made. Deleting the
   * key would have blanked every card that has photos and no primacy claim, so the fact was not
   * withdrawn, it was LABELLED, in the `*_state` idiom Phase 4 established for `location` and
   * `currency`. A label a consumer can omit from its own type is a label that changes nothing, which
   * is why this is not optional: anything claiming to be a listing summary carries it.
   *
   *   `seller_primary`  — a row claims `is_primary`. THIS IS THE SELLER'S OWN CHOICE, and the only
   *                       state under which a surface may describe the photo as their main one.
   *   `first_published` — nobody claimed primacy. This is merely the first publishable photo in
   *                       display order, and describing it as the seller's choice would fabricate
   *                       one.
   *   `none`            — the source WAS consulted and holds nothing publishable.
   *   `not_loaded`      — the source was NOT consulted (Rule 1). `primary_image_url` is null here
   *                       for the same reason it is null under `none`, and the two are DIFFERENT
   *                       FACTS: a surface that has not read the gallery may not report it empty.
   *
   * NOT A SECOND DEFINITION OF PRIMACY. The election happens once, in the backend projection. This
   * reports what that election did; a consumer that re-derives it from anything else has forked the
   * contract.
   */
  primary_image_state: MarketplacePrimaryImageState;
  /**
   * Rows the source held and the contract will not publish. Keeps `none` honest: without it, "three
   * photos we could not render" and "the seller added none" both read as `none` with a null URL.
   */
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
  seller_type: 'dealer' | 'private' | string;
  seller_display_label: string;
  seller_public_profile_enabled: boolean;
  location?: string;
  /**
   * WHY THE LINE ABOVE IS OR IS NOT THERE — the same `*_state` idiom as `primary_image_state` and
   * `currency_state`, composed by `listingSummaryService.deriveLocationState` from the recorded
   * `claims.location` leaves.
   *
   * Undeclared until Issue #164 Phase 8, and the omission had teeth: the server has always sent it,
   * but with no type to read, every card fell back to `location || '<some words>'` and each surface
   * invented its own words — Marketplace said "Location unknown", Search said "Location not
   * recorded", and Landing hid the row entirely so an absent location was silent. A `withheld`
   * location and a `not_recorded` one are not the same fact, and neither is a blank line.
   */
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
