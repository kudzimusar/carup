import pg from 'pg';

const connectionString = (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL);

const client = new pg.Client({
  connectionString,
});

const sql = `
-- =============================================================
-- CarUp OS — Database Hardening Tables for Supabase (PostgreSQL)
-- =============================================================

-- 1. Public Keys Table for secp256k1 cryptographic signatures
CREATE TABLE IF NOT EXISTS public_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key_pem TEXT NOT NULL,
  private_key_pem TEXT,
  key_type TEXT DEFAULT 'secp256k1',
  status TEXT DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'REVOKED')),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

-- 2. Signature Verification Logs
CREATE TABLE IF NOT EXISTS signature_verification_logs (
  id BIGSERIAL PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  signature TEXT NOT NULL,
  public_key_id TEXT NOT NULL REFERENCES public_keys(id) ON DELETE CASCADE,
  verified INTEGER DEFAULT 1,
  timestamp TEXT NOT NULL
);

-- 3. Vehicle Listings Decoupled Table
CREATE TABLE IF NOT EXISTS vehicle_listings (
  id TEXT PRIMARY KEY,
  vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
  seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  asking_price_cents INTEGER NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'RESERVED', 'SOLD', 'EXPIRED', 'FLAGGED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 4. Listing Images (Base64 storage deprecation CDN paths)
CREATE TABLE IF NOT EXISTS listing_images (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES vehicle_listings(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  is_primary INTEGER DEFAULT 0 CHECK(is_primary IN (0, 1)),
  created_at TEXT NOT NULL
);

-- 5. Stolen Vehicles Police Alert Registry Table
CREATE TABLE IF NOT EXISTS stolen_vehicles (
  vin TEXT PRIMARY KEY REFERENCES vehicles(vin) ON DELETE CASCADE,
  police_report_number TEXT NOT NULL UNIQUE,
  reporting_owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'ACTIVE_POLICE_ALERT' CHECK(status IN ('ACTIVE_POLICE_ALERT', 'RECOVERED')),
  created_at TEXT NOT NULL,
  cleared_at TEXT,
  cleared_by TEXT
);

-- 6. Trust Score Mutation History Tracker Table
CREATE TABLE IF NOT EXISTS trust_score_history (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('VEHICLE', 'STAKEHOLDER', 'ORGANIZATION')),
  entity_id TEXT NOT NULL,
  previous_score REAL NOT NULL,
  new_score REAL NOT NULL,
  trigger_event TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

-- 7. AI Fraud Scan Traceability Persistence
CREATE TABLE IF NOT EXISTS ai_fraud_scans (
  id TEXT PRIMARY KEY,
  vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
  model_version TEXT NOT NULL,
  risk_score REAL NOT NULL,
  risk_rating TEXT NOT NULL CHECK(risk_rating IN ('Low', 'Medium', 'High', 'Critical')),
  reasons_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  is_flagged BOOLEAN DEFAULT FALSE,
  moderation_status TEXT DEFAULT 'None' CHECK(moderation_status IN ('None', 'Pending_Review', 'Cleared', 'Blocked')),
  created_at TEXT NOT NULL
);

-- 8. OCR Documents Extracted Data Cache
CREATE TABLE IF NOT EXISTS ocr_documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  extracted_json TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  status TEXT DEFAULT 'Pending_Verification' CHECK(status IN ('Pending_Verification', 'Verified', 'Flagged_Tampered')),
  created_at TEXT NOT NULL
);

-- 9. AI Inference Telemetry and Token Costs Logging
CREATE TABLE IF NOT EXISTS ai_inference_logs (
  id TEXT PRIMARY KEY,
  model_name TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  latency_ms INTEGER,
  prompt TEXT NOT NULL,
  output TEXT NOT NULL,
  hallucination_flag BOOLEAN DEFAULT FALSE,
  timestamp TEXT NOT NULL
);

-- 10. Sovereign Action System Audit Logs
CREATE TABLE IF NOT EXISTS system_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  target_resource TEXT NOT NULL,
  details_json TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT
);

-- 11. Performance Telemetry Metrics
CREATE TABLE IF NOT EXISTS performance_telemetry (
  id BIGSERIAL PRIMARY KEY,
  metric_name TEXT NOT NULL,
  value REAL NOT NULL,
  context_details TEXT,
  timestamp TEXT NOT NULL
);

-- 12. Failure Diagnostic Logging
CREATE TABLE IF NOT EXISTS system_failures (
  id BIGSERIAL PRIMARY KEY,
  error_message TEXT NOT NULL,
  stack_trace TEXT,
  severity TEXT CHECK(severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  timestamp TEXT NOT NULL
);

-- 13. Rolling Checkpoints for Ledger Verifications
CREATE TABLE IF NOT EXISTS rolling_integrity_checkpoints (
  vin TEXT PRIMARY KEY REFERENCES vehicles(vin) ON DELETE CASCADE,
  last_verified_event_id INTEGER NOT NULL,
  rolling_hash TEXT NOT NULL,
  verified_at TEXT NOT NULL
);

-- Index structures to ensure rapid queries and linear scalability
CREATE INDEX IF NOT EXISTS idx_public_keys_user ON public_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_listings_search ON vehicle_listings(status, asking_price_cents);
CREATE INDEX IF NOT EXISTS idx_listings_vin ON vehicle_listings(vin);
CREATE INDEX IF NOT EXISTS idx_listing_images_ref ON listing_images(listing_id);
CREATE INDEX IF NOT EXISTS idx_stolen_status ON stolen_vehicles(status);
CREATE INDEX IF NOT EXISTS idx_trust_history_ref ON trust_score_history(entity_id);
CREATE INDEX IF NOT EXISTS idx_ai_scans_vin ON ai_fraud_scans(vin);
CREATE INDEX IF NOT EXISTS idx_ocr_user ON ocr_documents(user_id);

-- Row Level Security enabling for sovereign-grade standard compliance
ALTER TABLE public_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE stolen_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_fraud_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_score_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_listings ENABLE ROW LEVEL SECURITY;
`;

async function deployHardeningSchema() {
  try {
    await client.connect();
    console.log('📡 Connected successfully to Supabase PostgreSQL Database.');
    
    console.log('🤖 Creating missing database hardening tables & indexes...');
    await client.query(sql);
    console.log('✅ ALL DATABASE HARDENING TABLES CONVERTED AND APPLIED SUCCESSFULLY.');
  } catch (err) {
    console.error('❌ Database schema deployment failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

deployHardeningSchema();
