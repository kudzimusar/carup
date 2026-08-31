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
  /**
   * Governed per-VIN counts from `/api/vehicles/me` — Issue #164 Phase 8, Cluster D.
   *
   * `null` on any member means that count was NOT read, and the surface must say so in words. My
   * Garage previously read `documents` / `service_records` / `parts` / `insurance_records` straight
   * off the row; none of those columns exists on `vehicles`, so `|| 0` published four unmeasured
   * zeros per vehicle.
   */
  counts?: {
    verified_documents: number | null;
    services: number | null;
    parts: number | null;
    active_insurance: number | null;
  } | null;
  /**
   * The canonical listing-media block, as published by `toListingMediaBlock`. Owner list surfaces
   * read THIS, never a `image_url` column — `vehicles` has no such column, so reading it rendered
   * the "Image unavailable" placeholder over vehicles with published photographs. Read it through
   * `primaryListingImageUrl` (web/src/lib/listingMedia.ts) so every surface picks the same photo.
   */
  listing_media?: {
    state: 'published' | 'none' | 'not_loaded';
    items: Array<{ media_id: string; url: string; url_form: string; position: number; seller_order?: number | null; is_primary: boolean; photo_label?: string | null }>;
    unpublishable_count: number;
    empty_statement: string | null;
  } | null;
  location?: string;
  /**
   * Why `location` is or is not there. Carried through from the marketplace summary so a card can
   * state a governed absence in the shared vocabulary instead of inventing its own words.
   */
  location_state?: 'recorded' | 'not_recorded' | 'withheld' | 'not_applicable';
  image_url?: string;
  images?: string[];
  publication_status?: string;
  condition?: string;
  category?: string;
  /**
   * Seller Journey 1.0 / S2 — the seller's own commercial statements, as published by
   * `PUBLIC_VEHICLE_FIELDS`. `seller_stated_condition` is what the SELLER said; the governed CarUp
   * classification is `vehicle_condition_category` and is a different question. Never render one
   * as the other.
   */
  body_style?: string | null;
  seller_stated_condition?: string | null;
  seller_description?: string | null;
  seller_features?: string[] | null;
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
  // The canonical media contract (Issue #164 Phase 5). `MarketplaceMedia` is no longer
  // `{url, type, is_primary?}`: it extends the listing-media item, so it carries `media_id`,
  // `url_form` and `position` exactly as the service publishes them.
  MarketplaceMediaUrlForm,
  MarketplaceMediaBlockState,
  MarketplaceListingMediaItem,
  MarketplaceListingMediaBlock,
  MarketplaceMedia,
  MarketplacePrimaryImageState,
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
  diaspora_payment_milestones?: DiasporaPaymentMilestone[];
  diaspora_import_quotes?: DiasporaImportOrderQuoteSummary[];
}

