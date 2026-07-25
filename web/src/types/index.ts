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

// Marketplace v1 canonical contracts (trust/verification/pricing/inquiry/referral).
export type {
  MarketplaceListingType,
  MarketplacePublicStatus,
  MarketplaceRiskStatus,
  MarketplacePartSentryPublicStatus,
  MarketplaceEvidenceStatus,
  MarketplaceIdentityStatus,
  MarketplaceTrustSummary,
  MarketplaceVerificationSummary,
  MarketplacePricingSummary,
  MarketplaceMedia,
  MarketplaceSellerSummary,
  MarketplaceListingDetail,
  MarketplaceTransactionIntent,
  MarketplaceInquiryType,
  MarketplaceInquiryStatus,
  MarketplaceSourceChannel,
  MarketplaceInquiryInput,
  MarketplaceInquiry,
  MarketplaceReferralEventType,
  MarketplaceReferralEvent,
} from '@shared/types';

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

// ── Phase 4: Buyer Orders & Reverse RFQ ─────────────────────────────────────
export interface DiasporaRfqMeta {
  published?: boolean;
  publishedAt?: string;
  acceptedQuoteId?: string;
  acceptedAt?: string;
}

export interface DiasporaQuote {
  id: string;
  import_order_id: string;
  seller_id?: string | null;
  quote_amount: number | string;
  quote_currency?: string;
  valid_until?: string | null;
  inclusions?: unknown[];
  exclusions?: unknown[];
  status: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  [key: string]: unknown;
}

export interface DiasporaBuyerOrder {
  id: string;
  tenant_id?: string | null;
  buyer_id?: string | null;
  order_type: string;
  origin_country: string;
  origin_city?: string | null;
  destination_country?: string;
  destination_city?: string | null;
  requested_make?: string | null;
  requested_model?: string | null;
  requested_year_min?: number | null;
  requested_year_max?: number | null;
  budget_amount?: number | string | null;
  budget_currency?: string;
  status: string;
  metadata?: { urgency?: string; requested_part_number?: string | null; rfq?: DiasporaRfqMeta; [key: string]: unknown };
  quotes?: DiasporaQuote[];
  created_at?: string;
  [key: string]: unknown;
}

export interface DiasporaBuyerOrderPayload {
  order_type: string;
  origin_country: string;
  origin_city?: string;
  destination_country?: string;
  destination_city?: string;
  requested_make?: string;
  requested_model?: string;
  requested_year_min?: number;
  requested_year_max?: number;
  requested_part_number?: string;
  budget_amount?: number;
  budget_currency?: string;
  urgency?: string;
  metadata?: Record<string, unknown>;
}

export interface DiasporaMatchCandidate {
  stockItemId: string;
  partName: string;
  sku?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  available: number;
  unitPrice?: number | string | null;
  currency?: string;
  sellerTradeProfileId?: string | null;
  score: number;
  reasons: string[];
}

export interface DiasporaQuotePayload {
  quote_amount: number;
  quote_currency?: string;
  valid_until?: string;
  inclusions?: unknown[];
  exclusions?: unknown[];
  submit?: boolean;
  idempotencyKey?: string;
  stockItemId?: string;
  leadTimeDays?: number;
  shippingTerms?: string;
  metadata?: Record<string, unknown>;
}

export interface DiasporaAcceptQuoteResult {
  order: DiasporaBuyerOrder;
  acceptedQuote: DiasporaQuote;
  idempotentReplay?: boolean;
}

// ── Phase 5: AI Command Hardening ───────────────────────────────────────────
export interface DiasporaAiParseResult {
  intent: string | null;
  action?: string | null;
  risk?: string | null;
  riskTier?: string | null;
  confidence: number;
  entities: Record<string, unknown>;
  missing?: string[];
  ambiguous: boolean;
  reasons: string[];
  candidates?: string[];
  normalized?: string;
}

