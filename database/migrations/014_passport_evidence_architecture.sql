-- +migrate Up

CREATE TABLE IF NOT EXISTS vehicle_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
  vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
  plate_number TEXT,
  normalized_plate_number TEXT,
  chassis_number TEXT,
  engine_number TEXT,
  timeline_event_id TEXT, -- nullable, linked to stable timeline event IDs
  event_source TEXT, -- nullable
  event_type TEXT, -- nullable
  evidence_type TEXT NOT NULL, -- e.g. 'import_photo', 'registration_document'
  file_url TEXT NOT NULL,
  storage_bucket TEXT NOT NULL, -- 'vehicle-images' or 'ocr-documents'
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  image_hash TEXT,
  uploaded_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  uploader_role TEXT NOT NULL,
  tenant_id TEXT, -- nullable
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_name TEXT,
  source_reference TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected', 'disputed', 'superseded')),
  verification_notes TEXT,
  visibility_level TEXT NOT NULL DEFAULT 'public_safe' CHECK (visibility_level IN ('public_safe', 'restricted', 'private', 'government_only')),
  verified_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  trust_impact NUMERIC DEFAULT 0,
  confidence_impact NUMERIC DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_vehicle_evidence_vin ON vehicle_evidence(vin);
CREATE INDEX IF NOT EXISTS idx_vehicle_evidence_timeline ON vehicle_evidence(timeline_event_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_evidence_type ON vehicle_evidence(evidence_type);

-- +migrate Down
DROP INDEX IF EXISTS idx_vehicle_evidence_vin;
DROP INDEX IF EXISTS idx_vehicle_evidence_timeline;
DROP INDEX IF EXISTS idx_vehicle_evidence_type;
DROP TABLE IF EXISTS vehicle_evidence;
