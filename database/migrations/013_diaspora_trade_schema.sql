-- +migrate Up
-- =============================================================
-- CarUp Kimi — Diaspora Trade & Import Coordination bounded domain
-- Order-first import coordination for Japan → Zimbabwe trade flows.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Generic updated_at helper for new Diaspora tables
CREATE OR REPLACE FUNCTION set_diaspora_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -------------------------------------------------------------
-- Document type/template/rule registry for scalable OCR mappings
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trade_document_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  verification_required BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS trade_document_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type_code TEXT NOT NULL REFERENCES trade_document_types(code),
  provider TEXT NOT NULL DEFAULT 'carup_ocr',
  prompt_template TEXT,
  expected_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS trade_document_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type_code TEXT NOT NULL REFERENCES trade_document_types(code),
  rule_code TEXT NOT NULL,
  rule_description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'blocking')),
  rule_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(document_type_code, rule_code)
);

-- -------------------------------------------------------------
-- Core order-first Diaspora Trade domain
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS diaspora_import_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  buyer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  linked_vehicle_vin TEXT REFERENCES vehicles(vin) ON DELETE SET NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('vehicle', 'parts', 'mixed')),
  origin_country TEXT NOT NULL,
  origin_city TEXT,
  destination_country TEXT NOT NULL DEFAULT 'Zimbabwe',
  destination_city TEXT,
  requested_make TEXT,
  requested_model TEXT,
  requested_year_min INTEGER,
  requested_year_max INTEGER,
  budget_amount NUMERIC(12, 2),
  budget_currency TEXT NOT NULL DEFAULT 'USD',
  auction_lot_number TEXT,
  chassis_number TEXT,
  vin TEXT,
  status TEXT NOT NULL DEFAULT 'IMPORT_REQUESTED' CHECK (status IN (
    'IMPORT_REQUESTED', 'QUOTE_ISSUED', 'SELLER_ASSIGNED', 'DOCUMENTS_PENDING', 'DOCUMENTS_VERIFIED',
    'CONTAINER_BOOKED', 'READY_FOR_LOADING', 'LOADED', 'SHIPPED', 'ARRIVED_AT_BORDER',
    'CUSTOMS_IN_PROGRESS', 'DUTY_PENDING', 'DUTY_PAID', 'RELEASED', 'REGISTRATION_PENDING',
    'ROADWORTHINESS_PENDING', 'INSURANCE_PENDING', 'ZIMBABWE_READY', 'LOCAL_LISTING_ENABLED',
    'COMPLETED', 'CANCELLED', 'DISPUTED', 'FLAGGED_FOR_REVIEW'
  )),
  verification_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS diaspora_import_order_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  import_order_id UUID NOT NULL REFERENCES diaspora_import_orders(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  trade_profile_id UUID,
  participant_role TEXT NOT NULL CHECK (participant_role IN ('buyer', 'seller', 'exporter', 'agent', 'dealer', 'company', 'coordinator', 'customs_reviewer')),
  verification_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS diaspora_trade_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  country TEXT NOT NULL,
  city TEXT NOT NULL,
  role_type TEXT NOT NULL CHECK (role_type IN ('buyer', 'seller', 'exporter', 'agent', 'dealer', 'company', 'coordinator')),
  verification_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (verification_status IN ('PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'SUSPENDED', 'FLAGGED')),
  trust_score NUMERIC(5, 2) NOT NULL DEFAULT 50,
  completed_shipments_count INTEGER NOT NULL DEFAULT 0,
  dispute_count INTEGER NOT NULL DEFAULT 0,
  rating_average NUMERIC(3, 2) NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(user_id, role_type, country)
);

ALTER TABLE diaspora_import_order_participants
  ADD CONSTRAINT diaspora_participants_trade_profile_fk
  FOREIGN KEY (trade_profile_id) REFERENCES diaspora_trade_profiles(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS diaspora_import_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  import_order_id UUID NOT NULL REFERENCES diaspora_import_orders(id) ON DELETE CASCADE,
  seller_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  quote_amount NUMERIC(12, 2) NOT NULL,
  quote_currency TEXT NOT NULL DEFAULT 'USD',
  valid_until TIMESTAMPTZ,
  inclusions JSONB NOT NULL DEFAULT '[]'::jsonb,
  exclusions JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('DRAFT', 'ISSUED', 'ACCEPTED', 'REJECTED', 'EXPIRED')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- -------------------------------------------------------------
-- Trade documents and OCR/verification records
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS diaspora_trade_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  import_order_id UUID REFERENCES diaspora_import_orders(id) ON DELETE CASCADE,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  document_type TEXT NOT NULL REFERENCES trade_document_types(code),
  document_url TEXT,
  storage_path TEXT,
  ocr_document_id TEXT,
  verification_status TEXT NOT NULL DEFAULT 'UPLOADED' CHECK (verification_status IN ('MISSING', 'UPLOADED', 'OCR_EXTRACTED', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'FLAGGED')),
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS diaspora_trade_document_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  trade_document_id UUID NOT NULL REFERENCES diaspora_trade_documents(id) ON DELETE CASCADE,
  extraction_provider TEXT NOT NULL DEFAULT 'carup_ocr',
  extracted_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence_score NUMERIC(5, 4) NOT NULL DEFAULT 0,
  raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  verification_status TEXT NOT NULL DEFAULT 'OCR_EXTRACTED',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS diaspora_trade_document_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  trade_document_id UUID NOT NULL REFERENCES diaspora_trade_documents(id) ON DELETE CASCADE,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('VERIFIED', 'REJECTED', 'FLAGGED', 'PENDING_REVIEW')),
  verified_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- -------------------------------------------------------------
-- Containers, reservations, and shipment visibility
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS diaspora_container_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  origin_country TEXT NOT NULL,
  origin_city TEXT NOT NULL,
  destination_country TEXT NOT NULL,
  destination_city TEXT NOT NULL,
  departure_date TIMESTAMPTZ NOT NULL,
  booking_deadline TIMESTAMPTZ NOT NULL,
  estimated_arrival_date TIMESTAMPTZ,
  container_type TEXT NOT NULL,
  total_capacity_volume NUMERIC(12, 3) NOT NULL,
  used_capacity_volume NUMERIC(12, 3) NOT NULL DEFAULT 0,
  available_capacity_volume NUMERIC(12, 3) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'BOOKING_OPEN', 'BOOKING_CLOSED', 'LOADING', 'SHIPPED', 'ARRIVED', 'COMPLETED', 'CANCELLED')),
  coordinator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  verification_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CHECK (used_capacity_volume >= 0),
  CHECK (available_capacity_volume >= 0),
  CHECK (total_capacity_volume >= used_capacity_volume)
);

