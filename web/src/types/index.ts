import type { 
  AuthUser as SharedAuthUser, 
  Vehicle as SharedVehicle,
  Escrow as SharedEscrow,
  Notification as SharedNotification
} from '@shared/types';
// 1. User
export interface User extends SharedAuthUser {
  status?: 'active' | 'suspended';
  created_at?: string;
  joined?: string;
}

export interface Vehicle extends Omit<SharedVehicle, 'status'> {
  id?: string;
  location?: string;
  image_url?: string;
  images?: string[];
  condition?: string;
  category?: string;
  viewCount?: number;
  trustScore?: number;
  isVerified?: boolean;
  insurance_records?: InsuranceRecord[];
  service_history?: ServiceRecord[];
  service_records?: ServiceRecord[];
  escrows?: Escrow[];
  documents?: { id: string; title: string; date: string; status: string }[];
  parts?: Part[];
  status?: 'Available' | 'Reserved' | 'Sold' | 'Archived' | 'pending' | 'approved' | 'banned' | string;
  tenant?: {
    name: string;
    phone: string;
    logo_url: string | null;
  } | null;
  features?: string[];
  sellerName?: string;
  sellerPhone?: string;
  sellerAvatar?: string | null;
  sellerType?: 'Dealership' | 'Private Owner' | string;
  province?: string;
  listingDate?: string;
  engineNumber?: string;
  fuelType?: string;
  description?: string;
  tenant_id?: string;
  sellerId?: string;
  isFeatured?: boolean;
  plate_number?: string;
  normalized_plate_number?: string;
  plate_status?: string;
  chassis_number?: string;
  engine_number?: string;
  registration_status?: string;
  registration_country?: string;
  registration_authority?: string;
  temporary_identification_number?: string;
  plate_verified_at?: string;
  plate_verification_source?: string;
  current_seller_id?: string;
  current_seller_type?: string;
  public_seller_display_enabled?: boolean;
}

// 3. WorkOrder
export interface WorkOrder {
  id: string;
  vehicle: string; // VIN
  vin?: string;
  customer: string;
  customer_name?: string;
  service: string;
  issue_description?: string;
  status: 'pending' | 'in-progress' | 'completed';
  date: string;
  created_at: string;
  cost: number;
  total_cost?: number;
  mechanic: string;
  mechanic_id?: string;
  tenant_id?: string;
  mileage?: number;
  parts?: any;
  notes?: string;
}

// 4. Part
export interface Part {
  id: string;
  name: string;
  sku: string;
  stock: number;
  type?: 'OEM' | 'Aftermarket' | 'Used' | string;
  stock_level?: number;
  minStock?: number;
  min_stock?: number;
  supplier?: string;
  price: number;
  unit_price?: number;
  installedDate?: string;
  installedBy?: string;
  warranty?: string;
  cost?: number;
  blockchainHash?: string;
  manufacturer?: string;
}

// 5. Claim
export interface Claim {
  id: string;
  policyholder: string;
  amount: number;
  vehicle: string;
  type: string;
  policy: string;
  date: string;
  assigned: string;
  status: 'pending' | 'under-review' | 'approved' | 'rejected';
}

// 6. RegistryVerification
export interface RegistryVerification {
  id: string;
  vin: string;
  make: string;
  model: string;
  registration: string;
  owner: string;
  type: string;
  status: 'pending' | 'verified' | 'rejected' | 'approved';
  date: string;
  created_at: string;
  vehicles?: {
    make: string;
    model: string;
    year: number;
  };
}

// 7. InsurancePolicy
export interface InsurancePolicy {
  policyNumber: string;
  policy_number?: string;
  provider: string;
  status: 'active' | 'expired' | 'pending';
  cost: number;
  coverage_details?: string;
  startDate: string;
  endDate: string;
  created_at?: string;
}

// 8. AuditLog
export interface AuditLog {
  event: string;
  mileage: string;
  hash: string;
  time: string;
}

// Additional domain interfaces for context stability
export interface AuthCredentials {
  email: string;
  token: string;
}

export interface DealerInventoryItem extends Vehicle {
  viewCount: number;
  trustScore: number;
  isVerified: boolean;
  images: string[];
}

// 9. FraudAlert
export interface FraudAlert {
  id: string;
  type: string;
  severity: 'high' | 'medium' | 'low';
  status: 'open' | 'under-investigation' | 'resolved';
  description: string;
  vehicle: string;
  policyholder: string;
  date?: string;
}

