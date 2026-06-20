import type { 
  AuthUser as SharedAuthUser, 
  Vehicle as SharedVehicle,
  Escrow as SharedEscrow,
  Notification as SharedNotification,
  MarketplaceListingSummary as SharedMarketplaceListingSummary,
  MarketplaceListingsResponse as SharedMarketplaceListingsResponse
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
  vehicle_condition_category?: SharedMarketplaceListingSummary['condition_category'];
  marketplace_tags?: SharedMarketplaceListingSummary['marketplace_tags'];
  primary_image_url?: string | null;
  passport_verified?: boolean;
  evidence_count?: number;
  partsentry_checked?: boolean;
  repair_history_count?: number;
  verified_parts_count?: number;
  zimra_verified?: boolean;
  cid_clear?: boolean;
}

export interface MarketplaceListingSummary extends SharedMarketplaceListingSummary {}

export interface MarketplaceListingsResponse extends SharedMarketplaceListingsResponse {}

export interface NavCoverageEntry { count: number; active: boolean }
export interface NavCoverageResponse {
  threshold: number
  categories: Record<string, NavCoverageEntry>
  tags: Record<string, NavCoverageEntry>
  governed_deferred: string[]
}

export type DiasporaOrderType = 'vehicle' | 'parts' | 'mixed';

export interface DiasporaImportOrder {
  id: string;
  tenant_id?: string | null;
  buyer_id?: string | null;
  order_type: DiasporaOrderType;
  origin_country: string;
  origin_city?: string | null;
  destination_country: string;
  destination_city?: string | null;
  requested_make?: string | null;
  requested_model?: string | null;
  requested_year_min?: number | null;
  requested_year_max?: number | null;
  budget_amount?: number | string | null;
  budget_currency?: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, unknown>;
  diaspora_trade_documents?: DiasporaTradeDocument[];
}

export interface DiasporaImportOrderPayload {
  order_type: DiasporaOrderType;
  origin_country: string;
  origin_city?: string;
  destination_country: string;
  destination_city?: string;
  requested_make?: string;
  requested_model?: string;
  requested_year_min?: number;
  requested_year_max?: number;
  budget_amount?: number;
  budget_currency?: string;
  metadata?: Record<string, unknown>;
}

export interface DiasporaTradeDocument {
  id: string;
  import_order_id?: string;
  document_type: string;
  verification_status?: string;
  uploaded_by?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  file_name?: string | null;
  created_at?: string;
  storage_path?: string | null;
  ocr_document_id?: string | null;
  metadata?: Record<string, unknown>;
  extractions?: DiasporaTradeDocumentExtraction[];
  verifications?: DiasporaTradeDocumentVerification[];
}

export interface DiasporaTradeDocumentExtraction {
  id: string;
  trade_document_id: string;
  extraction_provider?: string;
  extracted_fields?: Record<string, unknown>;
  confidence_score?: number;
  verification_status?: string;
  created_at?: string;
}

export interface DiasporaTradeDocumentVerification {
  id: string;
  trade_document_id: string;
  verification_status: string;
  verified_by?: string;
  verified_at?: string;
  notes?: string;
}

export interface DiasporaTradeDocumentPayload {
  document_type: string;
  file_name?: string;
  storage_path?: string;
  metadata?: Record<string, unknown>;
}

export interface DiasporaComplianceReview {
  id: string;
  import_order_id?: string;
  status: string;
  review_type?: string;
  created_at?: string;
}

export interface DiasporaContainerShipment {
  id: string;
  origin_country?: string | null;
  origin_city?: string | null;
  destination_country?: string | null;
  destination_city?: string | null;
  departure_date?: string | null;
  booking_deadline?: string | null;
  estimated_arrival_date?: string | null;
  container_type?: string | null;
  total_capacity_volume?: number | null;
  used_capacity_volume?: number | null;
  available_capacity_volume?: number | null;
  status: string;
}

export interface DiasporaCargoReservation {
  id: string;
  container_id?: string | null;
  import_order_id?: string | null;
  buyer_id?: string | null;
  cargo_type?: string | null;
  estimated_volume?: number | null;
  reservation_status: string;
  created_at?: string;
}

export interface DiasporaCargoReservationPayload {
  container_id: string;
  import_order_id: string;
  cargo_type: 'vehicle' | 'parts' | 'mixed' | 'other';
  estimated_volume: number;
}

