-- +migrate Up
-- Operations Control Plane M2: governed Seller Authority.
--
-- WHY A TABLE (schema decision rule, start prompt §10): the pre-existing
-- seller-claim flow persisted only an immutable SELLER_AUTHORITY_CLAIM_REQUESTED
-- trust_audit_events row per (vin, user). That cannot support: a queryable
-- CURRENT state for the publication gate, a reviewer decision lifecycle,
-- supersession, dispute/revocation, or idempotent concurrent decisions —
-- replaying the audit ledger inside every completeness evaluation is neither
-- cheap nor race-safe. The audit ledger REMAINS the decision history authority;
-- this table holds only the current governed state per (vin, seller).
--
-- Seller Authority is a CarUp policy decision (Truth level 3). It is NOT
-- Zimbabwe registration, NOT legal title certification, and never mutates
-- vehicles.owner_id / current_seller_id / tenant_id (one vehicle, one Passport).
CREATE TABLE IF NOT EXISTS vehicle_seller_authority (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin              TEXT NOT NULL,
  seller_user_id   TEXT NOT NULL,
  claim_type       TEXT NOT NULL DEFAULT 'owner'
                     CHECK (claim_type IN ('owner', 'authorised_seller', 'dealer')),
  status           TEXT NOT NULL DEFAULT 'evidence_submitted'
                     CHECK (status IN (
                       'evidence_submitted',
                       'under_review',
                       'confirmed',
                       'insufficient',
                       'disputed',
                       'revoked'
                     )),
  -- What supported the current decision (policy provenance, G6/G12).
  basis            TEXT
                     CHECK (basis IS NULL OR basis IN (
                       'existing_relationship',
                       'reviewed_ownership_registration_evidence',
                       'reviewed_permanent_import_evidence_set',
                       'dealer_tenant_inventory'
                     )),
  evidence_ids     UUID[] NOT NULL DEFAULT '{}',
  reason           TEXT,
  policy_version   TEXT NOT NULL DEFAULT 'seller_authority.v1',
  decided_by       TEXT,
  decided_by_role  TEXT,
  decided_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_seller_authority_unique_claim UNIQUE (vin, seller_user_id),
  -- A decision state must carry its decider; submission states need none yet.
  CONSTRAINT vehicle_seller_authority_decided_attribution CHECK (
    status IN ('evidence_submitted', 'under_review')
    OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_vehicle_seller_authority_vin
  ON vehicle_seller_authority (vin);
CREATE INDEX IF NOT EXISTS idx_vehicle_seller_authority_status
  ON vehicle_seller_authority (status);

-- Backend-only access, same posture as the finance obligation authority:
-- RLS on, no anon/authenticated policies, service_role only.
ALTER TABLE vehicle_seller_authority ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON TABLE vehicle_seller_authority TO service_role;

DO $m2_post$
BEGIN
  IF to_regclass('public.vehicle_seller_authority') IS NULL THEN
    RAISE EXCEPTION '[Operations M2] vehicle_seller_authority table is missing';
  END IF;
END
$m2_post$;

-- +migrate Down
-- Forward-only: decisions may exist; disable consumers and forward-fix instead.
SELECT 1;