// 10. ComplianceReport
export interface ComplianceReport {
  id: string;
  title: string;
  status: 'generated' | 'pending';
  type: string;
  date: string;
  size?: string;
}

// 11. Lead
export interface Lead {
  id: string | number;
  name: string;
  email: string;
  phone: string;
  vehicle: string;
  status: 'new' | 'contacted' | 'negotiating' | 'closed';
  source: string;
  date: string;
  notes: string;
  buyer_name?: string;
  buyer_phone?: string;
  vin?: string;
  created_at?: string;
  message?: string;
}

// 12. Promotion
export interface Promotion {
  id: string | number;
  title: string;
  type: string;
  value: string;
  status: 'active' | 'scheduled' | 'expired';
  views: number;
  clicks: number;
  startDate: string;
  endDate: string;
  discount_amount?: number;
  start_date?: string;
  end_date?: string;
}

// 13. InsuranceRecord
export interface InsuranceRecord {
  id: string;
  provider: string;
  policyNumber?: string;
  policy_number?: string;
  type: string;
  startDate?: string;
  start_date?: string;
  expiryDate?: string;
  expiry_date?: string;
  premium: number;
  currency?: string;
  status: 'active' | 'expired' | 'pending' | string;
  coverage: string[];
}

// 14. ServiceRecord
export interface ServiceRecord extends WorkOrder {
  parts?: Part[];
}

// 15. Escrow
export interface Escrow extends SharedEscrow {}

// 16. Notification
export interface Notification extends SharedNotification {
  timestamp?: string;
}

// ── Passport domain types ──────────────────────────────────────────────────

// 22. TimelineEvent — one item from getVehicleTimeline()
export type TimelineEventSource =
  | 'ownership_transfer'
  | 'service'
  | 'insurance'
  | 'escrow'
  | 'zimra'
  | 'cvr'
  | 'vid'
  | 'cid'
  | 'zinara'
  | 'plate_assigned'
  | 'plate_verified'
  | 'plate_changed'
  | 'temporary_id_issued'
  | 'plate_flagged'
  | 'plate_suspended'
  | 'evidence';

export interface TimelineEventDetails {
  previous?: string;
  new?: string;
  mechanic?: string;
  mileage?: number;
  notes?: string;
  cost?: number;
  insurer?: string;
  premium?: number;
  risk?: number;
  buyer?: string;
  amount?: number;
  stage?: number;
  importer?: string;
  dutyPaid?: number;
  date?: string;
  logbookSerial?: string;
  ownerId?: string;
  status?: string;
  brakingEfficiency?: number;
  suspensionPassed?: boolean;
  steeringPassed?: boolean;
  odometer?: number;
  reference?: string;
  officer?: string;
  termEnd?: string;
  receipt?: string;
  uploadedBy?: string;
  uploaderRole?: string;
  capturedAt?: string;
  uploadedAt?: string;
  checksum?: string;
  linkedRegistryEventId?: string;
}

export interface TimelineEvent {
  id: string | number;
  event_source: TimelineEventSource | string;
  label: string;
  desc?: string;
  timestamp: string;
  details?: TimelineEventDetails;
  event_type?: string;
  evidence_type?: EvidenceType;
  file_url?: string;
  verification_status?: EvidenceVerificationStatus;
  trust_score_impact?: number;
  linked_registry_event_id?: string | null;
  metadata?: Record<string, unknown>;
}

export type EvidenceType =
  | 'import_photo'
  | 'auction_photo'
  | 'customs_photo'
  | 'inspection_photo'
  | 'odometer_photo'
  | 'damage_photo'
  | 'repair_photo'
  | 'dealer_listing_photo'
  | 'owner_handover_photo'
  | 'registration_document'
  | 'insurance_document'
  | 'police_clearance_document'
  | 'ownership_transfer_document';

export type EvidenceVerificationStatus = 'pending' | 'verified' | 'rejected' | 'disputed' | 'superseded';

