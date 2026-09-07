-- +migrate Up
-- =============================================================
-- Trade OS T10.1 — consolidation and loading.
--
-- The T10.0 audit found the opposite of T9's problem. T9 had no vocabulary and no facts; T10 has the
-- word "loaded" in FIVE places and the fact in none of them:
--
--   diaspora_import_orders.status        READY_FOR_LOADING / LOADED   — a purchase's label
--   diaspora_container_shipments.status  LOADING                      — a sailing's own state
--   diaspora_shipments.status            LOADING                      — a different record again
--   diasporaTradeIntelligenceService     LOADING_IN_PROGRESS          — a heuristic's vocabulary
--   tradeTransactionStage                { key: 'LOADING', owner: 'T10' }  — a reserved slot
--
-- Not one of them records WHAT was loaded, WHO confirmed it, or WHEN. `POST /containers/:id/
-- mark-loading` already works today with no manifest at all, and `mark-shipped` sits immediately
-- after it. So this migration adds no sixth spelling of the word — it adds the fact underneath.
--
-- The boundaries it exists to hold:
--
--   BOOKED ≠ RECEIVED ≠ LOAD-READY ≠ PLANNED FOR LOAD ≠ ACTUALLY LOADED ≠ SHIPPED
--     T5        T9        T10 derived    T10 plan          T10 fact         T11
--
-- and the three measurements that must all remain representable at once:
--
--   BOOKED/ESTIMATED 3.0 CBM  (T5, never overwritten)
--   WAREHOUSE ACTUAL 3.8 CBM  (T9, never overwritten)
--   ACTUALLY LOADED  3.6 CBM  (T10, new)
--
-- A PLAN and a LOADED FACT are two records on purpose. A plan is provisional and editable; a loaded
-- fact is an attributed act, like a T9 receipt. Collapsing them is how a plan silently becomes a
-- claim about reality.
--
-- What this schema deliberately CANNOT express: departed, in transit, arrived, customs-cleared,
-- delivered. There is no column to smuggle a T11 or T12 fact into. LOADED ≠ DEPARTED.
-- =============================================================

