-- +migrate Up
-- =============================================================
-- Trade OS T2 (Request Quotes / Reverse RFQ 2.0) — additive sourcing structure.
--
-- Two additive changes, no rewrite of the hardened order/quote kernel:
--
-- 1. `diaspora_import_order_request_lines` — a real relational model for multi-item sourcing
--    requests. `diaspora_import_orders.order_type` already allows 'mixed', but there was nowhere to
--    record WHAT the mixed request contains, so a buyer asking for three different parts had to
--    open three disconnected RFQs (or hide the structure in ungoverned metadata). Line items are
--    matched, quoted and compared per line, so they are authoritative business data and belong in a
--    table, not in jsonb.
--
-- 2. Additive commercial columns on `diaspora_import_quotes`. The quote table already carries
--    amount/currency/valid_until/inclusions/exclusions/metadata. The buyer comparison surface must
--    compare quantity, unit price, dispatch lead time and whether shipping is included — comparison
--    dimensions must be queryable columns, not free-form metadata. All are NULLABLE: every existing
--    quote row stays valid and every existing code path keeps working unchanged.
--
-- Additive and backwards-compatible. STAGING ONLY under this programme; production untouched.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.diaspora_import_order_request_lines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_order_id     UUID NOT NULL REFERENCES public.diaspora_import_orders(id) ON DELETE CASCADE,
  tenant_id           UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  line_number         INTEGER NOT NULL,
  -- What the buyer is asking for, in ordinary language ("front shocks").
  item_description    TEXT NOT NULL,
  item_kind           TEXT NOT NULL DEFAULT 'part' CHECK (item_kind IN ('vehicle', 'part', 'other')),
  quantity            INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  -- Vehicle context for the line. A part is usually "for" a vehicle; a vehicle line describes itself.
  vehicle_make        TEXT,
  vehicle_model       TEXT,
  vehicle_year_min    INTEGER,
  vehicle_year_max    INTEGER,
  -- Canonical CarUp vehicle linkage when the buyer picked one of their own vehicles.
  linked_vehicle_vin  TEXT REFERENCES public.vehicles(vin) ON DELETE SET NULL,
  -- Part identity when the buyer knows it. `part_number_known = false` is a FIRST-CLASS answer:
  -- most ordinary buyers do not know it, and the seller needs to see that explicitly.
  part_number         TEXT,
  part_number_known   BOOLEAN NOT NULL DEFAULT false,
  condition_preference TEXT CHECK (condition_preference IN ('new', 'used', 'oem', 'aftermarket', 'any')),
  notes               TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by          TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by          TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,
  CONSTRAINT diaspora_request_line_unique_number UNIQUE (import_order_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_diaspora_request_lines_order
  ON public.diaspora_import_order_request_lines (import_order_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_diaspora_request_lines_part
  ON public.diaspora_import_order_request_lines (part_number) WHERE part_number IS NOT NULL;

COMMENT ON TABLE public.diaspora_import_order_request_lines IS
  'Sourcing request lines for a buyer RFQ. Authoritative: matched, quoted and compared per line.';
COMMENT ON COLUMN public.diaspora_import_order_request_lines.part_number_known IS
  'Explicitly false when the buyer does not know the part number — a first-class answer sellers must see, never inferred from NULL.';

-- Request lines inherit the privacy of their parent order: private until the order is published,
-- and even then only the SANITIZED marketplace projection is exposed to other tenants. Server
-- services use the service role; RLS below denies the anon/authenticated roles outright so a direct
-- PostgREST read can never bypass the projection.
ALTER TABLE public.diaspora_import_order_request_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_import_order_request_lines FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.diaspora_import_order_request_lines FROM anon, authenticated;
GRANT ALL ON public.diaspora_import_order_request_lines TO service_role;

-- ---------------------------------------------------------------
-- Additive commercial quote terms (all NULLABLE — existing rows and callers unaffected).
-- ---------------------------------------------------------------
ALTER TABLE public.diaspora_import_quotes
  ADD COLUMN IF NOT EXISTS offered_quantity     INTEGER,
  ADD COLUMN IF NOT EXISTS unit_price           NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS lead_time_days       INTEGER,
  ADD COLUMN IF NOT EXISTS shipping_included    BOOLEAN,
  ADD COLUMN IF NOT EXISTS offered_condition    TEXT,
  ADD COLUMN IF NOT EXISTS offered_description  TEXT,
  ADD COLUMN IF NOT EXISTS stock_item_id        UUID REFERENCES public.diaspora_stock_items(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.diaspora_import_quotes.shipping_included IS
  'TRUE = shipping in the quoted total, FALSE = excluded, NULL = supplier did not say. NULL must render as "Not provided", never as "excluded".';
COMMENT ON COLUMN public.diaspora_import_quotes.lead_time_days IS
  'Supplier-stated dispatch lead time in days. Seller-stated, never CarUp-verified.';

-- +migrate Down
DROP INDEX IF EXISTS idx_diaspora_request_lines_part;
DROP INDEX IF EXISTS idx_diaspora_request_lines_order;
DROP TABLE IF EXISTS public.diaspora_import_order_request_lines;

-- The quote columns are dropped in the same statement order they were added. This IS safe to
-- reverse: they are additive, nullable and carry no data another table depends on.
ALTER TABLE public.diaspora_import_quotes
  DROP COLUMN IF EXISTS stock_item_id,
  DROP COLUMN IF EXISTS offered_description,
  DROP COLUMN IF EXISTS offered_condition,
  DROP COLUMN IF EXISTS shipping_included,
  DROP COLUMN IF EXISTS lead_time_days,
  DROP COLUMN IF EXISTS unit_price,
  DROP COLUMN IF EXISTS offered_quantity;
