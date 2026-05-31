-- +migrate Up
CREATE TABLE IF NOT EXISTS compliance_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  report_type TEXT NOT NULL, -- 'Tax', 'Import', 'Security', etc.
  generated_by TEXT NOT NULL,
  status TEXT DEFAULT 'Ready',
  url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS registry_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin TEXT NOT NULL,
  status TEXT NOT NULL, -- 'Verified', 'Flagged', 'Pending'
  checked_by TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS server_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_name TEXT NOT NULL,
  metric_value REAL NOT NULL,
  status TEXT NOT NULL, -- 'Healthy', 'Warning', 'Critical'
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed data
INSERT INTO compliance_reports (title, report_type, generated_by, url)
VALUES
  ('Q1 Import Duties & ZIMRA Remittances', 'Tax', 'u5', '/reports/q1_duties.pdf'),
  ('Vehicle Impound Registry Audit', 'Security', 'u5', '/reports/audit_2026.csv');

INSERT INTO registry_verifications (vin, status, checked_by, notes)
VALUES
  ('1HGCM82633A004XXX', 'Verified', 'u5', 'Interpol database cleared.'),
  ('JTDKB20U43023XXXX', 'Flagged', 'u5', 'Mismatch in engine number found on border entry.');

INSERT INTO server_health (metric_name, metric_value, status)
VALUES
  ('CPU Load', 34.5, 'Healthy'),
  ('Memory Usage', 68.2, 'Healthy'),
  ('Database Latency', 112.0, 'Warning');

-- +migrate Down
DROP TABLE IF EXISTS compliance_reports CASCADE;
DROP TABLE IF EXISTS registry_verifications CASCADE;
DROP TABLE IF EXISTS server_health CASCADE;
