-- +migrate Up
-- =====================================================================================
-- VEHICLE FINANCIAL-OBLIGATION / ENCUMBRANCE AUTHORITY
-- Master plan §0.7 "new canonical capability"; DESIGN.md §11.7; M16, M17, M18, R22–R26, R28.
--
-- WHAT THIS IS NOT. It is not `finance_applications` (supabase_schema.sql:148): that row is a
-- BUYER SEEKING FUNDING FOR A PURCHASE — applicant-scoped, refused unless the listing is already
-- published (financeService.js:65-67), and REQUIRED to carry APR and monthly payment on a
-- terminal decision (20260819123000:84-86). This table is the inverse: an obligation already
-- attached to the vehicle being sold, which exists on drafts and on never-listed vehicles, and
-- which stores NO banking terms at all.
--
-- DESIGN NOTES CARRIED FORWARD FROM ADVERSARIAL REVIEW (kept here so the next reader does not
-- reintroduce a bug this migration was written to avoid):
--   * NO `seller_asserted` source. A seller's own finance statement already lives in
--     `vehicles.seller_finance_disclosure` — a separate authority with its own block-level
--     attribution (`authority: 'seller_stated'`, publicVehicleProjection.js). This table's
--     `source_authority` therefore has ONLY GOVERNED members; a second seller-statement store
--     here would let one seller statement contradict another and would put a seller declaration
--     under a `authority:'governed'` envelope.
--   * `document_extracted` is recorded for audit/admin visibility but is NEVER a governed,
--     blocking, or publicly-comparable authority — an unverified upload must not be able to
--     block a legal ownership transfer or publish as "governed" fact.
--   * The governed "cleared" stage is named `settled_pending_release`, not `cleared`, because the
--     SELLER-facing vocabulary (`vehicles.seller_finance_disclosure.state = 'cleared'`, see
--     20260831150000) means "finished" — one token with two contradictory operational meanings
--     rendered on the same page was the exact hazard being fixed.
--   * `disputed` is recorded but does NOT block ownership transfer — freezing a legal transfer
--     indefinitely on a contested record, with no adjudication SLA, is a worse failure than
--     letting a disputed-but-inactive obligation ride through pending review.
--   * `settlement_context` is a CLOSED SHAPE (an explicit key allow-list via `jsonb - keys = '{}'`),
--     not an open JSONB with a "banned keys" list — `jsonb ?| array` only inspects top-level keys,
--     so a ban list can be defeated by one level of nesting. A closed shape cannot be.
--   * This migration does NOT re-emit `passport_transition_ownership_transfer_atomic`. That
--     function's `RETURNS public.vehicle_ownership_transfers` is resolved at CREATE FUNCTION
--     parse time; staging does not have that table today (verified: `to_regtype(...)` is NULL),
--     so re-emitting it here would abort this entire migration file, including the parts that
--     do not depend on it. R24 is enforced ONLY by the trigger in section 5 below, which fires on
--     `vehicles.owner_id` directly and therefore does not depend on which ownership-transfer RPC
--     is installed or whether it exists at all. A friendlier in-RPC error message is a follow-up
--     for once 20260828203000's apply order to staging/production is settled — not a reason to
--     risk this migration failing to apply.
--
-- Depends on: vehicles, users, lender_profiles, provider_registry, vehicle_evidence,
-- disclosure_claims (all verified present in staging). Additive; Down is reversible.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1) vehicle_finance_obligations — the current-state row. ORIGINATION TRUTH IS IMMUTABLE.
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vehicle_finance_obligations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin                         TEXT NOT NULL REFERENCES public.vehicles(vin) ON DELETE RESTRICT,

  -- WHO SAYS SO. Only GOVERNED authorities — no 'seller_asserted' member. The seller's own
  -- statement lives in vehicles.seller_finance_disclosure and never enters this table.
  source_authority            TEXT NOT NULL CHECK (source_authority IN (
                                'lender_attested','provider_attested','admin_recorded',
                                'document_extracted')),
  lender_profile_id           UUID REFERENCES public.lender_profiles(id) ON DELETE RESTRICT,
  provider_id                 UUID REFERENCES public.provider_registry(id) ON DELETE RESTRICT,
  evidence_id                 UUID REFERENCES public.vehicle_evidence(id) ON DELETE RESTRICT,
  recorded_by                 TEXT REFERENCES public.users(id) ON DELETE RESTRICT,
  attestation_reference       TEXT,   -- lender's own reference. PRIVATE. Never projected.

  obligation_kind             TEXT NOT NULL CHECK (obligation_kind IN (
                                'bank_loan','vehicle_finance','lease','hire_purchase',
                                'secured_lien','other')),

  -- Coarse settlement stage ONLY. No amounts, no schedule, no arrears figure.
  state                       TEXT NOT NULL DEFAULT 'active' CHECK (state IN (
                                'active','arrears','settlement_pending',
                                'settled_pending_release','released','disputed')),

  -- Lender identity is publishable ONLY where policy permits. Fail-closed default.
  lender_display_name         TEXT,
  lender_disclosure_permitted BOOLEAN NOT NULL DEFAULT false,

  -- R26. Valuation AT ORIGINATION, from a governed source, frozen for life by the guard below.
  origination_date               DATE,
  origination_valuation_amount   NUMERIC(14,2),
  origination_valuation_currency TEXT,
  origination_valuation_date     DATE,
  origination_valuation_source   TEXT CHECK (origination_valuation_source IS NULL
                                   OR origination_valuation_source IN (
                                     'lender_valuation','independent_valuer','insurer_valuation',
                                     'auction_result','customs_declared_value')),

  settlement_required         BOOLEAN NOT NULL DEFAULT true,
  cleared_at                  TIMESTAMPTZ,   -- reached 'settled_pending_release'
  released_at                 TIMESTAMPTZ,
  release_reference           TEXT,
  disputed_reason             TEXT,
  recorded_reason              TEXT,   -- free-text note for an admin_recorded row; NOT dispute-only

  supersedes_obligation_id    UUID REFERENCES public.vehicle_finance_obligations(id) ON DELETE RESTRICT,

  -- Non-public settlement handoff context (R28). A CLOSED SHAPE: only these three top-level keys
  -- may appear at all, and `notes_internal_ref` (the one string field) may not itself be an
  -- object — closing the door a `?| ARRAY[...]` ban list leaves open one level of nesting down.
  settlement_context          JSONB NOT NULL DEFAULT '{}'::jsonb,

  tenant_id                   UUID,
  version                     INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  recorded_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT vfo_source_ref_chk CHECK (
       (source_authority = 'lender_attested'
          AND lender_profile_id IS NOT NULL
          AND nullif(btrim(attestation_reference),'') IS NOT NULL)
    OR (source_authority = 'provider_attested'
          AND provider_id IS NOT NULL
          AND nullif(btrim(attestation_reference),'') IS NOT NULL)
    OR (source_authority = 'document_extracted' AND evidence_id IS NOT NULL)
    OR (source_authority = 'admin_recorded'
          AND recorded_by IS NOT NULL
          AND nullif(btrim(recorded_reason),'') IS NOT NULL)
  ),

  -- R26: all-or-nothing, and no valuation may be recorded without a governed valuation source.
  CONSTRAINT vfo_valuation_group_chk CHECK (
       (origination_valuation_amount IS NULL AND origination_valuation_currency IS NULL
        AND origination_valuation_date IS NULL AND origination_valuation_source IS NULL)
    OR (origination_valuation_amount > 0
        AND origination_valuation_currency ~ '^[A-Z]{3}$'
        AND origination_valuation_date IS NOT NULL
        AND origination_valuation_source IS NOT NULL)
  ),

  CONSTRAINT vfo_lender_disclosure_chk CHECK (
    lender_disclosure_permitted = false
    OR nullif(btrim(lender_display_name),'') IS NOT NULL
  ),

  CONSTRAINT vfo_settled_stamp_chk   CHECK (state <> 'settled_pending_release' OR cleared_at IS NOT NULL),
  CONSTRAINT vfo_released_stamp_chk  CHECK (state <> 'released' OR (released_at IS NOT NULL AND cleared_at IS NOT NULL)),
  CONSTRAINT vfo_disputed_reason_chk CHECK (state <> 'disputed' OR nullif(btrim(disputed_reason),'') IS NOT NULL),
  CONSTRAINT vfo_no_self_supersede_chk CHECK (supersedes_obligation_id IS DISTINCT FROM id),

  -- CLOSED SHAPE for settlement_context. `- ARRAY[...]` removes matching top-level keys; if
  -- anything remains, an unlisted key was supplied and the row is refused outright.
  CONSTRAINT vfo_settlement_context_shape_chk CHECK (
    settlement_context - ARRAY['settlement_deadline_date','payee_reference_type','notes_internal_ref']
      = '{}'::jsonb
  ),
  CONSTRAINT vfo_settlement_context_notes_scalar_chk CHECK (
    NOT (settlement_context ? 'notes_internal_ref')
    OR jsonb_typeof(settlement_context -> 'notes_internal_ref') = 'string'
  )
);

