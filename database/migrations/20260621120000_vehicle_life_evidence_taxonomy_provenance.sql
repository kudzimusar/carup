-- +migrate Up
-- =====================================================================================
-- Milestone 1 — Vehicle Life Evidence Taxonomy + Provenance / Chain of Custody
-- Master plan §4 (Phase 3 taxonomy) and §5 (Phase 4 provenance).
--
-- Design principles:
--   * ADDITIVE & REVERSIBLE. Existing `vehicle_evidence` rows and the 13 legacy
--     evidence_type values remain valid (master plan §4.2 backward compatibility).
--   * Eight first-class life-stage classes layered ABOVE the existing evidence_type.
--   * Source registry + immutable, hash-chained chain-of-custody events.
--   * No destructive overwrite: corrections are versioned (master plan §5.4).
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1) Evidence class taxonomy (catalog used by upload forms + validation) — master plan §4
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evidence_class_taxonomy (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_class  TEXT NOT NULL CHECK (evidence_class IN (
                    'import','auction','accident','repair','inspection',
                    'ownership_transfer','dealer_listing','current_condition')),
  subtype_code    TEXT NOT NULL,
  label           TEXT NOT NULL,
  description     TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  requires_event_date BOOLEAN NOT NULL DEFAULT false,
  requires_mileage    BOOLEAN NOT NULL DEFAULT false,
  supports_components BOOLEAN NOT NULL DEFAULT false,
  is_document     BOOLEAN NOT NULL DEFAULT false,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (evidence_class, subtype_code)
);

CREATE INDEX IF NOT EXISTS idx_evidence_taxonomy_class
  ON evidence_class_taxonomy(evidence_class, sort_order);

-- -------------------------------------------------------------------------------------
-- 2) Source registry — master plan §5.2
--    Base table holds restricted columns (contact/credential) and is service_role only.
--    A public-safe VIEW exposes the allowlisted summary columns to anon/authenticated.
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evidence_sources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL,
  source_type     TEXT NOT NULL CHECK (source_type IN (
                    'owner','dealer','mechanic','inspector','insurer','government',
                    'auction','importer','shipping','ai_provider','external_api','other')),
  organization    TEXT,
  country         TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified'
                    CHECK (verification_status IN ('verified','unverified','disputed','suspended')),
  trust_tier      TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (trust_tier IN ('high','medium','low','unknown')),
  legal_basis     TEXT,
  permitted_evidence_classes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  adapter_id      TEXT,
  active          BOOLEAN NOT NULL DEFAULT true,
  -- restricted columns — never exposed through the public view:
  contact_reference     TEXT,
  credential_reference  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_sources_type ON evidence_sources(source_type);
CREATE INDEX IF NOT EXISTS idx_evidence_sources_active ON evidence_sources(active);

-- Public-safe projection (NO contact/credential references) — master plan §5.6 / §15 allowlist
CREATE OR REPLACE VIEW evidence_sources_public AS
  SELECT id, code, display_name, source_type, organization, country,
         verification_status, trust_tier, permitted_evidence_classes, active
  FROM evidence_sources
  WHERE active = true;

-- -------------------------------------------------------------------------------------
-- 3) Evidence sets (group related assets for an event / before-during-after) — §4.4 / §10
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evidence_sets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin             TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
  evidence_class  TEXT CHECK (evidence_class IS NULL OR evidence_class IN (
                    'import','auction','accident','repair','inspection',
                    'ownership_transfer','dealer_listing','current_condition')),
  set_type        TEXT,                       -- e.g. 'repair_before_during_after', 'auction_lot'
  label           TEXT,
  event_date      DATE,
  event_date_precision TEXT NOT NULL DEFAULT 'day'
                    CHECK (event_date_precision IN ('day','month','year','unknown')),
  source_id       UUID REFERENCES evidence_sources(id) ON DELETE SET NULL,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_sets_vin ON evidence_sets(vin, event_date);

