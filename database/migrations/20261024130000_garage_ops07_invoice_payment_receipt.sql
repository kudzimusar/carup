-- GARAGE-1.0-OPS07 — commercial closeout: invoice, payment record, receipt.
--
-- TRUTH BOUNDARIES (read before changing anything here):
--   * An INVOICE is a commercial document / obligation. It is NOT proof of payment.
--   * A PAYMENT RECORD is what the garage declares it received, OFF-PLATFORM. CarUp did not process or
--     verify it, and every payment, receipt and read model says so (source = 'garage_recorded_external').
--     No Marketplace / SafeTrade / Diaspora payment contract can truthfully represent a garage service
--     payment, so none is force-fitted; live settlement is an explicit external-integration gate.
--   * A RECEIPT exists only because a payment record exists. It is created in the same transaction and a
--     trigger refuses a receipt without a matching payment.
--   * The payment STATE of an invoice is DERIVED from payment records. It is never a stored flag that
--     could drift from them, and it is never inferred from completion, invoicing or a reference string.
--   * Amounts always carry an explicit currency and are never converted or added across currencies.
-- +migrate Up

CREATE TABLE IF NOT EXISTS garage_document_counters (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('invoice','receipt')),
  last_number BIGINT NOT NULL CHECK (last_number >= 0),
  PRIMARY KEY (tenant_id, doc_type)
);

