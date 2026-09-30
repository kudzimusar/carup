-- +migrate Up
-- =============================================================
-- Trade OS T12 — attributed customs coordination and Zimbabwe destination operations.
--
-- The T12.0 audit found the provider MINTING the authority it relies on: approving an OCR document
-- inserted a row into `zimra_declarations` with a random reference, a defaulted duty, a hardcoded
-- exchange rate and an "officer signature" that was a SHA-256 of CarUp's own document id.
--
-- So the first rule of this schema is what it does NOT contain:
--
--   · no duty rate, VAT rate, surtax, valuation formula, age threshold or exchange rate;
--   · no CarUp-computed amount of any kind;
--   · no write to `zimra_declarations`, `cvr_ownership_records`, `cid_clearance_records`,
--     `vid_inspections` or `zinara_licensing_records`. Those model acts by external authorities and
--     are NOT CarUp workflow stores.
--
-- >  CarUp coordinates customs. CarUp is not ZIMRA, and CarUp is not a licensed clearing agent.
--
-- Three tables, which is the smallest thing that can carry the model. The audit reconfirmed nothing
-- already owns it: `diaspora_safetrade_delivery_confirmations` is escrow-release machinery keyed on
-- a SafeTrade transaction and gated by a dispute window, so it cannot record a physical handoff for
-- cargo that has no escrow — and a delivery observation here NEVER releases money.
--
-- The generic `subject_type`/`subject_id` binding is the same idiom T6 charges, T7 threads, T8
-- documents, T9 intakes and T10 load items already use.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.diaspora_customs_cases (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid,
  -- What this case is about, in the programme's existing binding idiom.
  subject_type          text NOT NULL CHECK (subject_type IN ('cargo_reservation','import_order','shipment')),
  subject_id            uuid NOT NULL,
  -- The movement context, when there is one. NULLABLE on purpose: a case may be opened for cargo
  -- whose shipment record does not exist yet, and T12 must never require T11 to have been used.
  shipment_id           uuid REFERENCES public.diaspora_shipments(id) ON DELETE SET NULL,
  import_order_id       uuid REFERENCES public.diaspora_import_orders(id) ON DELETE SET NULL,
  reference             text NOT NULL UNIQUE,

  -- §M — T12 must remain usable for GENERAL CARGO. A vehicle-only flow would make a phase that
  -- exists to move boxes unusable for boxes.
  cargo_kind            text NOT NULL DEFAULT 'GENERAL' CHECK (cargo_kind IN ('GENERAL','VEHICLE')),

  -- §L — a gateway is not a destination. Beira arrival is not Zimbabwe arrival, Zimbabwe arrival is
  -- not customs release, and none of them is delivery. Kept as separate columns so no code can
  -- collapse them by accident.
  gateway_port          text,
  gateway_country       text,
  destination_country   text,
  destination_city      text,
  final_destination     text,

  status                text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','ABANDONED')),
  closed_at             timestamptz,
  closed_reason         text,

  notes                 text,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by            text,
  updated_by            text,
  created_at            timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at            timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at            timestamptz
);

