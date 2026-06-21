-- +migrate Up
-- =============================================================
-- CarUp Diaspora Trade OS — Phase 8: subscription + entitlement foundation
--
-- Tenant-scoped plan catalog + subscriptions, per-user entitlement overrides, usage meters with an
-- atomic reservation RPC, and an idempotent billing-provider webhook log.
--
-- Granularity (product decision PD-1): subscriptions/quotas attach to the TENANT; effective
-- entitlements derive from the tenant's plan and may be overridden per user.
--
-- Additive, reversible, idempotent for dev verification. Reuses the Phase 1B RLS helpers
-- (diaspora_trade_os_can_access_row / _is_platform_admin / _is_tenant_member) and the updated_at
-- trigger. RLS enabled, REVOKE PUBLIC + GRANT authenticated/service_role. NOT applied to production by
-- this program — validated by CI migration-sanity + unit tests only.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Plan catalog (config-driven; seeded from backend/constants/diaspora/diasporaEntitlements.js) ──
CREATE TABLE IF NOT EXISTS public.diaspora_subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key text NOT NULL UNIQUE,
  name text NOT NULL,
  tier text NOT NULL,
  description text,
  price_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  entitlements jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ── Subscriptions (one tenant -> at most one active subscription) ──
CREATE TABLE IF NOT EXISTS public.diaspora_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  plan_key text NOT NULL REFERENCES public.diaspora_subscription_plans(plan_key) ON UPDATE CASCADE,
  status text NOT NULL DEFAULT 'incomplete'
    CHECK (status IN ('trialing','active','past_due','grace_period','paused','cancelled','expired','incomplete','suspended')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_end timestamptz,
  provider text NOT NULL DEFAULT 'sandbox',
  provider_customer_ref text,
  provider_subscription_ref text,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz
);

-- At most one access-granting subscription per tenant (partial unique on the active-ish states).
CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_subscriptions_active_per_tenant
  ON public.diaspora_subscriptions (tenant_id)
  WHERE deleted_at IS NULL AND status IN ('trialing','active','past_due','grace_period','paused');

-- ── Per-user entitlement overrides (narrow or widen a single feature for one user) ──
CREATE TABLE IF NOT EXISTS public.diaspora_user_entitlement_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id text NOT NULL,
  feature_key text NOT NULL,
  value jsonb NOT NULL,
  reason text,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz,
  CONSTRAINT uq_diaspora_user_override UNIQUE (tenant_id, user_id, feature_key)
);

-- ── Usage meters (one row per tenant/feature/billing-period) ──
CREATE TABLE IF NOT EXISTS public.diaspora_usage_meters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  feature_key text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz,
  used_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_diaspora_usage_meter UNIQUE (tenant_id, feature_key, period_start)
);

-- ── Usage reservations (reserve -> commit/release, idempotent per key) ──
CREATE TABLE IF NOT EXISTS public.diaspora_usage_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id text,
  feature_key text NOT NULL,
  amount integer NOT NULL DEFAULT 1,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'RESERVED'
    CHECK (status IN ('RESERVED','COMMITTED','RELEASED')),
  period_start timestamptz NOT NULL,
  period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_diaspora_usage_reservation UNIQUE (tenant_id, feature_key, idempotency_key)
);

-- ── Billing provider webhook log (idempotent on (provider, event_id)) ──
CREATE TABLE IF NOT EXISTS public.diaspora_billing_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  provider text NOT NULL,
  event_id text NOT NULL,
  event_type text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  signature_verified boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_diaspora_billing_event UNIQUE (provider, event_id)
);

-- ── Indexes on tenant/lifecycle columns ──
CREATE INDEX IF NOT EXISTS idx_diaspora_subscriptions_tenant_status
  ON public.diaspora_subscriptions (tenant_id, status, current_period_end);
