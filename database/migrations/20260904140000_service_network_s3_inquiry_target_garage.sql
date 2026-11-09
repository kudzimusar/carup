-- =============================================================
-- SERVICE NETWORK FOUNDATION 1.0 — S3: Marketplace convergence
-- (docs/service-network-foundation, S0 freeze §4.2; plan §10.2)
-- =============================================================
-- Marketplace already recognises inquiry_type 'garage_service_request', but
-- nothing on the row says WHICH garage the request was directed to: createInquiry
-- populates seller_id/seller_tenant_id only for VEHICLE_BOUND_TYPES, so a service
-- request lands with both NULL.
--
-- The plan is explicit that seller semantics must NOT be overloaded to fake a
-- routing relationship (§10.2). This adds the smallest truthful additive field
-- instead, so the question "which garage tenant was this service request directed
-- to?" has one unambiguous answer.
--
-- Marketplace keeps owning acquisition intent (Invariant 8); Service Network owns
-- the target garage, acceptance and work lifecycle. This column is the seam.

-- +migrate Up

ALTER TABLE public.marketplace_inquiries
  ADD COLUMN IF NOT EXISTS target_provider_tenant_id UUID;

COMMENT ON COLUMN public.marketplace_inquiries.target_provider_tenant_id IS
  'Service Network (S3): the garage/provider tenant this service request was directed to. '
  'Distinct from seller_id/seller_tenant_id, which remain marketplace SELLER semantics and are '
  'never overloaded for service routing. NULL for every non-service inquiry and for legacy '
  'service requests created before this bridge existed.';

CREATE INDEX IF NOT EXISTS idx_mpi_target_provider_tenant
  ON public.marketplace_inquiries(target_provider_tenant_id)
  WHERE target_provider_tenant_id IS NOT NULL;

-- +migrate Down
DROP INDEX IF EXISTS idx_mpi_target_provider_tenant;
ALTER TABLE public.marketplace_inquiries DROP COLUMN IF EXISTS target_provider_tenant_id;
