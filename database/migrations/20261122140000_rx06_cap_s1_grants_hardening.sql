-- +migrate Up
-- RX06-LR04 CAP S1 — grant posture for the CAP-04, CAP-05 and R2 objects carried onto the R2C line.
-- Additive and idempotent: applying it twice changes nothing. No table, column, row or function body changes.
--  * The eight trigger functions run only as triggers; no one needs to call them, so EXECUTE is revoked from PUBLIC
--    (Postgres grants it to PUBLIC by default) and, where those roles exist, from anon and authenticated.
--    A trigger fires whatever the firing role's EXECUTE privilege, so the guards keep guarding.
--  * The seven tables are already closed to anon and authenticated by their own migrations. The service role (the
--    API's database identity) is granted SELECT: the journey is read-only in S1. Write grants come with the slices
--    that write.
DO $$
DECLARE
  fn text;
  r text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.carup_shipment_leg_guard()', 'public.carup_shipment_leg_no_delete()',
    'public.carup_shipment_observation_guard()', 'public.carup_shipment_observation_no_delete()',
    'public.carup_cap_recorded_fact_guard()', 'public.carup_cap_recorded_fact_no_delete()',
    'public.carup_document_dispatch_time_guard()', 'public.carup_vehicle_media_reference_check()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', fn, r);
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT ON public.diaspora_shipment_legs, public.diaspora_shipment_observations,
      public.diaspora_external_progress_entries, public.diaspora_order_parties, public.diaspora_document_dispatches,
      public.vehicle_specification_observations, public.vehicle_media_references TO service_role;
  END IF;
END $$;

-- +migrate Down
-- Nothing is restored: EXECUTE on these trigger functions is never handed back to PUBLIC, and the service role keeps
-- SELECT (removing it would only break the read-only journey).
SELECT 1;
