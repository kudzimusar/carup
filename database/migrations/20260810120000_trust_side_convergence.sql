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
--   · FAIL-CLOSED timestamp conversion: every non-NULL "timestamp" must BOTH
--     cast to timestamptz AND carry an explicit zone (trailing Z or ±HH[:MM])
--     so the conversion is deterministic regardless of session TimeZone.
--     Any violation RAISEs — the transaction rolls back and nothing is
--     ledgered.
--   · FRESH databases: every step no-ops when the tables are absent;
--     20260809100000 (later in the manifest's apply order... this migration
--     runs FIRST) then fresh-creates the canonical shape.
--   · Schema-relative (current_schema()) so the identical bytes can be
--     proven against a fixture schema reproducing the production legacy
--     shape without touching canonical tables.
--   · Idempotent: a rerun on an already-converged database changes nothing.
--   · Ends with a fail-closed shape assertion: if the final shape still
--     diverges, the migration RAISEs and cannot be ledgered.

-- Deterministic-cast test helper (session-temporary; disappears with the
-- session; OR REPLACE keeps a same-session rerun idempotent).
CREATE OR REPLACE FUNCTION pg_temp.carup_ts_castable(t text) RETURNS boolean
LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM t::timestamptz;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END $f$;

DO $$
DECLARE
  v_bad  integer;
  v_type text;
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
         AND NOT (
           pg_temp.carup_ts_castable("timestamp")
           AND "timestamp" ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)[[:space:]]*$'
         );
      IF v_bad > 0 THEN
        RAISE EXCEPTION '[trust-convergence] % trust_score_history."timestamp" value(s) cannot be converted deterministically (must cast to timestamptz AND carry an explicit zone) — refusing; nothing is ledgered.', v_bad
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
