-- +migrate Up
-- =============================================================================
-- ISSUE #164 — CANONICAL VEHICLE TRUTH CLOSURE, PHASE 4
-- A canonical source for listing LOCATION, and PROVENANCE for the registration
-- and seller claims that are currently manufactured by column DEFAULTs.
-- =============================================================================
--
-- MEASURED EVIDENCE THIS CLOSES (staging ref eoyenigwevnxwwhyhaer, PostgreSQL 17.6,
-- read-only catalog + aggregate queries, 16 rows in public.vehicles):
--
--   1. THERE IS NO LOCATION COLUMN ANYWHERE ON THE VEHICLE. A scan of every column in the
--      public schema whose name contains city/province/location/country/address/region returns
--      exactly ONE hit on public.vehicles: `registration_country`. There is no city, no province
--      and no listing country. Yet backend/services/marketplace/listingSummaryService.js emits
--      `location: '<country literal>'` on every marketplace card, and /api/vehicles/add accepts
--      `location` and `province` from the client and then never writes them (backend/server.js —
--      both names are destructured out of req.body and referenced nowhere after). The card is not
--      reading a stale column; it is printing a constant, because the write path had nowhere to
--      put what the seller typed. THAT WRITE-PATH HOLE IS THE ROOT CAUSE and this migration is
--      what makes closing it possible.
--
--   2. THE REGISTRATION CLAIMS ARE 100% SCHEMA-MANUFACTURED.
--        registration_authority  = <authority literal>  on 16 of 16 rows   (column DEFAULT)
--        registration_status     = <status literal>     on 16 of 16 rows   (column DEFAULT)
--        plate_status            = <status literal>     on 16 of 16 rows   (column DEFAULT)
--      A repository-wide search finds ZERO application writers for any of those three columns —
--      no INSERT payload, no UPDATE, in backend/, web/, shared/ or mobile/. Every value in every
--      row was placed by the DEFAULT clause. The database is asserting, on behalf of a
--      registration authority, a registration status for vehicles nobody ever looked up.
--
--   3. THE TWO COLUMNS THAT DO HAVE A WRITER ARE SPLIT BETWEEN THE WRITER AND THE DEFAULT, and
--      the split is visible in the data as two different encodings of the same fact:
--        registration_country : 13 rows hold the DEFAULT's code form, 3 hold a spelled-out form
--        current_seller_type  : 13 rows hold the DEFAULT's label,     3 hold the writer's slug
--      13 is exactly the default population in both cases. Two encodings in one column is also
--      direct evidence that nothing normalises these values on the way in.
--
--   4. public_seller_display_enabled = false on 16 of 16 rows, so the current
--      `seller_display_label` derivation emits a generic label on 100% of live listings.
--
--   5. THE PRICE'S CURRENCY IS SCHEMA-MANUFACTURED TOO, and it is the same species as (2) rather
--      than a different problem that merely looks alike:
--        currency = <currency literal> on 16 of 16 rows, 1 distinct value, 0 NULLs (column DEFAULT)
--      It was left out of the first draft of this migration because the defect had been treated as
--      a read-path one (`currency || '<literal>'` in listingSummaryService and in
--      marketplacePricingService) and as a write-path one (a hardcoded literal in the sell form).
--      Removing a substitution at those two layers while the column DEFAULT stayed would only MOVE
--      the fabrication down a level: an insert that omits the currency would still receive one, and
--      the read path — now correctly refusing to invent — would faithfully publish the value the
--      schema had invented instead. Same table, same phase, same fix.
--
--      The application write path no longer omits it: POST /api/vehicles/add rejects a price with no
--      currency (400), so this default protects nothing that is still called. It only waits for the
--      next caller that forgets.
--
--      DROPPING THE DEFAULT IS ONLY HALF THE CHANGE, AND IT IS THE HALF THAT REMOVES. The read path
--      (listingSummaryService.currencyClaim, re-derived in marketplacePricingService) publishes a
--      currency only when a `currency_source` names who asserted it — the same provenance test the
--      registration claims get. An earlier draft of THIS FILE dropped the DEFAULT and never created
--      that column, and the two halves do not compose: a currency a seller genuinely stated would be
--      accepted by /api/vehicles/add, stored verbatim, and then gated on a column that does not
--      exist — PERMANENTLY UNPUBLISHABLE, reported `not_recorded` forever. A read path asserting
--      "nothing was recorded" over a fact that WAS recorded is a FABRICATED WITHHOLDING: the exact
--      inverse of the defect this phase removes, and no more true for pointing the other way. So
--      `currency_source` is created below with the same CLAIM_SOURCES vocabulary CHECK every other
--      *_source column gets. The removing half and the attesting half land together, or neither
--      should land.
--
-- ---------------------------------------------------------------------------
-- WHY public.vehicles OWNS THE LOCATION — justified against the schema, not assumed.
-- ---------------------------------------------------------------------------
-- The question is real, because "vehicle" and "listing" are different things and location is a
-- LISTING fact. Every candidate owner in this database was checked before choosing:
--
--   · public.vehicle_listings — DOES NOT EXIST. `to_regclass('public.vehicle_listings')` is NULL
--     on staging. Its only DDL is database/migrations/004_add_tamper_proofing.sql, a SQLite-era
--     file that was never applied to PostgreSQL. It cannot own a column it has no table for.
--
--   · public.vehicle_listing_summaries — EXISTS (34 columns, 0 rows) but is being REMOVED by
--     20260817120000_issue164_drop_dead_vehicle_listing_summaries.sql as a dormant second
--     declaration of the public listing contract. Putting the canonical location on a relation
--     this programme is deleting, precisely because duplicate listing models caused Issue #164,
--     would be self-defeating.
--
--   · public.listing_images / public.listing_snapshots — child records OF a listing (images; a
--     point-in-time copy). Neither is the listing, and a location on either would be per-photo
--     or per-snapshot rather than per-listing.
--
--   · public.users.location — EXISTS and is populated, and is the wrong answer. It is the
--     SELLER's stated location. A dealer based in one city can list a vehicle standing in
--     another; binding a listing's location to its seller's profile is precisely the inferred
--     truth this programme removes. Same objection, more strongly, for dealer_branches.address
--     and organization_branches.location — a branch address is where an ORGANISATION is, and
--     15 of 16 vehicles have no tenant at all (tenant_id IS NULL on 15 rows).
--
--   · public.vehicles — CHOSEN. In CarUp today the vehicle row IS the listing row: publication
--     _status, status, price, currency, current_seller_id, current_seller_type and
--     public_seller_display_enabled all already live here, and the live marketplace read path
--     (listingSummaryService.LISTING_SELECT_COLUMNS -> `.from('vehicles')`) resolves a listing
--     from this table and no other. One VIN is one row is one listing. Adding location here
--     creates no new source of truth; adding it anywhere else would create a second one.
--
-- THE COLUMNS ARE PREFIXED `listing_` DELIBERATELY. They are listing facts, not vehicle-identity
-- facts. If CarUp later separates a listing from a vehicle (the same car relisted twice, in two
-- cities), the prefix names exactly which columns move and which stay — a mechanical split
-- rather than an archaeological one. Recorded here so that decision has a starting point.
--
-- ---------------------------------------------------------------------------
-- NO BACKFILL. NOT ONE ROW. This is the whole point of the phase.
-- ---------------------------------------------------------------------------
-- Every new column lands NULL on every existing row and stays that way. There is no honest value
-- to write: we do not know which city any of the 16 vehicles is in, and choosing the most likely
-- one — the capital, the seller's profile city, the registration country — would fabricate the
-- exact class of fact Phase 4 exists to delete. A NULL city renders as "not recorded", which is
-- true. A guessed city renders as a place, which is a claim, and a shopper who drives to it has
-- been lied to by a default.
--
-- The same reasoning forbids backfilling the provenance columns. If `registration_authority`
-- could be legitimised by writing a source for it after the fact, provenance would mean nothing.
-- The measured consequence, stated plainly and accepted: once the read paths consume this
-- contract, all 16 listings report registration and seller type as NOT RECORDED. Sixteen
-- unfounded claims stop being published; zero are invented to replace them. A seller or an
-- operator restores a fact by asserting it WITH its source, through the write path.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES, AND WHAT IT DELIBERATELY LEAVES ALONE.
-- ---------------------------------------------------------------------------
-- DOES (all additive or catalog-only; not one row is read, written or rewritten):
--   A. Adds 6 nullable listing-location columns: listing_city, listing_province,
--      listing_country, listing_location_source, listing_location_visibility,
--      listing_location_recorded_at.
--   B. Adds 6 nullable provenance columns: registration_country_source,
--      registration_authority_source, registration_status_source, plate_status_source,
--      current_seller_type_source, currency_source.
--   C. Constrains every *_source column to the CLAIM_SOURCES vocabulary exported by
--      backend/utils/publicVehicleProjection.js, so the database and the projection cannot
--      drift apart, and a typo cannot manufacture a recorded claim.
--   D. Makes "no location fact without provenance" a SCHEMA rule, not a convention: a city,
--      province, country, visibility or recorded_at may exist only when a source names who
--      said so. The application cannot forget it, because the database will not accept it.
--   E. DROPS the DEFAULT on registration_country, registration_authority, registration_status,
--      plate_status, current_seller_type and currency. Dropping a default rewrites NO existing row
--      — it changes only what a FUTURE insert receives when it stays silent, and the honest answer
--      to silence is NULL. Leaving the defaults in place would let the fabrication this phase
--      removes accumulate on every new listing, one row at a time, forever.
--      All six columns are NULLABLE (verified on staging and re-verified by the precondition
--      below), so removing the default converts an omitted value into NULL rather than into an
--      error — which is the only reason dropping it is a safe change to make here.
--
-- DELIBERATELY NOT DONE, each with its reason, so a later reader does not read the omission as
-- an oversight and "finish the job":
--   · vehicles.trust_score DEFAULT 80.0 IS LEFT IN PLACE. It is a fabrication of the same
--     family and it is NOT this phase's to touch: trust is the certified Phase 3 contract
--     (ADR-001), where the read path publishes only canonicalTrustService's projection and the
--     write path already inserts an explicit NULL. Recorded as an open finding for the phase
--     that owns the trust cache; changing it here would edit a certified contract sideways.
--   · vehicles.status DEFAULT stays. It is a sale-lifecycle initial state, not an assertion
--     about the world, and publication is separately gated by publication_status DEFAULT 'draft'
--     — which is itself the correct fail-closed default and also stays.
--   · vehicle_condition_category DEFAULT stays: its default is the schema's own declared
--     absence marker (one of the six values its CHECK permits) and it already means "not
--     classified". It is the one default here that tells the truth.
--   · The boolean verification flags (duty_paid, police_verified, zimra_verified, ...) stay.
--     They are the subject of the Phase 2 fact model (docs/canonical-vehicle-truth/FACT_MODEL.md)
--     and re-basing them is that phase's reviewed change, not a side effect of this one.
--   · NO INDEX is created on listing_city/province/country. No query filters on them yet;
--     an index for a filter nobody has written is speculation, and every row is NULL so it
--     would index nothing. It is added with the read path that needs it.
--
-- FORWARD-ONLY AND IDEMPOTENT BY CONSTRUCTION. ADD COLUMN IF NOT EXISTS, constraint adds guarded
-- on pg_constraint, and DROP DEFAULT converge on the same end state from any starting point, so
-- a fresh database and staging both apply cleanly and a re-run is a no-op. ADD COLUMN with no
-- DEFAULT does not rewrite the table.
--
-- THE PROVENANCE COLUMNS THEMSELVES CARRY NO DEFAULT, and the postcondition proves it. A default
-- on a *_source column would hand every row a source it never had — the identical defect, one
-- level up, and the one mistake that would quietly undo this entire migration.
--
-- FAIL-CLOSED. Every guard below RAISEs, and the runner wraps the migration in one transaction,
-- so a failed assertion leaves the table exactly as it was rather than half-changed.

