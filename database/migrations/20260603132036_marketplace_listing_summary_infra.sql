-- +migrate Up

ALTER TABLE IF EXISTS vehicles
  ADD COLUMN IF NOT EXISTS vehicle_condition_category TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS passport_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS passport_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS passport_verification_source TEXT,
  ADD COLUMN IF NOT EXISTS zimra_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS zimra_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS safe_pay_ready BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS inspection_ready BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS vehicles
  DROP CONSTRAINT IF EXISTS vehicles_vehicle_condition_category_check;

ALTER TABLE IF EXISTS vehicles
  ADD CONSTRAINT vehicles_vehicle_condition_category_check
  CHECK (vehicle_condition_category IN (
    'brand_new',
    'recently_imported',
    'locally_used',
    'second_hand',
    'certified_dealer',
    'unknown'
  ));

ALTER TABLE IF EXISTS partsentry_logs
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS part_verification_status TEXT NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS suspicion_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS public_card_eligible BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS partsentry_logs
  DROP CONSTRAINT IF EXISTS partsentry_logs_verification_status_check;

ALTER TABLE IF EXISTS partsentry_logs
  ADD CONSTRAINT partsentry_logs_verification_status_check
  CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected', 'disputed'));

ALTER TABLE IF EXISTS partsentry_logs
  DROP CONSTRAINT IF EXISTS partsentry_logs_part_verification_status_check;

ALTER TABLE IF EXISTS partsentry_logs
  ADD CONSTRAINT partsentry_logs_part_verification_status_check
  CHECK (part_verification_status IN ('unverified', 'pending', 'verified', 'rejected', 'disputed'));

ALTER TABLE IF EXISTS partsentry_logs
  DROP CONSTRAINT IF EXISTS partsentry_logs_suspicion_status_check;

ALTER TABLE IF EXISTS partsentry_logs
  ADD CONSTRAINT partsentry_logs_suspicion_status_check
  CHECK (suspicion_status IN ('none', 'watch', 'flagged', 'cleared'));

ALTER TABLE IF EXISTS listing_images
  ADD COLUMN IF NOT EXISTS vin TEXT REFERENCES vehicles(vin) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS vehicle_listing_summaries (
  vin TEXT PRIMARY KEY REFERENCES vehicles(vin) ON DELETE CASCADE,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER NOT NULL,
  price NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  mileage INTEGER NOT NULL DEFAULT 0,
  fuel_type TEXT,
  transmission TEXT,
  status TEXT NOT NULL,
  condition_category TEXT NOT NULL DEFAULT 'unknown' CHECK (condition_category IN (
    'brand_new',
    'recently_imported',
    'locally_used',
    'second_hand',
    'certified_dealer',
    'unknown'
  )),
  marketplace_tags TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  trust_score NUMERIC NOT NULL DEFAULT 0,
  primary_image_url TEXT,
  plate_number TEXT,
  normalized_plate_number TEXT,
  chassis_number TEXT,
  plate_verified BOOLEAN NOT NULL DEFAULT false,
  plate_status TEXT,
  passport_verified BOOLEAN NOT NULL DEFAULT false,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  partsentry_checked BOOLEAN NOT NULL DEFAULT false,
  repair_history_count INTEGER NOT NULL DEFAULT 0,
  verified_parts_count INTEGER NOT NULL DEFAULT 0,
  duty_cleared BOOLEAN NOT NULL DEFAULT false,
  zimra_verified BOOLEAN NOT NULL DEFAULT false,
  cid_clear BOOLEAN NOT NULL DEFAULT false,
  seller_type TEXT NOT NULL DEFAULT 'private',
  seller_display_label TEXT NOT NULL DEFAULT 'Private seller',
  seller_public_profile_enabled BOOLEAN NOT NULL DEFAULT false,
  search_vector TSVECTOR,
  source_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicles_marketplace_condition
  ON vehicles(vehicle_condition_category);

CREATE INDEX IF NOT EXISTS idx_vehicles_marketplace_flags
  ON vehicles(passport_verified, zimra_verified, safe_pay_ready, inspection_ready);

CREATE INDEX IF NOT EXISTS idx_partsentry_logs_public_summary
  ON partsentry_logs(vin, verification_status, part_verification_status, public_card_eligible);

CREATE INDEX IF NOT EXISTS idx_listing_images_vin_primary
  ON listing_images(vin, is_primary, display_order);

CREATE INDEX IF NOT EXISTS idx_vehicle_listing_summaries_condition
  ON vehicle_listing_summaries(condition_category);

CREATE INDEX IF NOT EXISTS idx_vehicle_listing_summaries_tags
  ON vehicle_listing_summaries USING GIN (marketplace_tags);

CREATE INDEX IF NOT EXISTS idx_vehicle_listing_summaries_search
  ON vehicle_listing_summaries USING GIN (search_vector);

ALTER TABLE IF EXISTS vehicle_listing_summaries ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE vehicle_listing_summaries TO anon;
GRANT SELECT ON TABLE vehicle_listing_summaries TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE vehicle_listing_summaries TO authenticated;

DROP POLICY IF EXISTS "vehicle listing summaries public read" ON vehicle_listing_summaries;
CREATE POLICY "vehicle listing summaries public read"
ON vehicle_listing_summaries
FOR SELECT
TO anon, authenticated
USING (status IN ('Available', 'Reserved', 'available', 'reserved', 'ACTIVE', 'RESERVED'));

-- +migrate Down

DROP POLICY IF EXISTS "vehicle listing summaries public read" ON vehicle_listing_summaries;

DROP INDEX IF EXISTS idx_vehicle_listing_summaries_search;
DROP INDEX IF EXISTS idx_vehicle_listing_summaries_tags;
DROP INDEX IF EXISTS idx_vehicle_listing_summaries_condition;
DROP INDEX IF EXISTS idx_listing_images_vin_primary;
DROP INDEX IF EXISTS idx_partsentry_logs_public_summary;
DROP INDEX IF EXISTS idx_vehicles_marketplace_flags;
DROP INDEX IF EXISTS idx_vehicles_marketplace_condition;

DROP TABLE IF EXISTS vehicle_listing_summaries;

ALTER TABLE IF EXISTS listing_images
  DROP COLUMN IF EXISTS display_order,
  DROP COLUMN IF EXISTS vin;

ALTER TABLE IF EXISTS partsentry_logs
  DROP CONSTRAINT IF EXISTS partsentry_logs_suspicion_status_check,
  DROP CONSTRAINT IF EXISTS partsentry_logs_part_verification_status_check,
  DROP CONSTRAINT IF EXISTS partsentry_logs_verification_status_check,
  DROP COLUMN IF EXISTS public_card_eligible,
  DROP COLUMN IF EXISTS suspicion_status,
  DROP COLUMN IF EXISTS part_verification_status,
  DROP COLUMN IF EXISTS verification_status;

ALTER TABLE IF EXISTS vehicles
  DROP CONSTRAINT IF EXISTS vehicles_vehicle_condition_category_check,
  DROP COLUMN IF EXISTS inspection_ready,
  DROP COLUMN IF EXISTS safe_pay_ready,
  DROP COLUMN IF EXISTS zimra_verified_at,
  DROP COLUMN IF EXISTS zimra_verified,
  DROP COLUMN IF EXISTS passport_verification_source,
  DROP COLUMN IF EXISTS passport_verified_at,
  DROP COLUMN IF EXISTS passport_verified,
  DROP COLUMN IF EXISTS vehicle_condition_category;