CREATE TABLE IF NOT EXISTS diaspora_cargo_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  container_id UUID NOT NULL REFERENCES diaspora_container_shipments(id) ON DELETE CASCADE,
  import_order_id UUID NOT NULL REFERENCES diaspora_import_orders(id) ON DELETE CASCADE,
  buyer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  seller_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  cargo_type TEXT NOT NULL CHECK (cargo_type IN ('vehicle', 'parts', 'mixed', 'other')),
  estimated_volume NUMERIC(12, 3) NOT NULL,
  estimated_weight NUMERIC(12, 3),
  declared_value NUMERIC(12, 2),
  currency TEXT NOT NULL DEFAULT 'USD',
  cargo_description TEXT,
  pickup_location TEXT,
  receiver_name TEXT,
  receiver_phone TEXT,
  receiver_location TEXT,
  invoice_document_id UUID REFERENCES diaspora_trade_documents(id) ON DELETE SET NULL,
  dimensions_document_id UUID REFERENCES diaspora_trade_documents(id) ON DELETE SET NULL,
  reservation_status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (reservation_status IN ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  verification_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS diaspora_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  import_order_id UUID NOT NULL REFERENCES diaspora_import_orders(id) ON DELETE CASCADE,
  container_id UUID REFERENCES diaspora_container_shipments(id) ON DELETE SET NULL,
  carrier_name TEXT,
  tracking_number TEXT,
  origin_port TEXT,
  destination_port TEXT,
  departure_date TIMESTAMPTZ,
  estimated_arrival_date TIMESTAMPTZ,
  actual_arrival_date TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'BOOKED', 'LOADING', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS_HOLD', 'RELEASED', 'COMPLETED', 'EXCEPTION')),
  verification_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS diaspora_shipment_stage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  shipment_id UUID NOT NULL REFERENCES diaspora_shipments(id) ON DELETE CASCADE,
  import_order_id UUID REFERENCES diaspora_import_orders(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  notes TEXT,
  location TEXT,
  event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verification_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- -------------------------------------------------------------
-- Compliance, payment milestones, reputation, notifications, audit
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS diaspora_compliance_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  import_order_id UUID NOT NULL REFERENCES diaspora_import_orders(id) ON DELETE CASCADE,
  review_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW', 'APPROVED', 'FLAGGED', 'REJECTED')),
  assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  notes TEXT,
  verification_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS diaspora_payment_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  import_order_id UUID NOT NULL REFERENCES diaspora_import_orders(id) ON DELETE CASCADE,
  milestone_type TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  due_date TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'FAILED', 'WAIVED', 'CANCELLED')),
  external_reference TEXT,
  confirmed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  verification_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS diaspora_reputation_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  trade_profile_id UUID NOT NULL REFERENCES diaspora_trade_profiles(id) ON DELETE CASCADE,
  import_order_id UUID REFERENCES diaspora_import_orders(id) ON DELETE SET NULL,
  reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  rating NUMERIC(2, 1) NOT NULL CHECK (rating >= 0 AND rating <= 5),
  review_text TEXT,
  dispute_flag BOOLEAN NOT NULL DEFAULT false,
  verification_status TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (verification_status IN ('PENDING_REVIEW', 'PUBLISHED', 'FLAGGED', 'REMOVED')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS diaspora_import_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  import_order_id UUID REFERENCES diaspora_import_orders(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  previous_state JSONB,
  new_state JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  cryptographic_seal TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  verification_status TEXT NOT NULL DEFAULT 'VERIFIED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS diaspora_notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('IN_APP', 'EMAIL', 'SMS', 'WHATSAPP', 'PUSH')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(user_id, channel)
);

-- -------------------------------------------------------------
-- Zimbabwe conversion and government documentation footprint
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_import_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  import_order_id UUID NOT NULL REFERENCES diaspora_import_orders(id) ON DELETE CASCADE,
  vehicle_vin TEXT REFERENCES vehicles(vin) ON DELETE SET NULL,
  chassis_number TEXT,
  origin_country TEXT,
  export_port TEXT,
  import_port TEXT,
  import_date DATE,
  verification_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (verification_status IN ('PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'FLAGGED')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS vehicle_government_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  import_order_id UUID REFERENCES diaspora_import_orders(id) ON DELETE CASCADE,
  vehicle_vin TEXT REFERENCES vehicles(vin) ON DELETE CASCADE,
  document_category TEXT NOT NULL CHECK (document_category IN (
    'ZIMRA_CLEARANCE', 'CVR_REGISTRATION', 'ZINARA_LICENSE', 'VID_ROADWORTHINESS', 'CID_POLICE_CLEARANCE',
    'INSURANCE_RECORD', 'DUTY_TAX_PROOF', 'IMPORT_PORT_RECORD', 'ODOMETER_VERIFICATION', 'MECHANICAL_VERIFICATION'
  )),
  trade_document_id UUID REFERENCES diaspora_trade_documents(id) ON DELETE SET NULL,
  ocr_document_id TEXT,
  verification_status TEXT NOT NULL DEFAULT 'MISSING' CHECK (verification_status IN ('MISSING', 'UPLOADED', 'OCR_EXTRACTED', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'FLAGGED')),
  verified_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(import_order_id, document_category)
);

-- -------------------------------------------------------------
-- Indexes
-- -------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_diaspora_orders_tenant ON diaspora_import_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_diaspora_orders_buyer ON diaspora_import_orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_diaspora_orders_status ON diaspora_import_orders(status);
CREATE INDEX IF NOT EXISTS idx_diaspora_orders_linked_vehicle ON diaspora_import_orders(linked_vehicle_vin);
CREATE INDEX IF NOT EXISTS idx_diaspora_participants_order ON diaspora_import_order_participants(import_order_id);
CREATE INDEX IF NOT EXISTS idx_diaspora_trade_profiles_user ON diaspora_trade_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_diaspora_trade_docs_order ON diaspora_trade_documents(import_order_id);
CREATE INDEX IF NOT EXISTS idx_diaspora_trade_docs_status ON diaspora_trade_documents(verification_status);
CREATE INDEX IF NOT EXISTS idx_diaspora_containers_status ON diaspora_container_shipments(status);
CREATE INDEX IF NOT EXISTS idx_diaspora_reservations_container ON diaspora_cargo_reservations(container_id);
CREATE INDEX IF NOT EXISTS idx_diaspora_reservations_order ON diaspora_cargo_reservations(import_order_id);
CREATE INDEX IF NOT EXISTS idx_diaspora_shipments_order ON diaspora_shipments(import_order_id);
CREATE INDEX IF NOT EXISTS idx_diaspora_stage_events_shipment ON diaspora_shipment_stage_events(shipment_id);
CREATE INDEX IF NOT EXISTS idx_diaspora_compliance_order ON diaspora_compliance_reviews(import_order_id);
CREATE INDEX IF NOT EXISTS idx_diaspora_audit_order ON diaspora_import_audit_log(import_order_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_government_docs_order ON vehicle_government_documents(import_order_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_government_docs_vin ON vehicle_government_documents(vehicle_vin);

-- -------------------------------------------------------------
-- updated_at triggers
-- -------------------------------------------------------------
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'trade_document_types', 'trade_document_templates', 'trade_document_rules',
    'diaspora_import_orders', 'diaspora_import_order_participants', 'diaspora_trade_profiles',
    'diaspora_import_quotes', 'diaspora_trade_documents', 'diaspora_trade_document_extractions',
    'diaspora_trade_document_verifications', 'diaspora_container_shipments', 'diaspora_cargo_reservations',
    'diaspora_shipments', 'diaspora_shipment_stage_events', 'diaspora_compliance_reviews',
    'diaspora_payment_milestones', 'diaspora_reputation_records', 'diaspora_import_audit_log',
    'diaspora_notification_preferences', 'vehicle_import_records', 'vehicle_government_documents'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_diaspora_updated_at()', table_name, table_name);
  END LOOP;
END $$;

-- -------------------------------------------------------------
-- RLS policies. Service-role backend bypasses RLS; policies protect direct clients.
-- -------------------------------------------------------------
ALTER TABLE trade_document_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_document_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_document_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE diaspora_import_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE diaspora_import_order_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE diaspora_trade_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE diaspora_import_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE diaspora_trade_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE diaspora_trade_document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE diaspora_trade_document_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE diaspora_container_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE diaspora_cargo_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE diaspora_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE diaspora_shipment_stage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE diaspora_compliance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE diaspora_payment_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE diaspora_reputation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE diaspora_import_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE diaspora_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_import_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_government_documents ENABLE ROW LEVEL SECURITY;

-- Direct Supabase clients need explicit grants in addition to RLS. Keep private
-- Diaspora trade data authenticated-only and use RLS to scope rows.
CREATE OR REPLACE FUNCTION is_diaspora_platform_admin()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() ->> 'role', '') IN ('admin', 'government');
$$ LANGUAGE sql STABLE;

GRANT SELECT ON tenant_users TO authenticated;
DROP POLICY IF EXISTS "tenant_users_self_read_for_diaspora" ON tenant_users;
CREATE POLICY "tenant_users_self_read_for_diaspora" ON tenant_users
  FOR SELECT USING (user_id = auth.uid()::text OR is_diaspora_platform_admin());

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'diaspora_import_orders', 'diaspora_import_order_participants', 'diaspora_trade_profiles',
    'diaspora_import_quotes', 'diaspora_trade_documents', 'diaspora_trade_document_extractions',
    'diaspora_trade_document_verifications', 'diaspora_container_shipments', 'diaspora_cargo_reservations',
    'diaspora_shipments', 'diaspora_shipment_stage_events', 'diaspora_compliance_reviews',
    'diaspora_payment_milestones', 'diaspora_reputation_records', 'diaspora_import_audit_log',
    'diaspora_notification_preferences', 'vehicle_import_records', 'vehicle_government_documents'
  ]
  LOOP
    EXECUTE format('CREATE POLICY diaspora_platform_admin_access ON %I FOR ALL USING (is_diaspora_platform_admin()) WITH CHECK (is_diaspora_platform_admin())', table_name);
  END LOOP;
END $$;

CREATE POLICY "diaspora_reference_documents_read" ON trade_document_types FOR SELECT USING (deleted_at IS NULL);
CREATE POLICY "diaspora_reference_templates_read" ON trade_document_templates FOR SELECT USING (deleted_at IS NULL);
CREATE POLICY "diaspora_reference_rules_read" ON trade_document_rules FOR SELECT USING (deleted_at IS NULL);

CREATE POLICY "diaspora_orders_owner_participant_tenant" ON diaspora_import_orders
  FOR SELECT USING (
    buyer_id = auth.uid()::text
    OR created_by = auth.uid()::text
    OR id IN (SELECT import_order_id FROM diaspora_import_order_participants WHERE user_id = auth.uid()::text AND deleted_at IS NULL)
    OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  );

CREATE POLICY "diaspora_orders_owner_insert" ON diaspora_import_orders
  FOR INSERT WITH CHECK (created_by = auth.uid()::text OR buyer_id = auth.uid()::text OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text));

CREATE POLICY "diaspora_orders_owner_participant_update" ON diaspora_import_orders
  FOR UPDATE USING (
    buyer_id = auth.uid()::text
    OR created_by = auth.uid()::text
    OR id IN (SELECT import_order_id FROM diaspora_import_order_participants WHERE user_id = auth.uid()::text AND deleted_at IS NULL)
    OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  );

-- Shared policy pattern for order-linked records: participant/owner/tenant scoped.
CREATE POLICY "diaspora_participants_access" ON diaspora_import_order_participants FOR ALL USING (
  user_id = auth.uid()::text
  OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
) WITH CHECK (
  user_id = auth.uid()::text
  OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
);

CREATE POLICY "diaspora_trade_profiles_access" ON diaspora_trade_profiles FOR ALL USING (
  user_id = auth.uid()::text OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
) WITH CHECK (
  user_id = auth.uid()::text OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
);

CREATE POLICY "diaspora_order_child_access" ON diaspora_import_quotes FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
  OR seller_id = auth.uid()::text
) WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
  OR seller_id = auth.uid()::text
);