-- ─────────────────────────────────────────────────────────────────────────────
-- PRECONDITION — and capture the pre-image the postcondition proves against.
-- ─────────────────────────────────────────────────────────────────────────────
DO $issue164_p4_pre$
DECLARE
  v_oid          regclass;
  v_not_nullable text;
BEGIN
  v_oid := to_regclass('public.vehicles');

  -- A database without the core table is not one this migration has anything to add to. Matches
  -- the containment migrations' treatment of an absent target: skip with a NOTICE, never error.
  IF v_oid IS NULL THEN
    RAISE NOTICE '[issue-164-p4] public.vehicles is absent — no listing table to extend; nothing to do.';
    RETURN;
  END IF;

  -- Dropping a DEFAULT from a NOT NULL column converts every future insert that omits it from an
  -- honest NULL into a hard constraint failure. That is a behaviour change this migration is not
  -- authorised to make, so it refuses BEFORE touching anything rather than discovering it later.
  SELECT string_agg(column_name, ', ' ORDER BY column_name)
    INTO v_not_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'vehicles'
     AND column_name IN ('registration_country', 'registration_authority', 'registration_status',
                         'plate_status', 'current_seller_type', 'currency')
     AND is_nullable = 'NO';

  IF v_not_nullable IS NOT NULL THEN
    RAISE EXCEPTION
      '[issue-164-p4] refusing to drop DEFAULTs: column(s) % are NOT NULL on this database, so removing the default would make an omitted value an error instead of an honest NULL.',
      v_not_nullable
      USING ERRCODE = 'invalid_table_definition';
  END IF;

  -- The pre-image of every column this migration could conceivably disturb. chr(1) separates
  -- fields and chr(2) marks a NULL, so a genuine empty string and a NULL cannot hash alike.
  -- ON COMMIT DROP: it exists only for the life of this migration's transaction.
  -- Dropped first so a re-run inside one transaction re-captures rather than erroring on a name
  -- that ON COMMIT DROP has not yet reclaimed.
  EXECUTE 'DROP TABLE IF EXISTS pg_temp.issue164_p4_preimage';
  EXECUTE $preimage$
    CREATE TEMP TABLE issue164_p4_preimage ON COMMIT DROP AS
    SELECT count(*) AS row_count,
           coalesce(md5(string_agg(
             vin
             || chr(1) || coalesce(registration_country,   chr(2))
             || chr(1) || coalesce(registration_authority, chr(2))
             || chr(1) || coalesce(registration_status,    chr(2))
             || chr(1) || coalesce(plate_status,           chr(2))
             || chr(1) || coalesce(current_seller_type,    chr(2))
             || chr(1) || coalesce(currency,               chr(2)),
             chr(3) ORDER BY vin)), '') AS digest
      FROM public.vehicles
  $preimage$;
