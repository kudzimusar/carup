-- =====================================================================================
-- DISPOSABLE-TEST SYNTHETIC FIXTURES ONLY — NOT A DEPLOYABLE MIGRATION
-- Authority: CARUP-PAY-03A-R1 (Section 3, R1-A)
--
-- WARNING:
-- 1. All records in this file are fabricated, synthetic test fixtures for isolated
--    disposable PostgreSQL verification (`pay01c_sandbox_ci`).
-- 2. None of these records represent verified operational CarUp vehicles.
-- 3. Execution outside the disposable `pay01c_sandbox_ci` database is strictly refused.
-- =====================================================================================
BEGIN;

DO $$
BEGIN
  IF current_database() <> 'pay01c_sandbox_ci' THEN
    RAISE EXCEPTION 'PAY03A_SYNTHETIC_FIXTURE_FORBIDDEN_OUTSIDE_DISPOSABLE_TEST_DB: %', current_database();
  END IF;
END $$;

-- 1. Synthetic test user (`u_synth_fixture_inspector`) for FK integrity on `vehicle_evidence.uploaded_by`
INSERT INTO public.users (
  id, name, email, role, is_verified, subscription, join_date
) VALUES (
  'u_synth_fixture_inspector',
  'SYNTHETIC TEST FIXTURE INSPECTOR (NOT A REAL USER)',
  'synthetic-fixture-inspector@test.invalid',
  'admin',
  true,
  'System',
  '2026-10-31'
)
ON CONFLICT (id) DO NOTHING;

-- 2. Synthetic test vehicles (`WBA3A5C51DF358101`, `JTDBR32E820112202` have synthetic history evidence;
--    `DBA-GRS204-0005303` is intentionally metadata-only with zero history evidence to test eligibility refusal).
INSERT INTO public.vehicles (
  vin, make, model, generation, trim, year, color, mileage,
  fuel_type, drivetrain, transmission, import_source, duty_paid, police_verified,
  status, trust_score, price, currency
) VALUES
  (
    'WBA3A5C51DF358101', 'BMW', '320i', 'F30', 'M Sport [SYNTHETIC_FIXTURE]', 2019, 'Alpine White', 54200,
    'Petrol', 'RWD', 'Automatic', 'SYNTHETIC_TEST_FIXTURE — Japan (Yokohama)', true, true,
    'Available', 91.5, 16800, 'USD'
  ),
  (
    'JTDBR32E820112202', 'Toyota', 'Hilux', 'AN120', 'GD-6 Double Cab [SYNTHETIC_FIXTURE]', 2021, 'Silver Metallic', 68400,
    'Diesel', '4WD', 'Automatic', 'SYNTHETIC_TEST_FIXTURE — Japan (Nagoya)', true, true,
    'Available', 94.0, 34500, 'USD'
  ),
  (
    'DBA-GRS204-0005303', 'Toyota', 'Crown Athlete', 'S200', '3.5G Metadata-Only [SYNTHETIC_FIXTURE]', 2016, 'Pearl Black', 81900,
    'Petrol', 'RWD', 'Automatic', 'SYNTHETIC_TEST_FIXTURE — Metadata Only (No History)', false, false,
    'In Transit', 80.0, 12900, 'USD'
  )
ON CONFLICT (vin) DO NOTHING;

-- 3. Synthetic verified public_safe lifecycle evidence for the two eligible fixture VINs
DO $$
BEGIN
  IF to_regclass('public.vehicle_evidence') IS NOT NULL THEN
    INSERT INTO public.vehicle_evidence (
      id, vehicle_id, vin, event_type, evidence_type, evidence_class, evidence_subtype,
      file_url, storage_bucket, file_path, mime_type, file_size,
      uploaded_by, uploader_role, captured_at, uploaded_at, event_date,
      odometer_value, odometer_unit, source_name, source_reference,
      verification_status, visibility_level, metadata
    ) VALUES
      (
        '00000000-0000-4000-8000-00000000e101',
        'WBA3A5C51DF358101',
        'WBA3A5C51DF358101',
        'inspection_photo',
        'inspection_photo',
        'inspection',
        'export_inspection',
        'https://synthetic-fixture.invalid/wba3a5c51df358101/inspection.jpg',
        'vehicle-images',
        'synthetic-fixtures/wba3a5c51df358101/inspection.jpg',
        'image/jpeg',
        1024,
        'u_synth_fixture_inspector',
        'admin',
        '2026-06-15T09:00:00Z',
        '2026-06-15T09:05:00Z',
        '2026-06-15',
        54100,
        'km',
        'SYNTHETIC_TEST_FIXTURE',
        'SYNTH-FIXTURE-EXP-101',
        'verified',
        'public_safe',
        '{"synthetic_fixture": true, "provenance": "disposable_test_only"}'::jsonb
      ),
      (
        '00000000-0000-4000-8000-00000000e102',
        'WBA3A5C51DF358101',
        'WBA3A5C51DF358101',
        'import_photo',
        'import_photo',
        'import',
        'customs_clearance',
        'https://synthetic-fixture.invalid/wba3a5c51df358101/import.jpg',
        'vehicle-images',
        'synthetic-fixtures/wba3a5c51df358101/import.jpg',
        'image/jpeg',
        1024,
        'u_synth_fixture_inspector',
        'admin',
        '2026-07-01T10:00:00Z',
        '2026-07-01T10:05:00Z',
        '2026-07-01',
        54200,
        'km',
        'SYNTHETIC_TEST_FIXTURE',
        'SYNTH-FIXTURE-IMP-102',
        'verified',
        'public_safe',
        '{"synthetic_fixture": true, "provenance": "disposable_test_only"}'::jsonb
      ),
      (
        '00000000-0000-4000-8000-00000000e201',
        'JTDBR32E820112202',
        'JTDBR32E820112202',
        'inspection_photo',
        'inspection_photo',
        'inspection',
        'pre_shipment_inspection',
        'https://synthetic-fixture.invalid/jtdbr32e820112202/inspection.jpg',
        'vehicle-images',
        'synthetic-fixtures/jtdbr32e820112202/inspection.jpg',
        'image/jpeg',
        1024,
        'u_synth_fixture_inspector',
        'admin',
        '2026-08-10T12:00:00Z',
        '2026-08-10T12:05:00Z',
        '2026-08-10',
        68400,
        'km',
        'SYNTHETIC_TEST_FIXTURE',
        'SYNTH-FIXTURE-EXP-201',
        'verified',
        'public_safe',
        '{"synthetic_fixture": true, "provenance": "disposable_test_only"}'::jsonb
      )
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

COMMIT;