CREATE POLICY "diaspora_documents_private_access" ON diaspora_trade_documents FOR ALL USING (
  uploaded_by = auth.uid()::text
  OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
  OR import_order_id IN (SELECT import_order_id FROM diaspora_import_order_participants WHERE user_id = auth.uid()::text AND deleted_at IS NULL)
) WITH CHECK (
  uploaded_by = auth.uid()::text
  OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
  OR import_order_id IN (SELECT import_order_id FROM diaspora_import_order_participants WHERE user_id = auth.uid()::text AND deleted_at IS NULL)
);

CREATE POLICY "diaspora_extractions_private_access" ON diaspora_trade_document_extractions FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR trade_document_id IN (SELECT id FROM diaspora_trade_documents WHERE uploaded_by = auth.uid()::text)
) WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR trade_document_id IN (SELECT id FROM diaspora_trade_documents WHERE uploaded_by = auth.uid()::text)
);

CREATE POLICY "diaspora_verifications_private_access" ON diaspora_trade_document_verifications FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR trade_document_id IN (SELECT id FROM diaspora_trade_documents WHERE uploaded_by = auth.uid()::text)
) WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR trade_document_id IN (SELECT id FROM diaspora_trade_documents WHERE uploaded_by = auth.uid()::text)
);

CREATE POLICY "diaspora_containers_read_participants" ON diaspora_container_shipments FOR SELECT USING (deleted_at IS NULL);
CREATE POLICY "diaspora_containers_tenant_write" ON diaspora_container_shipments FOR ALL USING (
  coordinator_id = auth.uid()::text OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
) WITH CHECK (
  coordinator_id = auth.uid()::text OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
);

