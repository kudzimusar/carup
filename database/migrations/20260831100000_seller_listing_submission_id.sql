-- +migrate Up
-- Seller remediation Phase F17: durable idempotency for Seller listing creation.
--
-- A browser may retry POST /api/vehicles/add after the server committed but before the response
-- reached the Seller. The submission id identifies that one logical create attempt. It is not a
-- vehicle identity, ownership fact, Trust input or public field.
ALTER TABLE IF EXISTS public.vehicles
  ADD COLUMN IF NOT EXISTS seller_listing_submission_id TEXT;

ALTER TABLE IF EXISTS public.vehicles
  DROP CONSTRAINT IF EXISTS vehicles_seller_listing_submission_id_shape_check;

ALTER TABLE IF EXISTS public.vehicles
  ADD CONSTRAINT vehicles_seller_listing_submission_id_shape_check
  CHECK (
    seller_listing_submission_id IS NULL
    OR seller_listing_submission_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

CREATE UNIQUE INDEX IF NOT EXISTS vehicles_seller_listing_submission_id_unique
  ON public.vehicles (seller_listing_submission_id)
  WHERE seller_listing_submission_id IS NOT NULL;

COMMENT ON COLUMN public.vehicles.seller_listing_submission_id IS
  'Private Seller create-attempt idempotency key. Never part of Passport/public projections.';

-- +migrate Down
DROP INDEX IF EXISTS public.vehicles_seller_listing_submission_id_unique;

ALTER TABLE IF EXISTS public.vehicles
  DROP CONSTRAINT IF EXISTS vehicles_seller_listing_submission_id_shape_check,
  DROP COLUMN IF EXISTS seller_listing_submission_id;
