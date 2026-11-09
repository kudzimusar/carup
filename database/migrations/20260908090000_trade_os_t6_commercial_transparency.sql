-- +migrate Up
-- =============================================================
-- Trade OS T6 — commercial transparency: FX snapshots, charge components, rate
-- observations and shared-capacity allocation.
--
-- T6.0 audit (master plan §44) found that almost none of the commercial layer exists: no FX
-- authority anywhere in the repository, no charge-component authority, no rate authority, no
-- landed-cost authority, no allocation authority. Logistics offers carry FIVE FIXED numeric
-- columns — a sixth charge cannot be expressed at all, and none of the five carries its own
-- currency, inclusion state, provenance or revenue classification. Procurement offers carry no
-- components whatsoever. So this migration ADDS; it replaces nothing.
--
-- The permanent money model these tables exist to protect:
--
--     SOURCE MONEY      original amount + currency — the permanent commercial truth
--     REFERENCE USD     comparison only, always shown beside its source and its snapshot
--     SETTLEMENT MONEY  what is actually transferred                              — T13
--     CUSTOMS MONEY     the basis a customs authority legally applies             — T12
--
-- Reference FX may never silently become settlement or customs FX. Unknown is never zero.
-- =============================================================

-- ── 1. FX reference snapshots ───────────────────────────────────────────
--
-- Immutable. A snapshot carries everything needed to REPRODUCE a conversion, including the
-- triangulation legs when the source is not quoted directly against the pair (the ECB publishes
-- EUR-based rates, so JPY→USD is JPY→EUR→USD and must never become an unexplained magic number).

CREATE TABLE IF NOT EXISTS public.diaspora_fx_rate_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_currency text NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
  quote_currency text NOT NULL CHECK (quote_currency ~ '^[A-Z]{3}$'),
  -- 1 base_currency = rate quote_currency. Strictly positive: a zero or negative rate is not a
  -- degraded rate, it is a corrupt one, and must never be storable.
  rate numeric(20,10) NOT NULL CHECK (rate > 0),
  -- The date the SOURCE says the rate is effective for — never "when we fetched it".
  rate_date date NOT NULL,
  source text NOT NULL,
  source_reference text NULL,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  -- AVAILABLE: the source published this for the requested date.
  -- STALE: the newest published rate is older than the requested date (weekend, holiday, outage).
  -- UNAVAILABLE is deliberately NOT a stored state — an absent snapshot IS unavailability, and
  -- storing a row for it would invite it being read as a rate.
  status text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','STALE')),
  -- The legs actually used, when triangulated. Reproducibility, not decoration.
  triangulation jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.diaspora_fx_rate_snapshots IS
  'T6 REFERENCE FX only — for comparison and display. Never settlement FX (T13), never customs '
  'valuation FX (T12). Immutable: a historical snapshot is evidence for a conversion that was '
  'already shown to someone, so it is never overwritten.';

-- One snapshot per pair, per effective date, per source. A re-fetch of the same day is a no-op,
-- which is what makes same-date replay safe.
CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_fx_snapshot_pair_date_source
  ON public.diaspora_fx_rate_snapshots (base_currency, quote_currency, rate_date, source);

CREATE INDEX IF NOT EXISTS idx_diaspora_fx_snapshot_lookup
  ON public.diaspora_fx_rate_snapshots (base_currency, quote_currency, rate_date DESC);

-- Immutability is enforced, not merely documented. A quote that displayed "≈ USD 532.14" must be
-- reproducible forever; silently editing the rate behind it would rewrite commercial history.
CREATE OR REPLACE FUNCTION public.diaspora_fx_snapshot_is_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'DIASPORA_T6/FX_SNAPSHOT_IMMUTABLE: fx snapshots cannot be updated or deleted (id=%)', OLD.id;
END;
$$;

