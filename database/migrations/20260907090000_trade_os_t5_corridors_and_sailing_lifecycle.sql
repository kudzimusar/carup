-- +migrate Up
-- =============================================================
-- Trade OS T5 — corridor reference authority + corridor-aware sailing facts + mode reconciliation.
--
-- The governing correction (master plan §40): a customer's FINAL DESTINATION is not the
-- destination of the individual sailing they reserve capacity on. Harare stays Harare while the
-- booked ocean leg ends at Beira. Today the schema cannot even express that: compatibility is
-- country-equality between the request and the container, so a real Yokohama→Beira sailing can
-- never serve a Zimbabwe request without lying about one side.
--
-- T5.1 audit findings this migration answers (and nothing more):
--   · NO corridor/route authority exists anywhere in the repository — the only "corridor" is an
--     Intelligence display label derived from order rows. So the authority is created here.
--   · `origin_port` / `destination_port` live in container METADATA, written by the operator UI.
--     The destination port is THE gateway fact (Beira vs Durban) that corridor matching reads, so
--     both are promoted to columns. The remaining metadata facts (loading_window, carrier_name,
--     booking_reference, documentation_notes, participant_notes) are display-only, matched by
--     nothing, and deliberately stay metadata.
--   · `metadata.total_capacity_weight` is READ BY the hardened approval RPC
--     (diaspora_approve_cargo_reservation_atomic). Promoting it would mean rewriting the certified
--     capacity kernel for zero behavioural gain — it deliberately stays where the kernel reads it.
--   · The container status CHECK already contains DRAFT / BOOKING_OPEN / BOOKING_CLOSED /
--     CANCELLED (plus legacy LOADING/SHIPPED/ARRIVED/COMPLETED, which are T10/T11 vocabulary that
--     T5 must not use as truth). The T5.3 lifecycle needs NO check change — only services stop
--     hardcoding BOOKING_OPEN at creation.
--   · Intake can say `roro`; the provider-offer CHECK cannot. That one value is added. No RoRo
--     booking/rate integration comes with it — a word, not a product.
--
-- The corridor authority owns ROUTE COMPOSITION ONLY. It does not own rates, customs/tax rules,
-- shipment state, reputation, or a "preferred corridor" claim — those belong to T6/T11/T12/T14.
-- New corridors are rows, not schema redesign.
-- =============================================================

-- ── 1. Corridor definitions ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.diaspora_trade_corridors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  display_name text NOT NULL,
  origin_country text NOT NULL,
  destination_country text NOT NULL,
  -- benchmark_candidate: owner-approved starting corridor. research_candidate: a real physical
  -- path whose commercial equivalence is NOT yet evidenced (JP-DAR-ZW). Matching may use either —
  -- a route match asserts geography, never economics — but no UI may rank or prefer by this.
  planning_status text NOT NULL DEFAULT 'benchmark_candidate'
    CHECK (planning_status IN ('benchmark_candidate','research_candidate')),
  active boolean NOT NULL DEFAULT true,
  notes text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NULL REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by text NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

COMMENT ON TABLE public.diaspora_trade_corridors IS
  'T5 route-composition authority: a reusable ordered-leg route pattern from an origin market to '
  'a final destination market. Owns route composition ONLY — never rates, customs/tax, shipment '
  'state, reputation, or preference. No corridor is globally preferred.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_trade_corridors_code_live
  ON public.diaspora_trade_corridors (code)
  WHERE deleted_at IS NULL;

-- ── 2. Corridor legs ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.diaspora_trade_corridor_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corridor_id uuid NOT NULL REFERENCES public.diaspora_trade_corridors(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence >= 1),
  origin_country text NOT NULL,
  origin_locality text NULL,
  destination_country text NOT NULL,
  destination_locality text NULL,
  -- Conceptual mode vocabulary. Deliberately WIDER than what any CarUp product operates today:
  -- a leg saying 'rail' is route knowledge, not a claim that CarUp books rail. The Container
  -- Marketplace books only the capacity it actually governs.
  mode_options text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (mode_options <@ ARRAY['ocean','roro','shared_container','private_container','fcl','lcl','road','rail','air','multimodal','other']::text[]),
  jurisdiction_country text NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  UNIQUE (corridor_id, sequence)
);

