-- +migrate Up
-- Operations Control Plane M1: generic compatibility artifact-form values.
--
-- The 13-value legacy evidence_type vocabulary cannot honestly represent every
-- canonical Vehicle Life subtype (there is no legacy value for an import
-- commercial invoice — which is exactly how the Serena's import documents ended
-- up stored under 'registration_document'). Canonical-first uploads now derive
-- their compatibility evidence_type; when no exact legacy counterpart exists the
-- record carries one of two neutral artifact-form values whose semantics live
-- entirely in evidence_class + evidence_subtype:
--   * vehicle_life_document
--   * vehicle_life_photo
-- Additive only. No historical row is rewritten or reclassified.
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
    'ownership_transfer_document',
    'vehicle_life_document',
    'vehicle_life_photo'
  ));

-- A generic compatibility value is meaningless without its canonical
-- classification: enforce that such rows always carry class + subtype.
ALTER TABLE IF EXISTS vehicle_evidence
  DROP CONSTRAINT IF EXISTS vehicle_evidence_generic_type_requires_canonical;

ALTER TABLE IF EXISTS vehicle_evidence
  ADD CONSTRAINT vehicle_evidence_generic_type_requires_canonical
  CHECK (
    evidence_type NOT IN ('vehicle_life_document', 'vehicle_life_photo')
    OR (evidence_class IS NOT NULL AND evidence_subtype IS NOT NULL)
  );

DO $m1_post$
BEGIN
  IF to_regclass('public.vehicle_evidence') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM pg_constraint
        WHERE conrelid = 'public.vehicle_evidence'::regclass
          AND conname = 'vehicle_evidence_generic_type_requires_canonical'
     ) THEN
    RAISE EXCEPTION '[Operations M1] generic-compat canonical-required constraint is missing';
  END IF;
END
$m1_post$;

-- +migrate Down
-- Forward-only: canonical-first rows may already carry the generic values.
SELECT 1;