END
$issue164_p4_pre$;

-- ─────────────────────────────────────────────────────────────────────────────
-- APPLY — add the columns, constrain them, and stop the defaults fabricating more.
-- ─────────────────────────────────────────────────────────────────────────────
DO $issue164_p4_apply$
DECLARE
  -- MUST equal CLAIM_SOURCES in backend/utils/publicVehicleProjection.js. The projection treats an
  -- unrecognised source as no provenance at all (fail-closed); this constraint stops one being
  -- stored in the first place, so the two layers agree by construction rather than by review.
  c_sources      text[] := ARRAY[
    'seller_declared', 'dealer_declared', 'operator_recorded',
    'document_extracted', 'registry_verified', 'inspection_verified'
  ];
  -- Mirrors CLAIM_VISIBILITY. Undeclared (NULL) withholds — absence is not permission.
  c_visibility   text[] := ARRAY['public', 'withheld'];
  c_source_cols  text[] := ARRAY[
    'listing_location_source',
    'registration_country_source', 'registration_authority_source',
    'registration_status_source', 'plate_status_source',
    'current_seller_type_source', 'currency_source'
  ];
  -- `currency` sits in this list for the same reason the other five do: its DEFAULT is the only
  -- author of the value on every row in the table, and a price whose currency was asserted by a
  -- schema clause is not a price the seller quoted.
  c_defaulted    text[] := ARRAY[
    'registration_country', 'registration_authority', 'registration_status',
    'plate_status', 'current_seller_type', 'currency'
  ];
  v_oid      regclass;
  v_col      text;
  v_conname  text;
