-- +migrate Up
-- =============================================================================
-- ISSUE #164 — CANONICAL VEHICLE TRUTH CLOSURE, PHASE 3
-- Give public.vehicles.trust_score the provenance stamp that demotes it from an
-- authority to a cache. ADDITIVE ONLY. NOT ONE EXISTING VALUE IS READ, REWRITTEN,
-- BACKFILLED OR DEFAULTED.
-- =============================================================================
--
-- MEASURED EVIDENCE THIS CLOSES (staging ref eoyenigwevnxwwhyhaer, PostgreSQL 17.6,
-- read-only probe taken while authoring this file):
--   public.vehicles                          16 rows
--   trust_score                              real, NULLABLE, DEFAULT 80.0
--   rows carrying a trust_score              16 of 16 (zero NULL)
--   distinct trust_score values              9, spanning 50.0 .. 96.8
--     96.8×1  91.2×1  90.0×2  84.5×1  84.0×1  82.0×1  80.0×4  74.0×1  50.0×4
--   authoritative records backing any of them:
--     zimra_declarations 0 · cid_clearance_records 0 · cvr_ownership_records 0
--     vid_inspections 0 · insurance_records 0 · zinara_licensing_records 0
--     trust_fact_requests 0 · vehicle_evidence 1
--
-- So sixteen vehicles publish a trust score between 50 and 96.8 with, between them,
-- ONE piece of evidence and ZERO records in all seven authoritative registers. The
-- numbers are real; what they mean is not recorded anywhere. There is no column that
-- says which engine produced 96.8, under which rules, or when — and four distinct code
-- paths still write the column (trustGraphService.js:435, trustEnforcementEngine.js:77
-- and :158, documentIntelligenceService.js:382, plus server.js:1517 stamping 50 at
-- creation), none of them stamping anything.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES, AND THE ONE THING IT REFUSES TO DO
-- ---------------------------------------------------------------------------
-- It adds six nullable columns that turn trust_score into a stamped cache:
--
--   trust_calculation_version  TEXT        which rules produced trust_score
--   trust_evaluated_at         TIMESTAMPTZ when those rules were applied
--   trust_band                 TEXT        the decision's own band, not a re-bucketing
--   trust_confidence           TEXT        evidence strength, kept SEPARATE from the score
--   trust_known_limitations    JSONB       what the score does NOT establish
--   trust_evidence_basis       JSONB       the provenance counts behind the score
--
-- IT DOES NOT BACKFILL, AND THAT IS THE POINT — NOT AN OMISSION TO BE FIXED LATER.
-- Issue #164 §7 forbids blind rewriting of historical data, and production carries
-- hand-set trust_score values that are the ONLY surviving copy of a human judgement.
-- A backfill in either direction destroys evidence: stamping the current version onto
-- them would launder unattributable numbers into canonical ones, and zeroing or
-- nulling them would delete a judgement nobody is authorised to delete here.
--
-- Leaving trust_calculation_version NULL is therefore the LOAD-BEARING behaviour, not
-- the absence of behaviour. backend/services/trustDecision/canonicalTrustService.js
-- classifies a row with no version as `unversioned` and refuses to publish its score,
-- so all 16 staging rows (and every production row) are demoted to `not_evaluated` by
-- this migration WITHOUT a single UPDATE. The stored numbers survive intact as the
-- historical artifact they are; they simply stop being published as truth. Reconciling
-- them is FACT_MODEL.md §5.2 M6 — a read-only diff and then a product decision, not a
-- schema change.
--
-- The postconditions below PROVE the no-rewrite claim rather than asserting it: a
-- checksum over (vin, trust_score) is taken before the ALTERs and compared after, and
-- the count of versioned rows is compared before and after. If a future edit adds a
-- backfill to this file, those assertions fail and the transaction rolls back.
--
-- ---------------------------------------------------------------------------
-- WHY EACH COLUMN, AND WHY NULLABLE WITH NO DEFAULT
-- ---------------------------------------------------------------------------
-- Every column is NULLABLE with NO DEFAULT, deliberately. The six public verification
-- booleans on this same table are `NOT NULL DEFAULT false` and that is precisely the
-- defect Phase 2 documented (FACT_MODEL.md §4.3): a DEFAULT answers a question before
-- it is asked, so `false` cannot be told apart from "never evaluated". A DEFAULT here
-- would recreate that on the trust cache. NULL means unevaluated, and only the one
-- writer may replace a NULL.
--
--   trust_calculation_version — the staleness key. A row whose value is not the running
--     CALCULATION_VERSION was produced by different rules and is not served (Principle 2).
--   trust_evaluated_at — a score with no instant cannot be shown to be current OR stale,
--     so the writer refuses to persist one; the column makes that refusal checkable.
--   trust_band — copied from decision.overall_trust.status, never re-derived. Storing it
--     stops a list surface from inventing its own thresholds over the number.
--   trust_confidence — Issue #164 §8 requires confidence to be SEPARATE from the score.
--     A single number cannot distinguish an unevidenced vehicle from a genuinely low one;
--     this column is the axis that can, and it is why the list path needs no recompute.
--   trust_known_limitations — Principle 3/4: what the score does not establish travels
--     WITH the score, so a card cannot render the number and drop the caveat.
--   trust_evidence_basis — the provenance counts (governed facts substantiated/adverse,
--     connected sources, unbacked legacy claims) that make a low score explainable
--     without a second query per card.
--
-- ---------------------------------------------------------------------------
-- ADDITIVE, FORWARD-ONLY, AND CHEAP ON A LIVE TABLE
-- ---------------------------------------------------------------------------
-- ADD COLUMN with no DEFAULT and no NOT NULL is a catalog-only operation in every
-- supported PostgreSQL version: it does not rewrite the heap and does not scan the
-- table. It takes a brief ACCESS EXCLUSIVE lock, which on a 16-row (and on a
-- production-sized) vehicles table is sub-millisecond. No existing column's type,
-- nullability or default is touched — including trust_score, whose definition is
-- captured and re-asserted unchanged below.
--
-- IDEMPOTENT BY CONSTRUCTION. Every ADD COLUMN is guarded on information_schema, the
-- index uses IF NOT EXISTS, and re-applying is a no-op that still runs every
-- postcondition. A database without public.vehicles is skipped with a NOTICE.
--
-- NO GRANTS AND NO POLICY CHANGES. public.vehicles already has RLS enabled with 2
-- policies and SELECT granted to anon and authenticated (measured). New columns inherit
-- the table ACL, so nothing is opened or closed here. That is acceptable on the merits:
-- all six columns are publication GOVERNORS — the version, the instant, the band, the
-- confidence, the caveats and the provenance counts — and every one of them is already
-- part of the public trust contract (canonicalTrustService.PUBLIC_TRUST_FIELDS). None
-- carries identity, contact or commercial data. Re-scoping vehicles' row policies is a
-- separate reviewed change and is out of scope for an additive migration.
--
-- ONE PARTIAL INDEX, on trust_calculation_version WHERE NOT NULL. Its only job is the
-- staleness sweep: after a CALCULATION_VERSION bump, the refresh worker must find the
-- rows still stamped with the old version. It is partial because — per the measurement
-- above — every existing row has NULL there, so a full index would be almost entirely
-- dead entries. It is not needed by the batch read path, which looks vehicles up by
-- primary key.
-- =============================================================================

