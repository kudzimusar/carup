-- +migrate Up

ALTER TABLE IF EXISTS vehicle_evidence
  ADD COLUMN IF NOT EXISTS event_type TEXT,
  ADD COLUMN IF NOT EXISTS linked_registry_event_id TEXT,
  ADD COLUMN IF NOT EXISTS trust_score_impact NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checksum TEXT;

UPDATE vehicle_evidence
SET
  linked_registry_event_id = COALESCE(linked_registry_event_id, timeline_event_id),
  event_type = COALESCE(event_type, event_source, evidence_type),
  trust_score_impact = COALESCE(trust_score_impact, trust_impact, 0),
  checksum = COALESCE(checksum, image_hash)
WHERE linked_registry_event_id IS NULL
   OR event_type IS NULL
   OR checksum IS NULL
   OR trust_score_impact IS NULL;

ALTER TABLE IF EXISTS vehicle_evidence
  ALTER COLUMN event_type SET NOT NULL,
  ALTER COLUMN trust_score_impact SET NOT NULL,
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;

ALTER TABLE IF EXISTS vehicle_evidence
  DROP CONSTRAINT IF EXISTS vehicle_evidence_evidence_type_check;

ALTER TABLE IF EXISTS vehicle_evidence
  ADD CONSTRAINT vehicle_evidence_evidence_type_check
  CHECK (evidence_type IN (
    'import_photo',
    'auction_photo',
    'customs_photo',
    'inspection_photo',
    'odometer_photo',
    'damage_photo',
    'repair_photo',
    'dealer_listing_photo',
    'owner_handover_photo',
    'registration_document',
    'insurance_document',
    'police_clearance_document',
    'ownership_transfer_document'
  ));

CREATE INDEX IF NOT EXISTS idx_vehicle_evidence_linked_registry_event
  ON vehicle_evidence(linked_registry_event_id);

CREATE INDEX IF NOT EXISTS idx_vehicle_evidence_status_uploaded
  ON vehicle_evidence(verification_status, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_vehicle_evidence_public_timeline
  ON vehicle_evidence(vin, captured_at)
  WHERE visibility_level = 'public_safe' AND verification_status = 'verified';

ALTER TABLE IF EXISTS vehicle_evidence ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON TABLE vehicle_evidence TO authenticated;
GRANT SELECT ON TABLE vehicle_evidence TO anon;

DROP POLICY IF EXISTS "vehicle evidence public verified read" ON vehicle_evidence;
CREATE POLICY "vehicle evidence public verified read"
ON vehicle_evidence
FOR SELECT
TO anon
USING (visibility_level = 'public_safe' AND verification_status = 'verified');

DROP POLICY IF EXISTS "vehicle evidence authenticated read" ON vehicle_evidence;
CREATE POLICY "vehicle evidence authenticated read"
ON vehicle_evidence
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "vehicle evidence authenticated insert" ON vehicle_evidence;
CREATE POLICY "vehicle evidence authenticated insert"
ON vehicle_evidence
FOR INSERT
TO authenticated
WITH CHECK (uploaded_by = (select auth.uid())::text);

DROP POLICY IF EXISTS "vehicle evidence authenticated update own pending" ON vehicle_evidence;
CREATE POLICY "vehicle evidence authenticated update own pending"
ON vehicle_evidence
FOR UPDATE
TO authenticated
USING (uploaded_by = (select auth.uid())::text AND verification_status = 'pending')
WITH CHECK (uploaded_by = (select auth.uid())::text);

-- +migrate Down

DROP POLICY IF EXISTS "vehicle evidence authenticated update own pending" ON vehicle_evidence;
DROP POLICY IF EXISTS "vehicle evidence authenticated insert" ON vehicle_evidence;
DROP POLICY IF EXISTS "vehicle evidence authenticated read" ON vehicle_evidence;
DROP POLICY IF EXISTS "vehicle evidence public verified read" ON vehicle_evidence;

DROP INDEX IF EXISTS idx_vehicle_evidence_public_timeline;
DROP INDEX IF EXISTS idx_vehicle_evidence_status_uploaded;
DROP INDEX IF EXISTS idx_vehicle_evidence_linked_registry_event;

ALTER TABLE IF EXISTS vehicle_evidence
  DROP COLUMN IF EXISTS checksum,
  DROP COLUMN IF EXISTS trust_score_impact,
  DROP COLUMN IF EXISTS linked_registry_event_id,
  DROP COLUMN IF EXISTS event_type;
