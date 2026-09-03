-- +migrate Up
-- ZR2/ZR4: Zimbabwe registration lifecycle + evidence taxonomy.
-- No vehicle/evidence row is backfilled or reclassified.
DO $zr_registration$
BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='vehicles' AND column_name='registration_status_source') THEN
    ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS vehicles_registration_status_canonical_when_sourced;
    ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_registration_status_canonical_when_sourced CHECK (
      registration_status_source IS NULL OR registration_status IS NULL OR registration_status IN (
        'unknown','import_in_transit','arrived_customs_pending','customs_cleared_cvr_pending',
        'cvr_plate_pending','locally_registered','temporary_foreign_tip','reregistration_pending'
      )
    ) NOT VALID;
  END IF;
END
$zr_registration$;

DO $zr_evidence$
BEGIN
  IF to_regclass('public.evidence_class_taxonomy') IS NOT NULL THEN
    ALTER TABLE public.evidence_class_taxonomy DROP CONSTRAINT IF EXISTS evidence_class_taxonomy_evidence_class_check;
    ALTER TABLE public.evidence_class_taxonomy ADD CONSTRAINT evidence_class_taxonomy_evidence_class_check CHECK (evidence_class IN (
      'import','auction','accident','repair','inspection','ownership_transfer','registration','dealer_listing','current_condition'
    ));
    INSERT INTO public.evidence_class_taxonomy
      (evidence_class, subtype_code, label, sort_order, requires_event_date, requires_mileage, supports_components, is_document)
    VALUES
      ('import','commercial_invoice','Commercial invoice',18,true,false,false,true),
      ('import','payment_receipt','Purchase / payment receipt',19,true,false,false,true),
      ('import','transit_declaration','Transit declaration',20,true,false,false,true),
      ('registration','cvr_first_registration','CVR first registration',61,true,false,false,true),
      ('registration','registration_book','Registration book / certificate',62,true,false,false,true),
      ('registration','registration_plate_record','Registration plate record',63,true,false,false,true),
      ('registration','police_clearance_first_registration','Police clearance for first registration',64,true,false,false,true),
      ('registration','reregistration_record','Re-registration record',65,true,false,false,true),
      ('registration','temporary_import_permit','Temporary import permit',66,true,false,false,true)
    ON CONFLICT (evidence_class, subtype_code) DO NOTHING;
  END IF;

  IF to_regclass('public.evidence_sets') IS NOT NULL THEN
    ALTER TABLE public.evidence_sets DROP CONSTRAINT IF EXISTS evidence_sets_evidence_class_check;
    ALTER TABLE public.evidence_sets ADD CONSTRAINT evidence_sets_evidence_class_check CHECK (
      evidence_class IS NULL OR evidence_class IN (
        'import','auction','accident','repair','inspection','ownership_transfer','registration','dealer_listing','current_condition'
      )
    );
  END IF;

  IF to_regclass('public.vehicle_evidence') IS NOT NULL THEN
    ALTER TABLE public.vehicle_evidence DROP CONSTRAINT IF EXISTS vehicle_evidence_evidence_class_check;
    ALTER TABLE public.vehicle_evidence ADD CONSTRAINT vehicle_evidence_evidence_class_check CHECK (
      evidence_class IS NULL OR evidence_class IN (
        'import','auction','accident','repair','inspection','ownership_transfer','registration','dealer_listing','current_condition'
      )
    );
  END IF;

  IF to_regclass('public.evidence_sources') IS NOT NULL THEN
    UPDATE public.evidence_sources
       SET permitted_evidence_classes = (
         SELECT ARRAY(SELECT DISTINCT x FROM unnest(permitted_evidence_classes || ARRAY['registration']::text[]) AS t(x) ORDER BY x)
       )
     WHERE code IN ('owner_upload','dealer_upload','government_registry_sandbox')
       AND NOT ('registration' = ANY (permitted_evidence_classes));
  END IF;
END
$zr_evidence$;

DO $zr_post$
BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM pg_constraint
        WHERE conrelid='public.vehicles'::regclass
          AND conname='vehicles_registration_status_canonical_when_sourced'
     ) THEN
    RAISE EXCEPTION '[ZR] canonical sourced-registration constraint is missing';
  END IF;
END
$zr_post$;

-- +migrate Down
-- Forward-only: new canonical rows may depend on these values.
SELECT 1;
