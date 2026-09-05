-- +migrate Up
-- Seller remediation Phase G: persist Seller-authored listing photo labels.
--
-- This remains LISTING MEDIA metadata, not evidence. A label describes how the Seller wants a
-- commercial photo presented ("Front", "Interior", etc.); it never confers verification or Trust.
ALTER TABLE IF EXISTS public.listing_images
  ADD COLUMN IF NOT EXISTS photo_label TEXT;

ALTER TABLE IF EXISTS public.listing_images
  DROP CONSTRAINT IF EXISTS listing_images_photo_label_length_check;

ALTER TABLE IF EXISTS public.listing_images
  ADD CONSTRAINT listing_images_photo_label_length_check
  CHECK (photo_label IS NULL OR char_length(photo_label) <= 80);

-- No browser grant is added. listing_images remains service-mediated under the existing containment.

-- +migrate Down
ALTER TABLE IF EXISTS public.listing_images
  DROP CONSTRAINT IF EXISTS listing_images_photo_label_length_check,
  DROP COLUMN IF EXISTS photo_label;
