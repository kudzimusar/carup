-- GARAGE-1.0-OPS06 — parts and stock, converged onto the ONE existing parts master.
--
-- mechanic_parts stays THE parts master (CV01 forbids a parallel one). This migration:
--   1. extends it ADDITIVELY and tolerates both historical shapes (006 and 009 + convergence);
--   2. makes unrecorded values NULL instead of fabricating 0 / 5 / 0.00;
--   3. adds an append-only stock-movement ledger (the only way a quantity changes);
--   4. links consumption to the ACTUAL service record (never to an estimate).
--
-- PartSentry stays the provenance authority: a usage row may reference an attested partsentry_log
-- (validated against the same work order) but PartSentry does not track quantity or cost.
-- Supplier stays free text exactly as stated; no supplier registry or procurement is implied.
-- +migrate Up

ALTER TABLE mechanic_parts
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS sell_price NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS price_currency TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS min_stock INTEGER,
  ADD COLUMN IF NOT EXISTS supplier TEXT;

-- Unknown is not zero: a part created without a count, a price or a threshold says so.
ALTER TABLE mechanic_parts ALTER COLUMN unit_price DROP NOT NULL;
ALTER TABLE mechanic_parts ALTER COLUMN stock_level DROP NOT NULL;
ALTER TABLE mechanic_parts ALTER COLUMN stock_level DROP DEFAULT;
ALTER TABLE mechanic_parts ALTER COLUMN min_stock DROP NOT NULL;
ALTER TABLE mechanic_parts ALTER COLUMN min_stock DROP DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'garage_ops06_part_stock_nonneg') THEN
    ALTER TABLE mechanic_parts ADD CONSTRAINT garage_ops06_part_stock_nonneg
      CHECK (stock_level IS NULL OR stock_level >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'garage_ops06_part_min_nonneg') THEN
    ALTER TABLE mechanic_parts ADD CONSTRAINT garage_ops06_part_min_nonneg
      CHECK (min_stock IS NULL OR min_stock >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'garage_ops06_part_money_truth') THEN
    ALTER TABLE mechanic_parts ADD CONSTRAINT garage_ops06_part_money_truth CHECK (
      (price_currency IS NULL OR (price_currency ~ '^[A-Z]{3}$' AND garage_ops04_currency_scale(price_currency) IS NOT NULL))
      AND ((unit_cost IS NULL AND sell_price IS NULL) OR price_currency IS NOT NULL)
      AND (unit_cost IS NULL OR unit_cost >= 0)
      AND (sell_price IS NULL OR sell_price >= 0)
    ) NOT VALID;
  END IF;
  -- Legacy rows may already violate the new rules; enforce on every new write regardless, and
  -- fully validate only where the existing data allows it.
  BEGIN ALTER TABLE mechanic_parts VALIDATE CONSTRAINT garage_ops06_part_stock_nonneg; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN ALTER TABLE mechanic_parts VALIDATE CONSTRAINT garage_ops06_part_min_nonneg; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN ALTER TABLE mechanic_parts VALIDATE CONSTRAINT garage_ops06_part_money_truth; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- Composite-FK target and the SKU rule. The unique index is created only where existing data permits;
-- the RPC enforces the same rule under the part-creation lock either way.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mechanic_parts_id_tenant ON mechanic_parts(id, tenant_id);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM mechanic_parts WHERE tenant_id IS NOT NULL
     GROUP BY tenant_id, lower(btrim(sku)) HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_mechanic_parts_tenant_sku_ci
      ON mechanic_parts(tenant_id, lower(btrim(sku))) WHERE tenant_id IS NOT NULL;
  ELSE
    RAISE WARNING 'GARAGE_OPS06: duplicate SKUs exist; case-insensitive SKU uniqueness is enforced by the RPC only';
  END IF;
END $$;

-- ─────────────────────────── the movement ledger ───────────────────────────

