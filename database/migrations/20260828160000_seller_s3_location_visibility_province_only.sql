-- Seller Journey 1.0 / S3 — location visibility gains a third seller choice.
--
-- WHY THIS EXISTS
--   S3 gives the seller control over what buyers see about them. The two-value vocabulary
--   ('public' | 'withheld') forces an all-or-nothing decision: publish your city, or publish
--   nothing about where the vehicle is. A seller who is willing to say "somewhere in Manicaland"
--   but not "this street in Mutare" had no way to say so, and answered by withholding everything.
--
--   `province_only` is that middle answer. It is a PRIVACY WIDENING: it adds an option that
--   discloses strictly less than 'public', and it changes nothing for a row that does not use it.
--
-- WHAT THIS MIGRATION DOES
--   Exactly one thing: it widens the CHECK constraint
--   `vehicles_listing_location_visibility_vocabulary` to accept a third value.
--
-- WHAT IT DOES NOT DO
--   · It writes no rows. No seller's recorded visibility is reinterpreted.
--   · It backfills nothing. A row that says 'public' still says 'public'.
--   · It relaxes no other constraint. `vehicles_listing_location_requires_source` is untouched,
--     so "no location fact without provenance" still holds.
--   · It grants no new disclosure. `province_only` withholds the city that 'public' would have
--     published; there is no audience that sees more after this migration than before it.
--
-- SAFETY
--   Adding a value to a CHECK constraint is additive and reversible. The Down section restores the
--   two-value constraint, and can only fail if a row has meanwhile chosen the new value — which is
--   the correct failure, because silently rewriting a seller's consent decision to reverse a
--   migration would be worse than refusing.
--
-- Applied to STAGING ONLY by the Seller S3 gate. Production activation requires owner authority.

-- Up
DO $$
DECLARE
  v_oid oid := 'public.vehicles'::regclass;
  c_visibility text[] := ARRAY['public','withheld','province_only'];
  v_pre_digest bigint;
  v_post_digest bigint;
BEGIN
  -- A pre/post digest over the column this migration governs. If the two disagree, the migration
  -- changed seller data, which it must never do.
  SELECT count(*) FILTER (WHERE listing_location_visibility IS NOT NULL)
       + coalesce(sum(length(listing_location_visibility)), 0)
    INTO v_pre_digest FROM public.vehicles;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = v_oid AND conname = 'vehicles_listing_location_visibility_vocabulary'
  ) THEN
    ALTER TABLE public.vehicles
      DROP CONSTRAINT vehicles_listing_location_visibility_vocabulary;
  END IF;

  EXECUTE format(
    'ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_listing_location_visibility_vocabulary '
    || 'CHECK (listing_location_visibility IS NULL OR listing_location_visibility = ANY (%L::text[]))',
    c_visibility);

  SELECT count(*) FILTER (WHERE listing_location_visibility IS NOT NULL)
       + coalesce(sum(length(listing_location_visibility)), 0)
    INTO v_post_digest FROM public.vehicles;

  IF v_pre_digest IS DISTINCT FROM v_post_digest THEN
    RAISE EXCEPTION
      'S3 visibility migration must not backfill: existing vehicle data changed (pre=%, post=%)',
      v_pre_digest, v_post_digest;
  END IF;

  -- The widened constraint must actually be in force. A migration that reports success without
  -- installing its own guard is worse than one that fails.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = v_oid AND conname = 'vehicles_listing_location_visibility_vocabulary'
  ) THEN
    RAISE EXCEPTION 'S3 visibility vocabulary constraint is absent after apply';
  END IF;
END $$;

-- Down
-- DO $$
-- DECLARE
--   c_visibility text[] := ARRAY['public','withheld'];
-- BEGIN
--   -- Refuses rather than rewriting a seller's recorded consent decision.
--   IF EXISTS (SELECT 1 FROM public.vehicles WHERE listing_location_visibility = 'province_only') THEN
--     RAISE EXCEPTION 'cannot narrow the vocabulary: sellers have chosen province_only';
--   END IF;
--   ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS vehicles_listing_location_visibility_vocabulary;
--   EXECUTE format(
--     'ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_listing_location_visibility_vocabulary '
--     || 'CHECK (listing_location_visibility IS NULL OR listing_location_visibility = ANY (%L::text[]))',
--     c_visibility);
-- END $$;
