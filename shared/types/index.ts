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
  status: string;
  condition_category: VehicleConditionCategory;
  marketplace_tags: MarketplaceTag[];
  trust_score: number;
  primary_image_url?: string | null;
  plate_number?: string | null;
  normalized_plate_number?: string | null;
  chassis_number?: string | null;
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
  created_at?: string | null;
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