CREATE TABLE IF NOT EXISTS garage_stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- a total order for the ledger: created_at can tie within one clock tick, a UUID has no order
  seq BIGINT GENERATED ALWAYS AS IDENTITY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  part_id UUID NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('opening','receipt','consumption','adjustment','reversal')),
  quantity_delta INTEGER NOT NULL,
  balance_before INTEGER NOT NULL CHECK (balance_before >= 0),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  reason_code TEXT CHECK (reason_code IS NULL OR char_length(reason_code) <= 60),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 120),
  work_order_id UUID,
  service_record_id UUID REFERENCES service_records(id) ON DELETE RESTRICT,
  reverses_movement_id UUID,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT garage_ops06_movement_part_fk
    FOREIGN KEY (part_id, tenant_id) REFERENCES mechanic_parts(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_ops06_movement_work_order_fk
    FOREIGN KEY (work_order_id, tenant_id) REFERENCES mechanic_work_orders(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_ops06_movement_arithmetic CHECK (balance_after = balance_before + quantity_delta),
  CONSTRAINT garage_ops06_movement_sign CHECK (
    (movement_type = 'opening')
    OR (movement_type = 'receipt' AND quantity_delta > 0)
    OR (movement_type = 'consumption' AND quantity_delta < 0)
    OR (movement_type = 'adjustment' AND quantity_delta <> 0)
    OR (movement_type = 'reversal' AND quantity_delta > 0)
  ),
  CONSTRAINT garage_ops06_movement_consumption_context CHECK (
    movement_type <> 'consumption' OR (work_order_id IS NOT NULL AND service_record_id IS NOT NULL)
  ),
  CONSTRAINT garage_ops06_movement_reversal_context CHECK (
    (movement_type = 'reversal') = (reverses_movement_id IS NOT NULL)
  ),
  CONSTRAINT garage_ops06_movement_adjustment_reason CHECK (
    movement_type <> 'adjustment' OR (reason_code IS NOT NULL AND char_length(btrim(reason_code)) > 0)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_ops06_movement_idempotency ON garage_stock_movements(tenant_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_ops06_movement_id_tenant ON garage_stock_movements(id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_ops06_one_reversal_per_movement ON garage_stock_movements(reverses_movement_id) WHERE reverses_movement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_garage_ops06_movements_part ON garage_stock_movements(tenant_id, part_id, seq DESC);
CREATE INDEX IF NOT EXISTS idx_garage_ops06_movements_work_order ON garage_stock_movements(work_order_id) WHERE work_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS garage_service_part_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  service_record_id UUID NOT NULL REFERENCES service_records(id) ON DELETE RESTRICT,
  work_order_id UUID NOT NULL,
  part_id UUID NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  movement_id UUID NOT NULL,
  partsentry_log_id BIGINT REFERENCES partsentry_logs(id) ON DELETE RESTRICT,
  -- Snapshots: closeout stays true even if the part master is later renamed or re-priced.
  part_name_snapshot TEXT NOT NULL,
  part_sku_snapshot TEXT NOT NULL,
  unit_cost_snapshot NUMERIC(14,2),
  sell_price_snapshot NUMERIC(14,2),
  price_currency_snapshot TEXT,
  reversal_movement_id UUID,
  reversed_at TIMESTAMPTZ,
  reversed_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT garage_ops06_usage_part_fk
    FOREIGN KEY (part_id, tenant_id) REFERENCES mechanic_parts(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_ops06_usage_work_order_fk
    FOREIGN KEY (work_order_id, tenant_id) REFERENCES mechanic_work_orders(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_ops06_usage_movement_fk
    FOREIGN KEY (movement_id, tenant_id) REFERENCES garage_stock_movements(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_ops06_usage_one_movement UNIQUE (movement_id),
  CONSTRAINT garage_ops06_usage_reversal_truth CHECK (
    (reversed_at IS NOT NULL) = (reversal_movement_id IS NOT NULL AND reversed_by_user_id IS NOT NULL)
  ),
  CONSTRAINT garage_ops06_usage_money_truth CHECK (
    (unit_cost_snapshot IS NULL AND sell_price_snapshot IS NULL) OR price_currency_snapshot IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS idx_garage_ops06_usage_record ON garage_service_part_usage(service_record_id);
CREATE INDEX IF NOT EXISTS idx_garage_ops06_usage_work_order ON garage_service_part_usage(tenant_id, work_order_id);
CREATE INDEX IF NOT EXISTS idx_garage_ops06_usage_part ON garage_service_part_usage(tenant_id, part_id);

-- ─────────────────────────── guards ───────────────────────────

CREATE OR REPLACE FUNCTION garage_ops06_movements_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN RAISE EXCEPTION 'GARAGE_OPS06_MOVEMENTS_APPEND_ONLY'; END $$;
DROP TRIGGER IF EXISTS trg_garage_ops06_movements_append_only ON garage_stock_movements;
CREATE TRIGGER trg_garage_ops06_movements_append_only
  BEFORE UPDATE OR DELETE ON garage_stock_movements
  FOR EACH ROW EXECUTE FUNCTION garage_ops06_movements_append_only();

-- Usage rows are history: only the reversal stamp may be added, once.
CREATE OR REPLACE FUNCTION garage_ops06_guard_usage()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'GARAGE_OPS06_USAGE_IS_HISTORY'; END IF;
  IF OLD.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'GARAGE_OPS06_USAGE_ALREADY_REVERSED'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.service_record_id IS DISTINCT FROM OLD.service_record_id OR NEW.work_order_id IS DISTINCT FROM OLD.work_order_id
     OR NEW.part_id IS DISTINCT FROM OLD.part_id OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.movement_id IS DISTINCT FROM OLD.movement_id OR NEW.partsentry_log_id IS DISTINCT FROM OLD.partsentry_log_id
     OR NEW.part_name_snapshot IS DISTINCT FROM OLD.part_name_snapshot OR NEW.part_sku_snapshot IS DISTINCT FROM OLD.part_sku_snapshot
     OR NEW.unit_cost_snapshot IS DISTINCT FROM OLD.unit_cost_snapshot OR NEW.sell_price_snapshot IS DISTINCT FROM OLD.sell_price_snapshot
     OR NEW.price_currency_snapshot IS DISTINCT FROM OLD.price_currency_snapshot
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'GARAGE_OPS06_USAGE_IS_HISTORY';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_garage_ops06_guard_usage ON garage_service_part_usage;
CREATE TRIGGER trg_garage_ops06_guard_usage
  BEFORE UPDATE OR DELETE ON garage_service_part_usage
  FOR EACH ROW EXECUTE FUNCTION garage_ops06_guard_usage();

-- A quantity changes through a ledger movement or not at all.
CREATE OR REPLACE FUNCTION garage_ops06_guard_stock_write()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF COALESCE(current_setting('garage.ops06_stock_write', true), '') <> 'on' THEN
    RAISE EXCEPTION 'GARAGE_OPS06_STOCK_WRITE_VIA_MOVEMENT';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_garage_ops06_guard_stock_write ON mechanic_parts;
CREATE TRIGGER trg_garage_ops06_guard_stock_write
  BEFORE UPDATE OF stock_level ON mechanic_parts
  FOR EACH ROW
  WHEN (NEW.stock_level IS DISTINCT FROM OLD.stock_level)
  EXECUTE FUNCTION garage_ops06_guard_stock_write();

-- ─────────────────────────── internals ───────────────────────────

CREATE OR REPLACE FUNCTION garage_ops06_log(
  p_tenant_id UUID, p_event TEXT, p_actor_user_id TEXT, p_new JSONB, p_vin TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM users WHERE id = p_actor_user_id;
  INSERT INTO trust_audit_events (event_type, vin, trust_fact, new_value, actor_user_id, actor_role, actor_tenant_id, actor_type, source_route)
  VALUES ('GARAGE_STOCK_' || upper(p_event), p_vin, 'service_relationship', p_new, p_actor_user_id, v_role, p_tenant_id::text, 'user', '/api/garage/stock');
END $$;

-- Apply ONE movement to a part. The caller holds (or this takes) the part row lock; the quantity,
-- the ledger row and the arithmetic are one statement block, so they cannot disagree.
CREATE OR REPLACE FUNCTION garage_ops06_apply_movement(
  p_tenant_id UUID, p_part_id UUID, p_type TEXT, p_delta INTEGER, p_reason TEXT, p_note TEXT,
  p_key TEXT, p_actor_user_id TEXT, p_work_order_id UUID, p_service_record_id UUID, p_reverses UUID
) RETURNS garage_stock_movements
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_part mechanic_parts%ROWTYPE;
  v_before INTEGER;
  v_after INTEGER;
  v_row garage_stock_movements%ROWTYPE;
BEGIN
  SELECT * INTO v_part FROM mechanic_parts WHERE id = p_part_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS06_PART_NOT_FOUND'; END IF;
  IF p_type <> 'opening' AND v_part.stock_level IS NULL THEN RAISE EXCEPTION 'GARAGE_OPS06_STOCK_UNKNOWN'; END IF;
  v_before := COALESCE(v_part.stock_level, 0);
  v_after := v_before + p_delta;
  IF v_after < 0 THEN
    RAISE EXCEPTION 'GARAGE_OPS06_INSUFFICIENT_STOCK' USING DETAIL = format('available=%s requested=%s', v_before, -p_delta);
  END IF;

  PERFORM set_config('garage.ops06_stock_write', 'on', true);
  UPDATE mechanic_parts SET stock_level = v_after, updated_at = NOW() WHERE id = v_part.id;
  PERFORM set_config('garage.ops06_stock_write', '', true);

  INSERT INTO garage_stock_movements (
    tenant_id, part_id, movement_type, quantity_delta, balance_before, balance_after, reason_code, note,
    idempotency_key, work_order_id, service_record_id, reverses_movement_id, actor_user_id
  ) VALUES (
    p_tenant_id, p_part_id, p_type, p_delta, v_before, v_after, NULLIF(btrim(p_reason), ''), NULLIF(btrim(p_note), ''),
    p_key, p_work_order_id, p_service_record_id, p_reverses, p_actor_user_id
  ) RETURNING * INTO v_row;
  RETURN v_row;
END $$;

-- ─────────────────────────── stock management (garage admin) ───────────────────────────

CREATE OR REPLACE FUNCTION garage_ops06_create_part(
  p_tenant_id UUID, p_name TEXT, p_sku TEXT, p_opening_quantity INTEGER, p_min_stock INTEGER,
  p_supplier TEXT, p_unit_cost NUMERIC, p_sell_price NUMERIC, p_price_currency TEXT,
  p_actor_user_id TEXT, p_idempotency_key TEXT
) RETURNS mechanic_parts
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_part mechanic_parts%ROWTYPE;
  v_name TEXT := btrim(COALESCE(p_name, ''));
  v_sku TEXT := btrim(COALESCE(p_sku, ''));
  v_scale INTEGER;
  v_existing garage_stock_movements%ROWTYPE;
BEGIN
  PERFORM garage_ops03_assert_admin(p_tenant_id, p_actor_user_id);
  IF char_length(v_name) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'GARAGE_OPS06_NAME_INVALID'; END IF;
  IF char_length(v_sku) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'GARAGE_OPS06_SKU_INVALID'; END IF;
  IF p_opening_quantity IS NULL OR p_opening_quantity < 0 THEN RAISE EXCEPTION 'GARAGE_OPS06_QUANTITY_INVALID'; END IF;
  IF p_min_stock IS NOT NULL AND p_min_stock < 0 THEN RAISE EXCEPTION 'GARAGE_OPS06_THRESHOLD_INVALID'; END IF;
  IF (p_unit_cost IS NOT NULL OR p_sell_price IS NOT NULL) AND p_price_currency IS NULL THEN RAISE EXCEPTION 'GARAGE_OPS06_CURRENCY_REQUIRED'; END IF;
  IF p_price_currency IS NOT NULL THEN
    v_scale := garage_ops04_currency_scale(p_price_currency);
    IF v_scale IS NULL THEN RAISE EXCEPTION 'GARAGE_OPS06_CURRENCY_UNSUPPORTED'; END IF;
    IF (p_unit_cost IS NOT NULL AND (p_unit_cost < 0 OR p_unit_cost <> round(p_unit_cost, v_scale)))
       OR (p_sell_price IS NOT NULL AND (p_sell_price < 0 OR p_sell_price <> round(p_sell_price, v_scale))) THEN
      RAISE EXCEPTION 'GARAGE_OPS06_AMOUNT_INVALID';
    END IF;
  END IF;

  -- one creation at a time per garage + SKU, whatever the unique index situation is
  PERFORM pg_advisory_xact_lock(hashtextextended('garage_ops06_sku:' || p_tenant_id::text || ':' || lower(v_sku), 0));
  SELECT * INTO v_existing FROM garage_stock_movements WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    SELECT * INTO v_part FROM mechanic_parts WHERE id = v_existing.part_id AND tenant_id = p_tenant_id;
    RETURN v_part;
  END IF;
  IF EXISTS (SELECT 1 FROM mechanic_parts WHERE tenant_id = p_tenant_id AND lower(btrim(sku)) = lower(v_sku)) THEN
    RAISE EXCEPTION 'GARAGE_OPS06_SKU_EXISTS';
  END IF;

  INSERT INTO mechanic_parts (tenant_id, name, sku, stock_level, min_stock, supplier, unit_cost, sell_price, price_currency, is_active, created_by_user_id)
  VALUES (p_tenant_id, v_name, v_sku, 0, p_min_stock, NULLIF(btrim(p_supplier), ''), p_unit_cost, p_sell_price, p_price_currency, true, p_actor_user_id)
  RETURNING * INTO v_part;
  PERFORM garage_ops06_apply_movement(p_tenant_id, v_part.id, 'opening', p_opening_quantity, 'opening_count', NULL,
    p_idempotency_key, p_actor_user_id, NULL, NULL, NULL);
  PERFORM garage_ops06_log(p_tenant_id, 'part_created', p_actor_user_id,
    jsonb_build_object('part_id', v_part.id, 'sku', v_sku, 'opening_quantity', p_opening_quantity));
  SELECT * INTO v_part FROM mechanic_parts WHERE id = v_part.id;
  RETURN v_part;
END $$;

-- Metadata only. The quantity is never editable here, and the SKU is the part's identity.
CREATE OR REPLACE FUNCTION garage_ops06_update_part(
  p_tenant_id UUID, p_part_id UUID, p_patch JSONB, p_actor_user_id TEXT
) RETURNS mechanic_parts
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_part mechanic_parts%ROWTYPE;
  v_name TEXT; v_supplier TEXT; v_min INTEGER; v_cost NUMERIC; v_sell NUMERIC; v_currency TEXT; v_active BOOLEAN;
  v_scale INTEGER;
BEGIN
  PERFORM garage_ops03_assert_admin(p_tenant_id, p_actor_user_id);
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'GARAGE_OPS06_PATCH_INVALID'; END IF;
  SELECT * INTO v_part FROM mechanic_parts WHERE id = p_part_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS06_PART_NOT_FOUND'; END IF;

  v_name := CASE WHEN p_patch ? 'name' THEN btrim(COALESCE(p_patch->>'name', '')) ELSE v_part.name END;
  v_supplier := CASE WHEN p_patch ? 'supplier' THEN NULLIF(btrim(COALESCE(p_patch->>'supplier', '')), '') ELSE v_part.supplier END;
  v_min := CASE WHEN p_patch ? 'min_stock' THEN NULLIF(btrim(COALESCE(p_patch->>'min_stock', '')), '')::integer ELSE v_part.min_stock END;
  v_cost := CASE WHEN p_patch ? 'unit_cost' THEN NULLIF(btrim(COALESCE(p_patch->>'unit_cost', '')), '')::numeric ELSE v_part.unit_cost END;
  v_sell := CASE WHEN p_patch ? 'sell_price' THEN NULLIF(btrim(COALESCE(p_patch->>'sell_price', '')), '')::numeric ELSE v_part.sell_price END;
  v_currency := CASE WHEN p_patch ? 'price_currency' THEN NULLIF(btrim(COALESCE(p_patch->>'price_currency', '')), '') ELSE v_part.price_currency END;
  v_active := CASE WHEN p_patch ? 'is_active' THEN (p_patch->>'is_active')::boolean ELSE v_part.is_active END;

  IF char_length(v_name) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'GARAGE_OPS06_NAME_INVALID'; END IF;
  IF v_min IS NOT NULL AND v_min < 0 THEN RAISE EXCEPTION 'GARAGE_OPS06_THRESHOLD_INVALID'; END IF;
  IF (v_cost IS NOT NULL OR v_sell IS NOT NULL) AND v_currency IS NULL THEN RAISE EXCEPTION 'GARAGE_OPS06_CURRENCY_REQUIRED'; END IF;
  IF v_currency IS NOT NULL THEN
    v_scale := garage_ops04_currency_scale(v_currency);
    IF v_scale IS NULL THEN RAISE EXCEPTION 'GARAGE_OPS06_CURRENCY_UNSUPPORTED'; END IF;
    IF (v_cost IS NOT NULL AND (v_cost < 0 OR v_cost <> round(v_cost, v_scale)))
       OR (v_sell IS NOT NULL AND (v_sell < 0 OR v_sell <> round(v_sell, v_scale))) THEN
      RAISE EXCEPTION 'GARAGE_OPS06_AMOUNT_INVALID';
    END IF;
  END IF;

  UPDATE mechanic_parts SET name = v_name, supplier = v_supplier, min_stock = v_min, unit_cost = v_cost,
         sell_price = v_sell, price_currency = v_currency, is_active = v_active, updated_at = NOW()
   WHERE id = v_part.id;
  PERFORM garage_ops06_log(p_tenant_id, 'part_updated', p_actor_user_id,
    jsonb_build_object('part_id', v_part.id, 'fields', (SELECT jsonb_agg(k) FROM jsonb_object_keys(p_patch) k)));
  SELECT * INTO v_part FROM mechanic_parts WHERE id = v_part.id;
  RETURN v_part;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'GARAGE_OPS06_PATCH_INVALID';
END $$;

CREATE OR REPLACE FUNCTION garage_ops06_receive_stock(
  p_tenant_id UUID, p_part_id UUID, p_quantity INTEGER, p_reason TEXT, p_note TEXT,
  p_actor_user_id TEXT, p_idempotency_key TEXT
) RETURNS garage_stock_movements
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_row garage_stock_movements%ROWTYPE;
BEGIN
  PERFORM garage_ops03_assert_admin(p_tenant_id, p_actor_user_id);
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'GARAGE_OPS06_QUANTITY_INVALID'; END IF;
  PERFORM 1 FROM mechanic_parts WHERE id = p_part_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS06_PART_NOT_FOUND'; END IF;
  SELECT * INTO v_row FROM garage_stock_movements WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_row.part_id <> p_part_id OR v_row.movement_type <> 'receipt' OR v_row.quantity_delta <> p_quantity THEN
      RAISE EXCEPTION 'GARAGE_OPS06_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN v_row;
  END IF;
  v_row := garage_ops06_apply_movement(p_tenant_id, p_part_id, 'receipt', p_quantity, COALESCE(NULLIF(btrim(p_reason), ''), 'received'),
    p_note, p_idempotency_key, p_actor_user_id, NULL, NULL, NULL);
  PERFORM garage_ops06_log(p_tenant_id, 'received', p_actor_user_id,
    jsonb_build_object('part_id', p_part_id, 'quantity', p_quantity, 'balance_after', v_row.balance_after));
  RETURN v_row;
END $$;

-- A stocktake: the garage states what is physically on the shelf. The first count of a part whose
-- quantity was never ledgered (legacy) becomes its 'opening' baseline; later counts are adjustments.
CREATE OR REPLACE FUNCTION garage_ops06_count_stock(
  p_tenant_id UUID, p_part_id UUID, p_counted_quantity INTEGER, p_reason TEXT, p_note TEXT,
  p_actor_user_id TEXT, p_idempotency_key TEXT
) RETURNS garage_stock_movements
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_part mechanic_parts%ROWTYPE;
  v_row garage_stock_movements%ROWTYPE;
  v_has_ledger BOOLEAN;
  v_type TEXT;
BEGIN
  PERFORM garage_ops03_assert_admin(p_tenant_id, p_actor_user_id);
  IF p_counted_quantity IS NULL OR p_counted_quantity < 0 THEN RAISE EXCEPTION 'GARAGE_OPS06_QUANTITY_INVALID'; END IF;
  SELECT * INTO v_part FROM mechanic_parts WHERE id = p_part_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS06_PART_NOT_FOUND'; END IF;
  SELECT * INTO v_row FROM garage_stock_movements WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_row.part_id <> p_part_id THEN RAISE EXCEPTION 'GARAGE_OPS06_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN v_row;
  END IF;
  SELECT EXISTS (SELECT 1 FROM garage_stock_movements WHERE tenant_id = p_tenant_id AND part_id = p_part_id) INTO v_has_ledger;
  v_type := CASE WHEN v_has_ledger THEN 'adjustment' ELSE 'opening' END;
  IF v_has_ledger AND p_counted_quantity = COALESCE(v_part.stock_level, 0) THEN RAISE EXCEPTION 'GARAGE_OPS06_NO_CHANGE'; END IF;
  IF v_has_ledger AND NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'GARAGE_OPS06_REASON_REQUIRED'; END IF;
  v_row := garage_ops06_apply_movement(p_tenant_id, p_part_id, v_type, p_counted_quantity - COALESCE(v_part.stock_level, 0),
    COALESCE(NULLIF(btrim(p_reason), ''), 'first_count'), p_note, p_idempotency_key, p_actor_user_id, NULL, NULL, NULL);
  PERFORM garage_ops06_log(p_tenant_id, 'counted', p_actor_user_id,
    jsonb_build_object('part_id', p_part_id, 'type', v_type, 'delta', v_row.quantity_delta, 'balance_after', v_row.balance_after));
  RETURN v_row;
END $$;

-- ─────────────────────────── consumption (garage workspace) ───────────────────────────

CREATE OR REPLACE FUNCTION garage_ops06_consume_for_service(
  p_tenant_id UUID, p_service_record_id UUID, p_part_id UUID, p_quantity INTEGER,
  p_partsentry_log_id BIGINT, p_actor_user_id TEXT, p_idempotency_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_rec service_records%ROWTYPE;
  v_wo mechanic_work_orders%ROWTYPE;
  v_case_status TEXT;
  v_part mechanic_parts%ROWTYPE;
  v_mv garage_stock_movements%ROWTYPE;
  v_usage garage_service_part_usage%ROWTYPE;
  v_log RECORD;
BEGIN
  PERFORM garage_ops05_assert_workspace(p_tenant_id, p_actor_user_id);
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'GARAGE_OPS06_QUANTITY_INVALID'; END IF;

  SELECT * INTO v_rec FROM service_records WHERE id = p_service_record_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS06_SERVICE_RECORD_NOT_FOUND'; END IF;

  -- lock order: work order (shared) -> part (exclusive). Completion takes the work order exclusively,
  -- so consumption either lands before "complete" or is refused after it.
  SELECT * INTO v_wo FROM mechanic_work_orders WHERE id = v_rec.work_order_id AND tenant_id = p_tenant_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS06_SERVICE_RECORD_NOT_FOUND'; END IF;
  IF garage_ops04_is_terminal_work_order_status(v_wo.status) THEN RAISE EXCEPTION 'GARAGE_OPS05_WORK_ORDER_TERMINAL'; END IF;
  IF v_wo.owner_authorization <> 'authorized' THEN
    RAISE EXCEPTION 'GARAGE_OPS05_NOT_AUTHORIZED' USING DETAIL = v_wo.owner_authorization;
  END IF;
  IF v_wo.service_case_id IS NOT NULL THEN
    SELECT status INTO v_case_status FROM service_cases WHERE id = v_wo.service_case_id;
    IF v_case_status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'GARAGE_OPS05_WORK_NOT_STARTED'; END IF;
  END IF;

  SELECT * INTO v_part FROM mechanic_parts WHERE id = p_part_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS06_PART_NOT_FOUND'; END IF;

  SELECT * INTO v_mv FROM garage_stock_movements WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    SELECT * INTO v_usage FROM garage_service_part_usage WHERE movement_id = v_mv.id;
    IF NOT FOUND OR v_mv.part_id <> p_part_id OR v_mv.service_record_id <> p_service_record_id OR -v_mv.quantity_delta <> p_quantity THEN
      RAISE EXCEPTION 'GARAGE_OPS06_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN jsonb_build_object('usage_id', v_usage.id, 'movement_id', v_mv.id, 'part_id', v_part.id,
      'quantity', p_quantity, 'balance_after', v_mv.balance_after, 'replayed', true);
  END IF;

  IF NOT v_part.is_active THEN RAISE EXCEPTION 'GARAGE_OPS06_PART_INACTIVE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM garage_stock_movements WHERE tenant_id = p_tenant_id AND part_id = p_part_id) THEN
    RAISE EXCEPTION 'GARAGE_OPS06_STOCK_NOT_COUNTED';
  END IF;

  IF p_partsentry_log_id IS NOT NULL THEN
    SELECT id, vin, tenant_id, work_order_id INTO v_log FROM partsentry_logs WHERE id = p_partsentry_log_id;
    IF NOT FOUND OR v_log.work_order_id IS DISTINCT FROM v_wo.id OR v_log.vin IS DISTINCT FROM v_rec.vin
       OR (v_log.tenant_id IS NOT NULL AND v_log.tenant_id <> p_tenant_id) THEN
      RAISE EXCEPTION 'GARAGE_OPS06_PARTSENTRY_MISMATCH';
    END IF;
  END IF;

  v_mv := garage_ops06_apply_movement(p_tenant_id, p_part_id, 'consumption', -p_quantity, 'used_on_job', NULL,
    p_idempotency_key, p_actor_user_id, v_wo.id, v_rec.id, NULL);

  INSERT INTO garage_service_part_usage (
    tenant_id, service_record_id, work_order_id, part_id, quantity, movement_id, partsentry_log_id,
    part_name_snapshot, part_sku_snapshot, unit_cost_snapshot, sell_price_snapshot, price_currency_snapshot, created_by_user_id
  ) VALUES (
    p_tenant_id, v_rec.id, v_wo.id, v_part.id, p_quantity, v_mv.id, p_partsentry_log_id,
    v_part.name, v_part.sku, v_part.unit_cost, v_part.sell_price, v_part.price_currency, p_actor_user_id
  ) RETURNING * INTO v_usage;

  IF p_partsentry_log_id IS NOT NULL THEN
    INSERT INTO service_record_parts (service_record_id, partsentry_log_id)
    VALUES (v_rec.id, p_partsentry_log_id) ON CONFLICT (service_record_id, partsentry_log_id) DO NOTHING;
  END IF;

  PERFORM garage_ops06_log(p_tenant_id, 'consumed', p_actor_user_id,
    jsonb_build_object('part_id', v_part.id, 'sku', v_part.sku, 'quantity', p_quantity, 'balance_after', v_mv.balance_after,
                       'service_record_id', v_rec.id, 'work_order_id', v_wo.id), v_rec.vin);

  RETURN jsonb_build_object('usage_id', v_usage.id, 'movement_id', v_mv.id, 'part_id', v_part.id,
    'quantity', p_quantity, 'balance_after', v_mv.balance_after, 'replayed', false);
END $$;

-- Undo a mistaken usage while the job is still open: a REVERSAL movement puts the quantity back and
-- the usage is stamped reversed. Neither the original movement nor the usage row is rewritten.
CREATE OR REPLACE FUNCTION garage_ops06_reverse_usage(
  p_tenant_id UUID, p_usage_id UUID, p_reason TEXT, p_actor_user_id TEXT, p_idempotency_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_probe garage_service_part_usage%ROWTYPE;
  v_usage garage_service_part_usage%ROWTYPE;
  v_wo mechanic_work_orders%ROWTYPE;
  v_mv garage_stock_movements%ROWTYPE;
BEGIN
  PERFORM garage_ops05_assert_workspace(p_tenant_id, p_actor_user_id);
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'GARAGE_OPS06_REASON_REQUIRED'; END IF;
  SELECT * INTO v_probe FROM garage_service_part_usage WHERE id = p_usage_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS06_USAGE_NOT_FOUND'; END IF;

  SELECT * INTO v_wo FROM mechanic_work_orders WHERE id = v_probe.work_order_id AND tenant_id = p_tenant_id FOR SHARE;
  IF garage_ops04_is_terminal_work_order_status(v_wo.status) THEN RAISE EXCEPTION 'GARAGE_OPS05_WORK_ORDER_TERMINAL'; END IF;
  PERFORM 1 FROM mechanic_parts WHERE id = v_probe.part_id AND tenant_id = p_tenant_id FOR UPDATE;
  SELECT * INTO v_usage FROM garage_service_part_usage WHERE id = p_usage_id FOR UPDATE;
  IF v_usage.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'GARAGE_OPS06_USAGE_ALREADY_REVERSED'; END IF;

  v_mv := garage_ops06_apply_movement(p_tenant_id, v_usage.part_id, 'reversal', v_usage.quantity, p_reason, NULL,
    p_idempotency_key, p_actor_user_id, v_usage.work_order_id, v_usage.service_record_id, v_usage.movement_id);
  UPDATE garage_service_part_usage
     SET reversal_movement_id = v_mv.id, reversed_at = NOW(), reversed_by_user_id = p_actor_user_id
   WHERE id = v_usage.id;
  PERFORM garage_ops06_log(p_tenant_id, 'usage_reversed', p_actor_user_id,
    jsonb_build_object('usage_id', v_usage.id, 'part_id', v_usage.part_id, 'quantity', v_usage.quantity, 'balance_after', v_mv.balance_after));
  RETURN jsonb_build_object('usage_id', v_usage.id, 'reversal_movement_id', v_mv.id, 'balance_after', v_mv.balance_after);
END $$;

-- Read model: one row per part with whether its quantity has ever been counted into the ledger.
-- "Uncounted" is a legacy quantity nobody has stated against the shelf; it is shown, never trusted.
CREATE OR REPLACE FUNCTION garage_ops06_list_parts(p_tenant_id UUID, p_include_inactive BOOLEAN DEFAULT false)
RETURNS TABLE (
  id UUID, name TEXT, sku TEXT, stock_level INTEGER, min_stock INTEGER, supplier TEXT,
  unit_cost NUMERIC, sell_price NUMERIC, price_currency TEXT, legacy_unit_price NUMERIC,
  is_active BOOLEAN, counted BOOLEAN, last_movement_at TIMESTAMPTZ, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT p.id, p.name, p.sku, p.stock_level, p.min_stock, p.supplier, p.unit_cost, p.sell_price, p.price_currency,
         p.unit_price::numeric, p.is_active,
         EXISTS (SELECT 1 FROM garage_stock_movements m WHERE m.tenant_id = p.tenant_id AND m.part_id = p.id),
         (SELECT max(m.created_at) FROM garage_stock_movements m WHERE m.tenant_id = p.tenant_id AND m.part_id = p.id),
         p.created_at, p.updated_at
    FROM mechanic_parts p
   WHERE p.tenant_id = p_tenant_id AND (p_include_inactive OR p.is_active)
   ORDER BY lower(p.name), p.sku
$$;

-- ─────────────────────────── privacy ───────────────────────────

ALTER TABLE mechanic_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_stock_movements FORCE ROW LEVEL SECURITY;
ALTER TABLE garage_service_part_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_service_part_usage FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE garage_stock_movements, garage_service_part_usage FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE garage_stock_movements TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE garage_service_part_usage TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE mechanic_parts TO service_role;

REVOKE ALL ON FUNCTION
  garage_ops06_log(UUID,TEXT,TEXT,JSONB,TEXT),
  garage_ops06_apply_movement(UUID,UUID,TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,UUID,UUID,UUID),
  garage_ops06_create_part(UUID,TEXT,TEXT,INTEGER,INTEGER,TEXT,NUMERIC,NUMERIC,TEXT,TEXT,TEXT),
  garage_ops06_update_part(UUID,UUID,JSONB,TEXT),
  garage_ops06_receive_stock(UUID,UUID,INTEGER,TEXT,TEXT,TEXT,TEXT),
  garage_ops06_count_stock(UUID,UUID,INTEGER,TEXT,TEXT,TEXT,TEXT),
  garage_ops06_consume_for_service(UUID,UUID,UUID,INTEGER,BIGINT,TEXT,TEXT),
  garage_ops06_reverse_usage(UUID,UUID,TEXT,TEXT,TEXT),
  garage_ops06_list_parts(UUID,BOOLEAN)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  garage_ops06_log(UUID,TEXT,TEXT,JSONB,TEXT),
  garage_ops06_apply_movement(UUID,UUID,TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,UUID,UUID,UUID),
  garage_ops06_create_part(UUID,TEXT,TEXT,INTEGER,INTEGER,TEXT,NUMERIC,NUMERIC,TEXT,TEXT,TEXT),
  garage_ops06_update_part(UUID,UUID,JSONB,TEXT),
  garage_ops06_receive_stock(UUID,UUID,INTEGER,TEXT,TEXT,TEXT,TEXT),
  garage_ops06_count_stock(UUID,UUID,INTEGER,TEXT,TEXT,TEXT,TEXT),
  garage_ops06_consume_for_service(UUID,UUID,UUID,INTEGER,BIGINT,TEXT,TEXT),
  garage_ops06_reverse_usage(UUID,UUID,TEXT,TEXT,TEXT),
  garage_ops06_list_parts(UUID,BOOLEAN)
TO service_role;

-- +migrate Down
DROP FUNCTION IF EXISTS garage_ops06_list_parts(UUID,BOOLEAN);
DROP FUNCTION IF EXISTS garage_ops06_reverse_usage(UUID,UUID,TEXT,TEXT,TEXT);
DROP FUNCTION IF EXISTS garage_ops06_consume_for_service(UUID,UUID,UUID,INTEGER,BIGINT,TEXT,TEXT);
DROP FUNCTION IF EXISTS garage_ops06_count_stock(UUID,UUID,INTEGER,TEXT,TEXT,TEXT,TEXT);
DROP FUNCTION IF EXISTS garage_ops06_receive_stock(UUID,UUID,INTEGER,TEXT,TEXT,TEXT,TEXT);
DROP FUNCTION IF EXISTS garage_ops06_update_part(UUID,UUID,JSONB,TEXT);
DROP FUNCTION IF EXISTS garage_ops06_create_part(UUID,TEXT,TEXT,INTEGER,INTEGER,TEXT,NUMERIC,NUMERIC,TEXT,TEXT,TEXT);
DROP FUNCTION IF EXISTS garage_ops06_apply_movement(UUID,UUID,TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,UUID,UUID,UUID);
DROP FUNCTION IF EXISTS garage_ops06_log(UUID,TEXT,TEXT,JSONB,TEXT);
DROP TRIGGER IF EXISTS trg_garage_ops06_guard_stock_write ON mechanic_parts;
DROP FUNCTION IF EXISTS garage_ops06_guard_stock_write();
DROP TRIGGER IF EXISTS trg_garage_ops06_guard_usage ON garage_service_part_usage;
DROP FUNCTION IF EXISTS garage_ops06_guard_usage();
DROP TRIGGER IF EXISTS trg_garage_ops06_movements_append_only ON garage_stock_movements;
DROP FUNCTION IF EXISTS garage_ops06_movements_append_only();
DROP TABLE IF EXISTS garage_service_part_usage;
DROP TABLE IF EXISTS garage_stock_movements;
DROP INDEX IF EXISTS uq_mechanic_parts_tenant_sku_ci;
DROP INDEX IF EXISTS uq_mechanic_parts_id_tenant;
