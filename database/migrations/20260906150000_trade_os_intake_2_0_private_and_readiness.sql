-- +migrate Up
-- =============================================================
-- Trade OS Intake 2.0 — conditional PRIVATE facts, and document readiness.
--
-- This migration exists to correct a reading of the contract that was too cautious. PRIVATE never
-- meant "do not collect until a later phase"; it means "collect where the journey needs it, and do
-- not expose it outside the authorized context". A shipper who asks for pickup must be able to say
-- WHERE and WHO to call, or the request cannot be served — and that is precisely the data that must
-- never appear in an open marketplace projection.
--
-- Every column here is therefore PRIVATE-class by default (§36.6). None is added to any
-- marketplace allow-list, and an adversarial sentinel test asserts none of them crosses.
--
-- Readiness is NOT the document lifecycle. It records what the customer says they have, so a later
-- phase does not have to ask again. Presence is not verification, and T8 still owns everything that
-- happens to an actual file.
-- =============================================================

-- ── 1. Logistics: pickup and delivery reality ───────────────────────────
ALTER TABLE public.diaspora_logistics_requests
  ADD COLUMN IF NOT EXISTS pickup_address TEXT NULL,
  ADD COLUMN IF NOT EXISTS pickup_contact_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS pickup_contact_phone TEXT NULL,
  ADD COLUMN IF NOT EXISTS pickup_available_from DATE NULL,
  ADD COLUMN IF NOT EXISTS pickup_access_notes TEXT NULL,
  ADD COLUMN IF NOT EXISTS pickup_loading_equipment TEXT NULL
    CHECK (pickup_loading_equipment IN ('available','not_available','unknown')),
  ADD COLUMN IF NOT EXISTS delivery_contact_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS delivery_contact_phone TEXT NULL,
  ADD COLUMN IF NOT EXISTS delivery_address TEXT NULL,
  ADD COLUMN IF NOT EXISTS unloading_required TEXT NULL
    CHECK (unloading_required IN ('yes','no','unsure')),
  ADD COLUMN IF NOT EXISTS service_mode_preference TEXT NULL
    CHECK (service_mode_preference IN ('no_preference','roro','shared_container','private_container','provider_recommendation')),
  ADD COLUMN IF NOT EXISTS inspection_intent TEXT NULL
    CHECK (inspection_intent IN ('please_arrange','already_arranged','already_completed','unsure','not_applicable')),
  ADD COLUMN IF NOT EXISTS insurance_intent TEXT NULL
    CHECK (insurance_intent IN ('interested','not_interested','already_insured','unsure')),
  ADD COLUMN IF NOT EXISTS clearing_intent TEXT NULL
    CHECK (clearing_intent IN ('own_agent','want_provider','arrange_later','unsure')),
  ADD COLUMN IF NOT EXISTS clearing_agent_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS clearing_agent_contact TEXT NULL,
  ADD COLUMN IF NOT EXISTS preferred_language TEXT NULL,
  ADD COLUMN IF NOT EXISTS preferred_contact_channel TEXT NULL
    CHECK (preferred_contact_channel IN ('carup_messages','email','phone','whatsapp'));

-- ── 2. Procurement: consignee and clearing-agent reality ────────────────
ALTER TABLE public.diaspora_import_orders
  ADD COLUMN IF NOT EXISTS consignee_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS consignee_phone TEXT NULL,
  ADD COLUMN IF NOT EXISTS delivery_address TEXT NULL,
  ADD COLUMN IF NOT EXISTS clearing_agent_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS clearing_agent_country TEXT NULL,
  ADD COLUMN IF NOT EXISTS clearing_agent_contact TEXT NULL,
  ADD COLUMN IF NOT EXISTS preferred_language TEXT NULL,
  ADD COLUMN IF NOT EXISTS preferred_contact_channel TEXT NULL
    CHECK (preferred_contact_channel IN ('carup_messages','email','phone','whatsapp'));

