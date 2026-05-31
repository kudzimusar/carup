-- +migrate Up
CREATE TABLE IF NOT EXISTS insurance_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id TEXT NOT NULL,
  vin TEXT NOT NULL,
  user_id TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT DEFAULT 'Pending Review', -- 'Pending Review', 'Approved', 'Rejected'
  description TEXT,
  incident_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fraud_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin TEXT NOT NULL,
  alert_type TEXT NOT NULL, -- e.g., 'Identity Mismatch', 'Odometer Tampering', 'High Risk Region'
  severity TEXT NOT NULL, -- 'High', 'Medium', 'Low'
  description TEXT,
  status TEXT DEFAULT 'Open', -- 'Open', 'Resolved'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS vehicle_telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  speed REAL,
  status TEXT DEFAULT 'Active', -- 'Active', 'Parked', 'Offline'
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed some initial data for testing
INSERT INTO fraud_alerts (vin, alert_type, severity, description, status)
VALUES 
  ('1HGCM82633A004XXX', 'Odometer Tampering', 'High', 'Blockchain mileage anomaly detected. Last recorded: 145,000 km, New entry: 80,000 km.', 'Open'),
  ('JTDKB20U43023XXXX', 'Identity Mismatch', 'Medium', 'KYC mismatch: Registered owner does not match the seller identity.', 'Open');

INSERT INTO insurance_claims (policy_id, vin, user_id, amount, status, description, incident_date)
VALUES 
  ('POL-2025-0192', '1HGCM82633A004XXX', 'u1', 2500.00, 'Pending Review', 'Front bumper collision at Samora Machel Ave.', NOW() - INTERVAL '2 days'),
  ('POL-2025-0844', 'JTDKB20U43023XXXX', 'u1', 850.00, 'Pending Review', 'Windshield cracked by flying debris.', NOW() - INTERVAL '5 days');

INSERT INTO vehicle_telemetry (vin, lat, lng, speed, status)
VALUES 
  ('1HGCM82633A004XXX', -17.824858, 31.053028, 45.2, 'Active'),
  ('JTDKB20U43023XXXX', -20.143890, 28.583330, 0, 'Parked');

-- +migrate Down
DROP TABLE IF EXISTS insurance_claims CASCADE;
DROP TABLE IF EXISTS fraud_alerts CASCADE;
DROP TABLE IF EXISTS vehicle_telemetry CASCADE;
