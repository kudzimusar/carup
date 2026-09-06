-- +migrate Up
-- =============================================================================
-- GMO-1 — Garage applications
--
-- The missing link. Service Network consumes a governed `tenant_users` membership of a `garage`
-- tenant, and nothing in the product creates one: every production reference to `tenants` and
-- `tenant_users` is a SELECT. This table is where a real garage's request to join is recorded so a
-- reviewer has something to decide and an activation service has something to act on.
--
-- What this table is NOT: it is not authority. A row here grants nothing. Only
-- BusinessActivationService (GMO-4), acting on an approved decision, may create a tenant or a
-- membership.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.garage_applications (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- The person applying. Their base account stays an ordinary personal account throughout; nothing
  -- about this row changes `users.role`.
  applicant_user_id         TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- The six states the product must represent (GMO-3). These describe the APPLICATION.
  -- `user_registration_profiles.onboarding_status` describes the PERSON's onboarding and is kept in
  -- step by the service — a different object, not a synonym.
  --   draft                → being filled in, not yet visible to a reviewer
  --   submitted            → handed to review
  --   information_required → reviewer asked for something; the SAME application stays active (PO-5)
  --   under_review         → a reviewer is working on it
  --   approved             → terminal; eligible for activation
  --   rejected             → terminal and historical; never rewritten back to draft (PO-5)
  status                    TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','submitted','information_required','under_review','approved','rejected')),

  -- Business identity (PO-2 minimum activation evidence, fields 3-7).
  trading_name              TEXT,
  address_line              TEXT,
  location_city             TEXT,
  location_province         TEXT,
  contact_phone             TEXT,
  contact_email             TEXT,
  service_categories        TEXT[] NOT NULL DEFAULT '{}',

  -- The applicant's declared relationship to the business (PO-2 field 6). A declaration, not proof.
  applicant_relationship    TEXT
                            CHECK (applicant_relationship IS NULL OR applicant_relationship IN ('owner','manager','authorised_representative')),

  -- PO-2 field 8. Recorded with a timestamp so "they attested" is a fact with a time, not a boolean.
  attestation_accepted_at   TIMESTAMPTZ,

  -- Lifecycle provenance.
  submitted_at              TIMESTAMPTZ,
  decided_at                TIMESTAMPTZ,
  decided_by_user_id        TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  decision_reason_code      TEXT,
  decision_reason           TEXT,

  -- PO-5: a rejected application is terminal history. A reapplication is a NEW row pointing at the
  -- one it follows, so the full prior audit trail survives instead of being overwritten.
  supersedes_application_id UUID REFERENCES public.garage_applications(id) ON DELETE SET NULL,

  -- Set by BusinessActivationService only (GMO-4). Its presence is what makes activation idempotent:
  -- an already-activated application cannot produce a second tenant.
  activated_tenant_id       UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  activated_at              TIMESTAMPTZ,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Only a decided application carries a decision, and only a decided one may be activated.
  CONSTRAINT garage_applications_decision_coherent CHECK (
    (status IN ('approved','rejected') AND decided_at IS NOT NULL)
    OR (status NOT IN ('approved','rejected') AND decided_at IS NULL)
  ),
  CONSTRAINT garage_applications_activation_requires_approval CHECK (
    activated_tenant_id IS NULL OR status = 'approved'
  )
);

-- One LIVE application per person. A terminal one (approved/rejected) is history and does not block
-- a reapplication (PO-5). Partial index rather than a plain UNIQUE so history accumulates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_garage_applications_one_live_per_applicant
  ON public.garage_applications (applicant_user_id)
  WHERE status IN ('draft','submitted','information_required','under_review');

-- An approved application may be activated at most once, whatever the caller does.
CREATE UNIQUE INDEX IF NOT EXISTS idx_garage_applications_one_activation_per_tenant
  ON public.garage_applications (activated_tenant_id)
  WHERE activated_tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_garage_applications_status ON public.garage_applications (status);
CREATE INDEX IF NOT EXISTS idx_garage_applications_applicant ON public.garage_applications (applicant_user_id);

-- Append-only decision ledger. Mirrors the Dealer Compliance pattern: the reviewer's verbs are
-- recorded as events, and the application row carries the resulting state.
CREATE TABLE IF NOT EXISTS public.garage_application_decisions (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id     UUID NOT NULL REFERENCES public.garage_applications(id) ON DELETE CASCADE,
  decision           TEXT NOT NULL
                     CHECK (decision IN ('request_more_info','approve','reject','start_review')),
  reason_code        TEXT,
  reason             TEXT,
  actor_user_id      TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  actor_role         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_garage_application_decisions_application
  ON public.garage_application_decisions (application_id, created_at DESC);