DROP TRIGGER IF EXISTS trg_diaspora_fx_snapshot_immutable ON public.diaspora_fx_rate_snapshots;
CREATE TRIGGER trg_diaspora_fx_snapshot_immutable
  BEFORE UPDATE OR DELETE ON public.diaspora_fx_rate_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.diaspora_fx_snapshot_is_immutable();

-- ── 2. Charge components ────────────────────────────────────────────────
--
-- ONE table, not two. A component attaches to either a procurement offer or a logistics offer. A
-- polymorphic (owner_type, owner_id) pair would abandon referential integrity; two near-identical
-- tables would duplicate every rule. Two nullable FKs with a CHECK that exactly one is set gives
-- real FK integrity into both domains and one service path — the shape T4 used for the
-- continuation edge, for the same reason.

CREATE TABLE IF NOT EXISTS public.diaspora_trade_charge_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_quote_id uuid NULL REFERENCES public.diaspora_import_quotes(id) ON DELETE CASCADE,
  logistics_quote_id uuid NULL REFERENCES public.diaspora_logistics_quotes(id) ON DELETE CASCADE,
  CONSTRAINT diaspora_charge_component_exactly_one_owner
    CHECK (num_nonnulls(import_quote_id, logistics_quote_id) = 1),

  -- WHICH STAGE of the journey this charge belongs to. The taxonomy identifies a charge's TYPE;
  -- it never asserts that the charge exists.
  cost_stage text NOT NULL CHECK (cost_stage IN (
    'GOODS','ORIGIN','EXPORT','ORIGIN_TERMINAL','MAIN_CARRIAGE','INSURANCE','TRANSSHIPMENT',
    'DESTINATION_PORT','TRANSIT','IMPORT_CUSTOMS','REGULATORY','CLEARING','INLAND',
    'FINAL_DELIVERY','FINANCE','CARUP','EXCEPTIONS')),
  label text NOT NULL,

  -- SOURCE MONEY. NULL amount means UNKNOWN/unpriced — it does NOT mean zero, and the estimate
  -- composer must surface it as an unpriced stage rather than adding 0.
  original_amount numeric(14,2) NULL,
  original_currency text NULL CHECK (original_currency IS NULL OR original_currency ~ '^[A-Z]{3}$'),
  -- Money always carries its own currency. This closes the pre-existing hazard where every legacy
  -- money column is NOT NULL DEFAULT 'USD', so an omitted currency silently became USD.
  CONSTRAINT diaspora_charge_component_money_has_currency
    CHECK (original_amount IS NULL OR original_currency IS NOT NULL),

  quantity numeric(14,3) NULL,
  unit text NULL,
  unit_rate numeric(14,4) NULL,
  basis text NULL CHECK (basis IS NULL OR basis IN ('FLAT','PER_CBM','PER_KG','PER_VEHICLE','PER_UNIT','PER_CONTAINER','PERCENTAGE')),

  -- Four dimensions that must never collapse into one another.
  inclusion text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (inclusion IN ('INCLUDED','EXCLUDED','CONTINGENT','NOT_APPLICABLE','UNKNOWN')),
  commercial_status text NOT NULL DEFAULT 'INDICATIVE'
    CHECK (commercial_status IN ('INDICATIVE','QUOTED','CONFIRMED')),
  provenance text NOT NULL DEFAULT 'PROVIDER_STATED'
    CHECK (provenance IN ('CUSTOMER_ESTIMATED','CARUP_CALCULATED','PROVIDER_STATED','DOCUMENT_DERIVED','VERIFIED','HISTORICAL_ACTUAL')),
  revenue_class text NOT NULL DEFAULT 'PASS_THROUGH_COST'
    CHECK (revenue_class IN ('PASS_THROUGH_COST','GOVERNMENT_DUTY','TAX','PARTNER_CHARGE',
      'CARUP_SERVICE_FEE','CARUP_COMMISSION','CARUP_LOGISTICS_MARGIN','CONTINGENT_COST')),

  service_scope text NULL,
  valid_from date NULL,
  valid_until date NULL,
  -- T8 forward compatibility: a component can later point at its evidence without redesign.
  -- Presence is not verification, and T6 implements no upload or verification lifecycle.
  evidence_document_id uuid NULL REFERENCES public.diaspora_trade_documents(id) ON DELETE SET NULL,
  notes text NULL,

  created_by text NULL REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by text NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