-- ── 3. Cargo: spare parts and personal goods travelling with a vehicle ──
ALTER TABLE public.diaspora_logistics_request_items
  ADD COLUMN IF NOT EXISTS accompanying_parts TEXT NULL,
  ADD COLUMN IF NOT EXISTS accompanying_personal_goods TEXT NULL,
  ADD COLUMN IF NOT EXISTS current_location TEXT NULL,
  ADD COLUMN IF NOT EXISTS inspection_state TEXT NULL
    CHECK (inspection_state IN ('completed','booked','not_arranged','unknown'));

-- ── 4. Document READINESS — not the document lifecycle ──────────────────
--
-- A row here says "the customer believes they have an invoice", nothing more. It is not a file, not
-- a verification, and not a claim that anything is customs- or export-ready. T8 owns documents; this
-- exists so T8 does not have to ask the same question a second time.
--
-- Modelled as rows rather than columns because the set of relevant documents varies by journey and
-- will grow, and as its own small table rather than jsonb because a later phase must be able to
-- query "which requests still need an export certificate".
CREATE TABLE IF NOT EXISTS public.diaspora_trade_document_readiness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('import_order','logistics_request')),
  subject_id uuid NOT NULL,
  document_type TEXT NOT NULL,
  -- Four honest states. There is deliberately no VERIFIED/APPROVED here: selecting "have it" is a
  -- customer telling us something, never CarUp confirming it.
  readiness TEXT NOT NULL
    CHECK (readiness IN ('have_it','will_get_later','need_help','unsure_if_required')),
  notes TEXT NULL,
  stated_by TEXT NULL,
  stated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL
);

-- One readiness answer per document type per subject; re-answering updates it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_trade_document_readiness_subject_type
  ON public.diaspora_trade_document_readiness (subject_type, subject_id, document_type)
  WHERE deleted_at IS NULL;

ALTER TABLE public.diaspora_trade_document_readiness ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_trade_document_readiness FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.diaspora_trade_document_readiness FROM PUBLIC;
REVOKE ALL ON public.diaspora_trade_document_readiness FROM anon;
REVOKE ALL ON public.diaspora_trade_document_readiness FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.diaspora_trade_document_readiness TO service_role;

-- +migrate Down
DROP TABLE IF EXISTS public.diaspora_trade_document_readiness;

ALTER TABLE public.diaspora_logistics_request_items
  DROP COLUMN IF EXISTS accompanying_parts, DROP COLUMN IF EXISTS accompanying_personal_goods,
  DROP COLUMN IF EXISTS current_location, DROP COLUMN IF EXISTS inspection_state;

ALTER TABLE public.diaspora_import_orders
  DROP COLUMN IF EXISTS consignee_name, DROP COLUMN IF EXISTS consignee_phone,
  DROP COLUMN IF EXISTS delivery_address, DROP COLUMN IF EXISTS clearing_agent_name,
  DROP COLUMN IF EXISTS clearing_agent_country, DROP COLUMN IF EXISTS clearing_agent_contact,
  DROP COLUMN IF EXISTS preferred_language, DROP COLUMN IF EXISTS preferred_contact_channel;

ALTER TABLE public.diaspora_logistics_requests
  DROP COLUMN IF EXISTS pickup_address, DROP COLUMN IF EXISTS pickup_contact_name,
  DROP COLUMN IF EXISTS pickup_contact_phone, DROP COLUMN IF EXISTS pickup_available_from,
  DROP COLUMN IF EXISTS pickup_access_notes, DROP COLUMN IF EXISTS pickup_loading_equipment,
  DROP COLUMN IF EXISTS delivery_contact_name, DROP COLUMN IF EXISTS delivery_contact_phone,
  DROP COLUMN IF EXISTS delivery_address, DROP COLUMN IF EXISTS unloading_required,
  DROP COLUMN IF EXISTS service_mode_preference, DROP COLUMN IF EXISTS inspection_intent,
  DROP COLUMN IF EXISTS insurance_intent, DROP COLUMN IF EXISTS clearing_intent,
  DROP COLUMN IF EXISTS clearing_agent_name, DROP COLUMN IF EXISTS clearing_agent_contact,
  DROP COLUMN IF EXISTS preferred_language, DROP COLUMN IF EXISTS preferred_contact_channel;
