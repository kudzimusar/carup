-- +migrate Up
-- CarUp Intelligence 1.0 — post-review hardening.
--
-- 1. ERASURE MUST NOT REWRITE HISTORY.
--    intelligence_erase_actor also nulled pseudonymous_session_key. That key is
--    the uniqueness key, so recomputing an already-certified day AFTER an erasure
--    silently lowered its unique counts while total views stayed the same. Both
--    the contract (§5.5) and the original migration header promise "aggregates are
--    unaffected", so the code was wrong, not the promise. Erasure now tombstones
--    only the direct identifier; the session key is already pseudonymous and, once
--    the user id is gone, no longer links to a person.
--
-- 2. INGESTION COUNTERS MUST BE ATOMIC.
--    The service did SELECT-then-UPSERT, so two concurrent ingests in the same
--    hour both read N and both wrote N+1 — losing counts in exactly the module
--    whose purpose is to make loss visible.
--
-- Idempotent and safe to re-apply. STAGING-ONLY until the Product Owner approves
-- a production apply.

CREATE OR REPLACE FUNCTION intelligence_erase_actor(p_user_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_user_id IS NULL OR char_length(p_user_id) = 0 THEN
    RAISE EXCEPTION 'intelligence_erase_actor requires a user id';
  END IF;
  UPDATE marketplace_activity_events
     SET authenticated_user_id = NULL,
         identity_erased_at = now()
   WHERE authenticated_user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION intelligence_erase_actor(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION intelligence_erase_actor(TEXT) FROM anon;
REVOKE ALL ON FUNCTION intelligence_erase_actor(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION intelligence_erase_actor(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION intelligence_bump_ingestion_stats(
  p_window_start TIMESTAMPTZ,
  p_received INTEGER DEFAULT 0,
  p_accepted INTEGER DEFAULT 0,
  p_rejected INTEGER DEFAULT 0,
  p_duplicate INTEGER DEFAULT 0,
  p_flagged INTEGER DEFAULT 0,
  p_opened_without_context INTEGER DEFAULT 0,
  p_storage_failures INTEGER DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO intelligence_ingestion_stats AS s (
    window_start, events_received, events_accepted, events_rejected,
    events_duplicate, events_flagged, opened_without_context, storage_failures
  ) VALUES (
    p_window_start, p_received, p_accepted, p_rejected,
    p_duplicate, p_flagged, p_opened_without_context, p_storage_failures
  )
  ON CONFLICT (window_start) DO UPDATE SET
    events_received        = s.events_received        + EXCLUDED.events_received,
    events_accepted        = s.events_accepted        + EXCLUDED.events_accepted,
    events_rejected        = s.events_rejected        + EXCLUDED.events_rejected,
    events_duplicate       = s.events_duplicate       + EXCLUDED.events_duplicate,
    events_flagged         = s.events_flagged         + EXCLUDED.events_flagged,
    opened_without_context = s.opened_without_context + EXCLUDED.opened_without_context,
    storage_failures       = s.storage_failures       + EXCLUDED.storage_failures;
END;
$$;

REVOKE ALL ON FUNCTION intelligence_bump_ingestion_stats(TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION intelligence_bump_ingestion_stats(TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION intelligence_bump_ingestion_stats(TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION intelligence_bump_ingestion_stats(TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER) TO service_role;

-- ── Rollback (manual) ───────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS intelligence_bump_ingestion_stats(TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER);