-- -------------------------------------------------------------------------------------
-- 4) Extend vehicle_evidence with taxonomy + provenance fields — master plan §4.4, §5.3
-- -------------------------------------------------------------------------------------
ALTER TABLE IF EXISTS vehicle_evidence
  ADD COLUMN IF NOT EXISTS evidence_class       TEXT,
  ADD COLUMN IF NOT EXISTS evidence_subtype     TEXT,
  ADD COLUMN IF NOT EXISTS event_date           DATE,
  ADD COLUMN IF NOT EXISTS event_date_precision TEXT NOT NULL DEFAULT 'day',
  ADD COLUMN IF NOT EXISTS capture_country      TEXT,
  ADD COLUMN IF NOT EXISTS odometer_value       NUMERIC,
  ADD COLUMN IF NOT EXISTS odometer_unit        TEXT,
  ADD COLUMN IF NOT EXISTS component_tags       TEXT[],
  ADD COLUMN IF NOT EXISTS declared_condition   TEXT,
  ADD COLUMN IF NOT EXISTS source_id            UUID REFERENCES evidence_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_record_id     TEXT,
  ADD COLUMN IF NOT EXISTS received_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS perceptual_hash      TEXT,
  ADD COLUMN IF NOT EXISTS checksum_algorithm   TEXT,
  ADD COLUMN IF NOT EXISTS original_asset_id    UUID,
  ADD COLUMN IF NOT EXISTS evidence_set_id      UUID REFERENCES evidence_sets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS retention_class      TEXT NOT NULL DEFAULT 'standard';

-- event_date_precision domain
ALTER TABLE IF EXISTS vehicle_evidence
  DROP CONSTRAINT IF EXISTS vehicle_evidence_event_date_precision_check;
ALTER TABLE IF EXISTS vehicle_evidence
  ADD CONSTRAINT vehicle_evidence_event_date_precision_check
  CHECK (event_date_precision IN ('day','month','year','unknown'));

-- evidence_class domain (NULL allowed for safety; backfill below populates all rows)
ALTER TABLE IF EXISTS vehicle_evidence
  DROP CONSTRAINT IF EXISTS vehicle_evidence_evidence_class_check;
ALTER TABLE IF EXISTS vehicle_evidence
  ADD CONSTRAINT vehicle_evidence_evidence_class_check
  CHECK (evidence_class IS NULL OR evidence_class IN (
    'import','auction','accident','repair','inspection',
    'ownership_transfer','dealer_listing','current_condition'));

-- self-referential parent asset (transformed -> original) — added after column exists
ALTER TABLE IF EXISTS vehicle_evidence
  DROP CONSTRAINT IF EXISTS vehicle_evidence_original_asset_fk;
ALTER TABLE IF EXISTS vehicle_evidence
  ADD CONSTRAINT vehicle_evidence_original_asset_fk
  FOREIGN KEY (original_asset_id) REFERENCES vehicle_evidence(id) ON DELETE SET NULL;

-- Backfill: map the 13 legacy evidence_type values to the 8 life-stage classes.
-- Legacy subtype = the legacy evidence_type. Mapping documented in
-- docs/vehicle-life-intelligence/EVIDENCE_TAXONOMY.md.
UPDATE vehicle_evidence SET evidence_class = CASE evidence_type
    WHEN 'import_photo'                 THEN 'import'
    WHEN 'customs_photo'               THEN 'import'
    WHEN 'auction_photo'               THEN 'auction'
    WHEN 'inspection_photo'            THEN 'inspection'
    WHEN 'odometer_photo'              THEN 'inspection'
    WHEN 'damage_photo'                THEN 'accident'
    WHEN 'repair_photo'                THEN 'repair'
    WHEN 'dealer_listing_photo'        THEN 'dealer_listing'
    WHEN 'owner_handover_photo'        THEN 'ownership_transfer'
    WHEN 'registration_document'       THEN 'ownership_transfer'
    WHEN 'insurance_document'          THEN 'accident'
    WHEN 'police_clearance_document'   THEN 'accident'
    WHEN 'ownership_transfer_document' THEN 'ownership_transfer'
    ELSE 'current_condition'
  END
  WHERE evidence_class IS NULL;

UPDATE vehicle_evidence
  SET evidence_subtype = COALESCE(evidence_subtype, evidence_type),
      received_at = COALESCE(received_at, uploaded_at),
      checksum_algorithm = COALESCE(checksum_algorithm, CASE WHEN checksum IS NOT NULL THEN 'sha256' ELSE NULL END)
  WHERE evidence_subtype IS NULL OR received_at IS NULL OR checksum_algorithm IS NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_evidence_class_event
  ON vehicle_evidence(vin, evidence_class, event_date);