CREATE POLICY "diaspora_reservations_access" ON diaspora_cargo_reservations FOR ALL USING (
  buyer_id = auth.uid()::text
  OR seller_id = auth.uid()::text
  OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
) WITH CHECK (
  buyer_id = auth.uid()::text
  OR seller_id = auth.uid()::text
  OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
);

CREATE POLICY "diaspora_shipments_access" ON diaspora_shipments FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
  OR import_order_id IN (SELECT import_order_id FROM diaspora_import_order_participants WHERE user_id = auth.uid()::text AND deleted_at IS NULL)
) WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
  OR import_order_id IN (SELECT import_order_id FROM diaspora_import_order_participants WHERE user_id = auth.uid()::text AND deleted_at IS NULL)
);

CREATE POLICY "diaspora_stage_events_access" ON diaspora_shipment_stage_events FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
) WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
);

CREATE POLICY "diaspora_compliance_access" ON diaspora_compliance_reviews FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
) WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
);

CREATE POLICY "diaspora_payment_access" ON diaspora_payment_milestones FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
) WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
);

CREATE POLICY "diaspora_reputation_access" ON diaspora_reputation_records FOR ALL USING (
  reviewer_id = auth.uid()::text
  OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR trade_profile_id IN (SELECT id FROM diaspora_trade_profiles WHERE user_id = auth.uid()::text)
) WITH CHECK (
  reviewer_id = auth.uid()::text
  OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
);

