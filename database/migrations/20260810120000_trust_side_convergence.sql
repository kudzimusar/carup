-- +migrate Up
-- Converge PRE-EXISTING legacy trust-side tables to the runtime contract.
--
-- Production preflight-v2 (run 31360753528) found trust_score_history and
-- rolling_integrity_checkpoints already exist on production with a legacy
-- shape that diverges from 20260809100000_trust_side_tables.sql's contract:
--
--   trust_score_history.previous_score              REAL NOT NULL    -> REAL NULL
--   trust_score_history.new_score                   REAL NOT NULL    -> REAL NULL
--   trust_score_history.trigger_event               TEXT NOT NULL    -> TEXT NULL
--   trust_score_history."timestamp"                 TEXT NOT NULL    -> TIMESTAMPTZ NOT NULL
--   rolling_integrity_checkpoints.last_verified_event_id
--                                                   INTEGER NOT NULL -> BIGINT NULL
--
-- (id backing sequence and the vin-exact PK/UNIQUE are intact on production
-- and are asserted, not created, here.)
--
-- Design rules:
--   · ADDITIVE/CONVERGENT ONLY — no DROP TABLE, no recreate, every existing
--     row preserved; the only rewrite is the two ALTER TYPEs.
--   · FAIL-CLOSED timestamp conversion: every non-NULL "timestamp" must be a
--     real instant AND carry BOTH a time component and an explicit zone, so
--     the conversion is deterministic regardless of session TimeZone. A
--     date-only value ('2026-08-08') is rejected even though it casts and its
--     trailing '-08' superficially looks like an offset — PostgreSQL would
--     read it as midnight in the SESSION TimeZone, silently shifting the
--     represented instant. Any violation RAISEs — the transaction rolls back
--     and nothing is ledgered.
--   · CANONICAL VIN FK RESTORED: the legacy table carries only a PK on vin,
--     and 20260809100000's CREATE TABLE IF NOT EXISTS cannot add a constraint
--     to a pre-existing table, so without this convergence production would
--     keep accepting checkpoints for nonexistent VINs and retain orphans
--     after a vehicle is deleted. Added additively and idempotently, and
--     fail-closed on pre-existing orphan rows.
--   · FRESH databases: every step no-ops when the tables are absent;
--     20260809100000 (later in the manifest's apply order... this migration
--     runs FIRST) then fresh-creates the canonical shape.
--   · Schema-relative (current_schema()) so the identical bytes can be
--     proven against a fixture schema reproducing the production legacy
--     shape without touching canonical tables.
--   · Idempotent: a rerun on an already-converged database changes nothing.
--   · Ends with a fail-closed shape assertion: if the final shape still
--     diverges, the migration RAISEs and cannot be ledgered.

-- Deterministic-conversion test helper (session-temporary; disappears with
-- the session; OR REPLACE keeps a same-session rerun idempotent).
--
-- A value is convertible ONLY IF it carries date + time + an explicit zone
-- AND is a real instant. Accepted: '2026-08-08T12:30:00Z',
-- '2026-08-08 12:30:00+09', '2026-08-08T12:30:00.372+09:00', '...-05:00'.
-- Rejected: '2026-08-08' (date-only — castable, and its trailing '-08' even
-- matches an offset pattern, but Postgres reads it as midnight in the
-- session TimeZone), '2026-08-08 12:30:00' (no zone), 'not-a-timestamp'.
CREATE OR REPLACE FUNCTION pg_temp.carup_ts_deterministic(t text) RETURNS boolean
LANGUAGE plpgsql AS $f$
BEGIN
  IF t !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?[[:space:]]*([Zz]|[+-][0-9]{2}(:?[0-9]{2})?)[[:space:]]*$' THEN
    RETURN false;
  END IF;
  PERFORM t::timestamptz;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END $f$;

DO $$
DECLARE
  v_bad  integer;
  v_type text;
  v_fk   text;
  v_name text;
