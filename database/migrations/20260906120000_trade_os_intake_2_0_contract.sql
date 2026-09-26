-- +migrate Up
-- =============================================================
-- Trade OS — Comprehensive Intake 2.0 (canonical contract §36).
--
-- Two kinds of change, and the split is the whole point:
--
--   1. STRUCTURED COLUMNS for facts that are validated, matched against supply, queried, or
--      privacy-gated. Every column below earns its place by one of those four tests. They are NOT
--      put in `metadata`, because a JSON blob cannot be CHECK-constrained, cannot be indexed for
--      matching, and cannot be partially projected to a supplier — which means every later phase
--      would re-read the blob and invent its own interpretation of it.
--
--   2. AN APPEND-ONLY OBSERVATION LEDGER for facts a later authority supersedes. A customer's
--      "about 400 kg" and a warehouse scale's "437 kg" are two observations of one thing, and the
--      difference between them is exactly what a dispute or a capacity refusal turns on. A column
--      pair (value, provenance) cannot hold both; an append-only ledger can.
--
-- No new transaction authority is created. The ledger holds observations ABOUT existing subjects
-- and owns no transaction identity of its own.
-- =============================================================

-- ── 1. Procurement header: outcome, commercial meaning and intent ───────
--
-- These are the facts that decide what a supplier may see (budget disclosure), what supply
-- actually matches (destination outcome, shipping objective), and what later phases must not have
-- to ask again (clearing, insurance, inspection, payment intent).
ALTER TABLE public.diaspora_import_orders
  ADD COLUMN IF NOT EXISTS intake_intent TEXT NULL
    CHECK (intake_intent IN ('buy_vehicle','buy_parts','managed_import')),
  -- What the customer's number MEANS. A budget with no scope is not a budget: "USD 24,000" is a
  -- different request depending on whether it ends at the auction or on a driveway in Harare.
  ADD COLUMN IF NOT EXISTS budget_basis TEXT NULL
    CHECK (budget_basis IN ('item_only','fob','export_side','cif_port','port_cleared','delivered','unsure')),
  ADD COLUMN IF NOT EXISTS budget_max_amount NUMERIC(14,2) NULL,
  ADD COLUMN IF NOT EXISTS budget_flexibility TEXT NULL
    CHECK (budget_flexibility IN ('firm','somewhat_flexible','flexible','unsure')),
  -- Privacy-bearing: a budget is a negotiating position, so silence stays silence.
  ADD COLUMN IF NOT EXISTS budget_disclosed BOOLEAN NOT NULL DEFAULT FALSE,
  -- The OUTCOME the customer wants, in their own terms — not a port they should not have to choose.
  ADD COLUMN IF NOT EXISTS destination_outcome TEXT NULL
    CHECK (destination_outcome IN ('port_only','port_plus_clearing','cross_border_transit','port_to_city','door_delivery','unsure')),
  ADD COLUMN IF NOT EXISTS destination_area TEXT NULL,
  ADD COLUMN IF NOT EXISTS preferred_port TEXT NULL,
  ADD COLUMN IF NOT EXISTS consignee_kind TEXT NULL
    CHECK (consignee_kind IN ('self','my_company','another_person','another_company','undecided')),
  -- What matters to the customer, asked BEFORE any freight jargon.
  ADD COLUMN IF NOT EXISTS shipping_objective TEXT NULL
    CHECK (shipping_objective IN ('lowest_cost','faster_arrival','better_protection','extra_goods','non_running','multiple_vehicles','private_container','flexible')),
  ADD COLUMN IF NOT EXISTS shipping_mode_preference TEXT NULL
    CHECK (shipping_mode_preference IN ('no_preference','roro','shared_container','private_container','provider_recommendation')),
  -- Intentions. Each is customer-stated and creates no capability: selecting "help me" does not
  -- appoint a broker, issue a policy, or book an inspection.
  ADD COLUMN IF NOT EXISTS inspection_intent TEXT NULL
    CHECK (inspection_intent IN ('please_arrange','already_arranged','already_completed','unsure','not_applicable')),
  ADD COLUMN IF NOT EXISTS insurance_intent TEXT NULL
    CHECK (insurance_intent IN ('interested','not_interested','already_insured','unsure')),
  ADD COLUMN IF NOT EXISTS clearing_intent TEXT NULL
    CHECK (clearing_intent IN ('own_agent','want_provider','arrange_later','unsure')),
  ADD COLUMN IF NOT EXISTS payment_intent TEXT NULL
    CHECK (payment_intent IN ('bank_transfer','already_paid','outstanding','financing_needed','installments_interest','safetrade_interest','decide_after_quote','other')),
  -- Timing as a window, not a single date, and never converted into a carrier ETA.
  ADD COLUMN IF NOT EXISTS available_from DATE NULL,
  ADD COLUMN IF NOT EXISTS arrival_window_start DATE NULL,
  ADD COLUMN IF NOT EXISTS arrival_window_end DATE NULL,
  ADD COLUMN IF NOT EXISTS deadline_is_hard BOOLEAN NULL,
  ADD COLUMN IF NOT EXISTS timing_flexibility TEXT NULL
    CHECK (timing_flexibility IN ('fixed','somewhat_flexible','flexible')),
  -- What the customer wants supplier offers to ADDRESS. Requesting a component says nothing about
  -- whether a supplier offers it — the offer remains the authority on what it includes.
  ADD COLUMN IF NOT EXISTS requested_quote_components TEXT[] NULL,
  ADD COLUMN IF NOT EXISTS alternatives_policy TEXT NULL
    CHECK (alternatives_policy IN ('exact_only','flexible_trim','similar_models','supplier_may_propose','ask_before_proposing'));