export interface DiasporaAiCommand {
  id: string;
  raw_command: string;
  intent: string;
  risk_level: string;
  confidence_score: number;
  target_entity_id?: string | null;
  extracted_entities?: Record<string, unknown>;
  proposed_action?: Record<string, unknown>;
  approval_status: string;
  execution_status: string;
  error_message?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
  executed_at?: string | null;
  [key: string]: unknown;
}

export interface DiasporaAiCommandCreateResult {
  command: DiasporaAiCommand;
  parse: DiasporaAiParseResult;
  duplicate?: boolean;
}

export interface DiasporaAiExecuteResult {
  command: DiasporaAiCommand;
  result?: Record<string, unknown> | null;
  idempotentReplay?: boolean;
}

// ── Phase 6: Container Co-Loading ───────────────────────────────────────────
export interface DiasporaContainerCapacity {
  totalVolume: number;
  usedVolume: number;
  availableVolume: number;
  fillPercent: number;
  readyToClose: boolean;
  full: boolean;
  overfilled: boolean;
}

export interface DiasporaMarketplaceContainer {
  id: string;
  tenant_id?: string | null;
  origin_country?: string;
  origin_city?: string;
  destination_country?: string;
  destination_city?: string;
  departure_date?: string;
  booking_deadline?: string;
  container_type?: string;
  total_capacity_volume?: number;
  used_capacity_volume?: number;
  available_capacity_volume?: number;
  status: string;
  coordinator_id?: string | null;
  metadata?: { capacity?: Partial<DiasporaContainerCapacity>; [key: string]: unknown };
  [key: string]: unknown;
}

export interface DiasporaContainerCapacityResult {
  container: DiasporaMarketplaceContainer;
  capacity: DiasporaContainerCapacity;
}

