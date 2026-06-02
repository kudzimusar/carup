-- +migrate Up

-- 1. Create public_keys table for ECDSA validation
CREATE TABLE IF NOT EXISTS public_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  public_key_pem TEXT NOT NULL,
  key_type TEXT DEFAULT 'secp256k1',
  status TEXT DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'REVOKED')),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 2. Create signature_verification_logs table
CREATE TABLE IF NOT EXISTS signature_verification_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payload_hash TEXT NOT NULL,
  signature TEXT NOT NULL,
  public_key_id TEXT NOT NULL,
  verified INTEGER DEFAULT 1,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (public_key_id) REFERENCES public_keys(id)
);

-- 3. Decouple vehicle listings from permanent vehicle entries
CREATE TABLE IF NOT EXISTS vehicle_listings (
  id TEXT PRIMARY KEY,
  vin TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  asking_price_cents INTEGER NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'RESERVED', 'SOLD', 'EXPIRED', 'FLAGGED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (vin) REFERENCES vehicles(vin) ON DELETE CASCADE,
  FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 4. Decouple listing images to prevent SQLite page bloat (No Base64 strings in DB!)
CREATE TABLE IF NOT EXISTS listing_images (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  image_url TEXT NOT NULL,
  is_primary INTEGER DEFAULT 0 CHECK(is_primary IN (0, 1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (listing_id) REFERENCES vehicle_listings(id) ON DELETE CASCADE
);

-- 5. Create persistent stolen_vehicles table (de-volatilizing registry)
CREATE TABLE IF NOT EXISTS stolen_vehicles (
  vin TEXT PRIMARY KEY,
  police_report_number TEXT NOT NULL UNIQUE,
  reporting_owner_id TEXT NOT NULL,
  status TEXT DEFAULT 'ACTIVE_POLICE_ALERT' CHECK(status IN ('ACTIVE_POLICE_ALERT', 'RECOVERED')),
  created_at TEXT NOT NULL,
  cleared_at TEXT,
  cleared_by TEXT,
  FOREIGN KEY (vin) REFERENCES vehicles(vin) ON DELETE CASCADE,
  FOREIGN KEY (reporting_owner_id) REFERENCES users(id)
);

-- 6. Create trust score mutation history
CREATE TABLE IF NOT EXISTS trust_score_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('VEHICLE', 'STAKEHOLDER', 'ORGANIZATION')),
  entity_id TEXT NOT NULL,
  previous_score REAL NOT NULL,
  new_score REAL NOT NULL,
  trigger_event TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

-- 7. Create AI fraud scan persistence
CREATE TABLE IF NOT EXISTS ai_fraud_scans (
  id TEXT PRIMARY KEY,
  vin TEXT NOT NULL,
  model_version TEXT NOT NULL,
  risk_score REAL NOT NULL,
  risk_rating TEXT NOT NULL CHECK(risk_rating IN ('Low', 'Medium', 'High', 'Critical')),
  reasons_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  is_flagged INTEGER DEFAULT 0,
  moderation_status TEXT DEFAULT 'None' CHECK(moderation_status IN ('None', 'Pending_Review', 'Cleared', 'Blocked')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (vin) REFERENCES vehicles(vin) ON DELETE CASCADE
);

-- 8. Create OCR documents persistence table
CREATE TABLE IF NOT EXISTS ocr_documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  document_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  extracted_json TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  status TEXT DEFAULT 'Pending_Verification' CHECK(status IN ('Pending_Verification', 'Verified', 'OCR_Provider_Unavailable', 'Low_Confidence', 'Poor_Image_Quality', 'Suspected_Tampering', 'Pending_Manual_Review')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 9. Create AI inference logs table
CREATE TABLE IF NOT EXISTS ai_inference_logs (
  id TEXT PRIMARY KEY,
  model_name TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  latency_ms INTEGER,
  prompt TEXT NOT NULL,
  output TEXT NOT NULL,
  hallucination_flag INTEGER DEFAULT 0,
  timestamp TEXT NOT NULL
);

-- 10. Create sovereign global system audit logs
CREATE TABLE IF NOT EXISTS system_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT NOT NULL,
  action_type TEXT NOT NULL, -- 'ROLE_MUTATION', 'POLICE_OVERRIDE', 'ESCROW_FORCED_RELEASE'
  target_resource TEXT NOT NULL,
  details_json TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT
);

-- 11. Create performance telemetry log
CREATE TABLE IF NOT EXISTS performance_telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric_name TEXT NOT NULL, -- 'slow_query', 'cpu_peak', 'api_latency'
  value REAL NOT NULL,
  context_details TEXT,
  timestamp TEXT NOT NULL
);

-- 12. Create system failures logger
CREATE TABLE IF NOT EXISTS system_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  error_message TEXT NOT NULL,
  stack_trace TEXT,
  severity TEXT CHECK(severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  timestamp TEXT NOT NULL
);

-- 12b. Create rolling integrity checkpoints table for performance optimization
CREATE TABLE IF NOT EXISTS rolling_integrity_checkpoints (
  vin TEXT PRIMARY KEY,
  last_verified_event_id INTEGER NOT NULL,
  rolling_hash TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  FOREIGN KEY (vin) REFERENCES vehicles(vin) ON DELETE CASCADE
);

-- 13. Create high performance compound indexes
CREATE INDEX IF NOT EXISTS idx_public_keys_user ON public_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_listings_search ON vehicle_listings(status, asking_price_cents);
CREATE INDEX IF NOT EXISTS idx_listings_vin ON vehicle_listings(vin);
CREATE INDEX IF NOT EXISTS idx_listing_images_ref ON listing_images(listing_id);
CREATE INDEX IF NOT EXISTS idx_stolen_status ON stolen_vehicles(status);
CREATE INDEX IF NOT EXISTS idx_trust_history_ref ON trust_score_history(entity_id);
CREATE INDEX IF NOT EXISTS idx_ai_scans_vin ON ai_fraud_scans(vin);
CREATE INDEX IF NOT EXISTS idx_ocr_user ON ocr_documents(user_id);

-- 14. Establish immutable TRIGGERS to prevent tampering at database engine level
CREATE TRIGGER IF NOT EXISTS prevent_blockchain_events_update
BEFORE UPDATE ON blockchain_events
BEGIN
  SELECT RAISE(FAIL, 'CRITICAL SECURITY VIOLATION: Mutating historical blockchain ledger is strictly forbidden!');
END;

CREATE TRIGGER IF NOT EXISTS prevent_blockchain_events_delete
BEFORE DELETE ON blockchain_events
BEGIN
  SELECT RAISE(FAIL, 'CRITICAL SECURITY VIOLATION: Deleting records from the historical blockchain ledger is strictly forbidden!');
END;

CREATE TRIGGER IF NOT EXISTS prevent_partsentry_update
BEFORE UPDATE ON partsentry_logs
BEGIN
  SELECT RAISE(FAIL, 'CRITICAL SECURITY VIOLATION: Modifying service logs is strictly forbidden!');
END;

CREATE TRIGGER IF NOT EXISTS prevent_partsentry_delete
BEFORE DELETE ON partsentry_logs
BEGIN
  SELECT RAISE(FAIL, 'CRITICAL SECURITY VIOLATION: Deleting service logs is strictly forbidden!');
END;

CREATE TRIGGER IF NOT EXISTS prevent_ocr_documents_update
BEFORE UPDATE ON ocr_documents
BEGIN
  SELECT RAISE(FAIL, 'CRITICAL SECURITY VIOLATION: Mutating processed OCR documents is strictly forbidden!');
END;

CREATE TRIGGER IF NOT EXISTS prevent_ocr_documents_delete
BEFORE DELETE ON ocr_documents
BEGIN
  SELECT RAISE(FAIL, 'CRITICAL SECURITY VIOLATION: Deleting processed OCR documents is strictly forbidden!');
END;

CREATE TRIGGER IF NOT EXISTS prevent_financial_ledger_update
BEFORE UPDATE ON financial_ledger
BEGIN
  SELECT RAISE(FAIL, 'CRITICAL SECURITY VIOLATION: Mutating transactional ledger entries is strictly forbidden!');
END;

CREATE TRIGGER IF NOT EXISTS prevent_financial_ledger_delete
BEFORE DELETE ON financial_ledger
BEGIN
  SELECT RAISE(FAIL, 'CRITICAL SECURITY VIOLATION: Deleting transactional ledger entries is strictly forbidden!');
END;

-- +migrate Down
DROP TRIGGER IF EXISTS prevent_financial_ledger_delete;
DROP TRIGGER IF EXISTS prevent_financial_ledger_update;
DROP TRIGGER IF EXISTS prevent_ocr_documents_delete;
DROP TRIGGER IF EXISTS prevent_ocr_documents_update;
DROP TRIGGER IF EXISTS prevent_partsentry_delete;
DROP TRIGGER IF EXISTS prevent_partsentry_update;
DROP TRIGGER IF EXISTS prevent_blockchain_events_delete;
DROP TRIGGER IF EXISTS prevent_blockchain_events_update;

DROP TABLE IF EXISTS system_failures;
DROP TABLE IF EXISTS rolling_integrity_checkpoints;
DROP TABLE IF EXISTS performance_telemetry;
DROP TABLE IF EXISTS system_audit_logs;
DROP TABLE IF EXISTS ai_inference_logs;
DROP TABLE IF EXISTS ocr_documents;
DROP TABLE IF EXISTS ai_fraud_scans;
DROP TABLE IF EXISTS trust_score_history;
DROP TABLE IF EXISTS stolen_vehicles;
DROP TABLE IF EXISTS listing_images;
DROP TABLE IF EXISTS vehicle_listings;
DROP TABLE IF EXISTS signature_verification_logs;
DROP TABLE IF EXISTS public_keys;