DO $issue164_trust_cache$
DECLARE
  -- Column name / type, paired positionally. Kept as two arrays rather than a composite
  -- so the guarded ADD loop stays a plain FOR over an index.
  c_names text[] := ARRAY[
    'trust_calculation_version',
    'trust_evaluated_at',
    'trust_band',
    'trust_confidence',
    'trust_known_limitations',
    'trust_evidence_basis'
  ];
  c_types text[] := ARRAY[
    'text',
    'timestamptz',
    'text',
    'text',
    'jsonb',
    'jsonb'
  ];
  v_index               integer;
  v_added               text[] := ARRAY[]::text[];
  v_existing            text[] := ARRAY[]::text[];
  v_score_type_before   text;
  v_score_null_before   text;
  v_score_dflt_before   text;
  v_score_type_after    text;
  v_score_null_after    text;
  v_score_dflt_after    text;
  v_checksum_before     text;
  v_checksum_after      text;
  v_scored_before       bigint;
  v_scored_after        bigint;
  v_versioned_before    bigint := 0;
  v_versioned_after     bigint := 0;
  v_bad_columns         text;
BEGIN
  -- ───────────────────────────────────────────────────────────────────────────
  -- PRECONDITIONS. FAIL-LOUD, and BEFORE anything is added.
  -- ───────────────────────────────────────────────────────────────────────────
  IF to_regclass('public.vehicles') IS NULL THEN
    RAISE NOTICE '[issue-164-p3] public.vehicles is absent — nothing to stamp; skipping.';
    RETURN;
  END IF;

  SELECT data_type, is_nullable, coalesce(column_default, '')
    INTO v_score_type_before, v_score_null_before, v_score_dflt_before
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'trust_score';

  IF v_score_type_before IS NULL THEN
    RAISE EXCEPTION
      '[issue-164-p3] public.vehicles.trust_score does not exist; there is no cache to stamp. Refusing to add stamp columns for a value that is not there.'
      USING ERRCODE = 'undefined_column';
  END IF;

  -- Receipt taken BEFORE any change: this pair is what proves no value was rewritten.
  -- coalesce'd because trust_score is nullable — a NULL must checksum distinguishably
  -- rather than vanish from the aggregate.
  SELECT md5(coalesce(string_agg(vin || '=' || coalesce(trust_score::text, 'NULL'), ',' ORDER BY vin), '')),
         count(trust_score)
    INTO v_checksum_before, v_scored_before
    FROM public.vehicles;

  -- The versioned count can only be read if the column already exists (a re-apply). On a
  -- first apply it is legitimately 0, which is also what ADD COLUMN produces — so the
  -- before/after comparison is meaningful in both cases.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'vehicles'
       AND column_name = 'trust_calculation_version'
  ) THEN
    EXECUTE 'SELECT count(trust_calculation_version) FROM public.vehicles' INTO v_versioned_before;
  END IF;

  -- ───────────────────────────────────────────────────────────────────────────
  -- ADD THE STAMP. Guarded, nullable, no default, no backfill.
  -- ───────────────────────────────────────────────────────────────────────────
  FOR v_index IN 1..array_length(c_names, 1) LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'vehicles'
         AND column_name = c_names[v_index]
    ) THEN
      v_existing := v_existing || c_names[v_index];
      CONTINUE;
    END IF;

    -- %s for the type: it comes only from the c_types literal above, never from input.
    -- No DEFAULT and no NOT NULL — see the header on why a default would be the defect.
    EXECUTE format('ALTER TABLE public.vehicles ADD COLUMN %I %s', c_names[v_index], c_types[v_index]);
    v_added := v_added || c_names[v_index];
  END LOOP;

  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_vehicles_trust_cache_version '
       || 'ON public.vehicles (trust_calculation_version) '
       || 'WHERE trust_calculation_version IS NOT NULL';

  IF array_length(v_existing, 1) > 0 THEN
    RAISE NOTICE '[issue-164-p3] % stamp column(s) already present, left untouched: %',
      array_length(v_existing, 1), array_to_string(v_existing, ', ');
  END IF;
  RAISE NOTICE '[issue-164-p3] added % stamp column(s): %. No trust_score value was read or written.',
    coalesce(array_length(v_added, 1), 0),
    CASE WHEN array_length(v_added, 1) IS NULL THEN 'none' ELSE array_to_string(v_added, ', ') END;

  -- ───────────────────────────────────────────────────────────────────────────
  -- POSTCONDITIONS. Prove the end state before the transaction may commit.
  -- ───────────────────────────────────────────────────────────────────────────
  -- 1. Every stamp column exists, is NULLABLE, and has NO DEFAULT. A NOT NULL or a
  --    DEFAULT here would answer "has this been evaluated?" before it was asked.
  SELECT string_agg(missing.name || ':' || missing.why, ', ' ORDER BY missing.name)
    INTO v_bad_columns
    FROM (
      SELECT n.name,
             CASE
               WHEN c.column_name IS NULL THEN 'absent'
               WHEN c.is_nullable <> 'YES'  THEN 'not_nullable'
               ELSE 'has_default'
             END AS why
        FROM unnest(c_names) AS n(name)
        LEFT JOIN information_schema.columns c
               ON c.table_schema = 'public' AND c.table_name = 'vehicles'
              AND c.column_name = n.name
       WHERE c.column_name IS NULL
          OR c.is_nullable <> 'YES'
          OR c.column_default IS NOT NULL
    ) AS missing;

  IF v_bad_columns IS NOT NULL THEN
    RAISE EXCEPTION
      '[issue-164-p3] stamp column(s) are not in the required additive/nullable/no-default shape: %', v_bad_columns
      USING ERRCODE = 'invalid_table_definition';
  END IF;

  -- 2. trust_score itself is byte-for-byte the column it was. This migration demotes what
  --    the value MEANS; it does not touch the value or its definition.
  SELECT data_type, is_nullable, coalesce(column_default, '')
    INTO v_score_type_after, v_score_null_after, v_score_dflt_after
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'trust_score';

  IF v_score_type_after IS DISTINCT FROM v_score_type_before
     OR v_score_null_after IS DISTINCT FROM v_score_null_before
     OR v_score_dflt_after IS DISTINCT FROM v_score_dflt_before THEN
    RAISE EXCEPTION
      '[issue-164-p3] trust_score definition changed (% / % / % -> % / % / %); this migration is additive only.',
      v_score_type_before, v_score_null_before, v_score_dflt_before,
      v_score_type_after,  v_score_null_after,  v_score_dflt_after
      USING ERRCODE = 'invalid_table_definition';
  END IF;

  -- 3. NO DATA REWRITE. The checksum over (vin, trust_score) and the count of scored rows
  --    are identical to the receipt taken before the ALTERs. This is the assertion that
  --    fails if anyone ever adds a backfill to this file — which Issue #164 §7 forbids,
  --    because production's hand-set scores are the only copy of a human judgement.
  SELECT md5(coalesce(string_agg(vin || '=' || coalesce(trust_score::text, 'NULL'), ',' ORDER BY vin), '')),
         count(trust_score)
    INTO v_checksum_after, v_scored_after
    FROM public.vehicles;

  IF v_checksum_after IS DISTINCT FROM v_checksum_before OR v_scored_after <> v_scored_before THEN
    RAISE EXCEPTION
      '[issue-164-p3] trust_score data changed during an additive migration (checksum % -> %, scored rows % -> %). Refusing to commit; Issue #164 §7 forbids blind rewriting of historical scores.',
      v_checksum_before, v_checksum_after, v_scored_before, v_scored_after
      USING ERRCODE = 'data_exception';
  END IF;

  -- 4. NO STAMP WAS INVENTED. Not one row gained a calculation version here. Every legacy
  --    score stays unversioned, which is exactly what demotes it: canonicalTrustService
  --    will not publish a score whose rules are unknown.
  EXECUTE 'SELECT count(trust_calculation_version) FROM public.vehicles' INTO v_versioned_after;

  IF v_versioned_after <> v_versioned_before THEN
    RAISE EXCEPTION
      '[issue-164-p3] % row(s) gained a trust_calculation_version during this migration (% -> %). Stamping an existing score as canonical would launder an unattributable number; only backend/services/trustDecision/canonicalTrustService.js may write that column.',
      v_versioned_after - v_versioned_before, v_versioned_before, v_versioned_after
      USING ERRCODE = 'data_exception';
  END IF;

  RAISE NOTICE '[issue-164-p3] verified: % scored row(s) unchanged (checksum %), % row(s) versioned — unchanged.',
    v_scored_after, v_checksum_after, v_versioned_after;