BEGIN
  IF to_regclass('trust_score_history') IS NULL THEN
    RAISE NOTICE '[trust-convergence] trust_score_history absent — fresh database, nothing to converge.';
  ELSE
    -- 1. Nullability: the runtime legitimately omits these on some paths.
    ALTER TABLE trust_score_history ALTER COLUMN previous_score DROP NOT NULL;
    ALTER TABLE trust_score_history ALTER COLUMN new_score      DROP NOT NULL;
    ALTER TABLE trust_score_history ALTER COLUMN trigger_event  DROP NOT NULL;

    -- 2. "timestamp": TEXT -> TIMESTAMPTZ, deterministically or not at all.
    SELECT data_type INTO v_type FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'trust_score_history' AND column_name = 'timestamp';
    IF v_type = 'text' THEN
      SELECT count(*) INTO v_bad FROM trust_score_history
       WHERE "timestamp" IS NOT NULL
         AND NOT pg_temp.carup_ts_deterministic("timestamp");
      IF v_bad > 0 THEN
        RAISE EXCEPTION '[trust-convergence] % trust_score_history."timestamp" value(s) cannot be converted deterministically (need date + time + explicit zone, e.g. 2026-08-08T12:30:00Z; date-only and zone-less values are refused) — refusing; nothing is ledgered.', v_bad
          USING ERRCODE = 'invalid_datetime_format';
      END IF;
      ALTER TABLE trust_score_history
        ALTER COLUMN "timestamp" TYPE timestamptz USING ("timestamp"::timestamptz);
    END IF;
    ALTER TABLE trust_score_history ALTER COLUMN "timestamp" SET DEFAULT now();
    ALTER TABLE trust_score_history ALTER COLUMN "timestamp" SET NOT NULL;
  END IF;

  IF to_regclass('rolling_integrity_checkpoints') IS NULL THEN
    RAISE NOTICE '[trust-convergence] rolling_integrity_checkpoints absent — fresh database, nothing to converge.';
  ELSE
    -- 3. last_verified_event_id: INTEGER -> BIGINT (pure widening), NULLABLE.
    SELECT data_type INTO v_type FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'rolling_integrity_checkpoints' AND column_name = 'last_verified_event_id';
    IF v_type IS DISTINCT FROM 'bigint' THEN
      ALTER TABLE rolling_integrity_checkpoints
        ALTER COLUMN last_verified_event_id TYPE bigint;
    END IF;
    ALTER TABLE rolling_integrity_checkpoints ALTER COLUMN last_verified_event_id DROP NOT NULL;

    -- 4. Canonical VIN foreign key: vehicles(vin) ON DELETE CASCADE.
    --    The legacy production table has a PK on vin but no FK, and
    --    20260809100000's CREATE TABLE IF NOT EXISTS cannot add one to an
    --    existing table — so this is where it must be restored.
    IF to_regclass('vehicles') IS NULL THEN
      RAISE EXCEPTION '[trust-convergence] vehicles table absent — cannot restore the rolling_integrity_checkpoints.vin foreign key; refusing.'
        USING ERRCODE = 'undefined_table';
    END IF;
    SELECT conname INTO v_fk FROM pg_constraint
     WHERE conrelid = to_regclass('rolling_integrity_checkpoints') AND contype = 'f'
       AND confrelid = to_regclass('vehicles') AND confdeltype = 'c'
       AND (SELECT array_agg(attname::text) FROM unnest(conkey) k JOIN pg_attribute a
             ON a.attrelid = conrelid AND a.attnum = k) = array['vin']
     LIMIT 1;
    IF v_fk IS NULL THEN
      -- Fail closed BEFORE touching the constraint: an orphaned checkpoint
      -- would otherwise abort the ALTER with an opaque engine error, and the
      -- orphans are a data question for an operator, not a migration.
      SELECT count(*) INTO v_bad FROM rolling_integrity_checkpoints c
       WHERE NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.vin = c.vin);
      IF v_bad > 0 THEN
        RAISE EXCEPTION '[trust-convergence] % rolling_integrity_checkpoints row(s) reference a nonexistent vehicles.vin — resolve the orphans before converging; refusing (nothing is ledgered).', v_bad
          USING ERRCODE = 'foreign_key_violation';
      END IF;
      -- Replace any non-canonical vin FK (e.g. one lacking ON DELETE CASCADE)
      -- so the end state is exactly the contract.
      FOR v_name IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = to_regclass('rolling_integrity_checkpoints') AND contype = 'f'
           AND (SELECT array_agg(attname::text) FROM unnest(conkey) k JOIN pg_attribute a
                 ON a.attrelid = conrelid AND a.attnum = k) = array['vin']
      LOOP
        EXECUTE format('ALTER TABLE rolling_integrity_checkpoints DROP CONSTRAINT %I', v_name);
        RAISE NOTICE '[trust-convergence] dropped non-canonical vin FK "%" for re-creation with ON DELETE CASCADE.', v_name;
      END LOOP;
      ALTER TABLE rolling_integrity_checkpoints
        ADD CONSTRAINT rolling_integrity_checkpoints_vin_fkey
        FOREIGN KEY (vin) REFERENCES vehicles(vin) ON DELETE CASCADE;
      RAISE NOTICE '[trust-convergence] restored rolling_integrity_checkpoints.vin -> vehicles(vin) ON DELETE CASCADE.';
    END IF;
  END IF;