-- Matching: suppliers filter opportunities by outcome and objective, so these must not scan.
CREATE INDEX IF NOT EXISTS idx_diaspora_import_orders_intake_match
  ON public.diaspora_import_orders (destination_outcome, shipping_objective)
  WHERE deleted_at IS NULL;

-- ── 2. Procurement lines: vehicle and part attributes that MATCH supply ──
--
-- These live on the LINE because a request can carry several of them, and on columns because they
-- are exactly what a supplier filters inventory by. UNKNOWN / NO PREFERENCE stays legitimate: a
-- non-expert customer must never be forced to invent a drivetrain to publish a request, so every
-- column is nullable and null means "no preference stated".
ALTER TABLE public.diaspora_import_order_request_lines
  ADD COLUMN IF NOT EXISTS vehicle_body_type TEXT NULL,
  ADD COLUMN IF NOT EXISTS vehicle_fuel_type TEXT NULL,
  ADD COLUMN IF NOT EXISTS vehicle_transmission TEXT NULL
    CHECK (vehicle_transmission IN ('automatic','manual','either')),
  ADD COLUMN IF NOT EXISTS vehicle_drivetrain TEXT NULL
    CHECK (vehicle_drivetrain IN ('2wd','4wd_awd','either')),
  ADD COLUMN IF NOT EXISTS vehicle_steering TEXT NULL
    CHECK (vehicle_steering IN ('rhd','lhd','either')),
  ADD COLUMN IF NOT EXISTS vehicle_seats_min INTEGER NULL,
  ADD COLUMN IF NOT EXISTS vehicle_mileage_max_km INTEGER NULL,
  ADD COLUMN IF NOT EXISTS vehicle_colour_preference TEXT NULL,
  ADD COLUMN IF NOT EXISTS vehicle_trim_preference TEXT NULL,
  ADD COLUMN IF NOT EXISTS vehicle_generation_code TEXT NULL,
  ADD COLUMN IF NOT EXISTS vehicle_engine_cc_min INTEGER NULL,
  ADD COLUMN IF NOT EXISTS vehicle_engine_cc_max INTEGER NULL,
  ADD COLUMN IF NOT EXISTS vehicle_auction_grade TEXT NULL,
  -- Tolerances, not verdicts. "no_accident_repairs" is what the customer will accept; it asserts
  -- nothing about any particular vehicle's history, which only Vehicle Trust can speak to.
  ADD COLUMN IF NOT EXISTS accident_repair_tolerance TEXT NULL
    CHECK (accident_repair_tolerance IN ('none','minor_acceptable','flexible','unsure')),
  ADD COLUMN IF NOT EXISTS rust_tolerance TEXT NULL
    CHECK (rust_tolerance IN ('none','minor_acceptable','flexible','unsure')),
  ADD COLUMN IF NOT EXISTS intended_use TEXT NULL
    CHECK (intended_use IN ('personal_family','company','taxi_ride_hailing','dealer_resale','commercial_transport','farm','mining_industrial','restoration_project','donor_parts','other')),
  ADD COLUMN IF NOT EXISTS alternative_models TEXT[] NULL,
  ADD COLUMN IF NOT EXISTS part_side TEXT NULL,
  ADD COLUMN IF NOT EXISTS part_origin_preference TEXT NULL
    CHECK (part_origin_preference IN ('oem','aftermarket','either')),
  ADD COLUMN IF NOT EXISTS brand_preference TEXT NULL;

