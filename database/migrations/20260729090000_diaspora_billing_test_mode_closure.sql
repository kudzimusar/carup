-- +migrate Up
-- =============================================================================
-- Diaspora ledger #24 — subscription billing closure (Issue #127, Deliverable D).
--
-- Ledger #21 gave the billing event ledger `occurred_at`, `provider_sequence` and `superseded`, and
-- created `diaspora_billing_reconciliation_runs`. That is enough to DECIDE that an event is
-- out-of-order; it is not enough to operate the thing afterwards. This migration adds the columns an
-- operator needs when something goes wrong, and the one table that abandonment cannot be measured
-- without.
--
-- 1. `superseded_by` — ledger #21 can record THAT an event was superseded but not BY WHAT. Without the
--    pointer, an operator looking at a superseded row has no way to find the event that beat it, which
--    is the first question anyone asks.
-- 2. `attempts` / `last_error` / `dead_lettered` — a webhook whose handler throws currently leaves a
--    row that is indistinguishable from one that was never delivered. Failed events must be visible,
--    countable and terminable, or they are simply lost with extra steps.
-- 3. `correlation_id` — a webhook, the subscription write it caused and the log lines around it are
--    three separate records today. One id makes them one story.
-- 4. `diaspora_billing_checkout_sessions` — checkout abandonment is a REQUIRED signal, and it cannot be
--    derived from anything that exists: a checkout that is never completed leaves no trace anywhere. A
--    log line is not queryable months later and does not survive log retention. The durable record of
--    "a checkout was started" has to exist before "it was never finished" can be observed.
--
-- Additive throughout. Every added column is nullable or has a default; no existing column, constraint,
-- policy, index or function is altered or dropped. Ledgers #3–#23 are untouched.
--
-- GRANTS are applied in the SAME migration that creates the table. On Supabase,
-- `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon, authenticated` is in effect, so a newly
-- created table is readable by the anon role the instant it exists. That is the exact gap that required
-- the compensating ledgers #17/#19/#20; closing it here rather than later is the whole lesson.
-- `REVOKE ALL` also clears PG17's MAINTAIN privilege, which information_schema cannot report.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Operability columns on the billing event ledger.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.diaspora_billing_provider_events
  ADD COLUMN IF NOT EXISTS superseded_by  uuid,
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS attempts       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error     text,
  ADD COLUMN IF NOT EXISTS dead_lettered  boolean NOT NULL DEFAULT false;

-- Operator queue: failed events that need a human. Partial, so it stays small no matter how many
-- events the ledger accumulates.
CREATE INDEX IF NOT EXISTS idx_diaspora_billing_events_dead_letters
  ON public.diaspora_billing_provider_events (created_at DESC)
  WHERE dead_lettered = true;

-- The out-of-order guard's own read path: "what has already been APPLIED for this tenant?". Without
-- this the supersede check degrades into a full scan of the tenant's event history on every webhook.
CREATE INDEX IF NOT EXISTS idx_diaspora_billing_events_applied
  ON public.diaspora_billing_provider_events (provider, tenant_id, occurred_at DESC NULLS LAST)
  WHERE superseded = false AND processed_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Checkout sessions — the durable record abandonment is measured against.
--
--    `state` is a small closed set. `abandoned` is NOT a state the system is told about: it is derived
--    by a sweep over sessions that stayed `open` past the abandonment window, which is exactly why the
--    row has to exist in the first place.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diaspora_billing_checkout_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  provider       text NOT NULL,
  -- The provider's own handle for the session. Nullable because a rail may not mint one until the
  -- customer acts; the row still has to exist from the moment checkout is initiated.
  session_ref    text,
  plan_key       text NOT NULL,
  state          text NOT NULL DEFAULT 'open',
  initiated_by   text,
  correlation_id text,
  opened_at      timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  completed_at   timestamptz,
  abandoned_at   timestamptz,
  expires_at     timestamptz,
  -- Sanitized outcome detail only: never an amount with customer identity, never a provider payload.
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at     timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT ck_diaspora_billing_checkout_state
    CHECK (state IN ('open', 'completed', 'abandoned', 'expired', 'cancelled'))
);

-- One provider session ref means one row. The sweep and the webhook both key off it, and two rows for
-- one session would double-count both completion and abandonment.
CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_billing_checkout_ref
  ON public.diaspora_billing_checkout_sessions (provider, session_ref)
  WHERE session_ref IS NOT NULL;

-- The abandonment sweep's read path: still-open sessions, oldest first.
CREATE INDEX IF NOT EXISTS idx_diaspora_billing_checkout_open
  ON public.diaspora_billing_checkout_sessions (opened_at)
  WHERE state = 'open';

CREATE INDEX IF NOT EXISTS idx_diaspora_billing_checkout_tenant
  ON public.diaspora_billing_checkout_sessions (tenant_id, opened_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. updated_at trigger (reuse the Phase 1B helper when it exists).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'set_diaspora_trade_os_updated_at') THEN
    DROP TRIGGER IF EXISTS set_diaspora_billing_checkout_sessions_updated_at
      ON public.diaspora_billing_checkout_sessions;
    CREATE TRIGGER set_diaspora_billing_checkout_sessions_updated_at
      BEFORE UPDATE ON public.diaspora_billing_checkout_sessions
      FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS: ENABLE with ZERO policies (default-deny).
--    A service-role-only ledger. No browser session ever reads it directly; RLS is the second,
--    independent line of defence behind the grant contract in §5.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.diaspora_billing_checkout_sessions ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. GRANTS — the ledger #20 contract, applied at CREATE time (see the header note on
--    ALTER DEFAULT PRIVILEGES).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['diaspora_billing_checkout_sessions'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;

-- +migrate Down
-- Drops ONLY what this migration created, in reverse dependency order. Ledgers #3–#23 untouched.
DROP TABLE IF EXISTS public.diaspora_billing_checkout_sessions;

DROP INDEX IF EXISTS public.idx_diaspora_billing_events_applied;
DROP INDEX IF EXISTS public.idx_diaspora_billing_events_dead_letters;

ALTER TABLE IF EXISTS public.diaspora_billing_provider_events
  DROP COLUMN IF EXISTS dead_lettered,
  DROP COLUMN IF EXISTS last_error,
  DROP COLUMN IF EXISTS attempts,
  DROP COLUMN IF EXISTS correlation_id,
  DROP COLUMN IF EXISTS superseded_by;