CREATE INDEX IF NOT EXISTS idx_vfo_vin ON public.vehicle_finance_obligations(vin, recorded_at DESC);

-- THE R24 GUARD'S INDEX. Governed + blocking + NOT superseded. 'disputed' and 'document_extracted'
-- are deliberately excluded — see the design notes above.
CREATE INDEX IF NOT EXISTS idx_vfo_governed_blocking
  ON public.vehicle_finance_obligations(vin)
  WHERE source_authority IN ('lender_attested','provider_attested','admin_recorded')
    AND state IN ('active','arrears','settlement_pending','settled_pending_release');

CREATE UNIQUE INDEX IF NOT EXISTS uq_vfo_supersedes
  ON public.vehicle_finance_obligations(supersedes_obligation_id)
  WHERE supersedes_obligation_id IS NOT NULL;

-- -------------------------------------------------------------------------------------
-- 2) vehicle_finance_obligation_events — append-only lifecycle ledger (R25).
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vehicle_finance_obligation_events (
  id               BIGSERIAL PRIMARY KEY,
  obligation_id    UUID NOT NULL REFERENCES public.vehicle_finance_obligations(id) ON DELETE RESTRICT,
  vin              TEXT NOT NULL,
  from_state       TEXT,
  to_state         TEXT NOT NULL CHECK (to_state IN (
                     'active','arrears','settlement_pending','settled_pending_release',
                     'released','disputed')),
  source_authority TEXT NOT NULL,
  actor_id         TEXT REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_role       TEXT,
  reason           TEXT,
  effective_date   DATE,
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb
                     CHECK (payload - ARRAY['obligation_kind','valuation_recorded','release_reference_present']
                            = '{}'::jsonb),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vfo_events_obligation
  ON public.vehicle_finance_obligation_events(obligation_id, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_vfo_events_vin
  ON public.vehicle_finance_obligation_events(vin, created_at DESC);

DROP TRIGGER IF EXISTS vfo_events_no_update ON public.vehicle_finance_obligation_events;
CREATE TRIGGER vfo_events_no_update BEFORE UPDATE ON public.vehicle_finance_obligation_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS vfo_events_no_delete ON public.vehicle_finance_obligation_events;
CREATE TRIGGER vfo_events_no_delete BEFORE DELETE ON public.vehicle_finance_obligation_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

-- -------------------------------------------------------------------------------------
-- 3) Shared authorization check for reaching a TERMINAL state (settled_pending_release /
--    released), used identically at genesis and at transition so genesis cannot bypass the rule
--    the transition path enforces. A terminal state is a claim about what a governed actor has
--    confirmed, not about how the obligation originated — so it is gated on WHO is recording it
--    (actor_role), never on the row's own source_authority.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finance_obligation_terminal_state_permitted(
  p_actor_role TEXT, p_to_state TEXT
) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
AS $perm$
  SELECT p_to_state NOT IN ('settled_pending_release','released')
      OR lower(coalesce(p_actor_role,'')) IN ('admin','lender','insurance','government','platform_admin','super_admin');
