-- Group 1: Roles
CREATE TABLE IF NOT EXISTS referral_role_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  role_type TEXT NOT NULL CHECK (role_type IN ('ambassador', 'zimbabwe_receiver', 'mechanic', 'agent')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, user_id, role_type)
);
ALTER TABLE referral_role_profiles ENABLE ROW LEVEL SECURITY;

-- Group 2: Trade Journeys
CREATE TABLE IF NOT EXISTS referral_trade_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  event_kind TEXT NOT NULL CHECK (event_kind IN ('buyer_inquiry', 'seller_listing', 'parts_request', 'import_milestone', 'container_booking')),
  referral_code_id UUID REFERENCES referral_codes(id),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE referral_trade_events ENABLE ROW LEVEL SECURITY;

-- Group 3: Operations
ALTER TABLE referral_conversions ADD COLUMN IF NOT EXISTS reward_status TEXT DEFAULT 'pending' CHECK (reward_status IN ('pending', 'approved', 'hold', 'block', 'reverse', 'payable', 'paid'));
ALTER TABLE referral_conversions ADD COLUMN IF NOT EXISTS reward_reason TEXT;
ALTER TABLE referral_conversions ADD COLUMN IF NOT EXISTS reward_actor_id UUID REFERENCES users(id);
ALTER TABLE referral_conversions ADD COLUMN IF NOT EXISTS channel_preferences JSONB DEFAULT '{}'::jsonb;

-- Group 4: Growth
CREATE TABLE IF NOT EXISTS referral_campaign_funnels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  campaign_id UUID REFERENCES referral_campaigns(id),
  language_draft TEXT,
  channel_conversions JSONB DEFAULT '{}'::jsonb,
  reward_cost NUMERIC(15,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE referral_campaign_funnels ENABLE ROW LEVEL SECURITY;