BEGIN
  v_oid := to_regclass('public.vehicles');
  IF v_oid IS NULL THEN
    RETURN;
  END IF;

  -- A. The listing's own location. Nullable, no default: an unrecorded location is NULL, and
  --    NULL is the only value that does not assert a place.
  ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS listing_city                 text;
  ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS listing_province             text;
  ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS listing_country              text;
  -- WHO said the vehicle is there. Without this the other three are not publishable.
  ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS listing_location_source      text;
  -- WHETHER the person who recorded it cleared it for publication. NULL withholds.
  ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS listing_location_visibility  text;
  -- WHEN it was asserted, so a surface can age a location instead of implying it is current.
  ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS listing_location_recorded_at timestamptz;

  -- B. Provenance for the claims that today have none. Each is the companion of an EXISTING
  --    column; none replaces one, so no read path breaks by adding them.
  ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS registration_country_source   text;
  ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS registration_authority_source text;
  ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS registration_status_source    text;
  ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS plate_status_source           text;
  ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS current_seller_type_source    text;
  -- WHO said the price is quoted in this currency. Its companion `currency` loses its DEFAULT in
  -- section E below, and the read path publishes a currency only when this column names an author.
  -- Without it, dropping that default would convert a fabricated currency into an unpublishable
  -- genuine one — a fabricated withholding. Both halves are in this migration for that reason.
  ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS currency_source               text;

  -- C. One vocabulary CHECK per provenance column. Written as a loop because the rule is
  --    identical for all seven; per-column constraints (rather than one combined CHECK) so a
  --    violation names the column that violated it.
  FOREACH v_col IN ARRAY c_source_cols LOOP
    v_conname := 'vehicles_' || v_col || '_vocabulary';
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = v_oid AND conname = v_conname) THEN
      EXECUTE format(
        'ALTER TABLE public.vehicles ADD CONSTRAINT %I CHECK (%I IS NULL OR %I = ANY (%L::text[]))',
        v_conname, v_col, v_col, c_sources);
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = v_oid AND conname = 'vehicles_listing_location_visibility_vocabulary'
  ) THEN
    EXECUTE format(
      'ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_listing_location_visibility_vocabulary '
      || 'CHECK (listing_location_visibility IS NULL OR listing_location_visibility = ANY (%L::text[]))',
      c_visibility);
  END IF;

  -- D. NO LOCATION FACT WITHOUT PROVENANCE, enforced by the database.
  --    Every existing row satisfies this trivially: all five columns were created NULL a few
  --    statements ago, so the validating scan cannot fail here — which is why it is added
  --    validated rather than NOT VALID.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = v_oid AND conname = 'vehicles_listing_location_requires_source'
  ) THEN
    ALTER TABLE public.vehicles
      ADD CONSTRAINT vehicles_listing_location_requires_source CHECK (
        listing_location_source IS NOT NULL
        OR (listing_city                 IS NULL
        AND listing_province             IS NULL
        AND listing_country              IS NULL
        AND listing_location_visibility  IS NULL
        AND listing_location_recorded_at IS NULL)
      );
  END IF;

  -- E. Stop the fabrication at the source. Catalog-only: DROP DEFAULT rewrites no row, and
  --    ALTER ... DROP DEFAULT on a column that already has none is a no-op, so this is
  --    idempotent without a guard.
  FOREACH v_col IN ARRAY c_defaulted LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = v_col
    ) THEN
      EXECUTE format('ALTER TABLE public.vehicles ALTER COLUMN %I DROP DEFAULT', v_col);
    END IF;
  END LOOP;

  RAISE NOTICE '[issue-164-p4] listing location + claim provenance added; % fabricating default(s) removed. No row was written.',
    array_length(c_defaulted, 1);
