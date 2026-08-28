-- +migrate Up
-- Seller Journey 1.0 / S0 — complete the global taxonomy reference set with colour.
ALTER TABLE IF EXISTS vehicles
  ADD COLUMN IF NOT EXISTS color_taxon_id TEXT;
CREATE INDEX IF NOT EXISTS idx_vehicles_color_taxon_id ON vehicles(color_taxon_id);

-- +migrate Down
DROP INDEX IF EXISTS idx_vehicles_color_taxon_id;
ALTER TABLE IF EXISTS vehicles DROP COLUMN IF EXISTS color_taxon_id;