COMMENT ON TABLE public.diaspora_trade_charge_components IS
  'T6 structured charge authority for BOTH quote domains (exactly one owner FK is set). A NULL '
  'original_amount means UNPRICED, never zero. inclusion / commercial_status / provenance / '
  'revenue_class are four independent dimensions: QUOTED+PROVIDER_STATED and CONFIRMED+VERIFIED '
  'mean different things, and CarUp revenue is never labelled as a third party''s charge.';

CREATE INDEX IF NOT EXISTS idx_diaspora_charge_components_import_quote
  ON public.diaspora_trade_charge_components (import_quote_id) WHERE deleted_at IS NULL AND import_quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_diaspora_charge_components_logistics_quote
  ON public.diaspora_trade_charge_components (logistics_quote_id) WHERE deleted_at IS NULL AND logistics_quote_id IS NOT NULL;

-- ── 3. Rate observations ────────────────────────────────────────────────
--
-- Deliberately SEPARATE from quotes. A research observation is not a provider quote; an official
-- government fee is not a CarUp estimate; a historical actual is not a current market rate. Keeping
-- them in the quote tables would let a blog price masquerade as something a provider offered.

CREATE TABLE IF NOT EXISTS public.diaspora_trade_rate_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classification text NOT NULL CHECK (classification IN (
    'PROVIDER_QUOTED','PROVIDER_RATE_CARD','OFFICIAL_FEE','RESEARCH_OBSERVATION',
    'CARUP_ESTIMATE','HISTORICAL_ACTUAL')),
  -- Certification fixtures must be unmistakable. A synthetic row may never be presented as
  -- current market economics.
  is_synthetic boolean NOT NULL DEFAULT false,

  cost_stage text NOT NULL CHECK (cost_stage IN (
    'GOODS','ORIGIN','EXPORT','ORIGIN_TERMINAL','MAIN_CARRIAGE','INSURANCE','TRANSSHIPMENT',
    'DESTINATION_PORT','TRANSIT','IMPORT_CUSTOMS','REGULATORY','CLEARING','INLAND',
    'FINAL_DELIVERY','FINANCE','CARUP','EXCEPTIONS')),
  label text NOT NULL,

  corridor_id uuid NULL REFERENCES public.diaspora_trade_corridors(id) ON DELETE SET NULL,
  corridor_leg_id uuid NULL REFERENCES public.diaspora_trade_corridor_legs(id) ON DELETE SET NULL,
  mode text NULL,
  cargo_applicability text NULL,

  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  basis text NULL CHECK (basis IS NULL OR basis IN ('FLAT','PER_CBM','PER_KG','PER_VEHICLE','PER_UNIT','PER_CONTAINER','PERCENTAGE')),
  unit text NULL,
  min_amount numeric(14,2) NULL,
  max_amount numeric(14,2) NULL,

  effective_from date NOT NULL,
  effective_to date NULL,
  CONSTRAINT diaspora_rate_observation_effective_range
    CHECK (effective_to IS NULL OR effective_to >= effective_from),

  source_name text NOT NULL,
  source_reference text NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  provider_tenant_id uuid NULL REFERENCES public.tenants(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUPERSEDED','WITHDRAWN')),
  notes text NULL,

  created_by text NULL REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by text NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

COMMENT ON TABLE public.diaspora_trade_rate_observations IS
  'T6 rate/market observations, kept SEPARATE from provider quotes so a research figure can never '
  'be displayed as something a provider offered the customer. is_synthetic marks certification '
  'fixtures so they can never be mistaken for market economics.';

CREATE INDEX IF NOT EXISTS idx_diaspora_rate_observations_corridor
  ON public.diaspora_trade_rate_observations (corridor_id, cost_stage, effective_from DESC)
  WHERE deleted_at IS NULL AND status = 'ACTIVE';

-- ── 4. Shared-capacity charge allocation ────────────────────────────────
--
-- Only APPROVED reservations may participate: a REQUESTED reservation consumes no capacity (T5's
-- frozen invariant) and must not become a customer charge merely because it exists. The service
-- enforces that; this table records the outcome and its basis.

CREATE TABLE IF NOT EXISTS public.diaspora_shared_charge_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_component_id uuid NOT NULL
    REFERENCES public.diaspora_trade_charge_components(id) ON DELETE CASCADE,
  reservation_id uuid NOT NULL
    REFERENCES public.diaspora_cargo_reservations(id) ON DELETE CASCADE,

  -- Explicit governed bases only. There is deliberately no default: silently allocating by CBM
  -- because it is convenient would invent a commercial rule CarUp has not agreed.
  allocation_basis text NOT NULL CHECK (allocation_basis IN ('CBM','WEIGHT','UNIT','FLAT','EXPLICIT')),
  allocated_amount numeric(14,2) NOT NULL CHECK (allocated_amount >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  basis_quantity numeric(14,3) NULL,
  basis_total numeric(14,3) NULL,
  -- The remainder cent(s) land on exactly one participant, deterministically, so the allocations
  -- sum to the source charge exactly rather than to "about" it.
  rounding_remainder numeric(14,2) NOT NULL DEFAULT 0,

  created_by text NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

-- One allocation per participant per charge. Re-running an allocation is an update, never a
-- silent second row that would double-charge somebody.
CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_allocation_component_reservation
  ON public.diaspora_shared_charge_allocations (charge_component_id, reservation_id)
  WHERE deleted_at IS NULL;

-- ── 5. RLS ──────────────────────────────────────────────────────────────
-- FX snapshots and ACTIVE rate observations are reference data readable by authenticated
-- participants. Charge components and allocations follow their owning transaction, so they are
-- service_role-only at the row level and the services do participant scoping — the same posture
-- the existing quote authorities use.

ALTER TABLE public.diaspora_fx_rate_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_trade_charge_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_trade_rate_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_shared_charge_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS diaspora_fx_snapshots_read ON public.diaspora_fx_rate_snapshots;
CREATE POLICY diaspora_fx_snapshots_read ON public.diaspora_fx_rate_snapshots
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS diaspora_rate_observations_read ON public.diaspora_trade_rate_observations;
CREATE POLICY diaspora_rate_observations_read ON public.diaspora_trade_rate_observations
  FOR SELECT TO authenticated USING (deleted_at IS NULL AND status = 'ACTIVE');

REVOKE ALL ON public.diaspora_fx_rate_snapshots FROM anon;
REVOKE ALL ON public.diaspora_trade_charge_components FROM anon;
REVOKE ALL ON public.diaspora_trade_rate_observations FROM anon;
REVOKE ALL ON public.diaspora_shared_charge_allocations FROM anon;
REVOKE ALL ON public.diaspora_trade_charge_components FROM authenticated;
REVOKE ALL ON public.diaspora_shared_charge_allocations FROM authenticated;
GRANT SELECT ON public.diaspora_fx_rate_snapshots TO authenticated;
GRANT SELECT ON public.diaspora_trade_rate_observations TO authenticated;

-- +migrate Down

DROP TABLE IF EXISTS public.diaspora_shared_charge_allocations;
DROP TABLE IF EXISTS public.diaspora_trade_rate_observations;
DROP TABLE IF EXISTS public.diaspora_trade_charge_components;
DROP TRIGGER IF EXISTS trg_diaspora_fx_snapshot_immutable ON public.diaspora_fx_rate_snapshots;
DROP FUNCTION IF EXISTS public.diaspora_fx_snapshot_is_immutable();
DROP TABLE IF EXISTS public.diaspora_fx_rate_snapshots;