CREATE INDEX IF NOT EXISTS idx_diaspora_overrides_tenant_user
  ON public.diaspora_user_entitlement_overrides (tenant_id, user_id, feature_key)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_diaspora_usage_meters_tenant_feature
  ON public.diaspora_usage_meters (tenant_id, feature_key, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_diaspora_usage_reservations_tenant_feature
  ON public.diaspora_usage_reservations (tenant_id, feature_key, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_diaspora_billing_events_provider
  ON public.diaspora_billing_provider_events (provider, processed_at);
CREATE INDEX IF NOT EXISTS idx_diaspora_subscription_plans_active
  ON public.diaspora_subscription_plans (is_active, sort_order);

-- ── updated_at triggers (reuse the Phase 1B helper) ──
DROP TRIGGER IF EXISTS set_diaspora_subscription_plans_updated_at ON public.diaspora_subscription_plans;
CREATE TRIGGER set_diaspora_subscription_plans_updated_at
  BEFORE UPDATE ON public.diaspora_subscription_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

DROP TRIGGER IF EXISTS set_diaspora_subscriptions_updated_at ON public.diaspora_subscriptions;
CREATE TRIGGER set_diaspora_subscriptions_updated_at
  BEFORE UPDATE ON public.diaspora_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

DROP TRIGGER IF EXISTS set_diaspora_user_overrides_updated_at ON public.diaspora_user_entitlement_overrides;
CREATE TRIGGER set_diaspora_user_overrides_updated_at
  BEFORE UPDATE ON public.diaspora_user_entitlement_overrides
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

DROP TRIGGER IF EXISTS set_diaspora_usage_meters_updated_at ON public.diaspora_usage_meters;
CREATE TRIGGER set_diaspora_usage_meters_updated_at
  BEFORE UPDATE ON public.diaspora_usage_meters
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

DROP TRIGGER IF EXISTS set_diaspora_usage_reservations_updated_at ON public.diaspora_usage_reservations;
CREATE TRIGGER set_diaspora_usage_reservations_updated_at
  BEFORE UPDATE ON public.diaspora_usage_reservations
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

-- ── Row Level Security ──
ALTER TABLE public.diaspora_subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_user_entitlement_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_usage_meters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_usage_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_billing_provider_events ENABLE ROW LEVEL SECURITY;

-- Plan catalog: readable by any authenticated user (it is public product info); writes only via
-- service_role (which bypasses RLS), so there is no authenticated write policy.
DROP POLICY IF EXISTS diaspora_subscription_plans_read ON public.diaspora_subscription_plans;
CREATE POLICY diaspora_subscription_plans_read
  ON public.diaspora_subscription_plans
  FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Subscriptions: tenant members + platform admins (created_by/updated_by tracked for owner access).
DROP POLICY IF EXISTS diaspora_subscriptions_tenant_access ON public.diaspora_subscriptions;
CREATE POLICY diaspora_subscriptions_tenant_access
  ON public.diaspora_subscriptions
  FOR ALL
  TO authenticated
  USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by))
  WITH CHECK (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by));

-- Overrides: tenant members + platform admins.
DROP POLICY IF EXISTS diaspora_user_overrides_tenant_access ON public.diaspora_user_entitlement_overrides;
CREATE POLICY diaspora_user_overrides_tenant_access
  ON public.diaspora_user_entitlement_overrides
  FOR ALL
  TO authenticated
  USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by))
  WITH CHECK (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by));

-- Usage meters: tenant-scoped read for members; mutation only via the SECURITY DEFINER RPC /
-- service_role. No created_by/updated_by on this table, so the predicate keys on tenant membership.
DROP POLICY IF EXISTS diaspora_usage_meters_tenant_read ON public.diaspora_usage_meters;
CREATE POLICY diaspora_usage_meters_tenant_read
  ON public.diaspora_usage_meters
  FOR SELECT
  TO authenticated
  USING (
    public.diaspora_trade_os_is_platform_admin()
    OR public.diaspora_trade_os_is_tenant_member(public.diaspora_trade_os_current_user_id(), tenant_id)
  );

-- Usage reservations: tenant-scoped read for members; writes via the RPC / service_role.
DROP POLICY IF EXISTS diaspora_usage_reservations_tenant_read ON public.diaspora_usage_reservations;
CREATE POLICY diaspora_usage_reservations_tenant_read
  ON public.diaspora_usage_reservations
  FOR SELECT
  TO authenticated
  USING (
    public.diaspora_trade_os_is_platform_admin()
    OR public.diaspora_trade_os_is_tenant_member(public.diaspora_trade_os_current_user_id(), tenant_id)
  );

-- Billing provider events: platform-admin read only; writes via service_role.
DROP POLICY IF EXISTS diaspora_billing_events_admin_read ON public.diaspora_billing_provider_events;
CREATE POLICY diaspora_billing_events_admin_read
  ON public.diaspora_billing_provider_events
  FOR SELECT
  TO authenticated
  USING (public.diaspora_trade_os_is_platform_admin());

