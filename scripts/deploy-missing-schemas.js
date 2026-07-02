import pg from 'pg';

const connectionString = (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL);

const client = new pg.Client({
  connectionString,
});

const sql = `
-- ============================================================================
-- 1. GOVERNMENT EVIDENCE REGISTRIES
-- ============================================================================

-- ZIMRA: Customs Import Declarations
CREATE TABLE IF NOT EXISTS zimra_declarations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
  customs_ref_number VARCHAR(100) UNIQUE NOT NULL,
  importer_name VARCHAR(255) NOT NULL,
  port_of_entry VARCHAR(100) NOT NULL,
  duty_calculated_zig NUMERIC(15, 2) NOT NULL,
  duty_paid_zig NUMERIC(15, 2) NOT NULL,
  exchange_rate_used NUMERIC(12, 4) NOT NULL,
  customs_stamp_date DATE NOT NULL,
  officer_signature_hash VARCHAR(64) NOT NULL,
  verified_at TIMESTAMPTZ DEFAULT NOW()
);

-- CVR: Central Vehicle Registry Title deeds & ownership chain
CREATE TABLE IF NOT EXISTS cvr_ownership_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
  registration_number VARCHAR(20) UNIQUE NOT NULL,
  owner_id_type VARCHAR(50) CHECK (owner_id_type IN ('National_ID', 'Passport', 'Company_Reg')),
  owner_id_number VARCHAR(100) NOT NULL,
  owner_full_name VARCHAR(255) NOT NULL,
  previous_registration_number VARCHAR(20),
  issue_date DATE NOT NULL,
  logbook_serial_number VARCHAR(100) UNIQUE NOT NULL,
  status VARCHAR(20) DEFAULT 'Current' CHECK (status IN ('Current', 'Transferred', 'Archived', 'Cancelled'))
);

-- VID: Vehicle Inspection Department Testing logs
CREATE TABLE IF NOT EXISTS vid_inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
  inspection_center VARCHAR(100) NOT NULL,
  odometer_reading INTEGER NOT NULL,
  braking_efficiency_pct NUMERIC(5, 2) NOT NULL,
  suspension_passed BOOLEAN NOT NULL DEFAULT TRUE,
  steering_passed BOOLEAN NOT NULL DEFAULT TRUE,
  exhaust_emissions_rating VARCHAR(10) CHECK (exhaust_emissions_rating IN ('Pass', 'Borderline', 'Fail')),
  lights_passed BOOLEAN NOT NULL DEFAULT TRUE,
  chassis_verified BOOLEAN NOT NULL DEFAULT TRUE,
  inspection_status VARCHAR(20) NOT NULL CHECK (inspection_status IN ('Passed', 'Roadworthy_Conditional', 'Failed_Unroadworthy')),
  certificate_serial_number VARCHAR(100) UNIQUE,
  inspector_id TEXT REFERENCES users(id),
  inspected_at TIMESTAMPTZ NOT NULL
);

-- CID: Criminal Investigation Department Clearance logs
CREATE TABLE IF NOT EXISTS cid_clearance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
  clearance_ref_number VARCHAR(100) UNIQUE NOT NULL,
  chassis_verified BOOLEAN NOT NULL DEFAULT TRUE,
  engine_number_verified BOOLEAN NOT NULL DEFAULT TRUE,
  interpol_database_queried BOOLEAN NOT NULL DEFAULT TRUE,
  stolen_check_status VARCHAR(20) NOT NULL DEFAULT 'Cleared' CHECK (stolen_check_status IN ('Cleared', 'Flagged_Stolen', 'Under_Investigation')),
  authorized_by_officer VARCHAR(255) NOT NULL,
  station_name VARCHAR(100) NOT NULL,
  cleared_at TIMESTAMPTZ NOT NULL
);

-- ZINARA: Zimbabwe Road Licensing Records
CREATE TABLE IF NOT EXISTS zinara_licensing_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
  plate_number VARCHAR(20) NOT NULL,
  licensing_term_start DATE NOT NULL,
  licensing_term_end DATE NOT NULL,
  receipt_number VARCHAR(100) UNIQUE NOT NULL,
  amount_paid_zig NUMERIC(12, 2) NOT NULL,
  status VARCHAR(20) CHECK (status IN ('Current', 'Arrears', 'Exempted')),
  tollgate_checkpoints_passed INTEGER DEFAULT 0,
  last_tollgate_seen_at TIMESTAMPTZ
);

-- ============================================================================
-- 2. STRUCTURED OCR DOCUMENT ENTITY SCHEMAS
-- ============================================================================

-- Structured National ID Extraction
CREATE TABLE IF NOT EXISTS ocr_national_ids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ocr_document_id TEXT NOT NULL REFERENCES ocr_documents(id) ON DELETE CASCADE,
  extracted_first_name VARCHAR(255) NOT NULL,
  extracted_last_name VARCHAR(255) NOT NULL,
  national_id_number VARCHAR(30) NOT NULL,
  date_of_birth DATE NOT NULL,
  place_of_birth VARCHAR(100),
  sex VARCHAR(1) CHECK (sex IN ('M', 'F')),
  date_of_issue DATE,
  raw_verification_confidence NUMERIC(4, 3) NOT NULL
);

-- Structured Vehicle Logbook Extraction
CREATE TABLE IF NOT EXISTS ocr_registration_books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ocr_document_id TEXT NOT NULL REFERENCES ocr_documents(id) ON DELETE CASCADE,
  extracted_vin VARCHAR(17) NOT NULL,
  extracted_engine_number VARCHAR(50),
  extracted_make VARCHAR(100) NOT NULL,
  extracted_model VARCHAR(100) NOT NULL,
  extracted_year INTEGER NOT NULL,
  extracted_plate_number VARCHAR(20) NOT NULL,
  extracted_owner_name VARCHAR(255) NOT NULL,
  extracted_chassis_number VARCHAR(100),
  raw_verification_confidence NUMERIC(4, 3) NOT NULL
);

-- Structured ZIMRA Customs Bill Ingest Extraction
CREATE TABLE IF NOT EXISTS ocr_customs_declarations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ocr_document_id TEXT NOT NULL REFERENCES ocr_documents(id) ON DELETE CASCADE,
  extracted_vin VARCHAR(17) NOT NULL,
  extracted_bill_entry_number VARCHAR(50) NOT NULL,
  extracted_duty_value_zig NUMERIC(15, 2) NOT NULL,
  extracted_importer_name VARCHAR(255) NOT NULL,
  extracted_stamp_date DATE NOT NULL,
  raw_verification_confidence NUMERIC(4, 3) NOT NULL
);

-- ============================================================================
-- 3. SOVEREIGN ACTION AUDIT SYSTEMS
-- ============================================================================

-- Administrative System Overrides (Manual clears, odometer overrides, etc.)
CREATE TABLE IF NOT EXISTS administrative_overrides (
  id BIGSERIAL PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  target_vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
  override_action VARCHAR(100) NOT NULL,
  justification TEXT NOT NULL,
  previous_state JSONB NOT NULL,
  new_state JSONB NOT NULL,
  cryptographic_seal VARCHAR(128) NOT NULL,
  ip_address VARCHAR(45) NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance scale
CREATE INDEX IF NOT EXISTS idx_zimra_vin ON zimra_declarations(vin);
CREATE INDEX IF NOT EXISTS idx_cvr_vin ON cvr_ownership_records(vin);
CREATE INDEX IF NOT EXISTS idx_vid_vin ON vid_inspections(vin);
CREATE INDEX IF NOT EXISTS idx_cid_vin ON cid_clearance_records(vin);
CREATE INDEX IF NOT EXISTS idx_zinara_vin ON zinara_licensing_records(vin);
CREATE INDEX IF NOT EXISTS idx_ocr_nid_ref ON ocr_national_ids(ocr_document_id);
CREATE INDEX IF NOT EXISTS idx_ocr_regbook_ref ON ocr_registration_books(ocr_document_id);
CREATE INDEX IF NOT EXISTS idx_ocr_customs_ref ON ocr_customs_declarations(ocr_document_id);

-- Enforce ledger overrides immutability triggers
CREATE OR REPLACE FUNCTION prevent_override_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'SECURITY ALERT: Mutating administrative override records is strictly forbidden!';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_override_update ON administrative_overrides;
CREATE TRIGGER trg_prevent_override_update
BEFORE UPDATE ON administrative_overrides
FOR EACH ROW EXECUTE FUNCTION prevent_override_mutation();

DROP TRIGGER IF EXISTS trg_prevent_override_delete ON administrative_overrides;
CREATE TRIGGER trg_prevent_override_delete
BEFORE DELETE ON administrative_overrides
FOR EACH ROW EXECUTE FUNCTION prevent_override_mutation();
`;

async function deploySchemas() {
  try {
    await client.connect();
    console.log('📡 Connected successfully to Supabase PostgreSQL Database.');
    
    console.log('🤖 Creating missing national vehicle trust registries, structured OCR schemas, and override audits...');
    await client.query(sql);
    console.log('✅ ALL TRUST AND REGISTRY SCHEMAS DEPLOYED SUCCESSFULLY TO POSTGRES.');
  } catch (err) {
    console.error('❌ Database schema deployment failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

deploySchemas();