-- ── 3. Logistics header: handling intent ────────────────────────────────
ALTER TABLE public.diaspora_logistics_requests
  ADD COLUMN IF NOT EXISTS pickup_required TEXT NULL
    CHECK (pickup_required IN ('yes','no','unsure')),
  ADD COLUMN IF NOT EXISTS origin_site_type TEXT NULL
    CHECK (origin_site_type IN ('auction','dealer','exporter','private_seller','warehouse_yard','carup_partner_yard','customer_location','other')),
  ADD COLUMN IF NOT EXISTS destination_outcome TEXT NULL
    CHECK (destination_outcome IN ('port_only','port_plus_clearing','cross_border_transit','port_to_city','door_delivery','unsure')),
  ADD COLUMN IF NOT EXISTS shipping_objective TEXT NULL
    CHECK (shipping_objective IN ('lowest_cost','faster_arrival','better_protection','extra_goods','non_running','multiple_vehicles','private_container','flexible')),
  ADD COLUMN IF NOT EXISTS available_from DATE NULL,
  ADD COLUMN IF NOT EXISTS arrival_window_start DATE NULL,
  ADD COLUMN IF NOT EXISTS arrival_window_end DATE NULL,
  ADD COLUMN IF NOT EXISTS timing_flexibility TEXT NULL
    CHECK (timing_flexibility IN ('fixed','somewhat_flexible','flexible'));

-- ── 4. Logistics cargo: handling and declarations ───────────────────────
--
-- Declarations are CUSTOMER-STATED and establish no carrier eligibility. Ticking "batteries" is a
-- disclosure that a provider must then confirm; it is never CarUp certifying hazardous carriage.
ALTER TABLE public.diaspora_logistics_request_items
  ADD COLUMN IF NOT EXISTS packaging_type TEXT NULL,
  ADD COLUMN IF NOT EXISTS goods_nature TEXT NULL
    CHECK (goods_nature IN ('new','used','personal_effects','commercial_goods','unsure')),
  ADD COLUMN IF NOT EXISTS declared_value NUMERIC(14,2) NULL,
  ADD COLUMN IF NOT EXISTS declared_value_currency TEXT NULL,
  ADD COLUMN IF NOT EXISTS handling_flags TEXT[] NULL,
  ADD COLUMN IF NOT EXISTS content_declarations TEXT[] NULL,
  ADD COLUMN IF NOT EXISTS vehicle_running_state TEXT NULL
    CHECK (vehicle_running_state IN ('runs_and_drives','starts_only','non_running','unknown')),
  ADD COLUMN IF NOT EXISTS vehicle_keys_state TEXT NULL
    CHECK (vehicle_keys_state IN ('available','missing','unknown')),
  ADD COLUMN IF NOT EXISTS export_clearance_state TEXT NULL
    CHECK (export_clearance_state IN ('completed','in_progress','not_started','unknown'));

