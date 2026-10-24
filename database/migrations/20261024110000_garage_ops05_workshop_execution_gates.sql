-- GARAGE-1.0-OPS05 — workshop execution is governed by the customer's authorization, in the database.
--
-- Nothing here is a new execution authority. The existing records stay THE records:
--   service_cases (engagement) · mechanic_work_orders (job) · work_order_assignments (who)
--   service_records / service_mileage_observations (what was actually done)
-- OPS05 only closes the gaps between them so that no route, script or future code path can:
--   - start work the customer has not authorized (pending / declined / revoked),
--   - start work nobody is assigned to,
--   - record "work performed" on a job that has not started, was cancelled, or is finished,
--   - mark a job complete that has no recorded work, or complete the case without the job.
-- +migrate Up

-- Starting work: the case may move to 'active' only on an authorized, open job with a live mechanic.
-- The work-order row is locked FOR SHARE so a concurrent revoke (which locks it FOR UPDATE) and a
-- start serialise: one of them wins and the other sees the result.
CREATE OR REPLACE FUNCTION garage_ops05_guard_case_start()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wo RECORD;
BEGIN
  SELECT id, status, owner_authorization INTO v_wo
    FROM mechanic_work_orders WHERE service_case_id = NEW.id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS05_WORK_ORDER_REQUIRED'; END IF;
  IF garage_ops04_is_terminal_work_order_status(v_wo.status) THEN
    RAISE EXCEPTION 'GARAGE_OPS05_WORK_ORDER_TERMINAL';
  END IF;
  IF v_wo.owner_authorization IS DISTINCT FROM 'authorized' THEN
    RAISE EXCEPTION 'GARAGE_OPS05_NOT_AUTHORIZED' USING DETAIL = v_wo.owner_authorization;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM work_order_assignments WHERE work_order_id = v_wo.id AND unassigned_at IS NULL
  ) THEN
    RAISE EXCEPTION 'GARAGE_OPS05_MECHANIC_REQUIRED';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops05_guard_case_start ON service_cases;