CREATE INDEX IF NOT EXISTS idx_vehicle_evidence_perceptual_hash
  ON vehicle_evidence(perceptual_hash) WHERE perceptual_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vehicle_evidence_set
  ON vehicle_evidence(evidence_set_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_evidence_source
  ON vehicle_evidence(source_id);

-- -------------------------------------------------------------------------------------
-- 5) Immutable, hash-chained chain-of-custody events — master plan §5.4, §5.5
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evidence_provenance_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id     UUID NOT NULL REFERENCES vehicle_evidence(id) ON DELETE CASCADE,
  vin             TEXT,
  sequence        BIGINT NOT NULL,
  event_type      TEXT NOT NULL CHECK (event_type IN (
                    'created','uploaded','imported','validated','transformed',
                    'ai_requested','ai_completed','ai_failed','reviewer_opened',
                    'approved','rejected','requested_more_info','published','unpublished',
                    'disputed','resolved','corrected','superseded',
                    'retention_hold','deleted')),
  actor_user_id   TEXT,
  actor_role      TEXT,
  actor_type      TEXT NOT NULL DEFAULT 'user'
                    CHECK (actor_type IN ('user','system','ai','source_partner')),
  source_route    TEXT,
  request_id      TEXT,
  ip_address      TEXT,
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_hash    TEXT NOT NULL,    -- SHA-256 of the canonical event payload (app-computed)
  prev_hash       TEXT,             -- content_hash of the previous event for this evidence_id
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (evidence_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_provenance_evidence ON evidence_provenance_events(evidence_id, sequence);
CREATE INDEX IF NOT EXISTS idx_provenance_vin ON evidence_provenance_events(vin, created_at);
CREATE INDEX IF NOT EXISTS idx_provenance_event_type ON evidence_provenance_events(event_type);

-- Append-only enforcement: block UPDATE and DELETE (tamper-evidence). master plan §5.4
CREATE OR REPLACE FUNCTION carup_provenance_block_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'evidence_provenance_events is append-only; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_provenance_no_update ON evidence_provenance_events;
CREATE TRIGGER trg_provenance_no_update
  BEFORE UPDATE ON evidence_provenance_events
  FOR EACH ROW EXECUTE FUNCTION carup_provenance_block_mutation();

DROP TRIGGER IF EXISTS trg_provenance_no_delete ON evidence_provenance_events;
CREATE TRIGGER trg_provenance_no_delete
  BEFORE DELETE ON evidence_provenance_events
  FOR EACH ROW EXECUTE FUNCTION carup_provenance_block_mutation();

-- -------------------------------------------------------------------------------------
-- 6) RLS + grants
-- -------------------------------------------------------------------------------------
-- Taxonomy is public catalog data.
GRANT SELECT ON TABLE evidence_class_taxonomy TO anon, authenticated;

-- Source registry: base table restricted; public view allowlisted.
ALTER TABLE IF EXISTS evidence_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE evidence_sources FROM anon, authenticated;
GRANT SELECT ON evidence_sources_public TO anon, authenticated;

-- Evidence sets: authenticated read; writes happen via service_role API layer.
ALTER TABLE IF EXISTS evidence_sets ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE evidence_sets TO authenticated;
DROP POLICY IF EXISTS "evidence sets authenticated read" ON evidence_sets;
CREATE POLICY "evidence sets authenticated read"
  ON evidence_sets FOR SELECT TO authenticated USING (true);

-- Provenance events: never exposed to anon; service_role (API) writes.
ALTER TABLE IF EXISTS evidence_provenance_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE evidence_provenance_events FROM anon;
GRANT SELECT ON TABLE evidence_provenance_events TO authenticated;
DROP POLICY IF EXISTS "provenance authenticated read" ON evidence_provenance_events;
CREATE POLICY "provenance authenticated read"
  ON evidence_provenance_events FOR SELECT TO authenticated USING (true);

-- -------------------------------------------------------------------------------------
-- 7) Seed taxonomy (8 classes + representative subtypes from master plan §4.3)
-- -------------------------------------------------------------------------------------
INSERT INTO evidence_class_taxonomy
  (evidence_class, subtype_code, label, sort_order, requires_event_date, requires_mileage, supports_components, is_document)
