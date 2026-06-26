-- +migrate Up
-- Supabase pg_cron scheduler for automatic communication worker invocation.
--
-- Replaces the Vercel Cron approach: Vercel Hobby does not support sub-daily
-- schedules, and per-minute scheduling is required to meet the 60-second
-- delivery SLA for Telegram and other external channels.
--
-- Architecture: Supabase pg_cron fires every minute and calls pg_net to POST
-- to the secured /api/internal/communications/process endpoint. Secrets are
-- never stored in SQL; they are read at execution time from Supabase Vault.
--
-- Prerequisites (manual steps before activating):
--   1. Enable pg_cron:  Dashboard → Database → Extensions → pg_cron
--   2. Enable pg_net:   Dashboard → Database → Extensions → pg_net
--   3. Add Vault secrets (run once in SQL editor, never commit values):
--        SELECT vault.create_secret(
--          'https://<your-backend>.vercel.app/api/internal/communications/process',
--          'CARUP_WORKER_ENDPOINT_URL'
--        );
--        SELECT vault.create_secret(
--          '<value of COMMUNICATION_WORKER_SECRET env var>',
--          'CARUP_WORKER_SECRET'
--        );
--
-- Staging activation:  run this migration against staging Supabase.
-- Production activation: run manually after staging tests pass.
-- This migration does NOT activate production automatically.

-- ── 1. Health-reporting RPC function ──────────────────────────────────────────
-- Exposes pg_cron job status and HTTP invocation history to the backend
-- health endpoint without leaking Vault secret values.

CREATE OR REPLACE FUNCTION get_communication_scheduler_health()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pg_cron_available  BOOLEAN := FALSE;
  v_pg_net_available   BOOLEAN := FALSE;
  v_job_name           TEXT    := 'carup-communication-worker-every-minute';
  v_job_configured     BOOLEAN := FALSE;
  v_job_config         JSON    := NULL;
  v_latest_run         JSON    := NULL;
  v_latest_success     JSON    := NULL;
  v_latest_failure     JSON    := NULL;
  v_latest_http        JSON    := NULL;
  v_stale_count        INTEGER := 0;
BEGIN
  -- Detect installed extensions
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO v_pg_cron_available;
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')  INTO v_pg_net_available;

  -- Job configuration
  IF v_pg_cron_available THEN
    BEGIN
      SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_job_name) INTO v_job_configured;
      IF v_job_configured THEN
        SELECT json_build_object(
          'jobname',  jobname,
          'schedule', schedule,
          'active',   active
        ) INTO v_job_config
        FROM cron.job
        WHERE jobname = v_job_name
        LIMIT 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    -- Latest run (any status)
    BEGIN
      SELECT json_build_object(
        'start_time',      start_time,
        'end_time',        end_time,
        'status',          status,
        'return_message',  return_message
      ) INTO v_latest_run
      FROM cron.job_run_details jrd
      JOIN cron.job j ON j.jobid = jrd.jobid
      WHERE j.jobname = v_job_name
      ORDER BY start_time DESC
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- Latest successful run
    BEGIN
      SELECT json_build_object(
        'start_time', start_time,
        'end_time',   end_time,
        'status',     status
      ) INTO v_latest_success
      FROM cron.job_run_details jrd
      JOIN cron.job j ON j.jobid = jrd.jobid
      WHERE j.jobname = v_job_name AND jrd.status = 'succeeded'
      ORDER BY start_time DESC
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- Latest failed run
    BEGIN
      SELECT json_build_object(
        'start_time',     start_time,
        'end_time',       end_time,
        'status',         status,
        'return_message', return_message
      ) INTO v_latest_failure
      FROM cron.job_run_details jrd
      JOIN cron.job j ON j.jobid = jrd.jobid
      WHERE j.jobname = v_job_name AND jrd.status = 'failed'
      ORDER BY start_time DESC
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- Latest pg_net HTTP response from the worker endpoint (status only, no body)
  IF v_pg_net_available THEN
    BEGIN
      SELECT json_build_object(
        'status_code', status_code,
        'created',     created,
        'timed_out',   timed_out
      ) INTO v_latest_http
      FROM net._http_response
      ORDER BY created DESC
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- Stale processing locks (notification_queue rows locked >15 min)
  BEGIN
    SELECT COUNT(*) INTO v_stale_count
    FROM public.notification_queue
    WHERE lower(status) = 'processing'
      AND locked_at IS NOT NULL
      AND locked_at < now() - INTERVAL '15 minutes';
  EXCEPTION WHEN OTHERS THEN
    v_stale_count := 0;
  END;

  RETURN json_build_object(
    'scheduler_type',    'supabase_cron',
    'pg_cron_available', v_pg_cron_available,
    'pg_net_available',  v_pg_net_available,
    'job_name',          v_job_name,
    'job_configured',    v_job_configured,
    'job_config',        v_job_config,
    'latest_run',        v_latest_run,
    'latest_success',    v_latest_success,
    'latest_failure',    v_latest_failure,
    'latest_http_call',  v_latest_http,
    'stale_lock_count',  v_stale_count
  );