$perm$;

-- -------------------------------------------------------------------------------------
-- 4) Immutability guard on the current-state row (R25/R26).
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.carup_finance_obligation_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $guard$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'vehicle_finance_obligations is durable history; release or supersede the obligation instead of DELETE'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.vin                            IS DISTINCT FROM OLD.vin
     OR NEW.source_authority            IS DISTINCT FROM OLD.source_authority
     OR NEW.lender_profile_id           IS DISTINCT FROM OLD.lender_profile_id
     OR NEW.provider_id                 IS DISTINCT FROM OLD.provider_id
     OR NEW.evidence_id                 IS DISTINCT FROM OLD.evidence_id
     OR NEW.obligation_kind             IS DISTINCT FROM OLD.obligation_kind
     OR NEW.origination_date            IS DISTINCT FROM OLD.origination_date
     OR NEW.origination_valuation_amount   IS DISTINCT FROM OLD.origination_valuation_amount
     OR NEW.origination_valuation_currency IS DISTINCT FROM OLD.origination_valuation_currency
     OR NEW.origination_valuation_date     IS DISTINCT FROM OLD.origination_valuation_date
     OR NEW.origination_valuation_source   IS DISTINCT FROM OLD.origination_valuation_source
     OR NEW.supersedes_obligation_id    IS DISTINCT FROM OLD.supersedes_obligation_id
     OR NEW.recorded_at                 IS DISTINCT FROM OLD.recorded_at THEN
    RAISE EXCEPTION 'finance obligation origination truth is immutable (including valuation-at-origination); record a superseding obligation instead'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.cleared_at IS NOT NULL AND NEW.cleared_at IS DISTINCT FROM OLD.cleared_at THEN
    RAISE EXCEPTION 'a recorded settlement date is durable and cannot be moved or cleared' USING ERRCODE = '23514';
  END IF;
  IF OLD.released_at IS NOT NULL AND NEW.released_at IS DISTINCT FROM OLD.released_at THEN
    RAISE EXCEPTION 'a recorded lender release date is durable and cannot be moved or cleared' USING ERRCODE = '23514';
  END IF;

  NEW.version    := OLD.version + 1;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$guard$;

