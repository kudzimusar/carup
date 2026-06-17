-- ============================================================================
-- Marketplace v1 — STAGING QA SEED (PR #73)
-- ----------------------------------------------------------------------------
-- Inserts 3 PUBLIC, NON-FIXTURE test vehicles so the marketplace can be browsed,
-- opened, and inquired on during staging QA. Fully idempotent: users/vehicles use
-- ON CONFLICT DO NOTHING; the evidence + PartSentry enrichment rows use NOT EXISTS
-- guards, so re-running never duplicates (matches the rows already on staging).
--
-- Matches the real STAGING schema (corrected after first apply):
--   * users.join_date is TEXT NOT NULL          -> provided
--   * vehicle_evidence.event_type is NOT NULL    -> provided ('document_upload')
--
--   ⚠️  STAGING ONLY — apply to the CarUp STAGING Supabase project
--       (ref: eoyenigwevnxwwhyhaer). DO NOT run on production (vhmnajoeicasaigiophh).
--   ⚠️  All rows are clearly marked: owner_id = 'qa-staging-seller-73',
--       color = 'QA-STAGING-PR73'. They are easy to find and remove (see CLEANUP).
--   ✅  No FAKE public trust claims: passport_verified is NOT set here (governed-only).
--       The "trusted" vehicle uses factual columns (duty/zimra/police) + a real
--       verified public-safe evidence row. The "suppressed" vehicle proves PartSentry
--       suppression (public_card_eligible=true BUT suspicion_status='flagged' -> hidden).
--
-- CASES:
--   a) JTDKARFP0H3000731  normal public vehicle (Toyota Corolla)
--   b) WBA8E9C50HK000732  evidence/duty-trusted vehicle (BMW 320i) + verified evidence
--   c) MAJFP1CD0HC000733  PartSentry-SUPPRESSED vehicle (Ford Ranger) — badge must NOT show
--
-- CLEANUP (remove all QA seed rows):
--   delete from partsentry_logs  where mechanic_id = 'qa-staging-seller-73';
--   delete from vehicle_evidence where uploaded_by = 'qa-staging-seller-73';
--   delete from vehicles         where owner_id     = 'qa-staging-seller-73';
--   delete from users            where id           = 'qa-staging-seller-73';
-- ============================================================================

-- 1) QA seller user (FK target for owner_id / mechanic_id / uploaded_by)
--    NOTE: public.users.join_date is TEXT NOT NULL in staging — must be provided.
INSERT INTO users (id, name, email, phone, role, join_date)
VALUES ('qa-staging-seller-73', 'QA Staging Seller', 'qa-seller-73@staging.carup.local', '+263772000073', 'owner', '2026-06-17')
ON CONFLICT (id) DO NOTHING;

-- 2) Three public, non-fixture vehicles (valid VINs, real owner, status Available)
INSERT INTO vehicles (
  vin, make, model, year, mileage, color, fuel_type, transmission, import_source,
  duty_paid, police_verified, status, trust_score, price, currency,
  owner_id, current_seller_type, registration_country, vehicle_condition_category,
  zimra_verified, safe_pay_ready, inspection_ready
) VALUES
  ('JTDKARFP0H3000731', 'Toyota', 'Corolla', 2018, 68000, 'QA-STAGING-PR73', 'Petrol', 'Manual', 'Local',
   true, true, 'Available', 74, 9500, 'USD',
   'qa-staging-seller-73', 'Private Owner', 'ZW', 'locally_used',
   false, false, false),
  ('WBA8E9C50HK000732', 'BMW', '320i', 2020, 41000, 'QA-STAGING-PR73', 'Petrol', 'Automatic', 'Japan',
   true, true, 'Available', 90, 24000, 'USD',
   'qa-staging-seller-73', 'Private Owner', 'ZW', 'recently_imported',
   true, true, true),
  ('MAJFP1CD0HC000733', 'Ford', 'Ranger', 2019, 88000, 'QA-STAGING-PR73', 'Diesel', 'Manual', 'Local',
   true, true, 'Available', 80, 21000, 'USD',
   'qa-staging-seller-73', 'Private Owner', 'ZW', 'locally_used',
   false, false, false)
ON CONFLICT (vin) DO NOTHING;

-- 3) Best-effort: verified public-safe EVIDENCE for the trusted vehicle (b) -> "evidence available".
--    Wrapped so a schema difference cannot abort the core vehicle seed above.
-- NOTE: public.vehicle_evidence.event_type is NOT NULL in staging (the 014 migration had it
-- nullable; staging diverged) — must be provided. Insert is guarded by NOT EXISTS so re-running
-- the seed never duplicates the row (idempotent).
DO $$
BEGIN
  INSERT INTO vehicle_evidence (
    vehicle_id, vin, evidence_type, event_type, file_url, storage_bucket, file_path, mime_type, file_size,
    uploaded_by, uploader_role, verification_status, visibility_level
  )
  SELECT
    'WBA8E9C50HK000732', 'WBA8E9C50HK000732', 'registration_document', 'document_upload',
    'https://staging.carup.local/qa/evidence-73.jpg', 'vehicle-images', 'qa/evidence-73.jpg', 'image/jpeg', 1024,
    'qa-staging-seller-73', 'owner', 'verified', 'public_safe'
  WHERE NOT EXISTS (
    SELECT 1 FROM vehicle_evidence WHERE vin = 'WBA8E9C50HK000732' AND uploaded_by = 'qa-staging-seller-73'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'QA seed: vehicle_evidence insert skipped (%): %', SQLSTATE, SQLERRM;
END $$;

-- 4) Best-effort: a PartSentry log for vehicle (c) that is verified + public_card_eligible BUT
--    suspicion_status='flagged' -> summarizePartSentry SUPPRESSES all PartSentry/verified-parts
--    badges. This proves badge suppression on a real listing.
-- Guarded by NOT EXISTS so re-running the seed never duplicates the row (idempotent).
DO $$
BEGIN
  INSERT INTO partsentry_logs (
    vin, mechanic_id, part_name, part_oem, action_type, description, mileage, signature, timestamp,
    verification_status, part_verification_status, suspicion_status, public_card_eligible
  )
  SELECT
    'MAJFP1CD0HC000733', 'qa-staging-seller-73', 'Alternator', 'OEM-ALT-73', 'Replaced',
    'QA suppressed-case part log', 88000, 'QA-STAGING-SIG-73', now()::text,
    'verified', 'verified', 'flagged', true
  WHERE NOT EXISTS (
    SELECT 1 FROM partsentry_logs WHERE vin = 'MAJFP1CD0HC000733' AND mechanic_id = 'qa-staging-seller-73'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'QA seed: partsentry_logs insert skipped (%): %', SQLSTATE, SQLERRM;
END $$;

-- Verify (expect 3):
--   select count(*) from vehicles where owner_id = 'qa-staging-seller-73' and status = 'Available';