VALUES
  -- import
  ('import','export_yard_photo','Export-yard photo',10,true,false,true,false),
  ('import','port_photo','Port photo',11,true,false,false,false),
  ('import','container_loading','Container loading/unloading',12,true,false,false,false),
  ('import','bill_of_lading','Bill of lading',13,true,false,false,true),
  ('import','export_certificate','Export certificate',14,true,false,false,true),
  ('import','customs_entry','Customs entry',15,true,false,false,true),
  ('import','duty_clearance_document','Duty / clearance document',16,true,false,false,true),
  ('import','import_inspection','Import inspection',17,true,false,true,false),
  -- auction
  ('auction','auction_image','Auction image',20,true,false,true,false),
  ('auction','auction_sheet','Auction sheet',21,true,false,false,true),
  ('auction','damage_diagram','Damage diagram',22,true,false,true,false),
  ('auction','auction_grade','Auction grade',23,true,false,false,false),
  ('auction','lot_metadata','Lot metadata',24,true,false,false,false),
  ('auction','mileage_reading','Mileage reading',25,true,true,false,false),
  ('auction','source_listing_snapshot','Source listing snapshot',26,true,false,false,false),
  -- accident
  ('accident','scene_photo','Scene photo',30,true,false,true,false),
  ('accident','police_report','Police report',31,true,false,false,true),
  ('accident','insurer_assessment','Insurer assessment',32,true,false,true,true),
  ('accident','tow_record','Tow record',33,true,false,false,true),
  ('accident','damage_map','Damage map',34,true,false,true,false),
  ('accident','severity_assessment','Severity assessment',35,true,false,true,false),
  -- repair
  ('repair','before_repair','Before repair',40,true,false,true,false),
  ('repair','during_repair','During repair',41,true,false,true,false),
  ('repair','after_repair','After repair',42,true,false,true,false),
  ('repair','repair_invoice','Repair invoice',43,true,false,false,true),
  ('repair','parts_list','Parts list',44,true,false,false,true),
  ('repair','replaced_component','Replaced component',45,true,false,true,false),
  ('repair','paint_body_work','Paint / body work',46,true,false,true,false),
  ('repair','structural_repair','Structural repair',47,true,false,true,false),
  ('repair','mechanic_certification','Mechanic certification',48,true,false,false,true),
  -- inspection
  ('inspection','pre_purchase_inspection','Pre-purchase inspection',50,true,false,true,true),
  ('inspection','roadworthiness','Roadworthiness',51,true,false,false,true),
  ('inspection','mechanical_inspection','Mechanical inspection',52,true,false,true,false),
  ('inspection','chassis_inspection','Chassis inspection',53,true,false,true,false),
  ('inspection','emissions','Emissions',54,true,false,false,true),
  ('inspection','brake_tyre_suspension','Brake / tyre / suspension',55,true,false,true,false),
  ('inspection','odometer_reading','Odometer reading',56,true,true,false,false),
  ('inspection','inspector_report','Inspector report',57,true,false,false,true),
  -- ownership_transfer
  ('ownership_transfer','transfer_record','Transfer record',60,true,false,false,true),
  ('ownership_transfer','sale_agreement','Sale agreement',61,true,false,false,true),
  ('ownership_transfer','condition_at_handover','Condition at handover',62,true,false,true,false),
  ('ownership_transfer','mileage_at_transfer','Mileage at transfer',63,true,true,false,false),
  ('ownership_transfer','ownership_transition','Ownership transition',64,true,false,false,true),
  -- dealer_listing
  ('dealer_listing','listing_photograph','Listing photograph',70,true,false,true,false),
  ('dealer_listing','seller_description_snapshot','Seller/dealer description snapshot',71,true,false,false,false),
  ('dealer_listing','advertised_mileage','Advertised mileage',72,true,true,false,false),
  ('dealer_listing','advertised_condition','Advertised condition',73,true,false,false,false),
  ('dealer_listing','price_history','Price / price history',74,true,false,false,false),
  ('dealer_listing','listing_source','Listing source and date',75,true,false,false,false),
  ('dealer_listing','declared_status','Declared accident/repair status',76,true,false,false,false),
  -- current_condition
  ('current_condition','exterior_viewpoint','Exterior viewpoint',80,false,false,true,false),
  ('current_condition','interior','Interior',81,false,false,true,false),
  ('current_condition','engine_bay','Engine bay',82,false,false,true,false),
  ('current_condition','underbody','Underbody',83,false,false,true,false),
  ('current_condition','tyres','Tyres',84,false,false,true,false),
  ('current_condition','dashboard','Dashboard',85,false,false,false,false),
  ('current_condition','odometer','Odometer',86,false,true,false,false),
  ('current_condition','vin_chassis_plate','VIN / chassis / plate',87,false,false,false,false),
  ('current_condition','current_defect','Current defect',88,false,false,true,false)