CREATE OR REPLACE FUNCTION garage_ops07_next_number(p_tenant_id UUID, p_doc_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_n BIGINT;
BEGIN
  -- the ON CONFLICT update row-locks the counter: numbers are unique and, because it is part of the
  -- caller's transaction, gapless (a rolled-back issuance does not burn a number)
  INSERT INTO garage_document_counters (tenant_id, doc_type, last_number) VALUES (p_tenant_id, p_doc_type, 1)
  ON CONFLICT (tenant_id, doc_type) DO UPDATE SET last_number = garage_document_counters.last_number + 1
  RETURNING last_number INTO v_n;
  RETURN CASE p_doc_type WHEN 'invoice' THEN 'INV-' ELSE 'RCT-' END || lpad(v_n::text, 6, '0');
END $$;

CREATE TABLE IF NOT EXISTS garage_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  invoice_number TEXT NOT NULL,
  service_case_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('issued','voided')),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$' AND garage_ops04_currency_scale(currency) IS NOT NULL),
  total_amount NUMERIC(14,2) NOT NULL CHECK (total_amount > 0),
  line_count INTEGER NOT NULL CHECK (line_count >= 1),
  customer_note TEXT CHECK (customer_note IS NULL OR char_length(customer_note) <= 2000),
  internal_note TEXT CHECK (internal_note IS NULL OR char_length(internal_note) <= 2000),
  due_date DATE,
  -- Snapshot of the ACCEPTED estimate at issue time (NULL when the job had none). Variance is derived
  -- from these two numbers and only when the currencies match; nothing is converted.
  estimate_id UUID,
  estimate_version INTEGER,
  estimate_total_amount NUMERIC(14,2),
  estimate_currency TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  voided_at TIMESTAMPTZ,
  voided_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  void_reason TEXT CHECK (void_reason IS NULL OR char_length(void_reason) <= 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT garage_ops07_invoice_case_tenant_fk
    FOREIGN KEY (service_case_id, tenant_id) REFERENCES service_cases(id, garage_tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_ops07_invoice_work_order_tenant_fk
    FOREIGN KEY (work_order_id, tenant_id) REFERENCES mechanic_work_orders(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_ops07_invoice_estimate_tenant_fk
    FOREIGN KEY (estimate_id, tenant_id) REFERENCES garage_estimates(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_ops07_invoice_number_unique UNIQUE (tenant_id, invoice_number),
  CONSTRAINT garage_ops07_invoice_void_truth CHECK (
    (status = 'voided') = (voided_at IS NOT NULL AND voided_by_user_id IS NOT NULL AND void_reason IS NOT NULL)
  ),
  CONSTRAINT garage_ops07_invoice_estimate_truth CHECK (
    (estimate_id IS NULL) = (estimate_version IS NULL AND estimate_total_amount IS NULL AND estimate_currency IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_ops07_invoice_id_tenant ON garage_invoices(id, tenant_id);
-- One live invoice per job; a voided one stays as history and a corrected invoice may follow it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_ops07_live_invoice_per_work_order ON garage_invoices(work_order_id) WHERE status = 'issued';
CREATE INDEX IF NOT EXISTS idx_garage_ops07_invoices_case ON garage_invoices(service_case_id);
CREATE INDEX IF NOT EXISTS idx_garage_ops07_invoices_tenant ON garage_invoices(tenant_id, issued_at DESC);

CREATE TABLE IF NOT EXISTS garage_invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  invoice_id UUID NOT NULL,
  line_no INTEGER NOT NULL CHECK (line_no >= 1),
  category TEXT NOT NULL CHECK (category IN ('labour','part','fee','other')),
  description TEXT NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 300),
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(14,2) GENERATED ALWAYS AS (round(quantity * unit_price, 2)) STORED,
  source_kind TEXT NOT NULL DEFAULT 'manual' CHECK (source_kind IN ('manual','service_record','part_usage')),
  source_id UUID,
  CONSTRAINT garage_ops07_line_invoice_tenant_fk
    FOREIGN KEY (invoice_id, tenant_id) REFERENCES garage_invoices(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_ops07_line_number_unique UNIQUE (invoice_id, line_no),
  CONSTRAINT garage_ops07_line_source_truth CHECK ((source_kind = 'manual') = (source_id IS NULL))
);

-- Append-only: what the garage declares it received, off-platform. Corrections are reversal rows.
CREATE TABLE IF NOT EXISTS garage_payment_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq BIGINT GENERATED ALWAYS AS IDENTITY,
  tenant_id UUID NOT NULL,
  invoice_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('payment','reversal')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  method TEXT NOT NULL CHECK (method IN ('cash','bank_transfer','mobile_money','card_external','other')),
  -- free text exactly as the garage typed it; it proves nothing and is never parsed
  reference TEXT CHECK (reference IS NULL OR char_length(reference) <= 120),
  paid_at TIMESTAMPTZ NOT NULL,
  -- CarUp neither processed nor verified this. The only value this table accepts today.
  source TEXT NOT NULL DEFAULT 'garage_recorded_external' CHECK (source = 'garage_recorded_external'),
  reverses_payment_id UUID,
  reason TEXT CHECK (reason IS NULL OR char_length(reason) <= 300),
  recorded_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 120),
  CONSTRAINT garage_ops07_payment_invoice_tenant_fk
    FOREIGN KEY (invoice_id, tenant_id) REFERENCES garage_invoices(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_ops07_payment_reversal_truth CHECK (
    (kind = 'reversal') = (reverses_payment_id IS NOT NULL)
  ),
  CONSTRAINT garage_ops07_payment_reversal_reason CHECK (kind <> 'reversal' OR reason IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_ops07_payment_idempotency ON garage_payment_records(tenant_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_ops07_payment_id_tenant ON garage_payment_records(id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_ops07_one_reversal_per_payment ON garage_payment_records(reverses_payment_id) WHERE reverses_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_garage_ops07_payments_invoice ON garage_payment_records(tenant_id, invoice_id, seq);

CREATE TABLE IF NOT EXISTS garage_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  receipt_number TEXT NOT NULL,
  invoice_id UUID NOT NULL,
  payment_id UUID NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  payment_source TEXT NOT NULL CHECK (payment_source = 'garage_recorded_external'),
  status TEXT NOT NULL CHECK (status IN ('issued','voided')),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  voided_at TIMESTAMPTZ,
  CONSTRAINT garage_ops07_receipt_payment_tenant_fk
    FOREIGN KEY (payment_id, tenant_id) REFERENCES garage_payment_records(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_ops07_receipt_invoice_tenant_fk
    FOREIGN KEY (invoice_id, tenant_id) REFERENCES garage_invoices(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_ops07_receipt_one_per_payment UNIQUE (payment_id),
  CONSTRAINT garage_ops07_receipt_number_unique UNIQUE (tenant_id, receipt_number),
  CONSTRAINT garage_ops07_receipt_void_truth CHECK ((status = 'voided') = (voided_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS garage_invoice_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq BIGINT GENERATED ALWAYS AS IDENTITY,
  tenant_id UUID NOT NULL,
  invoice_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('issued','voided','payment_recorded','payment_reversed','receipt_issued','receipt_voided')),
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT garage_ops07_event_invoice_tenant_fk
    FOREIGN KEY (invoice_id, tenant_id) REFERENCES garage_invoices(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_garage_ops07_invoice_events ON garage_invoice_events(tenant_id, invoice_id, seq);

-- ─────────────────────────── guards ───────────────────────────

CREATE OR REPLACE FUNCTION garage_ops07_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN RAISE EXCEPTION 'GARAGE_OPS07_APPEND_ONLY'; END $$;
DROP TRIGGER IF EXISTS trg_garage_ops07_payments_append_only ON garage_payment_records;
CREATE TRIGGER trg_garage_ops07_payments_append_only BEFORE UPDATE OR DELETE ON garage_payment_records
  FOR EACH ROW EXECUTE FUNCTION garage_ops07_append_only();
DROP TRIGGER IF EXISTS trg_garage_ops07_events_append_only ON garage_invoice_events;
CREATE TRIGGER trg_garage_ops07_events_append_only BEFORE UPDATE OR DELETE ON garage_invoice_events
  FOR EACH ROW EXECUTE FUNCTION garage_ops07_append_only();
DROP TRIGGER IF EXISTS trg_garage_ops07_lines_immutable ON garage_invoice_lines;
CREATE TRIGGER trg_garage_ops07_lines_immutable BEFORE UPDATE OR DELETE ON garage_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION garage_ops07_append_only();

-- Lines exist only as part of ISSUING an invoice (the RPC sets the flag for exactly that invoice).
CREATE OR REPLACE FUNCTION garage_ops07_guard_line_insert()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_currency TEXT; v_scale INTEGER; v_total NUMERIC;
BEGIN
  IF COALESCE(current_setting('garage.ops07_issuing', true), '') <> NEW.invoice_id::text THEN
    RAISE EXCEPTION 'GARAGE_OPS07_INVOICE_LINES_LOCKED';
  END IF;
  SELECT currency INTO v_currency FROM garage_invoices WHERE id = NEW.invoice_id;
  v_scale := garage_ops04_currency_scale(v_currency);
  v_total := NEW.quantity * NEW.unit_price;
  IF v_scale IS NULL OR NEW.unit_price <> round(NEW.unit_price, v_scale) OR v_total <> round(v_total, v_scale) THEN
    RAISE EXCEPTION 'GARAGE_OPS07_AMOUNT_EXCEEDS_CURRENCY_PRECISION';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_garage_ops07_guard_line_insert ON garage_invoice_lines;
CREATE TRIGGER trg_garage_ops07_guard_line_insert BEFORE INSERT ON garage_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION garage_ops07_guard_line_insert();

-- An issued invoice is immutable; the only legal change is issued -> voided with its stamps.
CREATE OR REPLACE FUNCTION garage_ops07_guard_invoice_update()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'GARAGE_OPS07_INVOICES_ARE_NEVER_DELETED'; END IF;
  IF OLD.status = 'voided' THEN RAISE EXCEPTION 'GARAGE_OPS07_VOIDED_INVOICE_IS_FINAL'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
     OR NEW.service_case_id IS DISTINCT FROM OLD.service_case_id OR NEW.work_order_id IS DISTINCT FROM OLD.work_order_id
     OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
     OR NEW.line_count IS DISTINCT FROM OLD.line_count OR NEW.customer_note IS DISTINCT FROM OLD.customer_note
     OR NEW.internal_note IS DISTINCT FROM OLD.internal_note OR NEW.due_date IS DISTINCT FROM OLD.due_date
     OR NEW.estimate_id IS DISTINCT FROM OLD.estimate_id OR NEW.estimate_total_amount IS DISTINCT FROM OLD.estimate_total_amount
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at OR NEW.issued_by_user_id IS DISTINCT FROM OLD.issued_by_user_id THEN
    RAISE EXCEPTION 'GARAGE_OPS07_ISSUED_INVOICE_IMMUTABLE';
  END IF;
  IF NEW.status <> 'voided' THEN RAISE EXCEPTION 'GARAGE_OPS07_ISSUED_INVOICE_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_garage_ops07_guard_invoice_update ON garage_invoices;
CREATE TRIGGER trg_garage_ops07_guard_invoice_update BEFORE UPDATE OR DELETE ON garage_invoices
  FOR EACH ROW EXECUTE FUNCTION garage_ops07_guard_invoice_update();

-- A payment record is accepted only against a live invoice in the SAME currency; a reversal only
-- against an un-reversed payment of that invoice for exactly its amount.
CREATE OR REPLACE FUNCTION garage_ops07_guard_payment_insert()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_inv garage_invoices%ROWTYPE; v_orig garage_payment_records%ROWTYPE;
BEGIN
  SELECT * INTO v_inv FROM garage_invoices WHERE id = NEW.invoice_id AND tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS07_INVOICE_NOT_FOUND'; END IF;
  IF NEW.currency <> v_inv.currency THEN RAISE EXCEPTION 'GARAGE_OPS07_CURRENCY_MISMATCH'; END IF;
  IF NEW.paid_at > NOW() + INTERVAL '5 minutes' OR NEW.paid_at < TIMESTAMPTZ '2020-01-01' THEN
    RAISE EXCEPTION 'GARAGE_OPS07_PAID_AT_INVALID';
  END IF;
  IF NEW.kind = 'payment' THEN
    IF v_inv.status <> 'issued' THEN RAISE EXCEPTION 'GARAGE_OPS07_INVOICE_NOT_PAYABLE'; END IF;
  ELSE
    SELECT * INTO v_orig FROM garage_payment_records WHERE id = NEW.reverses_payment_id AND tenant_id = NEW.tenant_id;
    IF NOT FOUND OR v_orig.kind <> 'payment' OR v_orig.invoice_id <> NEW.invoice_id
       OR v_orig.amount <> NEW.amount OR v_orig.currency <> NEW.currency THEN
      RAISE EXCEPTION 'GARAGE_OPS07_REVERSAL_MISMATCH';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_garage_ops07_guard_payment_insert ON garage_payment_records;
CREATE TRIGGER trg_garage_ops07_guard_payment_insert BEFORE INSERT ON garage_payment_records
  FOR EACH ROW EXECUTE FUNCTION garage_ops07_guard_payment_insert();

-- No receipt without authoritative payment truth: it must match an existing PAYMENT record exactly.
CREATE OR REPLACE FUNCTION garage_ops07_guard_receipt()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_pay garage_payment_records%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'GARAGE_OPS07_RECEIPTS_ARE_NEVER_DELETED'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_pay FROM garage_payment_records WHERE id = NEW.payment_id AND tenant_id = NEW.tenant_id;
    IF NOT FOUND OR v_pay.kind <> 'payment' OR v_pay.invoice_id <> NEW.invoice_id
       OR v_pay.amount <> NEW.amount OR v_pay.currency <> NEW.currency OR v_pay.source <> NEW.payment_source THEN
      RAISE EXCEPTION 'GARAGE_OPS07_RECEIPT_REQUIRES_PAYMENT';
    END IF;
    IF NEW.status <> 'issued' THEN RAISE EXCEPTION 'GARAGE_OPS07_RECEIPT_REQUIRES_PAYMENT'; END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: only issued -> voided
  IF OLD.status <> 'issued' OR NEW.status <> 'voided'
     OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.payment_id IS DISTINCT FROM OLD.payment_id OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
     OR NEW.receipt_number IS DISTINCT FROM OLD.receipt_number OR NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
    RAISE EXCEPTION 'GARAGE_OPS07_RECEIPT_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_garage_ops07_guard_receipt ON garage_receipts;
CREATE TRIGGER trg_garage_ops07_guard_receipt BEFORE INSERT OR UPDATE OR DELETE ON garage_receipts
  FOR EACH ROW EXECUTE FUNCTION garage_ops07_guard_receipt();

-- ─────────────────────────── derived truth ───────────────────────────

-- The invoice's money state, computed from payment records ONLY.
CREATE OR REPLACE FUNCTION garage_ops07_invoice_balance(p_invoice_id UUID)
RETURNS TABLE (total_amount NUMERIC, paid_amount NUMERIC, balance_amount NUMERIC, payment_status TEXT)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT i.total_amount::numeric(14,2),
         COALESCE(p.net, 0)::numeric(14,2),
         (i.total_amount - COALESCE(p.net, 0))::numeric(14,2),
         CASE
           WHEN i.status = 'voided' THEN 'voided'
           WHEN COALESCE(p.net, 0) = 0 THEN 'unpaid'
           WHEN COALESCE(p.net, 0) < i.total_amount THEN 'partially_paid'
           ELSE 'paid'
         END
    FROM garage_invoices i
    LEFT JOIN LATERAL (
      SELECT sum(CASE WHEN r.kind = 'payment' THEN r.amount ELSE -r.amount END) AS net
        FROM garage_payment_records r WHERE r.invoice_id = i.id
    ) p ON true
   WHERE i.id = p_invoice_id
$$;

CREATE OR REPLACE FUNCTION garage_ops07_log(
  p_tenant_id UUID, p_invoice_id UUID, p_event TEXT, p_actor_user_id TEXT, p_detail JSONB
) RETURNS VOID
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_role TEXT; v_vin TEXT;
BEGIN
  INSERT INTO garage_invoice_events (tenant_id, invoice_id, event_type, actor_user_id, detail)
  VALUES (p_tenant_id, p_invoice_id, p_event, p_actor_user_id, COALESCE(p_detail, '{}'::jsonb));
  SELECT role INTO v_role FROM users WHERE id = p_actor_user_id;
  SELECT c.vin INTO v_vin FROM garage_invoices i JOIN service_cases c ON c.id = i.service_case_id WHERE i.id = p_invoice_id;
  INSERT INTO trust_audit_events (event_type, vin, trust_fact, new_value, actor_user_id, actor_role, actor_tenant_id, actor_type, source_route)
  VALUES ('GARAGE_INVOICE_' || upper(p_event), v_vin, 'service_relationship',
          jsonb_build_object('invoice_id', p_invoice_id) || COALESCE(p_detail, '{}'::jsonb),
          p_actor_user_id, v_role, p_tenant_id::text, 'user', '/api/garage/invoices');
END $$;

-- Parse + validate invoice lines. EVERY line must be priced: an invoice states amounts.
CREATE OR REPLACE FUNCTION garage_ops07_parse_lines(p_lines JSONB, p_currency TEXT)
RETURNS TABLE (line_no INTEGER, category TEXT, description TEXT, quantity NUMERIC, unit_price NUMERIC, source_kind TEXT, source_id UUID)
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_elem JSONB; v_no INTEGER := 0; v_scale INTEGER := garage_ops04_currency_scale(p_currency);
  v_cat TEXT; v_desc TEXT; v_qty NUMERIC; v_price NUMERIC; v_kind TEXT; v_src UUID;
BEGIN
  IF v_scale IS NULL THEN RAISE EXCEPTION 'GARAGE_OPS07_CURRENCY_UNSUPPORTED'; END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN RAISE EXCEPTION 'GARAGE_OPS07_LINES_INVALID'; END IF;
  IF jsonb_array_length(p_lines) > 100 THEN RAISE EXCEPTION 'GARAGE_OPS07_TOO_MANY_LINES'; END IF;
  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_no := v_no + 1;
    IF jsonb_typeof(v_elem) <> 'object' THEN RAISE EXCEPTION 'GARAGE_OPS07_LINES_INVALID'; END IF;
    v_cat := v_elem->>'category';
    v_desc := btrim(COALESCE(v_elem->>'description', ''));
    IF v_cat IS NULL OR v_cat NOT IN ('labour','part','fee','other') THEN RAISE EXCEPTION 'GARAGE_OPS07_LINE_CATEGORY_INVALID'; END IF;
    IF char_length(v_desc) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'GARAGE_OPS07_LINE_DESCRIPTION_INVALID'; END IF;
    BEGIN
      v_qty := NULLIF(btrim(COALESCE(v_elem->>'quantity', '')), '')::numeric;
      v_price := NULLIF(btrim(COALESCE(v_elem->>'unit_price', '')), '')::numeric;
      v_src := NULLIF(btrim(COALESCE(v_elem->>'source_id', '')), '')::uuid;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'GARAGE_OPS07_LINE_NUMBER_INVALID';
    END;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'GARAGE_OPS07_LINE_QUANTITY_INVALID'; END IF;
    IF v_price IS NULL THEN RAISE EXCEPTION 'GARAGE_OPS07_LINE_NOT_PRICED'; END IF;
    IF v_price < 0 THEN RAISE EXCEPTION 'GARAGE_OPS07_LINE_PRICE_INVALID'; END IF;
    IF v_price <> round(v_price, v_scale) OR (v_qty * v_price) <> round(v_qty * v_price, v_scale) THEN
      RAISE EXCEPTION 'GARAGE_OPS07_AMOUNT_EXCEEDS_CURRENCY_PRECISION';
    END IF;
    v_kind := COALESCE(NULLIF(v_elem->>'source_kind', ''), 'manual');
    IF v_kind NOT IN ('manual','service_record','part_usage') OR ((v_kind = 'manual') <> (v_src IS NULL)) THEN
      RAISE EXCEPTION 'GARAGE_OPS07_LINE_SOURCE_INVALID';
    END IF;
    line_no := v_no; category := v_cat; description := v_desc; quantity := v_qty; unit_price := v_price;
    source_kind := v_kind; source_id := v_src;
    RETURN NEXT;
  END LOOP;
END $$;

-- ─────────────────────────── issue / void ───────────────────────────

-- Issue the invoice for a COMPLETED job. Idempotent per key, one live invoice per job. The total is
-- derived here from the lines; the caller cannot supply one.
CREATE OR REPLACE FUNCTION garage_ops07_issue_invoice(
  p_tenant_id UUID, p_work_order_id UUID, p_currency TEXT, p_lines JSONB,
  p_customer_note TEXT, p_internal_note TEXT, p_due_date DATE, p_actor_user_id TEXT
) RETURNS garage_invoices
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_wo mechanic_work_orders%ROWTYPE;
  v_case service_cases%ROWTYPE;
  v_est garage_estimates%ROWTYPE;
  v_inv garage_invoices%ROWTYPE;
  v_count INTEGER;
  v_total NUMERIC;
BEGIN
  PERFORM garage_ops03_assert_admin(p_tenant_id, p_actor_user_id);
  SELECT * INTO v_wo FROM mechanic_work_orders WHERE id = p_work_order_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR v_wo.service_case_id IS NULL THEN RAISE EXCEPTION 'GARAGE_OPS07_WORK_ORDER_NOT_FOUND'; END IF;
  SELECT * INTO v_case FROM service_cases WHERE id = v_wo.service_case_id AND garage_tenant_id = p_tenant_id;
  IF lower(btrim(COALESCE(v_wo.status, ''))) <> 'completed' OR v_case.status <> 'completed' THEN
    RAISE EXCEPTION 'GARAGE_OPS07_JOB_NOT_COMPLETED';
  END IF;
  IF EXISTS (SELECT 1 FROM garage_invoices WHERE work_order_id = v_wo.id AND status = 'issued') THEN
    RAISE EXCEPTION 'GARAGE_OPS07_INVOICE_ALREADY_ISSUED';
  END IF;
  IF p_due_date IS NOT NULL AND p_due_date < CURRENT_DATE - 1 THEN RAISE EXCEPTION 'GARAGE_OPS07_DUE_DATE_INVALID'; END IF;

  SELECT count(*)::integer, COALESCE(sum(round(l.quantity * l.unit_price, 2)), 0)
    INTO v_count, v_total FROM garage_ops07_parse_lines(p_lines, p_currency) l;
  IF v_total <= 0 THEN RAISE EXCEPTION 'GARAGE_OPS07_TOTAL_MUST_BE_POSITIVE'; END IF;

  SELECT * INTO v_est FROM garage_estimates WHERE work_order_id = v_wo.id AND status = 'accepted';

  INSERT INTO garage_invoices (
    tenant_id, invoice_number, service_case_id, work_order_id, status, currency, total_amount, line_count,
    customer_note, internal_note, due_date, estimate_id, estimate_version, estimate_total_amount, estimate_currency,
    issued_by_user_id
  ) VALUES (
    p_tenant_id, garage_ops07_next_number(p_tenant_id, 'invoice'), v_case.id, v_wo.id, 'issued', p_currency, v_total, v_count,
    NULLIF(btrim(p_customer_note), ''), NULLIF(btrim(p_internal_note), ''), p_due_date,
    v_est.id, v_est.version, v_est.sent_total_amount, v_est.currency,
    p_actor_user_id
  ) RETURNING * INTO v_inv;

  PERFORM set_config('garage.ops07_issuing', v_inv.id::text, true);
  INSERT INTO garage_invoice_lines (tenant_id, invoice_id, line_no, category, description, quantity, unit_price, source_kind, source_id)
    SELECT p_tenant_id, v_inv.id, l.line_no, l.category, l.description, l.quantity, l.unit_price, l.source_kind, l.source_id
      FROM garage_ops07_parse_lines(p_lines, p_currency) l;
  PERFORM set_config('garage.ops07_issuing', '', true);

  PERFORM garage_ops07_log(p_tenant_id, v_inv.id, 'issued', p_actor_user_id,
    jsonb_build_object('invoice_number', v_inv.invoice_number, 'currency', p_currency, 'total_amount', v_total::text, 'line_count', v_count));
  SELECT * INTO v_inv FROM garage_invoices WHERE id = v_inv.id;
  RETURN v_inv;
END $$;

-- Void an invoice that has no money against it (every payment already reversed). Terminal.
CREATE OR REPLACE FUNCTION garage_ops07_void_invoice(
  p_tenant_id UUID, p_invoice_id UUID, p_reason TEXT, p_actor_user_id TEXT
) RETURNS garage_invoices
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_inv garage_invoices%ROWTYPE; v_paid NUMERIC;
BEGIN
  PERFORM garage_ops03_assert_admin(p_tenant_id, p_actor_user_id);
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'GARAGE_OPS07_REASON_REQUIRED'; END IF;
  SELECT * INTO v_inv FROM garage_invoices WHERE id = p_invoice_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS07_INVOICE_NOT_FOUND'; END IF;
  IF v_inv.status <> 'issued' THEN RAISE EXCEPTION 'GARAGE_OPS07_INVOICE_NOT_PAYABLE'; END IF;
  SELECT b.paid_amount INTO v_paid FROM garage_ops07_invoice_balance(v_inv.id) b;
  IF v_paid <> 0 THEN RAISE EXCEPTION 'GARAGE_OPS07_INVOICE_HAS_PAYMENTS'; END IF;
  UPDATE garage_invoices SET status = 'voided', voided_at = NOW(), voided_by_user_id = p_actor_user_id,
         void_reason = btrim(p_reason) WHERE id = v_inv.id;
  PERFORM garage_ops07_log(p_tenant_id, v_inv.id, 'voided', p_actor_user_id, jsonb_build_object('reason', btrim(p_reason)));
  SELECT * INTO v_inv FROM garage_invoices WHERE id = v_inv.id;
  RETURN v_inv;
END $$;

-- ─────────────────────────── payment records ───────────────────────────

-- Record money the garage says it received OFF-PLATFORM. Atomic with its receipt; idempotent per key
-- (a duplicate callback / double click cannot record the same money twice); never above the balance.
CREATE OR REPLACE FUNCTION garage_ops07_record_payment(
  p_tenant_id UUID, p_invoice_id UUID, p_amount NUMERIC, p_currency TEXT, p_method TEXT,
  p_reference TEXT, p_paid_at TIMESTAMPTZ, p_actor_user_id TEXT, p_idempotency_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_inv garage_invoices%ROWTYPE;
  v_existing garage_payment_records%ROWTYPE;
  v_pay garage_payment_records%ROWTYPE;
  v_receipt garage_receipts%ROWTYPE;
  v_bal RECORD;
  v_scale INTEGER;
BEGIN
  PERFORM garage_ops03_assert_admin(p_tenant_id, p_actor_user_id);
  SELECT * INTO v_inv FROM garage_invoices WHERE id = p_invoice_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS07_INVOICE_NOT_FOUND'; END IF;

  SELECT * INTO v_existing FROM garage_payment_records WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.invoice_id <> p_invoice_id OR v_existing.kind <> 'payment' OR v_existing.amount <> p_amount
       OR v_existing.currency <> p_currency OR v_existing.method <> p_method THEN
      RAISE EXCEPTION 'GARAGE_OPS07_IDEMPOTENCY_CONFLICT';
    END IF;
    SELECT * INTO v_receipt FROM garage_receipts WHERE payment_id = v_existing.id;
    SELECT * INTO v_bal FROM garage_ops07_invoice_balance(v_inv.id);
    RETURN jsonb_build_object('payment_id', v_existing.id, 'receipt_id', v_receipt.id, 'receipt_number', v_receipt.receipt_number,
      'payment_status', v_bal.payment_status, 'paid_amount', v_bal.paid_amount::text, 'balance_amount', v_bal.balance_amount::text, 'replayed', true);
  END IF;

  IF v_inv.status <> 'issued' THEN RAISE EXCEPTION 'GARAGE_OPS07_INVOICE_NOT_PAYABLE'; END IF;
  IF p_currency IS DISTINCT FROM v_inv.currency THEN RAISE EXCEPTION 'GARAGE_OPS07_CURRENCY_MISMATCH'; END IF;
  v_scale := garage_ops04_currency_scale(v_inv.currency);
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, v_scale) THEN RAISE EXCEPTION 'GARAGE_OPS07_AMOUNT_INVALID'; END IF;
  IF p_method IS NULL OR p_method NOT IN ('cash','bank_transfer','mobile_money','card_external','other') THEN
    RAISE EXCEPTION 'GARAGE_OPS07_METHOD_INVALID';
  END IF;
  IF p_paid_at IS NULL THEN RAISE EXCEPTION 'GARAGE_OPS07_PAID_AT_INVALID'; END IF;
  SELECT * INTO v_bal FROM garage_ops07_invoice_balance(v_inv.id);
  IF p_amount > v_bal.balance_amount THEN RAISE EXCEPTION 'GARAGE_OPS07_PAYMENT_EXCEEDS_BALANCE' USING DETAIL = format('balance=%s', v_bal.balance_amount); END IF;

  INSERT INTO garage_payment_records (tenant_id, invoice_id, kind, amount, currency, method, reference, paid_at, recorded_by_user_id, idempotency_key)
  VALUES (p_tenant_id, v_inv.id, 'payment', p_amount, v_inv.currency, p_method, NULLIF(btrim(p_reference), ''), p_paid_at, p_actor_user_id, p_idempotency_key)
  RETURNING * INTO v_pay;
  INSERT INTO garage_receipts (tenant_id, receipt_number, invoice_id, payment_id, amount, currency, payment_source, status, issued_by_user_id)
  VALUES (p_tenant_id, garage_ops07_next_number(p_tenant_id, 'receipt'), v_inv.id, v_pay.id, v_pay.amount, v_pay.currency, v_pay.source, 'issued', p_actor_user_id)
  RETURNING * INTO v_receipt;

  PERFORM garage_ops07_log(p_tenant_id, v_inv.id, 'payment_recorded', p_actor_user_id,
    jsonb_build_object('payment_id', v_pay.id, 'amount', v_pay.amount::text, 'currency', v_pay.currency, 'method', v_pay.method,
                       'source', v_pay.source, 'receipt_number', v_receipt.receipt_number));
  SELECT * INTO v_bal FROM garage_ops07_invoice_balance(v_inv.id);
  RETURN jsonb_build_object('payment_id', v_pay.id, 'receipt_id', v_receipt.id, 'receipt_number', v_receipt.receipt_number,
    'payment_status', v_bal.payment_status, 'paid_amount', v_bal.paid_amount::text, 'balance_amount', v_bal.balance_amount::text, 'replayed', false);
END $$;

-- A mistaken payment record is reversed (a new row), never edited: the receipt it produced is voided.
CREATE OR REPLACE FUNCTION garage_ops07_reverse_payment(
  p_tenant_id UUID, p_payment_id UUID, p_reason TEXT, p_actor_user_id TEXT, p_idempotency_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_orig garage_payment_records%ROWTYPE;
  v_probe garage_payment_records%ROWTYPE;
  v_inv garage_invoices%ROWTYPE;
  v_rev garage_payment_records%ROWTYPE;
  v_bal RECORD;
BEGIN
  PERFORM garage_ops03_assert_admin(p_tenant_id, p_actor_user_id);
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'GARAGE_OPS07_REASON_REQUIRED'; END IF;
  SELECT * INTO v_probe FROM garage_payment_records WHERE id = p_payment_id AND tenant_id = p_tenant_id;
  IF NOT FOUND OR v_probe.kind <> 'payment' THEN RAISE EXCEPTION 'GARAGE_OPS07_PAYMENT_NOT_FOUND'; END IF;
  SELECT * INTO v_inv FROM garage_invoices WHERE id = v_probe.invoice_id AND tenant_id = p_tenant_id FOR UPDATE;
  v_orig := v_probe;

  SELECT * INTO v_rev FROM garage_payment_records WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_rev.reverses_payment_id IS DISTINCT FROM v_orig.id THEN RAISE EXCEPTION 'GARAGE_OPS07_IDEMPOTENCY_CONFLICT'; END IF;
    SELECT * INTO v_bal FROM garage_ops07_invoice_balance(v_inv.id);
    RETURN jsonb_build_object('reversal_id', v_rev.id, 'payment_status', v_bal.payment_status, 'paid_amount', v_bal.paid_amount::text, 'replayed', true);
  END IF;
  IF EXISTS (SELECT 1 FROM garage_payment_records WHERE reverses_payment_id = v_orig.id) THEN
    RAISE EXCEPTION 'GARAGE_OPS07_PAYMENT_ALREADY_REVERSED';
  END IF;
  IF v_inv.status <> 'issued' THEN RAISE EXCEPTION 'GARAGE_OPS07_INVOICE_NOT_PAYABLE'; END IF;

  INSERT INTO garage_payment_records (tenant_id, invoice_id, kind, amount, currency, method, reference, paid_at, reverses_payment_id, reason, recorded_by_user_id, idempotency_key)
  VALUES (p_tenant_id, v_orig.invoice_id, 'reversal', v_orig.amount, v_orig.currency, v_orig.method, NULL, NOW(), v_orig.id, btrim(p_reason), p_actor_user_id, p_idempotency_key)
  RETURNING * INTO v_rev;
  UPDATE garage_receipts SET status = 'voided', voided_at = NOW() WHERE payment_id = v_orig.id AND status = 'issued';
  PERFORM garage_ops07_log(p_tenant_id, v_inv.id, 'payment_reversed', p_actor_user_id,
    jsonb_build_object('payment_id', v_orig.id, 'reversal_id', v_rev.id, 'amount', v_orig.amount::text, 'currency', v_orig.currency, 'reason', btrim(p_reason)));
  SELECT * INTO v_bal FROM garage_ops07_invoice_balance(v_inv.id);
  RETURN jsonb_build_object('reversal_id', v_rev.id, 'payment_status', v_bal.payment_status, 'paid_amount', v_bal.paid_amount::text, 'replayed', false);
END $$;

-- ─────────────────────────── privacy ───────────────────────────

ALTER TABLE garage_document_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_document_counters FORCE ROW LEVEL SECURITY;
ALTER TABLE garage_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE garage_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_invoice_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE garage_payment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_payment_records FORCE ROW LEVEL SECURITY;
ALTER TABLE garage_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE garage_invoice_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_invoice_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE garage_document_counters, garage_invoices, garage_invoice_lines, garage_payment_records, garage_receipts, garage_invoice_events
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE garage_document_counters TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE garage_invoices TO service_role;
GRANT SELECT, INSERT ON TABLE garage_invoice_lines TO service_role;
GRANT SELECT, INSERT ON TABLE garage_payment_records TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE garage_receipts TO service_role;
GRANT SELECT, INSERT ON TABLE garage_invoice_events TO service_role;

REVOKE ALL ON FUNCTION
  garage_ops07_next_number(UUID,TEXT),
  garage_ops07_invoice_balance(UUID),
  garage_ops07_log(UUID,UUID,TEXT,TEXT,JSONB),
  garage_ops07_parse_lines(JSONB,TEXT),
  garage_ops07_issue_invoice(UUID,UUID,TEXT,JSONB,TEXT,TEXT,DATE,TEXT),
  garage_ops07_void_invoice(UUID,UUID,TEXT,TEXT),
  garage_ops07_record_payment(UUID,UUID,NUMERIC,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT),
  garage_ops07_reverse_payment(UUID,UUID,TEXT,TEXT,TEXT)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  garage_ops07_next_number(UUID,TEXT),
  garage_ops07_invoice_balance(UUID),
  garage_ops07_log(UUID,UUID,TEXT,TEXT,JSONB),
  garage_ops07_parse_lines(JSONB,TEXT),
  garage_ops07_issue_invoice(UUID,UUID,TEXT,JSONB,TEXT,TEXT,DATE,TEXT),
  garage_ops07_void_invoice(UUID,UUID,TEXT,TEXT),
  garage_ops07_record_payment(UUID,UUID,NUMERIC,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT),
  garage_ops07_reverse_payment(UUID,UUID,TEXT,TEXT,TEXT)
TO service_role;

-- +migrate Down
DROP FUNCTION IF EXISTS garage_ops07_reverse_payment(UUID,UUID,TEXT,TEXT,TEXT);
DROP FUNCTION IF EXISTS garage_ops07_record_payment(UUID,UUID,NUMERIC,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT);
DROP FUNCTION IF EXISTS garage_ops07_void_invoice(UUID,UUID,TEXT,TEXT);
DROP FUNCTION IF EXISTS garage_ops07_issue_invoice(UUID,UUID,TEXT,JSONB,TEXT,TEXT,DATE,TEXT);
DROP FUNCTION IF EXISTS garage_ops07_parse_lines(JSONB,TEXT);
DROP FUNCTION IF EXISTS garage_ops07_log(UUID,UUID,TEXT,TEXT,JSONB);
DROP FUNCTION IF EXISTS garage_ops07_invoice_balance(UUID);
DROP TRIGGER IF EXISTS trg_garage_ops07_guard_receipt ON garage_receipts;
DROP FUNCTION IF EXISTS garage_ops07_guard_receipt();
DROP TRIGGER IF EXISTS trg_garage_ops07_guard_payment_insert ON garage_payment_records;
DROP FUNCTION IF EXISTS garage_ops07_guard_payment_insert();
DROP TRIGGER IF EXISTS trg_garage_ops07_guard_invoice_update ON garage_invoices;
DROP FUNCTION IF EXISTS garage_ops07_guard_invoice_update();
DROP TRIGGER IF EXISTS trg_garage_ops07_guard_line_insert ON garage_invoice_lines;
DROP FUNCTION IF EXISTS garage_ops07_guard_line_insert();
DROP TRIGGER IF EXISTS trg_garage_ops07_lines_immutable ON garage_invoice_lines;
DROP TRIGGER IF EXISTS trg_garage_ops07_events_append_only ON garage_invoice_events;
DROP TRIGGER IF EXISTS trg_garage_ops07_payments_append_only ON garage_payment_records;
DROP FUNCTION IF EXISTS garage_ops07_append_only();
DROP TABLE IF EXISTS garage_invoice_events;
DROP TABLE IF EXISTS garage_receipts;
DROP TABLE IF EXISTS garage_payment_records;
DROP TABLE IF EXISTS garage_invoice_lines;
DROP TABLE IF EXISTS garage_invoices;
DROP FUNCTION IF EXISTS garage_ops07_next_number(UUID,TEXT);
DROP TABLE IF EXISTS garage_document_counters;