END
$issue164_trust_cache$;

-- +migrate Down
-- Reversing this drops the ONLY record of which rules produced each cached trust score,
-- which does not restore a previous state — it returns public.vehicles to the state this
-- programme exists to end, where a number between 50 and 96.8 is published with nothing
-- saying where it came from. Any score written by canonicalTrustService after this
-- migration would become indistinguishable from the legacy hand-set values the moment its
-- stamp is dropped. Reversal is therefore a DELIBERATE OPERATOR ACTION, not an executable
-- Down.
--
-- The reverse shape, for reference only:
--   DROP INDEX IF EXISTS public.idx_vehicles_trust_cache_version;
--   ALTER TABLE public.vehicles
--     DROP COLUMN IF EXISTS trust_calculation_version,   -- destroys the staleness key
--     DROP COLUMN IF EXISTS trust_evaluated_at,
--     DROP COLUMN IF EXISTS trust_band,
--     DROP COLUMN IF EXISTS trust_confidence,
--     DROP COLUMN IF EXISTS trust_known_limitations,
--     DROP COLUMN IF EXISTS trust_evidence_basis;
--
-- Forward-fix is preferred and is cheap here: the Up is catalog-only and writes no row, so
-- a database that has applied it and written no canonical score is already equivalent to
-- one that has not. If the columns must go, capture them first:
--   SELECT vin, trust_score, trust_calculation_version, trust_evaluated_at, trust_band,
--          trust_confidence, trust_known_limitations, trust_evidence_basis
--     FROM public.vehicles ORDER BY vin;
SELECT 1;
