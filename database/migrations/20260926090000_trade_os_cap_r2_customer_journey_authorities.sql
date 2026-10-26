-- +migrate Up
-- =============================================================
-- Trade OS T11-CAP-LR01-R2 — the persistence a customer's Car Arrival Progress page cannot honestly be built without.
--
-- Step B of R2 (docs/trade-os/receipts/T11_CAP_LR01_R2_AUTHORITY_MATRIX.md) checked every capability the customer page
-- shows against the live schema and the code. Most of it already has an owner — vehicles, T4 orders, T8 documents,
-- T11 shipments/legs/observations, T12 customs, T7 messages — and those stay the authorities. FIVE things have no home
-- anywhere, and each is created here, narrowly, and only here:
--
--   diaspora_external_progress_entries   what an EXTERNAL provider reported about a customer's transaction, stage by stage
--   diaspora_order_parties               who the paperwork names: consignee, notify party, document delivery, document centre, agent
--   diaspora_document_dispatches         the posting of the original documents: where to, by whom, what status
--   vehicle_specification_observations   spec facts `vehicles` has no column for (model code, engine size, steering, seats, ...)
--   vehicle_media_references             a governed REFERENCE from a vehicle to an existing evidence image — never a copy
--
-- WHAT THESE TABLES ARE NOT.
--   * They are not movement. T11 alone says a vessel sailed or arrived; nothing here has a column that could say so
--     (a test enforces that structurally). An external report that a stage is "Completed" is a report, with its own
--     provenance, and it never becomes a T11 fact by being stored.
--   * They are not a second copy of anything CarUp itself records. Progress that CarUp originates is COMPOSED at read
--     time from the authorities that own it, so the two can never disagree. The ledger is external-only by construction.
--   * They are not customs, payment or messaging authorities, and they create none.
--
-- THE RULE THAT RUNS THROUGH ALL FIVE: A FACT IS WHAT WAS SAID, WHEN WE SAW IT, AND WHAT SUPPORTS IT.
--   Every row carries its source, the source's own reference, when CarUp observed it, when CarUp stored it, a pointer to
--   the supporting evidence (content-hashed for external facts), and a verification state that starts at REPORTED —
--   an honest "as reported, not yet reviewed by CarUp". A moment in time is accepted only with a stated basis and never
--   in the future of its own observation; an unknown time is NULL, and the database offers no default that could
--   stand in for one (creation time is not event time).
--
-- RECORDED FACTS ARE NOT EDITED. To correct one, supersede it (set deleted_at) and record a new entry — the correction
-- path T8, T9, T11 and CAP-04 already use. One generic guard enforces this for four tables: any column not named as
-- mutable is immutable, INCLUDING any column added later, so a future column cannot silently be editable.
--
-- Additive: no existing table, column, function or policy is touched.
-- =============================================================

-- ── Shared guards ──────────────────────────────────────────────────────────

-- Recorded facts are immutable except the columns the trigger is told are mutable. Deny-by-default: the comparison is
-- over the whole row, so it cannot go stale when a column is added.
CREATE OR REPLACE FUNCTION public.carup_cap_recorded_fact_guard()
RETURNS TRIGGER AS $$
DECLARE
  new_row     jsonb := to_jsonb(NEW);
  old_row     jsonb := to_jsonb(OLD);
  attribution text;
BEGIN
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION
      '%: a superseded entry cannot be restored or re-dated. Record a new entry instead.', TG_TABLE_NAME;
  END IF;
  -- Columns that exist only to point at WHO or WHERE may be NULLED — which is what an ON DELETE SET NULL does when a user
  -- or tenant is removed — but never rewritten to something else. Without this, removing a user would be blocked by every
  -- row they ever created.
  FOREACH attribution IN ARRAY ARRAY['created_by', 'updated_by', 'tenant_id'] LOOP
    IF new_row ? attribution AND (new_row -> attribution) IS DISTINCT FROM (old_row -> attribution)
       AND (new_row -> attribution) = 'null'::jsonb THEN
      new_row := new_row - attribution;
      old_row := old_row - attribution;
    END IF;
  END LOOP;
  IF (new_row - TG_ARGV) IS DISTINCT FROM (old_row - TG_ARGV) THEN
    RAISE EXCEPTION
      '%: a recorded fact cannot be edited (immutable). Supersede it (set deleted_at) and record a new entry.', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A DELETE erases a recorded fact entirely, which no correction ever needs.