-- ── 1. The plan ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diaspora_container_load_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NULL,
  container_id uuid NOT NULL REFERENCES public.diaspora_container_shipments(id) ON DELETE CASCADE,
  reference text NOT NULL,

  -- A plan is provisional until somebody commits to it, and stays editable until then.
  -- SUPERSEDED exists so a revised plan does not destroy the one the crew was working from.
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'CONFIRMED', 'SUPERSEDED', 'CANCELLED')),

  planned_by text NULL REFERENCES public.users(id) ON DELETE SET NULL,
  confirmed_by text NULL REFERENCES public.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz NULL,
  notes text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NULL, updated_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,

  -- Confirming a plan is a decision somebody made. An unattributed confirmation is not one.
  CONSTRAINT load_plan_confirmation_is_attributed CHECK (
    status <> 'CONFIRMED' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.diaspora_container_load_plans IS
  'T10 load-plan authority. A PLAN, not a manifest of what happened: it says what an operator '
  'intends to put in a container. Actual loading lives in diaspora_container_loads.';

-- One live plan per container. A revision supersedes; it does not coexist.
CREATE UNIQUE INDEX IF NOT EXISTS uq_container_live_load_plan
  ON public.diaspora_container_load_plans (container_id)
  WHERE deleted_at IS NULL AND status IN ('DRAFT', 'CONFIRMED');

-- ── 2. What the plan proposes ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diaspora_container_load_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_plan_id uuid NOT NULL REFERENCES public.diaspora_container_load_plans(id) ON DELETE CASCADE,
  tenant_id text NULL,

  -- The same generic binding T6 charges, T7 threads, T8 documents and T9 intakes use.
  subject_type text NOT NULL CHECK (subject_type IN ('cargo_reservation', 'logistics_request')),
  subject_id text NOT NULL CHECK (length(btrim(subject_id)) > 0),
  -- The T9 receipt this line is planned against, when the cargo has actually arrived. Nullable
  -- because an operator may plan around cargo that is still expected — but planning is the only
  -- thing they may do with it.
  intake_id uuid NULL REFERENCES public.diaspora_warehouse_intakes(id) ON DELETE SET NULL,

  disposition text NOT NULL CHECK (disposition IN ('PLANNED_IN', 'PLANNED_OUT')),
  -- Deciding NOT to load something is a decision the affected participant has to be able to read.
  exclusion_reason text NULL CHECK (exclusion_reason IS NULL OR exclusion_reason IN (
    'NOT_RECEIVED', 'DOES_NOT_FIT', 'DOCUMENTS_OUTSTANDING', 'CONDITION_ISSUE',
    'PARTICIPANT_REQUEST', 'OPERATIONAL_EXCEPTION'
  )),

  planned_volume_cbm numeric(12,3) NULL CHECK (planned_volume_cbm IS NULL OR planned_volume_cbm > 0),
  planned_weight_kg numeric(12,3) NULL CHECK (planned_weight_kg IS NULL OR planned_weight_kg > 0),
  -- WHICH number this line was planned against. Planning on a booking estimate and planning on a
  -- warehouse measurement are different acts, and a reader has to be able to tell them apart.
  planned_source text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (planned_source IN ('BOOKED_ESTIMATE', 'WAREHOUSE_ACTUAL', 'UNKNOWN')),

  notes text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NULL, updated_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,

  CONSTRAINT load_plan_exclusion_has_reason CHECK (
    disposition <> 'PLANNED_OUT' OR (exclusion_reason IS NOT NULL)
  ),
  -- A figure without its provenance is a number somebody will later mistake for a measurement.
  CONSTRAINT load_plan_figure_has_source CHECK (
    (planned_volume_cbm IS NULL AND planned_weight_kg IS NULL) OR planned_source <> 'UNKNOWN'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_load_plan_item_subject
  ON public.diaspora_container_load_plan_items (load_plan_id, subject_type, subject_id)
  WHERE deleted_at IS NULL;

-- ── 3. What actually happened ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diaspora_container_loads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NULL,
  container_id uuid NOT NULL REFERENCES public.diaspora_container_shipments(id) ON DELETE CASCADE,
  -- The plan this load was worked from, when there was one. A load without a plan is still a load.
  load_plan_id uuid NULL REFERENCES public.diaspora_container_load_plans(id) ON DELETE SET NULL,
  reference text NOT NULL,

  -- The vocabulary stops at COMPLETED. There is no DEPARTED, no SHIPPED, no IN_TRANSIT: T11 owns
  -- what a container does after it is closed, and this table has nowhere to say it.
  status text NOT NULL DEFAULT 'IN_PROGRESS'
    CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'ABANDONED')),

  confirmed_by text NULL REFERENCES public.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz NULL,
  -- Totals OBSERVED at the door, when anybody observed them. Never derived from the plan: a planned
  -- total dressed as an actual is the same collapse as an estimate dressed as a measurement.
  actual_loaded_volume_cbm numeric(12,3) NULL CHECK (actual_loaded_volume_cbm IS NULL OR actual_loaded_volume_cbm > 0),
  actual_loaded_weight_kg numeric(12,3) NULL CHECK (actual_loaded_weight_kg IS NULL OR actual_loaded_weight_kg > 0),
  abandon_reason text NULL,
  notes text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NULL, updated_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,

  -- Same rule as a T9 receipt: "loaded, by nobody, at no time" is not a load.
  CONSTRAINT load_completion_is_attributed CHECK (
    status <> 'COMPLETED' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
  ),
  CONSTRAINT load_abandonment_has_reason CHECK (
    status <> 'ABANDONED' OR (abandon_reason IS NOT NULL AND length(btrim(abandon_reason)) > 0)
  )
);

COMMENT ON TABLE public.diaspora_container_loads IS
  'T10 actual-loading authority. Records what physically went into a container, who confirmed it '
  'and when. Says nothing about departure — LOADED is not DEPARTED, and T11 owns that.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_container_live_load
  ON public.diaspora_container_loads (container_id)
  WHERE deleted_at IS NULL AND status IN ('IN_PROGRESS', 'COMPLETED');