CREATE TRIGGER trg_garage_ops05_guard_case_start
  BEFORE UPDATE OF status ON service_cases
  FOR EACH ROW
  WHEN (NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active')
  EXECUTE FUNCTION garage_ops05_guard_case_start();

-- Recording work: only against an authorized, open job whose case has actually started.
-- FOR SHARE on the work order serialises this insert with the completion RPC (FOR UPDATE).
CREATE OR REPLACE FUNCTION garage_ops05_guard_service_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wo RECORD;
  v_case_status TEXT;
BEGIN
  -- LOCK PROTOCOL: case -> work order. This insert's own foreign keys will later take KEY SHARE on the case
  -- row, and complete_job holds the case FOR UPDATE before it asks for the work order; locking the work
  -- order first here and the case second (via the FK) was a real deadlock against complete_job, found by
  -- the real-PostgreSQL race suite. So the case is locked first, exactly like start and completion do.
  PERFORM 1 FROM service_cases
   WHERE id = (SELECT service_case_id FROM mechanic_work_orders WHERE id = NEW.work_order_id) FOR SHARE;
  SELECT id, status, owner_authorization, service_case_id, tenant_id INTO v_wo
    FROM mechanic_work_orders WHERE id = NEW.work_order_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS05_WORK_ORDER_REQUIRED'; END IF;
  IF v_wo.tenant_id IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'GARAGE_OPS05_WORK_ORDER_REQUIRED'; END IF;
  IF garage_ops04_is_terminal_work_order_status(v_wo.status) THEN
    RAISE EXCEPTION 'GARAGE_OPS05_WORK_ORDER_TERMINAL';
  END IF;
  IF v_wo.owner_authorization IS DISTINCT FROM 'authorized' THEN
    RAISE EXCEPTION 'GARAGE_OPS05_NOT_AUTHORIZED' USING DETAIL = v_wo.owner_authorization;
  END IF;
  IF v_wo.service_case_id IS NOT NULL THEN
    SELECT status INTO v_case_status FROM service_cases WHERE id = v_wo.service_case_id;
    IF v_case_status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'GARAGE_OPS05_WORK_NOT_STARTED'; END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops05_guard_service_record ON service_records;
CREATE TRIGGER trg_garage_ops05_guard_service_record
  BEFORE INSERT ON service_records
  FOR EACH ROW EXECUTE FUNCTION garage_ops05_guard_service_record();

-- Completing a job: a case-linked job is Completed only with recorded work, on an authorized, started job.
CREATE OR REPLACE FUNCTION garage_ops05_guard_work_order_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_case_status TEXT;
BEGIN
  IF NEW.service_case_id IS NULL THEN RETURN NEW; END IF;   -- legacy, case-less jobs keep their old rules
  IF NEW.owner_authorization IS DISTINCT FROM 'authorized' THEN
    RAISE EXCEPTION 'GARAGE_OPS05_NOT_AUTHORIZED' USING DETAIL = NEW.owner_authorization;
  END IF;
  SELECT status INTO v_case_status FROM service_cases WHERE id = NEW.service_case_id;
  IF v_case_status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'GARAGE_OPS05_WORK_NOT_STARTED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM service_records WHERE work_order_id = NEW.id) THEN
    RAISE EXCEPTION 'GARAGE_OPS05_NO_SERVICE_RECORD';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops05_guard_work_order_completion ON mechanic_work_orders;
CREATE TRIGGER trg_garage_ops05_guard_work_order_completion
  BEFORE UPDATE OF status ON mechanic_work_orders
  FOR EACH ROW
  WHEN (
    NEW.service_case_id IS NOT NULL
    AND lower(btrim(NEW.status)) = 'completed'
    AND lower(btrim(COALESCE(OLD.status, ''))) <> 'completed'
  )
  EXECUTE FUNCTION garage_ops05_guard_work_order_completion();

-- A case is 'completed' only when its job is.
CREATE OR REPLACE FUNCTION garage_ops05_guard_case_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM mechanic_work_orders WHERE service_case_id = NEW.id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS05_WORK_ORDER_REQUIRED'; END IF;
  IF lower(btrim(COALESCE(v_status, ''))) <> 'completed' THEN
    RAISE EXCEPTION 'GARAGE_OPS05_WORK_ORDER_NOT_COMPLETED';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops05_guard_case_completion ON service_cases;
CREATE TRIGGER trg_garage_ops05_guard_case_completion
  BEFORE UPDATE OF status ON service_cases
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
  EXECUTE FUNCTION garage_ops05_guard_case_completion();

CREATE OR REPLACE FUNCTION garage_ops05_assert_workspace(p_tenant_id UUID, p_actor_user_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM tenants t
      JOIN tenant_users tu ON tu.tenant_id = t.id
     WHERE t.id = p_tenant_id AND t.type = 'garage' AND t.status = 'active'
       AND tu.user_id = p_actor_user_id AND tu.role IN ('admin','mechanic')
  ) THEN
    RAISE EXCEPTION 'GARAGE_OPS05_WORKSPACE_REQUIRED';
  END IF;
END $$;

-- Complete the job: the work order and the Service Case reach their terminal states together, with
-- the case's own append-only history, or not at all. The work order is locked first, so a service
-- record being inserted concurrently either lands before completion (and is counted) or is refused
-- by the record guard afterwards; it can never slip in after "complete".
CREATE OR REPLACE FUNCTION garage_ops05_complete_job(
  p_tenant_id UUID,
  p_case_id UUID,
  p_actor_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_case service_cases%ROWTYPE;
  v_wo mechanic_work_orders%ROWTYPE;
  v_records INTEGER;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_role TEXT;
BEGIN
  PERFORM garage_ops05_assert_workspace(p_tenant_id, p_actor_user_id);

  -- LOCK ORDER: case first, then work order. The start trigger (an UPDATE on the case, then a shared lock
  -- on the work order) and the case-completion trigger take them in this order too; taking them the other
  -- way round here could deadlock against a concurrent start or completion. Proven under real concurrency
  -- by garage-final-concurrency.test.js.
  SELECT * INTO v_case FROM service_cases
   WHERE id = p_case_id AND garage_tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS05_CASE_NOT_FOUND'; END IF;
  SELECT * INTO v_wo FROM mechanic_work_orders
   WHERE service_case_id = p_case_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS05_WORK_ORDER_REQUIRED'; END IF;
  IF v_case.status <> 'active' THEN RAISE EXCEPTION 'GARAGE_OPS05_WORK_NOT_STARTED'; END IF;
  IF garage_ops04_is_terminal_work_order_status(v_wo.status) THEN RAISE EXCEPTION 'GARAGE_OPS05_WORK_ORDER_TERMINAL'; END IF;
  IF v_wo.owner_authorization <> 'authorized' THEN
    RAISE EXCEPTION 'GARAGE_OPS05_NOT_AUTHORIZED' USING DETAIL = v_wo.owner_authorization;
  END IF;
  SELECT count(*)::integer INTO v_records FROM service_records WHERE work_order_id = v_wo.id;
  IF v_records < 1 THEN RAISE EXCEPTION 'GARAGE_OPS05_NO_SERVICE_RECORD'; END IF;

  UPDATE mechanic_work_orders SET status = 'Completed', completed_at = v_now, updated_at = v_now WHERE id = v_wo.id;
  UPDATE service_cases SET status = 'completed', completed_at = v_now, updated_at = v_now WHERE id = v_case.id;

  INSERT INTO service_case_events (service_case_id, event_type, from_status, to_status, actor_user_id, actor_tenant_id, metadata)
  VALUES (v_case.id, 'service.case.completed', 'active', 'completed', p_actor_user_id, p_tenant_id,
          jsonb_build_object('via', 'garage_ops05_complete_job', 'service_record_count', v_records));

  SELECT role INTO v_role FROM users WHERE id = p_actor_user_id;
  INSERT INTO trust_audit_events (
    event_type, vin, trust_fact, previous_value, new_value,
    actor_user_id, actor_role, actor_tenant_id, actor_type, source_route
  ) VALUES (
    'GARAGE_JOB_COMPLETED', v_case.vin, 'service_relationship',
    jsonb_build_object('case_status', 'active', 'work_order_status', v_wo.status),
    jsonb_build_object('case_status', 'completed', 'work_order_status', 'Completed',
                       'service_case_id', v_case.id, 'work_order_id', v_wo.id, 'service_record_count', v_records),
    p_actor_user_id, v_role, p_tenant_id::text, 'user', '/api/garage/cases/:caseId/complete'
  );

  RETURN jsonb_build_object(
    'service_case_id', v_case.id, 'work_order_id', v_wo.id, 'vin', v_case.vin,
    'completed_at', v_now, 'service_record_count', v_records, 'requester_user_id', v_case.requester_user_id);
END $$;

REVOKE ALL ON FUNCTION
  garage_ops05_assert_workspace(UUID,TEXT),
  garage_ops05_complete_job(UUID,UUID,TEXT)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  garage_ops05_assert_workspace(UUID,TEXT),
  garage_ops05_complete_job(UUID,UUID,TEXT)
TO service_role;

-- +migrate Down
DROP FUNCTION IF EXISTS garage_ops05_complete_job(UUID,UUID,TEXT);
DROP FUNCTION IF EXISTS garage_ops05_assert_workspace(UUID,TEXT);
DROP TRIGGER IF EXISTS trg_garage_ops05_guard_case_completion ON service_cases;
DROP FUNCTION IF EXISTS garage_ops05_guard_case_completion();
DROP TRIGGER IF EXISTS trg_garage_ops05_guard_work_order_completion ON mechanic_work_orders;
DROP FUNCTION IF EXISTS garage_ops05_guard_work_order_completion();
DROP TRIGGER IF EXISTS trg_garage_ops05_guard_service_record ON service_records;
DROP FUNCTION IF EXISTS garage_ops05_guard_service_record();
DROP TRIGGER IF EXISTS trg_garage_ops05_guard_case_start ON service_cases;
DROP FUNCTION IF EXISTS garage_ops05_guard_case_start();