CREATE OR REPLACE FUNCTION public.carup_cap_recorded_fact_no_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    '%: recorded facts cannot be deleted: a record that can be erased cannot be audited. Set deleted_at to supersede.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- ── 1. External progress ledger ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.diaspora_external_progress_entries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  import_order_id       UUID NOT NULL REFERENCES public.diaspora_import_orders(id) ON DELETE CASCADE,
  vehicle_vin           TEXT REFERENCES public.vehicles(vin) ON DELETE RESTRICT,
  shipment_id           UUID REFERENCES public.diaspora_shipments(id) ON DELETE RESTRICT,

  -- Where in the customer's journey, and in what order. Two orderings, both explicit: the position in the whole
  -- transaction, and the position inside the stage. Nothing is ordered by creation time.
  stage_code            TEXT NOT NULL,
  entry_sequence        INTEGER NOT NULL,
  action_sequence       INTEGER NOT NULL,

  -- Who the SOURCE says did it, in the source's own words, plus a kind CarUp can render without reproducing the label.
  action_taker_reported TEXT NOT NULL,
  action_taker_kind     TEXT NOT NULL,
  action_text           TEXT NOT NULL,
  reported_status       TEXT NOT NULL,

  -- When the action happened — usually unknown. NULL is a complete, valid answer. There is deliberately NO default and
  -- no relationship to created_at: the moment a row was stored says nothing about when the action took place.
  event_time            TIMESTAMPTZ,
  event_time_basis      TEXT,

  source_system         TEXT NOT NULL,
  source_reference      TEXT NOT NULL,
  source_position       TEXT,
  evidence_ref          TEXT NOT NULL,
  evidence_digest       TEXT NOT NULL,
  observed_at           TIMESTAMPTZ NOT NULL,
  imported_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verification_status   TEXT NOT NULL DEFAULT 'REPORTED',
  ingestion_run         TEXT,

  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by            TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by            TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ,

  CONSTRAINT diaspora_external_progress_stage_chk CHECK (
    stage_code IN ('BOOKING', 'DEPARTURE', 'BILL_OF_LADING', 'DISPATCH', 'CLEARING_DELIVERY')),
  CONSTRAINT diaspora_external_progress_sequence_chk CHECK (entry_sequence >= 1 AND action_sequence >= 1),
  CONSTRAINT diaspora_external_progress_taker_kind_chk CHECK (
    action_taker_kind IN ('PROVIDER', 'CARRIER', 'DOCUMENT_CENTRE', 'DESTINATION_AGENT', 'CUSTOMER', 'UNKNOWN')),
  CONSTRAINT diaspora_external_progress_taker_chk CHECK (
    btrim(action_taker_reported) <> '' AND char_length(action_taker_reported) <= 200),
  CONSTRAINT diaspora_external_progress_text_chk CHECK (btrim(action_text) <> '' AND char_length(action_text) <= 1000),
  CONSTRAINT diaspora_external_progress_status_chk CHECK (
    reported_status IN ('COMPLETED', 'IN_PROGRESS', 'PENDING', 'CANCELLED', 'UNKNOWN')),
  -- A time is stated WITH its basis or not at all. CARUP_OBSERVED is not an allowed basis: a time CarUp itself
  -- observed is a T11 fact and belongs in T11, not in a ledger of what someone else reported.
  CONSTRAINT diaspora_external_progress_time_basis_chk CHECK (
    (event_time IS NULL AND event_time_basis IS NULL)
    OR (event_time IS NOT NULL AND event_time_basis IS NOT NULL AND event_time_basis IN ('SOURCE_SUPPLIED', 'DOCUMENT_STATED'))),
  -- An action cannot have happened after the moment it was observed to have happened.
  CONSTRAINT diaspora_external_progress_time_order_chk CHECK (event_time IS NULL OR event_time <= observed_at),
  CONSTRAINT diaspora_external_progress_observed_chk CHECK (observed_at <= imported_at + INTERVAL '5 minutes'),
  CONSTRAINT diaspora_external_progress_source_system_chk CHECK (btrim(source_system) <> '' AND char_length(source_system) <= 120),
  CONSTRAINT diaspora_external_progress_source_reference_chk CHECK (btrim(source_reference) <> '' AND char_length(source_reference) <= 500),
  CONSTRAINT diaspora_external_progress_source_position_chk CHECK (source_position IS NULL OR char_length(source_position) <= 200),
  CONSTRAINT diaspora_external_progress_evidence_ref_chk CHECK (btrim(evidence_ref) <> '' AND char_length(evidence_ref) <= 500),
  CONSTRAINT diaspora_external_progress_evidence_digest_chk CHECK (evidence_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT diaspora_external_progress_verification_chk CHECK (
    verification_status IN ('REPORTED', 'CORROBORATED', 'VERIFIED', 'DISPUTED', 'SUPERSEDED'))
);

-- One live entry per position in the transaction's ledger from one source; one live entry per position in a stage.
-- Both make a repeated import a no-op instead of a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_external_progress_live_entry
  ON public.diaspora_external_progress_entries (import_order_id, source_system, source_reference, entry_sequence)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_external_progress_live_stage_action
  ON public.diaspora_external_progress_entries (import_order_id, source_system, source_reference, stage_code, action_sequence)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_external_progress_order
  ON public.diaspora_external_progress_entries (import_order_id, entry_sequence)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_external_progress_guard ON public.diaspora_external_progress_entries;