COMMENT ON TABLE public.diaspora_trade_corridor_legs IS
  'One ordered segment of a corridor. A sailing covers ONE leg, never the whole journey. A leg '
  'may later reference documents/rates/providers from their own authorities without T5 owning them.';

-- ── 3. Sailing facts the audit justified promoting ──────────────────────

ALTER TABLE public.diaspora_container_shipments
  ADD COLUMN IF NOT EXISTS origin_port text NULL,
  ADD COLUMN IF NOT EXISTS destination_port text NULL,
  ADD COLUMN IF NOT EXISTS corridor_id uuid NULL
    REFERENCES public.diaspora_trade_corridors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS corridor_leg_id uuid NULL
    REFERENCES public.diaspora_trade_corridor_legs(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.diaspora_container_shipments.destination_port IS
  'The port/terminal where THIS SAILING ends (e.g. Beira). Never the customer''s final '
  'destination — a Zimbabwe-bound customer may legitimately book this Mozambique-terminating leg.';
COMMENT ON COLUMN public.diaspora_container_shipments.corridor_leg_id IS
  'The corridor leg this sailing covers, when the operator declares it. NULL means undeclared — '
  'matching then falls back to leg-shape (country pair) compatibility. Booking this sailing books '
  'this LEG only; onward legs are neither fabricated nor implied booked.';

-- ── 4. Mode reconciliation: providers can now SAY roro ──────────────────

ALTER TABLE public.diaspora_logistics_quotes
  DROP CONSTRAINT IF EXISTS diaspora_logistics_quotes_service_mode_check;
ALTER TABLE public.diaspora_logistics_quotes
  ADD CONSTRAINT diaspora_logistics_quotes_service_mode_check
  CHECK (service_mode = ANY (ARRAY['shared_container'::text, 'lcl'::text, 'fcl'::text, 'roro'::text, 'road'::text, 'multimodal'::text, 'other'::text]));

-- ── 5. RLS: corridors are reference data ────────────────────────────────
-- Readable by any authenticated participant (route knowledge is what discovery explains to
-- customers); writable ONLY through service_role (no INSERT/UPDATE/DELETE policies exist, so RLS
-- refuses every non-service write). Anonymous gets nothing.

ALTER TABLE public.diaspora_trade_corridors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_trade_corridor_legs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS diaspora_trade_corridors_read ON public.diaspora_trade_corridors;
CREATE POLICY diaspora_trade_corridors_read ON public.diaspora_trade_corridors
  FOR SELECT TO authenticated USING (deleted_at IS NULL AND active = true);

DROP POLICY IF EXISTS diaspora_trade_corridor_legs_read ON public.diaspora_trade_corridor_legs;
CREATE POLICY diaspora_trade_corridor_legs_read ON public.diaspora_trade_corridor_legs
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM public.diaspora_trade_corridors c
    WHERE c.id = corridor_id AND c.deleted_at IS NULL AND c.active = true));

REVOKE ALL ON public.diaspora_trade_corridors FROM anon;
REVOKE ALL ON public.diaspora_trade_corridor_legs FROM anon;
GRANT SELECT ON public.diaspora_trade_corridors TO authenticated;
GRANT SELECT ON public.diaspora_trade_corridor_legs TO authenticated;

-- ── 6. Benchmark reference rows ─────────────────────────────────────────
-- Idempotent seeds. Localities are route knowledge (which gateway), not port-call schedules.
-- JP-DAR-ZW is seeded as research_candidate: a real physical path whose commercial equivalence is
-- unmeasured. Nothing anywhere marks any corridor preferred.

INSERT INTO public.diaspora_trade_corridors (code, display_name, origin_country, destination_country, planning_status, notes)
SELECT * FROM (VALUES
  ('JP-BEI-ZW', 'Japan → Beira → Zimbabwe', 'Japan', 'Zimbabwe', 'benchmark_candidate',
   'Ocean to Beira, Mozambique; road/transit via Forbes/Machipanda into Zimbabwe.'),
  ('JP-DUR-ZW', 'Japan → Durban → Zimbabwe', 'Japan', 'Zimbabwe', 'benchmark_candidate',
   'Ocean to Durban, South Africa; road/transit via Beitbridge into Zimbabwe.'),
  ('JP-DAR-ZW', 'Japan → Dar es Salaam → Zimbabwe', 'Japan', 'Zimbabwe', 'research_candidate',
   'Ocean to Dar es Salaam, Tanzania; regional transit southbound. Research candidate — do not assume commercial equivalence until measured (T6).')
) AS seed(code, display_name, origin_country, destination_country, planning_status, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.diaspora_trade_corridors c WHERE c.code = seed.code AND c.deleted_at IS NULL
);

