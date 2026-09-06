-- +migrate Up
-- =============================================================
-- Trade OS T4 — the ONE relationship the existing authorities could not express.
--
-- T2 owns procurement (diaspora_import_orders), T3 owns logistics
-- (diaspora_logistics_requests). Both already carry their own identity, participants, offers,
-- cargo, documents and audit. The only fact neither can state is:
--
--     "this shipping request is moving the goods from that purchase."
--
-- That is a single EDGE, not an entity, so it is a single nullable foreign key on the authority
-- that already owns the shipping request. No trade_transactions table is introduced: such a table
-- would duplicate an identity these two already provide, and every column it held would be a
-- second copy of a canonical row.
--
-- NULL is the normal case. A logistics-origin transaction — someone moving cargo they already own
-- — has no procurement order and must never have one manufactured for it. The column is set ONLY
-- when a buyer continues an awarded procurement into logistics, which is what lets the shipping
-- request inherit the purchased item facts instead of asking for them again.
--
-- This column owns the edge and nothing else. Quote totals, cargo measurements, container
-- capacity, reservation state, messages, documents and shipment state all remain canonical where
-- they already live; the passport reads them and never copies them.
-- =============================================================

ALTER TABLE public.diaspora_logistics_requests
  ADD COLUMN IF NOT EXISTS import_order_id uuid NULL
    REFERENCES public.diaspora_import_orders(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.diaspora_logistics_requests.import_order_id IS
  'T4 continuation edge: the procurement order whose goods this shipping request moves. NULL for '
  'logistics-origin requests (cargo the requester already owns) — never manufacture an order to '
  'fill it. Owns the edge only; all procurement facts stay canonical in diaspora_import_orders.';

-- Lookup: "does this order already have a shipping continuation?" is asked on every procurement
-- passport read, so it must not be a sequential scan.
CREATE INDEX IF NOT EXISTS idx_diaspora_logistics_requests_import_order
  ON public.diaspora_logistics_requests (import_order_id)
  WHERE deleted_at IS NULL AND import_order_id IS NOT NULL;

-- Idempotency enforced by the DATABASE, not by a disabled React button (§9).
--
-- A double-click, a retry after a network timeout, a refresh mid-request or two concurrent tabs
-- must all converge on exactly ONE live continuation per order. The loser of the race gets a
-- unique violation, which the service translates into an idempotent replay of the winner.
--
-- Partial, and deliberately so: it constrains only LIVE continuations. The terminal states are
-- exactly CANCELLED and CLOSED (the table's own CHECK admits DRAFT, OPEN_FOR_QUOTES, AWARDED,
-- CLOSED, CANCELLED — there is no COMPLETED). A cancelled or closed shipping request must not
-- permanently prevent the buyer from arranging shipping again for the same order. This mirrors
-- T3's proven uq_diaspora_cargo_reservation_live_logistics_request.
CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_logistics_request_live_import_order
  ON public.diaspora_logistics_requests (import_order_id)
  WHERE deleted_at IS NULL
    AND import_order_id IS NOT NULL
    AND status NOT IN ('CANCELLED', 'CLOSED');

-- +migrate Down
DROP INDEX IF EXISTS public.uq_diaspora_logistics_request_live_import_order;
DROP INDEX IF EXISTS public.idx_diaspora_logistics_requests_import_order;
ALTER TABLE public.diaspora_logistics_requests DROP COLUMN IF EXISTS import_order_id;