CREATE POLICY "diaspora_audit_access" ON diaspora_import_audit_log FOR SELECT USING (
  actor_id = auth.uid()::text
  OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
);

CREATE POLICY "diaspora_notifications_access" ON diaspora_notification_preferences FOR ALL USING (
  user_id = auth.uid()::text OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
) WITH CHECK (
  user_id = auth.uid()::text OR tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
);

CREATE POLICY "vehicle_import_records_access" ON vehicle_import_records FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
) WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
);

CREATE POLICY "vehicle_government_documents_access" ON vehicle_government_documents FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
) WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text)
  OR import_order_id IN (SELECT id FROM diaspora_import_orders WHERE buyer_id = auth.uid()::text OR created_by = auth.uid()::text)
);

GRANT SELECT ON trade_document_types, trade_document_templates, trade_document_rules TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON
  diaspora_import_orders, diaspora_import_order_participants, diaspora_trade_profiles,
  diaspora_import_quotes, diaspora_trade_documents, diaspora_trade_document_extractions,
  diaspora_trade_document_verifications, diaspora_container_shipments, diaspora_cargo_reservations,
  diaspora_shipments, diaspora_shipment_stage_events, diaspora_compliance_reviews,
  diaspora_payment_milestones, diaspora_reputation_records, diaspora_notification_preferences,
  vehicle_import_records, vehicle_government_documents
