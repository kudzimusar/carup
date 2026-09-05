-- +migrate Up
-- Seller UAT remediation: registration identity dimensions are not authorization roles.
--
-- Public signup still creates ONLY the unprivileged public.users.role='owner'. This table records
-- how the person/business relates to the market so Diaspora, dealer/exporter intent and individual
-- selling do not become privilege-bearing role strings. Business access is activated later by the
-- governed tenant/stakeholder onboarding path.

CREATE TABLE IF NOT EXISTS public.user_registration_profiles (
  user_id                 text PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  account_kind            text NOT NULL CHECK (account_kind IN ('individual', 'business')),
  market_relationship     text NOT NULL CHECK (market_relationship IN ('zimbabwe_local', 'diaspora', 'international')),
  country_of_residence    text NOT NULL,
  city                    text NOT NULL,
  province                text,
  intended_use            text NOT NULL CHECK (intended_use IN ('buy', 'sell', 'buy_sell', 'professional_services')),
  organization_name       text,
  business_type           text CHECK (business_type IN (
                              'dealer', 'exporter', 'importer', 'garage', 'mechanic',
                              'parts_seller', 'insurer', 'lender', 'other'
                            )),
  onboarding_status       text NOT NULL DEFAULT 'not_required'
                          CHECK (onboarding_status IN ('not_required', 'requested', 'in_review', 'approved', 'rejected')),
  marketing_consent       boolean NOT NULL DEFAULT false,
  terms_acknowledged_at   timestamptz NOT NULL,
  privacy_acknowledged_at timestamptz NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registration_business_details CHECK (
    (account_kind = 'individual' AND organization_name IS NULL AND business_type IS NULL AND onboarding_status = 'not_required')
    OR
    (account_kind = 'business' AND organization_name IS NOT NULL AND business_type IS NOT NULL AND onboarding_status <> 'not_required')
  )
);

CREATE INDEX IF NOT EXISTS idx_user_registration_profiles_market
  ON public.user_registration_profiles (market_relationship);
CREATE INDEX IF NOT EXISTS idx_user_registration_profiles_business
  ON public.user_registration_profiles (business_type)
  WHERE account_kind = 'business';

COMMENT ON TABLE public.user_registration_profiles IS
  'Non-authorizing signup context. Local/Diaspora/international and business intent must never grant a platform role.';

ALTER TABLE public.user_registration_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_registration_profiles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_registration_profiles FROM anon, authenticated;
GRANT ALL ON public.user_registration_profiles TO service_role;

-- +migrate Down
DROP TABLE IF EXISTS public.user_registration_profiles;
