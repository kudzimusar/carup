-- GARAGE-1.0-OPS04 — governed Garage estimates + customer decision converged onto the canonical
-- work-order authorization.
--
-- Authority model (nothing here is a second authority):
--   estimate                          = PROPOSED work and a proposed amount (this migration)
--   mechanic_work_orders.owner_authorization = the ONLY authorization state (OC-5A). An accepted
--     estimate does not carry its own "approved" flag; accepting an estimate CALLS
--     mechanic_work_order_decide_authorization() inside the same transaction.
--   service_records                   = work ACTUALLY performed (never copied from an estimate)
--
-- Money: every estimate carries an explicit currency (no default). A line without a price is
-- "not recorded" (NULL), never 0. Totals are derived by the database from stored lines; a sent
-- version freezes the total it was sent with.
-- +migrate Up

-- Composite-FK target so an estimate can only point at a work order of ITS OWN tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mechanic_work_orders_id_tenant
  ON mechanic_work_orders(id, tenant_id);

-- Minor-unit scale per currency. NULL = a currency this table cannot store exactly (3-decimal
-- currencies, and anything that is not a 3-letter code): such amounts are refused, never rounded.
CREATE OR REPLACE FUNCTION garage_ops04_currency_scale(p_currency TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$' THEN NULL
    WHEN p_currency IN ('BHD','IQD','JOD','KWD','LYD','OMR','TND','CLF','UYW') THEN NULL
    WHEN p_currency IN ('BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','UYI','VND','VUV','XAF','XOF','XPF') THEN 0
    ELSE 2
  END
$$;

CREATE TABLE IF NOT EXISTS garage_estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  service_case_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('draft','sent','accepted','declined','superseded','cancelled')),
  -- Explicit, never defaulted.
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$' AND garage_ops04_currency_scale(currency) IS NOT NULL),
  -- Visible to the customer once sent. internal_note never leaves the Garage.
  customer_note TEXT CHECK (customer_note IS NULL OR char_length(customer_note) <= 2000),
  internal_note TEXT CHECK (internal_note IS NULL OR char_length(internal_note) <= 2000),
  valid_until TIMESTAMPTZ,
  -- Frozen at send; NULL while a draft.
  sent_total_amount NUMERIC(14,2) CHECK (sent_total_amount IS NULL OR sent_total_amount >= 0),
  sent_line_count INTEGER CHECK (sent_line_count IS NULL OR sent_line_count >= 1),
  sent_at TIMESTAMPTZ,
  sent_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  decided_at TIMESTAMPTZ,
  decided_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  decision_basis TEXT CHECK (decision_basis IS NULL OR decision_basis IN ('owner','dealer','platform')),
  decision_reason TEXT CHECK (decision_reason IS NULL OR char_length(decision_reason) <= 1000),
  superseded_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancelled_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  cancel_reason TEXT CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 300),
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT garage_ops04_estimate_case_tenant_fk
    FOREIGN KEY (service_case_id, tenant_id)
    REFERENCES service_cases(id, garage_tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_ops04_estimate_work_order_tenant_fk
    FOREIGN KEY (work_order_id, tenant_id)
    REFERENCES mechanic_work_orders(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_ops04_estimate_version_unique UNIQUE (work_order_id, version),
  CONSTRAINT garage_ops04_estimate_sent_truth CHECK (
    status IN ('draft','cancelled')
    OR (sent_at IS NOT NULL AND sent_by_user_id IS NOT NULL
        AND sent_total_amount IS NOT NULL AND sent_line_count IS NOT NULL)
  ),
  CONSTRAINT garage_ops04_estimate_decision_truth CHECK (
    (status IN ('accepted','declined'))
    = (decided_at IS NOT NULL AND decided_by_user_id IS NOT NULL AND decision_basis IS NOT NULL)
  ),
  CONSTRAINT garage_ops04_estimate_cancel_truth CHECK (
    (status = 'cancelled') = (cancelled_at IS NOT NULL)
  ),
  CONSTRAINT garage_ops04_estimate_supersede_truth CHECK (
    (status = 'superseded') = (superseded_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_ops04_estimate_id_tenant
  ON garage_estimates(id, tenant_id);
-- One live (draft or sent) estimate per work order; a decided/replaced version stays history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_ops04_live_estimate_per_work_order
  ON garage_estimates(work_order_id) WHERE status IN ('draft','sent');
-- At most one accepted estimate per work order.
CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_ops04_accepted_estimate_per_work_order
  ON garage_estimates(work_order_id) WHERE status = 'accepted';
CREATE INDEX IF NOT EXISTS idx_garage_ops04_estimates_case
  ON garage_estimates(service_case_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_garage_ops04_estimates_tenant_status
  ON garage_estimates(tenant_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS garage_estimate_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  estimate_id UUID NOT NULL,
  line_no INTEGER NOT NULL CHECK (line_no >= 1),
  category TEXT NOT NULL CHECK (category IN ('labour','part','fee','other')),
  description TEXT NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 300),
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  -- NULL = not recorded. 0 = explicitly free. Never defaulted.
  unit_price NUMERIC(14,2) CHECK (unit_price IS NULL OR unit_price >= 0),
  -- Derived by the database; a client can never supply it.
  line_total NUMERIC(14,2) GENERATED ALWAYS AS (
    CASE WHEN unit_price IS NULL THEN NULL ELSE round(quantity * unit_price, 2) END
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT garage_ops04_line_estimate_tenant_fk
    FOREIGN KEY (estimate_id, tenant_id)
    REFERENCES garage_estimates(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_ops04_line_number_unique UNIQUE (estimate_id, line_no)
);

CREATE TABLE IF NOT EXISTS garage_estimate_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- a total order for the history: created_at can tie within one clock tick, a UUID has no order
  seq BIGINT GENERATED ALWAYS AS IDENTITY,
  tenant_id UUID NOT NULL,
  estimate_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'created','lines_replaced','sent','accepted','declined','superseded','revised','cancelled',
    'authorization_revoked'
  )),
  actor_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  actor_scope TEXT NOT NULL CHECK (actor_scope IN ('garage','customer','system')),
  previous_status TEXT,
  new_status TEXT,
  estimate_version INTEGER NOT NULL,
  work_order_authorization TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT garage_ops04_event_estimate_tenant_fk
    FOREIGN KEY (estimate_id, tenant_id)
    REFERENCES garage_estimates(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_ops04_event_actor_truth CHECK (
    (actor_scope = 'system') = (actor_user_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_garage_ops04_estimate_events
  ON garage_estimate_events(tenant_id, estimate_id, seq);

-- ─────────────────────────── guards ───────────────────────────

CREATE OR REPLACE FUNCTION garage_ops04_events_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'GARAGE_OPS04_ESTIMATE_EVENTS_APPEND_ONLY';
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops04_events_append_only ON garage_estimate_events;
CREATE TRIGGER trg_garage_ops04_events_append_only
  BEFORE UPDATE OR DELETE ON garage_estimate_events
  FOR EACH ROW EXECUTE FUNCTION garage_ops04_events_append_only();

-- A sent version is immutable: only the status machine and its decision/supersede/cancel stamps
-- may change. A draft may change its content freely but cannot skip the machine.
CREATE OR REPLACE FUNCTION garage_ops04_guard_estimate_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.service_case_id IS DISTINCT FROM OLD.service_case_id
     OR NEW.work_order_id IS DISTINCT FROM OLD.work_order_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'GARAGE_OPS04_ESTIMATE_IDENTITY_IMMUTABLE';
  END IF;

  IF OLD.status <> 'draft' THEN
    IF NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.customer_note IS DISTINCT FROM OLD.customer_note
       OR NEW.internal_note IS DISTINCT FROM OLD.internal_note
       OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
       OR NEW.sent_total_amount IS DISTINCT FROM OLD.sent_total_amount
       OR NEW.sent_line_count IS DISTINCT FROM OLD.sent_line_count
       OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
       OR NEW.sent_by_user_id IS DISTINCT FROM OLD.sent_by_user_id THEN
      RAISE EXCEPTION 'GARAGE_OPS04_SENT_ESTIMATE_IMMUTABLE';
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'draft' AND NEW.status IN ('sent','cancelled'))
    OR (OLD.status = 'sent' AND NEW.status IN ('accepted','declined','superseded','cancelled'))
  ) THEN
    RAISE EXCEPTION 'GARAGE_OPS04_ESTIMATE_TRANSITION_NOT_ALLOWED';
  END IF;

  IF OLD.status IN ('accepted','declined','superseded','cancelled') AND (
       NEW.decided_at IS DISTINCT FROM OLD.decided_at
    OR NEW.decided_by_user_id IS DISTINCT FROM OLD.decided_by_user_id
    OR NEW.decision_basis IS DISTINCT FROM OLD.decision_basis
    OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason
    OR NEW.superseded_at IS DISTINCT FROM OLD.superseded_at
    OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
  ) THEN
    RAISE EXCEPTION 'GARAGE_OPS04_DECIDED_ESTIMATE_IMMUTABLE';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops04_guard_estimate_update ON garage_estimates;
CREATE TRIGGER trg_garage_ops04_guard_estimate_update
  BEFORE UPDATE ON garage_estimates
  FOR EACH ROW EXECUTE FUNCTION garage_ops04_guard_estimate_update();

CREATE OR REPLACE FUNCTION garage_ops04_guard_estimate_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'GARAGE_OPS04_ESTIMATES_ARE_NEVER_DELETED';
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops04_guard_estimate_delete ON garage_estimates;
CREATE TRIGGER trg_garage_ops04_guard_estimate_delete
  BEFORE DELETE ON garage_estimates
  FOR EACH ROW EXECUTE FUNCTION garage_ops04_guard_estimate_delete();

-- Lines: editable only while the parent is a draft; amounts must be exactly representable in the
-- estimate's currency (no silent rounding of a JPY or any other scale).
CREATE OR REPLACE FUNCTION garage_ops04_guard_line()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
  v_currency TEXT;
  v_scale INTEGER;
  v_target UUID;
  v_total NUMERIC;
BEGIN
  v_target := CASE WHEN TG_OP = 'DELETE' THEN OLD.estimate_id ELSE NEW.estimate_id END;
  SELECT status, currency INTO v_status, v_currency
    FROM garage_estimates WHERE id = v_target FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS04_ESTIMATE_NOT_FOUND'; END IF;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'GARAGE_OPS04_ESTIMATE_LINES_LOCKED'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF TG_OP = 'UPDATE' AND NEW.estimate_id IS DISTINCT FROM OLD.estimate_id THEN
    RAISE EXCEPTION 'GARAGE_OPS04_ESTIMATE_LINES_LOCKED';
  END IF;

  IF NEW.unit_price IS NOT NULL THEN
    v_scale := garage_ops04_currency_scale(v_currency);
    IF v_scale IS NULL THEN RAISE EXCEPTION 'GARAGE_OPS04_CURRENCY_UNSUPPORTED'; END IF;
    v_total := NEW.quantity * NEW.unit_price;
    IF NEW.unit_price <> round(NEW.unit_price, v_scale) OR v_total <> round(v_total, v_scale) THEN
      RAISE EXCEPTION 'GARAGE_OPS04_AMOUNT_EXCEEDS_CURRENCY_PRECISION';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops04_guard_line ON garage_estimate_lines;
CREATE TRIGGER trg_garage_ops04_guard_line
  BEFORE INSERT OR UPDATE OR DELETE ON garage_estimate_lines
  FOR EACH ROW EXECUTE FUNCTION garage_ops04_guard_line();

-- ─────────────────────────── helpers ───────────────────────────

CREATE OR REPLACE FUNCTION garage_ops04_estimate_totals(p_estimate_id UUID)
RETURNS TABLE (line_count INTEGER, priced_line_count INTEGER, total_amount NUMERIC)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::integer,
         count(unit_price)::integer,
         -- unknown if ANY line is unpriced: a partial sum is not a total
         CASE WHEN count(*) > 0 AND count(*) = count(unit_price) THEN sum(line_total) END
    FROM garage_estimate_lines
   WHERE estimate_id = p_estimate_id
$$;

CREATE OR REPLACE FUNCTION garage_ops04_log(
  p_estimate_id UUID,
  p_event_type TEXT,
  p_actor_user_id TEXT,
  p_scope TEXT,
  p_previous_status TEXT,
  p_detail JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v garage_estimates%ROWTYPE;
  v_role TEXT;
  v_auth TEXT;
  v_vin TEXT;
BEGIN
  SELECT * INTO v FROM garage_estimates WHERE id = p_estimate_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS04_ESTIMATE_NOT_FOUND'; END IF;
  SELECT owner_authorization INTO v_auth FROM mechanic_work_orders WHERE id = v.work_order_id;
  SELECT vin INTO v_vin FROM service_cases WHERE id = v.service_case_id;
  IF p_actor_user_id IS NOT NULL THEN
    SELECT role INTO v_role FROM users WHERE id = p_actor_user_id;
  END IF;

  INSERT INTO garage_estimate_events (
    tenant_id, estimate_id, event_type, actor_user_id, actor_scope,
    previous_status, new_status, estimate_version, work_order_authorization, detail
  ) VALUES (
    v.tenant_id, v.id, p_event_type, p_actor_user_id, p_scope,
    p_previous_status, v.status, v.version, v_auth, COALESCE(p_detail, '{}'::jsonb)
  );

  INSERT INTO trust_audit_events (
    event_type, vin, trust_fact, previous_value, new_value,
    actor_user_id, actor_role, actor_tenant_id, actor_type, source_route, reason
  ) VALUES (
    'GARAGE_ESTIMATE_' || upper(p_event_type), v_vin, 'service_relationship',
    jsonb_build_object('status', p_previous_status),
    jsonb_build_object(
      'estimate_id', v.id, 'version', v.version, 'status', v.status,
      'work_order_id', v.work_order_id, 'currency', v.currency,
      'sent_total_amount', v.sent_total_amount, 'work_order_authorization', v_auth
    ),
    p_actor_user_id, v_role, v.tenant_id::text,
    CASE WHEN p_actor_user_id IS NULL THEN 'system' ELSE 'user' END,
    '/api/garage/estimates', p_detail->>'reason'
  );
END $$;

CREATE OR REPLACE FUNCTION garage_ops04_write_lines(p_estimate_id UUID, p_lines JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant UUID;
  v_elem JSONB;
  v_no INTEGER := 0;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_category TEXT;
  v_desc TEXT;
BEGIN
  SELECT tenant_id INTO v_tenant FROM garage_estimates WHERE id = p_estimate_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS04_ESTIMATE_NOT_FOUND'; END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'GARAGE_OPS04_LINES_INVALID';
  END IF;
  IF jsonb_array_length(p_lines) > 100 THEN RAISE EXCEPTION 'GARAGE_OPS04_TOO_MANY_LINES'; END IF;

  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_no := v_no + 1;
    IF jsonb_typeof(v_elem) <> 'object' THEN RAISE EXCEPTION 'GARAGE_OPS04_LINE_INVALID'; END IF;
    v_category := v_elem->>'category';
    v_desc := btrim(COALESCE(v_elem->>'description', ''));
    IF v_category IS NULL OR v_category NOT IN ('labour','part','fee','other') THEN
      RAISE EXCEPTION 'GARAGE_OPS04_LINE_CATEGORY_INVALID';
    END IF;
    IF char_length(v_desc) NOT BETWEEN 1 AND 300 THEN
      RAISE EXCEPTION 'GARAGE_OPS04_LINE_DESCRIPTION_INVALID';
    END IF;
    BEGIN
      v_qty := NULLIF(btrim(COALESCE(v_elem->>'quantity', '')), '')::numeric;
      -- absent key, JSON null and '' are all "not recorded"; none of them become 0
      v_price := NULLIF(btrim(COALESCE(v_elem->>'unit_price', '')), '')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'GARAGE_OPS04_LINE_NUMBER_INVALID';
    END;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'GARAGE_OPS04_LINE_QUANTITY_INVALID'; END IF;
    IF v_price IS NOT NULL AND v_price < 0 THEN RAISE EXCEPTION 'GARAGE_OPS04_LINE_PRICE_INVALID'; END IF;

    INSERT INTO garage_estimate_lines (tenant_id, estimate_id, line_no, category, description, quantity, unit_price)
    VALUES (v_tenant, p_estimate_id, v_no, v_category, v_desc, v_qty, v_price);
  END LOOP;
  RETURN v_no;
END $$;

CREATE OR REPLACE FUNCTION garage_ops04_is_terminal_work_order_status(p_status TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT lower(regexp_replace(btrim(COALESCE(p_status, '')), '[\s_-]+', ' ', 'g')) IN ('completed','cancelled')
$$;

-- LOCK PROTOCOL (system-wide for the Garage lifecycle): case -> work order -> estimate -> stock part.
-- Every function that touches more than one of these takes them in that order, so no two transactions
-- can wait on each other in a cycle. Proven under real concurrency by garage-final-concurrency.test.js.
-- An estimate RPC knows only the estimate, so it reads the work-order id (no lock), locks the work order
-- FIRST, and only then locks (and re-reads) the estimate.
CREATE OR REPLACE FUNCTION garage_ops04_lock_estimate(p_estimate_id UUID, p_tenant_id UUID)
RETURNS garage_estimates
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wo UUID;
  v_row garage_estimates%ROWTYPE;
BEGIN
  SELECT work_order_id INTO v_wo FROM garage_estimates
   WHERE id = p_estimate_id AND (p_tenant_id IS NULL OR tenant_id = p_tenant_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS04_ESTIMATE_NOT_FOUND'; END IF;
  PERFORM 1 FROM mechanic_work_orders WHERE id = v_wo FOR UPDATE;
  SELECT * INTO v_row FROM garage_estimates
   WHERE id = p_estimate_id AND (p_tenant_id IS NULL OR tenant_id = p_tenant_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS04_ESTIMATE_NOT_FOUND'; END IF;
  RETURN v_row;
END $$;

-- ─────────────────────────── garage-side RPCs ───────────────────────────

CREATE OR REPLACE FUNCTION garage_ops04_create_estimate(
  p_tenant_id UUID,
  p_work_order_id UUID,
  p_currency TEXT,
  p_customer_note TEXT,
  p_internal_note TEXT,
  p_valid_until TIMESTAMPTZ,
  p_lines JSONB,
  p_actor_user_id TEXT
)
RETURNS garage_estimates
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wo mechanic_work_orders%ROWTYPE;
  v_case_status TEXT;
  v_version INTEGER;
  v_row garage_estimates%ROWTYPE;
BEGIN
  PERFORM garage_ops03_assert_admin(p_tenant_id, p_actor_user_id);

  SELECT * INTO v_wo FROM mechanic_work_orders
   WHERE id = p_work_order_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS04_WORK_ORDER_NOT_FOUND'; END IF;
  IF v_wo.service_case_id IS NULL THEN RAISE EXCEPTION 'GARAGE_OPS04_WORK_ORDER_HAS_NO_CASE'; END IF;
  IF garage_ops04_is_terminal_work_order_status(v_wo.status) THEN
    RAISE EXCEPTION 'GARAGE_OPS04_WORK_ORDER_TERMINAL';
  END IF;
  IF v_wo.owner_authorization NOT IN ('pending','declined') THEN
    RAISE EXCEPTION 'GARAGE_OPS04_AUTHORIZATION_FINAL';
  END IF;
  SELECT status INTO v_case_status FROM service_cases
   WHERE id = v_wo.service_case_id AND garage_tenant_id = p_tenant_id;
  IF v_case_status IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'GARAGE_OPS04_CASE_MUST_BE_ACCEPTED'; END IF;
  IF garage_ops04_currency_scale(p_currency) IS NULL THEN RAISE EXCEPTION 'GARAGE_OPS04_CURRENCY_UNSUPPORTED'; END IF;
  IF p_valid_until IS NOT NULL AND p_valid_until <= NOW() THEN RAISE EXCEPTION 'GARAGE_OPS04_VALID_UNTIL_IN_PAST'; END IF;
  IF EXISTS (SELECT 1 FROM garage_estimates WHERE work_order_id = v_wo.id AND status IN ('draft','sent')) THEN
    RAISE EXCEPTION 'GARAGE_OPS04_LIVE_ESTIMATE_EXISTS';
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version FROM garage_estimates WHERE work_order_id = v_wo.id;
  INSERT INTO garage_estimates (
    tenant_id, service_case_id, work_order_id, version, status, currency,
    customer_note, internal_note, valid_until, created_by_user_id
  ) VALUES (
    p_tenant_id, v_wo.service_case_id, v_wo.id, v_version, 'draft', p_currency,
    NULLIF(btrim(p_customer_note), ''), NULLIF(btrim(p_internal_note), ''), p_valid_until, p_actor_user_id
  ) RETURNING * INTO v_row;

  PERFORM garage_ops04_write_lines(v_row.id, COALESCE(p_lines, '[]'::jsonb));
  PERFORM garage_ops04_log(v_row.id, 'created', p_actor_user_id, 'garage', NULL,
    jsonb_build_object('version', v_version));
  SELECT * INTO v_row FROM garage_estimates WHERE id = v_row.id;
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION garage_ops04_replace_draft(
  p_tenant_id UUID,
  p_estimate_id UUID,
  p_currency TEXT,
  p_customer_note TEXT,
  p_internal_note TEXT,
  p_valid_until TIMESTAMPTZ,
  p_lines JSONB,
  p_expected_updated_at TIMESTAMPTZ,
  p_actor_user_id TEXT
)
RETURNS garage_estimates
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row garage_estimates%ROWTYPE;
BEGIN
  PERFORM garage_ops03_assert_admin(p_tenant_id, p_actor_user_id);
  v_row := garage_ops04_lock_estimate(p_estimate_id, p_tenant_id);
  IF v_row.status <> 'draft' THEN RAISE EXCEPTION 'GARAGE_OPS04_ESTIMATE_NOT_DRAFT'; END IF;
  IF p_expected_updated_at IS NOT NULL AND v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'GARAGE_OPS04_STALE_DRAFT';
  END IF;
  IF garage_ops04_currency_scale(p_currency) IS NULL THEN RAISE EXCEPTION 'GARAGE_OPS04_CURRENCY_UNSUPPORTED'; END IF;
  IF p_valid_until IS NOT NULL AND p_valid_until <= NOW() THEN RAISE EXCEPTION 'GARAGE_OPS04_VALID_UNTIL_IN_PAST'; END IF;

  DELETE FROM garage_estimate_lines WHERE estimate_id = v_row.id;
  UPDATE garage_estimates
     SET currency = p_currency,
         customer_note = NULLIF(btrim(p_customer_note), ''),
         internal_note = NULLIF(btrim(p_internal_note), ''),
         valid_until = p_valid_until
   WHERE id = v_row.id;
  PERFORM garage_ops04_write_lines(v_row.id, COALESCE(p_lines, '[]'::jsonb));
  PERFORM garage_ops04_log(v_row.id, 'lines_replaced', p_actor_user_id, 'garage', 'draft', '{}'::jsonb);
  SELECT * INTO v_row FROM garage_estimates WHERE id = v_row.id;
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION garage_ops04_send_estimate(
  p_tenant_id UUID,
  p_estimate_id UUID,
  p_actor_user_id TEXT
)
RETURNS garage_estimates
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row garage_estimates%ROWTYPE;
  v_wo mechanic_work_orders%ROWTYPE;
  v_case_status TEXT;
  v_lines INTEGER;
  v_priced INTEGER;
  v_total NUMERIC;
BEGIN
  PERFORM garage_ops03_assert_admin(p_tenant_id, p_actor_user_id);
  v_row := garage_ops04_lock_estimate(p_estimate_id, p_tenant_id);
  IF v_row.status <> 'draft' THEN RAISE EXCEPTION 'GARAGE_OPS04_ESTIMATE_NOT_DRAFT'; END IF;

  SELECT * INTO v_wo FROM mechanic_work_orders WHERE id = v_row.work_order_id FOR UPDATE;
  IF garage_ops04_is_terminal_work_order_status(v_wo.status) THEN RAISE EXCEPTION 'GARAGE_OPS04_WORK_ORDER_TERMINAL'; END IF;
  IF v_wo.owner_authorization NOT IN ('pending','declined') THEN RAISE EXCEPTION 'GARAGE_OPS04_AUTHORIZATION_FINAL'; END IF;
  SELECT status INTO v_case_status FROM service_cases WHERE id = v_row.service_case_id;
  IF v_case_status IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'GARAGE_OPS04_CASE_MUST_BE_ACCEPTED'; END IF;
  IF v_row.valid_until IS NOT NULL AND v_row.valid_until <= NOW() THEN RAISE EXCEPTION 'GARAGE_OPS04_VALID_UNTIL_IN_PAST'; END IF;

  SELECT t.line_count, t.priced_line_count, t.total_amount INTO v_lines, v_priced, v_total
    FROM garage_ops04_estimate_totals(v_row.id) t;
  IF v_lines < 1 THEN RAISE EXCEPTION 'GARAGE_OPS04_ESTIMATE_HAS_NO_LINES'; END IF;
  IF v_total IS NULL THEN RAISE EXCEPTION 'GARAGE_OPS04_ESTIMATE_NOT_PRICED'; END IF;

  UPDATE garage_estimates
     SET status = 'sent', sent_total_amount = v_total, sent_line_count = v_lines,
         sent_at = NOW(), sent_by_user_id = p_actor_user_id
   WHERE id = v_row.id;
  PERFORM garage_ops04_log(v_row.id, 'sent', p_actor_user_id, 'garage', 'draft',
    jsonb_build_object('line_count', v_lines));
  SELECT * INTO v_row FROM garage_estimates WHERE id = v_row.id;
  RETURN v_row;
END $$;

-- A revision never edits a sent version: it supersedes it (if still awaiting the customer) and
-- opens the next version as a draft carrying the same lines.
CREATE OR REPLACE FUNCTION garage_ops04_revise_estimate(
  p_tenant_id UUID,
  p_estimate_id UUID,
  p_actor_user_id TEXT
)
RETURNS garage_estimates
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_src garage_estimates%ROWTYPE;
  v_wo mechanic_work_orders%ROWTYPE;
  v_new garage_estimates%ROWTYPE;
  v_latest INTEGER;
BEGIN
  PERFORM garage_ops03_assert_admin(p_tenant_id, p_actor_user_id);
  v_src := garage_ops04_lock_estimate(p_estimate_id, p_tenant_id);
  IF v_src.status NOT IN ('sent','declined') THEN RAISE EXCEPTION 'GARAGE_OPS04_ESTIMATE_NOT_REVISABLE'; END IF;

  SELECT * INTO v_wo FROM mechanic_work_orders WHERE id = v_src.work_order_id FOR UPDATE;
  IF garage_ops04_is_terminal_work_order_status(v_wo.status) THEN RAISE EXCEPTION 'GARAGE_OPS04_WORK_ORDER_TERMINAL'; END IF;
  IF v_wo.owner_authorization NOT IN ('pending','declined') THEN RAISE EXCEPTION 'GARAGE_OPS04_AUTHORIZATION_FINAL'; END IF;
  SELECT MAX(version) INTO v_latest FROM garage_estimates WHERE work_order_id = v_src.work_order_id;
  IF v_src.version <> v_latest THEN RAISE EXCEPTION 'GARAGE_OPS04_NOT_LATEST_VERSION'; END IF;

  IF v_src.status = 'sent' THEN
    UPDATE garage_estimates SET status = 'superseded', superseded_at = NOW() WHERE id = v_src.id;
    PERFORM garage_ops04_log(v_src.id, 'superseded', p_actor_user_id, 'garage', 'sent', '{}'::jsonb);
  END IF;
  IF EXISTS (SELECT 1 FROM garage_estimates WHERE work_order_id = v_src.work_order_id AND status IN ('draft','sent')) THEN
    RAISE EXCEPTION 'GARAGE_OPS04_LIVE_ESTIMATE_EXISTS';
  END IF;

  INSERT INTO garage_estimates (
    tenant_id, service_case_id, work_order_id, version, status, currency,
    customer_note, internal_note, valid_until, created_by_user_id
  ) VALUES (
    v_src.tenant_id, v_src.service_case_id, v_src.work_order_id, v_src.version + 1, 'draft', v_src.currency,
    v_src.customer_note, v_src.internal_note, NULL, p_actor_user_id
  ) RETURNING * INTO v_new;
  INSERT INTO garage_estimate_lines (tenant_id, estimate_id, line_no, category, description, quantity, unit_price)
    SELECT l.tenant_id, v_new.id, l.line_no, l.category, l.description, l.quantity, l.unit_price
      FROM garage_estimate_lines l WHERE l.estimate_id = v_src.id ORDER BY l.line_no;
  PERFORM garage_ops04_log(v_new.id, 'revised', p_actor_user_id, 'garage', NULL,
    jsonb_build_object('revises_version', v_src.version));
  SELECT * INTO v_new FROM garage_estimates WHERE id = v_new.id;
  RETURN v_new;
END $$;

CREATE OR REPLACE FUNCTION garage_ops04_cancel_estimate(
  p_tenant_id UUID,
  p_estimate_id UUID,
  p_reason TEXT,
  p_actor_user_id TEXT
)
RETURNS garage_estimates
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row garage_estimates%ROWTYPE;
  v_prev TEXT;
BEGIN
  PERFORM garage_ops03_assert_admin(p_tenant_id, p_actor_user_id);
  v_row := garage_ops04_lock_estimate(p_estimate_id, p_tenant_id);
  IF v_row.status NOT IN ('draft','sent') THEN RAISE EXCEPTION 'GARAGE_OPS04_ESTIMATE_NOT_CANCELLABLE'; END IF;
  v_prev := v_row.status;
  UPDATE garage_estimates
     SET status = 'cancelled', cancelled_at = NOW(), cancelled_by_user_id = p_actor_user_id,
         cancel_reason = NULLIF(btrim(p_reason), '')
   WHERE id = v_row.id;
  PERFORM garage_ops04_log(v_row.id, 'cancelled', p_actor_user_id, 'garage', v_prev,
    jsonb_build_object('reason', NULLIF(btrim(p_reason), '')));
  SELECT * INTO v_row FROM garage_estimates WHERE id = v_row.id;
  RETURN v_row;
END $$;

-- ─────────────────────────── the customer decision ───────────────────────────
--
-- ONE transaction: lock the estimate, lock the work order (inside the canonical function), move the
-- canonical owner_authorization, stamp the estimate, write history + audit. Any failure rolls all of
-- it back, so "estimate accepted / work order pending" and "work order authorized / estimate sent"
-- can never be observed. Two concurrent decisions serialise on the estimate row; the loser finds it
-- no longer 'sent' and is refused.
--
-- p_basis says WHY the actor may decide. 'owner' is re-proven under lock by the canonical function
-- against vehicles.owner_id; 'dealer' / 'platform' are proven by the (service_role-only) caller and
-- recorded, exactly as OC-5A defines.
CREATE OR REPLACE FUNCTION garage_ops04_decide_estimate(
  p_estimate_id UUID,
  p_decision TEXT,
  p_basis TEXT,
  p_actor_user_id TEXT,
  p_actor_role TEXT,
  p_actor_tenant_id TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_est garage_estimates%ROWTYPE;
  v_wo mechanic_work_orders%ROWTYPE;
  v_vin TEXT;
  v_before TEXT;
  v_after TEXT;
  v_result JSONB;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('accepted','declined') THEN
    RAISE EXCEPTION 'GARAGE_OPS04_DECISION_INVALID';
  END IF;
  IF p_basis IS NULL OR p_basis NOT IN ('owner','dealer','platform') THEN
    RAISE EXCEPTION 'GARAGE_OPS04_BASIS_INVALID';
  END IF;
  IF p_actor_user_id IS NULL OR btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION 'GARAGE_OPS04_ACTOR_REQUIRED';
  END IF;

  v_est := garage_ops04_lock_estimate(p_estimate_id, NULL);
  IF v_est.status <> 'sent' THEN RAISE EXCEPTION 'GARAGE_OPS04_ESTIMATE_NOT_PENDING'; END IF;
  IF p_decision = 'accepted' AND v_est.valid_until IS NOT NULL AND v_est.valid_until <= NOW() THEN
    RAISE EXCEPTION 'GARAGE_OPS04_ESTIMATE_EXPIRED';
  END IF;

  SELECT vin INTO v_vin FROM service_cases
   WHERE id = v_est.service_case_id AND garage_tenant_id = v_est.tenant_id;
  IF v_vin IS NULL THEN RAISE EXCEPTION 'GARAGE_OPS04_CASE_NOT_FOUND'; END IF;
  SELECT * INTO v_wo FROM mechanic_work_orders WHERE id = v_est.work_order_id FOR UPDATE;
  v_before := v_wo.owner_authorization;

  -- The estimate row is locked; tell the work-order guard THIS transaction is the sanctioned
  -- decision path for exactly this estimate.
  PERFORM set_config('garage.ops04_decision', v_est.id::text, true);

  IF p_decision = 'accepted' THEN
    v_result := mechanic_work_order_decide_authorization(
      v_wo.id, v_vin, p_actor_user_id, p_actor_role, p_actor_tenant_id, p_basis, 'authorized', p_reason);
  ELSIF v_before = 'pending' THEN
    v_result := mechanic_work_order_decide_authorization(
      v_wo.id, v_vin, p_actor_user_id, p_actor_role, p_actor_tenant_id, p_basis, 'declined', p_reason);
  ELSIF v_before = 'declined' THEN
    -- an earlier version was already declined: the canonical state is already what this decision means
    v_result := jsonb_build_object('id', v_wo.id, 'owner_authorization', v_before, 'unchanged', true);
  ELSE
    RAISE EXCEPTION 'GARAGE_OPS04_AUTHORIZATION_FINAL';
  END IF;

  PERFORM set_config('garage.ops04_decision', '', true);

  UPDATE garage_estimates
     SET status = p_decision, decided_at = NOW(), decided_by_user_id = p_actor_user_id,
         decision_basis = p_basis, decision_reason = NULLIF(btrim(p_reason), '')
   WHERE id = v_est.id;

  SELECT owner_authorization INTO v_after FROM mechanic_work_orders WHERE id = v_wo.id;
  PERFORM garage_ops04_log(v_est.id, p_decision, p_actor_user_id, 'customer', 'sent',
    jsonb_build_object('basis', p_basis, 'reason', NULLIF(btrim(p_reason), ''),
                       'work_order_authorization_before', v_before, 'work_order_authorization_after', v_after));

  RETURN jsonb_build_object(
    'estimate_id', v_est.id, 'status', p_decision, 'work_order_id', v_wo.id,
    'work_order_authorization', v_after, 'work_order_authorization_before', v_before,
    'authorization', v_result);
END $$;

-- ─────────────────────────── convergence guards on the work order ───────────────────────────

-- While an estimate is out with the customer, the work-order decision must be made THROUGH that
-- estimate. Otherwise a direct decision would leave "work order authorized, estimate still sent".
CREATE OR REPLACE FUNCTION garage_ops04_guard_work_order_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sent UUID;
BEGIN
  IF NEW.owner_authorization IN ('authorized','declined') THEN
    SELECT id INTO v_sent FROM garage_estimates WHERE work_order_id = NEW.id AND status = 'sent';
    IF v_sent IS NOT NULL AND COALESCE(current_setting('garage.ops04_decision', true), '') <> v_sent::text THEN
      RAISE EXCEPTION 'GARAGE_OPS04_DECISION_VIA_ESTIMATE';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops04_guard_work_order_decision ON mechanic_work_orders;
CREATE TRIGGER trg_garage_ops04_guard_work_order_decision
  BEFORE UPDATE OF owner_authorization ON mechanic_work_orders
  FOR EACH ROW
  WHEN (OLD.owner_authorization IS DISTINCT FROM NEW.owner_authorization)
  EXECUTE FUNCTION garage_ops04_guard_work_order_decision();

-- Keep estimates coherent with the canonical work order after the fact.
CREATE OR REPLACE FUNCTION garage_ops04_after_work_order_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
BEGIN
  IF NEW.owner_authorization IS DISTINCT FROM OLD.owner_authorization THEN
    IF NEW.owner_authorization = 'authorized' THEN
      -- authorized directly (no estimate in play): a still-draft estimate can no longer be sent
      FOR r IN SELECT id, status FROM garage_estimates WHERE work_order_id = NEW.id AND status = 'draft' LOOP
        UPDATE garage_estimates SET status = 'cancelled', cancelled_at = NOW(),
               cancel_reason = 'work order authorized without this estimate'
         WHERE id = r.id;
        PERFORM garage_ops04_log(r.id, 'cancelled', NULL, 'system', 'draft',
          jsonb_build_object('reason', 'work order authorized without this estimate'));
      END LOOP;
    ELSIF NEW.owner_authorization = 'revoked' THEN
      FOR r IN SELECT id FROM garage_estimates WHERE work_order_id = NEW.id AND status = 'accepted' LOOP
        PERFORM garage_ops04_log(r.id, 'authorization_revoked', NULL, 'system', 'accepted',
          jsonb_build_object('reason', 'the customer revoked the work-order authorization'));
      END LOOP;
    END IF;
  END IF;

  IF garage_ops04_is_terminal_work_order_status(NEW.status)
     AND NOT garage_ops04_is_terminal_work_order_status(OLD.status) THEN
    FOR r IN SELECT id, status FROM garage_estimates WHERE work_order_id = NEW.id AND status IN ('draft','sent') LOOP
      UPDATE garage_estimates SET status = 'cancelled', cancelled_at = NOW(),
             cancel_reason = 'work order ' || lower(btrim(NEW.status))
       WHERE id = r.id;
      PERFORM garage_ops04_log(r.id, 'cancelled', NULL, 'system', r.status,
        jsonb_build_object('reason', 'work order ' || lower(btrim(NEW.status))));
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops04_after_work_order_change ON mechanic_work_orders;
CREATE TRIGGER trg_garage_ops04_after_work_order_change
  AFTER UPDATE OF owner_authorization, status ON mechanic_work_orders
  FOR EACH ROW
  EXECUTE FUNCTION garage_ops04_after_work_order_change();

-- A case that ends without work (declined / cancelled) takes its open estimates with it.
CREATE OR REPLACE FUNCTION garage_ops04_after_case_terminal()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id, status FROM garage_estimates
            WHERE service_case_id = NEW.id AND status IN ('draft','sent') LOOP
    UPDATE garage_estimates SET status = 'cancelled', cancelled_at = NOW(),
           cancel_reason = 'service case ' || NEW.status
     WHERE id = r.id;
    PERFORM garage_ops04_log(r.id, 'cancelled', NULL, 'system', r.status,
      jsonb_build_object('reason', 'service case ' || NEW.status));
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops04_after_case_terminal ON service_cases;
CREATE TRIGGER trg_garage_ops04_after_case_terminal
  AFTER UPDATE OF status ON service_cases
  FOR EACH ROW
  WHEN (NEW.status IN ('declined','cancelled') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION garage_ops04_after_case_terminal();

-- ─────────────────────────── privacy ───────────────────────────

ALTER TABLE garage_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_estimates FORCE ROW LEVEL SECURITY;
ALTER TABLE garage_estimate_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_estimate_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE garage_estimate_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_estimate_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE garage_estimates, garage_estimate_lines, garage_estimate_events
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE garage_estimates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE garage_estimate_lines TO service_role;
GRANT SELECT, INSERT ON TABLE garage_estimate_events TO service_role;

REVOKE ALL ON FUNCTION
  garage_ops04_lock_estimate(UUID,UUID),
  garage_ops04_estimate_totals(UUID),
  garage_ops04_log(UUID,TEXT,TEXT,TEXT,TEXT,JSONB),
  garage_ops04_write_lines(UUID,JSONB),
  garage_ops04_create_estimate(UUID,UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ,JSONB,TEXT),
  garage_ops04_replace_draft(UUID,UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ,JSONB,TIMESTAMPTZ,TEXT),
  garage_ops04_send_estimate(UUID,UUID,TEXT),
  garage_ops04_revise_estimate(UUID,UUID,TEXT),
  garage_ops04_cancel_estimate(UUID,UUID,TEXT,TEXT),
  garage_ops04_decide_estimate(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  garage_ops04_lock_estimate(UUID,UUID),
  garage_ops04_estimate_totals(UUID),
  garage_ops04_log(UUID,TEXT,TEXT,TEXT,TEXT,JSONB),
  garage_ops04_write_lines(UUID,JSONB),
  garage_ops04_create_estimate(UUID,UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ,JSONB,TEXT),
  garage_ops04_replace_draft(UUID,UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ,JSONB,TIMESTAMPTZ,TEXT),
  garage_ops04_send_estimate(UUID,UUID,TEXT),
  garage_ops04_revise_estimate(UUID,UUID,TEXT),
  garage_ops04_cancel_estimate(UUID,UUID,TEXT,TEXT),
  garage_ops04_decide_estimate(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
TO service_role;

-- +migrate Down
DROP FUNCTION IF EXISTS garage_ops04_lock_estimate(UUID,UUID);
DROP TRIGGER IF EXISTS trg_garage_ops04_after_case_terminal ON service_cases;
DROP FUNCTION IF EXISTS garage_ops04_after_case_terminal();
DROP TRIGGER IF EXISTS trg_garage_ops04_after_work_order_change ON mechanic_work_orders;
DROP FUNCTION IF EXISTS garage_ops04_after_work_order_change();
DROP TRIGGER IF EXISTS trg_garage_ops04_guard_work_order_decision ON mechanic_work_orders;
DROP FUNCTION IF EXISTS garage_ops04_guard_work_order_decision();
DROP FUNCTION IF EXISTS garage_ops04_decide_estimate(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT);
DROP FUNCTION IF EXISTS garage_ops04_cancel_estimate(UUID,UUID,TEXT,TEXT);
DROP FUNCTION IF EXISTS garage_ops04_revise_estimate(UUID,UUID,TEXT);
DROP FUNCTION IF EXISTS garage_ops04_send_estimate(UUID,UUID,TEXT);
DROP FUNCTION IF EXISTS garage_ops04_replace_draft(UUID,UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ,JSONB,TIMESTAMPTZ,TEXT);
DROP FUNCTION IF EXISTS garage_ops04_create_estimate(UUID,UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ,JSONB,TEXT);
DROP FUNCTION IF EXISTS garage_ops04_is_terminal_work_order_status(TEXT);
DROP FUNCTION IF EXISTS garage_ops04_write_lines(UUID,JSONB);
DROP FUNCTION IF EXISTS garage_ops04_log(UUID,TEXT,TEXT,TEXT,TEXT,JSONB);
DROP FUNCTION IF EXISTS garage_ops04_estimate_totals(UUID);
DROP TRIGGER IF EXISTS trg_garage_ops04_guard_line ON garage_estimate_lines;
DROP FUNCTION IF EXISTS garage_ops04_guard_line();
DROP TRIGGER IF EXISTS trg_garage_ops04_guard_estimate_delete ON garage_estimates;
DROP FUNCTION IF EXISTS garage_ops04_guard_estimate_delete();
DROP TRIGGER IF EXISTS trg_garage_ops04_guard_estimate_update ON garage_estimates;
DROP FUNCTION IF EXISTS garage_ops04_guard_estimate_update();
DROP TRIGGER IF EXISTS trg_garage_ops04_events_append_only ON garage_estimate_events;
DROP FUNCTION IF EXISTS garage_ops04_events_append_only();
DROP TABLE IF EXISTS garage_estimate_events;
DROP TABLE IF EXISTS garage_estimate_lines;
DROP TABLE IF EXISTS garage_estimates;
DROP FUNCTION IF EXISTS garage_ops04_currency_scale(TEXT);
DROP INDEX IF EXISTS uq_mechanic_work_orders_id_tenant;
