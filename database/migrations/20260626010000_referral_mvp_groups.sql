-- CarUp Referral Engine Full-MVP Group Tables
-- Uses TEXT identifiers consistent with the referral schema (tenant_id TEXT, user_id TEXT).
-- Does NOT touch referral_conversions (table is not in the foundation schema).
-- All tables get RLS enabled with no broad public policies.
-- updated_at triggers added where appropriate.

-- ─── Shared trigger function ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ─── 1. referral_role_profiles ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_role_profiles (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT        NOT NULL DEFAULT 'platform',
  user_id       TEXT        NOT NULL,
  profile_type  TEXT        NOT NULL CHECK (profile_type IN ('ambassador', 'receiver', 'mechanic_supplier', 'agent_depot')),
  status        TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  tier          TEXT                 CHECK (tier IN ('starter', 'growth', 'pro')),
  metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id, profile_type)
);
CREATE INDEX IF NOT EXISTS idx_referral_role_profiles_tenant_user
  ON referral_role_profiles (tenant_id, user_id);
ALTER TABLE referral_role_profiles ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_referral_role_profiles_updated_at ON referral_role_profiles;
CREATE TRIGGER trg_referral_role_profiles_updated_at
  BEFORE UPDATE ON referral_role_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 2. referral_receiver_links ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_receiver_links (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         TEXT        NOT NULL DEFAULT 'platform',
  payer_user_id     TEXT        NOT NULL,
  receiver_user_id  TEXT,
  receiver_name     TEXT,
  receiver_phone    TEXT,
  receiver_location TEXT,
  reference         TEXT,
  subject_type      TEXT,
  subject_id        TEXT,
  acceptance_status TEXT        NOT NULL DEFAULT 'pending' CHECK (acceptance_status IN ('pending', 'accepted', 'rejected')),
  handover_status   TEXT        NOT NULL DEFAULT 'pending' CHECK (handover_status IN ('pending', 'confirmed', 'disputed')),
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_referral_receiver_links_payer
  ON referral_receiver_links (tenant_id, payer_user_id);
CREATE INDEX IF NOT EXISTS idx_referral_receiver_links_receiver
  ON referral_receiver_links (tenant_id, receiver_user_id)
  WHERE receiver_user_id IS NOT NULL;
ALTER TABLE referral_receiver_links ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_referral_receiver_links_updated_at ON referral_receiver_links;
CREATE TRIGGER trg_referral_receiver_links_updated_at
  BEFORE UPDATE ON referral_receiver_links
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 3. referral_trade_events ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_trade_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT        NOT NULL DEFAULT 'platform',
  actor_user_id   TEXT        NOT NULL,
  event_kind      TEXT        NOT NULL CHECK (event_kind IN (
                    'buyer_inquiry', 'seller_listing', 'parts_request',
                    'import_milestone', 'container_booking')),
  referral_code   TEXT,
  campaign_id     UUID        REFERENCES referral_campaigns(id) ON DELETE SET NULL,
  status          TEXT        NOT NULL DEFAULT 'open' CHECK (status IN (
                    'open', 'quoted', 'deposit_paid', 'confirmed', 'delivered',
                    'cancelled', 'refunded')),
  milestone       TEXT,
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_referral_trade_events_tenant_actor
  ON referral_trade_events (tenant_id, actor_user_id);
CREATE INDEX IF NOT EXISTS idx_referral_trade_events_kind
  ON referral_trade_events (tenant_id, event_kind);
ALTER TABLE referral_trade_events ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_referral_trade_events_updated_at ON referral_trade_events;
CREATE TRIGGER trg_referral_trade_events_updated_at
  BEFORE UPDATE ON referral_trade_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 4. referral_channel_preferences ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_channel_preferences (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        TEXT        NOT NULL DEFAULT 'platform',
  user_id          TEXT        NOT NULL,
  channel          TEXT        NOT NULL CHECK (channel IN (
                     'whatsapp', 'telegram', 'email', 'sms', 'social')),
  opted_in         BOOLEAN     NOT NULL DEFAULT false,
  opted_in_at      TIMESTAMPTZ,
  opted_out_at     TIMESTAMPTZ,
  language         TEXT        NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'sn', 'nd')),
  message_types    TEXT[]      NOT NULL DEFAULT '{}',
  opt_in_source    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_referral_channel_prefs_tenant_user
  ON referral_channel_preferences (tenant_id, user_id);
ALTER TABLE referral_channel_preferences ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_referral_channel_prefs_updated_at ON referral_channel_preferences;
CREATE TRIGGER trg_referral_channel_prefs_updated_at
  BEFORE UPDATE ON referral_channel_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 5. referral_reward_operations ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_reward_operations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             TEXT        NOT NULL DEFAULT 'platform',
  wallet_transaction_id UUID        REFERENCES referral_wallet_transactions(id) ON DELETE CASCADE,
  previous_status       TEXT        NOT NULL,
  new_status            TEXT        NOT NULL,
  actor_user_id         TEXT        NOT NULL,
  reason                TEXT        NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_referral_reward_ops_transaction
  ON referral_reward_operations (tenant_id, wallet_transaction_id);
CREATE INDEX IF NOT EXISTS idx_referral_reward_ops_actor
  ON referral_reward_operations (tenant_id, actor_user_id);
ALTER TABLE referral_reward_operations ENABLE ROW LEVEL SECURITY;

-- ─── 6. referral_payout_batches ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_payout_batches (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT        NOT NULL DEFAULT 'platform',
  status          TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'processed', 'cancelled')),
  total_amount    NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency        TEXT        NOT NULL DEFAULT 'USD',
  item_count      INTEGER     NOT NULL DEFAULT 0,
  exported_by     TEXT,
  exported_at     TIMESTAMPTZ,
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_referral_payout_batches_tenant
  ON referral_payout_batches (tenant_id, status);
ALTER TABLE referral_payout_batches ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_referral_payout_batches_updated_at ON referral_payout_batches;
CREATE TRIGGER trg_referral_payout_batches_updated_at
  BEFORE UPDATE ON referral_payout_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 7. referral_campaign_funnel_snapshots ────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_campaign_funnel_snapshots (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             TEXT        NOT NULL DEFAULT 'platform',
  campaign_id           UUID        REFERENCES referral_campaigns(id) ON DELETE SET NULL,
  snapshot_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  visits                INTEGER     NOT NULL DEFAULT 0,
  leads                 INTEGER     NOT NULL DEFAULT 0,
  qualified_leads       INTEGER     NOT NULL DEFAULT 0,
  conversions           INTEGER     NOT NULL DEFAULT 0,
  pending_reward_cost   NUMERIC(15,2) NOT NULL DEFAULT 0,
  paid_reward_cost      NUMERIC(15,2) NOT NULL DEFAULT 0,
  local_value           NUMERIC(15,2) NOT NULL DEFAULT 0,
  import_value          NUMERIC(15,2) NOT NULL DEFAULT 0,
  channel_metrics       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ambassador_metrics    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  fraud_count           INTEGER     NOT NULL DEFAULT 0,
  dispute_count         INTEGER     NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_referral_funnel_snapshots_tenant
  ON referral_campaign_funnel_snapshots (tenant_id, snapshot_at DESC);
ALTER TABLE referral_campaign_funnel_snapshots ENABLE ROW LEVEL SECURITY;