END;
$$;

REVOKE ALL ON FUNCTION get_communication_scheduler_health() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_communication_scheduler_health() FROM anon;
REVOKE EXECUTE ON FUNCTION get_communication_scheduler_health() FROM authenticated;
GRANT EXECUTE ON FUNCTION get_communication_scheduler_health() TO service_role;


-- ── 2. Cron job scheduling ────────────────────────────────────────────────────
-- Creates the every-minute job only when both pg_cron and pg_net are installed.
-- Reads endpoint URL and auth secret from Supabase Vault at job execution time.
-- Idempotent: unschedules then recreates if the job already exists.
-- Does NOT activate production automatically — run manually after staging tests.

DO $$
DECLARE
  v_job_name           TEXT    := 'carup-communication-worker-every-minute';
  v_pg_cron_available  BOOLEAN := FALSE;
  v_pg_net_available   BOOLEAN := FALSE;
  v_vault_url_exists   BOOLEAN := FALSE;
  v_vault_secret_exists BOOLEAN := FALSE;
  v_job_command        TEXT;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO v_pg_cron_available;
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')  INTO v_pg_net_available;

  IF NOT v_pg_cron_available THEN
    RAISE NOTICE '[carup-cron] pg_cron not installed. Skipping job setup. Enable it in the Supabase dashboard to activate automatic delivery.';
    RETURN;
  END IF;

  IF NOT v_pg_net_available THEN
    RAISE NOTICE '[carup-cron] pg_net not installed. Skipping job setup. Enable it in the Supabase dashboard to activate automatic delivery.';
    RETURN;
  END IF;

  -- Check Vault secrets (warn but do not block the migration)
  BEGIN
    SELECT EXISTS (
      SELECT 1 FROM vault.decrypted_secrets WHERE name = 'CARUP_WORKER_ENDPOINT_URL'
    ) INTO v_vault_url_exists;
    SELECT EXISTS (
      SELECT 1 FROM vault.decrypted_secrets WHERE name = 'CARUP_WORKER_SECRET'
    ) INTO v_vault_secret_exists;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF NOT v_vault_url_exists THEN
    RAISE NOTICE '[carup-cron] Vault secret CARUP_WORKER_ENDPOINT_URL not configured. '
      'Create it with: SELECT vault.create_secret(''<backend_url>/api/internal/communications/process'', ''CARUP_WORKER_ENDPOINT_URL'');';
  END IF;

  IF NOT v_vault_secret_exists THEN
    RAISE NOTICE '[carup-cron] Vault secret CARUP_WORKER_SECRET not configured. '
      'Create it with: SELECT vault.create_secret(''<worker_secret_value>'', ''CARUP_WORKER_SECRET'');';
  END IF;

  -- Job command: reads secrets from Vault at execution time, never at schedule time.
  -- Guard clause skips the HTTP call if either secret is absent.
  v_job_command := $CMD$
    SELECT net.http_post(
      url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CARUP_WORKER_ENDPOINT_URL' LIMIT 1),
      headers := json_build_object(
                   'Authorization', 'Bearer ' || (
                     SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CARUP_WORKER_SECRET' LIMIT 1
                   ),
                   'Content-Type', 'application/json'
                 )::jsonb,
      body    := '{"limit":10}'::jsonb
    ) AS request_id
    WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'CARUP_WORKER_ENDPOINT_URL')
      AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'CARUP_WORKER_SECRET');
  $CMD$;

  -- Idempotent: remove existing job before recreating
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_job_name) THEN
    PERFORM cron.unschedule(v_job_name);
    RAISE NOTICE '[carup-cron] Removed existing job "%" for re-creation.', v_job_name;
  END IF;

  PERFORM cron.schedule(v_job_name, '* * * * *', v_job_command);
  RAISE NOTICE '[carup-cron] Scheduled job "%" to run every minute.', v_job_name;
END $$;


-- +migrate Down
-- Unschedules the cron job and drops the helper function.
-- Safe to run on databases where pg_cron is not installed.

DO $$
DECLARE
  v_job_name TEXT := 'carup-communication-worker-every-minute';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_job_name) THEN
      PERFORM cron.unschedule(v_job_name);
      RAISE NOTICE '[carup-cron] Unscheduled job "%".', v_job_name;
    END IF;
  END IF;
END $$;

DROP FUNCTION IF EXISTS get_communication_scheduler_health();