ON CONFLICT (evidence_class, subtype_code) DO NOTHING;

-- -------------------------------------------------------------------------------------
-- 8) Seed baseline sources (owner/dealer uploads + sandbox source partners) — §5.2 / §6.3
--    External provider sources are seeded as 'unverified' sandbox entries. They are NOT
--    marked live until real credentials + contract verification exist (master plan §2.6).
-- -------------------------------------------------------------------------------------
INSERT INTO evidence_sources
  (code, display_name, source_type, organization, country, verification_status, trust_tier,
   legal_basis, permitted_evidence_classes, adapter_id, active)
VALUES
  ('owner_upload','Vehicle owner upload','owner',NULL,'ZW','verified','medium',
   'first_party_owner_consent',
   ARRAY['current_condition','repair','inspection','ownership_transfer'],NULL,true),
  ('dealer_upload','Dealer upload','dealer',NULL,'ZW','verified','medium',
   'first_party_dealer_terms',
   ARRAY['dealer_listing','current_condition','inspection','import','auction'],NULL,true),
  ('inspection_centre','Inspection centre','inspector',NULL,'ZW','unverified','medium',
   'partner_agreement_pending',
   ARRAY['inspection'],'sandbox_inspection',true),
  ('jp_auction_sandbox','Japanese auction (sandbox)','auction','Sandbox','JP','unverified','unknown',
   'sandbox_fixtures_only',
   ARRAY['auction','import'],'sandbox_jp_auction',true),
  ('government_registry_sandbox','Government registry (sandbox)','government','Sandbox','ZW','unverified','unknown',
   'legal_agreement_pending',
   ARRAY['ownership_transfer','inspection'],'sandbox_gov_registry',true)
ON CONFLICT (code) DO NOTHING;

-- Link backfilled owner/dealer evidence to the corresponding source where uploader_role matches.
UPDATE vehicle_evidence ve
  SET source_id = es.id
  FROM evidence_sources es
  WHERE ve.source_id IS NULL
    AND ((ve.uploader_role = 'owner'  AND es.code = 'owner_upload')
      OR (ve.uploader_role = 'dealer' AND es.code = 'dealer_upload'));

-- +migrate Down

DROP TRIGGER IF EXISTS trg_provenance_no_delete ON evidence_provenance_events;
DROP TRIGGER IF EXISTS trg_provenance_no_update ON evidence_provenance_events;
DROP FUNCTION IF EXISTS carup_provenance_block_mutation();
DROP TABLE IF EXISTS evidence_provenance_events;

DROP INDEX IF EXISTS idx_vehicle_evidence_source;
DROP INDEX IF EXISTS idx_vehicle_evidence_set;
DROP INDEX IF EXISTS idx_vehicle_evidence_perceptual_hash;
DROP INDEX IF EXISTS idx_vehicle_evidence_class_event;

ALTER TABLE IF EXISTS vehicle_evidence
  DROP CONSTRAINT IF EXISTS vehicle_evidence_original_asset_fk,
  DROP CONSTRAINT IF EXISTS vehicle_evidence_evidence_class_check,
  DROP CONSTRAINT IF EXISTS vehicle_evidence_event_date_precision_check;

ALTER TABLE IF EXISTS vehicle_evidence
  DROP COLUMN IF EXISTS retention_class,
  DROP COLUMN IF EXISTS evidence_set_id,
  DROP COLUMN IF EXISTS original_asset_id,
  DROP COLUMN IF EXISTS checksum_algorithm,
  DROP COLUMN IF EXISTS perceptual_hash,
  DROP COLUMN IF EXISTS received_at,
  DROP COLUMN IF EXISTS source_record_id,
  DROP COLUMN IF EXISTS source_id,
  DROP COLUMN IF EXISTS declared_condition,
  DROP COLUMN IF EXISTS component_tags,
  DROP COLUMN IF EXISTS odometer_unit,
  DROP COLUMN IF EXISTS odometer_value,
  DROP COLUMN IF EXISTS capture_country,
  DROP COLUMN IF EXISTS event_date_precision,
  DROP COLUMN IF EXISTS event_date,
  DROP COLUMN IF EXISTS evidence_subtype,
  DROP COLUMN IF EXISTS evidence_class;

DROP VIEW IF EXISTS evidence_sources_public;
DROP TABLE IF EXISTS evidence_sets;
DROP TABLE IF EXISTS evidence_sources;
DROP TABLE IF EXISTS evidence_class_taxonomy;