END $$;

-- Fail-closed final contract: if the tables exist, their shape must now
-- match the runtime contract EXACTLY — otherwise RAISE, roll back, and stay
-- out of the ledger. (Fresh databases skip: nothing exists yet to assert.)
DO $$
DECLARE
  v_bad text[] := '{}';
  r record;
BEGIN
  IF to_regclass('trust_score_history') IS NOT NULL THEN
    FOR r IN
      SELECT * FROM (VALUES
        ('trust_score_history', 'previous_score', 'real', 'YES'),
        ('trust_score_history', 'new_score', 'real', 'YES'),
        ('trust_score_history', 'trigger_event', 'text', 'YES'),
        ('trust_score_history', 'timestamp', 'timestamp with time zone', 'NO')
      ) AS e(tab, col, typ, nul)
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = r.tab
           AND column_name = r.col AND data_type = r.typ AND is_nullable = r.nul
      ) THEN
        v_bad := v_bad || (r.tab || '.' || r.col);
      END IF;
    END LOOP;
    IF pg_get_serial_sequence(quote_ident(current_schema()) || '.trust_score_history', 'id') IS NULL THEN
      v_bad := v_bad || 'trust_score_history.id(sequence)';
    END IF;
  END IF;
  IF to_regclass('rolling_integrity_checkpoints') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'rolling_integrity_checkpoints'
         AND column_name = 'last_verified_event_id' AND data_type = 'bigint' AND is_nullable = 'YES'
    ) THEN
      v_bad := v_bad || 'rolling_integrity_checkpoints.last_verified_event_id';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = to_regclass('rolling_integrity_checkpoints') AND contype IN ('p','u')
         AND (SELECT array_agg(attname::text) FROM unnest(conkey) k JOIN pg_attribute a
               ON a.attrelid = conrelid AND a.attnum = k) = array['vin']
    ) THEN
      v_bad := v_bad || 'rolling_integrity_checkpoints.vin(pk/unique)';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = to_regclass('rolling_integrity_checkpoints') AND contype = 'f'
         AND confrelid = to_regclass('vehicles') AND confdeltype = 'c'
         AND (SELECT array_agg(attname::text) FROM unnest(conkey) k JOIN pg_attribute a
               ON a.attrelid = conrelid AND a.attnum = k) = array['vin']
         AND (SELECT array_agg(attname::text) FROM unnest(confkey) k JOIN pg_attribute a
               ON a.attrelid = confrelid AND a.attnum = k) = array['vin']
    ) THEN
      v_bad := v_bad || 'rolling_integrity_checkpoints.vin(fk->vehicles.vin ON DELETE CASCADE)';
    END IF;
  END IF;
  IF array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION '[trust-convergence] final shape still diverges (%) — refusing to be ledgered.', array_to_string(v_bad, ', ')
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END $$;

-- +migrate Down
-- Deliberate no-op. Reversing would re-impose NOT NULL on columns that may
-- legitimately hold NULLs written after convergence, and would narrow
-- bigint/timestamptz back to lossy legacy types. Recover via PITR if a
-- rollback is ever genuinely required.
SELECT 1;