END
$issue164_p4_apply$;

-- ─────────────────────────────────────────────────────────────────────────────
-- POSTCONDITION — prove the end state, and prove no existing data moved.
-- ─────────────────────────────────────────────────────────────────────────────
DO $issue164_p4_post$
DECLARE
  c_new_cols     text[] := ARRAY[
    'listing_city', 'listing_province', 'listing_country',
    'listing_location_source', 'listing_location_visibility', 'listing_location_recorded_at',
    'registration_country_source', 'registration_authority_source',
    'registration_status_source', 'plate_status_source', 'current_seller_type_source',
    'currency_source'
  ];
  c_defaulted    text[] := ARRAY[
    'registration_country', 'registration_authority', 'registration_status',
    'plate_status', 'current_seller_type', 'currency'
  ];
  c_constraints  text[] := ARRAY[
    'vehicles_listing_location_source_vocabulary',
    'vehicles_registration_country_source_vocabulary',
    'vehicles_registration_authority_source_vocabulary',
    'vehicles_registration_status_source_vocabulary',
    'vehicles_plate_status_source_vocabulary',
    'vehicles_current_seller_type_source_vocabulary',
    'vehicles_currency_source_vocabulary',
    'vehicles_listing_location_visibility_vocabulary',
    'vehicles_listing_location_requires_source'
  ];
  v_oid          regclass;
  v_missing_col  text;
  v_missing_con  text;
  v_not_null     text;
  v_has_default  text;
  v_kept_default text;
  v_backfilled   text;
  v_pre_rows     bigint;
  v_pre_digest   text;
  v_now_rows     bigint;
  v_now_digest   text;