DROP TRIGGER IF EXISTS trg_vfo_guard_update ON public.vehicle_finance_obligations;
CREATE TRIGGER trg_vfo_guard_update BEFORE UPDATE ON public.vehicle_finance_obligations
  FOR EACH ROW EXECUTE FUNCTION public.carup_finance_obligation_guard();
DROP TRIGGER IF EXISTS trg_vfo_no_delete ON public.vehicle_finance_obligations;
CREATE TRIGGER trg_vfo_no_delete BEFORE DELETE ON public.vehicle_finance_obligations
  FOR EACH ROW EXECUTE FUNCTION public.carup_finance_obligation_guard();

-- -------------------------------------------------------------------------------------
-- 5) Atomic writers. Genesis is restricted to the actor's actual authorization for a terminal
--    state via finance_obligation_terminal_state_permitted — the same rule the transition path
--    enforces, so recording a row directly at 'released' can no longer bypass it.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finance_obligation_record_atomic(
  p_vin TEXT,
  p_source_authority TEXT,
  p_obligation_kind TEXT,
  p_state TEXT,
  p_actor_id TEXT,
  p_actor_role TEXT,
  p_fields JSONB DEFAULT '{}'::jsonb
)
RETURNS public.vehicle_finance_obligations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $rec$
DECLARE
  v_row public.vehicle_finance_obligations%ROWTYPE;
  v_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.vehicles WHERE vin = p_vin FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'vehicle not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT public.finance_obligation_terminal_state_permitted(p_actor_role, p_state) THEN
    RAISE EXCEPTION 'recording a finance obligation directly at % requires a governance/lender actor role', p_state
      USING ERRCODE = '42501';
  END IF;
  IF p_state = 'released' AND nullif(btrim(p_fields->>'release_reference'),'') IS NULL THEN
    RAISE EXCEPTION 'recording a finance obligation as released requires a release reference' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.vehicle_finance_obligations(
    vin, source_authority, obligation_kind, state, recorded_by, tenant_id,
    lender_profile_id, provider_id, evidence_id, attestation_reference,
    lender_display_name, lender_disclosure_permitted,
    origination_date, origination_valuation_amount, origination_valuation_currency,
    origination_valuation_date, origination_valuation_source,
    settlement_required, cleared_at, released_at, release_reference,
    disputed_reason, recorded_reason, supersedes_obligation_id, settlement_context
  ) VALUES (
    p_vin, p_source_authority, p_obligation_kind, p_state, p_actor_id, v_tenant,
    nullif(p_fields->>'lender_profile_id','')::UUID,
    nullif(p_fields->>'provider_id','')::UUID,
    nullif(p_fields->>'evidence_id','')::UUID,
    nullif(btrim(p_fields->>'attestation_reference'),''),
    nullif(btrim(p_fields->>'lender_display_name'),''),
    coalesce((p_fields->>'lender_disclosure_permitted')::BOOLEAN, false),
    nullif(p_fields->>'origination_date','')::DATE,
    nullif(p_fields->>'origination_valuation_amount','')::NUMERIC,
    nullif(btrim(upper(p_fields->>'origination_valuation_currency')),''),
    nullif(p_fields->>'origination_valuation_date','')::DATE,
    nullif(btrim(p_fields->>'origination_valuation_source'),''),
    coalesce((p_fields->>'settlement_required')::BOOLEAN, true),
    CASE WHEN p_state IN ('settled_pending_release','released') THEN coalesce(nullif(p_fields->>'cleared_at','')::TIMESTAMPTZ, NOW()) ELSE NULL END,
    CASE WHEN p_state = 'released' THEN coalesce(nullif(p_fields->>'released_at','')::TIMESTAMPTZ, NOW()) ELSE NULL END,
    nullif(btrim(p_fields->>'release_reference'),''),
    nullif(btrim(p_fields->>'disputed_reason'),''),
    nullif(btrim(p_fields->>'recorded_reason'),''),
    nullif(p_fields->>'supersedes_obligation_id','')::UUID,
    coalesce(p_fields->'settlement_context', '{}'::jsonb)
  ) RETURNING * INTO v_row;

  INSERT INTO public.vehicle_finance_obligation_events(
    obligation_id, vin, from_state, to_state, source_authority,
    actor_id, actor_role, reason, effective_date, payload
  ) VALUES (
    v_row.id, p_vin, NULL, v_row.state, v_row.source_authority,
    p_actor_id, p_actor_role, 'obligation_recorded', v_row.origination_date,
    jsonb_build_object('obligation_kind', v_row.obligation_kind,
                       'valuation_recorded', v_row.origination_valuation_amount IS NOT NULL)
  );

  RETURN v_row;