CREATE TRIGGER trg_external_progress_guard
  BEFORE UPDATE ON public.diaspora_external_progress_entries
  FOR EACH ROW EXECUTE FUNCTION public.carup_cap_recorded_fact_guard('verification_status', 'metadata', 'deleted_at', 'updated_at', 'updated_by');
DROP TRIGGER IF EXISTS trg_external_progress_no_delete ON public.diaspora_external_progress_entries;
CREATE TRIGGER trg_external_progress_no_delete
  BEFORE DELETE ON public.diaspora_external_progress_entries
  FOR EACH ROW EXECUTE FUNCTION public.carup_cap_recorded_fact_no_delete();

-- ── 2. Parties named on the paperwork ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.diaspora_order_parties (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  import_order_id       UUID NOT NULL REFERENCES public.diaspora_import_orders(id) ON DELETE CASCADE,

  party_role            TEXT NOT NULL,
  -- An individual's contact details are personal data; an organisation's are its published business contact. The kind
  -- is what a future shared view uses to decide what it may show — never to widen what the owner already sees.
  party_kind            TEXT NOT NULL,
  display_name          TEXT NOT NULL,
  address_line          TEXT,
  city                  TEXT,
  country               TEXT,
  phone                 TEXT,
  email                 TEXT,

  origin                TEXT NOT NULL,
  source_system         TEXT NOT NULL,
  source_reference      TEXT,
  source_position       TEXT,
  evidence_ref          TEXT,
  evidence_digest       TEXT,
  observed_at           TIMESTAMPTZ NOT NULL,
  imported_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verification_status   TEXT NOT NULL DEFAULT 'REPORTED',
  ingestion_run         TEXT,

  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by            TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by            TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ,

  CONSTRAINT diaspora_order_parties_role_chk CHECK (
    party_role IN ('CONSIGNEE', 'NOTIFY_PARTY', 'DOCUMENT_DELIVERY', 'DOCUMENT_CENTRE', 'DESTINATION_AGENT')),
  CONSTRAINT diaspora_order_parties_kind_chk CHECK (party_kind IN ('INDIVIDUAL', 'ORGANISATION')),
  CONSTRAINT diaspora_order_parties_name_chk CHECK (btrim(display_name) <> '' AND char_length(display_name) <= 200),
  CONSTRAINT diaspora_order_parties_address_chk CHECK (
    (address_line IS NULL OR char_length(address_line) <= 400) AND (city IS NULL OR char_length(city) <= 120)
    AND (country IS NULL OR char_length(country) <= 120)),
  CONSTRAINT diaspora_order_parties_phone_chk CHECK (phone IS NULL OR phone ~ '^[0-9+() .-]{5,40}$'),
  CONSTRAINT diaspora_order_parties_email_chk CHECK (email IS NULL OR (email ~ '^[^@[:space:]]+@[^@[:space:]]+$' AND char_length(email) <= 254)),
  CONSTRAINT diaspora_order_parties_origin_chk CHECK (origin IN ('EXTERNAL_REPORT', 'OWNER_DECLARED', 'CARUP')),
  -- Provenance completeness is a database rule, not a convention: an externally reported party must say what it came
  -- from and carry a content-hashed pointer to what supports it.
  CONSTRAINT diaspora_order_parties_external_provenance_chk CHECK (
    origin <> 'EXTERNAL_REPORT'
    OR (source_reference IS NOT NULL AND btrim(source_reference) <> '' AND evidence_ref IS NOT NULL AND evidence_digest IS NOT NULL)),
  CONSTRAINT diaspora_order_parties_source_system_chk CHECK (btrim(source_system) <> '' AND char_length(source_system) <= 120),
  CONSTRAINT diaspora_order_parties_source_reference_chk CHECK (source_reference IS NULL OR (btrim(source_reference) <> '' AND char_length(source_reference) <= 500)),
  CONSTRAINT diaspora_order_parties_source_position_chk CHECK (source_position IS NULL OR char_length(source_position) <= 200),
  CONSTRAINT diaspora_order_parties_evidence_ref_chk CHECK (evidence_ref IS NULL OR (btrim(evidence_ref) <> '' AND char_length(evidence_ref) <= 500)),
  CONSTRAINT diaspora_order_parties_evidence_digest_chk CHECK (evidence_digest IS NULL OR evidence_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT diaspora_order_parties_observed_chk CHECK (observed_at <= imported_at + INTERVAL '5 minutes'),
  CONSTRAINT diaspora_order_parties_verification_chk CHECK (
    verification_status IN ('REPORTED', 'CORROBORATED', 'VERIFIED', 'DISPUTED', 'SUPERSEDED'))
);

-- One live party per role on an order. A changed address is a new party row; the old one is kept, superseded.
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_party_live_role
  ON public.diaspora_order_parties (import_order_id, party_role)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_order_party_guard ON public.diaspora_order_parties;
CREATE TRIGGER trg_order_party_guard
  BEFORE UPDATE ON public.diaspora_order_parties
  FOR EACH ROW EXECUTE FUNCTION public.carup_cap_recorded_fact_guard('verification_status', 'metadata', 'deleted_at', 'updated_at', 'updated_by');
DROP TRIGGER IF EXISTS trg_order_party_no_delete ON public.diaspora_order_parties;
CREATE TRIGGER trg_order_party_no_delete
  BEFORE DELETE ON public.diaspora_order_parties
  FOR EACH ROW EXECUTE FUNCTION public.carup_cap_recorded_fact_no_delete();

-- ── 3. Document dispatches ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.diaspora_document_dispatches (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  import_order_id       UUID NOT NULL REFERENCES public.diaspora_import_orders(id) ON DELETE CASCADE,
  shipment_id           UUID REFERENCES public.diaspora_shipments(id) ON DELETE RESTRICT,
  recipient_party_id    UUID REFERENCES public.diaspora_order_parties(id) ON DELETE RESTRICT,

  document_types        TEXT[] NOT NULL,
  courier_name          TEXT,
  tracking_number       TEXT,
  -- The status in the SOURCE's words, kept verbatim, and the status CarUp can reason about. Neither is the other.
  status_reported_text  TEXT,
  dispatch_status       TEXT NOT NULL,
  status_observed_at    TIMESTAMPTZ NOT NULL,
  dispatched_at         TIMESTAMPTZ,
  delivered_at          TIMESTAMPTZ,
  message_text          TEXT,

  origin                TEXT NOT NULL,
  source_system         TEXT NOT NULL,
  source_reference      TEXT,
  source_position       TEXT,
  evidence_ref          TEXT,
  evidence_digest       TEXT,
  imported_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verification_status   TEXT NOT NULL DEFAULT 'REPORTED',
  ingestion_run         TEXT,

  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by            TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by            TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ,

  -- The documents that travel are the shipping documents the journey is about (T8's journey document types).
  CONSTRAINT diaspora_document_dispatches_types_chk CHECK (
    cardinality(document_types) >= 1
    AND document_types <@ ARRAY['bill_of_lading', 'commercial_invoice', 'export_certificate', 'inspection_certificate',
                                'insurance_certificate', 'packing_list']::text[]),
  CONSTRAINT diaspora_document_dispatches_status_chk CHECK (
    dispatch_status IN ('PREPARING', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'RETURNED', 'UNKNOWN')),
  -- A tracking NUMBER looks like a tracking number. The source this was first built from stores a status phrase in its
  -- tracking field; that phrase must land in status_reported_text, and this refuses to let it be stored as a number.
  CONSTRAINT diaspora_document_dispatches_tracking_chk CHECK (tracking_number IS NULL OR tracking_number ~ '^[A-Za-z0-9-]{6,40}$'),
  CONSTRAINT diaspora_document_dispatches_courier_chk CHECK (courier_name IS NULL OR (btrim(courier_name) <> '' AND char_length(courier_name) <= 120)),
  CONSTRAINT diaspora_document_dispatches_text_chk CHECK (
    (status_reported_text IS NULL OR char_length(status_reported_text) <= 300) AND (message_text IS NULL OR char_length(message_text) <= 2000)),
  CONSTRAINT diaspora_document_dispatches_times_chk CHECK (
    (delivered_at IS NULL OR dispatch_status = 'DELIVERED')
    AND (delivered_at IS NULL OR dispatched_at IS NULL OR dispatched_at <= delivered_at)
    AND (delivered_at IS NULL OR delivered_at <= status_observed_at)
    AND (dispatched_at IS NULL OR dispatched_at <= status_observed_at)),
  CONSTRAINT diaspora_document_dispatches_origin_chk CHECK (origin IN ('EXTERNAL_REPORT', 'OWNER_DECLARED', 'CARUP')),
  CONSTRAINT diaspora_document_dispatches_external_provenance_chk CHECK (
    origin <> 'EXTERNAL_REPORT'
    OR (source_reference IS NOT NULL AND btrim(source_reference) <> '' AND evidence_ref IS NOT NULL AND evidence_digest IS NOT NULL)),
  CONSTRAINT diaspora_document_dispatches_source_system_chk CHECK (btrim(source_system) <> '' AND char_length(source_system) <= 120),
  CONSTRAINT diaspora_document_dispatches_source_reference_chk CHECK (source_reference IS NULL OR (btrim(source_reference) <> '' AND char_length(source_reference) <= 500)),
  CONSTRAINT diaspora_document_dispatches_source_position_chk CHECK (source_position IS NULL OR char_length(source_position) <= 200),
  CONSTRAINT diaspora_document_dispatches_evidence_ref_chk CHECK (evidence_ref IS NULL OR (btrim(evidence_ref) <> '' AND char_length(evidence_ref) <= 500)),
  CONSTRAINT diaspora_document_dispatches_evidence_digest_chk CHECK (evidence_digest IS NULL OR evidence_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT diaspora_document_dispatches_verification_chk CHECK (
    verification_status IN ('REPORTED', 'CORROBORATED', 'VERIFIED', 'DISPUTED', 'SUPERSEDED'))
);

-- One live dispatch per (order, source, source reference): a repeated import is a no-op. A native dispatch has no
-- source reference and is identified by its own id.
CREATE UNIQUE INDEX IF NOT EXISTS uq_document_dispatch_live_source
  ON public.diaspora_document_dispatches (import_order_id, source_system, source_reference)
  WHERE deleted_at IS NULL AND source_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_document_dispatch_order
  ON public.diaspora_document_dispatches (import_order_id)
  WHERE deleted_at IS NULL;

-- A status is observed AFTER the dispatch was stored, so "not later than import" would be wrong here. The rule that matters is
-- "not from the future" — a slipped time zone is the realistic error — with a few minutes' grace for clock skew.
CREATE OR REPLACE FUNCTION public.carup_document_dispatch_time_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status_observed_at > clock_timestamp() + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'diaspora_document_dispatches: a status cannot have been observed in the future';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_document_dispatch_time_guard ON public.diaspora_document_dispatches;
CREATE TRIGGER trg_document_dispatch_time_guard
  BEFORE INSERT OR UPDATE OF status_observed_at ON public.diaspora_document_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.carup_document_dispatch_time_guard();

-- A dispatch's identity and provenance are fixed; its status moves as the envelope does, and each move is attributed.
DROP TRIGGER IF EXISTS trg_document_dispatch_guard ON public.diaspora_document_dispatches;
CREATE TRIGGER trg_document_dispatch_guard
  BEFORE UPDATE ON public.diaspora_document_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.carup_cap_recorded_fact_guard(
    'dispatch_status', 'status_reported_text', 'status_observed_at', 'courier_name', 'tracking_number', 'dispatched_at',
    'delivered_at', 'message_text', 'verification_status', 'metadata', 'deleted_at', 'updated_at', 'updated_by');
DROP TRIGGER IF EXISTS trg_document_dispatch_no_delete ON public.diaspora_document_dispatches;
CREATE TRIGGER trg_document_dispatch_no_delete
  BEFORE DELETE ON public.diaspora_document_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.carup_cap_recorded_fact_no_delete();

-- ── 4. Vehicle specification observations ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.vehicle_specification_observations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin                   TEXT NOT NULL REFERENCES public.vehicles(vin) ON DELETE RESTRICT,

  -- A controlled list. A new kind of fact is a deliberate migration, not a free string; and a fact the `vehicles` table
  -- already holds (make, model, year, trim, colour, mileage, fuel, drivetrain, transmission, engine and chassis number)
  -- is deliberately NOT here — the canonical column stays the authority for it.
  spec_key              TEXT NOT NULL,
  value_text            TEXT,
  value_number          NUMERIC,
  unit                  TEXT,
  -- The source's own wording, kept so a normalised value can always be traced to what was actually said.
  source_value_raw      TEXT,

  origin                TEXT NOT NULL,
  source_system         TEXT NOT NULL,
  source_reference      TEXT,
  source_position       TEXT,
  evidence_ref          TEXT,
  evidence_digest       TEXT,
  observed_at           TIMESTAMPTZ NOT NULL,
  imported_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verification_status   TEXT NOT NULL DEFAULT 'REPORTED',
  ingestion_run         TEXT,

  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by            TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by            TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ,

  CONSTRAINT vehicle_spec_obs_key_chk CHECK (spec_key IN (
    'MODEL_CODE', 'REGISTRATION_YEAR_MONTH', 'MANUFACTURE_YEAR_MONTH', 'ENGINE_DISPLACEMENT_CC', 'STEERING_SIDE',
    'SEAT_COUNT', 'DOOR_COUNT', 'EQUIPMENT_ITEM', 'FUEL_DETAIL')),
  -- Each kind of fact has ONE shape. A seat count with a text value, or an engine size with no unit, is refused here.
  CONSTRAINT vehicle_spec_obs_text_keys_chk CHECK (
    spec_key NOT IN ('MODEL_CODE', 'FUEL_DETAIL', 'EQUIPMENT_ITEM')
    OR COALESCE(value_text IS NOT NULL AND btrim(value_text) <> '' AND char_length(value_text) <= 200 AND value_number IS NULL AND unit IS NULL, FALSE)),
  CONSTRAINT vehicle_spec_obs_year_month_chk CHECK (
    spec_key NOT IN ('REGISTRATION_YEAR_MONTH', 'MANUFACTURE_YEAR_MONTH')
    OR COALESCE(value_text ~ '^(19[5-9][0-9]|20[0-9][0-9])-(0[1-9]|1[0-2])$' AND value_number IS NULL AND unit IS NULL, FALSE)),
  CONSTRAINT vehicle_spec_obs_displacement_chk CHECK (
    spec_key <> 'ENGINE_DISPLACEMENT_CC'
    OR COALESCE(value_number IS NOT NULL AND value_number > 0 AND value_number < 20000 AND unit = 'cc' AND value_text IS NULL, FALSE)),
  CONSTRAINT vehicle_spec_obs_count_chk CHECK (
    spec_key NOT IN ('SEAT_COUNT', 'DOOR_COUNT')
    OR COALESCE(value_number IS NOT NULL AND value_number = trunc(value_number) AND value_number BETWEEN 1 AND 100 AND unit = 'count' AND value_text IS NULL, FALSE)),
  CONSTRAINT vehicle_spec_obs_steering_chk CHECK (
    spec_key <> 'STEERING_SIDE' OR COALESCE(value_text IN ('RIGHT', 'LEFT') AND value_number IS NULL AND unit IS NULL, FALSE)),
  CONSTRAINT vehicle_spec_obs_raw_chk CHECK (source_value_raw IS NULL OR char_length(source_value_raw) <= 500),
  CONSTRAINT vehicle_spec_obs_origin_chk CHECK (origin IN ('EXTERNAL_REPORT', 'OWNER_DECLARED', 'CARUP')),
  CONSTRAINT vehicle_spec_obs_external_provenance_chk CHECK (
    origin <> 'EXTERNAL_REPORT'
    OR (source_reference IS NOT NULL AND btrim(source_reference) <> '' AND evidence_ref IS NOT NULL AND evidence_digest IS NOT NULL)),
  CONSTRAINT vehicle_spec_obs_source_system_chk CHECK (btrim(source_system) <> '' AND char_length(source_system) <= 120),
  CONSTRAINT vehicle_spec_obs_source_reference_chk CHECK (source_reference IS NULL OR (btrim(source_reference) <> '' AND char_length(source_reference) <= 500)),
  CONSTRAINT vehicle_spec_obs_source_position_chk CHECK (source_position IS NULL OR char_length(source_position) <= 200),
  CONSTRAINT vehicle_spec_obs_evidence_ref_chk CHECK (evidence_ref IS NULL OR (btrim(evidence_ref) <> '' AND char_length(evidence_ref) <= 500)),
  CONSTRAINT vehicle_spec_obs_evidence_digest_chk CHECK (evidence_digest IS NULL OR evidence_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT vehicle_spec_obs_observed_chk CHECK (observed_at <= imported_at + INTERVAL '5 minutes'),
  CONSTRAINT vehicle_spec_obs_verification_chk CHECK (
    verification_status IN ('REPORTED', 'CORROBORATED', 'VERIFIED', 'DISPUTED', 'SUPERSEDED'))
);

-- A single-valued fact has one live value per (vehicle, kind, source) — so a source that says two different engine sizes
-- is a conflict the database refuses rather than a silent pair. Equipment is many-valued: one live row per item.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_spec_obs_live_single
  ON public.vehicle_specification_observations (vin, spec_key, source_system, COALESCE(source_reference, ''))
  WHERE deleted_at IS NULL AND spec_key <> 'EQUIPMENT_ITEM';
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_spec_obs_live_equipment
  ON public.vehicle_specification_observations (vin, source_system, COALESCE(source_reference, ''), lower(value_text))
  WHERE deleted_at IS NULL AND spec_key = 'EQUIPMENT_ITEM';
CREATE INDEX IF NOT EXISTS idx_vehicle_spec_obs_vin
  ON public.vehicle_specification_observations (vin)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_vehicle_spec_obs_guard ON public.vehicle_specification_observations;
CREATE TRIGGER trg_vehicle_spec_obs_guard
  BEFORE UPDATE ON public.vehicle_specification_observations
  FOR EACH ROW EXECUTE FUNCTION public.carup_cap_recorded_fact_guard('verification_status', 'metadata', 'deleted_at', 'updated_at', 'updated_by');
DROP TRIGGER IF EXISTS trg_vehicle_spec_obs_no_delete ON public.vehicle_specification_observations;
CREATE TRIGGER trg_vehicle_spec_obs_no_delete
  BEFORE DELETE ON public.vehicle_specification_observations
  FOR EACH ROW EXECUTE FUNCTION public.carup_cap_recorded_fact_no_delete();

-- ── 5. Vehicle media references ─────────────────────────────────────────────
--
-- A reference is NOT a copy and NOT a listing photo. It says "this existing governed evidence image is part of this
-- vehicle's presentation, in this position". The bytes stay where they are, private. Whether anyone beyond the vehicle's
-- own authorised parties can see them is decided elsewhere (listing publication), never by a row here — so there is no
-- column here that could make an image public.

CREATE TABLE IF NOT EXISTS public.vehicle_media_references (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin                   TEXT NOT NULL REFERENCES public.vehicles(vin) ON DELETE CASCADE,
  evidence_id           UUID NOT NULL REFERENCES public.vehicle_evidence(id) ON DELETE CASCADE,

  gallery_position      INTEGER NOT NULL,
  -- Primacy is a CHOICE and says whose. A reference is primary only when someone (or a source) designated it.
  is_primary            BOOLEAN NOT NULL DEFAULT FALSE,
  primary_basis         TEXT,
  label                 TEXT,
  ordinal_basis         TEXT NOT NULL,

  source_system         TEXT NOT NULL,
  source_reference      TEXT,
  source_position       INTEGER,
  observed_at           TIMESTAMPTZ NOT NULL,
  imported_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingestion_run         TEXT,

  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by            TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by            TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ,

  CONSTRAINT vehicle_media_ref_position_chk CHECK (gallery_position >= 1),
  CONSTRAINT vehicle_media_ref_primary_chk CHECK (
    (is_primary AND primary_basis IS NOT NULL) OR (NOT is_primary AND primary_basis IS NULL)),
  CONSTRAINT vehicle_media_ref_primary_basis_chk CHECK (
    primary_basis IS NULL OR primary_basis IN ('SOURCE_FIRST_IMAGE', 'OWNER_SELECTED', 'OPERATOR_SELECTED')),
  CONSTRAINT vehicle_media_ref_ordinal_basis_chk CHECK (
    ordinal_basis IN ('SOURCE_GALLERY_ORDER', 'OWNER_ORDER', 'OPERATOR_ORDER')),
  CONSTRAINT vehicle_media_ref_label_chk CHECK (label IS NULL OR (btrim(label) <> '' AND char_length(label) <= 120)),
  CONSTRAINT vehicle_media_ref_source_system_chk CHECK (btrim(source_system) <> '' AND char_length(source_system) <= 120),
  CONSTRAINT vehicle_media_ref_source_reference_chk CHECK (source_reference IS NULL OR (btrim(source_reference) <> '' AND char_length(source_reference) <= 500)),
  CONSTRAINT vehicle_media_ref_source_position_chk CHECK (source_position IS NULL OR source_position >= 1),
  CONSTRAINT vehicle_media_ref_observed_chk CHECK (observed_at <= imported_at + INTERVAL '5 minutes')
);

-- An asset is referenced once per vehicle; a position is held once; there is at most one primary.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_media_ref_live_asset
  ON public.vehicle_media_references (vin, evidence_id)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_media_ref_live_position
  ON public.vehicle_media_references (vin, gallery_position)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_media_ref_live_primary
  ON public.vehicle_media_references (vin)
  WHERE deleted_at IS NULL AND is_primary;
CREATE INDEX IF NOT EXISTS idx_vehicle_media_ref_vin
  ON public.vehicle_media_references (vin, gallery_position)
  WHERE deleted_at IS NULL;

-- (Named "validate" so it fires after "guard": triggers run in name order, and an attempt to re-point or move a reference
-- should be refused first as what it is — an edit of a recorded fact — not as a side effect of this check.)
-- A reference must point at an IMAGE that belongs to THIS vehicle and that has not been rejected. A foreign key cannot
-- say "same vin" without altering vehicle_evidence, which this migration deliberately does not touch.
CREATE OR REPLACE FUNCTION public.carup_vehicle_media_reference_check()
RETURNS TRIGGER AS $$
DECLARE
  ev RECORD;
BEGIN
  SELECT vin, mime_type, verification_status INTO ev FROM public.vehicle_evidence WHERE id = NEW.evidence_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vehicle_media_references: the evidence asset does not exist';
  END IF;
  IF ev.vin IS DISTINCT FROM NEW.vin THEN
    RAISE EXCEPTION 'vehicle_media_references: the evidence asset belongs to a different vehicle';
  END IF;
  IF ev.mime_type IS NULL OR ev.mime_type NOT LIKE 'image/%' THEN
    RAISE EXCEPTION 'vehicle_media_references: only an image can be presented as vehicle media';
  END IF;
  IF ev.verification_status = 'rejected' AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'vehicle_media_references: a rejected evidence asset cannot be presented';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vehicle_media_ref_validate ON public.vehicle_media_references;
CREATE TRIGGER trg_vehicle_media_ref_validate
  BEFORE INSERT OR UPDATE OF vin, evidence_id, deleted_at ON public.vehicle_media_references
  FOR EACH ROW EXECUTE FUNCTION public.carup_vehicle_media_reference_check();

-- Which asset, for which vehicle, from where, is fixed. Presentation (order, primacy, label) is correctable by the owner.
DROP TRIGGER IF EXISTS trg_vehicle_media_ref_guard ON public.vehicle_media_references;
CREATE TRIGGER trg_vehicle_media_ref_guard
  BEFORE UPDATE ON public.vehicle_media_references
  FOR EACH ROW EXECUTE FUNCTION public.carup_cap_recorded_fact_guard(
    'gallery_position', 'is_primary', 'primary_basis', 'label', 'ordinal_basis', 'metadata', 'deleted_at', 'updated_at', 'updated_by');

-- ── Access: the browser reaches none of this ────────────────────────────────

ALTER TABLE public.diaspora_external_progress_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_external_progress_entries FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.diaspora_external_progress_entries FROM anon, authenticated;

ALTER TABLE public.diaspora_order_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_order_parties FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.diaspora_order_parties FROM anon, authenticated;

ALTER TABLE public.diaspora_document_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_document_dispatches FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.diaspora_document_dispatches FROM anon, authenticated;

ALTER TABLE public.vehicle_specification_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_specification_observations FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.vehicle_specification_observations FROM anon, authenticated;

ALTER TABLE public.vehicle_media_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_media_references FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.vehicle_media_references FROM anon, authenticated;

COMMENT ON TABLE public.diaspora_external_progress_entries IS
  'T11-CAP-LR01-R2 customer progress as REPORTED by an external provider, stage by stage. Not movement: no column can assert '
  'that anything sailed or arrived (T11 alone does). event_time is NULL unless the source supplied one, and never defaults. '
  'Recorded facts are immutable; supersede with deleted_at and record a new entry.';
COMMENT ON TABLE public.diaspora_order_parties IS
  'T11-CAP-LR01-R2 the parties the transaction paperwork names (consignee, notify party, document delivery, document centre, '
  'agent). Declared, not authoritative: it does not change who the buyer is or who may act. Private to the order owner.';
COMMENT ON TABLE public.diaspora_document_dispatches IS
  'T11-CAP-LR01-R2 the posting of original documents. status_reported_text is the source''s own wording; tracking_number is only '
  'ever a tracking number. Identity and provenance are fixed; status moves and each move is attributed.';
COMMENT ON TABLE public.vehicle_specification_observations IS
  'T11-CAP-LR01-R2 specification facts the canonical vehicles table has no column for. One shape per kind; the canonical '
  'column stays the authority for anything it already holds.';
COMMENT ON TABLE public.vehicle_media_references IS
  'T11-CAP-LR01-R2 a governed reference from a vehicle to an existing evidence image: position, primacy and label only. Never a '
  'copy, never a listing photo, never public. Visibility beyond the vehicle''s own authorised parties is decided by listing '
  'publication, not here.';

-- +migrate Down
DROP TRIGGER IF EXISTS trg_vehicle_media_ref_guard ON public.vehicle_media_references;
DROP TRIGGER IF EXISTS trg_vehicle_media_ref_validate ON public.vehicle_media_references;
DROP TABLE IF EXISTS public.vehicle_media_references;
DROP FUNCTION IF EXISTS public.carup_vehicle_media_reference_check();

DROP TRIGGER IF EXISTS trg_vehicle_spec_obs_no_delete ON public.vehicle_specification_observations;
DROP TRIGGER IF EXISTS trg_vehicle_spec_obs_guard ON public.vehicle_specification_observations;
DROP TABLE IF EXISTS public.vehicle_specification_observations;

DROP TRIGGER IF EXISTS trg_document_dispatch_time_guard ON public.diaspora_document_dispatches;
DROP TRIGGER IF EXISTS trg_document_dispatch_no_delete ON public.diaspora_document_dispatches;
DROP TRIGGER IF EXISTS trg_document_dispatch_guard ON public.diaspora_document_dispatches;
DROP TABLE IF EXISTS public.diaspora_document_dispatches;
DROP FUNCTION IF EXISTS public.carup_document_dispatch_time_guard();

DROP TRIGGER IF EXISTS trg_order_party_no_delete ON public.diaspora_order_parties;
DROP TRIGGER IF EXISTS trg_order_party_guard ON public.diaspora_order_parties;
DROP TABLE IF EXISTS public.diaspora_order_parties;

DROP TRIGGER IF EXISTS trg_external_progress_no_delete ON public.diaspora_external_progress_entries;
DROP TRIGGER IF EXISTS trg_external_progress_guard ON public.diaspora_external_progress_entries;
DROP TABLE IF EXISTS public.diaspora_external_progress_entries;

DROP FUNCTION IF EXISTS public.carup_cap_recorded_fact_no_delete();
DROP FUNCTION IF EXISTS public.carup_cap_recorded_fact_guard();