export interface DiasporaShipment {
  id: string;
  import_order_id?: string | null;
  container_id?: string | null;
  carrier_name?: string | null;
  tracking_number?: string | null;
  origin_port?: string | null;
  destination_port?: string | null;
  departure_date?: string | null;
  estimated_arrival_date?: string | null;
  actual_arrival_date?: string | null;
  status: string;
  created_at?: string;
}

export type DiasporaWorkbookOperatorAction = string;

export interface DiasporaWorkbookOperatorDashboardFilters {
  status?: string;
  templateType?: string;
  uploadedBy?: string;
  tenantId?: string;
  needsReview?: boolean | string;
  hasFailures?: boolean | string;
  hasRetryableRows?: boolean | string;
  held?: boolean | string;
  limit?: number;
  offset?: number;
}

export interface DiasporaWorkbookOperatorDashboardItem {
  batchId: string;
  templateType?: string;
  importStatus?: string;
  uploadedBy?: string | null;
  tenantId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  totalRows?: number;
  acceptedRows?: number;
  warningRows?: number;
  rejectedRows?: number;
  errorCount?: number;
  warningCount?: number;
  draftImportExecuted?: boolean;
  liveImportExecuted?: boolean;
  aiExecuted?: boolean;
  needsReview?: boolean;
  hasFailures?: boolean;
  hasRetryableRows?: boolean;
  hasBlockedRows?: boolean;
  held?: boolean;
  holdReason?: string | null;
  nextRecommendedAction?: string;
  riskLevel?: string;
  summaryBadges?: string[];
}

export interface DiasporaWorkbookOperatorDashboard {
  items: DiasporaWorkbookOperatorDashboardItem[];
  pagination?: {
    limit?: number;
    offset?: number;
    count?: number;
  };
  totals?: Record<string, number>;
}

export interface DiasporaWorkbookOperatorNote {
  id?: string;
  note: string;
  createdAt?: string;
  createdBy?: string | null;
  role?: string;
  visibility?: string;
  phase?: string;
}

export interface DiasporaWorkbookOperatorHold {
  active?: boolean;
  reason?: string | null;
  placedAt?: string;
  placedBy?: string | null;
  clearedAt?: string;
  clearedBy?: string | null;
  role?: string;
  phase?: string;
}

export interface DiasporaWorkbookRetryPlan {
  canRetry?: boolean;
  reason?: string;
  totals?: Record<string, number>;
  retryableRows?: unknown[];
  blockedRows?: unknown[];
  warnings?: string[];
  [key: string]: unknown;
}

export interface DiasporaWorkbookExecutionAudit {
  batchId?: string;
  templateType?: string;
  importStatus?: string;
  executionPhase?: string | null;
  draftImportExecuted?: boolean;
  liveImportExecuted?: boolean;
  aiExecuted?: boolean;
  totals?: Record<string, number>;
  consistency?: {
    valid?: boolean;
    errors?: unknown[];
    warnings?: unknown[];
  };
  retryPlan?: DiasporaWorkbookRetryPlan | null;
  createdTargetRecords?: unknown[];
  failedRows?: unknown[];
  skippedRows?: unknown[];
  blockedRows?: unknown[];
  warnings?: string[];
  [key: string]: unknown;
}

export interface DiasporaWorkbookOperatorNextActions {
  allowed: DiasporaWorkbookOperatorAction[];
  forbidden: DiasporaWorkbookOperatorAction[];
  warnings?: string[];
  nextRecommendedAction?: string;
}

export interface DiasporaWorkbookOperatorBatchSummary {
  batch?: {
    id?: string;
    importStatus?: string;
    templateType?: string;
    totalRows?: number;
    acceptedRows?: number;
    rejectedRows?: number;
    warningCount?: number;
    errorCount?: number;
    createdAt?: string;
    updatedAt?: string;
    metadata?: Record<string, unknown>;
  };
  plan?: Record<string, unknown>;
  audit?: DiasporaWorkbookExecutionAudit | null;
  retryPlan?: DiasporaWorkbookRetryPlan | null;
  operator?: {
    held?: boolean;
    holdReason?: string | null;
    notes?: DiasporaWorkbookOperatorNote[];
    nextActions?: DiasporaWorkbookOperatorAction[];
    forbiddenActions?: DiasporaWorkbookOperatorAction[];
    warnings?: string[];
    statusTimeline?: unknown[];
  };
}

