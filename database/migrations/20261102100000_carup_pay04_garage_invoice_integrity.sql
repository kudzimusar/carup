-- CARUP-PAY-04-LR01 — Garage invoice integrity (Garage-only; needs Garage OPS06 + OPS07).
--
-- TRUTH BOUNDARIES (additive to OPS07; read 20261024130000 first):
--   * An invoice line that says where it came from must be TRUE about it. OPS07 accepted any `source_id`; from this
--     migration a line is judged when it is issued:
--       part_usage      category 'part'; a recorded, un-reversed consumption ON THIS JOB of this garage; the quantity
--                       billed across live invoices never exceeds the quantity consumed.
--       service_record  not category 'part'; one of THIS JOB's service records.
--       manual          never category 'part': a part is billed only from recorded consumption (OPS06), so stock is
--                       deducted exactly once — when it was consumed — and never by invoicing or a payment event.
--   * Lines issued before this migration are HISTORY. They are never re-judged, rewritten or deleted (OPS07 makes lines
--     immutable). The guard runs on INSERT only.
--   * Payment instructions are the GARAGE's own words about how to pay the garage. CarUp shows them; it does not
--     verify them, receive the money or settle it. They are versioned and append-only.
--   * Adjustment = void + re-issue (OPS07): one live invoice per job; the voided invoice stays as history. No credit
--     notes, no edits.
-- +migrate Up

DO $$
BEGIN
  IF to_regprocedure('public.garage_ops07_issue_invoice(uuid,uuid,text,jsonb,text,text,date,text)') IS NULL
     OR to_regclass('public.garage_service_part_usage') IS NULL
     OR to_regprocedure('public.garage_ops03_assert_admin(uuid,text)') IS NULL
     OR to_regprocedure('public.garage_ops04_currency_scale(text)') IS NULL
     OR to_regclass('public.trust_audit_events') IS NULL THEN
    RAISE EXCEPTION 'PAY04_INTEGRITY_REQUIRES_GARAGE_OPS03_OPS04_OPS06_OPS07';
  END IF;
END $$;

-- ─────────────────────────── invoice-line provenance ───────────────────────────

CREATE OR REPLACE FUNCTION pay04_guard_invoice_line_provenance()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_work_order UUID;
  v_usage garage_service_part_usage%ROWTYPE;
  v_billed NUMERIC;
BEGIN
  SELECT work_order_id INTO v_work_order FROM garage_invoices WHERE id = NEW.invoice_id AND tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS07_INVOICE_NOT_FOUND'; END IF;

  IF NEW.source_kind = 'manual' THEN
    IF NEW.category = 'part' THEN RAISE EXCEPTION 'PAY04_PART_LINE_REQUIRES_RECORDED_USAGE'; END IF;
    RETURN NEW;
  END IF;

  IF NEW.source_kind = 'part_usage' THEN
    IF NEW.category <> 'part' THEN RAISE EXCEPTION 'PAY04_LINE_SOURCE_CATEGORY_MISMATCH'; END IF;
    -- FOR SHARE holds off a concurrent REVERSAL of this usage until this issuance commits (the reversal guard below then
    -- sees the billed line). Two issuances for the same usage are serialized by OPS07's lock on the work order.
    SELECT * INTO v_usage FROM garage_service_part_usage
     WHERE id = NEW.source_id AND tenant_id = NEW.tenant_id AND work_order_id = v_work_order
     FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAY04_LINE_SOURCE_NOT_ON_THIS_JOB'; END IF;
    IF v_usage.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'PAY04_LINE_SOURCE_REVERSED'; END IF;
    -- every line already billed from this usage on a LIVE invoice, including earlier lines of this same issuance
    SELECT COALESCE(sum(l.quantity), 0) INTO v_billed
      FROM garage_invoice_lines l JOIN garage_invoices i ON i.id = l.invoice_id
     WHERE l.source_kind = 'part_usage' AND l.source_id = v_usage.id AND i.status = 'issued';
    IF v_billed + NEW.quantity > v_usage.quantity THEN
      RAISE EXCEPTION 'PAY04_LINE_QUANTITY_EXCEEDS_RECORDED_USAGE'
        USING DETAIL = format('consumed=%s already_billed=%s requested=%s', v_usage.quantity, v_billed, NEW.quantity);
    END IF;
    RETURN NEW;
  END IF;

  -- service_record
  IF NEW.category = 'part' THEN RAISE EXCEPTION 'PAY04_LINE_SOURCE_CATEGORY_MISMATCH'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM service_records r
     WHERE r.id = NEW.source_id AND r.tenant_id = NEW.tenant_id AND r.work_order_id = v_work_order
  ) THEN
    RAISE EXCEPTION 'PAY04_LINE_SOURCE_NOT_ON_THIS_JOB';
  END IF;
  RETURN NEW;
