-- +migrate Up
-- =============================================================
-- Trade OS client-demo convergence (D2/D4) — additive vocabulary/constraint reconciliation.
--
-- 1. `user_registration_profiles.business_type` gains 'logistics_provider'. This is a NON-AUTHORIZING
--    business identity (signup context only, per the table's own contract) — it grants no platform
--    role. Operational container authority remains governed tenant membership (tenant_users) checked
--    server-side by the diaspora services and the atomic approval RPC.
-- 2. `diaspora_cargo_reservations.cargo_type` gains 'household' and 'general' so participants can
--    truthfully represent household/personal effects and general eligible cargo, not only
--    vehicle/parts. Existing values remain valid; nothing is rewritten.
-- 3. `diaspora_cargo_reservations.import_order_id` becomes NULLABLE. The authoritative marketplace
--    service (diasporaContainerMarketplaceService.requestReservation) has always treated the import
--    order linkage as optional — non-vehicle cargo (household goods, general cargo) has no import
--    order. The original 013 schema made the column NOT NULL, which would reject every legitimate
--    no-order reservation on a real database. The FK is preserved: when a linkage exists it must be
--    a real order.
--
-- Additive and backwards-compatible. Applied to STAGING only by this programme; production untouched.
-- =============================================================

ALTER TABLE IF EXISTS public.user_registration_profiles
  DROP CONSTRAINT IF EXISTS user_registration_profiles_business_type_check;
ALTER TABLE IF EXISTS public.user_registration_profiles
  ADD CONSTRAINT user_registration_profiles_business_type_check
  CHECK (business_type IN (
    'dealer', 'exporter', 'importer', 'garage', 'mechanic',
    'parts_seller', 'insurer', 'lender', 'logistics_provider', 'other'
  ));

ALTER TABLE IF EXISTS public.diaspora_cargo_reservations
  DROP CONSTRAINT IF EXISTS diaspora_cargo_reservations_cargo_type_check;
ALTER TABLE IF EXISTS public.diaspora_cargo_reservations
  ADD CONSTRAINT diaspora_cargo_reservations_cargo_type_check
  CHECK (cargo_type IN ('vehicle', 'parts', 'household', 'general', 'mixed', 'other'));

ALTER TABLE IF EXISTS public.diaspora_cargo_reservations
  ALTER COLUMN import_order_id DROP NOT NULL;

-- +migrate Down
-- Restore the original constraint vocabularies. import_order_id is NOT re-tightened to NOT NULL:
-- rows created legitimately without an order linkage would make SET NOT NULL fail, and deleting
-- reservations in a rollback would destroy booking records. The Down direction therefore restores
-- the CHECKs only.
ALTER TABLE IF EXISTS public.user_registration_profiles
  DROP CONSTRAINT IF EXISTS user_registration_profiles_business_type_check;
ALTER TABLE IF EXISTS public.user_registration_profiles
  ADD CONSTRAINT user_registration_profiles_business_type_check
  CHECK (business_type IN (
    'dealer', 'exporter', 'importer', 'garage', 'mechanic',
    'parts_seller', 'insurer', 'lender', 'other'
  ));

ALTER TABLE IF EXISTS public.diaspora_cargo_reservations
  DROP CONSTRAINT IF EXISTS diaspora_cargo_reservations_cargo_type_check;
ALTER TABLE IF EXISTS public.diaspora_cargo_reservations
  ADD CONSTRAINT diaspora_cargo_reservations_cargo_type_check
  CHECK (cargo_type IN ('vehicle', 'parts', 'mixed', 'other'));