export interface VehicleEvidence {
  id: string;
  vehicle_id: string;
  vin: string;
  event_type: string;
  evidence_type: EvidenceType;
  file_url: string;
  uploaded_by: string;
  uploader_role: string;
  captured_at: string;
  uploaded_at: string;
  verification_status: EvidenceVerificationStatus;
  verification_notes?: string | null;
  linked_registry_event_id?: string | null;
  timeline_event_id?: string | null;
  trust_score_impact: number;
  trust_impact?: number;
  metadata: Record<string, unknown>;
  image_hash?: string | null;
  checksum?: string | null;
  storage_bucket?: string;
  file_path?: string;
  mime_type?: string;
  file_size?: number;
  visibility_level?: string;
  vehicles?: {
    make?: string;
    model?: string;
    year?: number;
    trust_score?: number;
  };
}

// 23. TrustMetrics — exact keys from calculateVehicleTrustScore()
export interface TrustMetrics {
  cvr_synced: boolean;
  zimra_duty: boolean;
  zrp_police_cleared: boolean;
  blockchain_audit_valid: boolean;
  odometer_consistent: boolean;
  maintenance_logs_count: number;
  stolen_alert_active: boolean;
  evidence_trust_impact?: number;
  verified_evidence_count?: number;
  rejected_evidence_count?: number;
}

// 24. TrustReport — from calculateVehicleTrustScore()
export interface TrustReport {
  vin: string;
  trustScore: number;
  metrics: TrustMetrics;
}

// 25. ChainVerification — from verifyChain()
export interface ChainVerification {
  verified: boolean;
  integrity?: string;
  blocksChecked?: number;
  errors?: string[];
}

// 26. PassportVerificationSource — UI model for the Verification tab
export interface PassportVerificationSource {
  label: string;
  status: 'verified' | 'not_verified' | 'warning' | 'unknown';
  detail?: string;
}

// 27. ListingImage — from listing_images table
export interface ListingImage {
  id: string;
  vin: string;
  image_url: string;
  is_primary: boolean;
  display_order: number;
}

export interface VehicleIdentity {
  vin: string;
  chassisNumber?: string;
  plateNumber?: string;
  normalizedPlateNumber?: string;
  plateStatus?: string;
  temporaryIdentificationNumber?: string;
  engineNumber?: string;
  registrationStatus?: string;
  registrationCountry?: string;
  registrationAuthority?: string;
  plateVerifiedAt?: string;
  plateVerificationSource?: string;
}

export interface VehiclePlateHistory {
  id: string;
  vehicle_id?: string;
  vin: string;
  plate_number: string;
  normalized_plate_number: string;
  plate_type: 'permanent' | 'temporary' | 'dealer' | 'diplomatic' | 'government' | 'unknown' | string;
  status: 'active' | 'previous' | 'pending' | 'flagged' | 'suspended' | 'expired' | string;
  is_current?: boolean;
  issued_at?: string;
  expired_at?: string;
  verified_at?: string;
  verification_source?: string;
  source_reference?: string;
  reason?: string;
  record_visibility?: string;
  created_by?: string;
  verified_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface OwnershipSummary {
  currentSellerDisplayName?: string;
  currentSellerType?: string;
  previousOwnerCount: number;
  previousOwnersPublicLabel: string;
  ownerNamesRedacted: boolean;
  currentOwnerVisible: boolean;
}

// 17. VehiclePassport (fully typed, no any)
export interface VehiclePassport {
  vehicle: Vehicle;
  timeline: TimelineEvent[];
  evidenceTimeline?: TimelineEvent[];
  evidenceVault?: VehicleEvidence[];
  trustReport: TrustReport;
  chainVerification: ChainVerification;
  identity: VehicleIdentity;
  plateHistory: VehiclePlateHistory[];
  ownershipSummary: OwnershipSummary;
}

// 18. FinanceApplication
export interface FinanceApplication {
  id: string | number;
  user_name: string;
  year: number;
  make: string;
  model: string;
  requested_amount: number;
  monthly_payment: number;
  apr: number;
  trust_score: number;
  status: string;
  vin?: string;
  vehicle_id?: string;
  created_at?: string;
}

// 19. TelemetryData
export interface TelemetryData {
  vin: string;
  vehicle?: string;
  make?: string;
  model?: string;
  location?: string;
  status: string;
  speed?: string;
  lat: number;
  lng: number;
  active?: boolean;
}

// 20. ServerHealthModel
export interface ServerHealthModel {
  name: string;
  status: string;
  accuracy: number;
}

// 21. ApiMutationResponse
export interface ApiMutationResponse {
  success?: boolean;
  message?: string;
  id?: string;
  url?: string;
  path?: string;
  [key: string]: unknown;
}
