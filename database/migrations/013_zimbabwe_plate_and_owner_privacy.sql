-- +migrate Up

-- Alter vehicles table to add plate and identity fields
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS plate_number TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS normalized_plate_number TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS plate_status TEXT DEFAULT 'Active';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS chassis_number TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS engine_number TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS registration_status TEXT DEFAULT 'Current';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS registration_country TEXT DEFAULT 'ZW';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS registration_authority TEXT DEFAULT 'CVR';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS temporary_identification_number TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS plate_verified_at TIMESTAMPTZ;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS plate_verification_source TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS current_seller_id TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS current_seller_type TEXT DEFAULT 'Private Owner';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS public_seller_display_enabled BOOLEAN DEFAULT false;

-- Create vehicle_plate_history table
CREATE TABLE IF NOT EXISTS vehicle_plate_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id TEXT REFERENCES vehicles(vin) ON DELETE CASCADE,
  vin TEXT REFERENCES vehicles(vin) ON DELETE CASCADE,
  plate_number VARCHAR(20) NOT NULL,
  normalized_plate_number VARCHAR(20) NOT NULL,
  plate_type VARCHAR(50) NOT NULL CHECK (plate_type IN ('permanent', 'temporary', 'dealer', 'diplomatic', 'government', 'unknown')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'previous', 'pending', 'flagged', 'suspended', 'expired')),
  is_current BOOLEAN DEFAULT true,
  issued_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  verification_source TEXT,
  source_reference TEXT,
  reason TEXT,
  record_visibility VARCHAR(20) DEFAULT 'public' CHECK (record_visibility IN ('public', 'private', 'restricted')),
  created_by TEXT,
  verified_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for lookup optimization
CREATE INDEX IF NOT EXISTS idx_vehicles_normalized_plate ON vehicles(normalized_plate_number);
CREATE INDEX IF NOT EXISTS idx_vehicles_chassis ON vehicles(chassis_number);
CREATE INDEX IF NOT EXISTS idx_vehicle_plate_history_vin ON vehicle_plate_history(vin);
CREATE INDEX IF NOT EXISTS idx_vehicle_plate_history_normalized ON vehicle_plate_history(normalized_plate_number);