/** Embedded quote summary on getImportOrder responses (used for the milestone cap display). */
export interface DiasporaImportOrderQuoteSummary {
  id: string;
  seller_id?: string | null;
  status?: string | null;
  quote_amount?: number | string | null;
  quote_currency?: string | null;
  created_at?: string | null;
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

/** Government-document footprint row (GET /diaspora/import-orders/:id/government-footprint). */
export interface DiasporaGovernmentDocument {
  category: string;
  status: string;
  requiredForZimbabweReady?: boolean;
  documentId?: string | null;
  verifiedAt?: string | null;
}

/** Sealed diaspora audit row (GET /diaspora/import-orders/:id/audit). Read-only history. */
export interface DiasporaAuditEntry {
  id: string;
  import_order_id?: string | null;
  action: string;
  actor_id?: string | null;
  resource_type?: string | null;
  resource_id?: string | null;
  created_at?: string | null;
  cryptographic_seal?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Shipment stage event (GET /diaspora/shipments/:id/timeline). */
export interface DiasporaShipmentStageEvent {
  id: string;
  shipment_id?: string;
  stage: string;
  notes?: string | null;
  created_at?: string | null;
  created_by?: string | null;
}

/** Diaspora trade profile (GET /diaspora/trade-profiles/:id) — seller/buyer identity + trust. */
export interface DiasporaTradeProfile {
  id: string;
  user_id?: string | null;
  tenant_id?: string | null;
  organization_id?: string | null;
  display_name?: string | null;
  profile_type?: string | null;
  role_type?: string | null;
  verification_status?: string | null;
  trust_score?: number | null;
  completed_shipments_count?: number | null;
  dispute_count?: number | null;
  rating_average?: number | null;
  country?: string | null;
  city?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Create payload for a trade profile. Self-service callers omit user_id (server derives it) and
 * cannot set verification_status/trust_score — those are reviewer-only. */
export interface DiasporaTradeProfileInput {
  role_type: string;
  country: string;
  city: string;
  organization_id?: string | null;
  user_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Self-service editable subset (non-authoritative fields only). expected_updated_at is the
 * optimistic-concurrency token — the server rejects the update if the row changed since read. */
export interface DiasporaTradeProfileUpdate {
  country?: string;
  city?: string;
  organization_id?: string | null;
  metadata?: Record<string, unknown> | null;
  expected_updated_at?: string | null;
}

/** A non-custodial payment milestone reference record — CarUp never moves money for this. */
export interface DiasporaPaymentMilestone {
  id: string;
  import_order_id: string;
  tenant_id?: string | null;
  milestone_type: string;
  amount: number;
  currency: string;
  due_date?: string | null;
  status: string;
  external_reference?: string | null;
  idempotency_key?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
}

/** Create payload for a payment milestone. */
export interface DiasporaPaymentMilestoneInput {
  milestone_type: string;
  amount: number;
  currency?: string;
  due_date?: string | null;
  external_reference?: string | null;
  idempotency_key?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Ownership handoff status (GET /diaspora/import-orders/:id/ownership-handoff). */
export interface DiasporaOwnershipHandoffStatus {
  handedOff: boolean;
  vehicleVin?: string | null;
  evidence?: Array<Record<string, unknown>>;
}

/** Ownership handoff result (POST /diaspora/import-orders/:id/ownership-handoff). */
export interface DiasporaOwnershipHandoffResult {
  idempotentReplay?: boolean;
  vehicle?: { vin?: string; id?: string; [key: string]: unknown } | null;
  handedOff?: boolean;
  [key: string]: unknown;
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
  /** Authoritative template route as advertised by the backend (e.g. /api/diaspora/workbook/template.xlsx). */
  template_xlsx_path?: string;
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
  /** Optimistic-concurrency token (the row's last-seen updated_at); a mismatch yields 409. */
  expected_updated_at?: string;
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

/**
 * A credential the vault holds on the user's behalf. There is deliberately no token field of any
 * kind: `vault_reference` is never projected to an API consumer, so the UI can render provenance
 * (which backend, which key version, when it was last refreshed) without ever handling secret
 * material.
 */
export interface DiasporaDriveCredentialReference {
  id: string;
  purpose: string;
  vaultBackend: string | null;
  keyVersion: string | null;
  scopes: string[] | null;
  status: string;
  externalAccountLabel: string | null;
  expiresAt: string | null;
  lastRefreshedAt: string | null;
  lastErrorCode: string | null;
  revokedAt: string | null;
}

/**
 * One durable attempt to push something to Drive. Field names mirror `sanitizeSyncAttempt` in
 * backend/services/diaspora/drive/driveSyncQueue.js exactly.
 *
 * `state` carries the distinction the UI must not flatten: `failed` with a `nextAttemptAt` is still
 * being retried, whereas `dead_lettered` means the file did NOT reach Drive and never will without
 * the user acting.
 */
export interface DiasporaDriveSyncAttempt {
  id: string;
  operation: 'ensure_folder' | 'upload' | 'update' | 'metadata' | 'revoke';
  entityType: string | null;
  entityId: string | null;
  idempotencyKey: string;
  state: 'pending' | 'in_flight' | 'succeeded' | 'failed' | 'dead_lettered';
  attempts: number;
  nextAttemptAt: string | null;
  providerFileId: string | null;
  providerFolderId: string | null;
  bytes: number | null;
  contentChecksum: string | null;
  lastErrorCode: string | null;
  lastError: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
}

export interface DiasporaDriveSyncAttempts {
  attempts: DiasporaDriveSyncAttempt[];
  /** False when the durable queue is unavailable — the UI must not imply attempts are being tracked. */
  durableTracking: boolean;
  reason?: string;
}

export interface DiasporaDriveStatus {
  enabled: boolean;
  provider: string;
  scopes: string[];
  connection: DiasporaDriveConnection | null;
  credential?: DiasporaDriveCredentialReference | null;
  /**
   * Whether this deployment can complete an OAuth connection at all. `pending` means the owner has
   * not provisioned Google credentials, so Connect could only ever fail with NOT_CONFIGURED.
   */
  activation?: { credentialsConfigured: boolean; redirectUris: number; pending: boolean };
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

// ── Phase 8: Subscription & Entitlements (tenant plan + per-user overrides) ──
// Plan/feature catalog is config-driven on the backend (constants/diaspora/diasporaEntitlements.js);
// the UI NEVER hardcodes the catalog and always renders from the API responses below.
export type PlanEntitlements = Record<string, boolean | number>;

export interface Plan {
  planKey: string;
  name: string;
  tier: string;
  sortOrder: number;
  description: string;
  entitlements: PlanEntitlements;
}

export interface SubscriptionStatus {
  tenantId: string;
  planKey: string;
  status: string;
  synthetic: boolean;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  active: boolean;
}

export type EffectiveEntitlements = Record<string, boolean | number>;

/**
 * GET /diaspora/subscription/entitlements envelope (resolveEffectiveEntitlements): plan identity and
 * resolution provenance wrapped around the merged feature map. `source` is 'db' when the plan row came
 * from the database and 'config' when the catalog fallback resolved it; `synthetic` means no
 * access-granting subscription row existed (Free floor). The feature map itself lives under
 * `entitlements` — the envelope fields are metadata, never entitlements.
 */
export interface EffectiveEntitlementsEnvelope {
  tenantId: string;
  userId: string;
  planKey: string;
  planName?: string;
  tier?: string;
  status?: string;
  source?: string;
  synthetic?: boolean;
  entitlements: EffectiveEntitlements;
  overrides?: Record<string, unknown>;
}

export interface UsageEntry {
  featureKey: string;
  planKey?: string;
  limit: number | null;
  used: number;
  reserved?: number;
  remaining: number | null;
  metered?: boolean;
  unlimited?: boolean;
  available?: boolean;
  periodStart?: string;
}

export interface UsageResponse {
  tenantId: string;
  periodStart: string;
  usage: UsageEntry[];
}

/** One reconciliation run over this tenant's billing state. `findings` are pre-sanitized server-side. */
export interface BillingReconciliationRun {
  id: string;
  tenant_id: string | null;
  provider: string;
  trigger: string;
  state: 'running' | 'completed' | 'failed';
  started_at: string | null;
  finished_at: string | null;
  checked_count: number | null;
  mismatch_count: number | null;
  repaired_count: number | null;
  findings: Array<Record<string, unknown>> | null;
  initiated_by: string | null;
  last_error: string | null;
}

export interface BillingReconciliationResult {
  runId: string | null;
  state: string;
  trigger: string;
  checked: number;
  mismatches: number;
  findings: Array<Record<string, unknown>>;
  correlationId: string | null;
}

/** A provider event that could not be applied. Carries no payload — only what an operator needs. */
export interface BillingLedgerEvent {
  id: string;
  provider: string;
  event_id: string;
  event_type: string | null;
  tenant_id: string | null;
  last_error?: string | null;
  attempts?: number | null;
  occurred_at?: string | null;
  created_at?: string | null;
  dead_lettered?: boolean;
  superseded?: boolean;
}

/**
 * Operator health for one tenant's billing.
 *
 * `reconciliation.stale` is the signal that matters most: a scheduler that quietly stopped looks
 * exactly like "no problems found", so freshness is reported separately from mismatch counts.
 */
export interface BillingHealth {
  tenantId: string;
  failedWebhooks: { count: number; events: BillingLedgerEvent[] };
  supersededWebhooks: { count: number; events: BillingLedgerEvent[] };
  reconciliation: {
    lastCompletedAt: string | null;
    ageMinutes: number | null;
    stale: boolean;
    reason: string | null;
  };
  checkout: {
    tenantId: string | null;
    total: number;
    counts: { open: number; completed: number; abandoned: number; expired: number; cancelled: number };
    abandonmentRate: number | null;
  };
}

// A normalized, SAFE-to-render denial. Parsed from a backend 4xx (whose body is
// { success:false, error:{ code, message, ... } }) or a network/transport failure. NEVER carries
// db details, stack traces, internal tenant ids, raw provider errors, or secrets.
export type EntitlementDenialCategory =
  | 'feature-unavailable-on-plan'
  | 'quota-exhausted'
  | 'inactive-subscription'
  | 'tenant-context-missing'
  | 'external-activation-unavailable'
  | 'ordinary-authorization-failure'
  | 'network-or-server-failure';

export interface StructuredEntitlementDenial {
  category: EntitlementDenialCategory;
  /** Human-readable, already-safe summary line. */
  message: string;
  /** The operation the user attempted (e.g. "manage subscription"), when known. */
  requestedOperation?: string;
  /** Canonical feature key the operation required, when known. */
  requiredFeature?: string;
  /** The caller's current plan key, when known. */
  currentPlan?: string;
  /** The lowest plan that grants the required feature, when known (upgrade target). */
  requiredPlan?: string | null;
  /** Remaining quota for the feature, when the backend provided it. */
  remaining?: number | null;
  /** Whether upgrading to a higher plan can unblock the operation. */
  upgradeEligible?: boolean;
  /** Whether retrying may succeed (transient network/server failure). */
  retryable?: boolean;
}

export interface SandboxBillingActionResponse {
  /** Opaque sandbox session/snapshot identifier (no secrets, no provider tokens). */
  id?: string;
  provider?: string;
  sandbox?: boolean;
  planKey?: string;
  plan_key?: string;
  status?: string;
  url?: string;
  cancel_at_period_end?: boolean;
  cancelAtPeriodEnd?: boolean;
  current_period_end?: string | null;
  currentPeriodEnd?: string | null;
  [key: string]: unknown;
}

// 3. WorkOrder
export interface WorkOrder {
  id: string;
  vehicle: string; // VIN
  vin?: string;
  customer: string;
  customer_name?: string;
  service: string;
  /** Phase-4 schema column name; historical rows may carry issue_description instead. */
  description?: string;
  issue_description?: string;
  /** DB CHECK values ('In Progress'|'Completed'|'Cancelled') plus legacy/normalized lowercase rows. */
  status: 'pending' | 'in-progress' | 'completed' | 'cancelled' | 'In Progress' | 'Completed' | 'Cancelled';
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
  /** Where the generated file actually lives. Absent means there is no file. */
  url?: string | null;
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
  // Optional: absent means CarUp has no recorded measurement, not measured zero.
  views?: number;
  clicks?: number;
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

/**
 * Seller Journey S5 — one fact, as the seller stated it and as their documents read.
 *
 * `seller_stated` and `evidence_indicated` are deliberately separate and both nullable: CarUp
 * reports the disagreement, it does not resolve it, and there is no `resolved_value` because no
 * value here is authoritative.
 */
export interface SellerFactReconciliationEntry {
  field: string;
  state: 'agrees' | 'contradicted' | 'not_comparable' | 'no_evidence';
  seller_stated: string | null;
  evidence_indicated: string | null;
  document_type: string | null;
  /** True only when a human reviewer stood behind the document reading — never because it exists. */
  evidence_verified: boolean;
  review_status: string | null;
  resolved: boolean;
  material: boolean;
  extraction_id: string | null;
  superseded_count: number;
}

export interface SellerFactReconciliation {
  vin: string | null;
  fields: SellerFactReconciliationEntry[];
  contradiction_count: number;
  unresolved_material_count: number;
  agreement_count: number;
  has_unresolved_material_contradiction: boolean;
  unresolved_material_fields: string[];
}

export interface VehicleCompleteness {
  vin: string;
  requirements: EvidenceRequirement[];
  completeness_percent: number;
  is_publishable: boolean;
  blocking_gaps: string[];
  pending_gaps: string[];
  publication_status: string;
  /** S5: why a contradiction gate refused, without a second round trip. */
  reconciliation?: SellerFactReconciliation;
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
  /**
   * OPTIONAL, and never a trust claim on a public surface (Issue #164 Phase 3).
   *
   * The buyer-safe projection (`toPublicDecision`) carries NO `overall_trust`: the single public
   * statement of a trust position is the canonical `trust` projection served alongside this object.
   * Only the PRIVILEGED responses — /api/vehicles/:vin/trust-decision for admin/government/reviewer/
   * owner/dealer, and /trust-decision/full — return the raw decision, which still carries it. Typing
   * it as required was a lie about what a buyer actually receives, and reading it to render a score
   * is what put "50 · moderate" beside "Not evaluated" on one listing.
   */
  overall_trust?: { status: string; value: string | number | null };
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
  /**
   * NULL when the artifact is withheld — a verified document in the private `ocr-documents` bucket
   * whose FACT is published but whose FILE is not. Nullable on purpose: it makes every consumer's
   * assumption type-checked rather than discovered at runtime by a null dereference on a page load.
   */
  file_url: string | null;
  file_availability?: 'viewable' | 'withheld_private';
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
  /** null means either withheld or unrecorded — disambiguate with currentSellerRecorded. */
  currentSellerDisplayName?: string | null;
  currentSellerType?: string | null;
  /** A seller IS on file. With a null display name this means withheld, not absent. */
  currentSellerRecorded?: boolean;
  /** null means the ownership-history source could not be read, never a zero-owner claim. */
  previousOwnerCount: number | null;
  previousOwnerCountState?: 'available' | 'unavailable';
  previousOwnersPublicLabel: string;
  ownerNamesRedacted: boolean;
  currentOwnerVisible: boolean;
}

// 17. VehiclePassport (fully typed, no any)
/**
 * A governed claim leaf: the value, whether it is really recorded, and where it came from.
 * `state` is the discriminator — a consumer that reads `value` without it is publishing an
 * unattributed fact, which is the whole class of defect Issue #164 removes.
 */
export interface ClaimLeaf {
  value?: string | number | boolean | null;
  state?: 'recorded' | 'not_recorded' | 'withheld' | 'not_applicable';
  source?: string | null;
}

/**
 * The passport's sealed claim blocks. Location lives HERE and deliberately nowhere else: it is not a
 * column on the vehicle projection, so `vehicle.location` is `undefined` for every caller. Vehicle
 * Detail read that phantom column and rendered "Location not recorded" for a vehicle whose own
 * passport carried Bulawayo / Bulawayo Metropolitan / Zimbabwe with `operator_recorded` provenance.
 */
export interface VehiclePassportClaims {
  location?: { city?: ClaimLeaf; province?: ClaimLeaf; country?: ClaimLeaf };
  registration?: { country?: ClaimLeaf; authority?: ClaimLeaf };
  [block: string]: unknown;
}

export interface VehicleLifecycleMileageObservation {
  date: string | null;
  value: number;
  unit: string;
  source: string;
  lifecycle_event_id?: string | null;
  evidence_id?: string | null;
}

export interface VehicleLifecycleEvent {
  id: string;
  category: string;
  date: string | null;
  label: string;
  source_kind: string;
  source_id: string | null;
  verification_status: string | null;
  mileage: number | null;
  mileage_unit: string;
  evidence_id: string | null;
  detail_state: 'recorded' | 'public_detail' | 'summary_only' | string;
}

export interface VehicleLifecycleProjection {
  schema: 'vehicle_lifecycle_projection.v1' | string;
  projection_version: string;
  vin: string;
  audience: string;
  events: VehicleLifecycleEvent[];
  counts: Record<string, number>;
  count_states?: Record<string, {
    value: number;
    state: 'complete' | 'partial' | 'unavailable';
  }>;
  source_states?: Record<string, 'available' | 'unavailable'>;
  mileage: {
    observations: VehicleLifecycleMileageObservation[];
    anomaly: boolean;
    coverage_state?: 'complete' | 'partial' | 'unavailable';
  };
  source_diversity: number;
}

export interface VehiclePassport {
  vehicle: Vehicle;
  /** Sealed governed claims. Read these, never a same-named column on `vehicle`. */
  claims?: VehiclePassportClaims;
  timeline: TimelineEvent[];
  evidenceTimeline?: TimelineEvent[];
  /** Canonical buyer-safe lifecycle shared with the History Report. */
  lifecycle?: VehicleLifecycleProjection;
  evidenceVault?: VehicleEvidence[];
  trustReport: TrustReport;
  chainVerification: ChainVerification;
  identity: VehicleIdentity;
  plateHistory: VehiclePlateHistory[];
  /** Whether the plate-history collection was actually read for this passport response. */
  plateHistoryState?: 'available' | 'unavailable';
  /** Rows were withheld from this audience, so an empty list is not an empty history. */
  plateHistoryRedacted?: boolean;
  ownershipSummary: OwnershipSummary;
  /**
   * Vehicle History & Obligations (K17–K19): the seller's structured accident/insurance/finance
   * statements, block-attributed seller_stated. Null per topic = "not recorded" — never a
   * clean-history claim. Shape defined by the shared web lib (vehicleHistoryDisclosures).
   */
  history_disclosures?: import('@/lib/vehicleHistoryDisclosures').VehicleHistoryDisclosuresBlock;
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

// ════════════════════════════════════════════════════════════════════════════
// 22. Phase 9 — SafeTrade (escrow/assurance overlay) — INTEGRATION-OWNED TYPES
//
// These mirror the real backend API shapes (see backend/services/diaspora/safetrade/*). The
// transaction/milestone/dispute rows are the snake_case DB rows returned verbatim by the read
// routes; the eligibility/release verdicts + available-action projection are the explainable
// envelopes returned by their pure services. The UI is NON-CUSTODIAL: it renders action controls
// ONLY from SafeTradeAvailableAction[] (GET /:id/available-actions) and never duplicates the
// 16-state transition table. SafeTrade is sandbox payment-state simulation only.
// ════════════════════════════════════════════════════════════════════════════

/** The 16 canonical SafeTrade lifecycle/design states (constants/diaspora/diasporaSafeTradeStatuses.js). */
export type SafeTradeState =
  | 'DRAFT'
  | 'ELIGIBILITY_PENDING'
  | 'AWAITING_BUYER_COMMITMENT'
  | 'AWAITING_SELLER_COMMITMENT'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_HELD'
  | 'DOCUMENTS_PENDING'
  | 'COMPLIANCE_REVIEW'
  | 'SHIPMENT_IN_PROGRESS'
  | 'DELIVERY_CONFIRMATION_PENDING'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'SUSPENDED'
  | 'CANCELLED'
  | 'REFUND_PENDING'
  | 'REFUNDED';

/** The coarse DB transaction status (the migration CHECK enum) carried on the transaction row. */
export type SafeTradeDbStatus =
  | 'DRAFT'
  | 'INITIATED'
  | 'FUNDS_PENDING'
  | 'FUNDS_HELD'
  | 'IN_PROGRESS'
  | 'RELEASE_REVIEW'
  | 'RELEASE_AUTHORIZED'
  | 'SETTLED'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'SUSPENDED'
  | 'CANCELLED'
  | 'REFUND_REVIEW'
  | 'REFUNDED';

/** The SafeTrade transaction row (diaspora_safetrade_transactions). */
export interface SafeTradeTransaction {
  id: string;
  tenant_id: string | null;
  import_order_id: string;
  accepted_quote_id: string | null;
  buyer_id: string | null;
  seller_id: string | null;
  currency: string;
  total_amount: number;
  status: SafeTradeDbStatus | string;
  payment_provider: string;
  live_payment: boolean;
  policy_version: string;
  idempotency_key?: string | null;
  metadata?: {
    safetrade?: {
      deliveryConfirmed?: boolean;
      paymentRequested?: boolean;
      shipmentStarted?: boolean;
      securityHold?: boolean;
      lastEvent?: string;
      createdVia?: string;
    } | null;
    delivery?: { buyerConfirmed?: boolean } | null;
    [key: string]: unknown;
  } | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
}

/** A single SafeTrade timeline/audit row (diaspora_import_audit_log filtered to SAFETRADE_* actions). */
export interface SafeTradeTimelineEvent {
  id?: string;
  action: string;
  resource_type?: string | null;
  resource_id?: string | null;
  actor_id?: string | null;
  previous_state?: Record<string, unknown> | null;
  new_state?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  source?: string | null;
}

/** A safe, role-redacted evidence reference attached to an eligibility/release verdict. */
export interface SafeTradeEvidenceRef {
  kind: string;
  table: string;
  recordId: string | null;
  observed: Record<string, unknown>;
  satisfied: boolean;
}

/** A single explainable eligibility/release blocker. */
export interface SafeTradeBlocker {
  code: string;
  message: string;
  severity: 'BLOCK' | string;
  evidenceRef: SafeTradeEvidenceRef | null;
  remediation: string;
  policyClause: string;
  denialCode?: string;
}

/** The eligibility verdict envelope (diasporaSafeTradeEligibilityService.evaluateEligibility). */
export interface SafeTradeEligibilityVerdict {
  eligible: boolean;
  blockers: SafeTradeBlocker[];
  evidenceRefs: SafeTradeEvidenceRef[];
  policyVersion: string;
  evaluatedAt: string;
}

export type SafeTradeRiskTier = 'LOW' | 'STANDARD' | 'HIGH';

/** The release-policy verdict envelope (diasporaSafeTradeReleasePolicyService.evaluateRelease). */
export interface SafeTradeReleaseEvaluation {
  eligible: boolean;
  blockers: SafeTradeBlocker[];
  evidenceRefs: SafeTradeEvidenceRef[];
  policyVersion: string;
  evaluatedAt: string;
  requiresApproval: boolean;
  riskTier: SafeTradeRiskTier;
  providerMode: 'sandbox' | 'live' | string;
}

/** The recorded release-evaluation row returned by POST /:id/evaluate-release. */
export interface SafeTradeReleaseEvaluationRecord {
  id: string;
  transaction_id: string;
  milestone_id: string | null;
  eligible: boolean;
  blockers: SafeTradeBlocker[];
  evidence_refs: SafeTradeEvidenceRef[];
  requires_reviewer: boolean;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | string;
  policy_version: string;
  evaluated_by: string;
  evaluated_at: string;
}

export interface SafeTradeEvaluateReleaseResponse {
  evaluation: SafeTradeReleaseEvaluationRecord;
  verdict: SafeTradeReleaseEvaluation;
}

/** A SafeTrade milestone row (diaspora_safetrade_milestones). Money states are SANDBOX simulation. */
export interface SafeTradeMilestone {
  id: string;
  transaction_id: string;
  tenant_id?: string | null;
  milestone_type: string;
  sequence: number;
  amount: number;
  currency: string;
  /** Sandbox-simulated escrow status: DUE, FUNDS_PENDING, FUNDED, HELD, RELEASE_AUTHORIZED, RELEASED, REFUNDED, etc. */
  status: string;
  payer?: string | null;
  payee?: string | null;
  due_trigger?: string | null;
  release_trigger?: string | null;
  evidence_requirements?: string[] | null;
  provider_reference?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** A SafeTrade dispute case row (diaspora_safetrade_disputes). */
export interface SafeTradeDispute {
  id: string;
  tenant_id?: string | null;
  transaction_id: string;
  milestone_id: string | null;
  import_order_id?: string | null;
  raised_by?: string | null;
  raised_by_role?: 'BUYER' | 'SELLER' | 'REVIEWER' | 'ADMIN' | 'SYSTEM' | string;
  category: string;
  reason: string;
  status: 'OPEN' | 'UNDER_REVIEW' | 'AWAITING_INFO' | 'RESOLVED' | 'REJECTED' | 'WITHDRAWN' | 'CANCELLED' | string;
  resolution?: string | null;
  resolution_notes?: string | null;
  assigned_reviewer_id?: string | null;
  assigned_at?: string | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
  hold_placed?: boolean;
  policy_version?: string;
  created_at?: string | null;
  updated_at?: string | null;
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
  evidence_id: string | null;
  evidence_class: EvidenceClass | string | null;
  evidence_subtype: string | null;
  date: string | null;
  source_id: string | null;
  source_kind?: string | null;
  verification_status: EvidenceVerificationStatus | string | null;
  detail_state?: 'recorded' | 'public_detail' | 'summary_only' | string;
  mileage?: number | null;
  mileage_unit?: string | null;
}

export type ReportLifecycleReadState = 'complete' | 'partial' | 'unavailable';

export interface ReportLifecycleCountEnvelope {
  value: number;
  state: ReportLifecycleReadState;
}

export interface ReportSections {
  auction_import: { auction: number | null; import: number | null };
  accident_repair: { accident: number | null; repair: number | null };
  inspection: number | null;
  ownership_transfer: number | null;
  current_condition: number | null;
  service?: number | null;
  insurance?: number | null;
  registration?: number | null;
  clearance?: number | null;
}

export interface ReportMileageObservation {
  date: string | null;
  value: number;
  unit: string;
  source: string;
  evidence_id?: string | null;
  listing_id?: string;
  lifecycle_event_id?: string;
}

export interface ReportMileageHistory {
  observations: ReportMileageObservation[];
  anomaly: boolean;
  coverage_state?: ReportLifecycleReadState;
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
  classes_unavailable?: string[];
  mileage_coverage: number;
  mileage_coverage_state?: ReportLifecycleReadState;
  lifecycle_source_coverage?: number;
  source_diversity: number;
  inspection_recency: string | null;
  current_condition_coverage: number | null;
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
  lifecycle_projection?: {
    version: string;
    source_diversity: number;
    counts: Record<string, number>;
    count_states?: Record<string, ReportLifecycleCountEnvelope>;
    source_states?: Record<string, 'available' | 'unavailable'>;
    mileage_coverage_state?: ReportLifecycleReadState;
  };
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

/** A dispute evidence row (diaspora_safetrade_dispute_evidence) — already privacy-redacted server-side. */
export interface SafeTradeDisputeEvidence {
  id: string;
  dispute_id: string;
  transaction_id?: string | null;
  evidence_type: string;
  author_id?: string | null;
  author_role?: string | null;
  visibility: 'PARTICIPANTS' | 'REVIEWERS_ONLY' | 'AUTHOR_ONLY' | string;
  statement?: string | null;
  document_ref?: string | null;
  evidence_refs?: unknown[];
  created_at?: string | null;
}

/** Stable disabled-reason taxonomy (diasporaSafeTradeAvailableActions SAFETRADE_DISABLED_REASON_CODES). */
export type SafeTradeDisabledReasonCode =
  | 'WRONG_ROLE'
  | 'WRONG_STATE'
  | 'DISPUTE_ACTIVE'
  | 'NEEDS_EVALUATION'
  | 'NEEDS_REVIEWER'
  | 'LIVE_PAYMENT_DISABLED'
  | 'HELD_FUNDS_BOUNDARY'
  | 'NOT_ELIGIBLE'
  | 'DISABLED';

/**
 * A single safe, server-derived available-action descriptor (computeAvailableActions output). The UI
 * renders controls ONLY from these — backend stays authoritative on submit.
 */
export interface SafeTradeAvailableAction {
  actionKey: string;
  labelKey: string;
  permitted: boolean;
  disabledReasonCode: SafeTradeDisabledReasonCode | null;
  confirmationRequired: boolean;
  reviewerRequired: boolean;
  sandboxOnly: boolean;
  requiredEvidenceCategories: string[];
}

/** The ALLOWLISTED set of lifecycle commit events accepted by POST /:id/commit. */
export type SafeTradeCommitEvent =
  | 'RUN_ELIGIBILITY'
  | 'BUYER_COMMIT'
  | 'SELLER_COMMIT'
  | 'REQUEST_PAYMENT'
  | 'HOLD_PAYMENT'
  | 'ATTACH_DOCUMENTS'
  | 'SUBMIT_COMPLIANCE'
  | 'COMPLIANCE_PASS'
  | 'COMPLIANCE_FAIL'
  | 'BEGIN_SHIPMENT'
  | 'MARK_ARRIVED'
  | 'AWAIT_DELIVERY'
  | 'CONFIRM_DELIVERY'
  | 'SUSPEND'
  | 'RESUME';

export interface SafeTradeCommitPayload {
  event: SafeTradeCommitEvent;
  reason?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

/** Generic transition/commit result envelope (transition service). */
export interface SafeTradeActionResponse {
  transaction?: SafeTradeTransaction | null;
  milestone?: SafeTradeMilestone | null;
  event?: string;
  idempotentReplay?: boolean;
  observational?: boolean;
  provider?: { name?: string; status?: string; idempotentReplay?: boolean; [key: string]: unknown };
  reputationEligibilityEvent?: { event: string; transactionId: string; wroteReputation: boolean } | null;
}

/** Create-transaction result (POST /safetrade). */
export interface SafeTradeCreateResponse {
  transaction: SafeTradeTransaction;
  idempotentReplay: boolean;
}

/** Open-dispute result (POST /:id/disputes). */
export interface SafeTradeDisputeOpenResponse {
  dispute: SafeTradeDispute;
  transaction?: SafeTradeTransaction | null;
  idempotentReplay: boolean;
  holdPlaced: boolean;
  hold?: unknown;
}

/** Resolve-dispute result (POST /disputes/:id/resolve). */
export interface SafeTradeDisputeResolveResponse {
  dispute: SafeTradeDispute;
  resolution: string;
  money?: unknown;
}

/** Paginated list envelope (GET /safetrade). */
export interface SafeTradeListResponse {
  data: SafeTradeTransaction[];
  pagination: { limit: number; offset: number };
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

// ─── UI-10 · Diaspora Trade Graph dashboard (Issue #127) ────────────────────
// These mirror backend/services/diaspora/tradegraph/diasporaTradeGraphHealthService.js exactly.
// Note what is ABSENT: no entity ids, no node `data`, no raw event payloads. The dashboard reads are
// shaped so they cannot carry participant data in the first place, rather than relying on a
// redaction step that a later change could bypass.

export type TradeGraphHealthState = 'HEALTHY' | 'DEGRADED' | 'STALLED' | 'UNKNOWN' | 'EMPTY';

export interface TradeGraphTypeCount {
  type: string;
  count: number;
}

export interface TradeGraphCounts {
  nodes: TradeGraphTypeCount[];
  edges: TradeGraphTypeCount[];
  totalNodes: number;
  totalEdges: number;
}

export interface TradeGraphProjectionStatus {
  hasCheckpoint: boolean;
  health: TradeGraphHealthState;
  lastEventId: string | null;
  lastEventAt: string | null;
  /** Seconds since the last event the projection actually PROCESSED (not since its last heartbeat). */
  lagSeconds: number | null;
  deadLetterCount: number;
  replayCount: number;
  replayRequired: boolean;
  projectionVersion: string | null;
  updatedAt: string | null;
}

export interface TradeGraphRebuildRecord {
  id: string;
  status: string;
  requested_at: string | null;
  completed_at: string | null;
  events_processed: number | null;
  events_failed: number | null;
  nodes_rebuilt: number | null;
  edges_rebuilt: number | null;
  reason: string | null;
}

export interface TradeGraphSummary {
  counts: TradeGraphCounts;
  projection: TradeGraphProjectionStatus;
  lastRebuild: TradeGraphRebuildRecord | null;
  health: TradeGraphHealthState;
  /** Server-computed, so the UI never duplicates the staleness thresholds. */
  stale: boolean;
}

export interface TradeGraphDeadLetter {
  id: string;
  eventId: string;
  eventType: string;
  retryCount: number;
  createdAt: string | null;
  lastRetryAt: string | null;
  errorMessage: string | null;
  /** Always true — raw payloads are never returned. Surfaced so the UI can explain the empty detail. */
  payloadWithheld: boolean;
  payloadWithheldReason: string;
}

export interface TradeGraphRebuildResponse {
  status: string;
  tenantId?: string;
  rebuildId?: string;
  eventsProcessed?: number;
  eventsFailed?: number;
  nodesRebuilt?: number;
  edgesRebuilt?: number;
}

// ─── ST-3 operator surfaces (Issue #127) ───────────────────────────────────
// Maker-checker approvals (#2), the provider/ledger reconciliation queue (#3) and the transactional
// outbox (#1). Note what these DON'T carry: no participant identifiers, no provider payloads, no
// outbox event bodies. The server shapes them that way; the UI cannot re-introduce what it never gets.

export interface SafeTradeApproval {
  id: string;
  transaction_id: string;
  milestone_id: string | null;
  decision_type: 'release' | 'refund' | 'partial_refund' | 'dispute_resolution' | string;
  risk_level: string;
  amount: number | null;
  currency: string | null;
  requested_by: string;
  requested_at: string;
  requested_reason: string | null;
  expires_at: string | null;
  state: 'pending' | 'approved' | 'rejected' | 'expired' | 'consumed' | string;
  approved_by?: string | null;
  /** Server-computed: false when the viewer is the requester. Display only — the DB and RPC enforce it. */
  canApprove?: boolean;
  selfApprovalBlocked?: boolean;
}

export interface SafeTradeOperationUserState {
  state: string;
  userMessage: string;
  /** False for anything unresolved. There is deliberately no path from unresolved to "success". */
  settled: boolean;
}

export interface SafeTradeOperation {
  id: string;
  tenant_id: string;
  transaction_id: string | null;
  milestone_id: string | null;
  operation: string;
  state: string;
  provider: string;
  provider_ref: string | null;
  provider_status: string | null;
  amount: number | null;
  currency: string | null;
  attempts: number;
  next_attempt_at: string | null;
  last_error_code: string | null;
  last_error: string | null;
  requested_at: string;
  dispatched_at: string | null;
  confirmed_at: string | null;
  userState?: SafeTradeOperationUserState;
}

export interface SafeTradeOutboxBacklog {
  pending: number;
  retrying: number;
  deadLettered: number;
  /** The number that actually matters — a small count with a very old head is a stalled drainer. */
  oldestPendingAgeSeconds: number | null;
}

export interface SafeTradeOutboxDeadLetter {
  id: string;
  tenant_id: string | null;
  transaction_id: string | null;
  milestone_id: string | null;
  event_type: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  next_attempt_at: string | null;
  payloadWithheld: boolean;
  payloadWithheldReason: string;
}

export interface SafeTradeOutboxDrainSummary {
  claimed: number;
  dispatched: number;
  failed: number;
  deadLettered: number;
  noHandler: number;
  results: { id: string; eventType: string; outcome: string; error?: string }[];
}

// ─── Confirmed workbook import (Deliverable B, Issue #127) ─────────────────

export interface WorkbookImportConfirmation {
  id: string;
  tenant_id: string;
  batch_id: string;
  workbook_checksum: string;
  dry_run_revision: number;
  confirmed_by: string;
  confirmed_at: string;
  expires_at: string;
  idempotency_key: string;
  state: 'pending' | 'consumed' | 'expired' | 'invalidated' | string;
  row_count: number | null;
}

export interface WorkbookImportReceipt {
  id: string;
  batch_id: string;
  /**
   * An ORDINAL in plan order — NOT the workbook's own row number. Plan actions expose
   * `workbookRowNumber`, which the orchestrator does not carry through, so this counts 1..n over the
   * plan. Labelled "Row (order)" in the UI so nobody reconciles it against their spreadsheet.
   */
  row_number: number;
  sheet_name: string | null;
  outcome: 'accepted' | 'rejected' | 'skipped' | 'compensated' | 'pending' | string;
  entity_type: string | null;
  entity_ref: string | null;
  error_code: string | null;
  error_message: string | null;
  compensated_at: string | null;
  attempt: number;
  created_at: string;
}

export interface WorkbookImportExecutionResult {
  /** True ONLY when every row applied. Never rendered as success on any other value. */
  imported: boolean;
  batchId: string;
  confirmationId: string;
  status: string;
  appliedRows?: number;
  compensatedRows?: number;
  compensationFailures?: number;
  failedAtRow?: number;
  errorCode?: string;
  receipts?: number;
  userMessage: string;
}

export interface WorkbookInterruptedBatch {
  id: string;
  tenantId: string;
  status: string;
  totalRows: number | null;
  updatedAt: string | null;
  confirmedImport: Record<string, unknown> | null;
  /** True for NEEDS_OPERATOR: partly applied and not fully reversible. Never offer a retry. */
  needsHuman: boolean;
}