-- ── 5. The observation ledger ───────────────────────────────────────────
--
-- The one genuinely new authority, and it is deliberately NOT a transaction: it stores observations
-- ABOUT subjects that already exist, and owns no identity, status or lifecycle of its own.
--
-- Append-only by policy: T9 recording a warehouse measurement INSERTS an observation, it does not
-- UPDATE the customer's estimate. The newest row per (subject, fact) is what surfaces; the earlier
-- rows remain readable, which is the only way "customer said 400, scale said 437" can ever be
-- answered honestly.
CREATE TABLE IF NOT EXISTS public.diaspora_trade_fact_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  subject_type TEXT NOT NULL
    CHECK (subject_type IN ('import_order','import_order_line','logistics_request','logistics_request_item')),
  subject_id uuid NOT NULL,
  fact_key TEXT NOT NULL,
  value_numeric NUMERIC(14,3) NULL,
  value_text TEXT NULL,
  unit TEXT NULL,
  -- VERIFIED is reachable only from an authority. No customer selection may produce it; the service
  -- layer refuses it from a customer-facing caller and a test pins that refusal.
  provenance TEXT NOT NULL
    CHECK (provenance IN ('CUSTOMER_STATED','CUSTOMER_ESTIMATED','CARUP_CALCULATED','PROVIDER_STATED','WAREHOUSE_MEASURED','CARRIER_STATED','DOCUMENT_DERIVED','VERIFIED')),
  observed_by TEXT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_trade_fact_observations_subject
  ON public.diaspora_trade_fact_observations (subject_type, subject_id, fact_key, observed_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.diaspora_trade_fact_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_trade_fact_observations FORCE ROW LEVEL SECURITY;

-- Same posture as every sibling Diaspora trade table: the API roles get nothing directly, and all
-- access goes through the governed service on the service_role connection.
REVOKE ALL ON public.diaspora_trade_fact_observations FROM PUBLIC;
REVOKE ALL ON public.diaspora_trade_fact_observations FROM anon;
REVOKE ALL ON public.diaspora_trade_fact_observations FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.diaspora_trade_fact_observations TO service_role;

-- +migrate Down
DROP TABLE IF EXISTS public.diaspora_trade_fact_observations;

ALTER TABLE public.diaspora_logistics_request_items
  DROP COLUMN IF EXISTS packaging_type, DROP COLUMN IF EXISTS goods_nature,
  DROP COLUMN IF EXISTS declared_value, DROP COLUMN IF EXISTS declared_value_currency,
  DROP COLUMN IF EXISTS handling_flags, DROP COLUMN IF EXISTS content_declarations,
  DROP COLUMN IF EXISTS vehicle_running_state, DROP COLUMN IF EXISTS vehicle_keys_state,
  DROP COLUMN IF EXISTS export_clearance_state;

ALTER TABLE public.diaspora_logistics_requests
  DROP COLUMN IF EXISTS pickup_required, DROP COLUMN IF EXISTS origin_site_type,
  DROP COLUMN IF EXISTS destination_outcome, DROP COLUMN IF EXISTS shipping_objective,
  DROP COLUMN IF EXISTS available_from, DROP COLUMN IF EXISTS arrival_window_start,
  DROP COLUMN IF EXISTS arrival_window_end, DROP COLUMN IF EXISTS timing_flexibility;

DROP INDEX IF EXISTS public.idx_diaspora_import_orders_intake_match;

ALTER TABLE public.diaspora_import_order_request_lines
  DROP COLUMN IF EXISTS vehicle_body_type, DROP COLUMN IF EXISTS vehicle_fuel_type,
  DROP COLUMN IF EXISTS vehicle_transmission, DROP COLUMN IF EXISTS vehicle_drivetrain,
  DROP COLUMN IF EXISTS vehicle_steering, DROP COLUMN IF EXISTS vehicle_seats_min,
  DROP COLUMN IF EXISTS vehicle_mileage_max_km, DROP COLUMN IF EXISTS vehicle_colour_preference,
  DROP COLUMN IF EXISTS vehicle_trim_preference, DROP COLUMN IF EXISTS vehicle_generation_code,
  DROP COLUMN IF EXISTS vehicle_engine_cc_min, DROP COLUMN IF EXISTS vehicle_engine_cc_max,
  DROP COLUMN IF EXISTS vehicle_auction_grade, DROP COLUMN IF EXISTS accident_repair_tolerance,
  DROP COLUMN IF EXISTS rust_tolerance, DROP COLUMN IF EXISTS intended_use,
  DROP COLUMN IF EXISTS alternative_models, DROP COLUMN IF EXISTS part_side,
  DROP COLUMN IF EXISTS part_origin_preference, DROP COLUMN IF EXISTS brand_preference;

ALTER TABLE public.diaspora_import_orders
  DROP COLUMN IF EXISTS intake_intent, DROP COLUMN IF EXISTS budget_basis,
  DROP COLUMN IF EXISTS budget_max_amount, DROP COLUMN IF EXISTS budget_flexibility,
  DROP COLUMN IF EXISTS budget_disclosed, DROP COLUMN IF EXISTS destination_outcome,
  DROP COLUMN IF EXISTS destination_area, DROP COLUMN IF EXISTS preferred_port,
  DROP COLUMN IF EXISTS consignee_kind, DROP COLUMN IF EXISTS shipping_objective,
  DROP COLUMN IF EXISTS shipping_mode_preference, DROP COLUMN IF EXISTS inspection_intent,
  DROP COLUMN IF EXISTS insurance_intent, DROP COLUMN IF EXISTS clearing_intent,
  DROP COLUMN IF EXISTS payment_intent, DROP COLUMN IF EXISTS available_from,
  DROP COLUMN IF EXISTS arrival_window_start, DROP COLUMN IF EXISTS arrival_window_end,
  DROP COLUMN IF EXISTS deadline_is_hard, DROP COLUMN IF EXISTS timing_flexibility,
  DROP COLUMN IF EXISTS requested_quote_components, DROP COLUMN IF EXISTS alternatives_policy;