BEGIN
  -- Nested rather than `IF a IS NULL OR b IS NULL`: PostgreSQL does not guarantee short-circuit
  -- evaluation of OR, and the second probe is only meaningful once the first has passed.
  v_oid := to_regclass('public.vehicles');
  IF v_oid IS NULL THEN
    RETURN;
  END IF;
  IF to_regclass('pg_temp.issue164_p4_preimage') IS NULL THEN
    RETURN;
  END IF;

  -- 1. Every new column exists.
  SELECT string_agg(c.name, ', ' ORDER BY c.name) INTO v_missing_col
    FROM unnest(c_new_cols) AS c(name)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = c.name);

  -- Raised here rather than with the others below: assertions 5 and 6 name these columns in SQL,
  -- so a missing one would surface as an unrelated "column does not exist" error instead of this.
  IF v_missing_col IS NOT NULL THEN
    RAISE EXCEPTION '[issue-164-p4] new column(s) missing after apply: %', v_missing_col
      USING ERRCODE = 'invalid_table_definition';
  END IF;

  -- 2. Every new column is NULLABLE. A NOT NULL provenance column would force the write path to
  --    invent a source for every insert, which is the failure mode this migration exists to stop.
  SELECT string_agg(column_name, ', ' ORDER BY column_name) INTO v_not_null
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'vehicles'
     AND column_name = ANY (c_new_cols) AND is_nullable = 'NO';

  -- 3. NO new column carries a DEFAULT. A default here would hand every row a location or a
  --    provenance it never had — the same defect this migration removes, one level up.
  SELECT string_agg(column_name || ' => ' || column_default, ', ' ORDER BY column_name)
    INTO v_has_default
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'vehicles'
     AND column_name = ANY (c_new_cols) AND column_default IS NOT NULL;

  -- 4. The five fabricating defaults are gone.
  SELECT string_agg(column_name || ' => ' || column_default, ', ' ORDER BY column_name)
    INTO v_kept_default
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'vehicles'
     AND column_name = ANY (c_defaulted) AND column_default IS NOT NULL;

  -- 5. NOTHING WAS BACKFILLED. Every new column must be NULL on every row. Counted directly
  --    rather than assumed from "we wrote no UPDATE", so a future edit that adds a backfill
  --    fails this assertion instead of shipping invented cities.
  SELECT string_agg(x.col || '=' || x.n, ', ' ORDER BY x.col) INTO v_backfilled
    FROM (
      SELECT 'listing_city'                  AS col, count(listing_city)                  AS n FROM public.vehicles
      UNION ALL SELECT 'listing_province',                  count(listing_province)                  FROM public.vehicles
      UNION ALL SELECT 'listing_country',                   count(listing_country)                   FROM public.vehicles
      UNION ALL SELECT 'listing_location_source',           count(listing_location_source)           FROM public.vehicles
      UNION ALL SELECT 'listing_location_visibility',       count(listing_location_visibility)       FROM public.vehicles
      UNION ALL SELECT 'listing_location_recorded_at',      count(listing_location_recorded_at)      FROM public.vehicles
      UNION ALL SELECT 'registration_country_source',       count(registration_country_source)       FROM public.vehicles
      UNION ALL SELECT 'registration_authority_source',     count(registration_authority_source)     FROM public.vehicles
      UNION ALL SELECT 'registration_status_source',        count(registration_status_source)        FROM public.vehicles
      UNION ALL SELECT 'plate_status_source',               count(plate_status_source)               FROM public.vehicles
      UNION ALL SELECT 'current_seller_type_source',        count(current_seller_type_source)        FROM public.vehicles
      UNION ALL SELECT 'currency_source',                   count(currency_source)                   FROM public.vehicles
    ) AS x
   WHERE x.n > 0;

  -- 6. NO EXISTING DATA WAS REWRITTEN. Same row count, same digest over every column this
  --    migration could have touched, before and after.
  SELECT row_count, digest INTO v_pre_rows, v_pre_digest FROM issue164_p4_preimage;
  SELECT count(*),
         coalesce(md5(string_agg(
           vin
           || chr(1) || coalesce(registration_country,   chr(2))
           || chr(1) || coalesce(registration_authority, chr(2))
           || chr(1) || coalesce(registration_status,    chr(2))
           || chr(1) || coalesce(plate_status,           chr(2))
           || chr(1) || coalesce(current_seller_type,    chr(2))
           || chr(1) || coalesce(currency,               chr(2)),
           chr(3) ORDER BY vin)), '')
    INTO v_now_rows, v_now_digest
    FROM public.vehicles;

  -- 7. Every constraint is present AND validated. An unvalidated CHECK would let a pre-existing
  --    violation survive and would make the "requires source" rule advisory.
  SELECT string_agg(c.name, ', ' ORDER BY c.name) INTO v_missing_con
    FROM unnest(c_constraints) AS c(name)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_constraint
      WHERE conrelid = v_oid AND conname = c.name AND contype = 'c' AND convalidated);

  IF v_missing_con IS NOT NULL THEN
    RAISE EXCEPTION '[issue-164-p4] missing or unvalidated constraint(s): %', v_missing_con
      USING ERRCODE = 'invalid_table_definition';
  END IF;
  IF v_not_null IS NOT NULL THEN
    RAISE EXCEPTION '[issue-164-p4] new column(s) are NOT NULL: %. A required provenance column forces the write path to invent one.', v_not_null
      USING ERRCODE = 'invalid_table_definition';
  END IF;
  IF v_has_default IS NOT NULL THEN
    RAISE EXCEPTION '[issue-164-p4] new column(s) carry a DEFAULT: %. A defaulted location or provenance column is the fabrication this migration removes.', v_has_default
      USING ERRCODE = 'invalid_table_definition';
  END IF;
  IF v_kept_default IS NOT NULL THEN
    RAISE EXCEPTION '[issue-164-p4] fabricating DEFAULT(s) survive: %', v_kept_default
      USING ERRCODE = 'invalid_table_definition';
  END IF;
  IF v_backfilled IS NOT NULL THEN
    RAISE EXCEPTION '[issue-164-p4] a new column is populated (%) — this migration must not backfill: there is no honest value to write for an existing listing.', v_backfilled
      USING ERRCODE = 'invalid_table_definition';
  END IF;
  IF v_now_rows <> v_pre_rows OR v_now_digest <> v_pre_digest THEN
    RAISE EXCEPTION '[issue-164-p4] existing vehicle data changed (rows %->%, digest %->%). This migration is additive and catalog-only.',
      v_pre_rows, v_now_rows, v_pre_digest, v_now_digest
      USING ERRCODE = 'invalid_table_definition';
  END IF;

  RAISE NOTICE '[issue-164-p4] verified: % new nullable column(s), 0 backfilled, % default(s) dropped, % row(s) unchanged.',
    array_length(c_new_cols, 1), array_length(c_defaulted, 1), v_now_rows;