export interface DiasporaWorkbookSheetDefinition {
  sheetName: string;
  description?: string;
  primaryKey?: string | null;
  apiTable?: string | null;
  requiredColumns?: string[];
  optionalColumns?: string[];
  statusColumns?: Record<string, string>;
}

export interface DiasporaWorkbookTemplateDefinition {
  templateType: string;
  sheets: string[];
}

export interface DiasporaWorkbookTemplateSchema {
  version?: string;
  templateType: string;
  sourceOfTruth?: string;
  safetyRules?: string[];
  statusLists?: Record<string, string[]>;
  sheets: DiasporaWorkbookSheetDefinition[];
  [key: string]: unknown;
}

export interface DiasporaWorkbookTemplateSchemaResponse {
  data: DiasporaWorkbookTemplateSchema;
  supportedTemplates?: DiasporaWorkbookTemplateDefinition[];
}

export interface DiasporaWorkbookTemplateDownloadStatus {
  data?: DiasporaWorkbookTemplateSchema;
  downloadReady: boolean;
  message?: string;
}

export interface DiasporaWorkbookDryRunPayload {
  templateType: string;
  idempotencyKey: string;
  source: {
    filename: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
  };
  sheets: Record<string, Array<Record<string, unknown>>>;
}

export interface DiasporaWorkbookDryRunFinding {
  sheetName?: string;
  rowIndex?: number;
  column?: string;
  code?: string;
  message?: string;
  allowed?: unknown[];
  [key: string]: unknown;
}

export interface DiasporaWorkbookDryRunSheetSummary {
  sheetName: string;
  apiTable?: string | null;
  primaryKey?: string | null;
  totalRows?: number;
  acceptedRows?: number;
  rejectedRows?: number;
  warningRows?: number;
  [key: string]: unknown;
}

export interface DiasporaWorkbookDryRunPersistence {
  batchId?: string;
  rowDiagnosticsPersisted?: number;
  acceptedRows?: number;
  warningRows?: number;
  rejectedRows?: number;
  importStatus?: string;
  persisted?: boolean;
  [key: string]: unknown;
}

export interface DiasporaWorkbookDryRunResult {
  dryRunId?: string;
  dryRunOnly?: boolean;
  wroteToDatabase?: boolean;
  canImport?: boolean;
  templateType?: string;
  userId?: string | null;
  tenantId?: string | null;
  totals?: {
    totalRows?: number;
    acceptedRows?: number;
    errorCount?: number;
    warningCount?: number;
    sheetCount?: number;
    [key: string]: unknown;
  };
  summaries?: DiasporaWorkbookDryRunSheetSummary[];
  errors?: DiasporaWorkbookDryRunFinding[];
  warnings?: DiasporaWorkbookDryRunFinding[];
  persistence?: DiasporaWorkbookDryRunPersistence;
  [key: string]: unknown;
}

// ── Phase 3: Stock & Supply Documents ───────────────────────────────────────
export interface DiasporaStockBalances {
  onHand: number;
  reserved: number;
  available: number;
}

export interface DiasporaStockItem {
  id: string;
  tenant_id?: string | null;
  seller_trade_profile_id?: string | null;
  supply_document_id?: string | null;
  sku?: string | null;
  part_name: string;
  part_number?: string | null;
  oem_number?: string | null;
  aftermarket_number?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_year_min?: number | null;
  vehicle_year_max?: number | null;
  condition?: string;
  origin_country?: string | null;
  origin_city?: string | null;
  warehouse_location?: string | null;
  quantity_on_hand?: number;
  quantity_reserved?: number;
  unit_cost?: number | string | null;
  unit_price?: number | string | null;
  currency?: string;
  export_readiness_status?: string;
  verification_status?: string;
  publication_status?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  balances?: DiasporaStockBalances;
  [key: string]: unknown;
}

export interface DiasporaStockItemPayload {
  part_name: string;
  sku?: string;
  part_number?: string;
  oem_number?: string;
  aftermarket_number?: string;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_year_min?: number;
  vehicle_year_max?: number;
  condition?: string;
  origin_country?: string;
  origin_city?: string;
  warehouse_location?: string;
  unit_cost?: number;
  unit_price?: number;
  currency?: string;
  export_readiness_status?: string;
  initial_quantity?: number;
  supply_document_id?: string;
  metadata?: Record<string, unknown>;
}