-- ── Table-level grants: never PUBLIC; authenticated (RLS-scoped) + service_role only ──
REVOKE ALL ON TABLE public.diaspora_subscription_plans FROM PUBLIC;
REVOKE ALL ON TABLE public.diaspora_subscriptions FROM PUBLIC;
REVOKE ALL ON TABLE public.diaspora_user_entitlement_overrides FROM PUBLIC;
REVOKE ALL ON TABLE public.diaspora_usage_meters FROM PUBLIC;
REVOKE ALL ON TABLE public.diaspora_usage_reservations FROM PUBLIC;
REVOKE ALL ON TABLE public.diaspora_billing_provider_events FROM PUBLIC;
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE public.diaspora_subscriptions TO authenticated;
    GRANT SELECT, INSERT, UPDATE ON TABLE public.diaspora_user_entitlement_overrides TO authenticated;
    GRANT SELECT ON TABLE public.diaspora_subscription_plans TO authenticated;
    GRANT SELECT ON TABLE public.diaspora_usage_meters TO authenticated;
    GRANT SELECT ON TABLE public.diaspora_usage_reservations TO authenticated;
    GRANT SELECT ON TABLE public.diaspora_billing_provider_events TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.diaspora_subscription_plans TO service_role;
    GRANT ALL ON TABLE public.diaspora_subscriptions TO service_role;
    GRANT ALL ON TABLE public.diaspora_user_entitlement_overrides TO service_role;
    GRANT ALL ON TABLE public.diaspora_usage_meters TO service_role;
    GRANT ALL ON TABLE public.diaspora_usage_reservations TO service_role;
    GRANT ALL ON TABLE public.diaspora_billing_provider_events TO service_role;
  END IF;
END;
$grants$;