END $$;

-- Fires after OPS07's own line guard (trigger names order: trg_garage_ops07_… < trg_pay04_…).
DROP TRIGGER IF EXISTS trg_pay04_guard_invoice_line_provenance ON garage_invoice_lines;
CREATE TRIGGER trg_pay04_guard_invoice_line_provenance BEFORE INSERT ON garage_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION pay04_guard_invoice_line_provenance();

-- A part billed on an ISSUED invoice cannot be reversed: stock would come back while the invoice still bills it. OPS06
-- refuses a reversal only while the work order is terminal, and a completed work order can be reopened, so the billing
-- itself must refuse. Voiding the invoice (the OPS07 adjustment path) frees the usage for reversal.
CREATE OR REPLACE FUNCTION pay04_guard_billed_usage_reversal()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.reversed_at IS NOT NULL AND OLD.reversed_at IS NULL AND EXISTS (
       SELECT 1 FROM garage_invoice_lines l JOIN garage_invoices i ON i.id = l.invoice_id
        WHERE l.source_kind = 'part_usage' AND l.source_id = OLD.id AND i.status = 'issued') THEN
    RAISE EXCEPTION 'PAY04_PART_USAGE_INVOICED';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pay04_guard_billed_usage_reversal ON garage_service_part_usage;
CREATE TRIGGER trg_pay04_guard_billed_usage_reversal BEFORE UPDATE ON garage_service_part_usage
  FOR EACH ROW EXECUTE FUNCTION pay04_guard_billed_usage_reversal();

-- ─────────────────────────── garage payment instructions ───────────────────────────

