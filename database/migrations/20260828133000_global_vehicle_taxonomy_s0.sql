-- +migrate Up
-- Seller Journey 1.0 / S0 — Global Vehicle Taxonomy + canonical seller listing data.
-- Additive only: existing raw vehicle values are not rewritten or guessed.

ALTER TABLE IF EXISTS vehicles
  ADD COLUMN IF NOT EXISTS seller_description TEXT,
  ADD COLUMN IF NOT EXISTS seller_features TEXT[],
  ADD COLUMN IF NOT EXISTS body_style TEXT,
  ADD COLUMN IF NOT EXISTS seller_stated_condition TEXT,
  ADD COLUMN IF NOT EXISTS seller_listing_claim_source TEXT,
  ADD COLUMN IF NOT EXISTS seller_listing_recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS make_taxon_id TEXT,
  ADD COLUMN IF NOT EXISTS model_taxon_id TEXT,
  ADD COLUMN IF NOT EXISTS generation_taxon_id TEXT,
  ADD COLUMN IF NOT EXISTS trim_taxon_id TEXT,
  ADD COLUMN IF NOT EXISTS fuel_taxon_id TEXT,
  ADD COLUMN IF NOT EXISTS transmission_taxon_id TEXT,
  ADD COLUMN IF NOT EXISTS drivetrain_taxon_id TEXT,
  ADD COLUMN IF NOT EXISTS body_style_taxon_id TEXT,
  ADD COLUMN IF NOT EXISTS taxonomy_version TEXT,
  ADD COLUMN IF NOT EXISTS taxonomy_resolution JSONB,
  ADD COLUMN IF NOT EXISTS taxonomy_source_values JSONB,
  ADD COLUMN IF NOT EXISTS taxonomized_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_vehicles_make_taxon_id ON vehicles(make_taxon_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_model_taxon_id ON vehicles(model_taxon_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_body_style_taxon_id ON vehicles(body_style_taxon_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_fuel_taxon_id ON vehicles(fuel_taxon_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_transmission_taxon_id ON vehicles(transmission_taxon_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_drivetrain_taxon_id ON vehicles(drivetrain_taxon_id);

CREATE TABLE IF NOT EXISTS vehicle_taxonomy_observations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dimension TEXT NOT NULL CHECK (dimension IN (
    'make','model','generation','trim','year','body_style','fuel_type','transmission','drivetrain','color'
  )),
  raw_value TEXT NOT NULL,
  normalized_candidate TEXT,
  canonical_taxon_id TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('seller','import','dealer','partner','ingestion','evidence','admin')),
  source_reference TEXT,
  market TEXT,
  review_status TEXT NOT NULL DEFAULT 'unresolved'
    CHECK (review_status IN ('unresolved','auto_suggested','mapped','rejected','needs_research')),
  taxonomy_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vehicle_taxonomy_observations_review
  ON vehicle_taxonomy_observations(review_status, dimension, created_at);

-- Seller commercial facts are assertions: source/recorded_at must accompany any stored assertion.
ALTER TABLE IF EXISTS vehicles
  DROP CONSTRAINT IF EXISTS vehicles_seller_listing_claim_provenance_check;
ALTER TABLE IF EXISTS vehicles
  ADD CONSTRAINT vehicles_seller_listing_claim_provenance_check
  CHECK (
    (
      seller_description IS NULL
      AND seller_features IS NULL
      AND body_style IS NULL
      AND seller_stated_condition IS NULL
    )
    OR (
      seller_listing_claim_source IS NOT NULL
      AND seller_listing_recorded_at IS NOT NULL
    )
  );

-- +migrate Down
DROP INDEX IF EXISTS idx_vehicle_taxonomy_observations_review;
DROP TABLE IF EXISTS vehicle_taxonomy_observations;

DROP INDEX IF EXISTS idx_vehicles_drivetrain_taxon_id;
DROP INDEX IF EXISTS idx_vehicles_transmission_taxon_id;
DROP INDEX IF EXISTS idx_vehicles_fuel_taxon_id;
DROP INDEX IF EXISTS idx_vehicles_body_style_taxon_id;
DROP INDEX IF EXISTS idx_vehicles_model_taxon_id;
DROP INDEX IF EXISTS idx_vehicles_make_taxon_id;

ALTER TABLE IF EXISTS vehicles
  DROP CONSTRAINT IF EXISTS vehicles_seller_listing_claim_provenance_check,
  DROP COLUMN IF EXISTS taxonomized_at,
  DROP COLUMN IF EXISTS taxonomy_source_values,
  DROP COLUMN IF EXISTS taxonomy_resolution,
  DROP COLUMN IF EXISTS taxonomy_version,
  DROP COLUMN IF EXISTS body_style_taxon_id,
  DROP COLUMN IF EXISTS drivetrain_taxon_id,
  DROP COLUMN IF EXISTS transmission_taxon_id,
  DROP COLUMN IF EXISTS fuel_taxon_id,
  DROP COLUMN IF EXISTS trim_taxon_id,
  DROP COLUMN IF EXISTS generation_taxon_id,
  DROP COLUMN IF EXISTS model_taxon_id,
  DROP COLUMN IF EXISTS make_taxon_id,
  DROP COLUMN IF EXISTS seller_listing_recorded_at,
  DROP COLUMN IF EXISTS seller_listing_claim_source,
  DROP COLUMN IF EXISTS seller_stated_condition,
  DROP COLUMN IF EXISTS body_style,
  DROP COLUMN IF EXISTS seller_features,
  DROP COLUMN IF EXISTS seller_description;