-- =============================================================
-- Atomic usage reservation RPC.
--
-- Locks (or creates) the meter row for (tenant, feature, period), enforces used + amount <= quota,
-- writes a RESERVED reservation row, and is idempotent on (tenant, feature, idempotency_key): a replay
-- with the same key returns the prior result WITHOUT double-counting. All inside one transaction so a
-- failure rolls everything back. service_role EXECUTE only.
-- =============================================================
CREATE OR REPLACE FUNCTION public.diaspora_reserve_usage_atomic(
  p_tenant_id uuid,
  p_user_id text,
  p_feature_key text,
  p_amount integer,
  p_quota_limit integer,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_meter public.diaspora_usage_meters%ROWTYPE;
  v_existing public.diaspora_usage_reservations%ROWTYPE;
  v_used integer;
  v_new_used integer;
BEGIN
  IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'DIASPORA_USAGE/TENANT_REQUIRED'; END IF;
  IF p_feature_key IS NULL THEN RAISE EXCEPTION 'DIASPORA_USAGE/FEATURE_REQUIRED'; END IF;
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'DIASPORA_USAGE/IDEMPOTENCY_KEY_REQUIRED'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'DIASPORA_USAGE/INVALID_AMOUNT'; END IF;

  -- Idempotent replay: a prior reservation with the same key returns the prior state, no double count.
  SELECT * INTO v_existing FROM public.diaspora_usage_reservations
    WHERE tenant_id = p_tenant_id AND feature_key = p_feature_key AND idempotency_key = p_idempotency_key
    LIMIT 1;
  IF FOUND THEN
    SELECT * INTO v_meter FROM public.diaspora_usage_meters
      WHERE tenant_id = p_tenant_id AND feature_key = p_feature_key AND period_start = p_period_start
      LIMIT 1;
    v_used := COALESCE(v_meter.used_count, v_existing.amount);
    RETURN jsonb_build_object(
      'reserved', v_existing.amount,
      'used', v_used,
      'remaining', GREATEST(p_quota_limit - v_used, 0),
      'reservationId', v_existing.id,
      'status', v_existing.status,
      'idempotentReplay', true
    );
  END IF;

  -- Lock (or create) the meter row for this period.
  SELECT * INTO v_meter FROM public.diaspora_usage_meters
    WHERE tenant_id = p_tenant_id AND feature_key = p_feature_key AND period_start = p_period_start
    FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.diaspora_usage_meters (tenant_id, feature_key, period_start, period_end, used_count)
      VALUES (p_tenant_id, p_feature_key, p_period_start, p_period_end, 0)
      ON CONFLICT (tenant_id, feature_key, period_start) DO NOTHING;
    SELECT * INTO v_meter FROM public.diaspora_usage_meters
      WHERE tenant_id = p_tenant_id AND feature_key = p_feature_key AND period_start = p_period_start
      FOR UPDATE;
  END IF;

  v_used := COALESCE(v_meter.used_count, 0);
  v_new_used := v_used + p_amount;

  -- Enforce the quota ceiling (a negative/zero limit means the feature is not granted at all).
  IF p_quota_limit IS NULL OR p_quota_limit <= 0 OR v_new_used > p_quota_limit THEN
    RAISE EXCEPTION 'DIASPORA_USAGE/QUOTA_EXCEEDED: feature % used % requested % limit %',
      p_feature_key, v_used, p_amount, p_quota_limit;
  END IF;

  UPDATE public.diaspora_usage_meters
    SET used_count = v_new_used, updated_at = timezone('utc'::text, now())
    WHERE id = v_meter.id;

  INSERT INTO public.diaspora_usage_reservations (
    tenant_id, user_id, feature_key, amount, idempotency_key, status, period_start, period_end
  ) VALUES (
    p_tenant_id, p_user_id, p_feature_key, p_amount, p_idempotency_key, 'RESERVED', p_period_start, p_period_end
  ) RETURNING * INTO v_existing;

  RETURN jsonb_build_object(
    'reserved', p_amount,
    'used', v_new_used,
    'remaining', GREATEST(p_quota_limit - v_new_used, 0),
    'reservationId', v_existing.id,
    'status', 'RESERVED',
    'idempotentReplay', false
  );
END;
$$;

-- Only the backend service role may execute this function.
REVOKE ALL ON FUNCTION public.diaspora_reserve_usage_atomic(
  uuid, text, text, integer, integer, timestamptz, timestamptz, text
) FROM PUBLIC;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.diaspora_reserve_usage_atomic(
      uuid, text, text, integer, integer, timestamptz, timestamptz, text
    ) TO service_role;
  END IF;
END;
$grant$;

-- ── Seed the plan catalog (config-driven; mirrors backend/constants/diaspora/diasporaEntitlements.js) ──
-- ON CONFLICT DO NOTHING keeps re-runs and later config edits non-destructive.
INSERT INTO public.diaspora_subscription_plans (plan_key, name, tier, description, entitlements, is_active, sort_order)
VALUES
  ('free', 'Free', 'free',
   'Browse the marketplace and download blank workbook templates.',
   '{
     "diaspora.workbook.download": true, "diaspora.workbook.upload": false, "diaspora.workbook.bulk_import": 0,
     "diaspora.stock.create": false, "diaspora.stock.publish": false, "diaspora.stock.max_items": 0,
     "diaspora.rfq.create": false, "diaspora.rfq.respond": false, "diaspora.rfq.max_open": 0,
     "diaspora.ai.parse": false, "diaspora.ai.execute_medium": 0,
     "diaspora.container.reserve": false, "diaspora.container.manage": false,
     "diaspora.drive.connect": false, "diaspora.drive.export": false,
     "diaspora.api.access": false, "diaspora.audit.export": false,
     "diaspora.safetrade.create": false, "diaspora.graph.advanced": false
   }'::jsonb, true, 0),
  ('diaspora_buyer', 'Diaspora Buyer', 'buyer',
   'Create buyer requests and RFQs, upload documents, use the limited AI assistant.',
   '{
     "diaspora.workbook.download": true, "diaspora.workbook.upload": true, "diaspora.workbook.bulk_import": 0,
     "diaspora.stock.create": false, "diaspora.stock.publish": false, "diaspora.stock.max_items": 0,
     "diaspora.rfq.create": true, "diaspora.rfq.respond": false, "diaspora.rfq.max_open": 10,
     "diaspora.ai.parse": true, "diaspora.ai.execute_medium": 25,
     "diaspora.container.reserve": false, "diaspora.container.manage": false,
     "diaspora.drive.connect": true, "diaspora.drive.export": false,
     "diaspora.api.access": false, "diaspora.audit.export": false,
     "diaspora.safetrade.create": true, "diaspora.graph.advanced": false
   }'::jsonb, true, 10),
  ('seller', 'Seller / Supplier', 'seller',
   'Upload and publish stock, respond to RFQs, use the seller AI assistant.',
   '{
     "diaspora.workbook.download": true, "diaspora.workbook.upload": true, "diaspora.workbook.bulk_import": 0,
     "diaspora.stock.create": true, "diaspora.stock.publish": true, "diaspora.stock.max_items": 250,
     "diaspora.rfq.create": false, "diaspora.rfq.respond": true, "diaspora.rfq.max_open": 0,
     "diaspora.ai.parse": true, "diaspora.ai.execute_medium": 25,
     "diaspora.container.reserve": false, "diaspora.container.manage": false,
     "diaspora.drive.connect": true, "diaspora.drive.export": false,
     "diaspora.api.access": false, "diaspora.audit.export": false,
     "diaspora.safetrade.create": true, "diaspora.graph.advanced": false
   }'::jsonb, true, 20),
  ('trade_pro', 'Trade Pro', 'pro',
   'Bulk workbook import/export, drive sync, container reservations, advanced analytics.',
   '{
     "diaspora.workbook.download": true, "diaspora.workbook.upload": true, "diaspora.workbook.bulk_import": 200,
     "diaspora.stock.create": true, "diaspora.stock.publish": true, "diaspora.stock.max_items": 5000,
     "diaspora.rfq.create": true, "diaspora.rfq.respond": true, "diaspora.rfq.max_open": 100,
     "diaspora.ai.parse": true, "diaspora.ai.execute_medium": 250,
     "diaspora.container.reserve": true, "diaspora.container.manage": true,
     "diaspora.drive.connect": true, "diaspora.drive.export": true,
     "diaspora.api.access": false, "diaspora.audit.export": true,
     "diaspora.safetrade.create": true, "diaspora.graph.advanced": true
   }'::jsonb, true, 30),
  ('enterprise', 'Enterprise Partner', 'enterprise',
   'API access, branch/staff management, advanced dashboards, dedicated trade operations.',
   '{
     "diaspora.workbook.download": true, "diaspora.workbook.upload": true, "diaspora.workbook.bulk_import": 2000,
     "diaspora.stock.create": true, "diaspora.stock.publish": true, "diaspora.stock.max_items": 100000,
     "diaspora.rfq.create": true, "diaspora.rfq.respond": true, "diaspora.rfq.max_open": 1000,
     "diaspora.ai.parse": true, "diaspora.ai.execute_medium": 2000,
     "diaspora.container.reserve": true, "diaspora.container.manage": true,
     "diaspora.drive.connect": true, "diaspora.drive.export": true,
     "diaspora.api.access": true, "diaspora.audit.export": true,
     "diaspora.safetrade.create": true, "diaspora.graph.advanced": true
   }'::jsonb, true, 40)
ON CONFLICT (plan_key) DO NOTHING;

COMMENT ON TABLE public.diaspora_subscription_plans
  IS 'Config-driven plan catalog. Source of truth mirrored from backend/constants/diaspora/diasporaEntitlements.js.';
COMMENT ON TABLE public.diaspora_subscriptions
  IS 'Tenant-scoped subscriptions (PD-1: tenant plan + per-user overrides). At most one active per tenant.';
COMMENT ON TABLE public.diaspora_usage_reservations
  IS 'Reserve -> commit/release usage with per-key idempotency; replay never double-counts.';
COMMENT ON FUNCTION public.diaspora_reserve_usage_atomic(uuid, text, text, integer, integer, timestamptz, timestamptz, text)
  IS 'Atomic, idempotent quota reservation against diaspora_usage_meters. service_role EXECUTE only.';

-- +migrate Down
-- NOTE: dropping these tables removes the seeded plan catalog and ALL subscription/usage/override
-- history. This is the explicit, planned rollback for Phase 8.
DROP FUNCTION IF EXISTS public.diaspora_reserve_usage_atomic(
  uuid, text, text, integer, integer, timestamptz, timestamptz, text
);
DROP TABLE IF EXISTS public.diaspora_billing_provider_events;
DROP TABLE IF EXISTS public.diaspora_usage_reservations;
DROP TABLE IF EXISTS public.diaspora_usage_meters;
DROP TABLE IF EXISTS public.diaspora_user_entitlement_overrides;
DROP TABLE IF EXISTS public.diaspora_subscriptions;
DROP TABLE IF EXISTS public.diaspora_subscription_plans;