CREATE INDEX IF NOT EXISTS idx_customs_cases_subject ON public.diaspora_customs_cases (subject_type, subject_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customs_cases_shipment ON public.diaspora_customs_cases (shipment_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customs_cases_tenant ON public.diaspora_customs_cases (tenant_id) WHERE deleted_at IS NULL;
-- One live case per subject. Two cases for one consignment is two answers to "where is my cargo".
CREATE UNIQUE INDEX IF NOT EXISTS uq_customs_case_live_subject
  ON public.diaspora_customs_cases (subject_type, subject_id)
  WHERE deleted_at IS NULL AND status <> 'ABANDONED';

-- =============================================================
-- The appointment of a LICENSED CLEARING AGENT.
--
-- ZIMRA licenses clearing agents; the licence expires on 31 December of the year of issue, and
-- lodging employees require formal training (source register §7). CarUp cannot verify any of that.
--
-- So this table records an APPOINTMENT — who a participant says they appointed — and NOT a licence.
-- `licence_reference_claimed` is named `_claimed` deliberately: it is a string somebody typed, and
-- every surface must present it as such. A column called `licence_number` would, within one release,
-- be rendered somewhere as though CarUp had checked it.
-- =============================================================
CREATE TABLE IF NOT EXISTS public.diaspora_customs_agent_appointments (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid,
  case_id                   uuid NOT NULL REFERENCES public.diaspora_customs_cases(id) ON DELETE CASCADE,

  agent_kind                text NOT NULL CHECK (agent_kind IN ('ORGANISATION','PERSON')),
  -- TEXT, not uuid. `users.id` and `organizations.id` are both TEXT in this schema, and declaring
  -- these as uuid made the whole appointment path unusable against real identities. Nothing caught
  -- it until a governed staging fixture was created: the in-memory test client has no column types,
  -- so `'user-agent'` inserted happily into a column Postgres would have rejected.
  agent_organisation_id     text,
  agent_user_id             text,
  agent_display_name        text NOT NULL,
  licence_reference_claimed text,

  -- Scoped, never a new global platform role: an appointment is authority over ONE case.
  scope                     text NOT NULL DEFAULT 'CUSTOMS_CLEARANCE'
    CHECK (scope IN ('CUSTOMS_CLEARANCE','CUSTOMS_CLEARANCE_AND_DELIVERY','DELIVERY_ONLY')),

  appointed_by              text NOT NULL,
  appointed_by_role         text,
  appointed_at              timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  status                    text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED','ENDED')),
  ended_at                  timestamptz,
  ended_reason              text,

  evidence_document_id      uuid,
  notes                     text,
  metadata                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by                text,
  updated_by                text,
  created_at                timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at                timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at                timestamptz,

  CONSTRAINT customs_appointment_names_someone CHECK (agent_organisation_id IS NOT NULL OR agent_user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_customs_appointments_case ON public.diaspora_customs_agent_appointments (case_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customs_appointments_agent_user ON public.diaspora_customs_agent_appointments (agent_user_id) WHERE deleted_at IS NULL;
-- One ACTIVE appointment per case. Two live agents is two people believing they are clearing it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customs_case_one_active_agent
  ON public.diaspora_customs_agent_appointments (case_id)
  WHERE deleted_at IS NULL AND status = 'ACTIVE';

-- =============================================================
-- The attributed event stream.
--
-- §F — every step stays separate. There is NO `cleared` boolean, because the moment one exists,
-- five different facts start being written to it:
--
--   DOCUMENT PRESENT  !=  LODGEMENT REPORTED  !=  ASSESSMENT EVIDENCE RECEIVED
--     !=  PAYMENT EVIDENCE RECEIVED  !=  RELEASE EVIDENCE RECEIVED
--     !=  PORT RELEASE  !=  COLLECTION  !=  DELIVERY  !=  VEHICLE REGISTRATION.
--
-- `assertion_class` is the load-bearing column. CarUp may ORIGINATE a physical observation an
-- authorized person actually made. Everything a customs authority does reaches CarUp only as
-- somebody's ATTRIBUTED claim, and must carry who said it, their relationship, when, and on the
-- strength of what evidence.
--
-- VEHICLE_REGISTRATION is deliberately ABSENT from the vocabulary. Registration is the CVR's act,
-- not a customs event, and giving it a type here is how a phase starts writing another authority's
-- records.
-- =============================================================
CREATE TABLE IF NOT EXISTS public.diaspora_customs_events (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid,
  case_id                   uuid NOT NULL REFERENCES public.diaspora_customs_cases(id) ON DELETE CASCADE,

  event_type                text NOT NULL CHECK (event_type IN (
    'DOCUMENT_REQUESTED',
    'DOCUMENT_PROVIDED',
    'LODGEMENT_REPORTED',
    'QUERY_RAISED',
    'INSPECTION_EVIDENCE_RECEIVED',
    'ASSESSMENT_EVIDENCE_RECEIVED',
    'PAYMENT_EVIDENCE_RECEIVED',
    'RELEASE_EVIDENCE_RECEIVED',
    'GATEWAY_ARRIVAL_OBSERVED',
    'TRANSIT_TO_DESTINATION_STARTED',
    'DESTINATION_ARRIVAL_OBSERVED',
    'PORT_RELEASE_OBSERVED',
    'COLLECTION_OBSERVED',
    'DELIVERY_OBSERVED'
  )),

  assertion_class           text NOT NULL CHECK (assertion_class IN ('CARUP_OBSERVED','ATTRIBUTED')),

  -- Who says so, and what they are to this case. Never the client's word for it: the service derives
  -- the relationship from the appointment and the transaction.
  asserted_by_user_id       text,
  asserted_by_role          text,
  asserted_by_relationship  text NOT NULL CHECK (asserted_by_relationship IN (
    'APPOINTED_CLEARING_AGENT','IMPORTER','CONTAINER_OPERATOR','CARUP_STAFF','PLATFORM_REVIEWER'
  )),
  appointment_id            uuid REFERENCES public.diaspora_customs_agent_appointments(id) ON DELETE SET NULL,

  -- How strong the claim is entitled to be. An agent typing a number is not an authority document,
  -- and §G requires the two to READ differently.
  source_kind               text NOT NULL CHECK (source_kind IN (
    'CARUP_OBSERVATION','AGENT_REPORT','AUTHORITY_DOCUMENT','IMPORTER_DOCUMENT','THIRD_PARTY_DOCUMENT'
  )),
  source_description        text,
  evidence_document_id      uuid,

  -- Amounts. Present ONLY on assessment and payment events, and only ever transcribed from a source.
  -- There is no calculator anywhere in this phase: an amount with no source is not a smaller amount,
  -- it is not an amount at all.
  amount_value              numeric(18,2),
  amount_currency           text,

  -- §H — the customs exchange rate, when an assessment carries one. Recorded with its own source and
  -- effective date because ZIMRA publishes these WEEKLY, for a stated period (source register §4).
  -- It is never inferred from T6 reference FX, market FX, today's rate or a previous declaration.
  customs_rate_value        numeric(18,6),
  customs_rate_basis        text,
  customs_rate_source       text,
  customs_rate_effective_from date,
  customs_rate_effective_to   date,

  -- When it actually happened, as distinct from when it was written down.
  event_time                timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  location                  text,
  notes                     text,
  metadata                  jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_by                text,
  updated_by                text,
  created_at                timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at                timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at                timestamptz,

  -- A CarUp observation must be a CarUp observation. Anything an outside authority did reaches us as
  -- somebody's report, and the two classes may not borrow each other's source kind.
  CONSTRAINT customs_event_observation_is_carups CHECK (
    (assertion_class = 'CARUP_OBSERVED' AND source_kind = 'CARUP_OBSERVATION')
    OR (assertion_class = 'ATTRIBUTED' AND source_kind <> 'CARUP_OBSERVATION')
  ),
  -- An amount may only appear where an amount can mean something, and never without its currency.
  CONSTRAINT customs_event_amount_placement CHECK (
    amount_value IS NULL
    OR (event_type IN ('ASSESSMENT_EVIDENCE_RECEIVED','PAYMENT_EVIDENCE_RECEIVED') AND amount_currency IS NOT NULL)
  ),
  -- A rate with no source or no effective date is the `13.5` this phase exists to have removed.
  CONSTRAINT customs_event_rate_has_provenance CHECK (
    customs_rate_value IS NULL
    OR (customs_rate_source IS NOT NULL AND customs_rate_effective_from IS NOT NULL)
  ),
  -- A claim on an AUTHORITY document has to have the document. Otherwise it is an agent report
  -- wearing the authority's name, which is the exact shape of the forgery T12.1 removed.
  CONSTRAINT customs_event_authority_claim_needs_evidence CHECK (
    source_kind <> 'AUTHORITY_DOCUMENT' OR evidence_document_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_customs_events_case ON public.diaspora_customs_events (case_id, event_time) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customs_events_type ON public.diaspora_customs_events (case_id, event_type) WHERE deleted_at IS NULL;

-- =============================================================
-- Append-only, structurally — the same guard T11's timeline uses.
--
-- An attributed claim whose attribution can be edited afterwards is worse than no attribution: it
-- reads as provenance while being editable by whoever is embarrassed by it.
-- =============================================================
CREATE OR REPLACE FUNCTION public.carup_customs_event_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.case_id                  IS DISTINCT FROM OLD.case_id
     OR NEW.event_type            IS DISTINCT FROM OLD.event_type
     OR NEW.assertion_class       IS DISTINCT FROM OLD.assertion_class
     OR NEW.asserted_by_user_id   IS DISTINCT FROM OLD.asserted_by_user_id
     OR NEW.asserted_by_role      IS DISTINCT FROM OLD.asserted_by_role
     OR NEW.asserted_by_relationship IS DISTINCT FROM OLD.asserted_by_relationship
     OR NEW.appointment_id        IS DISTINCT FROM OLD.appointment_id
     OR NEW.source_kind           IS DISTINCT FROM OLD.source_kind
     OR NEW.source_description    IS DISTINCT FROM OLD.source_description
     OR NEW.evidence_document_id  IS DISTINCT FROM OLD.evidence_document_id
     OR NEW.amount_value          IS DISTINCT FROM OLD.amount_value
     OR NEW.amount_currency       IS DISTINCT FROM OLD.amount_currency
     OR NEW.customs_rate_value    IS DISTINCT FROM OLD.customs_rate_value
     OR NEW.customs_rate_source   IS DISTINCT FROM OLD.customs_rate_source
     OR NEW.customs_rate_effective_from IS DISTINCT FROM OLD.customs_rate_effective_from
     OR NEW.event_time            IS DISTINCT FROM OLD.event_time
     OR NEW.location              IS DISTINCT FROM OLD.location
     OR NEW.notes                 IS DISTINCT FROM OLD.notes
     OR NEW.created_by            IS DISTINCT FROM OLD.created_by
     OR NEW.created_at            IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'diaspora_customs_events is append-only: what was asserted, by whom, on what evidence and when cannot be rewritten. Record a correcting event instead.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customs_event_guard ON public.diaspora_customs_events;
CREATE TRIGGER trg_customs_event_guard
  BEFORE UPDATE ON public.diaspora_customs_events
  FOR EACH ROW EXECUTE FUNCTION public.carup_customs_event_guard();

CREATE OR REPLACE FUNCTION public.carup_customs_event_no_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'diaspora_customs_events cannot be deleted. Supersede the event by recording a correcting one, or soft-delete it with deleted_at.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customs_event_no_delete ON public.diaspora_customs_events;
CREATE TRIGGER trg_customs_event_no_delete
  BEFORE DELETE ON public.diaspora_customs_events
  FOR EACH ROW EXECUTE FUNCTION public.carup_customs_event_no_delete();

ALTER TABLE public.diaspora_customs_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_customs_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_customs_agent_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_customs_agent_appointments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_customs_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_customs_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.diaspora_customs_cases FROM anon, authenticated;
REVOKE ALL ON public.diaspora_customs_agent_appointments FROM anon, authenticated;
REVOKE ALL ON public.diaspora_customs_events FROM anon, authenticated;

-- +migrate Down
DROP TRIGGER IF EXISTS trg_customs_event_no_delete ON public.diaspora_customs_events;
DROP TRIGGER IF EXISTS trg_customs_event_guard ON public.diaspora_customs_events;
DROP FUNCTION IF EXISTS public.carup_customs_event_no_delete();
DROP FUNCTION IF EXISTS public.carup_customs_event_guard();
DROP TABLE IF EXISTS public.diaspora_customs_events;
DROP TABLE IF EXISTS public.diaspora_customs_agent_appointments;
DROP TABLE IF EXISTS public.diaspora_customs_cases;
