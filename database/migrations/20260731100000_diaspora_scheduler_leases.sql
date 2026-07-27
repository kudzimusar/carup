-- +migrate Up
-- =============================================================================
-- Diaspora ledger #27 — durable scheduled execution (Issue #127, Phase 2E).
--
-- WHAT IS MISSING WITHOUT THIS
-- ----------------------------
-- Five pieces of recurring work already exist in the codebase and none of them runs on its own:
--
--   · billing reconciliation (`diasporaBillingReconciliationService`) — ADR-001 §7 calls it "not
--     optional" because the Zimbabwe rail's own provider documents its callback as a hint;
--   · the abandoned-checkout sweep (`sweepAbandonedCheckouts`) — `abandoned` is DERIVED, so a session
--     nobody sweeps stays `open` forever and the abandonment rate is silently wrong;
--   · retryable provider events (ledger #24 `attempts` / `dead_lettered`) — a webhook whose handler
--     threw sits unprocessed with nothing scheduled to pick it up;
--   · Drive sync attempts (ledger #21) — `next_attempt_at` is written by every failure and read by
--     nobody, so "will be retried" is currently a claim the system cannot keep;
--   · Zimbabwe-side renewals — ADR-001 §8 lists the renewal scheduler as explicitly NOT decided,
--     because Paynow has no subscription concept and someone must trigger each period.
--
-- Each of those has an operator-triggered entry point today. The missing piece is the part that makes
-- them happen without a human, on a platform with NO always-running process: Vercel is serverless, so
-- `setInterval` in an API process is not a scheduler, it is a coincidence that survives until the next
-- cold start. The shape that works there is a dispatched invocation — a cron-invoked endpoint or a
-- scheduled workflow — hitting a claim that is safe when two of them overlap.
--
-- WHY A LEASE TABLE AND NOT "JUST RUN IT"
-- ---------------------------------------
-- Cron dispatchers overlap. Vercel Cron and GitHub Actions both fire at-least-once, a slow run is
-- still executing when the next one starts, and a manual operator run can land on top of either. Two
-- reconciliations racing double-count nothing dangerous; two renewal sweeps racing could bill a tenant
-- twice. So the claim is a real lease taken with SELECT ... FOR UPDATE SKIP LOCKED:
--
--   · SKIP LOCKED means the loser returns IMMEDIATELY with `LOCKED` instead of blocking until the
--     winner finishes — a blocked serverless invocation is a paid timeout, and a queue of them is an
--     outage;
--   · the lease has an expiry, so a worker that is killed mid-run (which serverless does routinely)
--     releases its claim without anyone intervening;
--   · release refuses to touch a lease owned by somebody else, so a zombie worker finishing after its
--     lease expired cannot clobber the state of the worker that took over.
--
-- THREE TABLES
-- ------------
--   1. `diaspora_scheduled_jobs`   — one row per job: the lease, the schedule, and the freshness
--      timestamps an alert should be reading. `last_success_at` is the load-bearing one: the most
--      dangerous scheduler failure is not an error, it is silence.
--   2. `diaspora_scheduler_runs`   — the durable history. "We ran and found nothing" must be
--      distinguishable from "we have not run in three weeks", which is the same argument ledger #21
--      made for `diaspora_billing_reconciliation_runs` and is just as true one level up.
--   3. `diaspora_subscription_renewals` — the idempotent, once-per-period record for ADR-001 §8. It
--      holds NO money fields by design: this migration schedules renewals, it does not collect them,
--      and live collection stays gated behind ADR-001 §9.
--
-- FAILURE IS BOUNDED AND TERMINAL. `consecutive_failures` drives exponential backoff, and at the
-- ceiling the job goes to `needs_operator` with `next_run_at` CLEARED — a terminus, not a slower loop.
-- Retrying a broken job forever is how a real defect becomes background noise.
--
-- DISABLED BY DEFAULT. `enabled` defaults to FALSE on every job row. The service layer requires its
-- own environment flag as well, so switching a job on takes two deliberate, independent acts.
--
-- Additive. Ledgers #21–#26 are untouched. GRANTS are applied in the SAME migration that creates the
-- tables — on Supabase `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon, authenticated` is in
-- effect, so a new table is readable by `anon` the instant it exists. That gap is what required the
-- compensating ledgers #17/#19/#20; closing it here rather than later is the whole lesson.
-- `REVOKE ALL` also clears PG17's MAINTAIN privilege, which information_schema cannot report.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The job registry / lease table.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diaspora_scheduled_jobs (
  job_key              text PRIMARY KEY,
  -- Default FALSE. A row appearing is not permission to run it.
  enabled              boolean NOT NULL DEFAULT false,
  state                text NOT NULL DEFAULT 'idle',
  -- Opaque worker identity (a random per-invocation id). Never a hostname or an IP: this column is
  -- read by operators and exported to dashboards, and infrastructure topology is not their business.
  lease_owner          text,
  leased_until         timestamptz,
  -- NULL means "due now". Cleared to NULL on needs_operator so a dead job cannot be picked up again.
  next_run_at          timestamptz,
  interval_seconds     integer NOT NULL DEFAULT 3600,
  last_attempt_at      timestamptz,
  -- The freshness signal an alert should watch. Silence is the dangerous failure.
  last_success_at      timestamptz,
  last_failure_at      timestamptz,
  last_error           text,
  last_error_code      text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  total_runs           bigint  NOT NULL DEFAULT 0,
  last_run_id          uuid,
  metadata             jsonb   NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at           timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT ck_diaspora_scheduled_job_state
    CHECK (state IN ('idle', 'leased', 'needs_operator', 'disabled')),
  -- A schedule faster than 30s is a busy loop against a serverless dispatcher; slower than a day is
  -- not a schedule. Both ends are refused rather than silently clamped.
  CONSTRAINT ck_diaspora_scheduled_job_interval
    CHECK (interval_seconds BETWEEN 30 AND 86400),
  CONSTRAINT ck_diaspora_scheduled_job_failures
    CHECK (consecutive_failures >= 0),
  -- A lease without an owner (or an owner without a lease) is a state no code path should be able to
  -- produce; making it unrepresentable means the claim logic cannot drift into it unnoticed.
  CONSTRAINT ck_diaspora_scheduled_job_lease_pairing
    CHECK ((lease_owner IS NULL) = (leased_until IS NULL)),
  -- The terminus really is terminal: needs_operator can never carry a future run time.
  CONSTRAINT ck_diaspora_scheduled_job_terminus
    CHECK (state <> 'needs_operator' OR next_run_at IS NULL)
);

-- The dispatcher's read path: "which jobs are due?". Partial, so it stays small as jobs accumulate.
CREATE INDEX IF NOT EXISTS idx_diaspora_scheduled_jobs_due
  ON public.diaspora_scheduled_jobs (next_run_at NULLS FIRST)
  WHERE enabled = true AND state <> 'needs_operator';

-- The operator queue: jobs that gave up and need a human.
CREATE INDEX IF NOT EXISTS idx_diaspora_scheduled_jobs_needs_operator
  ON public.diaspora_scheduled_jobs (updated_at DESC)
  WHERE state = 'needs_operator';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Durable run history.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diaspora_scheduler_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_key             text NOT NULL,
  -- NULL = platform-wide. A per-tenant spot check carries the tenant.
  tenant_id           uuid,
  trigger             text NOT NULL,
  state               text NOT NULL DEFAULT 'running',
  lease_owner         text,
  started_at          timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  finished_at         timestamptz,
  processed_count     integer NOT NULL DEFAULT 0,
  failed_count        integer NOT NULL DEFAULT 0,
  dead_lettered_count integer NOT NULL DEFAULT 0,
  skipped_reason      text,
  last_error          text,
  correlation_id      text,
  initiated_by        text,
  -- SANITIZED outcome detail only: counts, ids and states. Never a payload, never an amount tied to a
  -- person, never a credential.
  detail              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT ck_diaspora_scheduler_run_trigger
    CHECK (trigger IN ('scheduled', 'operator', 'startup', 'backfill')),
  CONSTRAINT ck_diaspora_scheduler_run_state
    CHECK (state IN ('running', 'completed', 'failed', 'skipped')),
  -- A terminal run must have an end time. A run stuck in `running` forever is indistinguishable from
  -- a dispatcher that stopped, which is exactly the blindness this table exists to remove.
  CONSTRAINT ck_diaspora_scheduler_run_terminal
    CHECK (state = 'running' OR finished_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_diaspora_scheduler_runs_job
  ON public.diaspora_scheduler_runs (job_key, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_diaspora_scheduler_runs_tenant
  ON public.diaspora_scheduler_runs (tenant_id, started_at DESC)
  WHERE tenant_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Zimbabwe-side renewals (ADR-001 §8).
--
--    ADR-001 §4.2 puts CarUp in charge of the renewal schedule for tenants on a rail with no
--    subscription concept. §8 then records that the renewal scheduler is NOT decided, and §9 keeps
--    every live provider unapproved. So this table records that a period came due and that a human
--    must act — it deliberately carries NO amount, NO currency and NO provider payment handle,
--    because nothing here moves money and a schema that could express a charge would eventually be
--    used to make one.
--
--    UNIQUE (tenant_id, subscription_id, period_end) is the idempotency: a sweep that runs twice in
--    one period, or two dispatchers that overlap, produce ONE row. The database enforces it, so the
--    guarantee does not depend on the sweep's own bookkeeping being correct.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diaspora_subscription_renewals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  subscription_id uuid NOT NULL,
  provider        text NOT NULL,
  plan_key        text,
  period_end      timestamptz NOT NULL,
  state           text NOT NULL DEFAULT 'due',
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_error      text,
  detected_by_run uuid,
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at      timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT ck_diaspora_subscription_renewal_state
    CHECK (state IN ('due', 'needs_operator', 'collected', 'cancelled', 'failed')),
  CONSTRAINT ck_diaspora_subscription_renewal_attempts CHECK (attempts >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_subscription_renewal_period
  ON public.diaspora_subscription_renewals (tenant_id, subscription_id, period_end);

CREATE INDEX IF NOT EXISTS idx_diaspora_subscription_renewals_open
  ON public.diaspora_subscription_renewals (period_end)
  WHERE state IN ('due', 'needs_operator');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. updated_at triggers (reuse the Phase 1B helper when it exists).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'set_diaspora_trade_os_updated_at') THEN
    FOREACH t IN ARRAY ARRAY['diaspora_scheduled_jobs', 'diaspora_subscription_renewals'] LOOP
      EXECUTE format('DROP TRIGGER IF EXISTS set_%s_updated_at ON public.%I', t, t);
      EXECUTE format(
        'CREATE TRIGGER set_%s_updated_at BEFORE UPDATE ON public.%I '
        || 'FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at()', t, t);
    END LOOP;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. CLAIM — the concurrency control.
--
--    SELECT ... FOR UPDATE SKIP LOCKED on the job row. Two dispatchers that overlap partition rather
--    than collide: the winner holds the row lock for the length of the (very short) claim transaction
--    and leaves behind a lease; the loser's SELECT skips the locked row, finds nothing, and returns
--    `LOCKED` immediately instead of blocking. Blocking would be worse than losing — a serverless
--    invocation waiting on a lock is a paid timeout.
--
--    Every refusal names its reason, because "did not run" has five very different meanings and an
--    operator staring at a quiet job needs to know which one it was.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.diaspora_scheduler_claim_atomic(
  p_job_key         text,
  p_owner           text,
  p_lease_seconds   integer DEFAULT 300,
  p_interval_seconds integer DEFAULT NULL,
  p_ignore_schedule boolean DEFAULT false,
  p_require_enabled boolean DEFAULT true,
  p_now             timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now   timestamptz := COALESCE(p_now, now());
  v_lease integer     := LEAST(GREATEST(COALESCE(p_lease_seconds, 300), 5), 3600);
  v_job   public.diaspora_scheduled_jobs%ROWTYPE;
BEGIN
  IF p_job_key IS NULL OR p_owner IS NULL THEN
    RAISE EXCEPTION 'DIASPORA_SCHEDULER/JOB_KEY_AND_OWNER_REQUIRED';
  END IF;

  -- Bootstrap. A job's first ever claim should not require a separate seeding step, and ON CONFLICT
  -- DO NOTHING means two dispatchers bootstrapping simultaneously produce one row rather than a
  -- 23505 that looks like a failure.
  INSERT INTO public.diaspora_scheduled_jobs (job_key, interval_seconds, next_run_at)
  VALUES (p_job_key, COALESCE(p_interval_seconds, 3600), NULL)
  ON CONFLICT (job_key) DO NOTHING;

  SELECT * INTO v_job
    FROM public.diaspora_scheduled_jobs
   WHERE job_key = p_job_key
     FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    -- Another dispatcher holds the row lock at this instant. Not an error; the whole point.
    RETURN jsonb_build_object('claimed', false, 'reason', 'LOCKED', 'job_key', p_job_key);
  END IF;

  IF p_require_enabled AND NOT v_job.enabled THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'DISABLED', 'job_key', p_job_key);
  END IF;

  IF v_job.state = 'needs_operator' AND NOT p_ignore_schedule THEN
    -- The terminus. Only an explicit operator run (p_ignore_schedule) gets past this.
    RETURN jsonb_build_object('claimed', false, 'reason', 'NEEDS_OPERATOR', 'job_key', p_job_key,
                              'consecutive_failures', v_job.consecutive_failures);
  END IF;

  IF v_job.leased_until IS NOT NULL AND v_job.leased_until > v_now AND v_job.lease_owner <> p_owner THEN
    -- Someone is mid-run. An EXPIRED lease deliberately falls through: a worker killed by a serverless
    -- timeout must not lock a job out forever.
    RETURN jsonb_build_object('claimed', false, 'reason', 'LEASED', 'job_key', p_job_key,
                              'leased_until', v_job.leased_until);
  END IF;

  IF NOT p_ignore_schedule AND v_job.next_run_at IS NOT NULL AND v_job.next_run_at > v_now THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'NOT_DUE', 'job_key', p_job_key,
                              'next_run_at', v_job.next_run_at);
  END IF;

  UPDATE public.diaspora_scheduled_jobs
     SET state            = 'leased',
         lease_owner      = p_owner,
         leased_until     = v_now + make_interval(secs => v_lease),
         last_attempt_at  = v_now,
         total_runs       = v_job.total_runs + 1,
         interval_seconds = COALESCE(p_interval_seconds, v_job.interval_seconds),
         updated_at       = v_now
   WHERE job_key = p_job_key
  RETURNING * INTO v_job;

  RETURN jsonb_build_object(
    'claimed', true,
    'job_key', v_job.job_key,
    'lease_owner', v_job.lease_owner,
    'leased_until', v_job.leased_until,
    'consecutive_failures', v_job.consecutive_failures,
    'interval_seconds', v_job.interval_seconds,
    'last_success_at', v_job.last_success_at,
    'total_runs', v_job.total_runs
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RELEASE — settle the lease and decide when (or whether) the job runs again.
--
--    Refuses to touch a lease owned by anybody else. A worker whose lease expired while it was still
--    running WILL eventually call release; by then another worker may hold the job, and letting the
--    zombie overwrite `last_success_at` would report a stale run as fresh — which is precisely the
--    signal an alert is watching.
--
--    Failure backs off exponentially with FULL JITTER. Without jitter, every dispatcher that failed
--    against the same downstream comes back at the same moment and reproduces the overload that
--    caused the failure. At `p_max_failures` the job reaches `needs_operator` with next_run_at
--    CLEARED — a terminus, not a slower loop.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.diaspora_scheduler_release_atomic(
  p_job_key              text,
  p_owner                text,
  p_succeeded            boolean,
  p_error                text DEFAULT NULL,
  p_error_code           text DEFAULT NULL,
  p_run_id               uuid DEFAULT NULL,
  p_max_failures         integer DEFAULT 5,
  p_backoff_base_seconds integer DEFAULT 60,
  p_backoff_max_seconds  integer DEFAULT 3600,
  p_now                  timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now       timestamptz := COALESCE(p_now, now());
  v_job       public.diaspora_scheduled_jobs%ROWTYPE;
  v_failures  integer;
  v_window    integer;
  v_backoff   integer;
  v_state     text;
  v_next      timestamptz;
BEGIN
  SELECT * INTO v_job FROM public.diaspora_scheduled_jobs WHERE job_key = p_job_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DIASPORA_SCHEDULER/NOT_FOUND_JOB';
  END IF;

  IF v_job.lease_owner IS DISTINCT FROM p_owner THEN
    -- A zombie finishing after its lease was taken over. Reported, never applied.
    RETURN jsonb_build_object('released', false, 'reason', 'LEASE_LOST', 'job_key', p_job_key,
                              'current_owner', v_job.lease_owner);
  END IF;

  IF COALESCE(p_succeeded, false) THEN
    UPDATE public.diaspora_scheduled_jobs
       SET state                = 'idle',
           lease_owner          = NULL,
           leased_until         = NULL,
           last_success_at      = v_now,
           last_error           = NULL,
           last_error_code      = NULL,
           consecutive_failures = 0,
           next_run_at          = v_now + make_interval(secs => v_job.interval_seconds),
           last_run_id          = COALESCE(p_run_id, v_job.last_run_id),
           updated_at           = v_now
     WHERE job_key = p_job_key
    RETURNING * INTO v_job;

    RETURN jsonb_build_object('released', true, 'job_key', p_job_key, 'state', v_job.state,
                              'next_run_at', v_job.next_run_at, 'last_success_at', v_job.last_success_at);
  END IF;

  v_failures := v_job.consecutive_failures + 1;

  IF v_failures >= GREATEST(COALESCE(p_max_failures, 5), 1) THEN
    v_state := 'needs_operator';
    v_next  := NULL;   -- the terminus. A dead job must not be picked up again by a dispatcher.
  ELSE
    v_state  := 'idle';
    v_window := LEAST(
      GREATEST(COALESCE(p_backoff_max_seconds, 3600), 1),
      GREATEST(COALESCE(p_backoff_base_seconds, 60), 1) * (2 ^ (v_failures - 1))::integer
    );
    -- Full jitter: a uniform draw over [0, window], not the exponential value itself.
    v_backoff := GREATEST(1, floor(random() * v_window)::integer);
    v_next    := v_now + make_interval(secs => v_backoff);
  END IF;

  UPDATE public.diaspora_scheduled_jobs
     SET state                = v_state,
         lease_owner          = NULL,
         leased_until         = NULL,
         last_failure_at      = v_now,
         last_error           = left(COALESCE(p_error, 'unspecified failure'), 500),
         last_error_code      = left(COALESCE(p_error_code, 'SCHEDULED_JOB_FAILED'), 64),
         consecutive_failures = v_failures,
         next_run_at          = v_next,
         last_run_id          = COALESCE(p_run_id, v_job.last_run_id),
         updated_at           = v_now
   WHERE job_key = p_job_key
  RETURNING * INTO v_job;

  RETURN jsonb_build_object('released', true, 'job_key', p_job_key, 'state', v_job.state,
                            'consecutive_failures', v_job.consecutive_failures,
                            'next_run_at', v_job.next_run_at,
                            'dead_lettered', v_job.state = 'needs_operator');
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RLS: ENABLE with ZERO policies (default-deny) on all three tables.
--    Service-role-only ledgers. No browser session reads them directly; RLS is the second,
--    independent line of defence behind the grant contract in §8.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.diaspora_scheduled_jobs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_scheduler_runs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_subscription_renewals  ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. GRANTS — the ledger #20 contract, applied at CREATE time.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'diaspora_scheduled_jobs',
    'diaspora_scheduler_runs',
    'diaspora_subscription_renewals'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;

DO $grants$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('diaspora_scheduler_claim_atomic', 'diaspora_scheduler_release_atomic')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$grants$;

-- +migrate Down
-- Drops ONLY what this migration created. Ledgers #21–#26 untouched.
DROP FUNCTION IF EXISTS public.diaspora_scheduler_release_atomic(text, text, boolean, text, text, uuid, integer, integer, integer, timestamptz);
DROP FUNCTION IF EXISTS public.diaspora_scheduler_claim_atomic(text, text, integer, integer, boolean, boolean, timestamptz);
DROP TABLE IF EXISTS public.diaspora_subscription_renewals;
DROP TABLE IF EXISTS public.diaspora_scheduler_runs;
DROP TABLE IF EXISTS public.diaspora_scheduled_jobs;