END;
$rec$;

CREATE OR REPLACE FUNCTION public.finance_obligation_transition_atomic(
  p_obligation_id UUID,
  p_to_state TEXT,
  p_actor_id TEXT,
  p_actor_role TEXT,
  p_reason TEXT DEFAULT NULL,
  p_effective_date DATE DEFAULT NULL,
  p_release_reference TEXT DEFAULT NULL
)
RETURNS public.vehicle_finance_obligations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $trans$
DECLARE
  v_row public.vehicle_finance_obligations%ROWTYPE;
  v_from TEXT;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_allowed BOOLEAN;
BEGIN
  SELECT * INTO v_row FROM public.vehicle_finance_obligations WHERE id = p_obligation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'finance obligation not found' USING ERRCODE = 'P0002'; END IF;
  v_from := v_row.state;

  -- 'released' is reachable ONLY from 'settled_pending_release': money settled and lender release
  -- confirmed are two different facts, and CarUp must not collapse them.
  v_allowed := CASE v_from
    WHEN 'active'                    THEN p_to_state IN ('arrears','settlement_pending','settled_pending_release','disputed')
    WHEN 'arrears'                   THEN p_to_state IN ('active','settlement_pending','settled_pending_release','disputed')
    WHEN 'settlement_pending'        THEN p_to_state IN ('active','arrears','settled_pending_release','disputed')
    WHEN 'settled_pending_release'   THEN p_to_state IN ('released','disputed')
    WHEN 'released'                  THEN p_to_state = 'disputed'
    WHEN 'disputed'                  THEN p_to_state IN ('active','arrears','settlement_pending','settled_pending_release','released')
    ELSE FALSE
  END;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'illegal finance obligation transition: % -> %', v_from, p_to_state USING ERRCODE = '23514';
  END IF;
  IF p_to_state = 'disputed' AND nullif(btrim(p_reason),'') IS NULL THEN
    RAISE EXCEPTION 'a disputed finance obligation requires a reason' USING ERRCODE = '22023';
  END IF;
  IF NOT public.finance_obligation_terminal_state_permitted(p_actor_role, p_to_state) THEN
    RAISE EXCEPTION 'transitioning a finance obligation to % requires a governance/lender actor role', p_to_state
      USING ERRCODE = '42501';
  END IF;
  IF p_to_state = 'released' AND nullif(btrim(p_release_reference),'') IS NULL THEN
    RAISE EXCEPTION 'lender release requires a release reference' USING ERRCODE = '22023';
  END IF;

  UPDATE public.vehicle_finance_obligations
     SET state = p_to_state,
         cleared_at  = CASE WHEN p_to_state IN ('settled_pending_release','released') THEN coalesce(cleared_at, v_now) ELSE cleared_at END,
         released_at = CASE WHEN p_to_state = 'released' THEN coalesce(released_at, v_now) ELSE released_at END,
         release_reference = CASE WHEN p_to_state = 'released' THEN btrim(p_release_reference) ELSE release_reference END,
         disputed_reason   = CASE WHEN p_to_state = 'disputed' THEN btrim(p_reason) ELSE disputed_reason END
   WHERE id = v_row.id
   RETURNING * INTO v_row;

  INSERT INTO public.vehicle_finance_obligation_events(
    obligation_id, vin, from_state, to_state, source_authority,
    actor_id, actor_role, reason, effective_date, payload
  ) VALUES (
    v_row.id, v_row.vin, v_from, p_to_state, v_row.source_authority,
    p_actor_id, p_actor_role, p_reason, p_effective_date,
    jsonb_build_object('release_reference_present', p_release_reference IS NOT NULL)
  );

  RETURN v_row;
