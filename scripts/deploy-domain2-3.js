import pg from 'pg';

const connectionString = 'postgresql://postgres.vhmnajoeicasaigiophh:[ROTATED-SEE-CR1]@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';

const client = new pg.Client({
  connectionString,
});

const sql = `
-- =============================================================
-- CarUp OS — Tables for Domain 2 & 3 (PostgreSQL)
-- =============================================================

CREATE TABLE IF NOT EXISTS vehicle_telemetry (
  id BIGSERIAL PRIMARY KEY,
  vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
  speed REAL,
  fuel_level REAL,
  engine_temp REAL,
  mileage INTEGER,
  timestamp TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS insurance_claims (
  id TEXT PRIMARY KEY,
  policyholder TEXT NOT NULL,
  amount REAL NOT NULL,
  vehicle TEXT NOT NULL,
  type TEXT NOT NULL,
  policy TEXT NOT NULL,
  date TEXT NOT NULL,
  assigned TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'under-review', 'approved', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fraud_alerts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'under-investigation', 'resolved')),
  description TEXT,
  vehicle TEXT,
  policyholder TEXT,
  date TEXT NOT NULL,
  resolved_at TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS compliance_reports (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('generated', 'pending')),
  type TEXT NOT NULL,
  date TEXT NOT NULL,
  size TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS registry_verifications (
  id TEXT PRIMARY KEY,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  registration TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('verified', 'pending', 'failed')),
  vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
  owner TEXT NOT NULL,
  type TEXT NOT NULL,
  date TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS server_health (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Operational',
  accuracy INTEGER NOT NULL DEFAULT 95,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- Row Level Security enabling for sovereign-grade standard compliance
-- =============================================================
ALTER TABLE vehicle_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE fraud_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE registry_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE server_health ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- Seed Data
-- =============================================================

-- Telemetry
INSERT INTO vehicle_telemetry (vin, speed, fuel_level, engine_temp, mileage, timestamp)
VALUES
  ('VIN74329849204928', 0.0, 78.5, 90.0, 48500, '2026-05-27T12:00:00Z'),
  ('VIN89230489201948', 65.2, 45.0, 92.5, 72000, '2026-05-27T12:00:00Z'),
  ('VIN38492049281048', 12.0, 92.0, 88.0, 112000, '2026-05-27T12:00:00Z')
ON CONFLICT DO NOTHING;

-- Claims
INSERT INTO insurance_claims (id, policyholder, amount, vehicle, type, policy, date, assigned, status)
VALUES
  ('CLM-9032-X', 'Tendai Moyo', 1250.00, 'Toyota Hilux (VIN74329849204928)', 'Windshield damage', 'POL-743298', '2026-05-25', 'R. Ndlovu', 'pending'),
  ('CLM-4892-Z', 'Croco Motors', 500.00, 'Mercedes C200 (VIN89230489201948)', 'Scratch repair', 'POL-892304', '2026-05-24', 'E. Sibanda', 'under-review'),
  ('CLM-1049-A', 'Simbisa Garages', 3500.00, 'Mazda Demio (VIN38492049281048)', 'Collision damage', 'POL-384920', '2026-05-20', 'M. Khumalo', 'approved')
ON CONFLICT (id) DO NOTHING;

-- Fraud Alerts
INSERT INTO fraud_alerts (id, type, severity, status, description, vehicle, policyholder, date)
VALUES
  ('FRD-990-A', 'Odometer Rollback', 'high', 'open', 'Significant mileage drop detected (from 98,000 km to 75,000 km) during CVR registration scan.', 'Mazda Demio', 'Tendai Moyo', '2026-05-26'),
  ('FRD-122-C', 'Multiple Claims', 'medium', 'under-investigation', 'Owner u1 registered three collision claims across two separate insurance policies in the last 45 days.', 'Toyota Hilux', 'Tendai Moyo', '2026-05-24'),
  ('FRD-452-D', 'VIN Mismatch', 'high', 'open', 'The physical VIN stamp scanned via OCR does not match ZIMRA import registry records.', 'Mercedes C200', 'Croco Motors', '2026-05-27')
ON CONFLICT (id) DO NOTHING;

-- Compliance Reports
INSERT INTO compliance_reports (id, title, status, type, date, size)
VALUES
  ('REP-001', 'Q1 ZIMRA Import Declarations Audit', 'generated', 'ZIMRA_DECLARATION', '2026-05-20', '2.4 MB'),
  ('REP-002', 'Active Stolen Vehicles CVR Sync Report', 'generated', 'POLICE_CLEARANCE', '2026-05-25', '1.8 MB'),
  ('REP-003', 'Failed Odometer Fraud Alert Summary', 'pending', 'INSPECTION', '2026-05-27', NULL)
ON CONFLICT (id) DO NOTHING;

-- Registry Verifications
INSERT INTO registry_verifications (id, make, model, registration, status, vin, owner, type, date)
VALUES
  ('VRF-920-K', 'Toyota', 'Hilux', 'AGE-9203-ZW', 'verified', 'VIN74329849204928', 'Tendai Moyo', 'Import Declaration', '2026-05-26'),
  ('VRF-110-B', 'Mercedes-Benz', 'C-Class', 'BCH-1092-ZW', 'pending', 'VIN89230489201948', 'Croco Motors', 'Registration', '2026-05-27'),
  ('VRF-384-M', 'Mazda', 'Demio', 'ADM-3849-ZW', 'verified', 'VIN38492049281048', 'Simbisa Garages', 'Inspection', '2026-05-25')
ON CONFLICT (id) DO NOTHING;

-- Server Health
INSERT INTO server_health (name, status, accuracy)
VALUES
  ('Gutu AI Core (secp256k1 signature parsing)', 'Operational', 99),
  ('Gemini Multi-Agent Orchestrator Route Processor', 'Operational', 97),
  ('ZIMRA Custom Duty Estimator Model', 'Operational', 96),
  ('Odometer progressive rollback audit logic', 'Operational', 98)
ON CONFLICT DO NOTHING;
`;

async function deploySchema() {
  try {
    await client.connect();
    console.log('📡 Connected successfully to Supabase PostgreSQL Database.');
    console.log('🤖 Creating missing tables for Domain 2 & 3 & seeding...');
    await client.query(sql);
    console.log('✅ ALL DOMAIN 2 & 3 TABLES CREATED AND SEEDED SUCCESSFULLY.');
  } catch (err) {
    console.error('❌ Database schema deployment failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

deploySchema();
