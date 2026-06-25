-- CarUp Referral Engine Wave A: Identity and Attribution Schema

-- 1. Add is_permanent to referral_codes
ALTER TABLE referral_codes ADD COLUMN IF NOT EXISTS is_permanent BOOLEAN NOT NULL DEFAULT false;

-- 2. Partial unique index to guarantee one permanent MEMBER code per tenant and owner
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_codes_permanent_owner 
  ON referral_codes(tenant_id, owner_user_id) 
  WHERE is_permanent = true;

-- 3. Create referral_attribution_journeys
CREATE TABLE IF NOT EXISTS referral_attribution_journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT 'platform',
  anonymous_journey_id TEXT,
  user_id TEXT,
  first_touch_id UUID,
  last_touch_id UUID,
  reward_owner_user_id TEXT,
  campaign_id UUID REFERENCES referral_campaigns(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Create referral_attribution_touches
CREATE TABLE IF NOT EXISTS referral_attribution_touches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT 'platform',
  journey_id UUID NOT NULL REFERENCES referral_attribution_journeys(id) ON DELETE CASCADE,
  touch_kind TEXT NOT NULL CHECK (touch_kind IN ('first', 'last', 'assisted')),
  code_id UUID REFERENCES referral_codes(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES referral_campaigns(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  source TEXT,
  session_id TEXT,
  subject_type TEXT,
  subject_id TEXT,
  actor_type TEXT NOT NULL DEFAULT 'user',
  actor_user_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add foreign keys to journeys pointing to touches
DO $$
BEGIN
  ALTER TABLE referral_attribution_journeys
    ADD CONSTRAINT fk_journey_first_touch
    FOREIGN KEY (first_touch_id) REFERENCES referral_attribution_touches(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE referral_attribution_journeys
    ADD CONSTRAINT fk_journey_last_touch
    FOREIGN KEY (last_touch_id) REFERENCES referral_attribution_touches(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_referral_attr_journeys_anon ON referral_attribution_journeys(anonymous_journey_id);
CREATE INDEX IF NOT EXISTS idx_referral_attr_journeys_user ON referral_attribution_journeys(user_id);
CREATE INDEX IF NOT EXISTS idx_referral_attr_touches_journey ON referral_attribution_touches(journey_id);
CREATE INDEX IF NOT EXISTS idx_referral_attr_touches_code ON referral_attribution_touches(code_id);
CREATE INDEX IF NOT EXISTS idx_referral_attr_touches_idemp ON referral_attribution_touches(idempotency_key);

-- Triggers for updated_at
DROP TRIGGER IF EXISTS referral_attr_journeys_updated_at ON referral_attribution_journeys;
CREATE TRIGGER referral_attr_journeys_updated_at 
  BEFORE UPDATE ON referral_attribution_journeys 
  FOR EACH ROW EXECUTE FUNCTION set_referral_updated_at();

-- RLS Enablement
ALTER TABLE referral_attribution_journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_attribution_touches ENABLE ROW LEVEL SECURITY;

-- Note: We rely on server-side functions/Service Role for inserts and updates. 
-- No public INSERT/UPDATE policies are granted to anon/authenticated.