END;
$trans$;

-- -------------------------------------------------------------------------------------
-- 6) R24 — THE OWNERSHIP-TRANSFER BLOCK, as a trigger on `vehicles.owner_id` directly. This does
--    NOT depend on which ownership-transfer RPC is installed (see design notes at top of file).
--    SECURITY DEFINER: the base table is REVOKEd from non-service_role below, so a caller other
--    than service_role must still be able to have this trigger evaluate, not merely fail closed
--    with "permission denied for table vehicle_finance_obligations".
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.carup_block_encumbered_owner_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $blk$
DECLARE
  v_blocking INTEGER;
BEGIN
  IF NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_blocking
    FROM public.vehicle_finance_obligations o
   WHERE o.vin = NEW.vin
     AND o.source_authority IN ('lender_attested','provider_attested','admin_recorded')
     AND o.state IN ('active','arrears','settlement_pending','settled_pending_release')
     AND NOT EXISTS (
       SELECT 1 FROM public.vehicle_finance_obligations s WHERE s.supersedes_obligation_id = o.id
     );
  IF v_blocking > 0 THEN
    RAISE EXCEPTION 'ownership cannot transfer while a governed finance obligation remains unreleased on this vehicle'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$blk$;

DROP TRIGGER IF EXISTS trg_block_encumbered_owner_change ON public.vehicles;
CREATE TRIGGER trg_block_encumbered_owner_change
  BEFORE UPDATE OF owner_id ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.carup_block_encumbered_owner_change();

