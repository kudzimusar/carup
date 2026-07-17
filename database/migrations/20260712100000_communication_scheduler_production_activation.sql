-- +migrate Up
-- Production activation of the communication worker scheduler (Agent 8).
--
-- Why this exists: 20260626120000_communication_supabase_cron.sql deliberately SKIPS job creation
-- when pg_cron/pg_net are not installed. Production (vhmnajoeicasaigiophh) was verified on
-- 2026-07-12 with pg_cron_available=false, pg_net_available=false, job_configured=false — the
-- extensions were never enabled, so no job was ever created. This migration completes activation:
-- it INSTALLS both extensions and (re)creates the single every-minute job idempotently.
--
-- Secret handling: the job command reads BOTH the endpoint URL and the worker secret from Supabase
-- Vault AT EXECUTION TIME. No secret value ever appears in this file, in cron.job.command, in logs,
-- or in health output. Prerequisite (run once in the SQL editor; never commit values):
--
--   SELECT vault.create_secret(
--     'https://carup-backend-staging.vercel.app/api/internal/communications/process',
--     'CARUP_WORKER_ENDPOINT_URL'
--   );
--   SELECT vault.create_secret('<COMMUNICATION_WORKER_SECRET value>', 'CARUP_WORKER_SECRET');
--
--   -- If a name already exists, update instead of create:
--   --   SELECT vault.update_secret(
--   --     (SELECT id FROM vault.secrets WHERE name = 'CARUP_WORKER_SECRET'),
--   --     '<new value>'
--   --   );
--
-- The job command is guard-clause protected: if either Vault secret is absent the scheduled run is
-- a harmless no-op (no HTTP call, no failed-auth noise) until the secrets are provisioned.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE
  v_job_name            TEXT    := 'carup-communication-worker-every-minute';
  v_vault_url_exists    BOOLEAN := FALSE;
  v_vault_secret_exists BOOLEAN := FALSE;
  v_job_command         TEXT;
BEGIN
  -- Vault presence (warn-only; the command below is self-guarding).
  BEGIN
    SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'CARUP_WORKER_ENDPOINT_URL') INTO v_vault_url_exists;
    SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'CARUP_WORKER_SECRET')       INTO v_vault_secret_exists;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF NOT v_vault_url_exists THEN
    RAISE NOTICE '[carup-cron] Vault secret CARUP_WORKER_ENDPOINT_URL missing — job will no-op until created.';
  END IF;
  IF NOT v_vault_secret_exists THEN
    RAISE NOTICE '[carup-cron] Vault secret CARUP_WORKER_SECRET missing — job will no-op until created.';
  END IF;

  -- Identical architecture to 20260626120000, plus timeout_milliseconds: worker batches can exceed
  -- pg_net's 5s default (real provider sends took 5–8s), and a client-side timeout would record
  -- timed_out=true instead of the required status_code=200 evidence.
  v_job_command := $CMD$
    SELECT net.http_post(
      url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CARUP_WORKER_ENDPOINT_URL' LIMIT 1),
      headers := json_build_object(
                   'Authorization', 'Bearer ' || (
                     SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CARUP_WORKER_SECRET' LIMIT 1
                   ),
                   'Content-Type', 'application/json'
                 )::jsonb,
      body    := '{"limit":10}'::jsonb,
      timeout_milliseconds := 20000
    ) AS request_id
    WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'CARUP_WORKER_ENDPOINT_URL')
      AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'CARUP_WORKER_SECRET');
  $CMD$;

  -- Idempotent single-job guarantee: remove any same-name job before recreating.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_job_name) THEN
    PERFORM cron.unschedule(v_job_name);
    RAISE NOTICE '[carup-cron] Removed existing job "%" for re-creation.', v_job_name;
  END IF;

  PERFORM cron.schedule(v_job_name, '* * * * *', v_job_command);
  RAISE NOTICE '[carup-cron] Scheduled job "%" every minute → stable production alias (URL read from Vault).', v_job_name;
END $$;

-- Post-apply verification (run after ≥1 minute):
--   SELECT public.get_communication_scheduler_health();
--     → pg_cron_available=true, pg_net_available=true, job_configured=true,
--       job_config = {jobname, schedule:'* * * * *', active:true},
--       latest_run.status='succeeded', latest_http_call.status_code=200
--   SELECT COUNT(*) FROM cron.job WHERE command ILIKE '%communications%';  -- expect exactly 1

-- +migrate Down
-- Unschedule the job only. The health function belongs to 20260626120000 (not dropped here), and
-- the extensions are intentionally left installed — they are shared database infrastructure and
-- dropping them could break unrelated consumers.

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