TO authenticated;
GRANT SELECT ON diaspora_import_audit_log TO authenticated;

-- -------------------------------------------------------------
-- Seed document type registry for Phase 1 OCR/document intelligence.
-- -------------------------------------------------------------
INSERT INTO trade_document_types (code, display_name, description, verification_required)
VALUES
  ('passport', 'Passport', 'Identity passport for diaspora sellers and buyers.', true),
  ('national_id', 'National ID', 'Zimbabwe national identification document.', true),
  ('residence_card', 'Residence Card', 'Residence/status card for diaspora sellers.', true),
  ('vehicle_registration', 'Vehicle Registration', 'Origin-country registration or Zimbabwe logbook document.', true),
  ('auction_sheet', 'Auction Sheet', 'Japanese auction sheet or condition report.', true),
  ('bill_of_lading', 'Bill of Lading', 'Carrier bill of lading for shipping visibility.', true),
  ('commercial_invoice', 'Commercial Invoice', 'Commercial invoice for import valuation.', true),
  ('export_certificate', 'Export Certificate', 'Origin-country export certificate.', true),
  ('customs_declaration', 'Customs Declaration', 'ZIMRA or origin customs declaration.', true),
  ('inspection_certificate', 'Inspection Certificate', 'Roadworthiness/export inspection document.', true),
  ('insurance_certificate', 'Insurance Certificate', 'Insurance cover note/certificate.', true),
  ('duty_receipt', 'Duty Receipt', 'Duty/tax payment receipt.', true),
  ('packing_list', 'Packing List', 'Container/cargo packing list.', false),
  ('port_release_order', 'Port Release Order', 'Port release order or delivery instruction.', true),
  ('police_clearance', 'Police Clearance', 'CID/anti-theft police clearance document.', true),
  ('mechanical_report', 'Mechanical Report', 'Mechanical verification or inspection report.', true)