-- -------------------------------------------------------------------------------------
-- 7) M16 — additive reconciliation vocabulary on the EXISTING disclosure engine. No new claim
--    table, no new conflict table: the finance comparison is routed through the SAME
--    classifyConflict()/persistClaims()/persistConflict() authority as every other disclosure
--    claim (backend/services/intelligence/disclosureConflict.js), never a bespoke second writer.
-- -------------------------------------------------------------------------------------
ALTER TABLE public.disclosure_claims DROP CONSTRAINT IF EXISTS disclosure_claims_claim_type_check;
ALTER TABLE public.disclosure_claims ADD CONSTRAINT disclosure_claims_claim_type_check CHECK (
  claim_type IN ('no_accident_history','original_paint','no_major_repairs','genuine_mileage',
                 'single_owner','recently_inspected','never_imported','component_present',
                 'defect_disclosed','no_finance_outstanding','other')
);

-- -------------------------------------------------------------------------------------
-- 8) RLS. CarUp uses CUSTOM backend auth (auth.uid() is empty), so service_role plus
--    service-layer authorization is the only real gate — the same call made for
--    vehicle_ownership_transfers (20260828203000:55-61). No public/anon read of the base tables
--    at any time; buyers reach only the allow-listed projection.
-- -------------------------------------------------------------------------------------
ALTER TABLE public.vehicle_finance_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_finance_obligation_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vehicle_finance_obligations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.vehicle_finance_obligation_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.vehicle_finance_obligations TO service_role;
GRANT SELECT, INSERT ON TABLE public.vehicle_finance_obligation_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.vehicle_finance_obligation_events_id_seq TO service_role;

REVOKE ALL ON FUNCTION public.carup_finance_obligation_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.carup_block_encumbered_owner_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_obligation_terminal_state_permitted(TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_obligation_terminal_state_permitted(TEXT,TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.finance_obligation_record_atomic(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_obligation_record_atomic(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB)
  TO service_role;
REVOKE ALL ON FUNCTION public.finance_obligation_transition_atomic(UUID,TEXT,TEXT,TEXT,TEXT,DATE,TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_obligation_transition_atomic(UUID,TEXT,TEXT,TEXT,TEXT,DATE,TEXT)
  TO service_role;

COMMENT ON TABLE public.vehicle_finance_obligations IS
  'Finance/lease/hire-purchase/lien interest ALREADY ATTACHED TO A VEHICLE, GOVERNED sources only. Distinct from finance_applications (a buyer seeking funding to purchase) and from vehicles.seller_finance_disclosure (the seller''s own statement, a separate authority). Stores no banking terms: balances, payments, rates, identifiers and credit data are absent by construction.';

-- +migrate Down
DROP TRIGGER IF EXISTS trg_block_encumbered_owner_change ON public.vehicles;
DROP FUNCTION IF EXISTS public.carup_block_encumbered_owner_change();
DROP FUNCTION IF EXISTS public.finance_obligation_transition_atomic(UUID,TEXT,TEXT,TEXT,TEXT,DATE,TEXT);
DROP FUNCTION IF EXISTS public.finance_obligation_record_atomic(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB);
DROP FUNCTION IF EXISTS public.finance_obligation_terminal_state_permitted(TEXT,TEXT);
DROP TRIGGER IF EXISTS vfo_events_no_update ON public.vehicle_finance_obligation_events;
DROP TRIGGER IF EXISTS vfo_events_no_delete ON public.vehicle_finance_obligation_events;
DROP TRIGGER IF EXISTS trg_vfo_guard_update ON public.vehicle_finance_obligations;
DROP TRIGGER IF EXISTS trg_vfo_no_delete ON public.vehicle_finance_obligations;
DROP FUNCTION IF EXISTS public.carup_finance_obligation_guard();
DROP TABLE IF EXISTS public.vehicle_finance_obligation_events;
DROP TABLE IF EXISTS public.vehicle_finance_obligations;
ALTER TABLE public.disclosure_claims DROP CONSTRAINT IF EXISTS disclosure_claims_claim_type_check;
ALTER TABLE public.disclosure_claims ADD CONSTRAINT disclosure_claims_claim_type_check CHECK (
  claim_type IN ('no_accident_history','original_paint','no_major_repairs','genuine_mileage',
                 'single_owner','recently_inspected','never_imported','component_present',
                 'defect_disclosed','other')
);
