-- GARAGE-1.0-OPS03 — appointments + workshop scheduling + capacity foundation.
-- Planning authority only: Service Cases remain engagement authority; mechanic work orders and
-- work_order_assignments remain execution authority.
-- +migrate Up

CREATE TABLE IF NOT EXISTS garage_branch_scheduling_settings (
  branch_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  scheduling_enabled BOOLEAN NOT NULL,
  max_concurrent_appointments INTEGER NOT NULL CHECK (max_concurrent_appointments BETWEEN 1 AND 100),
  slot_interval_minutes INTEGER NOT NULL CHECK (
    slot_interval_minutes BETWEEN 5 AND 240
    AND 1440 % slot_interval_minutes = 0
  ),
  updated_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT garage_ops03_settings_branch_tenant_fk
    FOREIGN KEY (branch_id, tenant_id)
    REFERENCES garage_branches(id, tenant_id) ON DELETE RESTRICT,
  UNIQUE (branch_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS garage_workforce_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  workforce_profile_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  effective_from DATE NOT NULL,
  effective_until DATE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT garage_ops03_work_schedule_time_check CHECK (starts_at < ends_at),
  CONSTRAINT garage_ops03_work_schedule_dates_check CHECK (
    effective_until IS NULL OR effective_until >= effective_from
  ),
  CONSTRAINT garage_ops03_work_schedule_profile_tenant_fk
    FOREIGN KEY (workforce_profile_id, tenant_id)
    REFERENCES garage_workforce_profiles(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_ops03_work_schedule_branch_tenant_fk
    FOREIGN KEY (branch_id, tenant_id)
    REFERENCES garage_branches(id, tenant_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS garage_workforce_unavailability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  workforce_profile_id UUID NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  reason_code TEXT CHECK (reason_code IS NULL OR reason_code IN ('leave','training','unavailable','other')),
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT garage_ops03_unavailability_time_check CHECK (starts_at < ends_at),
  CONSTRAINT garage_ops03_unavailability_profile_tenant_fk
    FOREIGN KEY (workforce_profile_id, tenant_id)
    REFERENCES garage_workforce_profiles(id, tenant_id) ON DELETE RESTRICT
);

-- A composite key lets the appointment carry the same Garage as its Service Case at database level.
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_cases_id_garage_tenant
  ON service_cases(id, garage_tenant_id);

CREATE TABLE IF NOT EXISTS garage_appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  service_case_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('requested','confirmed','declined','cancelled','fulfilled','no_show')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  appointment_timezone TEXT NOT NULL CHECK (char_length(appointment_timezone) BETWEEN 1 AND 80),
  planned_workforce_profile_id UUID,
  requested_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  confirmed_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  cancelled_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  declined_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  fulfilled_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  no_show_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  fulfilled_at TIMESTAMPTZ,
  no_show_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT garage_ops03_appointment_interval_check CHECK (starts_at < ends_at),
  CONSTRAINT garage_ops03_appointment_service_case_tenant_fk
    FOREIGN KEY (service_case_id, tenant_id)
    REFERENCES service_cases(id, garage_tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_ops03_appointment_branch_tenant_fk
    FOREIGN KEY (branch_id, tenant_id)
    REFERENCES garage_branches(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_ops03_appointment_workforce_tenant_fk
    FOREIGN KEY (planned_workforce_profile_id, tenant_id)
    REFERENCES garage_workforce_profiles(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_ops03_confirmed_truth CHECK (
    status <> 'confirmed'
    OR (
      planned_workforce_profile_id IS NOT NULL
      AND confirmed_by_user_id IS NOT NULL
      AND confirmed_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_ops03_appointment_id_tenant
  ON garage_appointments(id, tenant_id);

-- One requested/confirmed appointment per Service Case; terminal rows remain history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_ops03_live_appointment_per_case
  ON garage_appointments(service_case_id)
  WHERE status IN ('requested','confirmed');

CREATE INDEX IF NOT EXISTS idx_garage_ops03_appointments_branch_interval
  ON garage_appointments(tenant_id, branch_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_garage_ops03_appointments_service_case
  ON garage_appointments(service_case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_garage_ops03_appointments_status
  ON garage_appointments(tenant_id, status, starts_at);
CREATE INDEX IF NOT EXISTS idx_garage_ops03_appointments_workforce_interval
  ON garage_appointments(tenant_id, planned_workforce_profile_id, starts_at, ends_at)
  WHERE planned_workforce_profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_garage_ops03_work_schedules_lookup
  ON garage_workforce_schedules(tenant_id, branch_id, day_of_week, effective_from, effective_until);
CREATE INDEX IF NOT EXISTS idx_garage_ops03_work_schedules_profile
  ON garage_workforce_schedules(tenant_id, workforce_profile_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_garage_ops03_unavailability_interval
  ON garage_workforce_unavailability(tenant_id, workforce_profile_id, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS garage_appointment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  appointment_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'requested','confirmed','rescheduled','declined','cancelled','fulfilled','no_show'
  )),
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_scope TEXT NOT NULL CHECK (actor_scope IN ('requester','garage')),
  previous_status TEXT,
  new_status TEXT,
  previous_starts_at TIMESTAMPTZ,
  previous_ends_at TIMESTAMPTZ,
  new_starts_at TIMESTAMPTZ,
  new_ends_at TIMESTAMPTZ,
  previous_branch_id UUID,
  new_branch_id UUID,
  previous_planned_workforce_profile_id UUID,
  new_planned_workforce_profile_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT garage_ops03_event_appointment_tenant_fk
    FOREIGN KEY (appointment_id, tenant_id)
    REFERENCES garage_appointments(id, tenant_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_garage_ops03_appointment_events
  ON garage_appointment_events(tenant_id, appointment_id, created_at);

CREATE OR REPLACE FUNCTION garage_ops03_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops03_settings_touch ON garage_branch_scheduling_settings;
CREATE TRIGGER trg_garage_ops03_settings_touch
  BEFORE UPDATE ON garage_branch_scheduling_settings
  FOR EACH ROW EXECUTE FUNCTION garage_ops03_touch_updated_at();

DROP TRIGGER IF EXISTS trg_garage_ops03_work_schedule_touch ON garage_workforce_schedules;
CREATE TRIGGER trg_garage_ops03_work_schedule_touch
  BEFORE UPDATE ON garage_workforce_schedules
  FOR EACH ROW EXECUTE FUNCTION garage_ops03_touch_updated_at();

DROP TRIGGER IF EXISTS trg_garage_ops03_unavailability_touch ON garage_workforce_unavailability;
CREATE TRIGGER trg_garage_ops03_unavailability_touch
  BEFORE UPDATE ON garage_workforce_unavailability
  FOR EACH ROW EXECUTE FUNCTION garage_ops03_touch_updated_at();

CREATE OR REPLACE FUNCTION garage_ops03_validate_workforce_schedule()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM garage_workforce_profiles p
    JOIN tenant_users tu ON tu.tenant_id = p.tenant_id AND tu.user_id = p.user_id
    JOIN garage_branches b ON b.id = NEW.branch_id AND b.tenant_id = NEW.tenant_id
    JOIN garage_workforce_branch_assignments a
      ON a.tenant_id = p.tenant_id
     AND a.workforce_profile_id = p.id
     AND a.branch_id = NEW.branch_id
     AND a.ended_at IS NULL
    WHERE p.id = NEW.workforce_profile_id
      AND p.tenant_id = NEW.tenant_id
      AND p.employment_status = 'active'
      AND b.is_active = true
      AND tu.role IN ('admin','mechanic')
  ) THEN
    RAISE EXCEPTION 'GARAGE_OPS03_WORKFORCE_SCHEDULE_AUTHORITY_INVALID';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops03_validate_workforce_schedule ON garage_workforce_schedules;
CREATE TRIGGER trg_garage_ops03_validate_workforce_schedule
  BEFORE INSERT OR UPDATE ON garage_workforce_schedules
  FOR EACH ROW EXECUTE FUNCTION garage_ops03_validate_workforce_schedule();

CREATE OR REPLACE FUNCTION garage_ops03_validate_unavailability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM garage_workforce_profiles p
    JOIN tenant_users tu ON tu.tenant_id = p.tenant_id AND tu.user_id = p.user_id
    WHERE p.id = NEW.workforce_profile_id
      AND p.tenant_id = NEW.tenant_id
      AND p.employment_status = 'active'
      AND tu.role IN ('admin','mechanic')
  ) THEN
    RAISE EXCEPTION 'GARAGE_OPS03_UNAVAILABILITY_WORKFORCE_INVALID';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops03_validate_unavailability ON garage_workforce_unavailability;
CREATE TRIGGER trg_garage_ops03_validate_unavailability
  BEFORE INSERT OR UPDATE ON garage_workforce_unavailability
  FOR EACH ROW EXECUTE FUNCTION garage_ops03_validate_unavailability();

CREATE OR REPLACE FUNCTION garage_ops03_validate_appointment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.service_case_id IS DISTINCT FROM OLD.service_case_id
    OR NEW.requested_by_user_id IS DISTINCT FROM OLD.requested_by_user_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'GARAGE_OPS03_APPOINTMENT_IDENTITY_IMMUTABLE';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IN ('declined','cancelled','fulfilled','no_show')
       AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'GARAGE_OPS03_TERMINAL_APPOINTMENT_IMMUTABLE';
    END IF;
    IF OLD.status = 'requested'
       AND NEW.status NOT IN ('requested','confirmed','declined','cancelled') THEN
      RAISE EXCEPTION 'GARAGE_OPS03_INVALID_APPOINTMENT_TRANSITION';
    END IF;
    IF OLD.status = 'confirmed'
       AND NEW.status NOT IN ('confirmed','cancelled','fulfilled','no_show') THEN
      RAISE EXCEPTION 'GARAGE_OPS03_INVALID_APPOINTMENT_TRANSITION';
    END IF;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops03_validate_appointment ON garage_appointments;
CREATE TRIGGER trg_garage_ops03_validate_appointment
  BEFORE INSERT OR UPDATE ON garage_appointments
  FOR EACH ROW EXECUTE FUNCTION garage_ops03_validate_appointment();

CREATE OR REPLACE FUNCTION garage_ops03_events_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'GARAGE_OPS03_APPOINTMENT_EVENTS_APPEND_ONLY';
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops03_events_append_only ON garage_appointment_events;
CREATE TRIGGER trg_garage_ops03_events_append_only
  BEFORE UPDATE OR DELETE ON garage_appointment_events
  FOR EACH ROW EXECUTE FUNCTION garage_ops03_events_append_only();

CREATE OR REPLACE FUNCTION garage_ops03_assert_admin(p_tenant_id UUID, p_actor_user_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM tenants t
    JOIN tenant_users tu ON tu.tenant_id = t.id
    WHERE t.id = p_tenant_id
      AND t.type = 'garage'
      AND t.status = 'active'
      AND tu.user_id = p_actor_user_id
      AND tu.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'GARAGE_OPS03_ADMIN_REQUIRED';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION garage_ops03_append_event_and_audit(
  p_appointment_id UUID,
  p_event_type TEXT,
  p_actor_user_id TEXT,
  p_actor_scope TEXT,
  p_previous JSONB,
  p_new JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row garage_appointments%ROWTYPE;
  v_actor_role TEXT;
BEGIN
  SELECT * INTO v_row FROM garage_appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS03_APPOINTMENT_NOT_FOUND'; END IF;
  SELECT role INTO v_actor_role FROM users WHERE id = p_actor_user_id;

  INSERT INTO garage_appointment_events (
    tenant_id, appointment_id, event_type, actor_user_id, actor_scope,
    previous_status, new_status,
    previous_starts_at, previous_ends_at, new_starts_at, new_ends_at,
    previous_branch_id, new_branch_id,
    previous_planned_workforce_profile_id, new_planned_workforce_profile_id
  )
  VALUES (
    v_row.tenant_id, v_row.id, p_event_type, p_actor_user_id, p_actor_scope,
    p_previous->>'status', p_new->>'status',
    NULLIF(p_previous->>'starts_at','')::timestamptz,
    NULLIF(p_previous->>'ends_at','')::timestamptz,
    NULLIF(p_new->>'starts_at','')::timestamptz,
    NULLIF(p_new->>'ends_at','')::timestamptz,
    NULLIF(p_previous->>'branch_id','')::uuid,
    NULLIF(p_new->>'branch_id','')::uuid,
    NULLIF(p_previous->>'planned_workforce_profile_id','')::uuid,
    NULLIF(p_new->>'planned_workforce_profile_id','')::uuid
  );

  INSERT INTO trust_audit_events (
    event_type, previous_value, new_value, actor_user_id, actor_role,
    actor_tenant_id, actor_type, source_route
  )
  VALUES (
    'GARAGE_APPOINTMENT_' || upper(p_event_type),
    p_previous, p_new, p_actor_user_id, v_actor_role,
    v_row.tenant_id::text, 'user',
    CASE WHEN p_actor_scope = 'requester'
      THEN '/api/service-cases/:caseId/appointments'
      ELSE '/api/garage/schedule'
    END
  );
END $$;

CREATE OR REPLACE FUNCTION garage_ops03_evaluate_interval(
  p_tenant_id UUID,
  p_branch_id UUID,
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ,
  p_exclude_appointment_id UUID DEFAULT NULL
)
RETURNS TABLE (
  appointment_timezone TEXT,
  max_concurrent_appointments INTEGER,
  slot_interval_minutes INTEGER,
  booked_count INTEGER,
  available_workforce_profile_ids UUID[],
  available_count INTEGER
)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch RECORD;
  v_settings RECORD;
  v_local_start TIMESTAMP;
  v_local_end TIMESTAMP;
  v_local_date DATE;
  v_day SMALLINT;
  v_workforce UUID[];
  v_booked INTEGER;
BEGIN
  IF p_starts_at IS NULL OR p_ends_at IS NULL OR p_starts_at >= p_ends_at THEN
    RAISE EXCEPTION 'GARAGE_OPS03_INVALID_INTERVAL';
  END IF;

  SELECT b.id, b.tenant_id, b.is_active, b.timezone INTO v_branch
  FROM garage_branches b
  WHERE b.id = p_branch_id AND b.tenant_id = p_tenant_id;

  IF NOT FOUND OR v_branch.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'GARAGE_OPS03_ACTIVE_BRANCH_REQUIRED';
  END IF;
  IF v_branch.timezone IS NULL OR btrim(v_branch.timezone) = '' THEN
    RAISE EXCEPTION 'GARAGE_OPS03_SCHEDULE_TIMEZONE_NOT_CONFIGURED';
  END IF;

  SELECT * INTO v_settings
  FROM garage_branch_scheduling_settings s
  WHERE s.branch_id = p_branch_id AND s.tenant_id = p_tenant_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS03_SCHEDULING_NOT_CONFIGURED'; END IF;
  IF v_settings.scheduling_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'GARAGE_OPS03_SCHEDULING_DISABLED';
  END IF;

  v_local_start := p_starts_at AT TIME ZONE v_branch.timezone;
  v_local_end := p_ends_at AT TIME ZONE v_branch.timezone;
  v_local_date := v_local_start::date;
  v_day := EXTRACT(DOW FROM v_local_start)::smallint;

  IF v_local_end::date <> v_local_date THEN
    RAISE EXCEPTION 'GARAGE_OPS03_OUTSIDE_OPENING_HOURS';
  END IF;

  IF EXTRACT(SECOND FROM v_local_start) <> 0
     OR EXTRACT(SECOND FROM v_local_end) <> 0
     OR (EXTRACT(HOUR FROM v_local_start)::int * 60 + EXTRACT(MINUTE FROM v_local_start)::int)
          % v_settings.slot_interval_minutes <> 0
     OR (EXTRACT(EPOCH FROM (p_ends_at - p_starts_at))::int / 60)
          % v_settings.slot_interval_minutes <> 0 THEN
    RAISE EXCEPTION 'GARAGE_OPS03_SLOT_INTERVAL_MISMATCH';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM garage_branch_opening_hours h
    WHERE h.tenant_id = p_tenant_id
      AND h.branch_id = p_branch_id
      AND h.day_of_week = v_day
      AND h.is_closed = false
      AND h.opens_at <= v_local_start::time
      AND h.closes_at >= v_local_end::time
  ) THEN
    RAISE EXCEPTION 'GARAGE_OPS03_OUTSIDE_OPENING_HOURS';
  END IF;

  SELECT count(*)::int INTO v_booked
  FROM garage_appointments a
  WHERE a.tenant_id = p_tenant_id
    AND a.branch_id = p_branch_id
    AND a.status = 'confirmed'
    AND (p_exclude_appointment_id IS NULL OR a.id <> p_exclude_appointment_id)
    AND a.starts_at < p_ends_at
    AND a.ends_at > p_starts_at;

  SELECT coalesce(array_agg(DISTINCT ws.workforce_profile_id ORDER BY ws.workforce_profile_id), ARRAY[]::uuid[])
    INTO v_workforce
  FROM garage_workforce_schedules ws
  JOIN garage_workforce_profiles p
    ON p.id = ws.workforce_profile_id
   AND p.tenant_id = ws.tenant_id
   AND p.employment_status = 'active'
  JOIN tenant_users tu
    ON tu.tenant_id = p.tenant_id
   AND tu.user_id = p.user_id
   AND tu.role IN ('admin','mechanic')
  JOIN garage_workforce_branch_assignments ba
    ON ba.tenant_id = p.tenant_id
   AND ba.workforce_profile_id = p.id
   AND ba.branch_id = p_branch_id
   AND ba.ended_at IS NULL
  WHERE ws.tenant_id = p_tenant_id
    AND ws.branch_id = p_branch_id
    AND ws.day_of_week = v_day
    AND ws.effective_from <= v_local_date
    AND (ws.effective_until IS NULL OR ws.effective_until >= v_local_date)
    AND ws.starts_at <= v_local_start::time
    AND ws.ends_at >= v_local_end::time
    AND NOT EXISTS (
      SELECT 1 FROM garage_workforce_unavailability u
      WHERE u.tenant_id = p_tenant_id
        AND u.workforce_profile_id = ws.workforce_profile_id
        AND u.starts_at < p_ends_at
        AND u.ends_at > p_starts_at
    )
    AND NOT EXISTS (
      SELECT 1 FROM garage_appointments a
      WHERE a.tenant_id = p_tenant_id
        AND a.planned_workforce_profile_id = ws.workforce_profile_id
        AND a.status = 'confirmed'
        AND (p_exclude_appointment_id IS NULL OR a.id <> p_exclude_appointment_id)
        AND a.starts_at < p_ends_at
        AND a.ends_at > p_starts_at
    );

  appointment_timezone := v_branch.timezone;
  max_concurrent_appointments := v_settings.max_concurrent_appointments;
  slot_interval_minutes := v_settings.slot_interval_minutes;
  booked_count := v_booked;
  available_workforce_profile_ids := v_workforce;
  available_count := least(
    greatest(v_settings.max_concurrent_appointments - v_booked, 0),
    coalesce(cardinality(v_workforce), 0)
  );
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION garage_ops03_list_availability(
  p_tenant_id UUID,
  p_service_case_id UUID,
  p_branch_id UUID,
  p_local_date DATE,
  p_duration_minutes INTEGER
)
RETURNS TABLE (
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  appointment_timezone TEXT,
  booked_count INTEGER,
  branch_capacity INTEGER,
  available_count INTEGER,
  available_workforce_profile_ids UUID[]
)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch RECORD;
  v_settings RECORD;
  v_hours RECORD;
  v_start TIMESTAMP;
  v_last TIMESTAMP;
  v_candidate TIMESTAMP;
  v_eval RECORD;
BEGIN
  IF p_duration_minutes IS NULL OR p_duration_minutes <= 0 THEN
    RAISE EXCEPTION 'GARAGE_OPS03_DURATION_REQUIRED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM service_cases sc
    WHERE sc.id = p_service_case_id AND sc.garage_tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'GARAGE_OPS03_SERVICE_CASE_GARAGE_MISMATCH';
  END IF;

  SELECT b.id, b.timezone, b.is_active INTO v_branch
  FROM garage_branches b
  WHERE b.id = p_branch_id AND b.tenant_id = p_tenant_id;
  IF NOT FOUND OR v_branch.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'GARAGE_OPS03_ACTIVE_BRANCH_REQUIRED';
  END IF;
  IF v_branch.timezone IS NULL OR btrim(v_branch.timezone) = '' THEN
    RAISE EXCEPTION 'GARAGE_OPS03_SCHEDULE_TIMEZONE_NOT_CONFIGURED';
  END IF;

  SELECT * INTO v_settings
  FROM garage_branch_scheduling_settings s
  WHERE s.branch_id = p_branch_id AND s.tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS03_SCHEDULING_NOT_CONFIGURED'; END IF;
  IF v_settings.scheduling_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'GARAGE_OPS03_SCHEDULING_DISABLED';
  END IF;
  IF p_duration_minutes % v_settings.slot_interval_minutes <> 0 THEN
    RAISE EXCEPTION 'GARAGE_OPS03_SLOT_INTERVAL_MISMATCH';
  END IF;

  SELECT * INTO v_hours
  FROM garage_branch_opening_hours h
  WHERE h.tenant_id = p_tenant_id
    AND h.branch_id = p_branch_id
    AND h.day_of_week = EXTRACT(DOW FROM p_local_date)::smallint;
  IF NOT FOUND OR v_hours.is_closed IS DISTINCT FROM false THEN RETURN; END IF;

  v_start := p_local_date + v_hours.opens_at;
  v_last := p_local_date + v_hours.closes_at - make_interval(mins => p_duration_minutes);
  IF v_last < v_start THEN RETURN; END IF;

  FOR v_candidate IN
    SELECT generate_series(
      v_start,
      v_last,
      make_interval(mins => v_settings.slot_interval_minutes)
    )
  LOOP
    SELECT * INTO v_eval
    FROM garage_ops03_evaluate_interval(
      p_tenant_id,
      p_branch_id,
      v_candidate AT TIME ZONE v_branch.timezone,
      (v_candidate + make_interval(mins => p_duration_minutes)) AT TIME ZONE v_branch.timezone,
      NULL
    );

    starts_at := v_candidate AT TIME ZONE v_branch.timezone;
    ends_at := (v_candidate + make_interval(mins => p_duration_minutes)) AT TIME ZONE v_branch.timezone;
    appointment_timezone := v_eval.appointment_timezone;
    booked_count := v_eval.booked_count;
    branch_capacity := v_eval.max_concurrent_appointments;
    available_count := v_eval.available_count;
    available_workforce_profile_ids := v_eval.available_workforce_profile_ids;
    RETURN NEXT;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION garage_ops03_request_appointment(
  p_service_case_id UUID,
  p_branch_id UUID,
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ,
  p_actor_user_id TEXT
)
RETURNS garage_appointments
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_case RECORD;
  v_eval RECORD;
  v_row garage_appointments%ROWTYPE;
  v_new JSONB;
  v_constraint_name TEXT;
BEGIN
  SELECT * INTO v_case
  FROM service_cases
  WHERE id = p_service_case_id
    AND requester_user_id = p_actor_user_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS03_SERVICE_CASE_NOT_OWNED'; END IF;
  IF v_case.status NOT IN ('requested','accepted') THEN
    RAISE EXCEPTION 'GARAGE_OPS03_SERVICE_CASE_NOT_SCHEDULABLE';
  END IF;
  IF v_case.branch_id IS NOT NULL AND v_case.branch_id <> p_branch_id THEN
    RAISE EXCEPTION 'GARAGE_OPS03_SERVICE_CASE_BRANCH_MISMATCH';
  END IF;

  SELECT * INTO v_eval
  FROM garage_ops03_evaluate_interval(
    v_case.garage_tenant_id, p_branch_id, p_starts_at, p_ends_at, NULL
  );
  IF v_eval.available_count <= 0 THEN RAISE EXCEPTION 'GARAGE_OPS03_CAPACITY_NOT_AVAILABLE'; END IF;

  INSERT INTO garage_appointments (
    tenant_id, service_case_id, branch_id, status, starts_at, ends_at,
    appointment_timezone, planned_workforce_profile_id, requested_by_user_id
  )
  VALUES (
    v_case.garage_tenant_id, v_case.id, p_branch_id, 'requested',
    p_starts_at, p_ends_at, v_eval.appointment_timezone, NULL, p_actor_user_id
  )
  RETURNING * INTO v_row;

  v_new := jsonb_build_object(
    'appointment_id', v_row.id,
    'service_case_id', v_row.service_case_id,
    'status', v_row.status,
    'branch_id', v_row.branch_id,
    'starts_at', v_row.starts_at,
    'ends_at', v_row.ends_at,
    'appointment_timezone', v_row.appointment_timezone,
    'planned_workforce_profile_id', NULL
  );
  PERFORM garage_ops03_append_event_and_audit(
    v_row.id, 'requested', p_actor_user_id, 'requester', NULL, v_new
  );
  RETURN v_row;
EXCEPTION
  WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
    IF v_constraint_name = 'uq_garage_ops03_live_appointment_per_case' THEN
      RAISE EXCEPTION 'GARAGE_OPS03_LIVE_APPOINTMENT_EXISTS';
    END IF;
    RAISE;
END $;

CREATE OR REPLACE FUNCTION garage_ops03_confirm_appointment(
  p_tenant_id UUID,
  p_appointment_id UUID,
  p_branch_id UUID,
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ,
  p_planned_workforce_profile_id UUID,
  p_actor_user_id TEXT
)
RETURNS garage_appointments
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old garage_appointments%ROWTYPE;
  v_row garage_appointments%ROWTYPE;
  v_case_status TEXT;
  v_eval RECORD;
  v_previous JSONB;
  v_new JSONB;
BEGIN
  PERFORM garage_ops03_assert_admin(p_tenant_id, p_actor_user_id);

  SELECT * INTO v_old
  FROM garage_appointments
  WHERE id = p_appointment_id AND tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS03_APPOINTMENT_NOT_FOUND'; END IF;
  IF v_old.status <> 'requested' THEN RAISE EXCEPTION 'GARAGE_OPS03_CONFIRM_REQUIRES_REQUESTED'; END IF;

  -- These existing rows are the serialization primitives: branch capacity is locked by the
  -- settings row, and a planned mechanic is locked by their canonical workforce profile row.
  PERFORM 1 FROM garage_branch_scheduling_settings
   WHERE tenant_id = p_tenant_id AND branch_id = p_branch_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS03_SCHEDULING_NOT_CONFIGURED'; END IF;

  PERFORM 1 FROM garage_workforce_profiles
   WHERE tenant_id = p_tenant_id AND id = p_planned_workforce_profile_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS03_WORKFORCE_NOT_FOUND'; END IF;

  SELECT status INTO v_case_status FROM service_cases WHERE id = v_old.service_case_id;
  IF v_case_status <> 'accepted' THEN
    RAISE EXCEPTION 'GARAGE_OPS03_SERVICE_CASE_MUST_BE_ACCEPTED';
  END IF;

  SELECT * INTO v_eval
  FROM garage_ops03_evaluate_interval(
    p_tenant_id, p_branch_id, p_starts_at, p_ends_at, p_appointment_id
  );
  IF v_eval.available_count <= 0 THEN RAISE EXCEPTION 'GARAGE_OPS03_CAPACITY_EXHAUSTED'; END IF;
  IF NOT (p_planned_workforce_profile_id = ANY(v_eval.available_workforce_profile_ids)) THEN
    RAISE EXCEPTION 'GARAGE_OPS03_PLANNED_WORKFORCE_UNAVAILABLE';
  END IF;

  v_previous := jsonb_build_object(
    'appointment_id', v_old.id, 'service_case_id', v_old.service_case_id,
    'status', v_old.status, 'branch_id', v_old.branch_id,
    'starts_at', v_old.starts_at, 'ends_at', v_old.ends_at,
    'appointment_timezone', v_old.appointment_timezone,
    'planned_workforce_profile_id', v_old.planned_workforce_profile_id
  );

  UPDATE garage_appointments
  SET branch_id = p_branch_id,
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      appointment_timezone = v_eval.appointment_timezone,
      planned_workforce_profile_id = p_planned_workforce_profile_id,
      status = 'confirmed',
      confirmed_by_user_id = p_actor_user_id,
      confirmed_at = NOW()
  WHERE id = p_appointment_id
  RETURNING * INTO v_row;

  v_new := jsonb_build_object(
    'appointment_id', v_row.id, 'service_case_id', v_row.service_case_id,
    'status', v_row.status, 'branch_id', v_row.branch_id,
    'starts_at', v_row.starts_at, 'ends_at', v_row.ends_at,
    'appointment_timezone', v_row.appointment_timezone,
    'planned_workforce_profile_id', v_row.planned_workforce_profile_id
  );
  PERFORM garage_ops03_append_event_and_audit(
    v_row.id, 'confirmed', p_actor_user_id, 'garage', v_previous, v_new
  );
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION garage_ops03_reschedule_appointment(
  p_tenant_id UUID,
  p_appointment_id UUID,
  p_branch_id UUID,
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ,
  p_planned_workforce_profile_id UUID,
  p_actor_user_id TEXT
)
RETURNS garage_appointments
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old garage_appointments%ROWTYPE;
  v_row garage_appointments%ROWTYPE;
  v_eval RECORD;
  v_previous JSONB;
  v_new JSONB;
BEGIN
  PERFORM garage_ops03_assert_admin(p_tenant_id, p_actor_user_id);

  SELECT * INTO v_old
  FROM garage_appointments
  WHERE id = p_appointment_id AND tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS03_APPOINTMENT_NOT_FOUND'; END IF;
  IF v_old.status <> 'confirmed' THEN RAISE EXCEPTION 'GARAGE_OPS03_RESCHEDULE_REQUIRES_CONFIRMED'; END IF;

  PERFORM 1 FROM garage_branch_scheduling_settings
   WHERE tenant_id = p_tenant_id AND branch_id = p_branch_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS03_SCHEDULING_NOT_CONFIGURED'; END IF;

  PERFORM 1 FROM garage_workforce_profiles
   WHERE tenant_id = p_tenant_id AND id = p_planned_workforce_profile_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS03_WORKFORCE_NOT_FOUND'; END IF;

  SELECT * INTO v_eval
  FROM garage_ops03_evaluate_interval(
    p_tenant_id, p_branch_id, p_starts_at, p_ends_at, p_appointment_id
  );
  IF v_eval.available_count <= 0 THEN RAISE EXCEPTION 'GARAGE_OPS03_CAPACITY_EXHAUSTED'; END IF;
  IF NOT (p_planned_workforce_profile_id = ANY(v_eval.available_workforce_profile_ids)) THEN
    RAISE EXCEPTION 'GARAGE_OPS03_PLANNED_WORKFORCE_UNAVAILABLE';
  END IF;

  v_previous := jsonb_build_object(
    'appointment_id', v_old.id, 'service_case_id', v_old.service_case_id,
    'status', v_old.status, 'branch_id', v_old.branch_id,
    'starts_at', v_old.starts_at, 'ends_at', v_old.ends_at,
    'appointment_timezone', v_old.appointment_timezone,
    'planned_workforce_profile_id', v_old.planned_workforce_profile_id
  );

  UPDATE garage_appointments
  SET branch_id = p_branch_id,
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      appointment_timezone = v_eval.appointment_timezone,
      planned_workforce_profile_id = p_planned_workforce_profile_id
  WHERE id = p_appointment_id
  RETURNING * INTO v_row;

  v_new := jsonb_build_object(
    'appointment_id', v_row.id, 'service_case_id', v_row.service_case_id,
    'status', v_row.status, 'branch_id', v_row.branch_id,
    'starts_at', v_row.starts_at, 'ends_at', v_row.ends_at,
    'appointment_timezone', v_row.appointment_timezone,
    'planned_workforce_profile_id', v_row.planned_workforce_profile_id
  );
  IF v_previous <> v_new THEN
    PERFORM garage_ops03_append_event_and_audit(
      v_row.id, 'rescheduled', p_actor_user_id, 'garage', v_previous, v_new
    );
  END IF;
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION garage_ops03_transition_appointment(
  p_appointment_id UUID,
  p_target_status TEXT,
  p_actor_user_id TEXT,
  p_actor_scope TEXT,
  p_tenant_id UUID DEFAULT NULL
)
RETURNS garage_appointments
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old garage_appointments%ROWTYPE;
  v_row garage_appointments%ROWTYPE;
  v_previous JSONB;
  v_new JSONB;
BEGIN
  SELECT * INTO v_old FROM garage_appointments WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GARAGE_OPS03_APPOINTMENT_NOT_FOUND'; END IF;

  IF p_actor_scope = 'requester' THEN
    IF v_old.requested_by_user_id <> p_actor_user_id THEN
      RAISE EXCEPTION 'GARAGE_OPS03_APPOINTMENT_NOT_FOUND';
    END IF;
    IF p_target_status <> 'cancelled' OR v_old.status NOT IN ('requested','confirmed') THEN
      RAISE EXCEPTION 'GARAGE_OPS03_REQUESTER_CANCELLATION_NOT_ALLOWED';
    END IF;
  ELSIF p_actor_scope = 'garage' THEN
    IF p_tenant_id IS NULL OR p_tenant_id <> v_old.tenant_id THEN
      RAISE EXCEPTION 'GARAGE_OPS03_APPOINTMENT_NOT_FOUND';
    END IF;
    PERFORM garage_ops03_assert_admin(p_tenant_id, p_actor_user_id);
    IF v_old.status = 'requested' AND p_target_status NOT IN ('declined','cancelled') THEN
      RAISE EXCEPTION 'GARAGE_OPS03_INVALID_APPOINTMENT_TRANSITION';
    END IF;
    IF v_old.status = 'confirmed' AND p_target_status NOT IN ('cancelled','fulfilled','no_show') THEN
      RAISE EXCEPTION 'GARAGE_OPS03_INVALID_APPOINTMENT_TRANSITION';
    END IF;
  ELSE
    RAISE EXCEPTION 'GARAGE_OPS03_INVALID_ACTOR_SCOPE';
  END IF;

  v_previous := jsonb_build_object(
    'appointment_id', v_old.id, 'service_case_id', v_old.service_case_id,
    'status', v_old.status, 'branch_id', v_old.branch_id,
    'starts_at', v_old.starts_at, 'ends_at', v_old.ends_at,
    'appointment_timezone', v_old.appointment_timezone,
    'planned_workforce_profile_id', v_old.planned_workforce_profile_id
  );

  UPDATE garage_appointments
  SET status = p_target_status,
      cancelled_by_user_id = CASE WHEN p_target_status = 'cancelled' THEN p_actor_user_id ELSE cancelled_by_user_id END,
      cancelled_at = CASE WHEN p_target_status = 'cancelled' THEN NOW() ELSE cancelled_at END,
      declined_by_user_id = CASE WHEN p_target_status = 'declined' THEN p_actor_user_id ELSE declined_by_user_id END,
      declined_at = CASE WHEN p_target_status = 'declined' THEN NOW() ELSE declined_at END,
      fulfilled_by_user_id = CASE WHEN p_target_status = 'fulfilled' THEN p_actor_user_id ELSE fulfilled_by_user_id END,
      fulfilled_at = CASE WHEN p_target_status = 'fulfilled' THEN NOW() ELSE fulfilled_at END,
      no_show_by_user_id = CASE WHEN p_target_status = 'no_show' THEN p_actor_user_id ELSE no_show_by_user_id END,
      no_show_at = CASE WHEN p_target_status = 'no_show' THEN NOW() ELSE no_show_at END
  WHERE id = p_appointment_id
  RETURNING * INTO v_row;

  v_new := jsonb_build_object(
    'appointment_id', v_row.id, 'service_case_id', v_row.service_case_id,
    'status', v_row.status, 'branch_id', v_row.branch_id,
    'starts_at', v_row.starts_at, 'ends_at', v_row.ends_at,
    'appointment_timezone', v_row.appointment_timezone,
    'planned_workforce_profile_id', v_row.planned_workforce_profile_id
  );
  PERFORM garage_ops03_append_event_and_audit(
    v_row.id, p_target_status, p_actor_user_id, p_actor_scope, v_previous, v_new
  );
  RETURN v_row;
END $$;

-- OPS01 lifecycle changes must not silently orphan future confirmed scheduling responsibility.
CREATE OR REPLACE FUNCTION garage_ops03_guard_branch_deactivation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.is_active = true AND NEW.is_active = false AND EXISTS (
    SELECT 1 FROM garage_appointments a
    WHERE a.tenant_id = OLD.tenant_id
      AND a.branch_id = OLD.id
      AND a.status = 'confirmed'
      AND a.ends_at > NOW()
  ) THEN
    RAISE EXCEPTION 'GARAGE_OPS03_FUTURE_APPOINTMENTS_BLOCK_SITE_DEACTIVATION';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops03_guard_branch_deactivation ON garage_branches;
CREATE TRIGGER trg_garage_ops03_guard_branch_deactivation
  BEFORE UPDATE OF is_active ON garage_branches
  FOR EACH ROW EXECUTE FUNCTION garage_ops03_guard_branch_deactivation();

CREATE OR REPLACE FUNCTION garage_ops03_guard_workforce_deactivation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.employment_status = 'active'
     AND NEW.employment_status <> 'active'
     AND EXISTS (
       SELECT 1 FROM garage_appointments a
       WHERE a.tenant_id = OLD.tenant_id
         AND a.planned_workforce_profile_id = OLD.id
         AND a.status = 'confirmed'
         AND a.ends_at > NOW()
     ) THEN
    RAISE EXCEPTION 'GARAGE_OPS03_FUTURE_APPOINTMENTS_BLOCK_WORKFORCE_DEACTIVATION';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops03_guard_workforce_deactivation ON garage_workforce_profiles;
CREATE TRIGGER trg_garage_ops03_guard_workforce_deactivation
  BEFORE UPDATE OF employment_status ON garage_workforce_profiles
  FOR EACH ROW EXECUTE FUNCTION garage_ops03_guard_workforce_deactivation();

ALTER TABLE garage_branch_scheduling_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_branch_scheduling_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE garage_workforce_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_workforce_schedules FORCE ROW LEVEL SECURITY;
ALTER TABLE garage_workforce_unavailability ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_workforce_unavailability FORCE ROW LEVEL SECURITY;
ALTER TABLE garage_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_appointments FORCE ROW LEVEL SECURITY;
ALTER TABLE garage_appointment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_appointment_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  garage_branch_scheduling_settings,
  garage_workforce_schedules,
  garage_workforce_unavailability,
  garage_appointments,
  garage_appointment_events
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE garage_branch_scheduling_settings TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE garage_workforce_schedules TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE garage_workforce_unavailability TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE garage_appointments TO service_role;
GRANT SELECT, INSERT ON TABLE garage_appointment_events TO service_role;

REVOKE ALL ON FUNCTION
  garage_ops03_assert_admin(UUID,TEXT),
  garage_ops03_append_event_and_audit(UUID,TEXT,TEXT,TEXT,JSONB,JSONB),
  garage_ops03_evaluate_interval(UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ,UUID),
  garage_ops03_list_availability(UUID,UUID,UUID,DATE,INTEGER),
  garage_ops03_request_appointment(UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT),
  garage_ops03_confirm_appointment(UUID,UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ,UUID,TEXT),
  garage_ops03_reschedule_appointment(UUID,UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ,UUID,TEXT),
  garage_ops03_transition_appointment(UUID,TEXT,TEXT,TEXT,UUID)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  garage_ops03_assert_admin(UUID,TEXT),
  garage_ops03_append_event_and_audit(UUID,TEXT,TEXT,TEXT,JSONB,JSONB),
  garage_ops03_evaluate_interval(UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ,UUID),
  garage_ops03_list_availability(UUID,UUID,UUID,DATE,INTEGER),
  garage_ops03_request_appointment(UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT),
  garage_ops03_confirm_appointment(UUID,UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ,UUID,TEXT),
  garage_ops03_reschedule_appointment(UUID,UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ,UUID,TEXT),
  garage_ops03_transition_appointment(UUID,TEXT,TEXT,TEXT,UUID)
TO service_role;

-- +migrate Down
DROP TRIGGER IF EXISTS trg_garage_ops03_guard_workforce_deactivation ON garage_workforce_profiles;
DROP FUNCTION IF EXISTS garage_ops03_guard_workforce_deactivation();
DROP TRIGGER IF EXISTS trg_garage_ops03_guard_branch_deactivation ON garage_branches;
DROP FUNCTION IF EXISTS garage_ops03_guard_branch_deactivation();
DROP FUNCTION IF EXISTS garage_ops03_transition_appointment(UUID,TEXT,TEXT,TEXT,UUID);
DROP FUNCTION IF EXISTS garage_ops03_reschedule_appointment(UUID,UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ,UUID,TEXT);
DROP FUNCTION IF EXISTS garage_ops03_confirm_appointment(UUID,UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ,UUID,TEXT);
DROP FUNCTION IF EXISTS garage_ops03_request_appointment(UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT);
DROP FUNCTION IF EXISTS garage_ops03_list_availability(UUID,UUID,UUID,DATE,INTEGER);
DROP FUNCTION IF EXISTS garage_ops03_evaluate_interval(UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ,UUID);
DROP FUNCTION IF EXISTS garage_ops03_append_event_and_audit(UUID,TEXT,TEXT,TEXT,JSONB,JSONB);
DROP FUNCTION IF EXISTS garage_ops03_assert_admin(UUID,TEXT);
DROP TRIGGER IF EXISTS trg_garage_ops03_events_append_only ON garage_appointment_events;
DROP FUNCTION IF EXISTS garage_ops03_events_append_only();
DROP TRIGGER IF EXISTS trg_garage_ops03_validate_appointment ON garage_appointments;
DROP FUNCTION IF EXISTS garage_ops03_validate_appointment();
DROP TRIGGER IF EXISTS trg_garage_ops03_validate_unavailability ON garage_workforce_unavailability;
DROP FUNCTION IF EXISTS garage_ops03_validate_unavailability();
DROP TRIGGER IF EXISTS trg_garage_ops03_validate_workforce_schedule ON garage_workforce_schedules;
DROP FUNCTION IF EXISTS garage_ops03_validate_workforce_schedule();
DROP TRIGGER IF EXISTS trg_garage_ops03_unavailability_touch ON garage_workforce_unavailability;
DROP TRIGGER IF EXISTS trg_garage_ops03_work_schedule_touch ON garage_workforce_schedules;
DROP TRIGGER IF EXISTS trg_garage_ops03_settings_touch ON garage_branch_scheduling_settings;
DROP FUNCTION IF EXISTS garage_ops03_touch_updated_at();
DROP TABLE IF EXISTS garage_appointment_events;
DROP TABLE IF EXISTS garage_appointments;
DROP TABLE IF EXISTS garage_workforce_unavailability;
DROP TABLE IF EXISTS garage_workforce_schedules;
DROP TABLE IF EXISTS garage_branch_scheduling_settings;
DROP INDEX IF EXISTS uq_service_cases_id_garage_tenant;
