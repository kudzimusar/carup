-- CarUp Referral Engine Phase 1
-- Foundation schema for codes, campaigns, coupons, wallets, share assets, and audit/event timelines.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_referral_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS referral_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT 'platform',
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  campaign_type TEXT NOT NULL CHECK (campaign_type IN ('LOCAL_MARKETPLACE', 'IMPORT_VEHICLE', 'IMPORT_PARTS', 'CONTAINER_SPACE', 'COMMUNITY_GROUP', 'AGENT_PARTNER')),
  priority_scope TEXT NOT NULL DEFAULT 'LOCAL' CHECK (priority_scope IN ('LOCAL', 'IMPORT', 'HYBRID')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED')),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  route_origin TEXT,
  route_destination TEXT,
  category TEXT,
  channel_strategy JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT 'platform',
  campaign_id UUID REFERENCES referral_campaigns(id) ON DELETE SET NULL,
  owner_user_id TEXT,
  code TEXT NOT NULL UNIQUE,
  code_type TEXT NOT NULL CHECK (code_type IN ('MEMBER', 'CAMPAIGN', 'COUPON', 'GROUP', 'AGENT')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED', 'EXPIRED', 'EXHAUSTED')),
  channel TEXT NOT NULL DEFAULT 'web',
  active_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  max_uses INTEGER CHECK (max_uses IS NULL OR max_uses >= 0),
  uses_count INTEGER NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
  location_scope TEXT[] NOT NULL DEFAULT '{}',
  role_scope TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  actor_type TEXT NOT NULL DEFAULT 'admin' CHECK (actor_type IN ('user', 'admin', 'system', 'agent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT 'platform',
  event_type TEXT NOT NULL,
  code_id UUID REFERENCES referral_codes(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES referral_campaigns(id) ON DELETE SET NULL,
  coupon_id UUID,
  wallet_transaction_id UUID,
  subject_type TEXT,
  subject_id TEXT,
  channel TEXT NOT NULL DEFAULT 'web',
  source TEXT,
  session_id TEXT,
  actor_user_id TEXT,
  actor_type TEXT NOT NULL DEFAULT 'system' CHECK (actor_type IN ('user', 'admin', 'system', 'agent')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT 'platform',
  campaign_id UUID REFERENCES referral_campaigns(id) ON DELETE SET NULL,
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED', 'EXPIRED', 'EXHAUSTED')),
  benefit_type TEXT NOT NULL DEFAULT 'buyer_discount',
  discount_type TEXT NOT NULL CHECK (discount_type IN ('PERCENT', 'FIXED', 'SERVICE_CREDIT')),
  discount_value NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  max_discount_amount NUMERIC(12,2),
  minimum_order_amount NUMERIC(12,2),
  currency TEXT NOT NULL DEFAULT 'USD',
  max_redemptions INTEGER CHECK (max_redemptions IS NULL OR max_redemptions >= 0),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT 'platform',
  coupon_id UUID NOT NULL REFERENCES referral_coupons(id) ON DELETE CASCADE,
  redeemer_user_id TEXT NOT NULL,
  order_reference TEXT,
  value_applied NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  redemption_status TEXT NOT NULL DEFAULT 'applied' CHECK (redemption_status IN ('applied', 'reversed', 'voided')),
  idempotency_key TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (coupon_id, redeemer_user_id),
  UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS referral_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT 'platform',
  user_id TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL DEFAULT 'USD',
  pending_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  approved_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  payable_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_or_applied_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT 'platform',
  wallet_id UUID NOT NULL REFERENCES referral_wallets(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  campaign_id UUID REFERENCES referral_campaigns(id) ON DELETE SET NULL,
  code_id UUID REFERENCES referral_codes(id) ON DELETE SET NULL,
  source_event_id UUID REFERENCES referral_events(id) ON DELETE SET NULL,
  source_event_type TEXT,
  transaction_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('created', 'pending', 'eligible', 'approved', 'payable', 'paid_or_applied', 'held', 'rejected')),
  amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  actor_type TEXT NOT NULL DEFAULT 'system' CHECK (actor_type IN ('user', 'admin', 'system', 'agent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT referral_signup_only_not_matured CHECK (
    source_event_type NOT IN ('user.signup', 'auth.signup', 'member.registered')
    OR status IN ('created', 'pending', 'held', 'rejected')
  )
);

CREATE TABLE IF NOT EXISTS referral_share_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT 'platform',
  code_id UUID NOT NULL REFERENCES referral_codes(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES referral_campaigns(id) ON DELETE SET NULL,
  asset_type TEXT NOT NULL DEFAULT 'share_kit',
  channel TEXT NOT NULL DEFAULT 'web',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_admin_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT 'platform',
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  actor_user_id TEXT,
  actor_role TEXT,
  previous_value JSONB,
  new_value JSONB,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  ALTER TABLE referral_events
    ADD CONSTRAINT referral_events_coupon_id_fkey
    FOREIGN KEY (coupon_id) REFERENCES referral_coupons(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE referral_events
    ADD CONSTRAINT referral_events_wallet_transaction_id_fkey
    FOREIGN KEY (wallet_transaction_id) REFERENCES referral_wallet_transactions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_referral_campaigns_status ON referral_campaigns(status, campaign_type, priority_scope);
CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_referral_codes_campaign ON referral_codes(campaign_id);
CREATE INDEX IF NOT EXISTS idx_referral_events_code ON referral_events(code_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_events_campaign ON referral_events(campaign_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_events_subject ON referral_events(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_referral_events_coupon ON referral_events(coupon_id);
CREATE INDEX IF NOT EXISTS idx_referral_events_wallet_transaction ON referral_events(wallet_transaction_id);
CREATE INDEX IF NOT EXISTS idx_referral_coupons_code ON referral_coupons(code);
CREATE INDEX IF NOT EXISTS idx_referral_coupons_campaign ON referral_coupons(campaign_id);
CREATE INDEX IF NOT EXISTS idx_referral_wallets_user ON referral_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_referral_wallet_transactions_wallet ON referral_wallet_transactions(wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_wallet_transactions_campaign ON referral_wallet_transactions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_referral_wallet_transactions_code ON referral_wallet_transactions(code_id);
CREATE INDEX IF NOT EXISTS idx_referral_wallet_transactions_source_event ON referral_wallet_transactions(source_event_id);
CREATE INDEX IF NOT EXISTS idx_referral_share_assets_code ON referral_share_assets(code_id);
CREATE INDEX IF NOT EXISTS idx_referral_share_assets_campaign ON referral_share_assets(campaign_id);

DROP TRIGGER IF EXISTS referral_campaigns_updated_at ON referral_campaigns;
CREATE TRIGGER referral_campaigns_updated_at BEFORE UPDATE ON referral_campaigns FOR EACH ROW EXECUTE FUNCTION set_referral_updated_at();
DROP TRIGGER IF EXISTS referral_codes_updated_at ON referral_codes;
CREATE TRIGGER referral_codes_updated_at BEFORE UPDATE ON referral_codes FOR EACH ROW EXECUTE FUNCTION set_referral_updated_at();
DROP TRIGGER IF EXISTS referral_coupons_updated_at ON referral_coupons;
CREATE TRIGGER referral_coupons_updated_at BEFORE UPDATE ON referral_coupons FOR EACH ROW EXECUTE FUNCTION set_referral_updated_at();
DROP TRIGGER IF EXISTS referral_wallets_updated_at ON referral_wallets;
CREATE TRIGGER referral_wallets_updated_at BEFORE UPDATE ON referral_wallets FOR EACH ROW EXECUTE FUNCTION set_referral_updated_at();
DROP TRIGGER IF EXISTS referral_wallet_transactions_updated_at ON referral_wallet_transactions;
CREATE TRIGGER referral_wallet_transactions_updated_at BEFORE UPDATE ON referral_wallet_transactions FOR EACH ROW EXECUTE FUNCTION set_referral_updated_at();

ALTER TABLE referral_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_coupon_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_share_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_admin_audit_events ENABLE ROW LEVEL SECURITY;