END
$issue164_p4_post$;

-- +migrate Down
-- Reversing this would restore the column DEFAULTs that assert a registration authority, a
-- registration status, a plate status and a price currency for every vehicle in the table — 16 of
-- 16 on staging, with zero application writers behind any of them — and would drop the only place a
-- listing's location, and the only place a stated currency's author, can be recorded. That is the
-- fabrication this migration exists to stop, so reversal is a DELIBERATE OPERATOR ACTION rather
-- than an executable Down.
--
-- The reverse shape, for reference only. Restore the defaults FIRST if any write path still
-- depends on them, and note that dropping the columns DESTROYS every location a seller has
-- recorded since this migration was applied:
--   ALTER TABLE public.vehicles ALTER COLUMN registration_country   SET DEFAULT '<code>';
--   ALTER TABLE public.vehicles ALTER COLUMN registration_authority SET DEFAULT '<authority>';
--   ALTER TABLE public.vehicles ALTER COLUMN registration_status    SET DEFAULT '<status>';
--   ALTER TABLE public.vehicles ALTER COLUMN plate_status           SET DEFAULT '<status>';
--   ALTER TABLE public.vehicles ALTER COLUMN current_seller_type    SET DEFAULT '<label>';
--   ALTER TABLE public.vehicles ALTER COLUMN currency               SET DEFAULT '<currency>';
--   ALTER TABLE public.vehicles DROP COLUMN listing_city, ... ;     -- data loss
-- The literal values are intentionally not written out here: this file must not be the place a
-- future reader copies a fabricated default from. Recover them from the pre-change catalog dump
-- (docs/canonical-vehicle-truth/SELLER_LOCATION_CONTRACT.md records the inventory query).
--
-- Forward-fix is preferred: every statement above is additive or catalog-only and is individually
-- reversible with a targeted ALTER.
SELECT 1;