INSERT INTO public.diaspora_trade_corridor_legs (corridor_id, sequence, origin_country, origin_locality, destination_country, destination_locality, mode_options, jurisdiction_country)
SELECT c.id, leg.sequence, leg.origin_country, leg.origin_locality, leg.destination_country, leg.destination_locality, leg.mode_options, leg.jurisdiction_country
FROM (VALUES
  ('JP-BEI-ZW', 1, 'Japan', NULL, 'Mozambique', 'Beira', ARRAY['ocean','roro','shared_container','private_container','fcl','lcl']::text[], 'Mozambique'),
  ('JP-BEI-ZW', 2, 'Mozambique', 'Beira', 'Zimbabwe', 'Forbes/Machipanda', ARRAY['road']::text[], 'Mozambique'),
  ('JP-BEI-ZW', 3, 'Zimbabwe', 'Forbes/Machipanda', 'Zimbabwe', 'Harare', ARRAY['road']::text[], 'Zimbabwe'),
  ('JP-DUR-ZW', 1, 'Japan', NULL, 'South Africa', 'Durban', ARRAY['ocean','roro','shared_container','private_container','fcl','lcl']::text[], 'South Africa'),
  ('JP-DUR-ZW', 2, 'South Africa', 'Durban', 'Zimbabwe', 'Beitbridge', ARRAY['road']::text[], 'South Africa'),
  ('JP-DUR-ZW', 3, 'Zimbabwe', 'Beitbridge', 'Zimbabwe', 'Harare', ARRAY['road']::text[], 'Zimbabwe'),
  ('JP-DAR-ZW', 1, 'Japan', NULL, 'Tanzania', 'Dar es Salaam', ARRAY['ocean','roro','shared_container','private_container','fcl','lcl']::text[], 'Tanzania'),
  ('JP-DAR-ZW', 2, 'Tanzania', 'Dar es Salaam', 'Zimbabwe', 'Harare', ARRAY['road','rail','multimodal']::text[], 'Tanzania')
) AS leg(code, sequence, origin_country, origin_locality, destination_country, destination_locality, mode_options, jurisdiction_country)
JOIN public.diaspora_trade_corridors c ON c.code = leg.code AND c.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.diaspora_trade_corridor_legs l
  WHERE l.corridor_id = c.id AND l.sequence = leg.sequence AND l.deleted_at IS NULL
);

-- +migrate Down
-- Remove only what Up added. The service_mode CHECK is restored to its pre-T5 vocabulary.
--
-- DELIBERATE: this Down FAILS if any quote already says 'roro'. A rollback must not silently
-- strand rows that violate the constraint it restores, and it must never delete a provider's
-- commercial offer to make a rollback convenient. If a real rollback is ever required with roro
-- offers present, disposition of those offers is an explicit operator decision, not a side effect.

ALTER TABLE public.diaspora_logistics_quotes
  DROP CONSTRAINT IF EXISTS diaspora_logistics_quotes_service_mode_check;
ALTER TABLE public.diaspora_logistics_quotes
  ADD CONSTRAINT diaspora_logistics_quotes_service_mode_check
  CHECK (service_mode = ANY (ARRAY['shared_container'::text, 'lcl'::text, 'fcl'::text, 'road'::text, 'multimodal'::text, 'other'::text]));

ALTER TABLE public.diaspora_container_shipments
  DROP COLUMN IF EXISTS corridor_leg_id,
  DROP COLUMN IF EXISTS corridor_id,
  DROP COLUMN IF EXISTS destination_port,
  DROP COLUMN IF EXISTS origin_port;

DROP TABLE IF EXISTS public.diaspora_trade_corridor_legs;
DROP TABLE IF EXISTS public.diaspora_trade_corridors;