export interface DiasporaStockLedgerEntry {
  id: string;
  stock_item_id: string;
  action_type: string;
  quantity_delta?: number;
  quantity_before?: number;
  quantity_after?: number;
  currency?: string;
  notes?: string | null;
  approval_status?: string;
  execution_status?: string;
  idempotency_key?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
  created_by?: string | null;
  [key: string]: unknown;
}

export interface DiasporaStockMovementPayload {
  action: string;
  quantity: number;
  reason?: string;
  idempotencyKey?: string;
  importOrderId?: string;
  reservationRef?: string;
  approval?: { approvedBy?: string; note?: string };
  source?: string;
}

export interface DiasporaStockMovementResult {
  ledgerEntry: DiasporaStockLedgerEntry;
  stockItem: DiasporaStockItem;
  idempotentReplay?: boolean;
}

export interface DiasporaSupplyDocument {
  id: string;
  tenant_id?: string | null;
  seller_trade_profile_id?: string | null;
  document_number: string;
  title: string;
  status: string;
  origin_country?: string | null;
  origin_city?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  verification_status?: string;
  publication_status?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface DiasporaSupplyDocumentPayload {
  document_number: string;
  title: string;
  origin_country?: string;
  origin_city?: string;
  valid_from?: string;
  valid_until?: string;
  seller_trade_profile_id?: string;
  metadata?: Record<string, unknown>;
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
  metadata: Record<string, any> & { ai_analysis?: EvidenceAiAnalysis; ai_public_summary?: string };
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

export interface EvidenceAiAnalysis {
  risk_score: number;
  confidence: number;
  ai_status: 'ai_pending' | 'ai_passed' | 'ai_flagged' | 'ai_low_confidence' | 'ai_provider_unavailable' | 'ai_manual_review_required';
  reviewer_summary: string;
  recommended_action: 'approve' | 'reject' | 'inspect';
  visible_plate?: string | null;
  visible_vin?: string | null;
  visible_odometer?: number | null;
  damage_indicators?: Array<{ type: string; severity: string; location?: string }> | null;
  manipulation_indicators?: Array<{ type: string; severity: string; notes?: string }> | null;
  detected_objects?: string[];
  duplicate_match?: {
    is_duplicate: boolean;
    original_evidence_id: string;
    original_vin: string;
    original_status: string;
  } | null;
  public_safe_summary?: string | null;
}

export type TrustFactReviewStatus = 'pending' | 'approved' | 'rejected' | 'revoked' | 'superseded';

export type TrustFactName = 'vehicle_condition_category' | 'passport_verified' | 'inspection_ready';

export interface TrustFactRequest {
  id: string;
  vin: string;
  trust_fact: TrustFactName;
  requested_value: Record<string, unknown>;
  current_value?: Record<string, unknown> | null;
  status: TrustFactReviewStatus;
  requested_by_role: string;
  requested_by_tenant_id?: string | null;
  reviewed_by_role?: string | null;
  reviewed_by_tenant_id?: string | null;
  evidence_ids: string[];
  partsentry_log_ids?: string[];
  reason?: string | null;
  decision_notes?: string | null;
  created_at: string;
  reviewed_at?: string | null;
  revoked_at?: string | null;
  updated_at?: string | null;
}

export interface TrustFactReviewQueueResponse {
  requests: TrustFactRequest[];
  total: number;
}

export interface TrustFactDecisionPayload {
  decision_notes: string;
  reason?: string;
}

export interface TrustFactDecisionResponse {
  success: boolean;
  request: TrustFactRequest;
  evidence?: VehicleEvidenceSummary[];
}

export interface TrustAuditTrailEvent {
  id: string;
  event_type: string;
  vin: string;
  trust_fact?: TrustFactName | string | null;
  previous_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
  actor_role?: string | null;
  actor_type?: string | null;
  source_route?: string | null;
  evidence_ids: string[];
  reason?: string | null;
  decision_notes?: string | null;
  request_id?: string | null;
  created_at: string;
}

export interface TrustAuditTrailResponse {
  vin: string;
  events: TrustAuditTrailEvent[];
  total: number;
}

export interface VehicleEvidenceSummary {
  id: string;
  vin?: string;
  evidence_type: EvidenceType | string;
  verification_status: EvidenceVerificationStatus | string;
  visibility_level?: string | null;
  uploaded_at?: string | null;
  captured_at?: string | null;
  linked_registry_event_id?: string | null;
  checksum?: string | null;
  image_hash?: string | null;
  file_url?: string | null;
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
