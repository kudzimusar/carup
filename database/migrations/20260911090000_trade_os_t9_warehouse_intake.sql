-- +migrate Up
-- =============================================================
-- Trade OS T9.1 — warehouse intake and measurement.
--
-- The T9.0 audit found NO warehouse authority anywhere: no warehouse, no intake, no receipt, no
-- measurement. This creates it, as T5 created the corridor authority.
--
-- The boundary this schema exists to hold:
--
--     ESTIMATED (what the customer said)  ≠  ACTUAL (what the warehouse observed)
--
-- The estimate lives on diaspora_cargo_reservations / diaspora_logistics_request_items and is NOT
-- touched here — not one column of it. Actuals live in their own table with who measured, when,
-- where and how. Both are true statements about different moments, and collapsing them destroys the
-- only record of the disagreement.
--
-- What this schema deliberately CANNOT express: loaded, shipped, departed, customs-cleared, or a
-- Trust verdict. Those belong to T10/T11/T12/T14 and there is no column here to smuggle them into.
-- =============================================================

-- ── 1. The receiving operation ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diaspora_warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NULL,
  name text NOT NULL,
  country text NOT NULL,
  city text NULL,
  address_line text NULL,
  -- Who operates it. Authority to receive is derived from this, never from a request body.
  operator_user_id text NULL REFERENCES public.users(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NULL, updated_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

COMMENT ON TABLE public.diaspora_warehouses IS
  'T9 receiving-operation authority. Owns WHERE cargo is physically received. Not a party profile '
  'and not a storage provider.';

-- ── 2. Physical receipt ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diaspora_warehouse_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NULL,
  warehouse_id uuid NOT NULL REFERENCES public.diaspora_warehouses(id) ON DELETE RESTRICT,
  -- What is being received, in the generic idiom the rest of Trade OS already uses.
  subject_type text NOT NULL CHECK (subject_type IN ('cargo_reservation', 'logistics_request')),
  subject_id text NOT NULL CHECK (length(btrim(subject_id)) > 0),
  reference text NOT NULL,

  -- EXPECTED is not received. A booking being approved says space was committed, not that anything
  -- arrived; only an authorized receiving action moves this on.
  status text NOT NULL DEFAULT 'EXPECTED'
    CHECK (status IN ('EXPECTED', 'RECEIVED', 'CONDITIONALLY_RECEIVED', 'REFUSED')),

  received_by text NULL REFERENCES public.users(id) ON DELETE SET NULL,
  received_at timestamptz NULL,
  -- Only when actually assigned. An unknown position stays unknown rather than becoming "Bay A-12".
  storage_location text NULL,
  observed_package_count integer NULL CHECK (observed_package_count IS NULL OR observed_package_count >= 0),
  -- The receiver's own observation, never an inference from an image.
  condition text NULL CHECK (condition IS NULL OR condition IN ('good', 'minor_damage', 'major_damage', 'incomplete', 'unverifiable')),
  outcome_reason text NULL,
  notes text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NULL, updated_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,

  -- A receipt must say WHO received it and WHEN. "Received, by nobody, at no time" is not a receipt.
  CONSTRAINT intake_receipt_is_attributed CHECK (
    status = 'EXPECTED'
    OR (received_by IS NOT NULL AND received_at IS NOT NULL)
  ),
  -- An outcome that is not a plain receipt must say why. A refusal without a reason is unusable to
  -- the customer it affects.
  CONSTRAINT intake_exception_has_reason CHECK (
    status NOT IN ('CONDITIONALLY_RECEIVED', 'REFUSED')
    OR (outcome_reason IS NOT NULL AND length(btrim(outcome_reason)) > 0)
  )
);

-- One live intake per cargo. A second receipt for the same thing is a correction, not a new arrival.
CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouse_intake_subject
  ON public.diaspora_warehouse_intakes (subject_type, subject_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_warehouse_intakes_warehouse
  ON public.diaspora_warehouse_intakes (warehouse_id, status) WHERE deleted_at IS NULL;

-- ── 3. Actual measurement ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diaspora_warehouse_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid NOT NULL REFERENCES public.diaspora_warehouse_intakes(id) ON DELETE CASCADE,
  tenant_id text NULL,

  -- Units are explicit. A number without its unit is not a measurement.
  length_value numeric(12,3) NULL CHECK (length_value IS NULL OR length_value > 0),
  width_value  numeric(12,3) NULL CHECK (width_value  IS NULL OR width_value  > 0),
  height_value numeric(12,3) NULL CHECK (height_value IS NULL OR height_value > 0),
  dimension_unit text NULL CHECK (dimension_unit IS NULL OR dimension_unit IN ('cm', 'm')),
  weight_value numeric(12,3) NULL CHECK (weight_value IS NULL OR weight_value > 0),
  weight_unit text NULL CHECK (weight_unit IS NULL OR weight_unit IN ('kg', 't')),
  package_count integer NULL CHECK (package_count IS NULL OR package_count >= 0),

  -- Derived by the SERVER from the actual dimensions above. A client-computed CBM is a claim.
  actual_volume_cbm numeric(12,3) NULL CHECK (actual_volume_cbm IS NULL OR actual_volume_cbm > 0),

  measured_by text NULL REFERENCES public.users(id) ON DELETE SET NULL,
  measured_at timestamptz NOT NULL DEFAULT now(),
  method text NOT NULL DEFAULT 'manual' CHECK (method IN ('manual', 'scale', 'dimensioner', 'estimated_by_staff')),
  notes text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NULL, updated_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,

  -- Dimensions come as a SET with their unit, or not at all. Two of three sides is not a box.
  CONSTRAINT measurement_dimensions_complete CHECK (
    (length_value IS NULL AND width_value IS NULL AND height_value IS NULL AND dimension_unit IS NULL)
    OR (length_value IS NOT NULL AND width_value IS NOT NULL AND height_value IS NOT NULL AND dimension_unit IS NOT NULL)
  ),
  -- A weight needs its unit.
  CONSTRAINT measurement_weight_has_unit CHECK (
    (weight_value IS NULL AND weight_unit IS NULL) OR (weight_value IS NOT NULL AND weight_unit IS NOT NULL)
  ),
  -- A measurement that measured nothing is not a measurement.
  CONSTRAINT measurement_observes_something CHECK (
    length_value IS NOT NULL OR weight_value IS NOT NULL OR package_count IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_warehouse_measurements_intake
  ON public.diaspora_warehouse_measurements (intake_id) WHERE deleted_at IS NULL;

-- ── 4. Governed access ──────────────────────────────────────────────────
-- Same posture as the GMO tables: the row that decides whether somebody's cargo was received must
-- not be writable from a browser through PostgREST.
ALTER TABLE public.diaspora_warehouses              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_warehouses              FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_warehouse_intakes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_warehouse_intakes       FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_warehouse_measurements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_warehouse_measurements  FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON public.diaspora_warehouses             FROM anon, authenticated;
REVOKE ALL ON public.diaspora_warehouse_intakes      FROM anon, authenticated;
REVOKE ALL ON public.diaspora_warehouse_measurements FROM anon, authenticated;

-- +migrate Down
DROP TABLE IF EXISTS public.diaspora_warehouse_measurements;
DROP TABLE IF EXISTS public.diaspora_warehouse_intakes;
DROP TABLE IF EXISTS public.diaspora_warehouses;
