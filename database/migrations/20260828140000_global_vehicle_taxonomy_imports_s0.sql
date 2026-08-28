-- +migrate Up
-- S0 global taxonomy projection for Diaspora/Imports. Raw requested values remain intact.
ALTER TABLE IF EXISTS diaspora_import_orders
  ADD COLUMN IF NOT EXISTS requested_make_taxon_id TEXT,
  ADD COLUMN IF NOT EXISTS requested_model_taxon_id TEXT,
  ADD COLUMN IF NOT EXISTS taxonomy_version TEXT,
  ADD COLUMN IF NOT EXISTS taxonomy_resolution JSONB,
  ADD COLUMN IF NOT EXISTS taxonomy_source_values JSONB,
  ADD COLUMN IF NOT EXISTS taxonomized_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_diaspora_import_orders_make_taxon
  ON diaspora_import_orders(requested_make_taxon_id);
CREATE INDEX IF NOT EXISTS idx_diaspora_import_orders_model_taxon
  ON diaspora_import_orders(requested_model_taxon_id);

-- +migrate Down
DROP INDEX IF EXISTS idx_diaspora_import_orders_model_taxon;
DROP INDEX IF EXISTS idx_diaspora_import_orders_make_taxon;
ALTER TABLE IF EXISTS diaspora_import_orders
  DROP COLUMN IF EXISTS taxonomized_at,
  DROP COLUMN IF EXISTS taxonomy_source_values,
  DROP COLUMN IF EXISTS taxonomy_resolution,
  DROP COLUMN IF EXISTS taxonomy_version,
  DROP COLUMN IF EXISTS requested_model_taxon_id,
  DROP COLUMN IF EXISTS requested_make_taxon_id;