-- ── 4. Line by line, including what did NOT go in ───────────────────────
CREATE TABLE IF NOT EXISTS public.diaspora_container_load_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id uuid NOT NULL REFERENCES public.diaspora_container_loads(id) ON DELETE CASCADE,
  tenant_id text NULL,

  subject_type text NOT NULL CHECK (subject_type IN ('cargo_reservation', 'logistics_request')),
  subject_id text NOT NULL CHECK (length(btrim(subject_id)) > 0),
  intake_id uuid NULL REFERENCES public.diaspora_warehouse_intakes(id) ON DELETE SET NULL,

  outcome text NOT NULL CHECK (outcome IN ('LOADED', 'LEFT_BEHIND')),
  -- Cargo that was planned and did not go in stays on the manifest. Deleting the line would erase
  -- the only record that somebody's goods were expected on this sailing and are not on it.
  left_behind_reason text NULL CHECK (left_behind_reason IS NULL OR left_behind_reason IN (
    'NO_SPACE', 'DID_NOT_FIT', 'CONDITION_ISSUE', 'DOCUMENTS_OUTSTANDING',
    'NOT_PRESENTED', 'PARTICIPANT_REQUEST', 'OPERATIONAL_EXCEPTION'
  )),

  loaded_volume_cbm numeric(12,3) NULL CHECK (loaded_volume_cbm IS NULL OR loaded_volume_cbm > 0),
  loaded_weight_kg numeric(12,3) NULL CHECK (loaded_weight_kg IS NULL OR loaded_weight_kg > 0),

  loaded_by text NULL REFERENCES public.users(id) ON DELETE SET NULL,
  loaded_at timestamptz NULL,
  notes text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NULL, updated_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,

  -- An attributed act, exactly like a T9 receipt.
  CONSTRAINT load_item_loading_is_attributed CHECK (
    outcome <> 'LOADED' OR (loaded_by IS NOT NULL AND loaded_at IS NOT NULL)
  ),
  CONSTRAINT load_item_left_behind_has_reason CHECK (
    outcome <> 'LEFT_BEHIND' OR left_behind_reason IS NOT NULL
  ),
  -- Cargo that was left behind has no loaded volume. A figure here would say it went in.
  CONSTRAINT load_item_left_behind_has_no_figures CHECK (
    outcome <> 'LEFT_BEHIND' OR (loaded_volume_cbm IS NULL AND loaded_weight_kg IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_load_item_subject
  ON public.diaspora_container_load_items (load_id, subject_type, subject_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_load_items_load ON public.diaspora_container_load_items (load_id, outcome) WHERE deleted_at IS NULL;

-- ── 5. Container and seal identifiers ───────────────────────────────────
--
-- The audit found NO container-number or seal field anywhere in the schema. They go here rather
-- than as mutable columns on the load, because §31 requires history: a seal that changes must leave
-- the previous one readable with who recorded it and when. Append-only, latest authoritative — the
-- same shape as a T9 measurement.
CREATE TABLE IF NOT EXISTS public.diaspora_container_seal_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id uuid NOT NULL REFERENCES public.diaspora_container_loads(id) ON DELETE CASCADE,
  tenant_id text NULL,

  -- Both nullable, because a crew may know one and not the other. Unknown stays unknown: a
  -- plausible container number invented to complete a screen is a number somebody will later quote
  -- to a shipping line.
  container_number text NULL CHECK (container_number IS NULL OR length(btrim(container_number)) > 0),
  seal_number text NULL CHECK (seal_number IS NULL OR length(btrim(seal_number)) > 0),
  -- Why this record exists — the first observation, or a seal that was replaced.
  record_reason text NOT NULL DEFAULT 'OBSERVED'
    CHECK (record_reason IN ('OBSERVED', 'CORRECTED', 'SEAL_REPLACED')),
  reason_note text NULL,

  recorded_by text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NULL, updated_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,

  -- A record that records neither identifier is not a record of anything.
  CONSTRAINT seal_record_states_something CHECK (
    container_number IS NOT NULL OR seal_number IS NOT NULL
  ),
  -- Replacing a seal is the case that matters most later; it has to say why.
  CONSTRAINT seal_replacement_has_note CHECK (
    record_reason <> 'SEAL_REPLACED' OR (reason_note IS NOT NULL AND length(btrim(reason_note)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_seal_records_load
  ON public.diaspora_container_seal_records (load_id, recorded_at DESC) WHERE deleted_at IS NULL;

-- ── 6. Governed access ──────────────────────────────────────────────────
-- The row that says whose cargo went into a container — and whose did not — must not be writable
-- from a browser through PostgREST. Same posture as T9 and the GMO tables.
ALTER TABLE public.diaspora_container_load_plans       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_container_load_plans       FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_container_load_plan_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_container_load_plan_items  FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_container_loads            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_container_loads            FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_container_load_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_container_load_items       FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_container_seal_records     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_container_seal_records     FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON public.diaspora_container_load_plans       FROM anon, authenticated;
REVOKE ALL ON public.diaspora_container_load_plan_items  FROM anon, authenticated;
REVOKE ALL ON public.diaspora_container_loads            FROM anon, authenticated;
REVOKE ALL ON public.diaspora_container_load_items       FROM anon, authenticated;
REVOKE ALL ON public.diaspora_container_seal_records     FROM anon, authenticated;

-- +migrate Down
DROP TABLE IF EXISTS public.diaspora_container_seal_records;
DROP TABLE IF EXISTS public.diaspora_container_load_items;
DROP TABLE IF EXISTS public.diaspora_container_loads;
DROP TABLE IF EXISTS public.diaspora_container_load_plan_items;
DROP TABLE IF EXISTS public.diaspora_container_load_plans;