CREATE TABLE IF NOT EXISTS pay04_garage_payment_instructions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('active','superseded')),
  payee_name TEXT NOT NULL CHECK (char_length(btrim(payee_name)) BETWEEN 2 AND 120),
  instructions TEXT NOT NULL CHECK (char_length(btrim(instructions)) BETWEEN 10 AND 2000),
  accepted_methods TEXT[] NOT NULL CHECK (
    cardinality(accepted_methods) >= 1
    AND accepted_methods <@ ARRAY['cash','bank_transfer','mobile_money','card_external','other']::text[]
  ),
  currencies TEXT[] NOT NULL CHECK (cardinality(currencies) >= 1),
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  superseded_at TIMESTAMPTZ,
  CONSTRAINT pay04_instructions_version_unique UNIQUE (tenant_id, version),
  CONSTRAINT pay04_instructions_supersede_truth CHECK ((status = 'superseded') = (superseded_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pay04_one_active_instructions ON pay04_garage_payment_instructions(tenant_id) WHERE status = 'active';

-- Append-only: the only change is active -> superseded (stamped), made by the setter below.
CREATE OR REPLACE FUNCTION pay04_guard_payment_instructions()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PAY04_INSTRUCTIONS_IMMUTABLE'; END IF;
  IF OLD.status <> 'active' OR NEW.status <> 'superseded' OR NEW.superseded_at IS NULL
     OR NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.payee_name IS DISTINCT FROM OLD.payee_name OR NEW.instructions IS DISTINCT FROM OLD.instructions
     OR NEW.accepted_methods IS DISTINCT FROM OLD.accepted_methods OR NEW.currencies IS DISTINCT FROM OLD.currencies
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'PAY04_INSTRUCTIONS_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pay04_guard_payment_instructions ON pay04_garage_payment_instructions;
CREATE TRIGGER trg_pay04_guard_payment_instructions BEFORE UPDATE OR DELETE ON pay04_garage_payment_instructions
  FOR EACH ROW EXECUTE FUNCTION pay04_guard_payment_instructions();

CREATE OR REPLACE FUNCTION pay04_set_garage_payment_instructions(
  p_tenant_id UUID, p_actor_user_id TEXT, p_payee_name TEXT, p_instructions TEXT,
  p_accepted_methods TEXT[], p_currencies TEXT[]
) RETURNS pay04_garage_payment_instructions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prev pay04_garage_payment_instructions%ROWTYPE;
  v_row pay04_garage_payment_instructions%ROWTYPE;
  v_code TEXT;
  v_methods TEXT[];
  v_currencies TEXT[];
  v_role TEXT;
BEGIN
  PERFORM garage_ops03_assert_admin(p_tenant_id, p_actor_user_id);
  IF char_length(btrim(COALESCE(p_payee_name, ''))) NOT BETWEEN 2 AND 120
     OR char_length(btrim(COALESCE(p_instructions, ''))) NOT BETWEEN 10 AND 2000 THEN
    RAISE EXCEPTION 'PAY04_INSTRUCTIONS_INVALID';
  END IF;
  SELECT array_agg(DISTINCT m ORDER BY m) INTO v_methods FROM unnest(COALESCE(p_accepted_methods, '{}'::text[])) AS m;
  IF v_methods IS NULL OR NOT v_methods <@ ARRAY['cash','bank_transfer','mobile_money','card_external','other']::text[] THEN
    RAISE EXCEPTION 'PAY04_INSTRUCTIONS_METHOD_INVALID';
  END IF;
  SELECT array_agg(DISTINCT upper(btrim(c)) ORDER BY upper(btrim(c))) INTO v_currencies FROM unnest(COALESCE(p_currencies, '{}'::text[])) AS c;
  IF v_currencies IS NULL THEN RAISE EXCEPTION 'PAY04_INSTRUCTIONS_CURRENCY_INVALID'; END IF;
  FOREACH v_code IN ARRAY v_currencies LOOP
    IF v_code !~ '^[A-Z]{3}$' OR garage_ops04_currency_scale(v_code) IS NULL THEN
      RAISE EXCEPTION 'PAY04_INSTRUCTIONS_CURRENCY_INVALID';
    END IF;
  END LOOP;

  -- serialize per garage: lock the garage row, then the current version
  PERFORM 1 FROM tenants WHERE id = p_tenant_id FOR UPDATE;
  SELECT * INTO v_prev FROM pay04_garage_payment_instructions WHERE tenant_id = p_tenant_id AND status = 'active' FOR UPDATE;
  IF FOUND THEN
    UPDATE pay04_garage_payment_instructions SET status = 'superseded', superseded_at = clock_timestamp() WHERE id = v_prev.id;
  END IF;
  INSERT INTO pay04_garage_payment_instructions (tenant_id, version, status, payee_name, instructions, accepted_methods, currencies, created_by_user_id)
  VALUES (p_tenant_id, COALESCE((SELECT max(version) FROM pay04_garage_payment_instructions WHERE tenant_id = p_tenant_id), 0) + 1,
          'active', btrim(p_payee_name), btrim(p_instructions), v_methods, v_currencies, p_actor_user_id)
  RETURNING * INTO v_row;

  SELECT role INTO v_role FROM users WHERE id = p_actor_user_id;
  INSERT INTO trust_audit_events (event_type, trust_fact, new_value, actor_user_id, actor_role, actor_tenant_id, actor_type, source_route)
  VALUES ('GARAGE_PAYMENT_INSTRUCTIONS_SET', 'service_relationship',
          jsonb_build_object('instructions_id', v_row.id, 'version', v_row.version, 'accepted_methods', to_jsonb(v_row.accepted_methods),
                             'currencies', to_jsonb(v_row.currencies), 'superseded_version', v_prev.version),
          p_actor_user_id, v_role, p_tenant_id::text, 'user', '/api/garage/payment-instructions');
  RETURN v_row;
END $$;

-- ─────────────────────────── privacy ───────────────────────────

ALTER TABLE pay04_garage_payment_instructions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pay04_garage_payment_instructions FROM PUBLIC, anon, authenticated, service_role;
-- the backend reads; every write goes through the SECURITY DEFINER setter
GRANT SELECT ON TABLE pay04_garage_payment_instructions TO service_role;

REVOKE ALL ON FUNCTION pay04_guard_invoice_line_provenance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION pay04_guard_payment_instructions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION pay04_guard_billed_usage_reversal() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION pay04_set_garage_payment_instructions(UUID,TEXT,TEXT,TEXT,TEXT[],TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pay04_set_garage_payment_instructions(UUID,TEXT,TEXT,TEXT,TEXT[],TEXT[]) TO service_role;

-- +migrate Down
DROP FUNCTION IF EXISTS pay04_set_garage_payment_instructions(UUID,TEXT,TEXT,TEXT,TEXT[],TEXT[]);
DROP TRIGGER IF EXISTS trg_pay04_guard_payment_instructions ON pay04_garage_payment_instructions;
DROP FUNCTION IF EXISTS pay04_guard_payment_instructions();
DROP TABLE IF EXISTS pay04_garage_payment_instructions;
DROP TRIGGER IF EXISTS trg_pay04_guard_billed_usage_reversal ON garage_service_part_usage;
DROP FUNCTION IF EXISTS pay04_guard_billed_usage_reversal();
DROP TRIGGER IF EXISTS trg_pay04_guard_invoice_line_provenance ON garage_invoice_lines;
DROP FUNCTION IF EXISTS pay04_guard_invoice_line_provenance();