ON CONFLICT (code) DO UPDATE SET display_name = EXCLUDED.display_name, description = EXCLUDED.description, verification_required = EXCLUDED.verification_required;

INSERT INTO trade_document_rules (document_type_code, rule_code, rule_description, severity, rule_config)
SELECT code, 'confidence_min_080', 'OCR confidence should be at least 0.80 before auto-review.', 'warning', '{"minimumConfidence":0.8}'::jsonb
FROM trade_document_types
ON CONFLICT (document_type_code, rule_code) DO NOTHING;

-- +migrate Down
DROP TABLE IF EXISTS vehicle_government_documents CASCADE;
DROP TABLE IF EXISTS vehicle_import_records CASCADE;
DROP TABLE IF EXISTS diaspora_notification_preferences CASCADE;
DROP TABLE IF EXISTS diaspora_import_audit_log CASCADE;
DROP TABLE IF EXISTS diaspora_reputation_records CASCADE;
DROP TABLE IF EXISTS diaspora_payment_milestones CASCADE;
DROP TABLE IF EXISTS diaspora_compliance_reviews CASCADE;
DROP TABLE IF EXISTS diaspora_shipment_stage_events CASCADE;
DROP TABLE IF EXISTS diaspora_shipments CASCADE;
DROP TABLE IF EXISTS diaspora_cargo_reservations CASCADE;
DROP TABLE IF EXISTS diaspora_container_shipments CASCADE;
DROP TABLE IF EXISTS diaspora_trade_document_verifications CASCADE;
DROP TABLE IF EXISTS diaspora_trade_document_extractions CASCADE;
DROP TABLE IF EXISTS diaspora_trade_documents CASCADE;
DROP TABLE IF EXISTS diaspora_import_quotes CASCADE;
DROP TABLE IF EXISTS diaspora_import_order_participants CASCADE;
DROP TABLE IF EXISTS diaspora_trade_profiles CASCADE;
DROP TABLE IF EXISTS diaspora_import_orders CASCADE;
DROP TABLE IF EXISTS trade_document_rules CASCADE;
DROP TABLE IF EXISTS trade_document_templates CASCADE;
DROP TABLE IF EXISTS trade_document_types CASCADE;
DROP POLICY IF EXISTS "tenant_users_self_read_for_diaspora" ON tenant_users;
REVOKE SELECT ON tenant_users FROM authenticated;
DROP FUNCTION IF EXISTS is_diaspora_platform_admin();
DROP FUNCTION IF EXISTS set_diaspora_updated_at;
