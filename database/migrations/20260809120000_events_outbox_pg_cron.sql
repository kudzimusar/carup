-- +migrate Up
-- Supabase pg_cron scheduler for the domain-event outbox drain (seam-E).
--
-- Replaces the backend/vercel.json cron for /api/internal/events/process:
-- Vercel Hobby rejects sub-daily cron schedules AT DEPLOY TIME, so a
-- '* * * * *' entry in vercel.json fails every carup-backend deployment
-- (the exact hazard 20260626120000_communication_supabase_cron.sql solved
-- for the communications delivery worker — this migration applies the same
-- architecture to the events outbox).
--
-- Architecture: pg_cron fires every minute and calls pg_net to POST to the
-- secured /api/internal/events/process endpoint, which runs ONE bounded
-- eventWorker poll cycle (and refuses to consume the outbox on an unarmed
-- instance — see processEventOutboxBatch in backend/routes/communicationRoutes.js).
-- Secrets are never stored in SQL; they are read at execution time from
-- Supabase Vault.
--
-- FAIL-CLOSED SEMANTICS: pg_cron and pg_net are HARD prerequisites. If either
-- extension is absent this migration RAISES and must not be recorded in the
-- migration ledger — a ledgered "success" that silently created no scheduler
-- would be a lie about production capability. Enable both BEFORE applying:
--   Dashboard → Database → Extensions → pg_cron
--   Dashboard → Database → Extensions → pg_net
--
-- ACTIVATION GATE (deliberately NOT fail-closed): the Vault secrets
-- CARUP_EVENTS_ENDPOINT_URL and CARUP_WORKER_SECRET may be created after
-- apply. Until both exist, the scheduled job's command is a no-op by
-- construction — its WHERE EXISTS guard skips the HTTP call — which is safe
-- (nothing is consumed, nothing is sent) and verifiable (cron.job row exists;
-- net._http_response stays empty of events-drain calls). Create the URL
-- secret with:
--        SELECT vault.create_secret(
--          'https://<your-backend>.vercel.app/api/internal/events/process',
--          'CARUP_EVENTS_ENDPOINT_URL'
--        );
--      The auth secret is shared with the communications worker
--      (CARUP_WORKER_SECRET) — both endpoints are guarded by the same
--      requireWorkerSecret check, so no new auth secret is needed.
--
-- Staging activation:  via the reviewed staging dispatcher workflow only.
-- Production activation: owner-gated via the PR #141 publication-gate runner.
-- This migration does NOT activate production automatically.

DO $$
DECLARE
  v_job_name            TEXT    := 'carup-events-outbox-every-minute';
  v_pg_cron_available   BOOLEAN := FALSE;
  v_pg_net_available    BOOLEAN := FALSE;
  v_vault_url_exists    BOOLEAN := FALSE;
  v_vault_secret_exists BOOLEAN := FALSE;
  v_job_command         TEXT;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO v_pg_cron_available;
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')  INTO v_pg_net_available;

  -- Fail-closed: refuse to be recorded as applied while creating nothing.
  IF NOT v_pg_cron_available THEN
    RAISE EXCEPTION '[carup-events-cron] pg_cron is not installed — refusing to apply. Enable it (Dashboard -> Database -> Extensions -> pg_cron) and re-run.'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  IF NOT v_pg_net_available THEN
    RAISE EXCEPTION '[carup-events-cron] pg_net is not installed — refusing to apply. Enable it (Dashboard -> Database -> Extensions -> pg_net) and re-run.'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  -- Check Vault secrets (warn but do not block the migration)
  BEGIN
    SELECT EXISTS (
      SELECT 1 FROM vault.decrypted_secrets WHERE name = 'CARUP_EVENTS_ENDPOINT_URL'
    ) INTO v_vault_url_exists;
    SELECT EXISTS (
      SELECT 1 FROM vault.decrypted_secrets WHERE name = 'CARUP_WORKER_SECRET'
    ) INTO v_vault_secret_exists;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF NOT v_vault_url_exists THEN
    RAISE NOTICE '[carup-events-cron] Vault secret CARUP_EVENTS_ENDPOINT_URL not configured. '
      'Create it with: SELECT vault.create_secret(''<backend_url>/api/internal/events/process'', ''CARUP_EVENTS_ENDPOINT_URL'');';
  END IF;

  IF NOT v_vault_secret_exists THEN
    RAISE NOTICE '[carup-events-cron] Vault secret CARUP_WORKER_SECRET not configured. '
      'Create it with: SELECT vault.create_secret(''<worker_secret_value>'', ''CARUP_WORKER_SECRET'');';
  END IF;

  -- Job command: reads secrets from Vault at execution time, never at schedule time.
  -- Guard clause skips the HTTP call if either secret is absent.
  v_job_command := $CMD$
    SELECT net.http_post(
      url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CARUP_EVENTS_ENDPOINT_URL' LIMIT 1),
      headers := json_build_object(
                   'Authorization', 'Bearer ' || (
                     SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CARUP_WORKER_SECRET' LIMIT 1
                   ),
                   'Content-Type', 'application/json'
                 )::jsonb,
      body    := '{}'::jsonb
    ) AS request_id
    WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'CARUP_EVENTS_ENDPOINT_URL')
      AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'CARUP_WORKER_SECRET');
  $CMD$;

  -- Idempotent: remove existing job before recreating
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_job_name) THEN
    PERFORM cron.unschedule(v_job_name);
    RAISE NOTICE '[carup-events-cron] Removed existing job "%" for re-creation.', v_job_name;
  END IF;

  PERFORM cron.schedule(v_job_name, '* * * * *', v_job_command);
  RAISE NOTICE '[carup-events-cron] Scheduled job "%" to run every minute.', v_job_name;
END $$;


-- +migrate Down
-- Unschedules the events outbox cron job.
-- Safe to run on databases where pg_cron is not installed.

DO $$
DECLARE
  v_job_name TEXT := 'carup-events-outbox-every-minute';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_job_name) THEN
      PERFORM cron.unschedule(v_job_name);
      RAISE NOTICE '[carup-events-cron] Unscheduled job "%".', v_job_name;
    END IF;
  END IF;
END $$;
