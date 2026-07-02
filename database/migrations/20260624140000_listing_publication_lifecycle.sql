-- +migrate Up
-- Phase 4 — Listing Publication Lifecycle
--
-- Adds publication_status to vehicles to track where in the CarUp publication
-- pipeline a vehicle sits. This is SEPARATE from:
--   • vehicles.status   (availability: AVAILABLE / SOLD / PENDING / INACTIVE)
--   • vehicle_listings.status  (marketplace contract: ACTIVE / RESERVED / SOLD / FLAGGED)
--
-- Lifecycle:
--   draft               → Vehicle registered; identity fields may be incomplete
--   identity_complete   → VIN, chassis, engine, plate all present
--   documents_submitted → At least one ownership document uploaded (pending review)
--   review_pending      → Documents submitted; awaiting human reviewer decision
--   publishable         → All blocking requirements met and verified
--   published           → Listing is live on the marketplace

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS publication_status TEXT
  NOT NULL DEFAULT 'draft'
  CHECK(publication_status IN (
    'draft',
    'identity_complete',
    'documents_submitted',
    'review_pending',
    'publishable',
    'published'
  ));

-- Temporary plate identifier for imported vehicles awaiting local registration
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS temp_plate_id TEXT;

-- Index to support completeness dashboard and publication gate queries
CREATE INDEX IF NOT EXISTS idx_vehicles_publication_status
  ON vehicles(publication_status);

CREATE INDEX IF NOT EXISTS idx_vehicles_temp_plate
  ON vehicles(temp_plate_id)
  WHERE temp_plate_id IS NOT NULL;

-- Backfill: vehicles with trust_score >= 70 were historically treated as verified;
-- promote them to 'publishable' so pre-migration inventory is not blocked.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'trust_score'
  ) THEN
    UPDATE vehicles
    SET publication_status = 'publishable'
    WHERE trust_score >= 70
      AND publication_status = 'draft';
  END IF;
END $$;

-- +migrate Down
ALTER TABLE vehicles DROP COLUMN IF EXISTS publication_status;
ALTER TABLE vehicles DROP COLUMN IF EXISTS temp_plate_id;
DROP INDEX IF EXISTS idx_vehicles_publication_status;
DROP INDEX IF EXISTS idx_vehicles_temp_plate;