export interface DiasporaMarketplaceReservation {
  id: string;
  container_id: string;
  import_order_id?: string | null;
  buyer_id?: string | null;
  cargo_type?: string;
  estimated_volume: number;
  estimated_weight?: number | null;
  currency?: string;
  reservation_status: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface DiasporaMarketplaceContainerPayload {
  origin_country: string;
  origin_city: string;
  destination_country: string;
  destination_city: string;
  departure_date: string;
  booking_deadline: string;
  container_type?: string;
  total_capacity_volume: number;
  total_capacity_weight?: number;
  metadata?: Record<string, unknown>;
}

export interface DiasporaReservationRequestPayload {
  estimated_volume: number;
  estimated_weight?: number;
  import_order_id?: string;
  cargo_type?: string;
  currency?: string;
  cargo_description?: string;
  source?: string;
}

export interface DiasporaReservationActionResult {
  reservation: DiasporaMarketplaceReservation;
  capacity: DiasporaContainerCapacity;
}

// ── Phase 7: Google Drive Integration ───────────────────────────────────────
export interface DiasporaDriveConnection {
  id?: string;
  provider?: string;
  providerAccountEmail?: string | null;
  rootFolderId?: string | null;
  rootFolderUrl?: string | null;
  scopes?: string[];
  accessStatus?: string;
  lastSyncAt?: string | null;
  revokedAt?: string | null;
  connected?: boolean;
}

export interface DiasporaDriveStatus {
  enabled: boolean;
  provider: string;
  scopes: string[];
  connection: DiasporaDriveConnection | null;
  onedrive: { available: boolean; note?: string };
  workbookExport: { xlsx: boolean; note?: string };
}

export interface DiasporaDriveAuthUrl {
  url: string;
  scopes: string[];
  state: string;
}

export interface DiasporaDriveFile {
  id: string;
  provider?: string;
  driveFileId?: string;
  driveFileUrl?: string;
  fileName?: string;
  mimeType?: string;
  checksumSha256?: string | null;
  linkedEntityType?: string;
  linkedEntityId?: string;
  syncStatus?: string;
  lastSyncAt?: string | null;
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

// ── Phase 4 — Vehicle Publication Completeness ───────────────────────────────

export type EvidenceRequirementStatus =
  | 'present'
  | 'pending'
  | 'verified'
  | 'missing'
  | 'rejected'
  | 'expired'
  | 'not_applicable';

export interface EvidenceRequirement {
  key: string;
  label: string;
  status: EvidenceRequirementStatus;
  is_blocking: boolean;
}

export interface VehicleCompleteness {
  vin: string;
  requirements: EvidenceRequirement[];
  completeness_percent: number;
  is_publishable: boolean;
  blocking_gaps: string[];
  pending_gaps: string[];
  publication_status: string;
}

// ── WS2 — Source Verification Network (buyer-safe coverage) ──────────────────

export type SourceProvider = 'zimra' | 'cvr' | 'zinara' | 'vid' | 'cid';
export type SourceVerificationMode =
  | 'live' | 'partner_file' | 'manual_verification' | 'sandbox' | 'unavailable';
export type SourceCoverageStatus =
  | 'source_connected' | 'sandbox_demonstration' | 'partner_file_reviewed'
  | 'carup_manual_reviewed' | 'conflict_under_review' | 'risk_flagged'
  | 'no_record_found' | 'source_unavailable' | 'pending';

export interface SourceCoverageEntry {
  vin: string;
  provider: SourceProvider;
  mode: SourceVerificationMode;
  coverage_status: SourceCoverageStatus;
  retrieved_at: string | null;
  created_at?: string;
}

// ── WS10 — Unified Trust Decision (buyer-safe projection) ────────────────────

export interface TrustDimension {
  status: string;
  value: string | number | null;
  reason_codes?: string[];
}
export interface TrustDecision {
  vin: string;
  calculation_version: string;
  last_updated: string | null;
  overall_trust: { status: string; value: string | number | null };
  dimensions: Record<string, TrustDimension>;
  known_limitations: string[];
}

// ── Phase 3 — Vehicle Document Extractions (OCR field-level contract) ────────

export type ExtractionMatchStatus = 'match' | 'mismatch' | 'missing_reference' | 'inconclusive';
export type ExtractionReviewStatus = 'pending' | 'confirmed' | 'rejected' | 'amended' | 'waived';

export interface VehicleDocumentExtraction {
  id: string;
  evidence_id: string;
  vin: string;
  document_type: string;
  field_name: string;
  raw_value: string | null;
  normalized_value: string | null;
  confidence: number | null;
  compared_vehicle_field: string | null;
  expected_value: string | null;
  match_status: ExtractionMatchStatus;
  mismatch_reason: string | null;
  review_status: ExtractionReviewStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  source_model: string | null;
  ai_job_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehicleDocumentExtractionsResponse {
  extractions: VehicleDocumentExtraction[];
  mismatch_count: number;
  pending_review_count: number;
}

export interface ExtractionReviewDecisionPayload {
  review_status: Exclude<ExtractionReviewStatus, 'pending'>;
  mismatch_reason?: string | null;
}

// ── Phase 3 — VehicleEvidenceMetadata (replaces Record<string, any>) ─────────

export interface VehicleEvidenceMetadata {
  ai_analysis?: EvidenceAiAnalysis | null;
  ai_public_summary?: string | null;
  perceptual_similarity_score?: number | null;
  duplicate_check_status?: 'clean' | 'flagged' | 'pending' | null;
  [key: string]: unknown;
}

// ── Vehicle Life Evidence Taxonomy (M1) ──────────────────────────────────────
// The eight life-stage evidence classes, mirroring the backend taxonomy
// (backend/services/evidence/evidenceTaxonomy.js EVIDENCE_CLASSES).
export type EvidenceClass =
  | 'import'
  | 'auction'
  | 'accident'
  | 'repair'
  | 'inspection'
  | 'ownership_transfer'
  | 'dealer_listing'
  | 'current_condition';

// One subtype as returned by GET /api/evidence/taxonomy.
export interface EvidenceTaxonomySubtype {
  subtype_code: string;
  label: string;
  is_document: boolean;
  requires_event_date: boolean;
  requires_mileage: boolean;
  supports_components: boolean;
}

// One class (with its subtypes) as returned by GET /api/evidence/taxonomy.
export interface EvidenceTaxonomyClass {
  evidence_class: EvidenceClass | string;
  subtypes: EvidenceTaxonomySubtype[];
}

// Full payload of GET /api/evidence/taxonomy.
export interface EvidenceTaxonomyResponse {
  version: string;
  classes: EvidenceTaxonomyClass[];
  legacy_type_to_class: Record<string, EvidenceClass | string>;
}

// One source as returned by GET /api/evidence/sources (public-safe).
export interface EvidenceSource {
  id: string;
  code: string;
  display_name: string;
  source_type: string;
  organization?: string | null;
  country?: string | null;
  verification_status: string;
  trust_tier: string;
  permitted_evidence_classes: string[];
  active: boolean;
}

// Full payload of GET /api/evidence/sources.
export interface EvidenceSourcesResponse {
  sources: EvidenceSource[];
}

export interface VehicleEvidence {
  id: string;
  vehicle_id: string;
  vin: string;
  event_type: string;
  evidence_type: EvidenceType;
  // Vehicle Life Evidence Taxonomy (M1) — optional on legacy records.
  evidence_class?: EvidenceClass | string | null;
  evidence_subtype?: string | null;
  event_date?: string | null;
  source_id?: string | null;
  perceptual_hash?: string | null;
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
  metadata: VehicleEvidenceMetadata;
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

// ── Vehicle Life Intelligence: Temporal Comparison + Disclosure (M3) ──────────
// Buyer-facing, PUBLIC-SAFE shapes only. The backend projects reviewer-confirmed
// findings/conflicts through publicSafeFinding/publicSafeConflict
// (backend/routes/intelligenceRoutes.js); privileged callers receive more fields,
// but the buyer UI must rely only on the public-safe shape below.

// Shared review-status indicator for intelligence findings/conflicts.
// Buyers only ever see 'confirmed' (others are filtered server-side), but the
// type allows the full lifecycle so privileged views can reuse it later.
export type IntelligenceReviewerState =
  | 'pending_review'
  | 'confirmed'
  | 'dismissed';

// Severity ladder shared by temporal findings and disclosure conflicts.
export type IntelligenceSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

// The kind of component-level change a temporal comparison surfaced.
export type TemporalFindingType =
  | 'newly_damaged'
  | 'repaired'
  | 'replaced'
  | 'removed_missing'
  | 'repainted_colour_mismatch'
  | 'worsened'
  | 'improved'
  | 'unchanged'
  | 'unable_to_compare';

// One public-safe temporal finding from
// GET /api/vehicles/:vin/temporal-findings -> { findings: TemporalFinding[] }.
export interface TemporalFinding {
  finding_type: TemporalFindingType | string;
  component: string | null;
  earlier_date: string | null;
  later_date: string | null;
  severity: IntelligenceSeverity | string;
  public_summary: string | null;
  reviewer_state: IntelligenceReviewerState | string;
}

// How a disclosure claim compares against available evidence.
export type DisclosureClassification =
  | 'supported'
  | 'not_verifiable'
  | 'possible_conflict'
  | 'strong_conflict'
  | 'outdated_claim'
  | 'resolved_corrected';

// One public-safe disclosure conflict from
// GET /api/vehicles/:vin/disclosure-conflicts -> { conflicts: DisclosureConflict[] }.
export interface DisclosureConflict {
  conflict_type: string | null;
  classification: DisclosureClassification | string;
  severity: IntelligenceSeverity | string;
  public_summary: string | null;
  reviewer_state: IntelligenceReviewerState | string;
  seller_response: string | null;
}

// Wrapper responses (match the route handlers exactly).
export interface TemporalFindingsResponse {
  findings: TemporalFinding[];
}
export interface DisclosureConflictsResponse {
  conflicts: DisclosureConflict[];
}

// ── Vehicle History Report (M4) ──────────────────────────────────────────────
// Public-safe buyer report from GET /api/vehicles/:vin/report and from the
// `report` field of GET /api/reports/shared/:token. Mirrors the backend
// assembleReport() shape exactly (backend/services/report/reportService.js).

// The kind of report alert. Buyers see itemized, evidence-linked alerts — never a
// single opaque score.
export type ReportAlertCategory = 'visual_change' | 'disclosure' | 'mileage' | string;

export interface ReportKeyAlert {
  category: ReportAlertCategory;
  type: string | null;
  component?: string | null;
  severity: IntelligenceSeverity | string;
  summary: string | null;
  reviewed: boolean;
  evidence_count: number;
  recommended_action: string;
}

// One public-safe timeline / evidence-index row.
export interface ReportTimelineItem {
  evidence_id: string;
  evidence_class: EvidenceClass | string | null;
  evidence_subtype: string | null;
  date: string | null;
  source_id: string | null;
  verification_status: EvidenceVerificationStatus | string | null;
}

export interface ReportSections {
  auction_import: { auction: number; import: number };
  accident_repair: { accident: number; repair: number };
  inspection: number;
  ownership_transfer: number;
  current_condition: number;
}

export interface ReportMileageObservation {
  date: string | null;
  value: number;
  unit: string;
  source: string;
  evidence_id?: string;
  listing_id?: string;
}

export interface ReportMileageHistory {
  observations: ReportMileageObservation[];
  anomaly: boolean;
}

export interface ReportListingSnapshot {
  version: number | null;
  captured_at: string | null;
  title: string | null;
  price: number | null;
  currency: string | null;
  advertised_mileage: number | null;
  claimed_condition: string | null;
}

// Visual comparison rows are structurally compatible with TemporalFinding so the
// existing VehicleTemporalComparison component can render them directly.
export interface ReportVisualComparison {
  finding_type: TemporalFindingType | string;
  component: string | null;
  earlier_date: string | null;
  later_date: string | null;
  severity: IntelligenceSeverity | string;
  public_summary: string | null;
  reviewer_state: IntelligenceReviewerState | string;
}

// Disclosure rows are structurally compatible with DisclosureConflict so the
// existing VehicleDisclosurePanel component can render them directly.
export interface ReportDisclosureItem {
  conflict_type: string | null;
  classification: DisclosureClassification | string;
  severity: IntelligenceSeverity | string;
  public_summary: string | null;
  reviewer_state: IntelligenceReviewerState | string;
  seller_response: string | null;
}

export interface ReportCompleteness {
  identity_coverage: number;
  timeline_coverage: number;
  classes_present: string[];
  classes_missing: string[];
  mileage_coverage: number;
  source_diversity: number;
  inspection_recency: string | null;
  current_condition_coverage: number;
  unresolved_conflict_count: number;
}

export interface VehicleHistoryReportData {
  schema: string;
  vin: string;
  audience: string;
  identity: { vin: string; make?: string | null; model?: string | null; year?: number | null };
  key_alerts: ReportKeyAlert[];
  timeline: ReportTimelineItem[];
  sections: ReportSections;
  mileage_history: ReportMileageHistory;
  listing_history: ReportListingSnapshot[];
  visual_comparisons: ReportVisualComparison[];
  disclosure: ReportDisclosureItem[];
  completeness: ReportCompleteness;
  limitations: string[];
  evidence_index: ReportTimelineItem[];
  generated_at_note?: string;
}

// POST /api/vehicles/:vin/report/versions
export interface ReportVersionResponse {
  id: string;
  version: number;
  content_hash: string;
  completeness: ReportCompleteness;
}

// POST /api/report-versions/:id/share
export interface ReportShareLinkResponse {
  share_token: string;
  share_expires_at: string;
  version: number;
}

// GET /api/reports/shared/:token (success body)
export interface SharedReportResponse {
  version: number;
  generated_at: string;
  correction_notice: string | null;
  report: VehicleHistoryReportData;
}

// Discriminated result for the public shared-report fetch so callers can render
// distinct "expired/revoked" (410) and "not found" (404) states without parsing
// error strings.
export type SharedReportResult =
  | { status: 'ok'; data: SharedReportResponse }
  | { status: 'gone'; reason: string }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

// ── Governance, disputes & corrections (M5, master plan §11) ──
// Mirrors backend/services/governance/governanceService.js + disputeService.js and
// backend/routes/governanceRoutes.js exactly.

// Master-plan task types surfaced by GET /api/governance/review-queue.
export type GovernanceTaskType =
  | 'temporal_finding'
  | 'disclosure_conflict'
  | 'vehicle_identity'
  | 'evidence_verification';

// The review-target tables a governed decision may act on (decisions.targetType).
export type GovernanceTargetType =
  | 'temporal_findings'
  | 'disclosure_conflicts'
  | 'vehicle_evidence'
  | 'vehicle_identity_candidates';

// Decisions a reviewer may take against a finding/evidence target. The UI verbs
// map onto these wire values (request-more -> request_more, etc.).
export type GovernanceDecision =
  | 'confirm'
  | 'reject'
  | 'amend'
  | 'request_more'
  | 'inconclusive'
  | 'publish'
  | 'unpublish'
  | 'supersede'
  | 'escalate';

// One aggregated pending item from the unified reviewer queue.
export interface GovernanceReviewItem {
  task_type: GovernanceTaskType;
  target_type: GovernanceTargetType;
  target_id: string;
  vin: string | null;
  state: string;
  confidence: number | null;
  severity: IntelligenceSeverity | string | null;
  created_at: string | null;
  summary: string | null;
}

export interface GovernanceReviewQueueResponse {
  queue: GovernanceReviewItem[];
  total: number;
}

// Payload for POST /api/governance/decisions.
export interface GovernanceDecisionPayload {
  targetType: GovernanceTargetType;
  targetId: string;
  vin?: string | null;
  decision: GovernanceDecision;
  notes?: string | null;
  policyVersion?: string | null;
  reviewTaskId?: string | null;
}

// Append-only review_decisions row returned by the decisions endpoint.
export interface GovernanceDecisionRecord {
  id: string;
  review_task_id: string | null;
  target_type: string;
  target_id: string;
  vin: string | null;
  reviewer_id: string;
  reviewer_role: string;
  decision: GovernanceDecision;
  notes: string | null;
  policy_version: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  correlation_id: string | null;
  conflict_of_interest: boolean;
  created_at?: string | null;
}

export interface GovernanceDecisionResponse {
  success: boolean;
  decision: GovernanceDecisionRecord;
}

// Dispute lifecycle: open -> responded -> independent_review -> resolved (-> appealed).
export type DisputeStatus =
  | 'open'
  | 'responded'
  | 'independent_review'
  | 'resolved'
  | 'appealed';

// Privileged view of a dispute row (admin/government/reviewer).
export interface Dispute {
  id: string;
  vin: string | null;
  subject_type: string;
  subject_id: string;
  raised_by: string;
  raised_by_role: string;
  status: DisputeStatus | string;
  resolution?: string | null;
  assigned_reviewer?: string | null;
  response_deadline?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

// Public-safe projection returned to non-privileged callers from
// GET /api/vehicles/:vin/disputes.
export interface PublicSafeDispute {
  subject_type: string;
  status: DisputeStatus | string;
  created_at: string | null;
  target_id: string | null;
  vin: string | null;
  public_state: 'confirmed_public' | 'not_public';
  disputed: boolean;
  public_summary: string | null;
}

export interface VehicleDisputesResponse {
  vin: string;
  // Privileged callers receive full Dispute rows; non-privileged callers receive the
  // public-safe projection. The union covers both shapes the route can return.
  disputes: Array<Dispute | PublicSafeDispute>;
  total: number;
}

// Payloads for the dispute lifecycle endpoints.
export interface SubmitDisputePayload {
  vin?: string | null;
  subjectType: string;
  subjectId: string;
  reason?: string | null;
}

export interface ResolveDisputePayload {
  resolution: string;
  outcome?: 'upheld' | 'rejected' | string;
  targetType?: GovernanceTargetType;
  targetId?: string;
  policyVersion?: string | null;
}

export interface DisputeMutationResponse {
  success: boolean;
  dispute: Dispute;
}
